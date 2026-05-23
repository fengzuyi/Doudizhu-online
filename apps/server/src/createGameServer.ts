import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@doudizhu/shared";
import { GameException, RoomManager } from "./roomManager.js";
import type { InternalRoom } from "./roomManager.js";

export function createGameServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["GET", "POST"]
    }
  });
  const roomManager = new RoomManager();

  app.use(cors());
  app.use(express.json());
  app.get("/health", (_request, response) => {
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
        emitRoom(roomManager.chooseBid(socket.id, payload.action));
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

    socket.on("disconnect", () => {
      const room = roomManager.disconnect(socket.id);
      emitRoom(room);
      if (room?.phase === "ended" && room.message) {
        io.to(room.roomCode).emit("game:ended", { message: room.message });
      }
    });
  });

  return { app, httpServer, io, roomManager };
}
