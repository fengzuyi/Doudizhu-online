import {
  analyzeZjhHand,
  compareZjhHands,
  dealZjhHands,
  getZjhBetCost,
  getZjhBetTier,
  shuffleZjhDeck
} from "@doudizhu/shared";
import type { Card, ZjhCompareReveal, ZjhPublicAction, ZjhRoomView, ZjhRoundResult } from "@doudizhu/shared";
import { GameException } from "./roomManager.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 12;
const DEFAULT_SCORE = 1000;
const BASE_ANTE = 1;
const MAX_BET = 2;
const MAX_ROUNDS = 20;

interface ZjhInternalPlayer {
  socketId: string;
  nickname: string;
  seat: number;
  joinedAt: number;
  connected: boolean;
  ready: boolean;
  hand: Card[];
  seen: boolean;
  folded: boolean;
  score: number;
  invested: number;
  lastAction?: string;
}

export interface ZjhInternalRoom {
  roomCode: string;
  phase: "lobby" | "playing" | "ended";
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  players: Array<ZjhInternalPlayer | null>;
  bankerSeat?: number;
  currentTurn?: number;
  pot: number;
  currentBet: number;
  round: number;
  maxRounds: number;
  baseAnte: number;
  minRaise: number;
  maxBet: number;
  turnCounter: number;
  turnLog: ZjhPublicAction[];
  result?: ZjhRoundResult;
  message?: string;
}

