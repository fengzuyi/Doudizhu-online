import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, PlayerSeat, RoomView, ServerToClientEvents } from "@doudizhu/shared";
import { createGameServerWithOptions } from "./createGameServer.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function waitForState(socket: ClientSocket): Promise<RoomView> {
  return new Promise((resolve) => {
    socket.once("room:state", ({ roomView }) => resolve(roomView));
  });
}

function waitForStateWhere(socket: ClientSocket, predicate: (roomView: RoomView) => boolean): Promise<RoomView> {
  return new Promise((resolve) => {
    const handler = ({ roomView }: { roomView: RoomView }) => {
      if (!predicate(roomView)) {
        return;
      }

      socket.off("room:state", handler);
      resolve(roomView);
    };

    socket.on("room:state", handler);
  });
}

function connectClient(url: string): Promise<ClientSocket> {
  const socket: ClientSocket = createClient(url, {
    transports: ["websocket"],
    forceNew: true
  });

  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

describe("socket game flow", () => {
  let httpServer: HttpServer;
  let ioServer: ReturnType<typeof createGameServer>["io"];
  let baseUrl = "";
  let clients: ClientSocket[] = [];

  beforeEach(async () => {
    const created = createGameServerWithOptions({ authStorePath: null });
    httpServer = created.httpServer;
    ioServer = created.io;

    await new Promise<void>((resolve) => {
      httpServer.listen(0, resolve);
    });

    const address = httpServer.address() as AddressInfo;
    baseUrl = `http://localhost:${address.port}`;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.disconnect();
    }
    clients = [];
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it("lets three sockets create, join, ready, bid, and enter playing phase", async () => {
    const [a, b, c] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b, c];

    const createdState = waitForState(a);
    a.emit("room:create", { nickname: "甲" });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForState(b);
    b.emit("room:join", { roomCode, nickname: "乙" });
    await joinedB;

    const joinedC = waitForState(c);
    c.emit("room:join", { roomCode, nickname: "丙" });
    await joinedC;

    const biddingState = waitForStateWhere(a, (roomView) => roomView.phase === "bidding");
    a.emit("game:ready");
    b.emit("game:ready");
    c.emit("game:ready");
    let state = await biddingState;
    expect(state.phase).toBe("bidding");

    const socketsBySeat: Record<PlayerSeat, ClientSocket> = { 0: a, 1: b, 2: c };
    const firstBidSeat = state.currentTurn;
    if (firstBidSeat === undefined) {
      throw new Error("Missing first bid seat");
    }

    let nextState = waitForState(a);
    socketsBySeat[firstBidSeat].emit("bid:choose", { score: 1 });
    state = await nextState;

    const highestBidSeat = state.currentTurn;
    if (highestBidSeat === undefined) {
      throw new Error("Missing second bid seat");
    }

    nextState = waitForState(a);
    socketsBySeat[highestBidSeat].emit("bid:choose", { score: 2 });
    state = await nextState;

    const finalBidSeat = state.currentTurn;
    if (finalBidSeat === undefined) {
      throw new Error("Missing final bid seat");
    }

    nextState = waitForState(a);
    socketsBySeat[finalBidSeat].emit("bid:choose", { score: 0 });
    state = await nextState;

    const view = state;
    expect(view.phase).toBe("playing");
    expect(view.landlordSeat).toBe(highestBidSeat);
    expect(view.players.find((player) => player.seat === highestBidSeat)?.cardCount).toBe(20);
  });
});
