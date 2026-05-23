import { sortCards } from "./cards.js";
import type { Card, HandAnalysis, HandType, PlayerSeat, RoundResult, SeatScores } from "./types.js";

export const HAND_TYPE_LABELS: Record<HandType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  triple_single: "三带一",
  triple_pair: "三带二",
  straight: "顺子",
  pair_straight: "连对",
  airplane: "飞机",
  airplane_singles: "飞机带单",
  airplane_pairs: "飞机带对",
  bomb: "炸弹",
  rocket: "王炸"
};

const SEQUENCE_MAX_VALUE = 14;

function countsByValue(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const card of cards) {
    counts.set(card.value, (counts.get(card.value) ?? 0) + 1);
  }

  return counts;
}

function getSortedValues(counts: Map<number, number>): number[] {
  return [...counts.keys()].sort((a, b) => a - b);
}

function isConsecutive(values: number[]): boolean {
  if (values.length <= 1 || values.some((value) => value > SEQUENCE_MAX_VALUE)) {
    return false;
  }

  return values.every((value, index) => index === 0 || value === values[index - 1] + 1);
}

function analysis(
  type: HandType,
  cards: Card[],
  mainValue: number,
  sequenceLength?: number
): HandAnalysis {
  return {
    type,
    label: HAND_TYPE_LABELS[type],
    mainValue,
    cardCount: cards.length,
    sequenceLength
  };
}

function findTripleSequence(counts: Map<number, number>, length: number): number[] | null {
  const tripleValues = getSortedValues(counts).filter(
    (value) => value <= SEQUENCE_MAX_VALUE && counts.get(value) === 3
  );

  for (let start = tripleValues.length - length; start >= 0; start -= 1) {
    const candidate = tripleValues.slice(start, start + length);
    if (candidate.length === length && isConsecutive(candidate)) {
      return candidate;
    }
  }

  return null;
}

function remainingCountsWithout(counts: Map<number, number>, mainValues: number[]): Map<number, number> {
  const remaining = new Map(counts);

  for (const value of mainValues) {
    remaining.delete(value);
  }

  return remaining;
}

function totalCount(counts: Map<number, number>): number {
  return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

export function analyzeHand(cards: Card[]): HandAnalysis | null {
  if (cards.length === 0) {
    return null;
  }

  const sorted = sortCards(cards);
  const counts = countsByValue(sorted);
  const values = getSortedValues(counts);
  const countValues = [...counts.values()];
  const maxValue = values.at(-1) ?? 0;

  if (cards.length === 1) {
    return analysis("single", sorted, sorted[0].value);
  }

  if (cards.length === 2) {
    if (values.includes(17) && values.includes(18)) {
      return analysis("rocket", sorted, 18);
    }

    if (countValues[0] === 2) {
      return analysis("pair", sorted, maxValue);
    }
  }

  if (cards.length === 3 && countValues[0] === 3) {
    return analysis("triple", sorted, maxValue);
  }

  if (cards.length === 4) {
    if (countValues[0] === 4) {
      return analysis("bomb", sorted, maxValue);
    }

    if (countValues.includes(3)) {
      const mainValue = values.find((value) => counts.get(value) === 3) ?? maxValue;
      return analysis("triple_single", sorted, mainValue);
    }
  }

  if (cards.length >= 5 && countValues.every((count) => count === 1) && isConsecutive(values)) {
    return analysis("straight", sorted, maxValue, values.length);
  }

  if (
    cards.length >= 6 &&
    cards.length % 2 === 0 &&
    countValues.every((count) => count === 2) &&
    isConsecutive(values)
  ) {
    return analysis("pair_straight", sorted, maxValue, values.length);
  }

  if (cards.length === 5 && countValues.includes(3) && countValues.includes(2)) {
    const mainValue = values.find((value) => counts.get(value) === 3) ?? maxValue;
    return analysis("triple_pair", sorted, mainValue);
  }

  if (
    cards.length >= 6 &&
    cards.length % 3 === 0 &&
    countValues.every((count) => count === 3) &&
    isConsecutive(values)
  ) {
    return analysis("airplane", sorted, maxValue, values.length);
  }

  if (cards.length >= 8 && cards.length % 4 === 0) {
    const sequenceLength = cards.length / 4;
    const mainValues = findTripleSequence(counts, sequenceLength);

    if (mainValues) {
      const remaining = remainingCountsWithout(counts, mainValues);
      if (totalCount(remaining) === sequenceLength) {
        return analysis("airplane_singles", sorted, mainValues.at(-1) ?? maxValue, sequenceLength);
      }
    }
  }

  if (cards.length >= 10 && cards.length % 5 === 0) {
    const sequenceLength = cards.length / 5;
    const mainValues = findTripleSequence(counts, sequenceLength);

    if (mainValues) {
      const remaining = remainingCountsWithout(counts, mainValues);
      const remainingCounts = [...remaining.values()];

      if (remainingCounts.length === sequenceLength && remainingCounts.every((count) => count === 2)) {
        return analysis("airplane_pairs", sorted, mainValues.at(-1) ?? maxValue, sequenceLength);
      }
    }
  }

  return null;
}

export function canBeatHand(candidate: HandAnalysis, previous?: HandAnalysis): boolean {
  if (!previous) {
    return true;
  }

  if (candidate.type === "rocket") {
    return previous.type !== "rocket";
  }

  if (previous.type === "rocket") {
    return false;
  }

  if (candidate.type === "bomb" && previous.type !== "bomb") {
    return true;
  }

  if (previous.type === "bomb" && candidate.type !== "bomb") {
    return false;
  }

  if (candidate.type !== previous.type || candidate.cardCount !== previous.cardCount) {
    return false;
  }

  if ((candidate.sequenceLength ?? 0) !== (previous.sequenceLength ?? 0)) {
    return false;
  }

  return candidate.mainValue > previous.mainValue;
}

export function validatePlay(
  cards: Card[],
  previous?: HandAnalysis
): { ok: true; analysis: HandAnalysis } | { ok: false; reason: string } {
  const candidate = analyzeHand(cards);

  if (!candidate) {
    return { ok: false, reason: "这组牌不是首版支持的合法牌型。" };
  }

  if (!canBeatHand(candidate, previous)) {
    return { ok: false, reason: "这组牌压不过上一手。" };
  }

  return { ok: true, analysis: candidate };
}

export function calculateRoundResult(
  landlordSeat: PlayerSeat,
  winnerSeat: PlayerSeat,
  multiplier: number
): RoundResult {
  const landlordWon = landlordSeat === winnerSeat;
  const scores: SeatScores = { 0: 0, 1: 0, 2: 0 };

  for (const seat of [0, 1, 2] as PlayerSeat[]) {
    if (seat === landlordSeat) {
      scores[seat] = landlordWon ? 2 * multiplier : -2 * multiplier;
    } else {
      scores[seat] = landlordWon ? -1 * multiplier : multiplier;
    }
  }

  return {
    winnerSeat,
    landlordSeat,
    landlordWon,
    multiplier,
    scores
  };
}
