import { describe, expect, it } from "vitest";
import {
  analyzeHand,
  calculateRoundResult,
  canBeatHand,
  createDeck,
  dealCards,
  HAND_TYPE_LABELS,
  shuffleDeck
} from "./index.js";
import type { Card } from "./index.js";

function pick(...ids: string[]): Card[] {
  const deck = createDeck();
  return ids.map((id) => {
    const card = deck.find((candidate) => candidate.id === id);
    if (!card) {
      throw new Error(`Missing test card ${id}`);
    }
    return card;
  });
}

describe("deck and dealing", () => {
  it("creates and deals a 54-card deck into three 17-card hands plus bottom cards", () => {
    const deck = shuffleDeck(createDeck(), () => 0.42);
    const dealt = dealCards(deck);

    expect(deck).toHaveLength(54);
    expect(new Set(deck.map((card) => card.id))).toHaveLength(54);
    expect(dealt.hands.map((hand) => hand.length)).toEqual([17, 17, 17]);
    expect(dealt.bottomCards).toHaveLength(3);
  });
});

describe("hand analysis", () => {
  it("recognizes core hands", () => {
    const cases = [
      ["single", pick("spades-3")],
      ["pair", pick("spades-4", "hearts-4")],
      ["triple", pick("spades-5", "hearts-5", "clubs-5")],
      ["triple_single", pick("spades-6", "hearts-6", "clubs-6", "diamonds-7")],
      ["triple_pair", pick("spades-8", "hearts-8", "clubs-8", "spades-9", "hearts-9")],
      ["straight", pick("spades-3", "hearts-4", "clubs-5", "diamonds-6", "spades-7")],
      ["pair_straight", pick("spades-3", "hearts-3", "spades-4", "hearts-4", "spades-5", "hearts-5")],
      ["airplane", pick("spades-3", "hearts-3", "clubs-3", "spades-4", "hearts-4", "clubs-4")],
      [
        "airplane_singles",
        pick("spades-3", "hearts-3", "clubs-3", "spades-4", "hearts-4", "clubs-4", "diamonds-7", "spades-8")
      ],
      [
        "airplane_pairs",
        pick(
          "spades-3",
          "hearts-3",
          "clubs-3",
          "spades-4",
          "hearts-4",
          "clubs-4",
          "diamonds-7",
          "spades-7",
          "diamonds-8",
          "spades-8"
        )
      ],
      ["bomb", pick("spades-10", "hearts-10", "clubs-10", "diamonds-10")],
      ["rocket", pick("joker-small", "joker-big")]
    ] as const;

    for (const [type, cards] of cases) {
      expect(analyzeHand(cards)?.type, HAND_TYPE_LABELS[type]).toBe(type);
    }
  });

  it("rejects straights that include 2 or jokers", () => {
    expect(
      analyzeHand(pick("spades-10", "hearts-J", "clubs-Q", "diamonds-K", "spades-A", "hearts-2"))
    ).toBeNull();
    expect(analyzeHand(pick("spades-10", "hearts-J", "clubs-Q", "diamonds-K", "joker-small"))).toBeNull();
  });
});

describe("comparison and scoring", () => {
  it("lets bombs beat non-bombs and rocket beat bombs", () => {
    const straight = analyzeHand(pick("spades-3", "hearts-4", "clubs-5", "diamonds-6", "spades-7"));
    const bomb = analyzeHand(pick("spades-10", "hearts-10", "clubs-10", "diamonds-10"));
    const rocket = analyzeHand(pick("joker-small", "joker-big"));

    expect(straight && bomb && canBeatHand(bomb, straight)).toBe(true);
    expect(bomb && rocket && canBeatHand(rocket, bomb)).toBe(true);
    expect(rocket && bomb && canBeatHand(bomb, rocket)).toBe(false);
  });

  it("calculates landlord and farmer scores from the multiplier", () => {
    expect(calculateRoundResult(0, 0, 4).scores).toEqual({ 0: 8, 1: -4, 2: -4 });
    expect(calculateRoundResult(2, 0, 2).scores).toEqual({ 0: 2, 1: 2, 2: -4 });
  });
});
