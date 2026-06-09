import {
  calculateRoundResult,
  createDeck,
  dealCards,
  shuffleDeck,
  sortCards,
  validatePlay
} from "@doudizhu/shared";
import type {
  BidScore,
  Card,
  HandAnalysis,
  PlayerSeat,
  PublicPlay,
  RoomState,
  RoomView,
  RoundResult
} from "@doudizhu/shared";

const SEATS = [0, 1, 2] as const satisfies PlayerSeat[];
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface InternalPlayer {
  socketId: string;
  nickname: string;
  seat: PlayerSeat;
  joinedAt: number;
  score: number;
  connected: boolean;
  ready: boolean;
  hand: Card[];
  lastAction?: string;
}

interface BidState {
  startSeat: PlayerSeat;
  currentSeat: PlayerSeat;
  actedSeats: PlayerSeat[];
  highestScore: BidScore;
  highestSeat?: PlayerSeat;
}

interface LastPlay {
  seat: PlayerSeat;
  nickname: string;
  cards: Card[];
  analysis: HandAnalysis;
  publicPlay: PublicPlay;
}

export interface InternalRoom extends RoomState {
  players: [InternalPlayer | null, InternalPlayer | null, InternalPlayer | null];
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  bottomCards: Card[];
  landlordSeat?: PlayerSeat;
  currentTurn?: PlayerSeat;
  bid?: BidState;
  lastPlay?: LastPlay;
  passCount: number;
  multiplier: number;
  highestBidScore: BidScore;
  highestBidSeat?: PlayerSeat;
  turnLog: PublicPlay[];
  result?: RoundResult;
  message?: string;
}

export interface RoomCleanupOptions {
  emptyRoomTtlMs: number;
  endedRoomTtlMs: number;
  lobbyRoomTtlMs: number;
}

export interface RoomCleanupResult {
  roomCode: string;
  reason: "empty" | "ended" | "idle_lobby";
  socketIds: string[];
}

export class GameException extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

function nextSeat(seat: PlayerSeat): PlayerSeat {
  return ((seat + 1) % 3) as PlayerSeat;
}

function isBidScore(score: number): score is BidScore {
  return score === 0 || score === 1 || score === 2 || score === 3;
}

function normalizeNickname(nickname: string): string {
  const normalized = nickname.trim().slice(0, 16);
  return normalized.length > 0 ? normalized : "玩家";
}

function makeLogEvent(event: Omit<PublicPlay, "at">): PublicPlay {
  return { ...event, at: Date.now() };
}

