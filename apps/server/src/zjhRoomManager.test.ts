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

function finishThreePlayerFirstRound(manager: ZjhRoomManager) {
  manager.call("s1");
  manager.call("s2");
  manager.call("s3");
}

describe("ZjhRoomManager", () => {
  it("creates, joins, readies and starts a private 3-card round", () => {
    const { manager, room } = prepareRoom();

    expect(room.phase).toBe("playing");
    expect(room.playerCount).toBe(2);
    expect(room.pot).toBe(2);
    expect(room.players[0]?.hand).toHaveLength(3);
    expect(room.players[1]?.hand).toHaveLength(3);

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

    manager.call("s1");
    expect(room.currentTurn).toBe(1);

    manager.fold("s2");
    expect(room.phase).toBe("ended");
    expect(room.result?.winnerSeat).toBe(0);
    expect(room.result?.pot).toBe(3);
  });

  it("keeps settlement visible until every connected player readies", () => {
    const { manager, room } = prepareRoom(() => 0);

    manager.call("s1");
    manager.fold("s2");

    const settledResult = room.result;
    expect(room.phase).toBe("ended");
    expect(settledResult?.hands).toHaveLength(2);

    manager.ready("s1");

    expect(room.phase).toBe("ended");
    expect(room.result).toBe(settledResult);
    expect(room.players[0]?.ready).toBe(true);
    expect(room.players[1]?.ready).toBe(false);

    const waitingView = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    expect(waitingView?.phase).toBe("ended");
    expect(waitingView?.result).toBe(settledResult);
    expect(waitingView?.players.find((player) => player.seat === 0)?.hand).toHaveLength(3);
    expect(waitingView?.players.find((player) => player.seat === 1)?.hand).toHaveLength(3);

    manager.ready("s2");

    expect(room.phase).toBe("playing");
    expect(room.result).toBeUndefined();
    expect(room.players[0]?.ready).toBe(false);
    expect(room.players[1]?.ready).toBe(false);
  });

  it("supports raise and compare settlement", () => {
    const { manager, room } = prepareRoom(() => 0);

    manager.raise("s1", 2);
    expect(room.currentBet).toBe(2);
    expect(room.pot).toBe(4);

    manager.call("s2");
    expect(room.round).toBe(2);

    manager.compare("s1", 1);
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

    finishThreePlayerFirstRound(manager);
    expect(room.round).toBe(2);

    expect(() => manager.compare("s1", 1)).toThrow(GameException);

    manager.fold("s1");
    expect(room.currentTurn).toBe(1);
    expect(() => manager.compare("s2", 2)).not.toThrow();
  });

  it("sends compared cards only as a one-time reveal to the initiator", () => {
    const { manager, room } = prepareThreePlayerRoom(() => 0);

    finishThreePlayerFirstRound(manager);
    manager.seeCards("s1");
    const { reveal } = manager.compare("s1", 1);
    expect(room.phase).toBe("playing");

    const viewForA = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    const viewForB = manager.buildViews(room).find((view) => view.socketId === "s2")?.roomView;
    const viewForC = manager.buildViews(room).find((view) => view.socketId === "s3")?.roomView;

    expect(reveal.targetSeat).toBe(1);
    expect(reveal.cards).toHaveLength(3);

    expect(viewForA?.players.find((player) => player.seat === 0)?.hand).toHaveLength(3);
    expect(viewForA?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();
    expect(viewForA?.players.find((player) => player.seat === 2)?.hand).toBeUndefined();

    expect(viewForB?.players.find((player) => player.seat === 0)?.hand).toBeUndefined();
    expect(viewForB?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();
    expect(viewForB?.players.find((player) => player.seat === 2)?.hand).toBeUndefined();

    expect(viewForC?.players.find((player) => player.seat === 0)?.hand).toBeUndefined();
    expect(viewForC?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();
  });

  it("limits blind players to 1/2 and seen players to 1/2/5", () => {
    const { manager, room } = prepareRoom(() => 0);

    expect(() => manager.raise("s1", 5)).toThrow(GameException);

    manager.seeCards("s1");
    expect(() => manager.raise("s1", 4)).toThrow(GameException);

    manager.raise("s1", 5);
    expect(room.currentBet).toBe(2);
    expect(room.pot).toBe(7);
  });
});
