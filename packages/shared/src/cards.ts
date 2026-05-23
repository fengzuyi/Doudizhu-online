import type { Card, Rank, Suit } from "./types.js";

const SUITS: Array<{ suit: Suit; symbol: string; color: Card["color"] }> = [
  { suit: "spades", symbol: "♠", color: "black" },
  { suit: "hearts", symbol: "♥", color: "red" },
  { suit: "clubs", symbol: "♣", color: "black" },
  { suit: "diamonds", symbol: "♦", color: "red" }
];

const RANKS: Array<{ rank: Rank; value: number; label: string }> = [
  { rank: "3", value: 3, label: "3" },
  { rank: "4", value: 4, label: "4" },
  { rank: "5", value: 5, label: "5" },
  { rank: "6", value: 6, label: "6" },
  { rank: "7", value: 7, label: "7" },
  { rank: "8", value: 8, label: "8" },
  { rank: "9", value: 9, label: "9" },
  { rank: "10", value: 10, label: "10" },
  { rank: "J", value: 11, label: "J" },
  { rank: "Q", value: 12, label: "Q" },
  { rank: "K", value: 13, label: "K" },
  { rank: "A", value: 14, label: "A" },
  { rank: "2", value: 15, label: "2" }
];

const SUIT_ORDER: Record<Suit, number> = {
  diamonds: 0,
  clubs: 1,
  hearts: 2,
  spades: 3,
  joker: 4
};

export function createDeck(): Card[] {
  const suitedCards = RANKS.flatMap((rank) =>
    SUITS.map(({ suit, symbol, color }) => ({
      id: `${suit}-${rank.rank}`,
      suit,
      rank: rank.rank,
      value: rank.value,
      label: rank.label,
      suitSymbol: symbol,
      color
    }))
  );

  return [
    ...suitedCards,
    {
      id: "joker-small",
      suit: "joker",
      rank: "SJ",
      value: 17,
      label: "小王",
      suitSymbol: "JOKER",
      color: "black"
    },
    {
      id: "joker-big",
      suit: "joker",
      rank: "BJ",
      value: 18,
      label: "大王",
      suitSymbol: "JOKER",
      color: "red"
    }
  ];
}

export function shuffleDeck(cards: Card[], rng: () => number = Math.random): Card[] {
  const shuffled = [...cards];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

export function sortCards(cards: Card[], direction: "asc" | "desc" = "asc"): Card[] {
  const sorted = [...cards].sort((a, b) => {
    const valueDelta = a.value - b.value;
    if (valueDelta !== 0) {
      return valueDelta;
    }

    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
  });

  return direction === "asc" ? sorted : sorted.reverse();
}

export function dealCards(deck: Card[]): { hands: [Card[], Card[], Card[]]; bottomCards: Card[] } {
  if (deck.length !== 54) {
    throw new Error("斗地主必须使用 54 张牌发牌。");
  }

  return {
    hands: [
      sortCards(deck.slice(0, 17)),
      sortCards(deck.slice(17, 34)),
      sortCards(deck.slice(34, 51))
    ],
    bottomCards: sortCards(deck.slice(51))
  };
}
