import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { Server } from "socket.io";
import type { ChatMessage, ClientToServerEvents, GameKind, ServerToClientEvents } from "@doudizhu/shared";
import { AuthException, AuthManager } from "./authManager.js";
import type { AuthRepository } from "./authRepository.js";
import { GameException, RoomManager } from "./roomManager.js";
import type { InternalRoom } from "./roomManager.js";
import { ZjhRoomManager } from "./zjhRoomManager.js";
import type { ZjhInternalRoom } from "./zjhRoomManager.js";
import { DaBanZiRoomManager } from "./daBanZiRoomManager.js";
import type { DaBanZiInternalRoom } from "./daBanZiRoomManager.js";
import { FighterRoomManager } from "./fighterRoomManager.js";
import type { FighterInternalRoom } from "./fighterRoomManager.js";
import {
  createPrismaAdminRepository,
  InMemoryAdminRepository,
  type AdminRepository
} from "./adminRepository.js";
import {
  createPrismaGameHistoryRepository,
  InMemoryGameHistoryRepository,
  type GameHistoryRepository,
  type GameSessionCreateInput
} from "./gameHistoryRepository.js";
import { createLogger } from "./logger.js";
import type { AppLogger } from "./logger.js";

function getBearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim();
}

const CHAT_ROOM = "hall-chat";
const MAX_CHAT_MESSAGES = 50;
const MAX_CHAT_TEXT_LENGTH = 120;
const DEFAULT_CLIENT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const DEFAULT_ADMIN_ACCOUNT = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin123456";
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60_000;
const VOICE_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const MAX_GAME_HISTORY_RECORDS = 50;
const GAME_NAME_BY_KIND: Record<GameKind, string> = {
  fighter: "火柴人决斗",
  doudizhu: "斗地主",
  zha_jin_hua: "炸金花",
  da_ban_zi: "打板子"
};

function getClientOrigins() {
  const raw = process.env.CLIENT_ORIGIN ?? process.env.CORS_ORIGIN;
  if (!raw) {
    return DEFAULT_CLIENT_ORIGINS;
  }

  const origins = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : DEFAULT_CLIENT_ORIGINS;
}

export function createGameServer() {
  return createGameServerWithOptions();
}

