import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ChatMessage, ClientToServerEvents, ServerToClientEvents } from "@doudizhu/shared";
import { AuthException, AuthManager } from "./authManager.js";
import { GameException, RoomManager } from "./roomManager.js";
import type { InternalRoom } from "./roomManager.js";

function getBearerToken(header: string | undefined) {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }

  return header.slice("Bearer ".length).trim();
}

const CHAT_ROOM = "hall-chat";
const MAX_CHAT_MESSAGES = 50;
const MAX_CHAT_TEXT_LENGTH = 120;

export function createGameServer() {
  return createGameServerWithOptions();
}

export function createGameServerWithOptions(options: { authStorePath?: string | null } = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["GET", "POST"]
    }
  });
  const authManager = new AuthManager(options.authStorePath);
  const roomManager = new RoomManager();
  const chatMessages: ChatMessage[] = [];
  const chatSessions = new Map<string, { account: string; nickname: string }>();

  app.use(cors());
  app.use(express.json());
  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  function sendAuthError(response: express.Response, error: unknown) {
    if (error instanceof AuthException) {
      response.status(error.status).json({ code: error.code, message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "服务器发生未知错误。";
    response.status(500).json({ code: "SERVER_ERROR", message });
  }

  app.post("/api/auth/register", (request, response) => {
    try {
      response.json(authManager.register(request.body));
    } catch (error) {
      sendAuthError(response, error);
    }
  });

  app.post("/api/auth/login", (request, response) => {
    try {
      response.json(authManager.login(request.body));
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
      io.to(socketId).emit("game:error", { code: error.code, message: error.message });
      return;
    }

    const message = error instanceof Error ? error.message : "服务器发生未知错误。";
    io.to(socketId).emit("game:error", { code: "SERVER_ERROR", message });
  }

  function emitChatState() {
    io.to(CHAT_ROOM).emit("chat:state", {
      messages: chatMessages,
      onlineCount: chatSessions.size
    });
  }

  function emitChatError(socketId: string, code: string, message: string) {
    io.to(socketId).emit("chat:error", { code, message });
  }

  function leaveChat(socketId: string) {
    const wasInChat = chatSessions.delete(socketId);
    if (wasInChat) {
      io.sockets.sockets.get(socketId)?.leave(CHAT_ROOM);
      emitChatState();
    }
  }

  io.on("connection", (socket) => {
    socket.on("room:create", (payload) => {
      try {
        const room = roomManager.createRoom(socket.id, payload.nickname);
        socket.join(room.roomCode);
        emitRoom(room);
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("room:join", (payload) => {
      try {
        const room = roomManager.joinRoom(socket.id, payload.roomCode, payload.nickname);
        socket.join(room.roomCode);
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
        emitRoom(roomManager.leaveRoom(socket.id));
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("game:ready", () => {
      try {
        emitRoom(roomManager.ready(socket.id));
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("bid:choose", (payload) => {
      try {
        emitRoom(roomManager.chooseBid(socket.id, payload.score));
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("play:cards", (payload) => {
      try {
        const { room, result } = roomManager.playCards(socket.id, payload.cardIds);
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
        emitRoom(roomManager.pass(socket.id));
      } catch (error) {
        handleError(socket.id, error);
      }
    });

    socket.on("chat:join", (payload) => {
      try {
        const profile = authManager.me(payload.token);
        chatSessions.set(socket.id, { account: profile.account, nickname: profile.nickname });
        socket.join(CHAT_ROOM);
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

      io.to(CHAT_ROOM).emit("chat:message", { message });
    });

    socket.on("chat:leave", () => {
      leaveChat(socket.id);
    });

    socket.on("disconnect", () => {
      leaveChat(socket.id);
      const room = roomManager.disconnect(socket.id);
      emitRoom(room);
      if (room?.phase === "ended" && room.message) {
        io.to(room.roomCode).emit("game:ended", { message: room.message });
      }
    });
  });

  return { app, httpServer, io, roomManager, authManager };
}
