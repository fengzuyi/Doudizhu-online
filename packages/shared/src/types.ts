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

export interface ChatMessage {
  id: string;
  account: string;
  nickname: string;
  text: string;
  at: number;
}

export type GameKind = "doudizhu" | "zha_jin_hua";

export type ZjhPhase = "lobby" | "playing" | "ended";

export type ZjhHandType = "high_card" | "pair" | "straight" | "flush" | "straight_flush" | "three_kind";

export interface ZjhHandAnalysis {
  type: ZjhHandType;
  label: string;
  rank: number;
  values: number[];
}

export interface ZjhPlayerView {
  seat: number;
  nickname: string;
  connected: boolean;
  ready: boolean;
  folded: boolean;
  seen: boolean;
  cardCount: number;
  score: number;
  invested: number;
  hand?: Card[];
  handLabel?: string;
  lastAction?: string;
}

export interface ZjhPublicAction {
  seat?: number;
  nickname?: string;
  action: "ready" | "see" | "call" | "raise" | "compare" | "fold" | "system";
  label: string;
  amount?: number;
  at: number;
}

export interface ZjhRoundResult {
  winnerSeat: number;
  winnerNickname: string;
  pot: number;
  scores: Record<number, number>;
  hands: Array<{
    seat: number;
    nickname: string;
    cards: Card[];
    handLabel: string;
    folded: boolean;
  }>;
}

export interface ZjhCompareReveal {
  targetSeat: number;
  targetNickname: string;
  cards: Card[];
  handLabel: string;
  at: number;
}

export interface ZjhRoomView {
  roomCode: string;
  phase: ZjhPhase;
  playerCount: number;
  maxPlayers: number;
  selfSeat?: number;
  players: ZjhPlayerView[];
  currentTurn?: number;
  bankerSeat?: number;
  pot: number;
  currentBet: number;
  round: number;
  maxRounds: number;
  baseAnte: number;
  minRaise: number;
  maxBet: number;
  turnLog: ZjhPublicAction[];
  result?: ZjhRoundResult;
  message?: string;
}

export interface ClientToServerEvents {
  "room:create": (payload: { nickname: string }) => void;
  "room:join": (payload: { roomCode: string; nickname: string }) => void;
  "room:leave": () => void;
  "game:ready": () => void;
  "bid:choose": (payload: { score: BidScore }) => void;
  "play:cards": (payload: { cardIds: string[] }) => void;
  "play:pass": () => void;
  "chat:join": (payload: { token: string }) => void;
  "chat:send": (payload: { text: string }) => void;
  "chat:leave": () => void;
  "zjh:room:create": (payload: { nickname: string; maxPlayers?: number }) => void;
  "zjh:room:join": (payload: { roomCode: string; nickname: string }) => void;
  "zjh:room:leave": () => void;
  "zjh:game:ready": () => void;
  "zjh:action:see": () => void;
  "zjh:action:call": () => void;
  "zjh:action:raise": (payload: { amount: number }) => void;
  "zjh:action:fold": () => void;
  "zjh:action:compare": (payload: { targetSeat: number }) => void;
}

export interface ServerToClientEvents {
  "room:state": (payload: { roomView: RoomView }) => void;
  "game:error": (payload: GameError) => void;
  "game:ended": (payload: { result?: RoundResult; message?: string }) => void;
  "chat:state": (payload: { messages: ChatMessage[]; onlineCount: number }) => void;
  "chat:message": (payload: { message: ChatMessage }) => void;
  "chat:error": (payload: GameError) => void;
  "zjh:room:state": (payload: { roomView: ZjhRoomView }) => void;
  "zjh:compare:reveal": (payload: { reveal: ZjhCompareReveal }) => void;
  "zjh:game:ended": (payload: { result?: ZjhRoundResult; message?: string }) => void;
}
