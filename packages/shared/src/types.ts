export type Suit = "spades" | "hearts" | "clubs" | "diamonds" | "joker";

export type Rank =
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A"
  | "2"
  | "SJ"
  | "BJ";

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  value: number;
  label: string;
  suitSymbol: string;
  color: "red" | "black";
}

export type PlayerSeat = 0 | 1 | 2;

export type GamePhase = "lobby" | "bidding" | "playing" | "ended";

export type BidScore = 0 | 1 | 2 | 3;

export type PlayAction = "play" | "pass";

export type HandType =
  | "single"
  | "pair"
  | "triple"
  | "triple_single"
  | "triple_pair"
  | "straight"
  | "pair_straight"
  | "airplane"
  | "airplane_singles"
  | "airplane_pairs"
  | "bomb"
  | "rocket";

export interface HandAnalysis {
  type: HandType;
  label: string;
  mainValue: number;
  cardCount: number;
  sequenceLength?: number;
}

export interface RoomState {
  roomCode: string;
  phase: GamePhase;
  playerCount: number;
}

export interface PlayerView {
  seat: PlayerSeat;
  nickname: string;
  connected: boolean;
  ready: boolean;
  isLandlord: boolean;
  cardCount: number;
  hand?: Card[];
  lastAction?: string;
}

export interface PublicPlay {
  seat?: PlayerSeat;
  nickname?: string;
  action: PlayAction | "bid" | "system";
  label: string;
  cards?: Card[];
  handType?: HandType;
  at: number;
}

export type SeatScores = Record<PlayerSeat, number>;

export interface RoundResult {
  winnerSeat: PlayerSeat;
  landlordSeat: PlayerSeat;
  landlordWon: boolean;
  multiplier: number;
  scores: SeatScores;
}

export interface RoomView extends RoomState {
  selfSeat?: PlayerSeat;
  players: PlayerView[];
  currentTurn?: PlayerSeat;
  landlordSeat?: PlayerSeat;
  bottomCards: Card[];
  hiddenBottomCount: number;
  multiplier: number;
  bidCurrentSeat?: PlayerSeat;
  highestBidScore: BidScore;
  highestBidSeat?: PlayerSeat;
  lastPlay?: PublicPlay;
  turnLog: PublicPlay[];
  result?: RoundResult;
  message?: string;
}

export interface GameError {
  code: string;
  message: string;
}

export interface ClientToServerEvents {
  "room:create": (payload: { nickname: string }) => void;
  "room:join": (payload: { roomCode: string; nickname: string }) => void;
  "room:leave": () => void;
  "game:ready": () => void;
  "bid:choose": (payload: { score: BidScore }) => void;
  "play:cards": (payload: { cardIds: string[] }) => void;
  "play:pass": () => void;
}

export interface ServerToClientEvents {
  "room:state": (payload: { roomView: RoomView }) => void;
  "game:error": (payload: GameError) => void;
  "game:ended": (payload: { result?: RoundResult; message?: string }) => void;
}
