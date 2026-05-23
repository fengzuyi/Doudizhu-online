import {
  calculateRoundResult,
  createDeck,
  dealCards,
  shuffleDeck,
  sortCards,
  validatePlay
} from "@doudizhu/shared";
import type {
  BidAction,
  BidStage,
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
  connected: boolean;
  ready: boolean;
  hand: Card[];
  lastAction?: string;
}

interface BidState {
  stage: BidStage;
  currentSeat: PlayerSeat;
  callerSeat?: PlayerSeat;
  callPassedSeats: PlayerSeat[];
  candidateSeat?: PlayerSeat;
  robActedSeats: PlayerSeat[];
  robCount: number;
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
  bottomCards: Card[];
  landlordSeat?: PlayerSeat;
  currentTurn?: PlayerSeat;
  bid?: BidState;
  lastPlay?: LastPlay;
  passCount: number;
  multiplier: number;
  turnLog: PublicPlay[];
  result?: RoundResult;
  message?: string;
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
    const room: InternalRoom = {
      roomCode,
      phase: "lobby",
      playerCount: 1,
      players: [player, null, null],
      bottomCards: [],
      passCount: 0,
      multiplier: 1,
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
      this.pushSystem(room, `${player.nickname} 离开了房间。`);

      if (room.playerCount === 0) {
        this.rooms.delete(room.roomCode);
        return undefined;
      }

      return room;
    }

    player.connected = false;
    player.ready = false;
    room.phase = "ended";
    room.currentTurn = undefined;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.message = `${player.nickname} 离线，本局已结束。`;
    this.pushSystem(room, room.message);

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
    room.message = "等待所有玩家准备。";
    this.pushSystem(room, `${player.nickname} 已准备。`);

    if (this.connectedPlayers(room).length === 3 && this.connectedPlayers(room).every((item) => item.ready)) {
      this.startDeal(room);
    }

