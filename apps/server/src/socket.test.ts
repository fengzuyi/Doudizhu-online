import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import type { Socket } from "socket.io-client";
import { TokenVerifier } from "livekit-server-sdk";
import type {
  ChatMessage,
  ClientToServerEvents,
  DaBanZiRoomView,
  GameError,
  GameSessionRecord,
  PlayerSeat,
  RoomView,
  ServerToClientEvents,
  ZjhRoomView
} from "@doudizhu/shared";
import { createGameServerWithOptions } from "./createGameServer.js";
import { InMemoryAuthRepository } from "./authRepository.js";

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

function waitForDaBanZiState(socket: ClientSocket): Promise<DaBanZiRoomView> {
  return new Promise((resolve) => {
    socket.once("dbz:room:state", ({ roomView }) => resolve(roomView));
  });
}

function waitForDaBanZiStateWhere(
  socket: ClientSocket,
  predicate: (roomView: DaBanZiRoomView) => boolean
): Promise<DaBanZiRoomView> {
  return new Promise((resolve) => {
    const handler = ({ roomView }: { roomView: DaBanZiRoomView }) => {
      if (!predicate(roomView)) {
        return;
      }

      socket.off("dbz:room:state", handler);
      resolve(roomView);
    };

    socket.on("dbz:room:state", handler);
  });
}

