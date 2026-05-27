import { createDeck, shuffleDeck, sortCards } from "./cards.js";
import type { Card, Rank, ZjhHandAnalysis, ZjhHandType } from "./types.js";

const TYPE_RANK: Record<ZjhHandType, number> = {
  high_card: 1,
  pair: 2,
  straight: 3,
  flush: 4,
  straight_flush: 5,
  three_kind: 6
};

const TYPE_LABEL: Record<ZjhHandType, string> = {
  high_card: "单张",
  pair: "对子",
  straight: "顺子",
  flush: "金花",
  straight_flush: "同花顺",
  three_kind: "豹子"
};

export const ZJH_BLIND_BETS = [1, 2] as const;
export const ZJH_SEEN_BETS = [1, 2, 5] as const;

const ZJH_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  SJ: 0,
  BJ: 0
};

export function createZjhDeck(): Card[] {
  return createDeck().filter((card) => card.suit !== "joker");
}

export function dealZjhHands(deck: Card[], playerCount: number): Card[][] {
  if (deck.length < playerCount * 3) {
    throw new Error("炸金花发牌需要足够的 52 张无王牌。");
  }

  return Array.from({ length: playerCount }, (_, index) =>
    sortZjhCards(deck.slice(index * 3, index * 3 + 3))
  );
}

export function shuffleZjhDeck(rng: () => number = Math.random): Card[] {
  return shuffleDeck(createZjhDeck(), rng);
}

export function sortZjhCards(cards: Card[]): Card[] {
  return sortCards(cards).sort((a, b) => zjhValue(b) - zjhValue(a));
}

export function analyzeZjhHand(cards: Card[]): ZjhHandAnalysis {
  if (cards.length !== 3) {
    throw new Error("炸金花必须使用 3 张牌比较。");
  }
  if (cards.some((card) => card.suit === "joker")) {
    throw new Error("炸金花不使用大小王。");
  }

  const sortedValues = cards.map(zjhValue).sort((a, b) => b - a);
  const counts = countValues(sortedValues);
  const countEntries = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const isFlush = cards.every((card) => card.suit === cards[0].suit);
  const straightValue = getStraightValue(sortedValues);

  if (countEntries[0][1] === 3) {
    return makeAnalysis("three_kind", [countEntries[0][0]]);
  }

  if (isFlush && straightValue > 0) {
    return makeAnalysis("straight_flush", [straightValue]);
  }

  if (isFlush) {
    return makeAnalysis("flush", sortedValues);
  }

  if (straightValue > 0) {
    return makeAnalysis("straight", [straightValue]);
  }

  if (countEntries[0][1] === 2) {
    const pairValue = countEntries[0][0];
    const kicker = sortedValues.find((value) => value !== pairValue) ?? 0;
    return makeAnalysis("pair", [pairValue, kicker]);
  }

  return makeAnalysis("high_card", sortedValues);
}

export function compareZjhHands(left: Card[], right: Card[]): number {
  return compareZjhAnalysis(analyzeZjhHand(left), analyzeZjhHand(right));
}

export function compareZjhAnalysis(left: ZjhHandAnalysis, right: ZjhHandAnalysis): number {
  if (left.rank !== right.rank) {
    return Math.sign(left.rank - right.rank);
  }

  const length = Math.max(left.values.length, right.values.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left.values[index] ?? 0) - (right.values[index] ?? 0);
    if (delta !== 0) {
      return Math.sign(delta);
    }
  }

  return 0;
}

export function getZjhBetCost(currentBet: number, seen: boolean): number {
  if (!seen) {
    return currentBet;
  }

  if (currentBet === 1) {
    return 2;
  }
  if (currentBet === 2) {
    return 5;
  }

  return currentBet;
}

export function getZjhBetTier(amount: number, seen: boolean): number | undefined {
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  if (!seen) {
    return ZJH_BLIND_BETS.includes(amount as (typeof ZJH_BLIND_BETS)[number]) ? amount : undefined;
  }

  if (amount === 1) {
    return 0;
  }
  if (amount === 2) {
    return 1;
  }
  if (amount === 5) {
    return 2;
  }

  return undefined;
}

function makeAnalysis(type: ZjhHandType, values: number[]): ZjhHandAnalysis {
  return {
    type,
    label: TYPE_LABEL[type],
    rank: TYPE_RANK[type],
    values
  };
}

function zjhValue(card: Card): number {
  return ZJH_VALUE[card.rank];
}

function countValues(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function getStraightValue(values: number[]) {
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length !== 3) {
    return 0;
  }

  if (unique[0] === 2 && unique[1] === 3 && unique[2] === 14) {
    return 13.5;
  }

  return unique[1] === unique[0] + 1 && unique[2] === unique[1] + 1 ? unique[2] : 0;
}
