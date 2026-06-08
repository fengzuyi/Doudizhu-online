import {
  analyzeDaBanZiHand,
  canBeatDaBanZiHand,
  dealDaBanZiHands,
  getDaBanZiPartnerCallOptions,
  isDaBanZiSpring,
  shuffleDaBanZiDeck,
  sortDaBanZiCards
} from "@doudizhu/shared";
import type {
  Card,
  DaBanZiLastPlay,
  DaBanZiMode,
  DaBanZiPartnerCallOption,
  DaBanZiPublicPlay,
  DaBanZiRoomView,
  DaBanZiRoundResult,
  Rank,
  Suit
} from "@doudizhu/shared";
import { GameException } from "./roomManager.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 4;
const SPADE_SEVEN_ID = "spades-7";

interface DaBanZiInternalPlayer {
  socketId: string;
  nickname: string;
  seat: number;
  joinedAt: number;
  connected: boolean;
  ready: boolean;
  hand: Card[];
  collectedCount: number;
  finishedRank?: number;
  lastAction?: string;
}

export interface DaBanZiInternalRoom {
  roomCode: string;
  phase: "lobby" | "bao" | "partner_call" | "playing" | "ended";
  mode: DaBanZiMode;
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  players: Array<DaBanZiInternalPlayer | null>;
  nextDealStartSeat?: number;
  dealStartSeat?: number;
  currentTurn?: number;
  bankerSeat?: number;
  partnerSeat?: number;
  partnerRevealed: boolean;
  baoCurrentSeat?: number;
  baoActedSeats: number[];
  baoSeat?: number;
  freeLeadRemaining: number;
  partnerCallOptions: DaBanZiPartnerCallOption[];
  calledPartnerCard?: DaBanZiPartnerCallOption;
  lastPlay?: DaBanZiLastPlay;
  trickCardCount: number;
  passCount: number;
  finishOrder: number[];
  turnLog: DaBanZiPublicPlay[];
  result?: DaBanZiRoundResult;
  message?: string;
}