function waitForChatState(socket: ClientSocket): Promise<{ messages: ChatMessage[]; onlineCount: number }> {
  return new Promise((resolve) => {
    socket.once("chat:state", resolve);
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

function waitForGameError(socket: ClientSocket): Promise<GameError> {
  return new Promise((resolve) => {
    socket.once("game:error", resolve);
  });
}

function waitForSessionReplaced(socket: ClientSocket): Promise<{ message: string }> {
  return new Promise((resolve) => {
    socket.once("auth:session_replaced", resolve);
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

async function loginAccount(baseUrl: string, account: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, password: "password123" })
  });

  if (!response.ok) {
    throw new Error(`Failed to log in ${account}`);
  }

  return (await response.json()) as { token: string; profile: { account: string; nickname: string } };
}

async function bindRegisteredAccount(baseUrl: string, socket: ClientSocket, account: string, nickname: string) {
  const registered = await registerAccount(baseUrl, account, nickname);
  const joined = waitForChatState(socket);
  socket.emit("chat:join", { token: registered.token });
  await joined;
  return registered;
}

async function waitForGameRecords(baseUrl: string, token: string, minimumCount = 1): Promise<GameSessionRecord[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1200) {
    const response = await fetch(`${baseUrl}/api/game-records`, {
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch game records: ${response.status}`);
    }

    const body = (await response.json()) as { records: GameSessionRecord[] };
    if (body.records.length >= minimumCount) {
      return body.records;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for game records.");
}

describe("socket game flow", () => {
  let httpServer: HttpServer;
  let ioServer: ReturnType<typeof createGameServerWithOptions>["io"];
  let baseUrl = "";
  let clients: ClientSocket[] = [];

  beforeEach(async () => {
    const created = createGameServerWithOptions({ authRepository: new InMemoryAuthRepository() });
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

  it("requires socket auth before creating a room", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];

    const errorPromise = waitForGameError(client);
    client.emit("room:create", { nickname: "Anonymous" });
    const error = await errorPromise;

    expect(error.code).toBe("AUTH_REQUIRED");
  });

  it("lets three sockets create, join, ready, bid, and enter playing phase", async () => {
    const [a, b, c] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b, c];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "ddz-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "ddz-b", "Player B"),
      bindRegisteredAccount(baseUrl, c, "ddz-c", "Player C")
    ]);

    const createdState = waitForState(a);
    a.emit("room:create", { nickname: "Ignored A" });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForState(b);
    b.emit("room:join", { roomCode, nickname: "Ignored B" });
    await joinedB;

    const joinedC = waitForState(c);
    c.emit("room:join", { roomCode, nickname: "Ignored C" });
    await joinedC;

    const biddingState = waitForStateWhere(a, (roomView) => roomView.phase === "bidding");
    a.emit("game:ready");
    b.emit("game:ready");
    c.emit("game:ready");
    let state = await biddingState;
    expect(state.phase).toBe("bidding");
    expect(state.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B", "Player C"]);

    const socketsBySeat: Record<PlayerSeat, ClientSocket> = { 0: a, 1: b, 2: c };
    const firstBidSeat = state.currentTurn;
    if (firstBidSeat === undefined) {
      throw new Error("Missing first bid seat");
    }

    let nextState = waitForState(a);
    socketsBySeat[firstBidSeat].emit("bid:choose", { score: 1 });
    state = await nextState;

    const secondBidSeat = state.currentTurn;
    if (secondBidSeat === undefined) {
      throw new Error("Missing second bid seat");
    }

    nextState = waitForState(a);
    socketsBySeat[secondBidSeat].emit("bid:choose", { score: 2 });
    state = await nextState;

    const finalBidSeat = state.currentTurn;
    if (finalBidSeat === undefined) {
      throw new Error("Missing final bid seat");
    }

    nextState = waitForState(a);
    socketsBySeat[finalBidSeat].emit("bid:choose", { score: 0 });
    state = await nextState;

    expect(state.phase).toBe("playing");
    expect(state.landlordSeat).toBe(secondBidSeat);
    expect(state.players.find((player) => player.seat === secondBidSeat)?.cardCount).toBe(20);
  });

  it("lets sockets create, join, ready, and play a zha jin hua room", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "zjh-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "zjh-b", "Player B")
    ]);

    const createdState = waitForZjhState(a);
    a.emit("zjh:room:create", { nickname: "Ignored A", maxPlayers: 4 });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForZjhState(b);
    b.emit("zjh:room:join", { roomCode, nickname: "Ignored B" });
    await joinedB;

    const playingState = waitForZjhStateWhere(a, (roomView) => roomView.phase === "playing");
    a.emit("zjh:game:ready");
    b.emit("zjh:game:ready");
    const state = await playingState;

    expect(state.phase).toBe("playing");
    expect(state.players).toHaveLength(2);
    expect(state.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B"]);
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

  it("keeps a zha jin hua seat when the same account reconnects after refresh", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    const [accountA] = await Promise.all([
      bindRegisteredAccount(baseUrl, a, "zjh-refresh-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "zjh-refresh-b", "Player B")
    ]);

    const createdState = waitForZjhState(a);
    a.emit("zjh:room:create", { nickname: "Ignored A", maxPlayers: 4 });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForZjhState(b);
    b.emit("zjh:room:join", { roomCode, nickname: "Ignored B" });
    await joinedB;

    const playingState = waitForZjhStateWhere(a, (roomView) => roomView.phase === "playing");
    a.emit("zjh:game:ready");
    b.emit("zjh:game:ready");
    const state = await playingState;
    const originalSeat = state.selfSeat;

    a.disconnect();
    const refreshed = await connectClient(baseUrl);
    clients.push(refreshed);

    const restoredState = waitForZjhState(refreshed);
    refreshed.emit("auth:bind", { token: accountA.token });
    const restored = await restoredState;

    expect(restored.roomCode).toBe(roomCode);
    expect(restored.phase).toBe("playing");
    expect(restored.selfSeat).toBe(originalSeat);
    expect(restored.players.find((player) => player.seat === originalSeat)?.folded).toBe(false);
    expect(restored.players.find((player) => player.seat === originalSeat)?.connected).toBe(true);
    expect(restored.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B"]);
  });

  it("returns the current zha jin hua room when an existing player joins the same room again", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "zjh-rejoin-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "zjh-rejoin-b", "Player B")
    ]);

    const createdState = waitForZjhState(a);
    a.emit("zjh:room:create", { nickname: "Ignored A", maxPlayers: 4 });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForZjhState(b);
    b.emit("zjh:room:join", { roomCode, nickname: "Ignored B" });
    await joinedB;

    const rejoinedState = waitForZjhState(a);
    a.emit("zjh:room:join", { roomCode, nickname: "Ignored A" });
    const rejoined = await rejoinedState;

    expect(rejoined.roomCode).toBe(roomCode);
    expect(rejoined.selfSeat).toBe(0);
    expect(rejoined.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B"]);
  });

  it("joins a zha jin hua room from the generic room code entry", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "zjh-generic-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "zjh-generic-b", "Player B")
    ]);

    const createdState = waitForZjhState(a);
    a.emit("zjh:room:create", { nickname: "Ignored A", maxPlayers: 4 });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForZjhState(b);
    b.emit("room:join", { roomCode, nickname: "Ignored B" });
    const state = await joinedB;

    expect(state.roomCode).toBe(roomCode);
    expect(state.selfSeat).toBe(1);
    expect(state.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B"]);
  });

  it("lets four sockets create, join, ready, and enter da ban zi bao phase", async () => {
    const [a, b, c, d] = await Promise.all([
      connectClient(baseUrl),
      connectClient(baseUrl),
      connectClient(baseUrl),
      connectClient(baseUrl)
    ]);
    clients = [a, b, c, d];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "dbz-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "dbz-b", "Player B"),
      bindRegisteredAccount(baseUrl, c, "dbz-c", "Player C"),
      bindRegisteredAccount(baseUrl, d, "dbz-d", "Player D")
    ]);

    const createdState = waitForDaBanZiState(a);
    a.emit("dbz:room:create", { nickname: "Ignored A" });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForDaBanZiState(b);
    b.emit("dbz:room:join", { roomCode, nickname: "Ignored B" });
    await joinedB;

    const joinedC = waitForDaBanZiState(c);
    c.emit("dbz:room:join", { roomCode, nickname: "Ignored C" });
    await joinedC;

    const joinedD = waitForDaBanZiState(d);
    d.emit("dbz:room:join", { roomCode, nickname: "Ignored D" });
    await joinedD;

    const baoState = waitForDaBanZiStateWhere(a, (roomView) => roomView.phase === "bao" || roomView.phase === "ended");
    a.emit("dbz:game:ready");
    b.emit("dbz:game:ready");
    c.emit("dbz:game:ready");
    d.emit("dbz:game:ready");
    const state = await baoState;

    expect(state.playerCount).toBe(4);
    expect(state.players).toHaveLength(4);
    expect(state.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B", "Player C", "Player D"]);
    expect(state.phase).toBe("bao");
    expect(state.baoCurrentSeat).toBeDefined();
    expect(state.players.find((player) => player.seat === state.selfSeat)?.hand).toHaveLength(13);
    expect(state.players.find((player) => player.seat !== state.selfSeat)?.hand).toBeUndefined();
  });

  it("joins a da ban zi room from the generic room code entry", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    await Promise.all([
      bindRegisteredAccount(baseUrl, a, "dbz-generic-a", "Player A"),
      bindRegisteredAccount(baseUrl, b, "dbz-generic-b", "Player B")
    ]);

    const createdState = waitForDaBanZiState(a);
    a.emit("dbz:room:create", { nickname: "Ignored A" });
    const roomCode = (await createdState).roomCode;

    const joinedB = waitForDaBanZiState(b);
    b.emit("room:join", { roomCode, nickname: "Ignored B" });
    const state = await joinedB;

    expect(state.roomCode).toBe(roomCode);
    expect(state.selfSeat).toBe(1);
    expect(state.players.map((player) => player.nickname).sort()).toEqual(["Player A", "Player B"]);
  });

  it("rejects voice tokens before the account joins the requested room", async () => {
    const account = await registerAccount(baseUrl, "voice-outsider", "Voice Outsider");

    const response = await fetch(`${baseUrl}/api/voice/token`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${account.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ gameKind: "doudizhu", roomCode: "ABCD" })
    });
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(403);
    expect(body.code).toBe("VOICE_ROOM_FORBIDDEN");
  });

  it("issues scoped LiveKit voice tokens for players in a room", async () => {
    const previousLiveKitUrl = process.env.LIVEKIT_URL;
    const previousLiveKitApiKey = process.env.LIVEKIT_API_KEY;
    const previousLiveKitApiSecret = process.env.LIVEKIT_API_SECRET;
    process.env.LIVEKIT_URL = "ws://livekit.test";
    process.env.LIVEKIT_API_KEY = "test-api-key";
    process.env.LIVEKIT_API_SECRET = "test-secret";

    try {
      const client = await connectClient(baseUrl);
      clients = [client];
      const account = await bindRegisteredAccount(baseUrl, client, "voice-alpha", "Voice Alpha");

      const createdState = waitForState(client);
      client.emit("room:create", { nickname: "Ignored" });
      const roomCode = (await createdState).roomCode;

      const response = await fetch(`${baseUrl}/api/voice/token`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${account.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ gameKind: "doudizhu", roomCode })
      });
      const body = (await response.json()) as { url: string; token: string; roomName: string; participantName: string };

      expect(response.status).toBe(200);
      expect(body.url).toBe("ws://livekit.test");
      expect(body.roomName).toBe(`voice_doudizhu_${roomCode}`);
      expect(body.participantName).toBe("Voice Alpha");

      const grants = await new TokenVerifier("test-api-key", "test-secret").verify(body.token);
      expect(grants.sub).toBe("voice-alpha");
      expect(grants.name).toBe("Voice Alpha");
      expect(grants.video?.roomJoin).toBe(true);
      expect(grants.video?.room).toBe(`voice_doudizhu_${roomCode}`);
      expect(grants.video?.canPublish).toBe(true);
      expect(grants.video?.canSubscribe).toBe(true);
      expect(grants.video?.canPublishData).toBe(false);
      expect(grants.video?.canPublishSources).toEqual(["microphone"]);
    } finally {
      if (previousLiveKitUrl === undefined) {
        delete process.env.LIVEKIT_URL;
      } else {
        process.env.LIVEKIT_URL = previousLiveKitUrl;
      }
      if (previousLiveKitApiKey === undefined) {
        delete process.env.LIVEKIT_API_KEY;
      } else {
        process.env.LIVEKIT_API_KEY = previousLiveKitApiKey;
      }
      if (previousLiveKitApiSecret === undefined) {
        delete process.env.LIVEKIT_API_SECRET;
      } else {
        process.env.LIVEKIT_API_SECRET = previousLiveKitApiSecret;
      }
    }
  });

  it("records a game session when a player leaves a room", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];
    const account = await bindRegisteredAccount(baseUrl, client, "record-alpha", "Record Alpha");

    const createdState = waitForState(client);
    client.emit("room:create", { nickname: "Ignored" });
    const room = await createdState;

    client.emit("room:leave");
    const records = await waitForGameRecords(baseUrl, account.token);

    expect(records[0]).toMatchObject({
      account: "record-alpha",
      nickname: "Record Alpha",
      gameKind: "doudizhu",
      gameName: "斗地主",
      roomCode: room.roomCode,
      seat: 0,
      finalScore: 0,
      scoreLabel: "0 分",
      resultLabel: "房间已创建，等待另外两名玩家。",
      leaveReason: "主动离场",
      phase: "lobby"
    });
    expect(records[0].leftAt).toBeGreaterThanOrEqual(records[0].enteredAt);
  });

  it("rejects chat messages before a socket joins chat", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];

    const errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "hello" });
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
    const accountA = await registerAccount(baseUrl, "alpha", "Alpha");
    const accountB = await registerAccount(baseUrl, "beta", "Beta");

    const joinedA = waitForChatState(a);
    a.emit("chat:join", { token: accountA.token });
    expect((await joinedA).onlineCount).toBe(1);

    const joinedB = waitForChatState(b);
    b.emit("chat:join", { token: accountB.token });
    expect((await joinedB).onlineCount).toBe(2);

    const receivedByB = waitForChatMessage(b);
    a.emit("chat:send", { text: "start a round" });
    const message = await receivedByB;

    expect(message.nickname).toBe("Alpha");
    expect(message.account).toBe("alpha");
    expect(message.text).toBe("start a round");
  });

  it("replaces an older socket session when the same account joins from another device", async () => {
    const [oldDevice, newDevice] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [oldDevice, newDevice];
    const firstLogin = await registerAccount(baseUrl, "same-account", "Same Player");

    const joinedOld = waitForChatState(oldDevice);
    oldDevice.emit("chat:join", { token: firstLogin.token });
    expect((await joinedOld).onlineCount).toBe(1);

    const secondLogin = await loginAccount(baseUrl, "same-account");
    const replaced = waitForSessionReplaced(oldDevice);
    const joinedNew = waitForChatState(newDevice);
    newDevice.emit("chat:join", { token: secondLogin.token });

    await expect(replaced).resolves.toMatchObject({ message: expect.any(String) });
    expect((await joinedNew).onlineCount).toBe(1);

    const oldError = waitForChatError(oldDevice);
    oldDevice.emit("chat:send", { text: "old device message" });
    expect((await oldError).code).toBe("CHAT_UNAUTHORIZED");
  });

  it("rejects empty and too-long chat messages", async () => {
    const client = await connectClient(baseUrl);
    clients = [client];
    const account = await registerAccount(baseUrl, "gamma", "Gamma");

    const joined = waitForChatState(client);
    client.emit("chat:join", { token: account.token });
    await joined;

    let errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "   " });
    expect((await errorPromise).code).toBe("CHAT_EMPTY");

    errorPromise = waitForChatError(client);
    client.emit("chat:send", { text: "x".repeat(121) });
    expect((await errorPromise).code).toBe("CHAT_TOO_LONG");
  });

  it("keeps the latest 50 chat messages in memory", async () => {
    const [a, b] = await Promise.all([connectClient(baseUrl), connectClient(baseUrl)]);
    clients = [a, b];
    const accountA = await registerAccount(baseUrl, "delta", "Delta");
    const accountB = await registerAccount(baseUrl, "epsilon", "Epsilon");

    const joinedA = waitForChatState(a);
    a.emit("chat:join", { token: accountA.token });
    await joinedA;

    for (let index = 0; index < 55; index += 1) {
      const received = waitForChatMessage(a);
      a.emit("chat:send", { text: `message-${index}` });
      await received;
    }

    const joinedB = waitForChatState(b);
    b.emit("chat:join", { token: accountB.token });
    const state = await joinedB;

    expect(state.messages).toHaveLength(50);
    expect(state.messages[0].text).toBe("message-5");
    expect(state.messages[49].text).toBe("message-54");
  });
});
