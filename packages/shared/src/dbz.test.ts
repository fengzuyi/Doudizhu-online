import { describe, expect, it } from "vitest";
import {
  analyzeDaBanZiHand,
  canBeatDaBanZiHand,
  createDaBanZiDeck,
  dealDaBanZiHands,
  getDaBanZiPartnerCallOptions,
  isDaBanZiSpring
} from "./dbz.js";
import type { Card } from "./types.js";

function card(id: string): Card {
  const found = createDaBanZiDeck().find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing card ${id}`);
  }
  return found;
}

describe("da ban zi deck", () => {
  it("uses 52 cards and deals 13 cards to each of four players", () => {
    const deck = createDaBanZiDeck();
    const hands = dealDaBanZiHands(deck, 2);

    expect(deck).toHaveLength(52);
    expect(deck.some((candidate) => candidate.suit === "joker")).toBe(false);
    expect(hands).toHaveLength(4);
    expect(hands.every((hand) => hand.length === 13)).toBe(true);
  });

  it("recognizes spring hands", () => {
    const spring = [
      "spades-3",
      "spades-4",
      "spades-5",
      "spades-6",
      "spades-7",
      "spades-8",
      "spades-9",
      "spades-10",
      "spades-J",
      "spades-Q",
      "spades-K",
      "spades-A",
      "spades-2"
    ].map(card);

    expect(isDaBanZiSpring(spring)).toBe(true);
    expect(isDaBanZiSpring(spring.slice(0, 12))).toBe(false);
  });
});

describe("da ban zi hand analysis", () => {
  it("recognizes core hand types", () => {
    expect(analyzeDaBanZiHand([card("spades-3")]).type).toBe("single");
    expect(analyzeDaBanZiHand([card("spades-4"), card("hearts-4")]).type).toBe("pair");
    expect(analyzeDaBanZiHand([card("spades-5"), card("hearts-5"), card("clubs-5")]).type).toBe("triple");
    expect(analyzeDaBanZiHand([card("spades-6"), card("hearts-6"), card("clubs-6"), card("diamonds-6")]).type).toBe("bomb");
    expect(analyzeDaBanZiHand([card("spades-7"), card("hearts-8"), card("clubs-9")]).type).toBe("straight");
    expect(
      analyzeDaBanZiHand([
        card("spades-8"),
        card("hearts-8"),
        card("spades-9"),
        card("hearts-9"),
        card("spades-10"),
        card("hearts-10")
      ]).type
    ).toBe("pair_straight");
    expect(
      analyzeDaBanZiHand([
        card("spades-3"),
        card("hearts-3"),
        card("clubs-3"),
        card("spades-4"),
        card("hearts-4"),
        card("clubs-4"),
        card("spades-5"),
        card("hearts-5"),
        card("clubs-5")
      ]).type
    ).toBe("rolling_triples");
    expect(
      analyzeDaBanZiHand([
        card("spades-3"),
        card("hearts-3"),
        card("clubs-3"),
        card("diamonds-3"),
        card("spades-4"),
        card("hearts-4"),
        card("clubs-4"),
        card("diamonds-4"),
        card("spades-5"),
        card("hearts-5"),
        card("clubs-5"),
        card("diamonds-5")
      ]).type
    ).toBe("rolling_bombs");
  });

  it("rejects sequences containing 2", () => {
    expect(() => analyzeDaBanZiHand([card("spades-K"), card("hearts-A"), card("clubs-2")])).toThrow();
  });
});

describe("da ban zi hand comparison", () => {
  it("uses documented pressure relations", () => {
    const single2 = analyzeDaBanZiHand([card("spades-2")]);
    const pairA = analyzeDaBanZiHand([card("spades-A"), card("hearts-A")]);
    const triple3 = analyzeDaBanZiHand([card("spades-3"), card("hearts-3"), card("clubs-3")]);
    const triple4 = analyzeDaBanZiHand([card("spades-4"), card("hearts-4"), card("clubs-4")]);
    const straight = analyzeDaBanZiHand([card("spades-10"), card("hearts-J"), card("clubs-Q")]);
    const pairStraight = analyzeDaBanZiHand([
      card("spades-4"),
      card("hearts-4"),
      card("spades-5"),
      card("hearts-5"),
      card("spades-6"),
      card("hearts-6")
    ]);
    const bomb4 = analyzeDaBanZiHand([card("spades-4"), card("hearts-4"), card("clubs-4"), card("diamonds-4")]);
    const rolling = analyzeDaBanZiHand([
      card("spades-3"),
      card("hearts-3"),
      card("clubs-3"),
      card("spades-4"),
      card("hearts-4"),
      card("clubs-4"),
      card("spades-5"),
      card("hearts-5"),
      card("clubs-5")
    ]);

    expect(canBeatDaBanZiHand(triple3, single2)).toBe(true);
    expect(canBeatDaBanZiHand(triple3, pairA)).toBe(true);
    expect(canBeatDaBanZiHand(triple4, straight)).toBe(true);
    expect(canBeatDaBanZiHand(pairStraight, straight)).toBe(true);
    expect(canBeatDaBanZiHand(bomb4, pairStraight)).toBe(true);
    expect(canBeatDaBanZiHand(rolling, bomb4)).toBe(true);
    expect(canBeatDaBanZiHand(bomb4, rolling)).toBe(false);
  });
});

describe("da ban zi partner call options", () => {
  it("only allows calling ranks the banker does not fully own", () => {
    const hand = [card("spades-2"), card("hearts-2"), card("clubs-2"), card("diamonds-2"), card("spades-A")];
    const options = getDaBanZiPartnerCallOptions(hand);

    expect(options.every((option) => option.rank === "A")).toBe(true);
    expect(options.some((option) => option.suit === "spades")).toBe(false);
  });
});
