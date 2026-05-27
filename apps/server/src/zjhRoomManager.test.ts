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

  it("advances after follow and ends when the other player folds", () => {
    const { manager, room } = prepareRoom(() => 0);

    manager.call("s1");
    expect(room.currentTurn).toBe(1);

    manager.fold("s2");
    expect(room.phase).toBe("ended");
    expect(room.result?.winnerSeat).toBe(0);
    expect(room.result?.pot).toBe(3);
  });

  it("supports raise and compare settlement", () => {
    const { manager, room } = prepareRoom(() => 0);

    manager.raise("s1", 2);
    expect(room.currentBet).toBe(2);
    expect(room.pot).toBe(4);

    manager.compare("s2", 0);
    expect(room.phase).toBe("ended");
    expect(room.result?.pot).toBe(8);
    expect(room.result?.hands).toHaveLength(2);
  });

  it("sends compared cards only as a one-time reveal to the initiator", () => {
    const { manager, room } = prepareThreePlayerRoom(() => 0);

    const { reveal } = manager.compare("s1", 1);
    expect(room.phase).toBe("playing");

    const viewForA = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    const viewForB = manager.buildViews(room).find((view) => view.socketId === "s2")?.roomView;
    const viewForC = manager.buildViews(room).find((view) => view.socketId === "s3")?.roomView;

    expect(reveal.targetSeat).toBe(1);
    expect(reveal.cards).toHaveLength(3);

    expect(viewForA?.players.find((player) => player.seat === 0)?.hand).toBeUndefined();
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
