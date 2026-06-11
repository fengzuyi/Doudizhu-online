import type {
  FighterFacing,
  FighterInputState,
  FighterPlayerView,
  FighterRoomView,
  FighterRoundResult
} from "@doudizhu/shared";
import { GameException } from "./roomManager.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PLAYERS = 2;
const ARENA = {
  width: 960,
  height: 540,
  groundY: 420
} as const;
const START_X = [240, 720] as const;
const MAX_HP = 100;
const COUNTDOWN_MS = 3000;
const ROUND_MS = 90_000;
const MOVE_SPEED = 310;
const JUMP_SPEED = -720;
const GRAVITY = 1900;
const GROUND_FRICTION = 0.82;
const AIR_FRICTION = 0.97;
const PLAYER_MIN_X = 70;
const PLAYER_MAX_X = ARENA.width - 70;
const ATTACK_DAMAGE = 12;
const ATTACK_RANGE = 112;
const ATTACK_VERTICAL_RANGE = 96;
const ATTACK_WINDUP_MS = 70;
const ATTACK_ACTIVE_MS = 180;
const ATTACK_RECOVERY_MS = 440;
const ATTACK_COOLDOWN_MS = 500;
const HIT_STUN_MS = 430;
const HIT_KNOCKBACK = 330;
const HIT_LIFT = 180;

interface FighterInternalPlayer {
  socketId: string;
  nickname: string;
  seat: number;
  joinedAt: number;
  connected: boolean;
  ready: boolean;
  hp: number;
  maxHp: number;
  score: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: FighterFacing;
  grounded: boolean;
  input: Required<Pick<FighterInputState, "left" | "right">>;
  jumpQueued: boolean;
  attackQueued: boolean;
  stunUntil: number;
  attackStartedAt?: number;
  attackActiveUntil: number;
  attackRecoveryUntil: number;
  nextAttackAt: number;
  attackHitDelivered: boolean;
  lastAction?: string;
}

export interface FighterInternalRoom {
  roomCode: string;
  phase: "lobby" | "countdown" | "fighting" | "ended";
  playerCount: number;
  maxPlayers: number;
  createdAt: number;
  updatedAt: number;
  endedAt?: number;
  players: Array<FighterInternalPlayer | null>;
  countdownEndsAt?: number;
  roundStartedAt?: number;
  roundEndsAt?: number;
  lastTickAt: number;
  result?: FighterRoundResult;
  message?: string;
}