interface GameServerOptions {
  authRepository?: AuthRepository;
  adminRepository?: AdminRepository;
  gameHistoryRepository?: GameHistoryRepository;
  authSessionTtlDays?: number;
  logger?: AppLogger;
  disableMaintenance?: boolean;
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeVoiceGameKind(value: unknown): GameKind | undefined {
  return value === "doudizhu" || value === "zha_jin_hua" || value === "da_ban_zi" || value === "fighter" ? value : undefined;
}

function normalizeVoiceRoomCode(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function normalizeHistoryLimit(value: unknown) {
  const parsed = typeof value === "string" ? Number(value) : Number(value ?? MAX_GAME_HISTORY_RECORDS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return MAX_GAME_HISTORY_RECORDS;
  }

  return Math.min(Math.floor(parsed), MAX_GAME_HISTORY_RECORDS);
}

function buildVoiceRoomName(gameKind: GameKind, roomCode: string) {
  return `voice_${gameKind}_${roomCode}`;
}

function getLiveKitConfig() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();

  if (!url || !apiKey || !apiSecret) {
    return undefined;
  }

  return { url, apiKey, apiSecret };
}

export function createGameServerWithOptions(options: GameServerOptions = {}) {
  const logger = options.logger ?? createLogger();
  const app = express();
  const httpServer = createServer(app);
  const clientOrigins = getClientOrigins();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: clientOrigins,
      methods: ["GET", "POST"]
    }
  });
  const authManager = new AuthManager(options.authRepository, { sessionTtlDays: options.authSessionTtlDays });
  const adminRepository =
    options.adminRepository ?? (options.authRepository ? new InMemoryAdminRepository() : createPrismaAdminRepository());
  const gameHistoryRepository: GameHistoryRepository =
    options.gameHistoryRepository ??
    (options.authRepository ? new InMemoryGameHistoryRepository() : createPrismaGameHistoryRepository());
  const roomManager = new RoomManager();
  const zjhRoomManager = new ZjhRoomManager();
  const daBanZiRoomManager = new DaBanZiRoomManager();
  const fighterRoomManager = new FighterRoomManager();
  const chatMessages: ChatMessage[] = [];
  const chatSessions = new Map<string, { account: string; nickname: string; token: string }>();
  const socketAuth = new Map<string, { account: string; nickname: string; token: string }>();
  const adminAccount = (process.env.ADMIN_ACCOUNT ?? DEFAULT_ADMIN_ACCOUNT).trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD;
  const adminSessions = new Map<string, { account: string; expiresAt: number }>();
  const mutedChatAccounts = new Map<string, { mutedAt: number; mutedBy: string; reason?: string }>();
  const cleanupOptions = {
    emptyRoomTtlMs: numberFromEnv("EMPTY_ROOM_TTL_MS", 60_000),
    endedRoomTtlMs: numberFromEnv("ENDED_ROOM_TTL_MS", 30 * 60_000),
    lobbyRoomTtlMs: numberFromEnv("LOBBY_ROOM_TTL_MS", 2 * 60 * 60_000)
  };
  const roomCleanupIntervalMs = numberFromEnv("ROOM_CLEANUP_INTERVAL_MS", 5 * 60_000);
  const reconnectGraceMs = numberFromEnv("RECONNECT_GRACE_MS", 15_000);
  const fighterTickIntervalMs = numberFromEnv("FIGHTER_TICK_INTERVAL_MS", 50);
  const pendingGameDisconnects = new Map<
    string,
    {
      socketId: string;
      account: string;
      nickname: string;
      token: string;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  app.use(cors({ origin: clientOrigins }));
  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  const adminStateReady = initializeAdminState();

  async function initializeAdminState() {
    const [storedMessages, storedMutes] = await Promise.all([
      adminRepository.listChatMessages(MAX_CHAT_MESSAGES),
      adminRepository.listChatMutes()
    ]);

    chatMessages.splice(0, chatMessages.length, ...storedMessages);
    mutedChatAccounts.clear();
    for (const mute of storedMutes) {
      mutedChatAccounts.set(mute.account, {
        mutedAt: mute.mutedAt,
        mutedBy: mute.mutedBy,
        reason: mute.reason
      });
    }
  }

  async function ensureAdminStateReady() {
    try {
      await adminStateReady;
    } catch (error) {
      logger.error("admin.persistence_init_failed", { error });
      throw error;
    }
  }

  function sendAuthError(response: express.Response, error: unknown) {
    if (error instanceof AuthException) {
      logger.warn("auth.request_failed", { code: error.code, status: error.status });
      response.status(error.status).json({ code: error.code, message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "服务器发生未知错误。";
    logger.error("auth.server_error", { error });
    response.status(500).json({ code: "SERVER_ERROR", message });
  }

  function normalizeAdminLogin(value: unknown) {
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }

  function requireAdmin(request: express.Request) {
    const token = getBearerToken(request.headers.authorization);
    const session = token ? adminSessions.get(token) : undefined;
    if (!token || !session || session.expiresAt <= Date.now()) {
      if (token) {
        adminSessions.delete(token);
      }
      throw new AuthException("ADMIN_UNAUTHORIZED", "请先登录管理后台。", 401);
    }

    return session;
  }

  async function pushAdminAudit(input: { admin: string; action: string; target?: string; reason?: string }) {
    await adminRepository.addAuditLog(input);
  }

  function removeAccountFromLiveSessions(account: string, message: string) {
    for (const [socketId, session] of [...socketAuth.entries()]) {
      if (session.account !== account) {
        continue;
      }

      io.to(socketId).emit("auth:session_replaced", { message });
      removeSocketFromGameRooms(socketId);
      leaveChat(socketId);
      socketAuth.delete(socketId);
    }

    for (const [socketId, session] of [...chatSessions.entries()]) {
      if (session.account === account) {
        leaveChat(socketId);
      }
    }
  }

  app.post("/api/auth/register", async (request, response) => {
    try {
      const result = await authManager.register(request.body);
      logger.info("auth.registered", { account: result.profile.account, nickname: result.profile.nickname });
      response.json(result);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    try {
      const result = await authManager.login(request.body);
      logger.info("auth.login", { account: result.profile.account, nickname: result.profile.nickname });
      response.json(result);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/auth/me", async (request, response) => {
    try {
      const token = getBearerToken(request.headers.authorization);
      response.json({ profile: await authManager.me(token) });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/logout", async (request, response) => {
    try {
      const token = getBearerToken(request.headers.authorization);
      await authManager.logout(token);
      logger.info("auth.logout");
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/voice/token", async (request, response) => {
    try {
      const profile = await authManager.me(getBearerToken(request.headers.authorization));
      const gameKind = normalizeVoiceGameKind(request.body?.gameKind);
      const roomCode = normalizeVoiceRoomCode(request.body?.roomCode);

      if (!gameKind || !roomCode) {
        throw new AuthException("VOICE_ROOM_REQUIRED", "请先进入游戏房间后再开启语音。", 400);
      }

      if (!hasAccountInGameRoom(profile.account, gameKind, roomCode)) {
        throw new AuthException("VOICE_ROOM_FORBIDDEN", "请先加入对应房间后再开启语音。", 403);
      }

      const livekit = getLiveKitConfig();
      if (!livekit) {
        throw new AuthException("VOICE_NOT_CONFIGURED", "语音服务未配置，请联系管理员设置 LiveKit。", 503);
      }

      const roomName = buildVoiceRoomName(gameKind, roomCode);
      const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
        identity: profile.account,
        name: profile.nickname,
        ttl: VOICE_TOKEN_TTL_SECONDS,
        metadata: JSON.stringify({ account: profile.account, gameKind, roomCode })
      });
      token.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canPublishSources: [TrackSource.MICROPHONE],
        canSubscribe: true,
        canPublishData: false
      });

      logger.info("voice.token_issued", { account: profile.account, gameKind, roomCode, roomName });
      response.json({
        url: livekit.url,
        token: await token.toJwt(),
        roomName,
        participantName: profile.nickname
      });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/game-records", async (request, response) => {
    try {
      const profile = await authManager.me(getBearerToken(request.headers.authorization));
      const limit = normalizeHistoryLimit(request.query.limit);
      const records = await gameHistoryRepository.listGameSessions(profile.account, limit);
      response.json({ records });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/admin/login", async (request, response) => {
    try {
      await ensureAdminStateReady();
      const account = normalizeAdminLogin(request.body?.account);
      const password = typeof request.body?.password === "string" ? request.body.password : "";
      if (account !== adminAccount || password !== adminPassword) {
        throw new AuthException("ADMIN_LOGIN_FAILED", "管理员账号或密码错误。", 401);
      }

      const token = randomUUID();
      adminSessions.set(token, { account, expiresAt: Date.now() + ADMIN_SESSION_TTL_MS });
      await pushAdminAudit({ admin: account, action: "admin.login" });
      logger.info("admin.login", { account });
      response.json({ token, profile: { account, role: "super_admin" } });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/admin/me", (request, response) => {
    try {
      const session = requireAdmin(request);
      response.json({ profile: { account: session.account, role: "super_admin" } });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/admin/logout", async (request, response) => {
    try {
      await ensureAdminStateReady();
      const token = getBearerToken(request.headers.authorization);
      const session = token ? adminSessions.get(token) : undefined;
      if (token) {
        adminSessions.delete(token);
      }
      if (session) {
        await pushAdminAudit({ admin: session.account, action: "admin.logout" });
      }
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/admin/users", async (request, response) => {
    try {
      requireAdmin(request);
      await ensureAdminStateReady();
      const query = typeof request.query.q === "string" ? request.query.q : undefined;
      const users = await authManager.listUsers(query);
      response.json({
        users: users.map((user) => ({
          id: user.id,
          account: user.account,
          nickname: user.nickname,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          lastLoginAt: user.lastLoginAt,
          activeSessionCount: user.activeSessionCount,
          muted: mutedChatAccounts.has(user.account),
          muteReason: mutedChatAccounts.get(user.account)?.reason
        }))
      });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/admin/users/:account/status", async (request, response) => {
    try {
      const session = requireAdmin(request);
      const account = request.params.account;
      const status = request.body?.status;
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : undefined;
      await authManager.setUserStatus(account, status);
      if (status === "BANNED") {
        removeAccountFromLiveSessions(account.toLowerCase(), reason || "账号已被管理员封禁。");
      }
      await pushAdminAudit({
        admin: session.account,
        action: status === "BANNED" ? "user.ban" : "user.unban",
        target: account,
        reason
      });
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/admin/users/:account/sessions/revoke", async (request, response) => {
    try {
      const session = requireAdmin(request);
      const account = request.params.account.toLowerCase();
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : undefined;
      await authManager.revokeUserSessions(account);
      removeAccountFromLiveSessions(account, reason || "管理员已强制该账号下线。");
      await pushAdminAudit({ admin: session.account, action: "user.revoke_sessions", target: account, reason });
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/admin/users/:account/mute", async (request, response) => {
    try {
      const session = requireAdmin(request);
      await ensureAdminStateReady();
      const account = request.params.account.toLowerCase();
      const muted = Boolean(request.body?.muted);
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : undefined;
      if (muted) {
        await adminRepository.setChatMute({ account, mutedBy: session.account, reason });
        mutedChatAccounts.set(account, { mutedAt: Date.now(), mutedBy: session.account, reason });
      } else {
        await adminRepository.deleteChatMute(account);
        mutedChatAccounts.delete(account);
      }
      await pushAdminAudit({ admin: session.account, action: muted ? "chat.mute" : "chat.unmute", target: account, reason });
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/admin/chat/messages", async (request, response) => {
    try {
      requireAdmin(request);
      await ensureAdminStateReady();
      response.json({ messages: chatMessages });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.delete("/api/admin/chat/messages", async (request, response) => {
    try {
      const session = requireAdmin(request);
      await ensureAdminStateReady();
      const removedCount = await adminRepository.clearChatMessages();
      chatMessages.splice(0, chatMessages.length);
      await pushAdminAudit({ admin: session.account, action: "chat.clear_messages", target: String(removedCount) });
      emitChatState();
      response.json({ ok: true, removedCount });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.delete("/api/admin/chat/messages/:id", async (request, response) => {
    try {
      const session = requireAdmin(request);
      await ensureAdminStateReady();
      const removed = await adminRepository.deleteChatMessage(request.params.id);
      if (!removed) {
        throw new AuthException("CHAT_MESSAGE_NOT_FOUND", "聊天记录不存在。", 404);
      }

      const messageIndex = chatMessages.findIndex((message) => message.id === request.params.id);
      if (messageIndex !== -1) {
        chatMessages.splice(messageIndex, 1);
      }
      const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : undefined;
      await pushAdminAudit({ admin: session.account, action: "chat.delete_message", target: removed.id, reason });
      emitChatState();
      response.json({ ok: true });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/admin/audit", async (request, response) => {
    try {
      requireAdmin(request);
      await ensureAdminStateReady();
      response.json({ logs: await adminRepository.listAuditLogs(100) });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  function emitRoom(room: InternalRoom | undefined) {
    if (!room) {
      return;
    }

    for (const { socketId, roomView } of roomManager.buildViews(room)) {
      io.to(socketId).emit("room:state", { roomView });
    }
  }

  function zjhSocketRoom(roomCode: string) {
    return `zjh:${roomCode}`;
  }

  function emitZjhRoom(room: ZjhInternalRoom | undefined) {
    if (!room) {
      return;
    }

    for (const { socketId, roomView } of zjhRoomManager.buildViews(room)) {
      io.to(socketId).emit("zjh:room:state", { roomView });
    }
  }

  function dbzSocketRoom(roomCode: string) {
    return `dbz:${roomCode}`;
  }

  function fighterSocketRoom(roomCode: string) {
    return `fighter:${roomCode}`;
  }

  type GameRoomLookup =
    | { gameKind: "doudizhu"; room: InternalRoom }
    | { gameKind: "zha_jin_hua"; room: ZjhInternalRoom }
    | { gameKind: "da_ban_zi"; room: DaBanZiInternalRoom }
    | { gameKind: "fighter"; room: FighterInternalRoom };

  function findCurrentGameRoom(socketId: string): GameRoomLookup | undefined {
    const room = roomManager.getRoomForSocket(socketId);
    if (room) {
      return { gameKind: "doudizhu", room };
    }

    const zjhRoom = zjhRoomManager.getRoomForSocket(socketId);
    if (zjhRoom) {
      return { gameKind: "zha_jin_hua", room: zjhRoom };
    }

    const daBanZiRoom = daBanZiRoomManager.getRoomForSocket(socketId);
    if (daBanZiRoom) {
      return { gameKind: "da_ban_zi", room: daBanZiRoom };
    }

    const fighterRoom = fighterRoomManager.getRoomForSocket(socketId);
    if (fighterRoom) {
      return { gameKind: "fighter", room: fighterRoom };
    }

    return undefined;
  }

  function findGameRoomsByCode(roomCode: string): GameRoomLookup[] {
    const rooms: GameRoomLookup[] = [];
    const doudizhuRoom = roomManager.getRoom(roomCode);
    const zjhRoom = zjhRoomManager.getRoom(roomCode);
    const daBanZiRoom = daBanZiRoomManager.getRoom(roomCode);
    const fighterRoom = fighterRoomManager.getRoom(roomCode);

    if (doudizhuRoom) {
      rooms.push({ gameKind: "doudizhu", room: doudizhuRoom });
    }
    if (zjhRoom) {
      rooms.push({ gameKind: "zha_jin_hua", room: zjhRoom });
    }
    if (daBanZiRoom) {
      rooms.push({ gameKind: "da_ban_zi", room: daBanZiRoom });
    }
    if (fighterRoom) {
      rooms.push({ gameKind: "fighter", room: fighterRoom });
    }

    return rooms;
  }

  function joinSocketTransportRoom(socketId: string, target: GameRoomLookup) {
    const clientSocket = io.sockets.sockets.get(socketId);
    if (!clientSocket) {
      return;
    }

    if (target.gameKind === "doudizhu") {
      clientSocket.join(target.room.roomCode);
    } else if (target.gameKind === "zha_jin_hua") {
      clientSocket.join(zjhSocketRoom(target.room.roomCode));
    } else if (target.gameKind === "da_ban_zi") {
      clientSocket.join(dbzSocketRoom(target.room.roomCode));
    } else {
      clientSocket.join(fighterSocketRoom(target.room.roomCode));
    }
  }

  function emitGameRoom(target: GameRoomLookup) {
    if (target.gameKind === "doudizhu") {
      emitRoom(target.room);
    } else if (target.gameKind === "zha_jin_hua") {
      emitZjhRoom(target.room);
    } else if (target.gameKind === "da_ban_zi") {
      emitDaBanZiRoom(target.room);
    } else {
      emitFighterRoom(target.room);
    }
  }

  function joinRoomByCode(socketId: string, roomCode: string, auth: SocketSession) {
    const requestedRoomCode = roomCode.trim().toUpperCase();
    if (!requestedRoomCode) {
      throw new GameException("ROOM_CODE_REQUIRED", "请输入房间号。");
    }

    const currentRoom = findCurrentGameRoom(socketId);
    if (currentRoom) {
      if (currentRoom.room.roomCode !== requestedRoomCode) {
        throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
      }

      joinSocketTransportRoom(socketId, currentRoom);
      logger.info("room.rejoined", {
        gameKind: currentRoom.gameKind,
        roomCode: currentRoom.room.roomCode,
        socketId,
        account: auth.account,
        nickname: auth.nickname
      });
      emitGameRoom(currentRoom);
      return;
    }

    const matches = findGameRoomsByCode(requestedRoomCode);
    if (matches.length === 0) {
      throw new GameException("ROOM_NOT_FOUND", "没有找到这个房间。");
    }
    if (matches.length > 1) {
      throw new GameException("ROOM_CODE_AMBIGUOUS", "这个房间号同时匹配到多个游戏房间，请让房主重新创建房间后再加入。");
    }

    const target = matches[0];
    if (target.gameKind === "doudizhu") {
      const room = roomManager.joinRoom(socketId, requestedRoomCode, auth.nickname);
      joinSocketTransportRoom(socketId, { gameKind: "doudizhu", room });
      logger.info("room.joined", { gameKind: target.gameKind, roomCode: room.roomCode, socketId, account: auth.account, nickname: auth.nickname });
      emitRoom(room);
      return;
    }

    if (target.gameKind === "zha_jin_hua") {
      const room = zjhRoomManager.joinRoom(socketId, requestedRoomCode, auth.nickname);
      joinSocketTransportRoom(socketId, { gameKind: "zha_jin_hua", room });
      logger.info("zjh.room.joined", { gameKind: target.gameKind, roomCode: room.roomCode, socketId, account: auth.account, nickname: auth.nickname });
      emitZjhRoom(room);
      return;
    }

    if (target.gameKind === "da_ban_zi") {
      const room = daBanZiRoomManager.joinRoom(socketId, requestedRoomCode, auth.nickname);
      joinSocketTransportRoom(socketId, { gameKind: "da_ban_zi", room });
      logger.info("dbz.room.joined", { gameKind: target.gameKind, roomCode: room.roomCode, socketId, account: auth.account, nickname: auth.nickname });
      emitDaBanZiRoom(room);
      return;
    }

    const room = fighterRoomManager.joinRoom(socketId, requestedRoomCode, auth.nickname);
    joinSocketTransportRoom(socketId, { gameKind: "fighter", room });
    logger.info("fighter.room.joined", { gameKind: target.gameKind, roomCode: room.roomCode, socketId, account: auth.account, nickname: auth.nickname });
    emitFighterRoom(room);
  }

  function hasAccountInGameRoom(account: string, gameKind: GameKind, roomCode: string) {
    for (const [socketId, session] of socketAuth.entries()) {
      if (session.account !== account) {
        continue;
      }

      if (gameKind === "doudizhu" && roomManager.getRoomForSocket(socketId)?.roomCode === roomCode) {
        return true;
      }

      if (gameKind === "zha_jin_hua" && zjhRoomManager.getRoomForSocket(socketId)?.roomCode === roomCode) {
        return true;
      }

      if (gameKind === "da_ban_zi" && daBanZiRoomManager.getRoomForSocket(socketId)?.roomCode === roomCode) {
        return true;
      }

      if (gameKind === "fighter" && fighterRoomManager.getRoomForSocket(socketId)?.roomCode === roomCode) {
        return true;
      }
    }

    return false;
  }

  type SocketSession = { account: string; nickname: string; token: string };

  async function persistGameSession(input: GameSessionCreateInput) {
    try {
      await gameHistoryRepository.addGameSession(input);
      logger.info("game_history.recorded", {
        account: input.account,
        gameKind: input.gameKind,
        roomCode: input.roomCode,
        finalScore: input.finalScore
      });
    } catch (error) {
      logger.error("game_history.persist_failed", {
        account: input.account,
        gameKind: input.gameKind,
        roomCode: input.roomCode,
        error
      });
    }
  }

  function getSessionForRecord(socketId: string, sessionOverride?: SocketSession) {
    return sessionOverride ?? socketAuth.get(socketId);
  }

  function doudizhuResultLabel(room: InternalRoom) {
    if (room.result) {
      return room.result.landlordWon ? "地主获胜" : "农民获胜";
    }

    return room.message ?? getRoomPhaseLabel(room.phase);
  }

  function getRoomPhaseLabel(phase: string) {
    const labels: Record<string, string> = {
      lobby: "准备中",
      bidding: "叫分中",
      bao: "包牌中",
      partner_call: "叫队友中",
      playing: "对局中",
      ended: "已结算"
    };

    return labels[phase] ?? phase;
  }

  async function recordDoudizhuExit(socketId: string, room: InternalRoom | undefined, reason: string, sessionOverride?: SocketSession) {
    const session = getSessionForRecord(socketId, sessionOverride);
    const player = room?.players.find((candidate) => candidate?.socketId === socketId);
    if (!session || !room || !player) {
      return;
    }

    await persistGameSession({
      account: session.account,
      nickname: player.nickname || session.nickname,
      gameKind: "doudizhu",
      gameName: GAME_NAME_BY_KIND.doudizhu,
      roomCode: room.roomCode,
      seat: player.seat,
      enteredAt: player.joinedAt ?? room.createdAt,
      leftAt: Date.now(),
      finalScore: player.score ?? 0,
      scoreLabel: `${player.score ?? 0} 分`,
      resultLabel: doudizhuResultLabel(room),
      leaveReason: reason,
      phase: room.phase
    });
  }

  async function recordZjhExit(socketId: string, room: ZjhInternalRoom | undefined, reason: string, sessionOverride?: SocketSession) {
    const session = getSessionForRecord(socketId, sessionOverride);
    const player = room?.players.find((candidate) => candidate?.socketId === socketId);
    if (!session || !room || !player) {
      return;
    }

    await persistGameSession({
      account: session.account,
      nickname: player.nickname || session.nickname,
      gameKind: "zha_jin_hua",
      gameName: GAME_NAME_BY_KIND.zha_jin_hua,
      roomCode: room.roomCode,
      seat: player.seat,
      enteredAt: player.joinedAt ?? room.createdAt,
      leftAt: Date.now(),
      finalScore: player.score,
      scoreLabel: `${player.score} 分`,
      resultLabel: room.result ? `${room.result.winnerNickname} 赢得 ${room.result.pot} 分` : room.message ?? getRoomPhaseLabel(room.phase),
      leaveReason: reason,
      phase: room.phase
    });
  }

  async function recordDaBanZiExit(socketId: string, room: DaBanZiInternalRoom | undefined, reason: string, sessionOverride?: SocketSession) {
    const session = getSessionForRecord(socketId, sessionOverride);
    const player = room?.players.find((candidate) => candidate?.socketId === socketId);
    if (!session || !room || !player) {
      return;
    }

    await persistGameSession({
      account: session.account,
      nickname: player.nickname || session.nickname,
      gameKind: "da_ban_zi",
      gameName: GAME_NAME_BY_KIND.da_ban_zi,
      roomCode: room.roomCode,
      seat: player.seat,
      enteredAt: player.joinedAt ?? room.createdAt,
      leftAt: Date.now(),
      finalScore: player.score,
      scoreLabel: `${player.score} 分`,
      resultLabel: room.result?.winnerLabel ?? room.message ?? getRoomPhaseLabel(room.phase),
      leaveReason: reason,
      phase: room.phase
    });
  }

  async function recordFighterExit(socketId: string, room: FighterInternalRoom | undefined, reason: string, sessionOverride?: SocketSession) {
    const session = getSessionForRecord(socketId, sessionOverride);
    const player = room?.players.find((candidate) => candidate?.socketId === socketId);
    if (!session || !room || !player) {
      return;
    }

    await persistGameSession({
      account: session.account,
      nickname: player.nickname || session.nickname,
      gameKind: "fighter",
      gameName: GAME_NAME_BY_KIND.fighter,
      roomCode: room.roomCode,
      seat: player.seat,
      enteredAt: player.joinedAt ?? room.createdAt,
      leftAt: Date.now(),
      finalScore: player.score,
      scoreLabel: `${player.score} 胜点`,
      resultLabel: room.result?.winnerNickname ? `${room.result.winnerNickname} 获胜` : room.result?.reason ?? room.message ?? getRoomPhaseLabel(room.phase),
      leaveReason: reason,
      phase: room.phase
    });
  }

  async function recordSocketGameExits(socketId: string, reason: string, sessionOverride?: SocketSession) {
    await Promise.all([
      recordDoudizhuExit(socketId, roomManager.getRoomForSocket(socketId), reason, sessionOverride),
      recordZjhExit(socketId, zjhRoomManager.getRoomForSocket(socketId), reason, sessionOverride),
      recordDaBanZiExit(socketId, daBanZiRoomManager.getRoomForSocket(socketId), reason, sessionOverride),
      recordFighterExit(socketId, fighterRoomManager.getRoomForSocket(socketId), reason, sessionOverride)
    ]);
  }

  function emitDaBanZiRoom(room: DaBanZiInternalRoom | undefined) {
    if (!room) {
      return;
    }

    for (const { socketId, roomView } of daBanZiRoomManager.buildViews(room)) {
      io.to(socketId).emit("dbz:room:state", { roomView });
    }
  }

  function emitFighterRoom(room: FighterInternalRoom | undefined) {
    if (!room) {
      return;
    }

    for (const { socketId, roomView } of fighterRoomManager.buildViews(room)) {
      io.to(socketId).emit("fighter:room:state", { roomView });
    }
  }

  function handleError(socketId: string, error: unknown) {
    if (error instanceof AuthException) {
      logger.warn("socket.auth_failed", { socketId, code: error.code });
      io.to(socketId).emit("game:error", { code: error.code, message: error.message });
      return;
    }

    if (error instanceof GameException) {
      logger.warn("game.action_failed", { socketId, code: error.code });
      io.to(socketId).emit("game:error", { code: error.code, message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "服务器发生未知错误。";
    logger.error("game.server_error", { socketId, error });
    io.to(socketId).emit("game:error", { code: "SERVER_ERROR", message });
  }

  function emitChatState() {
    io.to(CHAT_ROOM).emit("chat:state", {
      messages: chatMessages,
      onlineCount: chatSessions.size
    });
  }

  function emitChatError(socketId: string, code: string, message: string) {
    logger.warn("chat.action_failed", { socketId, code });
    io.to(socketId).emit("chat:error", { code, message });
  }

  function leaveChat(socketId: string) {
    const wasInChat = chatSessions.delete(socketId);
    if (wasInChat) {
      io.sockets.sockets.get(socketId)?.leave(CHAT_ROOM);
      emitChatState();
      logger.info("chat.left", { socketId, onlineCount: chatSessions.size });
    }
  }

  function transferSocketGameRooms(oldSocketId: string, newSocketId: string) {
    let transferred = false;

    const room = roomManager.reassignSocket(oldSocketId, newSocketId);
    if (room) {
      io.sockets.sockets.get(oldSocketId)?.leave(room.roomCode);
      io.sockets.sockets.get(newSocketId)?.join(room.roomCode);
      emitRoom(room);
      transferred = true;
    }

    const zjhRoom = zjhRoomManager.reassignSocket(oldSocketId, newSocketId);
    if (zjhRoom) {
      io.sockets.sockets.get(oldSocketId)?.leave(zjhSocketRoom(zjhRoom.roomCode));
      io.sockets.sockets.get(newSocketId)?.join(zjhSocketRoom(zjhRoom.roomCode));
      emitZjhRoom(zjhRoom);
      transferred = true;
    }

    const dbzRoom = daBanZiRoomManager.reassignSocket(oldSocketId, newSocketId);
    if (dbzRoom) {
      io.sockets.sockets.get(oldSocketId)?.leave(dbzSocketRoom(dbzRoom.roomCode));
      io.sockets.sockets.get(newSocketId)?.join(dbzSocketRoom(dbzRoom.roomCode));
      emitDaBanZiRoom(dbzRoom);
      transferred = true;
    }

    const fighterRoom = fighterRoomManager.reassignSocket(oldSocketId, newSocketId);
    if (fighterRoom) {
      io.sockets.sockets.get(oldSocketId)?.leave(fighterSocketRoom(fighterRoom.roomCode));
      io.sockets.sockets.get(newSocketId)?.join(fighterSocketRoom(fighterRoom.roomCode));
      emitFighterRoom(fighterRoom);
      transferred = true;
    }

    return transferred;
  }

  function finalizeSocketGameDisconnect(socketId: string, sessionOverride?: SocketSession) {
    void recordSocketGameExits(socketId, "断线离场", sessionOverride);
    const room = roomManager.disconnect(socketId);
    const zjhRoom = zjhRoomManager.disconnect(socketId);
    const dbzRoom = daBanZiRoomManager.disconnect(socketId);
    const fighterRoom = fighterRoomManager.disconnect(socketId);

    emitRoom(room);
    if (room?.phase === "ended" && room.message) {
      io.to(room.roomCode).emit("game:ended", { message: room.message });
    }

    emitZjhRoom(zjhRoom);
    if (zjhRoom?.phase === "ended" && zjhRoom.result) {
      io.to(zjhSocketRoom(zjhRoom.roomCode)).emit("zjh:game:ended", { result: zjhRoom.result, message: zjhRoom.message });
    }

    emitDaBanZiRoom(dbzRoom);
    if (dbzRoom?.phase === "ended") {
      io.to(dbzSocketRoom(dbzRoom.roomCode)).emit("dbz:game:ended", { result: dbzRoom.result, message: dbzRoom.message });
    }

    emitFighterRoom(fighterRoom);
    if (fighterRoom?.phase === "ended") {
      io.to(fighterSocketRoom(fighterRoom.roomCode)).emit("fighter:game:ended", {
        result: fighterRoom.result,
        message: fighterRoom.message
      });
    }

    return { room, zjhRoom, dbzRoom, fighterRoom };
  }

  function scheduleGameDisconnect(socketId: string, session: { account: string; nickname: string; token: string }) {
    const hasGameRoom =
      Boolean(roomManager.getRoomForSocket(socketId)) ||
      Boolean(zjhRoomManager.getRoomForSocket(socketId)) ||
      Boolean(daBanZiRoomManager.getRoomForSocket(socketId)) ||
      Boolean(fighterRoomManager.getRoomForSocket(socketId));

    if (!hasGameRoom) {
      return false;
    }

    const previousPending = pendingGameDisconnects.get(session.account);
    if (previousPending) {
      clearTimeout(previousPending.timer);
      pendingGameDisconnects.delete(session.account);
      finalizeSocketGameDisconnect(previousPending.socketId, previousPending);
    }

    const timer = setTimeout(() => {
      pendingGameDisconnects.delete(session.account);
      const disconnected = finalizeSocketGameDisconnect(socketId, session);
      logger.info("socket.disconnect_finalized", {
        socketId,
        account: session.account,
        roomCode: disconnected.room?.roomCode,
        zjhRoomCode: disconnected.zjhRoom?.roomCode,
        dbzRoomCode: disconnected.dbzRoom?.roomCode,
        fighterRoomCode: disconnected.fighterRoom?.roomCode
      });
    }, reconnectGraceMs);
    timer.unref();

    pendingGameDisconnects.set(session.account, {
      socketId,
      account: session.account,
      nickname: session.nickname,
      token: session.token,
      timer
    });

    return true;
  }

  function restorePendingGameDisconnect(account: string, socketId: string) {
    const pending = pendingGameDisconnects.get(account);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timer);
    pendingGameDisconnects.delete(account);
    const restored = transferSocketGameRooms(pending.socketId, socketId);
    logger.info("socket.reconnected_to_game", {
      oldSocketId: pending.socketId,
      newSocketId: socketId,
      account,
      restored
    });
    return restored;
  }

  function requireSocketAuth(socketId: string) {
    const session = socketAuth.get(socketId);
    if (!session) {
      throw new AuthException("AUTH_REQUIRED", "请先登录后再操作。", 401);
    }

    return session;
  }

  async function bindSocketAuth(socketId: string, token: string) {
    const profile = await authManager.me(token);
    replaceAccountSessions(profile.account, socketId);
    const session = { account: profile.account, nickname: profile.nickname, token };
    socketAuth.set(socketId, session);
    restorePendingGameDisconnect(profile.account, socketId);
    logger.info("auth.socket_bound", { socketId, account: profile.account });
    return session;
  }

  function removeSocketFromGameRooms(socketId: string) {
    const room = roomManager.getRoomForSocket(socketId);
    if (room) {
      void recordDoudizhuExit(socketId, room, "账号下线");
      io.sockets.sockets.get(socketId)?.leave(room.roomCode);
      emitRoom(roomManager.leaveRoom(socketId));
    }

    const zjhRoom = zjhRoomManager.getRoomForSocket(socketId);
    if (zjhRoom) {
      void recordZjhExit(socketId, zjhRoom, "账号下线");
      io.sockets.sockets.get(socketId)?.leave(zjhSocketRoom(zjhRoom.roomCode));
      const updatedRoom = zjhRoomManager.leaveRoom(socketId);
      emitZjhRoom(updatedRoom);
      if (updatedRoom?.phase === "ended" && updatedRoom.result) {
        io.to(zjhSocketRoom(updatedRoom.roomCode)).emit("zjh:game:ended", {
          result: updatedRoom.result,
          message: updatedRoom.message
        });
      }
    }

    const daBanZiRoom = daBanZiRoomManager.getRoomForSocket(socketId);
    if (daBanZiRoom) {
      void recordDaBanZiExit(socketId, daBanZiRoom, "账号下线");
      io.sockets.sockets.get(socketId)?.leave(dbzSocketRoom(daBanZiRoom.roomCode));
      const updatedRoom = daBanZiRoomManager.leaveRoom(socketId);
      emitDaBanZiRoom(updatedRoom);
      if (updatedRoom?.phase === "ended" && updatedRoom.result) {
        io.to(dbzSocketRoom(updatedRoom.roomCode)).emit("dbz:game:ended", {
          result: updatedRoom.result,
          message: updatedRoom.message
        });
      }
    }

    const fighterRoom = fighterRoomManager.getRoomForSocket(socketId);
    if (fighterRoom) {
      void recordFighterExit(socketId, fighterRoom, "账号下线");
      io.sockets.sockets.get(socketId)?.leave(fighterSocketRoom(fighterRoom.roomCode));
      const updatedRoom = fighterRoomManager.leaveRoom(socketId);
      emitFighterRoom(updatedRoom);
      if (updatedRoom?.phase === "ended") {
        io.to(fighterSocketRoom(updatedRoom.roomCode)).emit("fighter:game:ended", {
          result: updatedRoom.result,
          message: updatedRoom.message
        });
      }
    }
  }

  function replaceAccountSessions(account: string, currentSocketId: string) {
    for (const [socketId, session] of [...socketAuth.entries()]) {
      if (socketId === currentSocketId || session.account !== account) {
        continue;
      }

      io.to(socketId).emit("auth:session_replaced", { message: "账号已在其他设备登录，当前设备已退出。" });
      const transferred = transferSocketGameRooms(socketId, currentSocketId);
      if (!transferred) {
        removeSocketFromGameRooms(socketId);
      }
      leaveChat(socketId);
      socketAuth.delete(socketId);
      logger.info("auth.session_replaced", { account, oldSocketId: socketId, newSocketId: currentSocketId, transferred });
    }
  }

  function notifyCleanedRoom(roomCode: string, socketIds: string[]) {
    for (const socketId of socketIds) {
      const client = io.sockets.sockets.get(socketId);
      client?.leave(roomCode);
      client?.emit("game:error", {
        code: "ROOM_CLEANED_UP",
        message: "房间长时间无操作，已自动清理。"
      });
    }
  }

  function runMaintenance() {
    const removedRooms = roomManager.cleanupRooms(Date.now(), cleanupOptions);
    for (const removedRoom of removedRooms) {
      notifyCleanedRoom(removedRoom.roomCode, removedRoom.socketIds);
      logger.info("room.cleaned_up", {
        roomCode: removedRoom.roomCode,
        reason: removedRoom.reason,
        socketCount: removedRoom.socketIds.length,
        roomCount: roomManager.getRoomCount()
      });
    }

  }

  if (!options.disableMaintenance) {
    const maintenanceTimer = setInterval(runMaintenance, roomCleanupIntervalMs);
    maintenanceTimer.unref();
    httpServer.on("close", () => clearInterval(maintenanceTimer));
    logger.info("maintenance.started", {
      roomCleanupIntervalMs,
      cleanupOptions
    });

    const fighterTickTimer = setInterval(() => {
      const rooms = fighterRoomManager.stepAll(Date.now());
      for (const room of rooms) {
        emitFighterRoom(room);
        if (room.phase === "ended" && room.result) {
          io.to(fighterSocketRoom(room.roomCode)).emit("fighter:game:ended", {
            result: room.result,
            message: room.message
          });
        }
      }
    }, fighterTickIntervalMs);
    fighterTickTimer.unref();
    httpServer.on("close", () => clearInterval(fighterTickTimer));
    logger.info("fighter.tick.started", { fighterTickIntervalMs });
  }

  httpServer.on("close", () => {
    for (const pending of pendingGameDisconnects.values()) {
      clearTimeout(pending.timer);
    }
    pendingGameDisconnects.clear();
    authManager.close().catch((error) => logger.error("auth.close_failed", { error }));
    gameHistoryRepository.close?.().catch((error) => logger.error("game_history.close_failed", { error }));
  });

  io.on("connection", (socket) => {
    logger.info("socket.connected", { socketId: socket.id });

    socket.on("auth:bind", async (payload) => {
      try {
        await bindSocketAuth(socket.id, payload.token);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:create", () => {
      try {
        const auth = requireSocketAuth(socket.id);
        const room = roomManager.createRoom(socket.id, auth.nickname);
        socket.join(room.roomCode);
        logger.info("room.created", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:join", (payload) => {
      try {
        const auth = requireSocketAuth(socket.id);
        joinRoomByCode(socket.id, payload.roomCode, auth);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:leave", async () => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (room) {
          await recordDoudizhuExit(socket.id, room, "主动离场");
          socket.leave(room.roomCode);
        }
        const updatedRoom = roomManager.leaveRoom(socket.id);
        logger.info("room.left", { roomCode: room?.roomCode, socketId: socket.id });
        emitRoom(updatedRoom);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("game:ready", () => {
      try {
        requireSocketAuth(socket.id);
        const room = roomManager.ready(socket.id);
        logger.info("game.ready", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("bid:choose", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const room = roomManager.chooseBid(socket.id, payload.score);
        logger.info("game.bid", { roomCode: room.roomCode, socketId: socket.id, score: payload.score, phase: room.phase });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("play:cards", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const { room, result } = roomManager.playCards(socket.id, payload.cardIds);
        logger.info("game.play", {
          roomCode: room.roomCode,
          socketId: socket.id,
          cardCount: payload.cardIds.length,
          phase: room.phase,
          ended: Boolean(result)
        });
        emitRoom(room);
        if (result) {
          io.to(room.roomCode).emit("game:ended", { result });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("play:pass", () => {
      try {
        requireSocketAuth(socket.id);
        const room = roomManager.pass(socket.id);
        logger.info("game.pass", { roomCode: room.roomCode, socketId: socket.id });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("chat:join", async (payload) => {
      try {
        await ensureAdminStateReady();
        const session = await bindSocketAuth(socket.id, payload.token);
        chatSessions.set(socket.id, session);
        socket.join(CHAT_ROOM);
        logger.info("chat.joined", { socketId: socket.id, account: session.account, onlineCount: chatSessions.size });
        emitChatState();
      } catch (error) {
        if (error instanceof AuthException) {
          emitChatError(socket.id, error.code, error.message);
          return;
        }

        emitChatError(socket.id, "CHAT_JOIN_FAILED", "加入大厅聊天失败。");
      }
    });

    socket.on("chat:send", async (payload) => {
      const session = chatSessions.get(socket.id);
      if (!session) {
        emitChatError(socket.id, "CHAT_UNAUTHORIZED", "请先登录后再发送聊天。");
        return;
      }

      try {
        await ensureAdminStateReady();
      } catch (error) {
        logger.error("chat.persistence_unavailable", { socketId: socket.id, error });
        emitChatError(socket.id, "CHAT_UNAVAILABLE", "大厅聊天暂不可用，请稍后再试。");
        return;
      }

      try {
        await authManager.me(session.token);
      } catch (error) {
        leaveChat(socket.id);
        socketAuth.delete(socket.id);
        if (error instanceof AuthException) {
          emitChatError(socket.id, error.code, error.message);
          if (error.code === "SESSION_REPLACED") {
            io.to(socket.id).emit("auth:session_replaced", { message: error.message });
            removeSocketFromGameRooms(socket.id);
          }
          return;
        }

        emitChatError(socket.id, "CHAT_UNAUTHORIZED", "请重新登录后再发送聊天。");
        return;
      }

      const mute = mutedChatAccounts.get(session.account);
      if (mute) {
        emitChatError(socket.id, "CHAT_MUTED", mute.reason ? `你已被禁言：${mute.reason}` : "你已被禁言。");
        return;
      }

      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) {
        emitChatError(socket.id, "CHAT_EMPTY", "请输入聊天内容。");
        return;
      }
      if (text.length > MAX_CHAT_TEXT_LENGTH) {
        emitChatError(socket.id, "CHAT_TOO_LONG", `聊天内容不能超过 ${MAX_CHAT_TEXT_LENGTH} 个字。`);
        return;
      }

      const message: ChatMessage = {
        id: randomUUID(),
        account: session.account,
        nickname: session.nickname,
        text,
        at: Date.now()
      };

      try {
        await adminRepository.addChatMessage(message);
        await adminRepository.trimChatMessages(MAX_CHAT_MESSAGES);
      } catch (error) {
        logger.error("chat.persist_failed", { socketId: socket.id, account: session.account, error });
        emitChatError(socket.id, "CHAT_SEND_FAILED", "发送聊天失败，请稍后再试。");
        return;
      }

      chatMessages.push(message);
      if (chatMessages.length > MAX_CHAT_MESSAGES) {
        chatMessages.splice(0, chatMessages.length - MAX_CHAT_MESSAGES);
      }

      logger.info("chat.message", { socketId: socket.id, account: session.account, length: text.length });
      io.to(CHAT_ROOM).emit("chat:message", { message });
    });

    socket.on("chat:leave", () => {
      leaveChat(socket.id);
    });

    socket.on("zjh:room:create", (payload) => {
      try {
        const auth = requireSocketAuth(socket.id);
        const room = zjhRoomManager.createRoom(socket.id, auth.nickname, payload.maxPlayers);
        socket.join(zjhSocketRoom(room.roomCode));
        logger.info("zjh.room.created", {
          roomCode: room.roomCode,
          socketId: socket.id,
          account: auth.account,
          nickname: auth.nickname,
          maxPlayers: room.maxPlayers
        });
        emitZjhRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:room:join", (payload) => {
      try {
        const auth = requireSocketAuth(socket.id);
        const requestedRoomCode = payload.roomCode.trim().toUpperCase();
        const currentRoom = zjhRoomManager.getRoomForSocket(socket.id);
        if (currentRoom) {
          if (currentRoom.roomCode !== requestedRoomCode) {
            throw new GameException("ALREADY_IN_ROOM", "你已经在一个炸金花房间里。");
          }

          socket.join(zjhSocketRoom(currentRoom.roomCode));
          logger.info("zjh.room.rejoined", { roomCode: currentRoom.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
          emitZjhRoom(currentRoom);
          return;
        }

        const room = zjhRoomManager.joinRoom(socket.id, payload.roomCode, auth.nickname);
        socket.join(zjhSocketRoom(room.roomCode));
        logger.info("zjh.room.joined", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitZjhRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:room:leave", async () => {
      try {
        const room = zjhRoomManager.getRoomForSocket(socket.id);
        if (room) {
          await recordZjhExit(socket.id, room, "主动离场");
          socket.leave(zjhSocketRoom(room.roomCode));
        }
        const updatedRoom = zjhRoomManager.leaveRoom(socket.id);
        logger.info("zjh.room.left", { roomCode: room?.roomCode, socketId: socket.id });
        emitZjhRoom(updatedRoom);
        if (updatedRoom?.phase === "ended" && updatedRoom.result) {
          io.to(zjhSocketRoom(updatedRoom.roomCode)).emit("zjh:game:ended", {
            result: updatedRoom.result,
            message: updatedRoom.message
          });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:game:ready", () => {
      try {
        requireSocketAuth(socket.id);
        const room = zjhRoomManager.ready(socket.id);
        logger.info("zjh.game.ready", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitZjhRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:action:see", () => {
      try {
        requireSocketAuth(socket.id);
        const room = zjhRoomManager.seeCards(socket.id);
        logger.info("zjh.action.see", { roomCode: room.roomCode, socketId: socket.id });
        emitZjhRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:action:call", () => {
      try {
        requireSocketAuth(socket.id);
        const room = zjhRoomManager.call(socket.id);
        logger.info("zjh.action.call", { roomCode: room.roomCode, socketId: socket.id, pot: room.pot });
        emitZjhRoom(room);
        if (room.phase === "ended") {
          io.to(zjhSocketRoom(room.roomCode)).emit("zjh:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:action:raise", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const room = zjhRoomManager.raise(socket.id, payload.amount);
        logger.info("zjh.action.raise", { roomCode: room.roomCode, socketId: socket.id, amount: payload.amount, pot: room.pot });
        emitZjhRoom(room);
        if (room.phase === "ended") {
          io.to(zjhSocketRoom(room.roomCode)).emit("zjh:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:action:fold", () => {
      try {
        requireSocketAuth(socket.id);
        const room = zjhRoomManager.fold(socket.id);
        logger.info("zjh.action.fold", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitZjhRoom(room);
        if (room.phase === "ended") {
          io.to(zjhSocketRoom(room.roomCode)).emit("zjh:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("zjh:action:compare", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const { room, reveal } = zjhRoomManager.compare(socket.id, payload.targetSeat);
        logger.info("zjh.action.compare", {
          roomCode: room.roomCode,
          socketId: socket.id,
          targetSeat: payload.targetSeat,
          phase: room.phase
        });
        io.to(socket.id).emit("zjh:compare:reveal", { reveal });
        emitZjhRoom(room);
        if (room.phase === "ended") {
          io.to(zjhSocketRoom(room.roomCode)).emit("zjh:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:room:create", () => {
      try {
        const auth = requireSocketAuth(socket.id);
        const room = daBanZiRoomManager.createRoom(socket.id, auth.nickname);
        socket.join(dbzSocketRoom(room.roomCode));
        logger.info("dbz.room.created", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitDaBanZiRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:room:join", (payload) => {
      try {
        const auth = requireSocketAuth(socket.id);
        const requestedRoomCode = payload.roomCode.trim().toUpperCase();
        const currentRoom = daBanZiRoomManager.getRoomForSocket(socket.id);
        if (currentRoom) {
          if (currentRoom.roomCode !== requestedRoomCode) {
            throw new GameException("ALREADY_IN_ROOM", "你已经在一个房间里。");
          }

          socket.join(dbzSocketRoom(currentRoom.roomCode));
          logger.info("dbz.room.rejoined", { roomCode: currentRoom.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
          emitDaBanZiRoom(currentRoom);
          return;
        }

        const room = daBanZiRoomManager.joinRoom(socket.id, payload.roomCode, auth.nickname);
        socket.join(dbzSocketRoom(room.roomCode));
        logger.info("dbz.room.joined", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitDaBanZiRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:room:leave", async () => {
      try {
        const room = daBanZiRoomManager.getRoomForSocket(socket.id);
        if (room) {
          await recordDaBanZiExit(socket.id, room, "主动离场");
          socket.leave(dbzSocketRoom(room.roomCode));
        }
        const updatedRoom = daBanZiRoomManager.leaveRoom(socket.id);
        logger.info("dbz.room.left", { roomCode: room?.roomCode, socketId: socket.id });
        emitDaBanZiRoom(updatedRoom);
        if (updatedRoom?.phase === "ended") {
          io.to(dbzSocketRoom(updatedRoom.roomCode)).emit("dbz:game:ended", {
            result: updatedRoom.result,
            message: updatedRoom.message
          });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:game:ready", () => {
      try {
        requireSocketAuth(socket.id);
        const room = daBanZiRoomManager.ready(socket.id);
        logger.info("dbz.game.ready", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitDaBanZiRoom(room);
        if (room.phase === "ended") {
          io.to(dbzSocketRoom(room.roomCode)).emit("dbz:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:bao:choose", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const room = daBanZiRoomManager.chooseBao(socket.id, payload.action);
        logger.info("dbz.bao.choose", { roomCode: room.roomCode, socketId: socket.id, action: payload.action, phase: room.phase });
        emitDaBanZiRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:partner:call", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const room = daBanZiRoomManager.callPartner(socket.id, payload.rank, payload.suit);
        logger.info("dbz.partner.call", { roomCode: room.roomCode, socketId: socket.id, rank: payload.rank, suit: payload.suit });
        emitDaBanZiRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:play:cards", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const { room, result } = daBanZiRoomManager.playCards(socket.id, payload.cardIds);
        logger.info("dbz.play", {
          roomCode: room.roomCode,
          socketId: socket.id,
          cardCount: payload.cardIds.length,
          phase: room.phase,
          ended: Boolean(result)
        });
        emitDaBanZiRoom(room);
        if (result) {
          io.to(dbzSocketRoom(room.roomCode)).emit("dbz:game:ended", { result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("dbz:play:pass", () => {
      try {
        requireSocketAuth(socket.id);
        const room = daBanZiRoomManager.pass(socket.id);
        logger.info("dbz.pass", { roomCode: room.roomCode, socketId: socket.id });
        emitDaBanZiRoom(room);
        if (room.phase === "ended") {
          io.to(dbzSocketRoom(room.roomCode)).emit("dbz:game:ended", { result: room.result, message: room.message });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("fighter:room:create", () => {
      try {
        const auth = requireSocketAuth(socket.id);
        const room = fighterRoomManager.createRoom(socket.id, auth.nickname);
        socket.join(fighterSocketRoom(room.roomCode));
        logger.info("fighter.room.created", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitFighterRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("fighter:room:join", (payload) => {
      try {
        const auth = requireSocketAuth(socket.id);
        const requestedRoomCode = payload.roomCode.trim().toUpperCase();
        const currentRoom = fighterRoomManager.getRoomForSocket(socket.id);
        if (currentRoom) {
          if (currentRoom.roomCode !== requestedRoomCode) {
            throw new GameException("ALREADY_IN_ROOM", "你已经在一个火柴人决斗房间里。");
          }

          socket.join(fighterSocketRoom(currentRoom.roomCode));
          logger.info("fighter.room.rejoined", { roomCode: currentRoom.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
          emitFighterRoom(currentRoom);
          return;
        }

        const room = fighterRoomManager.joinRoom(socket.id, payload.roomCode, auth.nickname);
        socket.join(fighterSocketRoom(room.roomCode));
        logger.info("fighter.room.joined", { roomCode: room.roomCode, socketId: socket.id, account: auth.account, nickname: auth.nickname });
        emitFighterRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("fighter:room:leave", async () => {
      try {
        const room = fighterRoomManager.getRoomForSocket(socket.id);
        if (room) {
          await recordFighterExit(socket.id, room, "主动离场");
          socket.leave(fighterSocketRoom(room.roomCode));
        }
        const updatedRoom = fighterRoomManager.leaveRoom(socket.id);
        logger.info("fighter.room.left", { roomCode: room?.roomCode, socketId: socket.id });
        emitFighterRoom(updatedRoom);
        if (updatedRoom?.phase === "ended") {
          io.to(fighterSocketRoom(updatedRoom.roomCode)).emit("fighter:game:ended", {
            result: updatedRoom.result,
            message: updatedRoom.message
          });
        }
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("fighter:game:ready", () => {
      try {
        requireSocketAuth(socket.id);
        const room = fighterRoomManager.ready(socket.id);
        logger.info("fighter.game.ready", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitFighterRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("fighter:input", (payload) => {
      try {
        requireSocketAuth(socket.id);
        const room = fighterRoomManager.updateInput(socket.id, payload);
        emitFighterRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("disconnect", () => {
      const session = socketAuth.get(socket.id);
      leaveChat(socket.id);
      if (session && scheduleGameDisconnect(socket.id, session)) {
        socketAuth.delete(socket.id);
        logger.info("socket.disconnected_pending_reconnect", {
          socketId: socket.id,
          account: session.account,
          reconnectGraceMs
        });
        return;
      }

      socketAuth.delete(socket.id);
      const { room, zjhRoom, dbzRoom, fighterRoom } = finalizeSocketGameDisconnect(socket.id, session);
      if (zjhRoom) {
        socket.leave(zjhSocketRoom(zjhRoom.roomCode));
      }
      if (dbzRoom) {
        socket.leave(dbzSocketRoom(dbzRoom.roomCode));
      }
      if (fighterRoom) {
        socket.leave(fighterSocketRoom(fighterRoom.roomCode));
      }
      logger.info("socket.disconnected", {
        socketId: socket.id,
        roomCode: room?.roomCode,
        phase: room?.phase,
        zjhRoomCode: zjhRoom?.roomCode,
        zjhPhase: zjhRoom?.phase,
        dbzRoomCode: dbzRoom?.roomCode,
        dbzPhase: dbzRoom?.phase,
        fighterRoomCode: fighterRoom?.roomCode,
        fighterPhase: fighterRoom?.phase
      });
    });
  });

  return {
    app,
    httpServer,
    io,
    roomManager,
    zjhRoomManager,
    daBanZiRoomManager,
    fighterRoomManager,
    authManager,
    logger,
    runMaintenance
  };
}