export class DaBanZiRoomManager {
  private readonly rooms = new Map<string, DaBanZiInternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly rng: () => number = Math.random) {}

  createRoom(socketId: string, nickname: string): DaBanZiInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const now = Date.now();
    const roomCode = this.generateRoomCode();
    const player = this.createPlayer(socketId, normalizeNickname(nickname), 0);
    const room: DaBanZiInternalRoom = {
      roomCode,
      phase: "lobby",
      mode: "undecided",
      playerCount: 1,
      maxPlayers: MAX_PLAYERS,
      createdAt: now,
      updatedAt: now,
      players: Array.from({ length: MAX_PLAYERS }, (_, index) => (index === 0 ? player : null)),
      partnerRevealed: false,
      baoActedSeats: [],
      freeLeadRemaining: 0,
      partnerCallOptions: [],
      trickCardCount: 0,
      passCount: 0,
      finishOrder: [],
      turnLog: [],
      message: "打板子房间已创建，等待 4 人加入。"
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(socketId, roomCode);
    this.pushSystem(room, `${player.nickname} 创建了打板子房间。`);
    return room;
  }

  joinRoom(socketId: string, roomCode: string, nickname: string): DaBanZiInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const room = this.requireRoom(roomCode.trim().toUpperCase());
    if (room.phase !== "lobby") {
      throw new GameException("ROOM_STARTED", "这局打板子已经开始，请创建新房间。");
    }

    const seat = this.findOpenSeat(room);
    if (seat === undefined) {
      throw new GameException("ROOM_FULL", "打板子房间已满。");
    }

    const player = this.createPlayer(socketId, normalizeNickname(nickname), seat);
    room.players[seat] = player;
    this.socketToRoom.set(socketId, room.roomCode);
    this.syncPlayerCount(room);
    room.message = room.playerCount < MAX_PLAYERS ? "等待 4 人坐满后准备。" : "4 人已到齐，全员准备后开始。";
    this.pushSystem(room, `${player.nickname} 加入了打板子房间。`);
    this.touch(room);
    return room;
  }

  leaveRoom(socketId: string): DaBanZiInternalRoom | undefined {
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
      this.touch(room);
      if (room.playerCount === 0) {
        this.rooms.delete(room.roomCode);
        return undefined;
      }
      return room;
    }

    player.connected = false;
    player.ready = false;
    player.lastAction = "离线";
    room.phase = "ended";
    room.currentTurn = undefined;
    room.message = `${player.nickname} 离线，本局已结束。`;
    room.endedAt = Date.now();
    this.pushSystem(room, room.message);
    this.touch(room);
    return room;
  }

  disconnect(socketId: string): DaBanZiInternalRoom | undefined {
    return this.leaveRoom(socketId);
  }

  ready(socketId: string): DaBanZiInternalRoom {
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
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "ready",
      label: "准备"
    });

    const players = this.seatedPlayers(room);
    if (players.length === MAX_PLAYERS && players.every((candidate) => candidate.ready)) {
      this.startRound(room);
    } else {
      room.message = players.length < MAX_PLAYERS ? "等待 4 人坐满并准备。" : "等待其他玩家准备。";
    }

    this.touch(room);
    return room;
  }

  chooseBao(socketId: string, action: "bao" | "pass"): DaBanZiInternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "bao") {
      throw new GameException("NOT_BAO_PHASE", "当前不能选择包了。");
    }
    if (room.baoCurrentSeat !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你选择。");
    }
    if (room.baoActedSeats.includes(player.seat)) {
      throw new GameException("ALREADY_CHOSEN", "你已经选择过了。");
    }

    if (action === "bao") {
      this.startOneVsThree(room, player);
      this.touch(room);
      return room;
    }

    player.lastAction = "不包";
    room.baoActedSeats.push(player.seat);
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "pass_bao",
      label: "不包"
    });

    if (room.baoActedSeats.length >= MAX_PLAYERS) {
      this.startPartnerCall(room);
    } else {
      room.baoCurrentSeat = this.nextSeat(player.seat);
      room.message = `等待 ${this.requirePlayerBySeat(room, room.baoCurrentSeat).nickname} 选择是否包了。`;
    }

    this.touch(room);
    return room;
  }

  callPartner(socketId: string, rank: Rank, suit: Exclude<Suit, "joker">): DaBanZiInternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "partner_call") {
      throw new GameException("NOT_PARTNER_CALL", "当前不能叫队友。");
    }
    if (room.bankerSeat !== player.seat) {
      throw new GameException("NOT_BANKER", "只有黑桃 7 玩家可以叫队友。");
    }

    const option = room.partnerCallOptions.find((candidate) => candidate.rank === rank && candidate.suit === suit);
    if (!option) {
      throw new GameException("INVALID_PARTNER_CARD", "只能叫自己手里没有的可选牌。");
    }

    const partner = this.seatedPlayers(room).find((candidate) =>
      candidate.hand.some((card) => card.rank === rank && card.suit === suit)
    );
    if (!partner || partner.seat === player.seat) {
      throw new GameException("INVALID_PARTNER_CARD", "没有找到这张队友牌。");
    }

    room.mode = "two_vs_two";
    room.phase = "playing";
    room.currentTurn = player.seat;
    room.partnerSeat = partner.seat;
    room.calledPartnerCard = option;
    room.partnerRevealed = false;
    room.message = `${player.nickname} 叫了 ${option.label}，由黑桃 7 先出牌。`;
    player.lastAction = `叫 ${option.label}`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "call_partner",
      label: `叫队友 ${option.label}`
    });
    this.touch(room);
    return room;
  }

  playCards(socketId: string, cardIds: string[]): { room: DaBanZiInternalRoom; result?: DaBanZiRoundResult } {
    const { room, player } = this.requireTurn(socketId);
    const cards = this.takeCardsFromHand(player, cardIds);
    let analysis;
    try {
      analysis = analyzeDaBanZiHand(cards);
    } catch (error) {
      player.hand = sortDaBanZiCards([...player.hand, ...cards]);
      throw error;
    }

    if (!canBeatDaBanZiHand(analysis, room.lastPlay?.analysis)) {
      player.hand = sortDaBanZiCards([...player.hand, ...cards]);
      throw new GameException("PLAY_TOO_SMALL", "出的牌压不过上一手。");
    }

    const play: DaBanZiLastPlay = {
      seat: player.seat,
      nickname: player.nickname,
      cards,
      analysis
    };
    room.lastPlay = play;
    room.trickCardCount += cards.length;
    room.passCount = 0;
    player.lastAction = `出 ${analysis.label}`;
    this.maybeRevealPartner(room, cards);
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "play",
      label: `出 ${analysis.label}`,
      cards,
      handType: analysis.type
    });
    this.markFinishedIfNeeded(room, player);

    room.currentTurn = this.nextActiveSeat(room, player.seat);
    if (room.currentTurn === undefined) {
      this.collectTrick(room, player.seat);
      const result = this.tryFinishAfterPlay(room);
      this.touch(room);
      return { room, result };
    }

    room.message = `${player.nickname} 出了 ${analysis.label}。`;
    this.touch(room);
    return { room };
  }

  pass(socketId: string): DaBanZiInternalRoom {
    const { room, player } = this.requireTurn(socketId);
    if (!room.lastPlay) {
      throw new GameException("CANNOT_PASS", "当前无人出牌，必须主动出牌。");
    }

    player.lastAction = "不出";
    room.passCount += 1;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "pass",
      label: "不出"
    });

    const requiredPassCount = this.requiredPassCount(room);
    if (room.passCount >= requiredPassCount) {
      const collectorSeat = room.lastPlay.seat;
      const collector = this.requirePlayerBySeat(room, collectorSeat);
      this.collectTrick(room, collectorSeat);
      const result = this.tryFinishAfterPlay(room);
      if (result) {
        this.touch(room);
        return room;
      }
      room.currentTurn = collector.hand.length > 0 ? collectorSeat : this.nextActiveSeat(room, collectorSeat);
      room.message =
        collector.hand.length > 0
          ? `${collector.nickname} 收走本轮，可以主动出牌。`
          : `${collector.nickname} 收走本轮，下家主动出牌。`;
    } else {
      room.currentTurn = this.nextActiveSeat(room, player.seat);
      room.message = `${player.nickname} 不出。`;
    }

    this.touch(room);
    return room;
  }

  getRoomForSocket(socketId: string): DaBanZiInternalRoom | undefined {
    const roomCode = this.socketToRoom.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  reassignSocket(oldSocketId: string, newSocketId: string): DaBanZiInternalRoom | undefined {
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

  buildViews(room: DaBanZiInternalRoom): Array<{ socketId: string; roomView: DaBanZiRoomView }> {
    return room.players
      .filter((player): player is DaBanZiInternalPlayer => Boolean(player?.connected))
      .map((player) => ({
        socketId: player.socketId,
        roomView: this.buildViewForPlayer(room, player.socketId)
      }));
  }

  getRoomForTest(roomCode: string) {
    return this.rooms.get(roomCode);
  }

  private startRound(room: DaBanZiInternalRoom) {
    const players = this.seatedPlayers(room);
    if (players.length !== MAX_PLAYERS) {
      throw new GameException("NOT_ENOUGH_PLAYERS", "打板子需要 4 人才能开始。");
    }

    const startSeat = room.nextDealStartSeat ?? Math.floor(this.rng() * MAX_PLAYERS);
    const deck = shuffleDaBanZiDeck(this.rng);
    const hands = dealDaBanZiHands(deck, startSeat);

    room.phase = "bao";
    room.mode = "undecided";
    room.dealStartSeat = startSeat;
    room.currentTurn = undefined;
    room.bankerSeat = undefined;
    room.partnerSeat = undefined;
    room.partnerRevealed = false;
    room.baoCurrentSeat = startSeat;
    room.baoActedSeats = [];
    room.baoSeat = undefined;
    room.freeLeadRemaining = 0;
    room.partnerCallOptions = [];
    room.calledPartnerCard = undefined;
    room.lastPlay = undefined;
    room.trickCardCount = 0;
    room.passCount = 0;
    room.finishOrder = [];
    room.result = undefined;
    room.endedAt = undefined;
    room.turnLog = [];

    players.forEach((player) => {
      player.hand = hands[player.seat] ?? [];
      player.collectedCount = 0;
      player.finishedRank = undefined;
      player.ready = false;
      player.lastAction = undefined;
    });

    const springWinner = this.findSpringWinner(room, startSeat);
    if (springWinner) {
      this.finishSpring(room, springWinner);
      return;
    }

    room.message = `发牌完成，从 ${this.requirePlayerBySeat(room, startSeat).nickname} 开始选择是否包了。`;
    this.pushSystem(room, "本局开始，进入包了选择。");
  }

  private startOneVsThree(room: DaBanZiInternalRoom, player: DaBanZiInternalPlayer) {
    room.phase = "playing";
    room.mode = "one_vs_three";
    room.currentTurn = player.seat;
    room.baoSeat = player.seat;
    room.freeLeadRemaining = 0;
    room.lastPlay = undefined;
    room.trickCardCount = 0;
    room.passCount = 0;
    player.lastAction = "包了";
    room.message = `${player.nickname} 包了，由其先出牌。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "bao",
      label: "包了"
    });
  }

  private startPartnerCall(room: DaBanZiInternalRoom) {
    const banker = this.seatedPlayers(room).find((player) => player.hand.some((card) => card.id === SPADE_SEVEN_ID));
    if (!banker) {
      throw new GameException("NO_BANKER", "没有找到黑桃 7 玩家。");
    }

    room.phase = "partner_call";
    room.mode = "undecided";
    room.bankerSeat = banker.seat;
    room.currentTurn = banker.seat;
    room.baoCurrentSeat = undefined;
    room.partnerCallOptions = getDaBanZiPartnerCallOptions(banker.hand);
    banker.lastAction = "等待叫队友";
    room.message = `${banker.nickname} 持有黑桃 7，请选择队友牌。`;
    this.pushSystem(room, `${banker.nickname} 是黑桃 7 玩家，开始叫队友。`);
  }

  private findSpringWinner(room: DaBanZiInternalRoom, startSeat: number) {
    for (let offset = 0; offset < MAX_PLAYERS; offset += 1) {
      const player = room.players[(startSeat + offset) % MAX_PLAYERS];
      if (player && isDaBanZiSpring(player.hand)) {
        return player;
      }
    }
    return undefined;
  }

  private finishSpring(room: DaBanZiInternalRoom, player: DaBanZiInternalPlayer) {
    room.phase = "ended";
    room.mode = "spring";
    room.currentTurn = undefined;
    room.endedAt = Date.now();
    room.message = `${player.nickname} 春天，直接获胜。`;
    room.result = this.makeResult(room, {
      winnerLabel: `${player.nickname} 春天获胜`,
      winnerSeats: [player.seat],
      reason: "春天",
      teamCollectedCounts: { [player.nickname]: 0 }
    });
    this.pushSystem(room, room.message);
  }

  private tryFinishAfterPlay(room: DaBanZiInternalRoom): DaBanZiRoundResult | undefined {
    if (room.mode === "one_vs_three") {
      const baoSeat = room.baoSeat;
      if (baoSeat === undefined) {
        return undefined;
      }
      const baoPlayer = this.requirePlayerBySeat(room, baoSeat);
      if (baoPlayer.hand.length === 0) {
        return this.finishOneVsThree(room, "solo", "包了玩家先出完，包了方获胜。");
      }
      const defender = this.seatedPlayers(room).find((player) => player.seat !== baoSeat && player.hand.length === 0);
      if (defender) {
        return this.finishOneVsThree(room, "defenders", `${defender.nickname} 先出完，防守方获胜。`);
      }
      return undefined;
    }

    if (room.mode === "two_vs_two" && room.bankerSeat !== undefined && room.partnerSeat !== undefined) {
      const bankerTeam = [room.bankerSeat, room.partnerSeat];
      const opponentTeam = this.seatedPlayers(room)
        .map((player) => player.seat)
        .filter((seat) => !bankerTeam.includes(seat));
      if (bankerTeam.every((seat) => this.requirePlayerBySeat(room, seat).hand.length === 0)) {
        return this.finishTwoVsTwo(room, "庄家队出完，进入收牌数结算。");
      }
      if (opponentTeam.every((seat) => this.requirePlayerBySeat(room, seat).hand.length === 0)) {
        return this.finishTwoVsTwo(room, "闲家队出完，进入收牌数结算。");
      }
    }

    return undefined;
  }

  private finishOneVsThree(room: DaBanZiInternalRoom, winner: "solo" | "defenders", reason: string) {
    this.awardOpenTrick(room);
    const baoSeat = room.baoSeat;
    const baoPlayer = baoSeat === undefined ? undefined : this.requirePlayerBySeat(room, baoSeat);
    const defenderPlayers = this.seatedPlayers(room).filter((player) => player.seat !== baoSeat);
    const defenderLabel = defenderPlayers.map((player) => player.nickname).join(" / ");
    const winnerSeats =
      winner === "solo"
        ? [baoSeat ?? -1].filter((seat) => seat >= 0)
        : defenderPlayers.map((player) => player.seat);
    const result = this.makeResult(room, {
      winnerLabel: winner === "solo" ? `${baoPlayer?.nickname ?? "包了玩家"} 获胜` : `${defenderLabel} 获胜`,
      winnerSeats,
      reason,
      teamCollectedCounts: {
        [baoPlayer?.nickname ?? "包了玩家"]: baoPlayer?.collectedCount ?? 0,
        [defenderLabel]: defenderPlayers.reduce((sum, player) => sum + player.collectedCount, 0)
      }
    });
    room.phase = "ended";
    room.currentTurn = undefined;
    room.endedAt = Date.now();
    room.result = result;
    room.message = reason;
    this.pushSystem(room, reason);
    return result;
  }

  private finishTwoVsTwo(room: DaBanZiInternalRoom, reason: string) {
    this.awardOpenTrick(room);
    const bankerSeat = room.bankerSeat;
    const partnerSeat = room.partnerSeat;
    if (bankerSeat === undefined || partnerSeat === undefined) {
      throw new GameException("TEAM_NOT_READY", "队伍信息不完整。");
    }

    const bankerTeam = [bankerSeat, partnerSeat];
    const bankerTeamLabel = this.teamLabel(room, bankerTeam);
    const opponentSeats = this.seatedPlayers(room)
      .map((player) => player.seat)
      .filter((seat) => !bankerTeam.includes(seat));
    const opponentTeamLabel = this.teamLabel(room, opponentSeats);
    const finalOrder = this.finalFinishOrder(room);
    const teamCollectedCounts: Record<string, number> = { [bankerTeamLabel]: 0, [opponentTeamLabel]: 0 };
    const firstSeat = finalOrder[0];
    const fourthSeat = finalOrder[3];

    finalOrder.forEach((seat, index) => {
      const player = this.requirePlayerBySeat(room, seat);
      const teamKey = bankerTeam.includes(seat) ? bankerTeamLabel : opponentTeamLabel;
      if (index < 3) {
        teamCollectedCounts[teamKey] += player.collectedCount;
        return;
      }

      const teammate = bankerTeam.includes(seat)
        ? bankerTeam.find((candidate) => candidate !== seat)
        : this.seatedPlayers(room)
            .map((candidate) => candidate.seat)
            .filter((candidateSeat) => !bankerTeam.includes(candidateSeat) && candidateSeat !== seat)[0];
      if (seat === fourthSeat && teammate === firstSeat) {
        teamCollectedCounts[teamKey] += player.collectedCount;
      }
    });

    let winnerLabel = "平局";
    let winnerSeats: number[] = [];
    if (teamCollectedCounts[bankerTeamLabel] > teamCollectedCounts[opponentTeamLabel]) {
      winnerLabel = `${bankerTeamLabel} 获胜`;
      winnerSeats = bankerTeam;
    } else if (teamCollectedCounts[opponentTeamLabel] > teamCollectedCounts[bankerTeamLabel]) {
      winnerLabel = `${opponentTeamLabel} 获胜`;
      winnerSeats = opponentSeats;
    }

    const result = this.makeResult(room, {
      winnerLabel,
      winnerSeats,
      reason,
      teamCollectedCounts,
      finishOrder: finalOrder
    });
    room.phase = "ended";
    room.currentTurn = undefined;
    room.endedAt = Date.now();
    room.result = result;
    room.message = `${reason} ${winnerLabel}。`;
    this.pushSystem(room, room.message);
    return result;
  }

  private makeResult(
    room: DaBanZiInternalRoom,
    input: {
      winnerLabel: string;
      winnerSeats: number[];
      reason: string;
      teamCollectedCounts: Record<string, number>;
      finishOrder?: number[];
    }
  ): DaBanZiRoundResult {
    const collectedCounts: Record<number, number> = {};
    for (const player of this.seatedPlayers(room)) {
      collectedCounts[player.seat] = player.collectedCount;
    }

    return {
      mode: room.mode,
      winnerLabel: input.winnerLabel,
      winnerSeats: input.winnerSeats,
      reason: input.reason,
      collectedCounts,
      teamCollectedCounts: input.teamCollectedCounts,
      finishOrder: input.finishOrder ?? this.finalFinishOrder(room),
      bankerSeat: room.bankerSeat,
      partnerSeat: room.partnerSeat,
      baoSeat: room.baoSeat,
      calledPartnerCard: room.calledPartnerCard
    };
  }

  private requireTurn(socketId: string) {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "playing") {
      throw new GameException("NOT_PLAYING", "当前不能出牌。");
    }
    if (room.currentTurn !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你操作。");
    }
    if (player.hand.length === 0) {
      throw new GameException("NO_CARDS", "你已经出完牌。");
    }

    return { room, player };
  }

  private takeCardsFromHand(player: DaBanZiInternalPlayer, cardIds: string[]) {
    const uniqueIds = [...new Set(cardIds)];
    if (uniqueIds.length === 0 || uniqueIds.length !== cardIds.length) {
      throw new GameException("INVALID_CARDS", "请选择有效手牌。");
    }

    const selected: Card[] = [];
    const remaining = [...player.hand];
    for (const cardId of uniqueIds) {
      const index = remaining.findIndex((card) => card.id === cardId);
      if (index < 0) {
        throw new GameException("CARD_NOT_IN_HAND", "选择的牌不在你的手牌中。");
      }
      selected.push(remaining[index]);
      remaining.splice(index, 1);
    }

    player.hand = sortDaBanZiCards(remaining);
    return sortDaBanZiCards(selected);
  }

  private maybeRevealPartner(room: DaBanZiInternalRoom, cards: Card[]) {
    if (!room.calledPartnerCard || room.partnerRevealed) {
      return;
    }

    const revealed = cards.some((card) => card.rank === room.calledPartnerCard?.rank && card.suit === room.calledPartnerCard?.suit);
    if (revealed) {
      room.partnerRevealed = true;
      this.pushSystem(room, `${room.calledPartnerCard.label} 已打出，队友身份公开。`);
    }
  }

  private markFinishedIfNeeded(room: DaBanZiInternalRoom, player: DaBanZiInternalPlayer) {
    if (player.hand.length > 0 || player.finishedRank !== undefined) {
      return;
    }

    player.finishedRank = room.finishOrder.length + 1;
    player.lastAction = `第 ${player.finishedRank} 名出完`;
    room.finishOrder.push(player.seat);
    if (player.finishedRank === 1) {
      room.nextDealStartSeat = player.seat;
    }
    this.pushSystem(room, `${player.nickname} 第 ${player.finishedRank} 名出完。`);
  }

  private collectTrick(room: DaBanZiInternalRoom, seat: number) {
    const collector = this.requirePlayerBySeat(room, seat);
    const count = room.trickCardCount;
    collector.collectedCount += count;
    collector.lastAction = `收走 ${count} 张`;
    this.pushLog(room, {
      seat: collector.seat,
      nickname: collector.nickname,
      action: "collect",
      label: `收走 ${count} 张`
    });
    room.lastPlay = undefined;
    room.trickCardCount = 0;
    room.passCount = 0;
  }

  private awardOpenTrick(room: DaBanZiInternalRoom) {
    if (room.lastPlay && room.trickCardCount > 0) {
      this.collectTrick(room, room.lastPlay.seat);
    }
  }

  private activePlayers(room: DaBanZiInternalRoom) {
    return this.seatedPlayers(room).filter((player) => player.connected && player.hand.length > 0);
  }

  private requiredPassCount(room: DaBanZiInternalRoom) {
    if (!room.lastPlay) {
      return 0;
    }

    return this.activePlayers(room).filter((player) => player.seat !== room.lastPlay?.seat).length;
  }

  private teamLabel(room: DaBanZiInternalRoom, seats: number[]) {
    return seats.map((seat) => this.requirePlayerBySeat(room, seat).nickname).join(" / ");
  }

  private nextActiveSeat(room: DaBanZiInternalRoom, fromSeat: number) {
    for (let step = 1; step <= MAX_PLAYERS; step += 1) {
      const seat = (fromSeat + step) % MAX_PLAYERS;
      const player = room.players[seat];
      if (player?.connected && player.hand.length > 0) {
        return seat;
      }
    }
    return undefined;
  }

  private nextSeat(fromSeat: number) {
    return (fromSeat + 1) % MAX_PLAYERS;
  }

  private finalFinishOrder(room: DaBanZiInternalRoom) {
    const finished = [...room.finishOrder];
    const remaining = this.seatedPlayers(room)
      .filter((player) => !finished.includes(player.seat))
      .sort((a, b) => a.hand.length - b.hand.length || a.seat - b.seat)
      .map((player) => player.seat);
    return [...finished, ...remaining].slice(0, MAX_PLAYERS);
  }

  private buildViewForPlayer(room: DaBanZiInternalRoom, socketId: string): DaBanZiRoomView {
    const self = this.requirePlayer(room, socketId);
    const partnerVisible = room.phase === "ended" || room.partnerRevealed || self.seat === room.partnerSeat;
    return {
      roomCode: room.roomCode,
      phase: room.phase,
      mode: room.mode,
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      selfSeat: self.seat,
      players: this.seatedPlayers(room).map((player) => ({
        seat: player.seat,
        nickname: player.nickname,
        connected: player.connected,
        ready: player.ready,
        cardCount: player.hand.length,
        collectedCount: player.collectedCount,
        finishedRank: player.finishedRank,
        hand: player.socketId === socketId || room.phase === "ended" ? player.hand : undefined,
        role: this.roleFor(room, self.seat, player.seat, partnerVisible),
        lastAction: player.lastAction
      })),
      currentTurn: room.currentTurn,
      dealStartSeat: room.dealStartSeat,
      bankerSeat: room.bankerSeat,
      partnerSeat: partnerVisible ? room.partnerSeat : undefined,
      partnerRevealed: room.partnerRevealed || room.phase === "ended",
      baoCurrentSeat: room.baoCurrentSeat,
      baoSeat: room.baoSeat,
      freeLeadRemaining: room.freeLeadRemaining,
      partnerCallOptions: room.phase === "partner_call" && self.seat === room.bankerSeat ? room.partnerCallOptions : [],
      calledPartnerCard: room.calledPartnerCard,
      lastPlay: room.lastPlay,
      trickCardCount: room.trickCardCount,
      passCount: room.passCount,
      finishOrder: room.finishOrder,
      turnLog: room.turnLog.slice(-30),
      result: room.result,
      message: room.message
    };
  }

  private roleFor(
    room: DaBanZiInternalRoom,
    viewerSeat: number,
    playerSeat: number,
    partnerVisible: boolean
  ): DaBanZiRoomView["players"][number]["role"] {
    if (room.mode === "one_vs_three") {
      return playerSeat === room.baoSeat ? "solo" : "defender";
    }
    if (room.mode !== "two_vs_two") {
      return "unknown";
    }
    if (playerSeat === room.bankerSeat) {
      return "banker";
    }
    if (playerSeat === room.partnerSeat && (partnerVisible || viewerSeat === playerSeat)) {
      return "partner";
    }
    if (partnerVisible) {
      return "opponent";
    }
    return "unknown";
  }

  private resetToLobby(room: DaBanZiInternalRoom) {
    room.phase = "lobby";
    room.mode = "undecided";
    room.currentTurn = undefined;
    room.bankerSeat = undefined;
    room.partnerSeat = undefined;
    room.partnerRevealed = false;
    room.baoCurrentSeat = undefined;
    room.baoActedSeats = [];
    room.baoSeat = undefined;
    room.freeLeadRemaining = 0;
    room.partnerCallOptions = [];
    room.calledPartnerCard = undefined;
    room.lastPlay = undefined;
    room.trickCardCount = 0;
    room.passCount = 0;
    room.finishOrder = [];
    room.turnLog = [];
    room.result = undefined;
    room.endedAt = undefined;
    room.message = "上一局已结束，准备后可再来一局。";
    room.players = room.players.map((player) => {
      if (!player?.connected) {
        return null;
      }
      player.ready = false;
      player.hand = [];
      player.collectedCount = 0;
      player.finishedRank = undefined;
      player.lastAction = undefined;
      return player;
    });
    this.syncPlayerCount(room);
    this.touch(room);
  }

  private requireRoomForSocket(socketId: string) {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      throw new GameException("NO_ROOM", "你还没有加入打板子房间。");
    }
    return room;
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new GameException("ROOM_NOT_FOUND", "没有找到这个打板子房间。");
    }
    return room;
  }

  private requirePlayer(room: DaBanZiInternalRoom, socketId: string) {
    const player = room.players.find((candidate) => candidate?.socketId === socketId);
    if (!player) {
      throw new GameException("NO_PLAYER", "你不在这个打板子房间里。");
    }
    return player;
  }

  private requirePlayerBySeat(room: DaBanZiInternalRoom, seat: number) {
    const player = room.players[seat];
    if (!player) {
      throw new GameException("NO_PLAYER", "座位上没有玩家。");
    }
    return player;
  }

  private seatedPlayers(room: DaBanZiInternalRoom) {
    return room.players.filter((player): player is DaBanZiInternalPlayer => Boolean(player));
  }

  private findOpenSeat(room: DaBanZiInternalRoom) {
    const seat = room.players.findIndex((player) => player === null);
    return seat >= 0 ? seat : undefined;
  }

  private syncPlayerCount(room: DaBanZiInternalRoom) {
    room.playerCount = this.seatedPlayers(room).length;
  }

  private createPlayer(socketId: string, nickname: string, seat: number): DaBanZiInternalPlayer {
    return {
      socketId,
      nickname,
      seat,
      joinedAt: Date.now(),
      connected: true,
      ready: false,
      hand: [],
      collectedCount: 0
    };
  }

  private pushSystem(room: DaBanZiInternalRoom, label: string) {
    this.pushLog(room, { action: "system", label });
  }

  private pushLog(room: DaBanZiInternalRoom, event: Omit<DaBanZiPublicPlay, "at">) {
    room.turnLog.push({ ...event, at: Date.now() });
    if (room.turnLog.length > 60) {
      room.turnLog.splice(0, room.turnLog.length - 60);
    }
  }

  private touch(room: DaBanZiInternalRoom) {
    room.updatedAt = Date.now();
  }

  private generateRoomCode(): string {
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => ROOM_CODE_ALPHABET[Math.floor(this.rng() * ROOM_CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    return code;
  }
}

function normalizeNickname(nickname: string): string {
  const normalized = nickname.trim().slice(0, 16);
  return normalized.length > 0 ? normalized : "玩家";
}