export class FighterRoomManager {
  private readonly rooms = new Map<string, FighterInternalRoom>();
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly now: () => number = Date.now) {}

  createRoom(socketId: string, nickname: string): FighterInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const now = this.now();
    const roomCode = this.generateRoomCode();
    const player = this.createPlayer(socketId, normalizeNickname(nickname), 0, now);
    const room: FighterInternalRoom = {
      roomCode,
      phase: "lobby",
      playerCount: 1,
      maxPlayers: MAX_PLAYERS,
      createdAt: now,
      updatedAt: now,
      players: [player, null],
      lastTickAt: now,
      message: "火柴人决斗房间已创建，等待对手加入。"
    };

    this.rooms.set(roomCode, room);
    this.socketToRoom.set(socketId, roomCode);
    return room;
  }

  joinRoom(socketId: string, roomCode: string, nickname: string): FighterInternalRoom {
    if (this.socketToRoom.has(socketId)) {
      throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
    }

    const room = this.requireRoom(roomCode.trim().toUpperCase());
    if (room.phase !== "lobby") {
      throw new GameException("ROOM_STARTED", "这场决斗已经开始，请创建新房间。");
    }

    const seat = this.findOpenSeat(room);
    if (seat === undefined) {
      throw new GameException("ROOM_FULL", "火柴人决斗房间已满。");
    }

    const player = this.createPlayer(socketId, normalizeNickname(nickname), seat, this.now());
    room.players[seat] = player;
    this.socketToRoom.set(socketId, room.roomCode);
    this.syncPlayerCount(room);
    if (room.playerCount === MAX_PLAYERS) {
      this.startCountdown(room);
      return room;
    }
    room.message = "两名玩家准备后开始决斗。";
    this.touch(room);
    return room;
  }

  leaveRoom(socketId: string): FighterInternalRoom | undefined {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      return undefined;
    }

    const player = this.requirePlayer(room, socketId);
    this.socketToRoom.delete(socketId);
    const now = this.now();

    if (room.phase === "countdown" || room.phase === "fighting") {
      player.connected = false;
      player.ready = false;
      player.input = { left: false, right: false };
      player.jumpQueued = false;
      player.attackQueued = false;
      player.lastAction = "离线判负";
      const opponent = this.connectedPlayers(room).find((candidate) => candidate.seat !== player.seat);
      this.finishRound(room, opponent?.seat, `${player.nickname} 离线，判负。`, now);
      this.touch(room, now);
      return room;
    }

    room.players[player.seat] = null;
    this.syncPlayerCount(room);
    this.touch(room, now);

    if (room.playerCount === 0) {
      this.rooms.delete(room.roomCode);
      return undefined;
    }

    room.message = "等待玩家加入。";
    return room;
  }

  disconnect(socketId: string): FighterInternalRoom | undefined {
    return this.leaveRoom(socketId);
  }

  ready(socketId: string): FighterInternalRoom {
    const room = this.requireRoomForSocket(socketId);
    if (room.phase === "ended") {
      this.resetToLobby(room);
    }

    if (room.phase !== "lobby") {
      throw new GameException("NOT_LOBBY", "当前阶段不能准备。");
    }

    const player = this.requirePlayer(room, socketId);
    player.ready = true;
    player.lastAction = "已准备";
    const players = this.connectedPlayers(room);
    if (players.length === MAX_PLAYERS && players.every((candidate) => candidate.ready)) {
      this.startCountdown(room);
    } else {
      room.message = players.length < MAX_PLAYERS ? "等待对手加入。" : "等待对手准备。";
      this.touch(room);
    }

    return room;
  }

  updateInput(socketId: string, input: FighterInputState): FighterInternalRoom {
    const room = this.requireRoomForSocket(socketId);
    const player = this.requirePlayer(room, socketId);
    if (room.phase !== "fighting") {
      return room;
    }

    player.input = {
      left: Boolean(input.left),
      right: Boolean(input.right)
    };
    if (input.jump) {
      player.jumpQueued = true;
    }
    if (input.attack) {
      player.attackQueued = true;
    }
    this.touch(room);
    return room;
  }

  stepAll(now = this.now()): FighterInternalRoom[] {
    const changedRooms: FighterInternalRoom[] = [];
    for (const room of this.rooms.values()) {
      if (this.stepRoom(room, now)) {
        changedRooms.push(room);
      }
    }
    return changedRooms;
  }

  getRoomForSocket(socketId: string): FighterInternalRoom | undefined {
    const roomCode = this.socketToRoom.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  reassignSocket(oldSocketId: string, newSocketId: string): FighterInternalRoom | undefined {
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
    player.lastAction = "已重连";
    this.socketToRoom.set(newSocketId, room.roomCode);
    this.touch(room);
    return room;
  }

  buildViews(room: FighterInternalRoom): Array<{ socketId: string; roomView: FighterRoomView }> {
    return room.players
      .filter((player): player is FighterInternalPlayer => Boolean(player?.connected))
      .map((player) => ({
        socketId: player.socketId,
        roomView: this.buildViewForPlayer(room, player.socketId)
      }));
  }

  getRoom(roomCode: string) {
    return this.rooms.get(roomCode.trim().toUpperCase());
  }

  getRoomForTest(roomCode: string) {
    return this.getRoom(roomCode);
  }

  getRoomCount() {
    return this.rooms.size;
  }

  private stepRoom(room: FighterInternalRoom, now: number) {
    if (room.phase === "countdown") {
      if (room.countdownEndsAt !== undefined && now >= room.countdownEndsAt) {
        room.phase = "fighting";
        room.roundStartedAt = now;
        room.roundEndsAt = now + ROUND_MS;
        room.countdownEndsAt = undefined;
        room.lastTickAt = now;
        room.message = "决斗开始！";
      }
      this.touch(room, now);
      return true;
    }

    if (room.phase !== "fighting") {
      return false;
    }

    const dt = Math.min(0.05, Math.max(0.001, (now - room.lastTickAt) / 1000));
    room.lastTickAt = now;

    for (const player of this.connectedPlayers(room)) {
      this.stepPlayer(room, player, dt, now);
    }
    this.updateFacing(room);
    this.resolveHits(room, now);

    if (room.phase === "fighting" && room.roundEndsAt !== undefined && now >= room.roundEndsAt) {
      this.finishByTimer(room, now);
    }

    this.touch(room, now);
    return true;
  }

  private stepPlayer(room: FighterInternalRoom, player: FighterInternalPlayer, dt: number, now: number) {
    const stunned = now < player.stunUntil;

    if (!stunned && player.attackQueued && now >= player.nextAttackAt) {
      this.startAttack(player, now);
    }
    player.attackQueued = false;

    if (!stunned && player.jumpQueued && player.grounded) {
      player.vy = JUMP_SPEED;
      player.grounded = false;
      player.lastAction = "跳跃";
    }
    player.jumpQueued = false;

    if (!stunned) {
      const moveDirection = Number(player.input.right) - Number(player.input.left);
      const recovering = now < player.attackRecoveryUntil;
      player.vx = moveDirection * MOVE_SPEED * (recovering ? 0.55 : 1);
      if (moveDirection !== 0) {
        player.facing = moveDirection > 0 ? "right" : "left";
      }
    } else {
      player.vx *= player.grounded ? GROUND_FRICTION : AIR_FRICTION;
    }

    player.vy += GRAVITY * dt;
    player.x = clamp(player.x + player.vx * dt, PLAYER_MIN_X, PLAYER_MAX_X);
    player.y += player.vy * dt;
    if (player.y >= ARENA.groundY) {
      player.y = ARENA.groundY;
      player.vy = 0;
      player.grounded = true;
    }

    if (room.phase === "fighting" && player.hp <= 0) {
      const opponent = this.seatedPlayers(room).find((candidate) => candidate.seat !== player.seat);
      this.finishRound(room, opponent?.seat, `${player.nickname} 被击倒。`, now);
    }
  }

  private startAttack(player: FighterInternalPlayer, now: number) {
    player.attackStartedAt = now;
    player.attackActiveUntil = now + ATTACK_WINDUP_MS + ATTACK_ACTIVE_MS;
    player.attackRecoveryUntil = now + ATTACK_RECOVERY_MS;
    player.nextAttackAt = now + ATTACK_COOLDOWN_MS;
    player.attackHitDelivered = false;
    player.lastAction = "普通攻击";
  }

  private resolveHits(room: FighterInternalRoom, now: number) {
    if (room.phase !== "fighting") {
      return;
    }

    const players = this.connectedPlayers(room);
    for (const attacker of players) {
      if (
        attacker.attackStartedAt === undefined ||
        attacker.attackHitDelivered ||
        now < attacker.attackStartedAt + ATTACK_WINDUP_MS ||
        now > attacker.attackActiveUntil
      ) {
        continue;
      }

      const target = players.find((candidate) => candidate.seat !== attacker.seat && candidate.hp > 0);
      if (!target || !this.isTargetInAttackRange(attacker, target)) {
        continue;
      }

      attacker.attackHitDelivered = true;
      target.hp = Math.max(0, target.hp - ATTACK_DAMAGE);
      target.stunUntil = now + HIT_STUN_MS;
      const knockbackDirection = attacker.facing === "right" ? 1 : -1;
      target.vx = knockbackDirection * HIT_KNOCKBACK;
      target.vy = Math.min(target.vy, -HIT_LIFT);
      target.grounded = false;
      target.lastAction = "受击硬直";
      attacker.lastAction = "命中";

      if (target.hp <= 0) {
        this.finishRound(room, attacker.seat, `${attacker.nickname} 击倒了 ${target.nickname}。`, now);
        return;
      }
    }
  }

  private isTargetInAttackRange(attacker: FighterInternalPlayer, target: FighterInternalPlayer) {
    const dx = target.x - attacker.x;
    const inFront = attacker.facing === "right" ? dx > 0 : dx < 0;
    return inFront && Math.abs(dx) <= ATTACK_RANGE && Math.abs(target.y - attacker.y) <= ATTACK_VERTICAL_RANGE;
  }

  private finishByTimer(room: FighterInternalRoom, now: number) {
    const players = this.seatedPlayers(room);
    const [first, second] = players;
    if (!first || !second || first.hp === second.hp) {
      this.finishRound(room, undefined, "时间到，平局。", now);
      return;
    }

    const winner = first.hp > second.hp ? first : second;
    this.finishRound(room, winner.seat, "时间到，剩余血量更高者获胜。", now);
  }

  private finishRound(room: FighterInternalRoom, winnerSeat: number | undefined, reason: string, now: number) {
    if (room.phase === "ended") {
      return;
    }

    const scores: Record<number, number> = {};
    const remainingHp: Record<number, number> = {};
    const winner = winnerSeat === undefined ? undefined : room.players[winnerSeat];

    for (const player of this.seatedPlayers(room)) {
      const scoreDelta = winnerSeat === undefined ? 0 : player.seat === winnerSeat ? 1 : -1;
      player.score += scoreDelta;
      player.ready = false;
      player.input = { left: false, right: false };
      player.jumpQueued = false;
      player.attackQueued = false;
      scores[player.seat] = scoreDelta;
      remainingHp[player.seat] = player.hp;
    }

    room.phase = "ended";
    room.endedAt = now;
    room.countdownEndsAt = undefined;
    room.roundEndsAt = undefined;
    room.result = {
      winnerSeat,
      winnerNickname: winner?.nickname,
      reason,
      scores,
      remainingHp,
      durationMs: room.roundStartedAt === undefined ? 0 : now - room.roundStartedAt
    };
    room.message = winner ? `${winner.nickname} 获胜。${reason}` : reason;
  }

  private startCountdown(room: FighterInternalRoom) {
    const now = this.now();
    this.resetCombatants(room, now);
    room.phase = "countdown";
    room.countdownEndsAt = now + COUNTDOWN_MS;
    room.roundStartedAt = undefined;
    room.roundEndsAt = undefined;
    room.result = undefined;
    room.endedAt = undefined;
    room.lastTickAt = now;
    room.message = "倒计时开始。";
    this.touch(room, now);
  }

  private resetToLobby(room: FighterInternalRoom) {
    const now = this.now();
    room.players = room.players.map((player) => {
      if (!player?.connected) {
        return null;
      }
      player.ready = false;
      this.resetPlayerCombatState(player, now);
      return player;
    });
    this.syncPlayerCount(room);
    room.phase = "lobby";
    room.countdownEndsAt = undefined;
    room.roundStartedAt = undefined;
    room.roundEndsAt = undefined;
    room.result = undefined;
    room.endedAt = undefined;
    room.message = "上一局已结束，准备后可再次开始。";
    this.touch(room, now);
  }

  private resetCombatants(room: FighterInternalRoom, now: number) {
    for (const player of this.seatedPlayers(room)) {
      player.ready = false;
      this.resetPlayerCombatState(player, now);
    }
  }

  private resetPlayerCombatState(player: FighterInternalPlayer, now: number) {
    player.hp = MAX_HP;
    player.maxHp = MAX_HP;
    player.x = START_X[player.seat] ?? START_X[0];
    player.y = ARENA.groundY;
    player.vx = 0;
    player.vy = 0;
    player.facing = player.seat === 0 ? "right" : "left";
    player.grounded = true;
    player.input = { left: false, right: false };
    player.jumpQueued = false;
    player.attackQueued = false;
    player.stunUntil = 0;
    player.attackStartedAt = undefined;
    player.attackActiveUntil = 0;
    player.attackRecoveryUntil = 0;
    player.nextAttackAt = now;
    player.attackHitDelivered = false;
    player.lastAction = undefined;
  }

  private updateFacing(room: FighterInternalRoom) {
    const [first, second] = this.connectedPlayers(room);
    if (!first || !second) {
      return;
    }

    if (first.x <= second.x) {
      first.facing = "right";
      second.facing = "left";
    } else {
      first.facing = "left";
      second.facing = "right";
    }
  }

  private buildViewForPlayer(room: FighterInternalRoom, socketId: string): FighterRoomView {
    const self = this.requirePlayer(room, socketId);
    const now = this.now();
    return {
      roomCode: room.roomCode,
      phase: room.phase,
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      selfSeat: self.seat,
      players: this.seatedPlayers(room).map((player) => this.buildPlayerView(player, now)),
      arena: ARENA,
      countdownEndsAt: room.countdownEndsAt,
      roundStartedAt: room.roundStartedAt,
      roundEndsAt: room.roundEndsAt,
      serverTime: now,
      result: room.result,
      message: room.message
    };
  }

  private buildPlayerView(player: FighterInternalPlayer, now: number): FighterPlayerView {
    return {
      seat: player.seat,
      nickname: player.nickname,
      connected: player.connected,
      ready: player.ready,
      hp: player.hp,
      maxHp: player.maxHp,
      score: player.score,
      x: Math.round(player.x),
      y: Math.round(player.y),
      facing: player.facing,
      grounded: player.grounded,
      attacking: now < player.attackRecoveryUntil,
      stunned: now < player.stunUntil,
      lastAction: player.lastAction
    };
  }

  private createPlayer(socketId: string, nickname: string, seat: number, now: number): FighterInternalPlayer {
    const player: FighterInternalPlayer = {
      socketId,
      nickname,
      seat,
      joinedAt: now,
      connected: true,
      ready: false,
      hp: MAX_HP,
      maxHp: MAX_HP,
      score: 0,
      x: START_X[seat] ?? START_X[0],
      y: ARENA.groundY,
      vx: 0,
      vy: 0,
      facing: seat === 0 ? "right" : "left",
      grounded: true,
      input: { left: false, right: false },
      jumpQueued: false,
      attackQueued: false,
      stunUntil: 0,
      attackActiveUntil: 0,
      attackRecoveryUntil: 0,
      nextAttackAt: now,
      attackHitDelivered: false
    };

    return player;
  }

  private requireRoomForSocket(socketId: string) {
    const room = this.getRoomForSocket(socketId);
    if (!room) {
      throw new GameException("NO_ROOM", "你还没有加入火柴人决斗房间。");
    }
    return room;
  }

  private requireRoom(roomCode: string) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new GameException("ROOM_NOT_FOUND", "没有找到这个火柴人决斗房间。");
    }
    return room;
  }

  private requirePlayer(room: FighterInternalRoom, socketId: string) {
    const player = room.players.find((candidate) => candidate?.socketId === socketId);
    if (!player) {
      throw new GameException("NO_PLAYER", "你不在这个火柴人决斗房间里。");
    }
    return player;
  }

  private connectedPlayers(room: FighterInternalRoom) {
    return this.seatedPlayers(room).filter((player) => player.connected);
  }

  private seatedPlayers(room: FighterInternalRoom) {
    return room.players.filter((player): player is FighterInternalPlayer => Boolean(player));
  }

  private findOpenSeat(room: FighterInternalRoom) {
    const seat = room.players.findIndex((player) => player === null);
    return seat >= 0 ? seat : undefined;
  }

  private syncPlayerCount(room: FighterInternalRoom) {
    room.playerCount = this.seatedPlayers(room).length;
  }

  private touch(room: FighterInternalRoom, now = this.now()) {
    room.updatedAt = now;
  }

  private generateRoomCode(): string {
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));

    return code;
  }
}

function normalizeNickname(nickname: string): string {
  const normalized = nickname.trim().slice(0, 16);
  return normalized.length > 0 ? normalized : "玩家";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