export class RoomManager {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly rng: () => number = Math.random) {}

  createRoom(socketId: string, nickname: string): InternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const roomCode = this.generateRoomCode();
    const player = this.createPlayer(socketId, normalizeNickname(nickname), 0);
    const now = Date.now();
    const room: InternalRoom = {
      roomCode,
      phase: "lobby",
      playerCount: 1,
      createdAt: now,
      updatedAt: now,
      players: [player, null, null],
      bottomCards: [],
      passCount: 0,
      multiplier: 1,
      highestBidScore: 0,
      turnLog: [],
      message: "房间已创建，等待另外两名玩家。"
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(socketId, roomCode);
    this.pushSystem(room, `${player.nickname} 创建了房间。`);

    return room;
  }

  joinRoom(socketId: string, roomCode: string, nickname: string): InternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const room = this.requireRoom(roomCode.trim().toUpperCase());

    if (room.phase !== "lobby") {
      throw new GameException("ROOM_STARTED", "这局已经开始，请创建新房间。");
    }

    const seat = this.findOpenSeat(room);
    if (seat === undefined) {
      throw new GameException("ROOM_FULL", "房间已满。");
    }

    const player = this.createPlayer(socketId, normalizeNickname(nickname), seat);
    room.players[seat] = player;
    this.socketToRoom.set(socketId, room.roomCode);
    this.syncPlayerCount(room);
    this.touch(room);
    room.message = "三名玩家准备后开始发牌。";
    this.pushSystem(room, `${player.nickname} 加入了房间。`);

    return room;
  }

  leaveRoom(socketId: string): InternalRoom | undefined {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      return undefined;
    }

    const player = this.requirePlayer(room, socketId);
    this.socketToRoom.delete(socketId);

    if (room.phase === "lobby" || room.phase === "ended") {
      room.players[player.seat] = null;
      this.syncPlayerCount(room);
      this.touch(room);
      this.pushSystem(room, `${player.nickname} 离开了房间。`);

      if (room.playerCount === 0) {
        this.rooms.delete(room.roomCode);
        return undefined;
      }

      return room;
    }

    player.connected = false;
    player.ready = false;
    this.syncPlayerCount(room);
    room.phase = "ended";
    room.endedAt = Date.now();
    room.currentTurn = undefined;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.message = `${player.nickname} 离线，本局已结束。`;
    this.pushSystem(room, room.message);
    this.touch(room);

    return room;
  }

  disconnect(socketId: string): InternalRoom | undefined {
    return this.leaveRoom(socketId);
  }

  ready(socketId: string): InternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);

    if (room.phase === "ended") {
      this.resetToLobby(room);
    }

    if (room.phase !== "lobby") {
      throw new GameException("NOT_LOBBY", "当前阶段不能准备。");
    }

    player.ready = true;
    player.lastAction = "已准备";
    this.touch(room);
    room.message = "等待所有玩家准备。";
    this.pushSystem(room, `${player.nickname} 已准备。`);

    if (this.connectedPlayers(room).length === 3 && this.connectedPlayers(room).every((item) => item.ready)) {
      this.startDeal(room);
    }

    return room;
  }

  chooseBid(socketId: string, score: BidScore): InternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);

    if (room.phase !== "bidding" || !room.bid) {
      throw new GameException("NOT_BIDDING", "当前不是叫分阶段。");
    }

    if (room.bid.currentSeat !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你操作。");
    }

    if (!isBidScore(score)) {
      throw new GameException("INVALID_BID", "叫分只能是不叫、1分、2分或3分。");
    }

    if (room.bid.actedSeats.includes(player.seat)) {
      throw new GameException("BID_ALREADY_ACTED", "你已经在本轮叫分中操作过。");
    }

    if (score > 0 && score <= room.bid.highestScore) {
      throw new GameException("BID_TOO_LOW", "叫分必须大于当前最高分。");
    }

    room.bid.actedSeats = [...room.bid.actedSeats, player.seat];
    this.touch(room);

    if (score === 0) {
      player.lastAction = "不叫";
      this.pushBid(room, player, "不叫");
    } else {
      room.bid.highestScore = score;
      room.bid.highestSeat = player.seat;
      room.highestBidScore = score;
      room.highestBidSeat = player.seat;
      player.lastAction = `${score}分`;
      this.pushBid(room, player, `${score}分`);
    }

    if (score === 3) {
      this.appointLandlord(room, player.seat);
      return room;
    }

    if (room.bid.actedSeats.length >= SEATS.length) {
      if (room.bid.highestSeat === undefined) {
        this.startDeal(room, "无人叫分，已重新发牌。");
        return room;
      }

      this.appointLandlord(room, room.bid.highestSeat);
      return room;
    }

    room.bid.currentSeat = nextSeat(player.seat);
    room.message =
      room.bid.highestSeat === undefined
        ? "继续叫分。"
        : `当前最高叫分 ${room.bid.highestScore} 分，继续叫分。`;
    return room;
  }

  playCards(socketId: string, cardIds: string[]): { room: InternalRoom; result?: RoundResult } {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);

    if (room.phase !== "playing") {
      throw new GameException("NOT_PLAYING", "当前不能出牌。");
    }

    if (room.currentTurn !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你出牌。");
    }

    if (new Set(cardIds).size !== cardIds.length || cardIds.length === 0) {
      throw new GameException("INVALID_SELECTION", "请选择要出的牌。");
    }

    const selectedIdSet = new Set(cardIds);
    const selectedCards = player.hand.filter((card) => selectedIdSet.has(card.id));

    if (selectedCards.length !== cardIds.length) {
      throw new GameException("CARD_NOT_OWNED", "你不能出不在自己手里的牌。");
    }

    const validation = validatePlay(selectedCards, room.lastPlay?.analysis);
    if (!validation.ok) {
      throw new GameException("INVALID_PLAY", validation.reason);
    }

    const selectedIds = new Set(selectedCards.map((card) => card.id));
    player.hand = player.hand.filter((card) => !selectedIds.has(card.id));
    this.touch(room);

    if (validation.analysis.type === "bomb" || validation.analysis.type === "rocket") {
      room.multiplier *= 2;
    }

    const publicPlay = makeLogEvent({
      seat: player.seat,
      nickname: player.nickname,
      action: "play",
      label: validation.analysis.label,
      cards: sortCards(selectedCards),
      handType: validation.analysis.type
    });

    room.lastPlay = {
      seat: player.seat,
      nickname: player.nickname,
      cards: sortCards(selectedCards),
      analysis: validation.analysis,
      publicPlay
    };
    room.passCount = 0;
    player.lastAction = validation.analysis.label;
    this.pushLog(room, publicPlay);

    if (player.hand.length === 0) {
      const result = this.finishRound(room, player.seat);
      return { room, result };
    }

    room.currentTurn = nextSeat(player.seat);
    room.message = `轮到 ${this.requirePlayerBySeat(room, room.currentTurn).nickname} 出牌。`;

    return { room };
  }

  pass(socketId: string): InternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);

    if (room.phase !== "playing") {
      throw new GameException("NOT_PLAYING", "当前不能不出。");
    }

    if (room.currentTurn !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你操作。");
    }

    if (!room.lastPlay || room.lastPlay.seat === player.seat) {
      throw new GameException("CANNOT_PASS", "新一轮必须出牌，不能不出。");
    }

    player.lastAction = "不出";
    this.touch(room);
    this.pushLog(
      room,
      makeLogEvent({
        seat: player.seat,
        nickname: player.nickname,
        action: "pass",
        label: "不出"
      })
    );

    room.passCount += 1;

    if (room.passCount >= 2) {
      const leadSeat = room.lastPlay.seat;
      room.currentTurn = leadSeat;
      room.lastPlay = undefined;
      room.passCount = 0;
      room.message = `一轮结束，由 ${this.requirePlayerBySeat(room, leadSeat).nickname} 重新出牌。`;
      this.pushSystem(room, room.message);
      return room;
    }

    room.currentTurn = nextSeat(player.seat);
    room.message = `轮到 ${this.requirePlayerBySeat(room, room.currentTurn).nickname} 操作。`;

    return room;
  }

  getRoomForSocket(socketId: string): InternalRoom | undefined {
    const roomCode = this.socketToRoom.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  reassignSocket(oldSocketId: string, newSocketId: string): InternalRoom | undefined {
    const room = this.getRoomForSocket(oldSocketId);
    if (!room) {
      return undefined;
    }
    if (this.socketToRoom.has(newSocketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const player = this.requirePlayer(room, oldSocketId);
    this.socketToRoom.delete(oldSocketId);
    player.socketId = newSocketId;
    player.connected = true;
    this.socketToRoom.set(newSocketId, room.roomCode);
    this.touch(room);

    return room;
  }

  getRoom(roomCode: string): InternalRoom | undefined {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  getRoomForTest(roomCode: string): InternalRoom | undefined {
    return this.getRoom(roomCode);
  }

  getRoomCount() {
    return this.rooms.size;
  }

  cleanupRooms(now = Date.now(), options: Partial<RoomCleanupOptions> = {}): RoomCleanupResult[] {
    const resolved: RoomCleanupOptions = {
      emptyRoomTtlMs: options.emptyRoomTtlMs ?? 60_000,
      endedRoomTtlMs: options.endedRoomTtlMs ?? 30 * 60_000,
      lobbyRoomTtlMs: options.lobbyRoomTtlMs ?? 2 * 60 * 60_000
    };
    const removed: RoomCleanupResult[] = [];

    for (const room of this.rooms.values()) {
      const connectedCount = this.connectedPlayers(room).length;
      const idleFor = now - room.updatedAt;
      const endedFor = room.endedAt === undefined ? 0 : now - room.endedAt;
      let reason: RoomCleanupResult["reason"] | undefined;

      if (connectedCount === 0 && idleFor >= resolved.emptyRoomTtlMs) {
        reason = "empty";
      } else if (room.phase === "ended" && endedFor >= resolved.endedRoomTtlMs) {
        reason = "ended";
      } else if (room.phase === "lobby" && idleFor >= resolved.lobbyRoomTtlMs) {
        reason = "idle_lobby";
      }

      if (!reason) {
        continue;
      }

      const socketIds = room.players.flatMap((player) => (player ? [player.socketId] : []));
      for (const socketId of socketIds) {
        this.socketToRoom.delete(socketId);
      }
      this.rooms.delete(room.roomCode);
      removed.push({ roomCode: room.roomCode, reason, socketIds });
    }

    return removed;
  }

  buildViews(room: InternalRoom): Array<{ socketId: string; roomView: RoomView }> {
    return room.players
      .filter((player): player is InternalPlayer => Boolean(player && player.connected))
      .map((player) => ({
        socketId: player.socketId,
        roomView: this.buildViewForPlayer(room, player.socketId)
      }));
  }

  private createPlayer(socketId: string, nickname: string, seat: PlayerSeat): InternalPlayer {
    return {
      socketId,
      nickname,
      seat,
      joinedAt: Date.now(),
      score: 0,
      connected: true,
      ready: false,
      hand: []
    };
  }

  private generateRoomCode(): string {
    let code = "";

    do {
      code = Array.from({ length: 4 }, () => {
        const index = Math.floor(this.rng() * ROOM_CODE_ALPHABET.length);
        return ROOM_CODE_ALPHABET[index];
      }).join("");
    } while (this.rooms.has(code));

    return code;
  }

  private requireRoom(roomCode: string): InternalRoom {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new GameException("ROOM_NOT_FOUND", "没有找到这个房间。");
    }

    return room;
  }

  private requireRoomForSocket(socketId: string): InternalRoom {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      throw new GameException("NO_ROOM", "你还没有加入房间。");
    }

    return room;
  }

  private requirePlayer(room: InternalRoom, socketId: string): InternalPlayer {
    const player = room.players.find((candidate) => candidate?.socketId === socketId);
    if (!player) {
      throw new GameException("NO_PLAYER", "你不在这个房间里。");
    }

    return player;
  }

  private requirePlayerBySeat(room: InternalRoom, seat: PlayerSeat): InternalPlayer {
    const player = room.players[seat];
    if (!player) {
      throw new GameException("EMPTY_SEAT", "这个座位没有玩家。");
    }

    return player;
  }

  private findOpenSeat(room: InternalRoom): PlayerSeat | undefined {
    return SEATS.find((seat) => room.players[seat] === null);
  }

  private connectedPlayers(room: InternalRoom): InternalPlayer[] {
    return room.players.filter((player): player is InternalPlayer => Boolean(player && player.connected));
  }

  private syncPlayerCount(room: InternalRoom): void {
    room.playerCount = this.connectedPlayers(room).length;
  }

  private touch(room: InternalRoom): void {
    room.updatedAt = Date.now();
  }

  private resetToLobby(room: InternalRoom): void {
    for (const seat of SEATS) {
      const player = room.players[seat];
      if (player && !player.connected) {
        room.players[seat] = null;
      }
    }

    this.syncPlayerCount(room);
    room.phase = "lobby";
    room.endedAt = undefined;
    room.bottomCards = [];
    room.landlordSeat = undefined;
    room.currentTurn = undefined;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.passCount = 0;
    room.multiplier = 1;
    room.highestBidScore = 0;
    room.highestBidSeat = undefined;
    room.result = undefined;
    room.message = "准备后开始下一局。";
    room.turnLog = [];
    this.touch(room);

    for (const player of room.players) {
      if (player) {
        player.ready = false;
        player.hand = [];
        player.lastAction = undefined;
      }
    }
  }

  private startDeal(room: InternalRoom, message = "牌局开始，开始叫分。"): void {
    const firstBidSeat = this.randomSeat();
    const deck = shuffleDeck(createDeck(), this.rng);
    const { hands, bottomCards } = dealCards(deck);

    for (const seat of SEATS) {
      const player = this.requirePlayerBySeat(room, seat);
      player.hand = hands[seat];
      player.ready = false;
      player.lastAction = undefined;
    }

    room.phase = "bidding";
    room.endedAt = undefined;
    room.bottomCards = bottomCards;
    room.landlordSeat = undefined;
    room.currentTurn = undefined;
    room.bid = {
      startSeat: firstBidSeat,
      currentSeat: firstBidSeat,
      actedSeats: [],
      highestScore: 0
    };
    room.lastPlay = undefined;
    room.passCount = 0;
    room.multiplier = 1;
    room.highestBidScore = 0;
    room.highestBidSeat = undefined;
    room.result = undefined;
    room.message = message;
    room.turnLog = [];
    this.touch(room);
    this.pushSystem(room, message);
  }

  private randomSeat(): PlayerSeat {
    return Math.floor(this.rng() * SEATS.length) as PlayerSeat;
  }

  private appointLandlord(room: InternalRoom, landlordSeat: PlayerSeat): void {
    const landlord = this.requirePlayerBySeat(room, landlordSeat);
    landlord.hand = sortCards([...landlord.hand, ...room.bottomCards]);

    room.phase = "playing";
    room.endedAt = undefined;
    room.landlordSeat = landlordSeat;
    room.currentTurn = landlordSeat;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.passCount = 0;
    room.message = `${landlord.nickname} 成为地主，开始出牌。`;
    this.touch(room);
    this.pushSystem(room, room.message);
  }

  private finishRound(room: InternalRoom, winnerSeat: PlayerSeat): RoundResult {
    if (room.landlordSeat === undefined) {
      throw new GameException("NO_LANDLORD", "缺少地主信息。");
    }

    const result = calculateRoundResult(room.landlordSeat, winnerSeat, room.multiplier);
    for (const player of room.players) {
      if (player) {
        player.score += result.scores[player.seat];
      }
    }
    room.phase = "ended";
    room.endedAt = Date.now();
    room.currentTurn = undefined;
    room.bid = undefined;
    room.result = result;
    room.message = `${this.requirePlayerBySeat(room, winnerSeat).nickname} 出完手牌，本局结束。`;
    this.touch(room);
    this.pushSystem(room, room.message);

    return result;
  }

  private buildViewForPlayer(room: InternalRoom, socketId: string): RoomView {
    const self = room.players.find((player) => player?.socketId === socketId);
    const revealBottomCards = room.phase === "playing" || room.phase === "ended";

    return {
      roomCode: room.roomCode,
      phase: room.phase,
      playerCount: room.playerCount,
      selfSeat: self?.seat,
      players: room.players
        .filter((player): player is InternalPlayer => Boolean(player))
        .map((player) => ({
          seat: player.seat,
          nickname: player.nickname,
          connected: player.connected,
          ready: player.ready,
          isLandlord: room.landlordSeat === player.seat,
          cardCount: player.hand.length,
          hand: player.socketId === socketId ? sortCards(player.hand) : undefined,
          lastAction: player.lastAction
        })),
      currentTurn: room.phase === "bidding" ? room.bid?.currentSeat : room.currentTurn,
      landlordSeat: room.landlordSeat,
      bottomCards: revealBottomCards ? room.bottomCards : [],
      hiddenBottomCount: revealBottomCards ? 0 : room.bottomCards.length || 3,
      multiplier: room.multiplier,
      bidCurrentSeat: room.bid?.currentSeat,
      highestBidScore: room.highestBidScore,
      highestBidSeat: room.highestBidSeat,
      lastPlay: room.lastPlay?.publicPlay,
      turnLog: room.turnLog.slice(-10),
      result: room.result,
      message: room.message
    };
  }

  private pushBid(room: InternalRoom, player: InternalPlayer, label: string): void {
    this.pushLog(
      room,
      makeLogEvent({
        seat: player.seat,
        nickname: player.nickname,
        action: "bid",
        label
      })
    );
  }

  private pushSystem(room: InternalRoom, label: string): void {
    this.pushLog(
      room,
      makeLogEvent({
        action: "system",
        label
      })
    );
  }

  private pushLog(room: InternalRoom, event: PublicPlay): void {
    room.turnLog = [...room.turnLog, event].slice(-30);
  }
}
