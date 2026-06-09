import { describe, expect, it } from "vitest";
import { GameException } from "./roomManager.js";
import { ZjhRoomManager } from "./zjhRoomManager.js";

function prepareRoom(rng: () => number = () => 0.15) {
  const manager = new ZjhRoomManager(rng);
  const room = manager.createRoom("s1", "甲", 4);
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.ready("s1");
  manager.ready("s2");
  return { manager, room };
}

function prepareThreePlayerRoom(rng: () => number = () => 0) {
  const manager = new ZjhRoomManager(rng);
  const room = manager.createRoom("s1", "甲", 4);
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.joinRoom("s3", room.roomCode, "丙");
  manager.ready("s1");
  manager.ready("s2");
  manager.ready("s3");
  return { manager, room };
}

function socketBySeat(room: NonNullable<ReturnType<ZjhRoomManager["getRoomForTest"]>>) {
  const entries = room.players
    .filter((player): player is NonNullable<(typeof room.players)[number]> => Boolean(player))
    .map((player) => [player.seat, player.socketId] as const);
  return new Map(entries);
}

function requireCurrentSocket(room: NonNullable<ReturnType<ZjhRoomManager["getRoomForTest"]>>) {
  const currentTurn = room.currentTurn;
  if (currentTurn === undefined) {
    throw new Error("Missing current turn");
  }
  return socketBySeat(room).get(currentTurn) ?? "";
}

function finishThreePlayerFirstRound(manager: ZjhRoomManager, room: NonNullable<ReturnType<ZjhRoomManager["getRoomForTest"]>>) {
  manager.call(requireCurrentSocket(room));
  manager.call(requireCurrentSocket(room));
  manager.call(requireCurrentSocket(room));
}

