import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { Socket } from "socket.io-client";
import type {
  ChatMessage,
  ClientToServerEvents,
  GameError,
  PlayerSeat,
  RoomView,
  ServerToClientEvents,
  ZjhRoomView
} from "@doudizhu/shared";
import { createGameServerWithOptions } from "./createGameServer.js";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

function waitForState(socket: ClientSocket): Promise<RoomView> {
  return new Promise((resolve) => {
    socket.once("room:state", ({ roomView }) => resolve(roomView));
  });
}

function waitForChatState(socket: ClientSocket): Promise<{ messages: ChatMessage[]; onlineCount: number }> {
  return new Promise((resolve) => {
    socket.once("chat:state", resolve);
  });
}

function waitForZjhState(socket: ClientSocket): Promise<ZjhRoomView> {
  return new Promise((resolve) => {
    socket.once("zjh:room:state", ({ roomView }) => resolve(roomView));
  });
}

function waitForZjhStateWhere(socket: ClientSocket, predicate: (roomView: ZjhRoomView) => boolean): Promise<ZjhRoomView> {
  return new Promise((resolve) => {
    const handler = ({ roomView }: { roomView: ZjhRoomView }) => {
      if (!predicate(roomView)) {
        return;
      }

      socket.off("zjh:room:state", handler);
      resolve(roomView);
    };

    socket.on("zjh:room:state", handler);
  });
}

function waitForChatMessage(socket: ClientSocket): Promise<ChatMessage> {
  return new Promise((resolve) => {
    socket.once("chat:message", ({ message }) => resolve(message));
  });
}

function waitForChatError(socket: ClientSocket): Promise<GameError> {
  return new Promise((resolve) => {
    socket.once("chat:error", resolve);
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

async function registerAccount(baseUrl: string, account: string, nickname: string) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, nickname, password: "password123" })
  });

  if (!response.ok) {
    throw new Error(`Failed to register ${account}`);
  }

  return (await response.json()) as { token: string; profile: { account: string; nickname: string } };
}

describe("socket game flow", () => {
  let httpServer: HttpServer;
  let ioServer: ReturnType<typeof createGameServerWithOptions>["io"];
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

  it("lets sockets create, join, ready, and play a zha jin hua room", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];

    const createdState = waitForZjhState(a);
    a.emit("zjh:room:create", { nickname: "甲", maxPlayers: 4 });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForZjhState(b);
    b.emit("zjh:room:join", { roomCode, nickname: "乙" });
    await joinedB;

    const playingState = waitForZjhStateWhere(a, (roomView) => roomView.phase === "playing");
    a.emit("zjh:game:ready");
    b.emit("zjh:game:ready");
    const state = await playingState;

    expect(state.phase).toBe("playing");
    expect(state.players).toHaveLength(2);
    expect(state.pot).toBe(2);
    expect(state.players.find((player) => player.seat === state.selfSeat)?.hand).toBeUndefined();

    const currentTurn = state.currentTurn;
    if (currentTurn === undefined) {
      throw new Error("Missing zha jin hua current turn");
    }

    const socketsBySeat: Record<number, ClientSocket> = { 0: a, 1: b };
    const afterSee = waitForZjhStateWhere(
      socketsBySeat[currentTurn],
      (roomView) => Boolean(roomView.players.find((player) => player.seat === currentTurn)?.hand)
    );
    socketsBySeat[currentTurn].emit("zjh:action:see");
    const seenState = await afterSee;

    expect(seenState.players.find((player) => player.seat === currentTurn)?.hand).toHaveLength(3);
  });

  it("rejects chat messages before a socket joins chat", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];

    const errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "有人吗" });
    const error = await errorPromise;

    expect(error.code).toBe("CHAT_UNAUTHORIZED");
  });

  it("rejects chat joins with an invalid token", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];

    const errorPromise = waitForChatError(client);
    client.emit("chat:join", { token: "bad-token" });
    const error = await errorPromise;

    expect(error.code).toBe("UNAUTHORIZED");
  });

  it("broadcasts global chat messages to joined sockets", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    const accountA = await registerAccount(baseUrl, "alpha", "甲");
    const accountB = await registerAccount(baseUrl, "beta", "乙");

    const joinedA = waitForChatState(a);
    a.emit("chat:join", { token: accountA.token });
    expect((await joinedA).onlineCount).toBe(1);

    const joinedB = waitForChatState(b);
    b.emit("chat:join", { token: accountB.token });
    expect((await joinedB).onlineCount).toBe(2);

    const receivedByB = waitForChatMessage(b);
    a.emit("chat:send", { text: "开一局" });
    const message = await receivedByB;

    expect(message.nickname).toBe("甲");
    expect(message.account).toBe("alpha");
    expect(message.text).toBe("开一局");
  });

  it("rejects empty and too-long chat messages", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];
    const account = await registerAccount(baseUrl, "gamma", "丙");

    const joined = waitForChatState(client);
    client.emit("chat:join", { token: account.token });
    await joined;

    let errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "   " });
    expect((await errorPromise).code).toBe("CHAT_EMPTY");

    errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "太".repeat(121) });
    expect((await errorPromise).code).toBe("CHAT_TOO_LONG");
  });

  it("keeps the latest 50 chat messages in memory", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    const accountA = await registerAccount(baseUrl, "delta", "丁");
    const accountB = await registerAccount(baseUrl, "epsilon", "戊");

    const joinedA = waitForChatState(a);
    a.emit("chat:join", { token: accountA.token });
    await joinedA;

    for (let index = 0; index < 55; index += 1) {
      const received = waitForChatMessage(a);
      a.emit("chat:send", { text: `消息${index}` });
      await received;
    }

    const joinedB = waitForChatState(b);
    b.emit("chat:join", { token: accountB.token });
    const state = await joinedB;

    expect(state.messages).toHaveLength(50);
    expect(state.messages[0].text).toBe("消息5");
    expect(state.messages[49].text).toBe("消息54");
  });
});
