import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@doudizhu/shared";

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io("/", {
  autoConnect: true,
  transports: ["websocket"]
});
