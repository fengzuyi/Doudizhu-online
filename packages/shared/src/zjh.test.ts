import { describe, expect, it } from "vitest";
import { analyzeZjhHand, compareZjhHands, createZjhDeck, dealZjhHands, getZjhBetCost, getZjhBetTier } from "./zjh.js";
import type { Card } from "./types.js";

function card(id: string): Card {
  const found = createZjhDeck().find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`Missing card ${id}`);
  }
  return found;
}

describe("zha jin hua cards", () => {
  it("uses a 52-card deck and deals three cards to each player", () => {
    const deck = createZjhDeck();
    const hands = dealZjhHands(deck, 12);

    expect(deck).toHaveLength(52);
    expect(deck.some((candidate) => candidate.suit === "joker")).toBe(false);
    expect(hands).toHaveLength(12);
    expect(hands.every((hand) => hand.length === 3)).toBe(true);
  });
});

describe("zha jin hua hand ranking", () => {
  it("recognizes all core hand types", () => {
    expect(analyzeZjhHand([card("spades-A"), card("hearts-A"), card("clubs-A")]).type).toBe("three_kind");
    expect(analyzeZjhHand([card("spades-Q"), card("spades-K"), card("spades-A")]).type).toBe("straight_flush");
    expect(analyzeZjhHand([card("hearts-3"), card("hearts-8"), card("hearts-J")]).type).toBe("flush");
    expect(analyzeZjhHand([card("clubs-9"), card("diamonds-10"), card("spades-J")]).type).toBe("straight");
    expect(analyzeZjhHand([card("clubs-5"), card("diamonds-5"), card("spades-K")]).type).toBe("pair");
    expect(analyzeZjhHand([card("clubs-4"), card("diamonds-8"), card("spades-K")]).type).toBe("high_card");
  });

  it("orders A23 above JQK and below QKA", () => {
    const a23 = [card("spades-A"), card("hearts-2"), card("clubs-3")];
    const jqk = [card("spades-J"), card("hearts-Q"), card("clubs-K")];
    const qka = [card("spades-Q"), card("hearts-K"), card("clubs-A")];

    expect(compareZjhHands(a23, jqk)).toBe(1);
    expect(compareZjhHands(qka, a23)).toBe(1);
  });

  it("keeps the documented rank order", () => {
    const threeKind = [card("spades-7"), card("hearts-7"), card("clubs-7")];
    const straightFlush = [card("spades-4"), card("spades-5"), card("spades-6")];
    const flush = [card("diamonds-3"), card("diamonds-9"), card("diamonds-Q")];
    const straight = [card("clubs-4"), card("hearts-5"), card("spades-6")];
    const pair = [card("clubs-A"), card("hearts-A"), card("spades-2")];

    expect(compareZjhHands(threeKind, straightFlush)).toBe(1);
    expect(compareZjhHands(straightFlush, flush)).toBe(1);
    expect(compareZjhHands(flush, straight)).toBe(1);
    expect(compareZjhHands(straight, pair)).toBe(1);
  });
});

describe("zha jin hua betting", () => {
  it("maps blind baseline bets to seen betting costs", () => {
    expect(getZjhBetCost(1, false)).toBe(1);
    expect(getZjhBetCost(1, true)).toBe(2);
    expect(getZjhBetCost(2, false)).toBe(2);
    expect(getZjhBetCost(2, true)).toBe(5);
  });

  it("allows only 1/2 for blind players and 1/2/5 for seen players", () => {
    expect(getZjhBetTier(1, false)).toBe(1);
    expect(getZjhBetTier(2, false)).toBe(2);
    expect(getZjhBetTier(5, false)).toBeUndefined();

    expect(getZjhBetTier(1, true)).toBe(0);
    expect(getZjhBetTier(2, true)).toBe(1);
    expect(getZjhBetTier(5, true)).toBe(2);
    expect(getZjhBetTier(10, true)).toBeUndefined();
  });
});
