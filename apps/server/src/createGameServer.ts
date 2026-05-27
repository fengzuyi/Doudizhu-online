import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@doudizhu/shared";
import { AuthException, AuthManager } from "./authManager.js";
import { GameException, RoomManager } from "./roomManager.js";
import type { InternalRoom } from "./roomManager.js";
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
  authStorePath?: string | null;
  logger?: AppLogger;
  disableMaintenance?: boolean;
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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
  const authManager = new AuthManager(options.authStorePath);
  const roomManager = new RoomManager();
  const chatMessages: ChatMessage[] = [];
  const chatSessions = new Map<string, { account: string; nickname: string }>();
  const cleanupOptions = {
    emptyRoomTtlMs: numberFromEnv("EMPTY_ROOM_TTL_MS", 60_000),
    endedRoomTtlMs: numberFromEnv("ENDED_ROOM_TTL_MS", 30 * 60_000),
    lobbyRoomTtlMs: numberFromEnv("LOBBY_ROOM_TTL_MS", 2 * 60 * 60_000)
  };
  const roomCleanupIntervalMs = numberFromEnv("ROOM_CLEANUP_INTERVAL_MS", 5 * 60_000);
  const authBackupIntervalMs = numberFromEnv("AUTH_BACKUP_INTERVAL_MS", 6 * 60 * 60_000);
  let nextAuthBackupAt = Date.now() + authBackupIntervalMs;

  app.use(cors({ origin: clientOrigins }));
  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

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

  app.post("/api/auth/register", (request, response) => {
    try {
      const result = authManager.register(request.body);
      logger.info("auth.registered", { account: result.profile.account, nickname: result.profile.nickname });
      response.json(result);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/login", (request, response) => {
    try {
      const result = authManager.login(request.body);
      logger.info("auth.login", { account: result.profile.account, nickname: result.profile.nickname });
      response.json(result);
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.get("/api/auth/me", (request, response) => {
    try {
      const token = getBearerToken(request.headers.authorization);
      response.json({ profile: authManager.me(token) });
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/logout", (request, response) => {
    const token = getBearerToken(request.headers.authorization);
    authManager.logout(token);
    logger.info("auth.logout");
    response.json({ ok: true });
  });

  function emitRoom(room: InternalRoom | undefined) {
    if (!room) {
      return;
    }

    for (const { socketId, roomView } of roomManager.buildViews(room)) {
      io.to(socketId).emit("room:state", { roomView });
    }
  }

  function handleError(socketId: string, error: unknown) {
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

    const now = Date.now();
    if (now >= nextAuthBackupAt) {
      try {
        const backup = authManager.backupAccounts();
        if (backup) {
          logger.info("auth.backup_created", { path: backup.path, accountCount: backup.accountCount });
        }
      } catch (error) {
        logger.error("auth.backup_failed", { error });
      } finally {
        nextAuthBackupAt = now + authBackupIntervalMs;
      }
    }
  }

  if (!options.disableMaintenance) {
    const maintenanceTimer = setInterval(runMaintenance, roomCleanupIntervalMs);
    maintenanceTimer.unref();
    httpServer.on("close", () => clearInterval(maintenanceTimer));
    logger.info("maintenance.started", {
      roomCleanupIntervalMs,
      authBackupIntervalMs,
      cleanupOptions,
      authStorePath: authManager.getStorePath()
    });
  }

  io.on("connection", (socket) => {
    logger.info("socket.connected", { socketId: socket.id });

    socket.on("room:create", (payload) => {
      try {
        const room = roomManager.createRoom(socket.id, payload.nickname);
        socket.join(room.roomCode);
        logger.info("room.created", { roomCode: room.roomCode, socketId: socket.id, nickname: payload.nickname });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:join", (payload) => {
      try {
        const room = roomManager.joinRoom(socket.id, payload.roomCode, payload.nickname);
        socket.join(room.roomCode);
        logger.info("room.joined", { roomCode: room.roomCode, socketId: socket.id, nickname: payload.nickname });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:leave", () => {
      try {
        const room = roomManager.getRoomForSocket(socket.id);
        if (room) {
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
        const room = roomManager.ready(socket.id);
        logger.info("game.ready", { roomCode: room.roomCode, socketId: socket.id, phase: room.phase });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("bid:choose", (payload) => {
      try {
        const room = roomManager.chooseBid(socket.id, payload.score);
        logger.info("game.bid", { roomCode: room.roomCode, socketId: socket.id, score: payload.score, phase: room.phase });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("play:cards", (payload) => {
      try {
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
        const room = roomManager.pass(socket.id);
        logger.info("game.pass", { roomCode: room.roomCode, socketId: socket.id });
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("chat:join", (payload) => {
      try {
        const profile = authManager.me(payload.token);
        chatSessions.set(socket.id, { account: profile.account, nickname: profile.nickname });
        socket.join(CHAT_ROOM);
        logger.info("chat.joined", { socketId: socket.id, account: profile.account, onlineCount: chatSessions.size });
        emitChatState();
      } catch (error) {
        if (error instanceof AuthException) {
          emitChatError(socket.id, error.code, error.message);
          return;
        }

        emitChatError(socket.id, "CHAT_JOIN_FAILED", "加入大厅聊天失败。");
      }
    });

    socket.on("chat:send", (payload) => {
      const session = chatSessions.get(socket.id);
      if (!session) {
        emitChatError(socket.id, "CHAT_UNAUTHORIZED", "请先登录后再发送聊天。");
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

    socket.on("disconnect", () => {
      leaveChat(socket.id);
      const room = roomManager.disconnect(socket.id);
      logger.info("socket.disconnected", { socketId: socket.id, roomCode: room?.roomCode, phase: room?.phase });
      emitRoom(room);
      if (room?.phase === "ended" && room.message) {
        io.to(room.roomCode).emit("game:ended", { message: room.message });
      }
    });
  });

  return { app, httpServer, io, roomManager, authManager, logger, runMaintenance };
}
