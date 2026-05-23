import { describe, expect, it } from "vitest";
import { createDeck } from "@doudizhu/shared";
import { GameException, RoomManager } from "./roomManager.js";

function preparePlayingRoom() {
  const manager = new RoomManager(() => 0.25);
  const room = manager.createRoom("s1", "甲");
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.joinRoom("s3", room.roomCode, "丙");
  manager.ready("s1");
  manager.ready("s2");
  manager.ready("s3");
  manager.chooseBid("s1", "call");
  manager.chooseBid("s2", "no_rob");
  manager.chooseBid("s3", "no_rob");
  return { manager, room };
}

function prepareBiddingRoom() {
  const manager = new RoomManager(() => 0.25);
  const room = manager.createRoom("s1", "甲");
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.joinRoom("s3", room.roomCode, "丙");
  manager.ready("s1");
  manager.ready("s2");
  manager.ready("s3");
  return { manager, room };
}

describe("RoomManager", () => {
  it("creates a room, starts bidding after all players are ready, and keeps hands private", () => {
    const manager = new RoomManager(() => 0.12);
    const room = manager.createRoom("s1", "甲");
    manager.joinRoom("s2", room.roomCode, "乙");
    manager.joinRoom("s3", room.roomCode, "丙");

    manager.ready("s1");
    manager.ready("s2");
    manager.ready("s3");

    expect(room.phase).toBe("bidding");
    expect(room.players.map((player) => player?.hand.length)).toEqual([17, 17, 17]);

    const viewForSeatOne = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    expect(viewForSeatOne?.players.find((player) => player.seat === 0)?.hand).toHaveLength(17);
    expect(viewForSeatOne?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();
  });

  it("appoints the caller as landlord when nobody robs", () => {
    const { room } = preparePlayingRoom();

    expect(room.phase).toBe("playing");
    expect(room.landlordSeat).toBe(0);
    expect(room.players[0]?.hand).toHaveLength(20);
    expect(room.currentTurn).toBe(0);
  });

  it("lets the original caller respond after both other players rob", () => {
    const { manager, room } = prepareBiddingRoom();

    manager.chooseBid("s1", "call");
    expect(room.bid?.currentSeat).toBe(1);

    manager.chooseBid("s2", "rob");
    expect(room.multiplier).toBe(2);
    expect(room.bid?.currentSeat).toBe(2);

    manager.chooseBid("s3", "rob");
    expect(room.multiplier).toBe(4);
    expect(room.phase).toBe("bidding");
    expect(room.bid?.currentSeat).toBe(0);

    manager.chooseBid("s1", "no_rob");
    expect(room.phase).toBe("playing");
    expect(room.landlordSeat).toBe(2);
  });

  it("skips players who passed during call when robbing starts", () => {
    const { manager, room } = prepareBiddingRoom();

    manager.chooseBid("s1", "pass");
    manager.chooseBid("s2", "call");
    expect(room.bid?.currentSeat).toBe(2);

    manager.chooseBid("s3", "rob");
    expect(room.phase).toBe("bidding");
    expect(room.bid?.currentSeat).toBe(1);

    manager.chooseBid("s2", "no_rob");
    expect(room.phase).toBe("playing");
    expect(room.landlordSeat).toBe(2);
  });

  it("rejects out-of-turn plays", () => {
    const { manager, room } = preparePlayingRoom();
    const card = room.players[1]?.hand[0];

    expect(() => manager.playCards("s2", [card?.id ?? "missing"])).toThrow(GameException);
  });

  it("ends the round and scores when a player empties their hand", () => {
    const { manager, room } = preparePlayingRoom();
    const testCard = createDeck().find((card) => card.id === "spades-3");
    if (!testCard) {
      throw new Error("Missing test card");
    }

    room.players[0]!.hand = [testCard];
    const { result } = manager.playCards("s1", [testCard.id]);

    expect(room.phase).toBe("ended");
    expect(result?.scores).toEqual({ 0: 2, 1: -1, 2: -1 });
  });
});