    return room;
  }

  chooseBid(socketId: string, action: BidAction): InternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);

    if (room.phase !== "bidding" || !room.bid) {
      throw new GameException("NOT_BIDDING", "当前不是叫地主阶段。");
    }

    if (room.bid.currentSeat !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你操作。");
    }

    if (room.bid.stage === "call") {
      if (action !== "call" && action !== "pass") {
        throw new GameException("INVALID_BID", "当前只能选择叫地主或不叫。");
      }

      if (action === "pass") {
        room.bid.callPassedSeats = [...room.bid.callPassedSeats, player.seat];
        player.lastAction = "不叫";
        this.pushBid(room, player, "不叫");

        if (room.bid.callPassedSeats.length >= 3) {
          this.startDeal(room, "无人叫地主，已重新发牌。");
          return room;
        }

        room.bid.currentSeat = nextSeat(player.seat);
        room.message = "继续叫地主。";
        return room;
      }

      room.bid.callerSeat = player.seat;
      room.bid.candidateSeat = player.seat;
      room.bid.stage = "rob";
      room.bid.robActedSeats = [];
      room.bid.robCount = 0;
      player.lastAction = "叫地主";
      this.pushBid(room, player, "叫地主");

      const nextRobSeat = this.findNextRobSeat(room.bid, player.seat);
      if (nextRobSeat === undefined) {
        this.appointLandlord(room, player.seat);
        return room;
      }

      room.bid.currentSeat = nextRobSeat;
      room.message = "其他玩家可以选择抢地主。";

      return room;
    }

    if (action !== "rob" && action !== "no_rob") {
      throw new GameException("INVALID_BID", "当前只能选择抢地主或不抢。");
    }

    if (room.bid.robActedSeats.includes(player.seat)) {
      throw new GameException("BID_ALREADY_ACTED", "你已经在抢地主阶段操作过。");
    }

    room.bid.robActedSeats = [...room.bid.robActedSeats, player.seat];

    if (action === "rob") {
      room.bid.candidateSeat = player.seat;
      room.bid.robCount += 1;
      room.multiplier *= 2;
      player.lastAction = "抢地主";
      this.pushBid(room, player, "抢地主");
    } else {
      player.lastAction = "不抢";
      this.pushBid(room, player, "不抢");
    }

    const nextRobSeat = this.findNextRobSeat(room.bid, player.seat);
    if (nextRobSeat === undefined) {
      this.appointLandlord(room, room.bid.candidateSeat ?? player.seat);
      return room;
    }

    room.bid.currentSeat = nextRobSeat;
    room.message = "继续抢地主。";
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

  getRoomForTest(roomCode: string): InternalRoom | undefined {
    return this.rooms.get(roomCode);
  }

  buildViews(room: InternalRoom): Array<{ socketId: string; roomView: RoomView }> {
    return room.players
      .filter((player): player is InternalPlayer => Boolean(player))
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

  private resetToLobby(room: InternalRoom): void {
    room.phase = "lobby";
    room.bottomCards = [];
    room.landlordSeat = undefined;
    room.currentTurn = undefined;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.passCount = 0;
    room.multiplier = 1;
    room.result = undefined;
    room.message = "准备后开始下一局。";
    room.turnLog = [];

    for (const player of room.players) {
      if (player) {
        player.ready = false;
        player.hand = [];
        player.lastAction = undefined;
      }
    }
  }

  private startDeal(room: InternalRoom, message = "牌局开始，开始叫地主。"): void {
    const deck = shuffleDeck(createDeck(), this.rng);
    const { hands, bottomCards } = dealCards(deck);

    for (const seat of SEATS) {
      const player = this.requirePlayerBySeat(room, seat);
      player.hand = hands[seat];
      player.ready = false;
      player.lastAction = undefined;
    }

    room.phase = "bidding";
    room.bottomCards = bottomCards;
    room.landlordSeat = undefined;
    room.currentTurn = undefined;
    room.bid = {
      stage: "call",
      currentSeat: 0,
      callPassedSeats: [],
      robActedSeats: [],
      robCount: 0
    };
    room.lastPlay = undefined;
    room.passCount = 0;
    room.multiplier = 1;
    room.result = undefined;
    room.message = message;
    room.turnLog = [];
    this.pushSystem(room, message);
  }

  private appointLandlord(room: InternalRoom, landlordSeat: PlayerSeat): void {
    const landlord = this.requirePlayerBySeat(room, landlordSeat);
    landlord.hand = sortCards([...landlord.hand, ...room.bottomCards]);

    room.phase = "playing";
    room.landlordSeat = landlordSeat;
    room.currentTurn = landlordSeat;
    room.bid = undefined;
    room.lastPlay = undefined;
    room.passCount = 0;
    room.message = `${landlord.nickname} 成为地主，开始出牌。`;
    this.pushSystem(room, room.message);
  }

  private findNextRobSeat(bid: BidState, fromSeat: PlayerSeat): PlayerSeat | undefined {
    for (let offset = 1; offset <= SEATS.length; offset += 1) {
      const seat = ((fromSeat + offset) % SEATS.length) as PlayerSeat;

      if (bid.callPassedSeats.includes(seat) || bid.robActedSeats.includes(seat)) {
        continue;
      }

      if (bid.robCount === 0 && seat === bid.callerSeat) {
        continue;
      }

      return seat;
    }

    return undefined;
  }

  private finishRound(room: InternalRoom, winnerSeat: PlayerSeat): RoundResult {
    if (room.landlordSeat === undefined) {
      throw new GameException("NO_LANDLORD", "缺少地主信息。");
    }

    const result = calculateRoundResult(room.landlordSeat, winnerSeat, room.multiplier);
    room.phase = "ended";
    room.currentTurn = undefined;
    room.bid = undefined;
    room.result = result;
    room.message = `${this.requirePlayerBySeat(room, winnerSeat).nickname} 出完手牌，本局结束。`;
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
      bidStage: room.bid?.stage,
      bidCurrentSeat: room.bid?.currentSeat,
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
