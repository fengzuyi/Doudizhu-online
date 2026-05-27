import { createDeck, shuffleDeck, sortCards } from "./cards.js";
import type {
  Card,
  DaBanZiHandAnalysis,
  DaBanZiHandType,
  DaBanZiPartnerCallOption,
  Rank,
  Suit
} from "./types.js";

const SUITED_SUITS: Array<Exclude<Suit, "joker">> = ["spades", "hearts", "clubs", "diamonds"];
const SPRING_RANKS: Rank[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
const PARTNER_CALL_RANKS: Rank[] = ["2", "A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];

const TYPE_LABEL: Record<DaBanZiHandType, string> = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  bomb: "炸弹",
  straight: "顺子",
  pair_straight: "连对",
  rolling_triples: "三滚筒",
  rolling_bombs: "四滚筒"
};

export function createDaBanZiDeck(): Card[] {
  return createDeck().filter((card) => card.suit !== "joker");
}

export function shuffleDaBanZiDeck(rng: () => number = Math.random): Card[] {
  return shuffleDeck(createDaBanZiDeck(), rng);
}

export function dealDaBanZiHands(deck: Card[], startSeat: number): Card[][] {
  if (deck.length !== 52) {
    throw new Error("打板子必须使用 52 张无王牌。");
  }

  const hands: Card[][] = [[], [], [], []];
  for (let round = 0; round < 13; round += 1) {
    for (let offset = 0; offset < 4; offset += 1) {
      const seat = (startSeat + offset) % 4;
      hands[seat].push(deck[round * 4 + offset]);
    }
  }

  return hands.map((hand) => sortDaBanZiCards(hand));
}

export function sortDaBanZiCards(cards: Card[]): Card[] {
  return sortCards(cards);
}

export function isDaBanZiSpring(cards: Card[]): boolean {
  if (cards.length !== 13 || cards.some((card) => card.suit === "joker")) {
    return false;
  }

  const ranks = new Set(cards.map((card) => card.rank));
  return SPRING_RANKS.every((rank) => ranks.has(rank));
}

export function analyzeDaBanZiHand(cards: Card[]): DaBanZiHandAnalysis {
  if (cards.length === 0) {
    throw new Error("请选择要出的牌。");
  }
  if (cards.some((card) => card.suit === "joker")) {
    throw new Error("打板子不使用大小王。");
  }

  const values = cards.map((card) => card.value).sort((a, b) => a - b);
  const counts = countValues(values);
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);

  if (cards.length === 1) {
    return makeAnalysis("single", values[0], cards.length);
  }

  if (cards.length === 2 && entries.length === 1) {
    return makeAnalysis("pair", values[0], cards.length);
  }

  if (cards.length === 3 && entries.length === 1) {
    return makeAnalysis("triple", values[0], cards.length);
  }

  if (cards.length === 4 && entries.length === 1) {
    return makeAnalysis("bomb", values[0], cards.length);
  }

  const straight = getConsecutiveSequence(entries, 1, 3);
  if (straight && cards.length === straight.length) {
    return makeAnalysis("straight", straight.at(-1) ?? 0, cards.length, straight.length);
  }

  const pairStraight = getConsecutiveSequence(entries, 2, 3);
  if (pairStraight && cards.length === pairStraight.length * 2) {
    return makeAnalysis("pair_straight", pairStraight.at(-1) ?? 0, cards.length, pairStraight.length);
  }

  const rollingTriples = getConsecutiveSequence(entries, 3, 3);
  if (rollingTriples && cards.length === rollingTriples.length * 3) {
    return makeAnalysis("rolling_triples", rollingTriples.at(-1) ?? 0, cards.length, rollingTriples.length);
  }

  const rollingBombs = getConsecutiveSequence(entries, 4, 3);
  if (rollingBombs && cards.length === rollingBombs.length * 4) {
    return makeAnalysis("rolling_bombs", rollingBombs.at(-1) ?? 0, cards.length, rollingBombs.length);
  }

  throw new Error("不是合法的打板子牌型。");
}

export function canBeatDaBanZiHand(candidate: DaBanZiHandAnalysis, previous?: DaBanZiHandAnalysis): boolean {
  if (!previous) {
    return true;
  }

  if (isRolling(candidate.type)) {
    if (!isRolling(previous.type)) {
      return true;
    }
    if (candidate.type !== previous.type) {
      return candidate.type === "rolling_bombs";
    }
    return candidate.mainValue > previous.mainValue;
  }

  if (isRolling(previous.type)) {
    return false;
  }

  if (candidate.type === "bomb") {
    if (previous.type !== "bomb") {
      return true;
    }
    return candidate.mainValue > previous.mainValue;
  }

  if (previous.type === "bomb") {
    return false;
  }

  if (candidate.type === "pair_straight") {
    if (previous.type === "pair_straight") {
      return candidate.mainValue > previous.mainValue;
    }
    return ["single", "pair", "triple", "straight"].includes(previous.type);
  }

  if (candidate.type === "triple") {
    if (previous.type === "triple") {
      return candidate.mainValue > previous.mainValue;
    }
    return previous.type === "single" || previous.type === "pair" || previous.type === "straight";
  }

  if (candidate.type !== previous.type) {
    return false;
  }

  if (candidate.type === "straight") {
    return candidate.sequenceLength === previous.sequenceLength && candidate.mainValue > previous.mainValue;
  }

  return candidate.mainValue > previous.mainValue;
}

export function getDaBanZiPartnerCallOptions(hand: Card[]): DaBanZiPartnerCallOption[] {
  for (const rank of PARTNER_CALL_RANKS) {
    const ownedSuits = new Set(hand.filter((card) => card.rank === rank).map((card) => card.suit));
    const options = SUITED_SUITS.filter((suit) => !ownedSuits.has(suit)).map((suit) => makePartnerOption(rank, suit));
    if (options.length > 0) {
      return options;
    }
  }

  return [];
}

export function makeDaBanZiPartnerCallOption(rank: Rank, suit: Exclude<Suit, "joker">): DaBanZiPartnerCallOption {
  return makePartnerOption(rank, suit);
}

function makeAnalysis(
  type: DaBanZiHandType,
  mainValue: number,
  cardCount: number,
  sequenceLength?: number
): DaBanZiHandAnalysis {
  return {
    type,
    label: TYPE_LABEL[type],
    mainValue,
    cardCount,
    sequenceLength
  };
}

function countValues(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function getConsecutiveSequence(entries: Array<[number, number]>, expectedCount: number, minLength: number) {
  if (entries.length < minLength || entries.some(([value, count]) => value >= 15 || count !== expectedCount)) {
    return undefined;
  }

  const values = entries.map(([value]) => value);
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] !== values[index - 1] + 1) {
      return undefined;
    }
  }

  return values;
}

function isRolling(type: DaBanZiHandType) {
  return type === "rolling_triples" || type === "rolling_bombs";
}

function makePartnerOption(rank: Rank, suit: Exclude<Suit, "joker">): DaBanZiPartnerCallOption {
  const card = createDaBanZiDeck().find((candidate) => candidate.rank === rank && candidate.suit === suit);
  if (!card) {
    throw new Error("无效的叫队友牌。");
  }

  return {
    rank,
    suit,
    label: `${card.suitSymbol}${card.label}`
  };
}