describe("ZjhRoomManager", () => {
  it("creates, joins, readies and starts a private 3-card round", () => {
    const { manager, room } = prepareRoom();

    expect(room.phase).toBe("playing");
    expect(room.playerCount).toBe(2);
    expect(room.pot).toBe(2);
    expect(room.players[0]?.hand).toHaveLength(3);
    expect(room.players[1]?.hand).toHaveLength(3);
    expect(room.currentTurn).toBe(room.bankerSeat === 0 ? 1 : 0);

    const viewForSeat0 = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    expect(viewForSeat0?.players.find((player) => player.seat === 0)?.hand).toBeUndefined();
    expect(viewForSeat0?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();

    manager.seeCards("s1");
    const seenView = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    expect(seenView?.players.find((player) => player.seat === 0)?.hand).toHaveLength(3);
  });

  it("rejects out-of-turn actions", () => {
    const { manager, room } = prepareRoom();
    const currentTurn = room.currentTurn;
    const wrongSocket = currentTurn === 0 ? "s2" : "s1";

    expect(() => manager.call(wrongSocket)).toThrow(GameException);
  });

  it("allows players to see cards outside their turn", () => {
    const { manager, room } = prepareRoom();
    const currentTurn = room.currentTurn;
    const wrongSocket = currentTurn === 0 ? "s2" : "s1";
    const wrongSeat = currentTurn === 0 ? 1 : 0;

    expect(() => manager.seeCards(wrongSocket)).not.toThrow();

    const wrongView = manager.buildViews(room).find((view) => view.socketId === wrongSocket)?.roomView;
    expect(wrongView?.players.find((player) => player.seat === wrongSeat)?.hand).toHaveLength(3);
    expect(room.currentTurn).toBe(currentTurn);
  });

  it("advances after follow and ends when the other player folds", () => {
    const { manager, room } = prepareRoom(() => 0);
    const firstTurn = room.currentTurn ?? 0;
    const bySeat = socketBySeat(room);
    const firstSocket = bySeat.get(firstTurn) ?? "";
    const nextSeat = (firstTurn + 1) % 2;
    const nextSocket = bySeat.get(nextSeat) ?? "";

    manager.call(firstSocket);
    expect(room.currentTurn).toBe(nextSeat);

    manager.fold(nextSocket);
    expect(room.phase).toBe("ended");
    expect(room.result?.winnerSeat).toBe(firstTurn);
    expect(room.result?.pot).toBe(3);
  });

  it("keeps settlement visible until every connected player readies", () => {
    const { manager, room } = prepareRoom(() => 0);
    const firstTurn = room.currentTurn ?? 0;
    const bySeat = socketBySeat(room);
    const firstSocket = bySeat.get(firstTurn) ?? "";
    const nextSeat = (firstTurn + 1) % 2;
    const nextSocket = bySeat.get(nextSeat) ?? "";

    manager.call(firstSocket);
    manager.fold(nextSocket);

    const settledResult = room.result;
    expect(room.phase).toBe("ended");
    expect(settledResult?.hands).toHaveLength(2);

    manager.ready(firstSocket);

    expect(room.phase).toBe("ended");
    expect(room.result).toBe(settledResult);
    expect(room.players[firstTurn]?.ready).toBe(true);
    expect(room.players[nextSeat]?.ready).toBe(false);

    const waitingView = manager.buildViews(room).find((view) => view.socketId === firstSocket)?.roomView;
    expect(waitingView?.phase).toBe("ended");
    expect(waitingView?.result).toBe(settledResult);
    expect(waitingView?.players.find((player) => player.seat === 0)?.hand).toHaveLength(3);
    expect(waitingView?.players.find((player) => player.seat === 1)?.hand).toHaveLength(3);

    manager.ready(nextSocket);

    expect(room.phase).toBe("playing");
    expect(room.bankerSeat).toBe(settledResult?.winnerSeat);
    expect(room.currentTurn).toBe(nextSeat);
    expect(room.result).toBeUndefined();
    expect(room.players[0]?.ready).toBe(false);
    expect(room.players[1]?.ready).toBe(false);
  });

  it("supports raise and compare settlement", () => {
    const { manager, room } = prepareRoom(() => 0);
    const bySeat = socketBySeat(room);
    const firstSocket = requireCurrentSocket(room);

    manager.raise(firstSocket, 2);
    expect(room.currentBet).toBe(2);
    expect(room.pot).toBe(4);

    manager.call(requireCurrentSocket(room));
    expect(room.round).toBe(2);

    const compareSeat = room.currentTurn ?? 0;
    const targetSeat = compareSeat === 0 ? 1 : 0;
    manager.compare(bySeat.get(compareSeat) ?? "", targetSeat);
    expect(room.phase).toBe("ended");
    expect(room.result?.pot).toBe(10);
    expect(room.result?.hands).toHaveLength(2);
  });

  it("rejects compare before the first round ends", () => {
    const { manager } = prepareRoom(() => 0);

    expect(() => manager.compare("s1", 1)).toThrow(GameException);
  });

  it("requires unseen players to wait until only two active players remain before comparing", () => {
    const { manager, room } = prepareThreePlayerRoom(() => 0);

    finishThreePlayerFirstRound(manager, room);
    expect(room.round).toBe(2);

    expect(() => manager.compare("s1", 1)).toThrow(GameException);

    const foldedSeat = room.currentTurn ?? 0;
    manager.fold(requireCurrentSocket(room));
    expect(room.currentTurn).toBe((foldedSeat + 1) % 3);
    expect(() => manager.compare(requireCurrentSocket(room), (room.currentTurn ?? 0) === 2 ? 0 : 2)).not.toThrow();
  });

  it("sends compared cards only as a one-time reveal to the initiator", () => {
    const { manager, room } = prepareThreePlayerRoom(() => 0);

    finishThreePlayerFirstRound(manager, room);
    const compareSeat = room.currentTurn ?? 0;
    const compareSocket = requireCurrentSocket(room);
    const targetSeat = compareSeat === 0 ? 1 : 0;
    manager.seeCards(compareSocket);
    const { reveal } = manager.compare(compareSocket, targetSeat);
    expect(room.phase).toBe("playing");

    const builtViews = manager.buildViews(room);
    const initiatorView = builtViews.find((view) => view.socketId === compareSocket)?.roomView;

    expect(reveal.targetSeat).toBe(targetSeat);
    expect(reveal.cards).toHaveLength(3);

    expect(initiatorView?.players.find((player) => player.seat === compareSeat)?.hand).toHaveLength(3);
    expect(initiatorView?.players.find((player) => player.seat === targetSeat)?.hand).toBeUndefined();
    for (const { socketId, roomView } of builtViews.filter((view) => view.socketId !== compareSocket)) {
      expect(socketId).not.toBe(compareSocket);
      expect(roomView.players.find((player) => player.seat === compareSeat)?.hand).toBeUndefined();
      expect(roomView.players.find((player) => player.seat === targetSeat)?.hand).toBeUndefined();
    }
  });

  it("limits blind players to 1/2 and seen players to 1/2/5", () => {
    const { manager, room } = prepareRoom(() => 0);
    const firstSocket = requireCurrentSocket(room);

    expect(() => manager.raise(firstSocket, 5)).toThrow(GameException);

    manager.seeCards(firstSocket);
    expect(() => manager.raise(firstSocket, 4)).toThrow(GameException);

    manager.raise(firstSocket, 5);
    expect(room.currentBet).toBe(2);
    expect(room.pot).toBe(7);
  });
});