export class ZjhRoomManager {
  private readonly rooms = new Map<string, ZjhInternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly rng: () => number = Math.random) {}

  createRoom(socketId: string, nickname: string, maxPlayers = DEFAULT_MAX_PLAYERS): ZjhInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个炸金花房间里。");
    }

    const normalizedMaxPlayers = normalizeMaxPlayers(maxPlayers);
    const now = Date.now();
    const roomCode = this.generateRoomCode();
    const player = this.createPlayer(socketId, normalizeNickname(nickname), 0);
    const room: ZjhInternalRoom = {
      roomCode,
      phase: "lobby",
      playerCount: 1,
      maxPlayers: normalizedMaxPlayers,
      createdAt: now,
      updatedAt: now,
      players: Array.from({ length: normalizedMaxPlayers }, (_, index) => (index === 0 ? player : null)),
      pot: 0,
      currentBet: BASE_ANTE,
      round: 0,
      maxRounds: MAX_ROUNDS,
      baseAnte: BASE_ANTE,
      minRaise: BASE_ANTE,
      maxBet: MAX_BET,
      turnCounter: 0,
      turnLog: [],
      message: "炸金花房间已创建，等待玩家加入并准备。"
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(socketId, roomCode);
    this.pushSystem(room, `${player.nickname} 创建了炸金花房间。`);

    return room;
  }

  joinRoom(socketId: string, roomCode: string, nickname: string): ZjhInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const room = this.requireRoom(roomCode.trim().toUpperCase());
    if (room.phase !== "lobby") {
      throw new GameException("ROOM_STARTED", "这局炸金花已经开始，请创建新房间。");
    }

    const seat = this.findOpenSeat(room);
    if (seat === undefined) {
      throw new GameException("ROOM_FULL", "炸金花房间已满。");
    }

    const player = this.createPlayer(socketId, normalizeNickname(nickname), seat);
    room.players[seat] = player;
    this.socketToRoom.set(socketId, room.roomCode);
    this.syncPlayerCount(room);
    room.message = "所有在座玩家准备后开始本局。";
    this.pushSystem(room, `${player.nickname} 加入了炸金花房间。`);
    this.touch(room);

    return room;
  }

  leaveRoom(socketId: string): ZjhInternalRoom | undefined {
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
    player.folded = true;
    player.ready = false;
    player.lastAction = "离线弃牌";
    this.pushSystem(room, `${player.nickname} 离线，已自动弃牌。`);
    this.syncPlayerCount(room);

    if (this.activePlayers(room).length <= 1) {
      this.finishRound(room, "只剩一名玩家，本局结束。");
    } else if (room.currentTurn === player.seat) {
      this.advanceTurn(room, player.seat);
    }

    this.touch(room);
    return room;
  }

  disconnect(socketId: string): ZjhInternalRoom | undefined {
    return this.leaveRoom(socketId);
  }

  ready(socketId: string): ZjhInternalRoom {
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
    this.touch(room);

    const players = this.seatedPlayers(room);
    if (players.length >= MIN_PLAYERS && players.every((candidate) => candidate.ready)) {
      this.startRound(room);
    } else {
      room.message = players.length < MIN_PLAYERS ? "至少 2 名玩家准备后开始。" : "等待其他玩家准备。";
    }

    return room;
  }

  seeCards(socketId: string): ZjhInternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "playing") {
      throw new GameException("NOT_PLAYING", "当前还没有开始下注。");
    }
    if (player.folded) {
      throw new GameException("PLAYER_FOLDED", "你已经弃牌。");
    }
    if (player.seen) {
      throw new GameException("ALREADY_SEEN", "你已经看过牌。");
    }

    player.seen = true;
    player.lastAction = "看牌";
    room.message = `${player.nickname} 已看牌。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "see",
      label: "看牌"
    });
    this.touch(room);

    return room;
  }

  call(socketId: string): ZjhInternalRoom {
    const { room, player } = this.requireTurn(socketId);
    const cost = getZjhBetCost(room.currentBet, player.seen);
    this.takeChips(room, player, cost);
    player.lastAction = `跟注 ${cost}`;
    room.message = `${player.nickname} 跟注 ${cost} 分。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "call",
      label: player.lastAction,
      amount: cost
    });
    this.advanceTurn(room, player.seat);
    this.touch(room);

    return room;
  }

  raise(socketId: string, amount: number): ZjhInternalRoom {
    const { room, player } = this.requireTurn(socketId);
    const raiseTo = Math.floor(amount);
    const nextBet = getZjhBetTier(raiseTo, player.seen);
    if (nextBet === undefined) {
      throw new GameException(
        "INVALID_BET_AMOUNT",
        player.seen ? "看牌玩家只能下注 1、2、5。" : "闷牌玩家只能下注 1、2。"
      );
    }
    if (nextBet <= room.currentBet) {
      throw new GameException("RAISE_TOO_SMALL", "加注必须大于当前注。");
    }
    if (nextBet > room.maxBet) {
      throw new GameException("RAISE_TOO_BIG", `单轮闷牌基准注不能超过 ${room.maxBet}。`);
    }

    room.currentBet = nextBet;
    const cost = player.seen ? raiseTo : nextBet;
    this.takeChips(room, player, cost);
    player.lastAction = `加注 ${cost}`;
    room.message = `${player.nickname} 加注 ${cost} 分。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "raise",
      label: player.lastAction,
      amount: cost
    });
    this.advanceTurn(room, player.seat);
    this.touch(room);

    return room;
  }

  fold(socketId: string): ZjhInternalRoom {
    const { room, player } = this.requireTurn(socketId);
    player.folded = true;
    player.lastAction = "弃牌";
    room.message = `${player.nickname} 弃牌。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "fold",
      label: "弃牌"
    });

    if (this.activePlayers(room).length <= 1) {
      this.finishRound(room, "只剩一名玩家，本局结束。");
    } else {
      this.advanceTurn(room, player.seat);
    }
    this.touch(room);

    return room;
  }

  compare(socketId: string, targetSeat: number): { room: ZjhInternalRoom; reveal: ZjhCompareReveal } {
    const { room, player } = this.requireTurn(socketId);
    const activePlayers = this.activePlayers(room);
    if (room.round <= 1) {
      throw new GameException("COMPARE_TOO_EARLY", "第一轮结束前不能比牌。");
    }
    if (!player.seen && activePlayers.length > 2) {
      throw new GameException("COMPARE_NEEDS_SEEN_HAND", "未看牌玩家只能在只剩两人时主动比牌。");
    }

    const target = room.players[targetSeat];
    if (!target || target.folded || !target.connected) {
      throw new GameException("INVALID_COMPARE_TARGET", "请选择仍在游戏中的玩家比牌。");
    }
    if (target.seat === player.seat) {
      throw new GameException("INVALID_COMPARE_TARGET", "不能和自己比牌。");
    }

    const cost = getZjhBetCost(room.currentBet, player.seen) * 2;
    this.takeChips(room, player, cost);
    const targetAnalysis = analyzeZjhHand(target.hand);
    const reveal: ZjhCompareReveal = {
      targetSeat: target.seat,
      targetNickname: target.nickname,
      cards: target.hand,
      handLabel: targetAnalysis.label,
      at: Date.now()
    };
    const comparison = compareZjhHands(player.hand, target.hand);
    const loser = comparison > 0 ? target : player;
    loser.folded = true;
    loser.lastAction = "比牌失败";
    player.lastAction = `比牌 ${target.nickname}`;
    room.message =
      comparison > 0
        ? `${player.nickname} 比牌胜出，${target.nickname} 弃牌。`
        : `${player.nickname} 比牌失败，已弃牌。`;
    this.pushLog(room, {
      seat: player.seat,
      nickname: player.nickname,
      action: "compare",
      label: room.message,
      amount: cost
    });

    if (this.activePlayers(room).length <= 1) {
      this.finishRound(room, "只剩一名玩家，本局结束。");
    } else {
      this.advanceTurn(room, player.seat);
    }
    this.touch(room);

    return { room, reveal };
  }

  getRoomForSocket(socketId: string): ZjhInternalRoom | undefined {
    const roomCode = this.socketToRoom.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  reassignSocket(oldSocketId: string, newSocketId: string): ZjhInternalRoom | undefined {
    const room = this.getRoomForSocket(oldSocketId);
    if (!room) {
      return undefined;
    }
    if (this.socketToRoom.has(newSocketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个炸金花房间里。");
    }

    const player = this.requirePlayer(room, oldSocketId);
    this.socketToRoom.delete(oldSocketId);
    player.socketId = newSocketId;
    player.connected = true;
    this.socketToRoom.set(newSocketId, room.roomCode);
    this.touch(room);

    return room;
  }

  buildViews(room: ZjhInternalRoom): Array<{ socketId: string; roomView: ZjhRoomView }> {
    return room.players
      .filter((player): player is ZjhInternalPlayer => Boolean(player?.connected))
      .map((player) => ({
        socketId: player.socketId,
        roomView: this.buildViewForPlayer(room, player.socketId)
      }));
  }

  getRoomForTest(roomCode: string) {
    return this.rooms.get(roomCode);
  }

  private startRound(room: ZjhInternalRoom) {
    const players = this.seatedPlayers(room);
    if (players.length < MIN_PLAYERS) {
      throw new GameException("NOT_ENOUGH_PLAYERS", "至少 2 名玩家才能开始炸金花。");
    }

    const deck = shuffleZjhDeck(this.rng);
    const hands = dealZjhHands(deck, players.length);
    const banker = players[Math.floor(this.rng() * players.length)] ?? players[0];
    if (!banker) {
      throw new GameException("NOT_ENOUGH_PLAYERS", "至少 2 名玩家才能开始炸金花。");
    }

    room.phase = "playing";
    room.bankerSeat = banker.seat;
    room.currentTurn = banker.seat;
    room.pot = 0;
    room.currentBet = BASE_ANTE;
    room.round = 1;
    room.turnCounter = 0;
    room.result = undefined;
    room.endedAt = undefined;
    room.turnLog = [];

    players.forEach((player, index) => {
      player.hand = hands[index] ?? [];
      player.seen = false;
      player.folded = false;
      player.ready = false;
      player.invested = BASE_ANTE;
      player.score -= BASE_ANTE;
      player.lastAction = "底注";
      room.pot += BASE_ANTE;
    });

    room.message = `${banker.nickname} 先手，开始下注。`;
    this.pushSystem(room, `本局开始，底注 ${BASE_ANTE} 分。`);
    this.touch(room);
  }

  private finishRound(room: ZjhInternalRoom, message: string) {
    const candidates = this.activePlayers(room);
    let winner = candidates[0];
    if (!winner) {
      throw new GameException("NO_WINNER", "本局没有可结算玩家。");
    }

    if (candidates.length > 1) {
      for (const player of candidates.slice(1)) {
        if (compareZjhHands(player.hand, winner.hand) > 0) {
          winner = player;
        }
      }
    }

    winner.score += room.pot;
    const scores: Record<number, number> = {};
    const hands = this.seatedPlayers(room).map((player) => {
      const analysis = analyzeZjhHand(player.hand);
      scores[player.seat] = player.seat === winner.seat ? room.pot - player.invested : -player.invested;
      return {
        seat: player.seat,
        nickname: player.nickname,
        cards: player.hand,
        handLabel: analysis.label,
        folded: player.folded
      };
    });

    room.phase = "ended";
    room.endedAt = Date.now();
    room.currentTurn = undefined;
    room.result = {
      winnerSeat: winner.seat,
      winnerNickname: winner.nickname,
      pot: room.pot,
      scores,
      hands
    };
    const settlementMessage = message.replace(/^只剩一名玩家，?/, "");
    room.message = `${settlementMessage} ${winner.nickname} 赢得 ${room.pot} 分。`;
    this.pushSystem(room, room.message);
  }

  private advanceTurn(room: ZjhInternalRoom, fromSeat: number) {
    if (room.phase !== "playing") {
      return;
    }

    const activePlayers = this.activePlayers(room);
    if (activePlayers.length <= 1) {
      this.finishRound(room, "只剩一名玩家，本局结束。");
      return;
    }

    room.turnCounter += 1;
    if (room.turnCounter >= activePlayers.length) {
      room.turnCounter = 0;
      room.round += 1;
      if (room.round > room.maxRounds) {
        this.finishRound(room, "达到最大轮数，自动比牌。");
        return;
      }
    }

    for (let step = 1; step <= room.maxPlayers; step += 1) {
      const nextSeat = (fromSeat + step) % room.maxPlayers;
      const nextPlayer = room.players[nextSeat];
      if (nextPlayer && nextPlayer.connected && !nextPlayer.folded) {
        room.currentTurn = nextSeat;
        return;
      }
    }
  }

  private buildViewForPlayer(room: ZjhInternalRoom, socketId: string): ZjhRoomView {
    const self = this.requirePlayer(room, socketId);
    return {
      roomCode: room.roomCode,
      phase: room.phase,
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      selfSeat: self.seat,
      players: room.players
        .filter((player): player is ZjhInternalPlayer => Boolean(player))
        .map((player) => {
          const handVisible = room.phase === "ended" || (player.socketId === socketId && player.seen);
          const analysis = handVisible && player.hand.length === 3 ? analyzeZjhHand(player.hand) : undefined;

          return {
            seat: player.seat,
            nickname: player.nickname,
            connected: player.connected,
            ready: player.ready,
            folded: player.folded,
            seen: player.seen,
            cardCount: player.hand.length,
            score: player.score,
            invested: player.invested,
            hand: handVisible ? player.hand : undefined,
            handLabel: analysis?.label,
            lastAction: player.lastAction
          };
        }),
      currentTurn: room.currentTurn,
      bankerSeat: room.bankerSeat,
      pot: room.pot,
      currentBet: room.currentBet,
      round: room.round,
      maxRounds: room.maxRounds,
      baseAnte: room.baseAnte,
      minRaise: room.minRaise,
      maxBet: room.maxBet,
      turnLog: room.turnLog.slice(-20),
      result: room.result,
      message: room.message
    };
  }

  private resetToLobby(room: ZjhInternalRoom) {
    room.phase = "lobby";
    room.bankerSeat = undefined;
    room.currentTurn = undefined;
    room.pot = 0;
    room.currentBet = BASE_ANTE;
    room.round = 0;
    room.turnCounter = 0;
    room.result = undefined;
    room.endedAt = undefined;
    room.turnLog = [];
    room.message = "上一局已结束，准备后可再来一局。";

    room.players = room.players.map((player) => {
      if (!player?.connected) {
        return null;
      }
      player.ready = false;
      player.hand = [];
      player.seen = false;
      player.folded = false;
      player.invested = 0;
      player.lastAction = undefined;
      return player;
    });
    this.syncPlayerCount(room);
    this.touch(room);
  }

  private requireTurn(socketId: string) {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "playing") {
      throw new GameException("NOT_PLAYING", "当前还没有开始下注。");
    }
    if (player.folded) {
      throw new GameException("PLAYER_FOLDED", "你已经弃牌。");
    }
    if (room.currentTurn !== player.seat) {
      throw new GameException("NOT_YOUR_TURN", "还没轮到你操作。");
    }

    return { room, player };
  }

  private takeChips(room: ZjhInternalRoom, player: ZjhInternalPlayer, amount: number) {
    if (player.score < amount) {
      throw new GameException("INSUFFICIENT_SCORE", "积分不足，无法继续下注。");
    }

    player.score -= amount;
    player.invested += amount;
    room.pot += amount;
  }

  private requireRoomForSocket(socketId: string) {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      throw new GameException("NO_ROOM", "你还没有加入炸金花房间。");
    }
    return room;
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new GameException("ROOM_NOT_FOUND", "没有找到这个炸金花房间。");
    }
    return room;
  }

  private requirePlayer(room: ZjhInternalRoom, socketId: string) {
    const player = room.players.find((candidate) => candidate?.socketId === socketId);
    if (!player) {
      throw new GameException("NO_PLAYER", "你不在这个炸金花房间里。");
    }
    return player;
  }

  private activePlayers(room: ZjhInternalRoom) {
    return this.seatedPlayers(room).filter((player) => player.connected && !player.folded);
  }

  private seatedPlayers(room: ZjhInternalRoom) {
    return room.players.filter((player): player is ZjhInternalPlayer => Boolean(player));
  }

  private findOpenSeat(room: ZjhInternalRoom) {
    const seat = room.players.findIndex((player) => player === null);
    return seat >= 0 ? seat : undefined;
  }

  private syncPlayerCount(room: ZjhInternalRoom) {
    room.playerCount = this.seatedPlayers(room).length;
  }

  private createPlayer(socketId: string, nickname: string, seat: number): ZjhInternalPlayer {
    return {
      socketId,
      nickname,
      seat,
      joinedAt: Date.now(),
      connected: true,
      ready: false,
      hand: [],
      seen: false,
      folded: false,
      score: DEFAULT_SCORE,
      invested: 0
    };
  }

  private pushSystem(room: ZjhInternalRoom, label: string) {
    this.pushLog(room, { action: "system", label });
  }

  private pushLog(room: ZjhInternalRoom, event: Omit<ZjhPublicAction, "at">) {
    room.turnLog.push({ ...event, at: Date.now() });
    if (room.turnLog.length > 40) {
      room.turnLog.splice(0, room.turnLog.length - 40);
    }
  }

  private touch(room: ZjhInternalRoom) {
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

function normalizeMaxPlayers(maxPlayers: number): number {
  if (!Number.isFinite(maxPlayers)) {
    return DEFAULT_MAX_PLAYERS;
  }

  return Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(maxPlayers)));
}
