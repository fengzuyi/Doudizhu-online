import { describe, expect, it } from "vitest";
import { createDeck } from "@doudizhu/shared";
import { GameException, RoomManager } from "./roomManager.js";

function prepareBiddingRoom(rng: () => number = () => 0.25) {
  const manager = new RoomManager(rng);
  const room = manager.createRoom("s1", "甲");
  manager.joinRoom("s2", room.roomCode, "乙");
  manager.joinRoom("s3", room.roomCode, "丙");
  manager.ready("s1");
  manager.ready("s2");
  manager.ready("s3");
  return { manager, room };
}

function preparePlayingRoom() {
  const { manager, room } = prepareBiddingRoom();
  manager.chooseBid("s1", 1);
  manager.chooseBid("s2", 2);
  manager.chooseBid("s3", 0);
  return { manager, room };
}

function pickCards(...ids: string[]) {
  const deck = createDeck();
  return ids.map((id) => {
    const card = deck.find((candidate) => candidate.id === id);
    if (!card) {
      throw new Error(`Missing test card ${id}`);
    }
    return card;
  });
}

describe("RoomManager", () => {
  it("creates a room, starts bidding after all players are ready, and keeps hands private", () => {
    const { manager, room } = prepareBiddingRoom(() => 0.12);

    expect(room.phase).toBe("bidding");
    expect(room.players.map((player) => player?.hand.length)).toEqual([17, 17, 17]);

    const viewForSeatOne = manager.buildViews(room).find((view) => view.socketId === "s1")?.roomView;
    expect(viewForSeatOne?.players.find((player) => player.seat === 0)?.hand).toHaveLength(17);
    expect(viewForSeatOne?.players.find((player) => player.seat === 1)?.hand).toBeUndefined();
  });

  it("starts bidding from a random seat after dealing", () => {
    const randomValues = [0, 0, 0, 0, 0.8];
    const { room } = prepareBiddingRoom(() => randomValues.shift() ?? 0.2);

    expect(room.phase).toBe("bidding");
    expect(room.bid?.currentSeat).toBe(2);
  });

  it("rejects scores that are not greater than the current highest score", () => {
    const { manager, room } = prepareBiddingRoom();

    manager.chooseBid("s1", 1);

    expect(() => manager.chooseBid("s2", 1)).toThrow(GameException);
    expect(room.phase).toBe("bidding");
    expect(room.bid?.highestScore).toBe(1);
    expect(room.bid?.currentSeat).toBe(1);
  });

  it("appoints a 3-point bidder as landlord immediately", () => {
    const { manager, room } = prepareBiddingRoom();

    manager.chooseBid("s1", 3);

    expect(room.phase).toBe("playing");
    expect(room.landlordSeat).toBe(0);
    expect(room.players[0]?.hand).toHaveLength(20);
    expect(room.currentTurn).toBe(0);
    expect(room.multiplier).toBe(1);
    expect(manager.buildViews(room)[0].roomView.highestBidScore).toBe(3);
  });

  it("redeals when all players pass during bidding", () => {
    const queuedRandomValues = [0, 0, 0, 0, 0.1];
    let fallbackRandom = 0;
    const { manager, room } = prepareBiddingRoom(
      () => queuedRandomValues.shift() ?? ((fallbackRandom = (fallbackRandom + 0.37) % 1))
    );
    const previousHands = room.players.map((player) => player?.hand.map((card) => card.id).join(","));

    manager.chooseBid("s1", 0);
    manager.chooseBid("s2", 0);
    manager.chooseBid("s3", 0);

    expect(room.phase).toBe("bidding");
    expect(room.landlordSeat).toBeUndefined();
    expect(room.players.map((player) => player?.hand.length)).toEqual([17, 17, 17]);
    expect(room.players.map((player) => player?.hand.map((card) => card.id).join(","))).not.toEqual(previousHands);
  });

  it("appoints the highest bidder as landlord after one full bidding round", () => {
    const { room } = preparePlayingRoom();

    expect(room.phase).toBe("playing");
    expect(room.landlordSeat).toBe(1);
    expect(room.players[1]?.hand).toHaveLength(20);
    expect(room.currentTurn).toBe(1);
    expect(room.multiplier).toBe(1);
  });

  it("rejects out-of-turn plays", () => {
    const { manager, room } = preparePlayingRoom();
    const card = room.players[0]?.hand[0];

    expect(() => manager.playCards("s1", [card?.id ?? "missing"])).toThrow(GameException);
  });

  it("keeps bidding from changing multiplier while bombs still double it", () => {
    const { manager, room } = preparePlayingRoom();
    const bomb = pickCards("spades-3", "hearts-3", "clubs-3", "diamonds-3");

    expect(room.multiplier).toBe(1);

    room.players[1]!.hand = bomb;
    const { result } = manager.playCards("s2", bomb.map((card) => card.id));

    expect(room.phase).toBe("ended");
    expect(result?.multiplier).toBe(2);
    expect(result?.scores).toEqual({ 0: -2, 1: 4, 2: -2 });
  });
});
