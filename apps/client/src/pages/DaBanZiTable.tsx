import {
  Bell,
  Clipboard,
  Crown,
  HelpCircle,
  LogOut,
  PackageCheck,
  Play,
  Settings,
  Shield,
  Sparkles,
  Users
} from "lucide-react";
import type { Card, DaBanZiPartnerCallOption, DaBanZiPlayerView, DaBanZiRoomView } from "@doudizhu/shared";
import type { ReactNode } from "react";

const DBZ_ASSET_BASE = "/assets/zhajinhua";
const DBZ_CARD_BACK_SRC = `${DBZ_ASSET_BASE}/card_back/red_back_line.png`;
const DBZ_CHIP_SRC = "/assets/chips/chips_stacked_green.png";
const DBZ_TURN_RING_SRC = "/assets/flash/0baa0bf0-d89d-419e-be7a-1bca8cc44b53.362fd_1.png";
const DBZ_HEAD_ASSETS = [
  "/assets/head/img_ntx10.png",
  "/assets/head/img_ntx12.png",
  "/assets/head/img_ntx3.png",
  "/assets/head/img_ntx7.png",
  "/assets/head/img_ntx9.png",
  "/assets/head/img_txn10.png",
  "/assets/head/img_txn2.png",
  "/assets/head/img_txn33.png",
  "/assets/head/img_txn5.png",
  "/assets/head/img_txn8.png"
];
const DBZ_SEAT_POSITIONS = ["bottom", "right", "top", "left"] as const;

type DbzSeatPosition = (typeof DBZ_SEAT_POSITIONS)[number];

interface DaBanZiTableProps {
  room: DaBanZiRoomView;
  connected: boolean;
  notice: string;
  selectedIds: Set<string>;
  onToggleCard: (cardId: string) => void;
  onReady: () => void;
  onBaoChoose: (action: "bao" | "pass") => void;
  onPartnerCall: (option: DaBanZiPartnerCallOption) => void;
  onPlay: () => void;
  onPass: () => void;
  onCopyRoomCode: () => void;
  onLeave: () => void;
  onInfo: (message: string) => void;
  voiceDock?: ReactNode;
}

export function DaBanZiTable({
  room,
  connected,
  notice,
  selectedIds,
  onToggleCard,
  onReady,
  onBaoChoose,
  onPartnerCall,
  onPlay,
  onPass,
  onCopyRoomCode,
  onLeave,
  onInfo,
  voiceDock
}: DaBanZiTableProps) {
  const self = room.players.find((player) => player.seat === room.selfSeat);
  const seatSlots = buildDaBanZiSeatSlots(room.players, room.maxPlayers, room.selfSeat);
  const selfCards = self?.hand ?? [];
  const isMyTurn =
    (room.phase === "bao" && room.baoCurrentSeat === room.selfSeat) ||
    (room.phase === "partner_call" && room.bankerSeat === room.selfSeat) ||
    (room.phase === "playing" && room.currentTurn === room.selfSeat);
  const selectedCount = selectedIds.size;

  return (
    <>
      <header className="dbz-header">
        <div className="dbz-header-left">
          <strong className="dbz-brand">打板子</strong>
          <span className="dbz-pill room">
            房间 <b>{room.roomCode}</b>
            <button type="button" onClick={onCopyRoomCode} aria-label="复制房间号">
              <Clipboard size={15} aria-hidden="true" />
            </button>
          </span>
          <span className="dbz-pill">阶段 {phaseLabel(room)}</span>
          <span className="dbz-pill">模式 {modeLabel(room.mode)}</span>
          <span className="dbz-pill">本轮 {room.trickCardCount} 张</span>
        </div>

        <div className="dbz-header-actions">
          <span className={`connection-pill ${connected ? "online" : "offline"}`}>{connected ? "已连接" : "离线"}</span>
          <button className="zen-icon-button" type="button" onClick={() => onInfo("通知中心将在正式版开放。")} aria-label="通知">
            <Bell size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={() => onInfo("设置将在正式版开放。")} aria-label="设置">
            <Settings size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={() => onInfo("帮助中心将在正式版开放。")} aria-label="帮助">
            <HelpCircle size={18} aria-hidden="true" />
          </button>
          <button className="zen-leave-button" type="button" onClick={onLeave}>
            <LogOut size={18} aria-hidden="true" />
            离开
          </button>
        </div>
      </header>

      {!connected && <div className="zen-offline-banner">连接已断开，请刷新后重新进入房间。</div>}

      <main className="dbz-main">
        <section className="dbz-table" aria-label="打板子牌桌">
          <div className="dbz-seat-ring" aria-label="玩家座位">
            {seatSlots.map(({ seat, player, position }) =>
              player ? (
                <DaBanZiSeat
                  key={seat}
                  player={player}
                  active={room.currentTurn === player.seat || room.baoCurrentSeat === player.seat}
                  self={position === "bottom"}
                  position={position}
                />
              ) : (
                <DaBanZiEmptySeat key={seat} seat={seat} position={position} />
              )
            )}
          </div>

          <section className="dbz-center">
            <div className="dbz-status-card">
              <Sparkles size={18} aria-hidden="true" />
              <strong>{room.message ?? "等待玩家操作"}</strong>
              {room.calledPartnerCard && <span>叫牌：{room.calledPartnerCard.label}</span>}
            </div>

            <div className="dbz-last-play">
              <span>上一手</span>
              {room.lastPlay ? (
                <>
                  <strong>
                    {room.lastPlay.nickname} · {room.lastPlay.analysis.label}
                  </strong>
                  <div className="mini-card-row">
                    {room.lastPlay.cards.map((card) => (
                      <DaBanZiCard key={card.id} card={card} small />
                    ))}
                  </div>
                </>
              ) : (
                <strong>新一轮</strong>
              )}
            </div>

            <DaBanZiActionBar
              room={room}
              self={self}
              isMyTurn={isMyTurn}
              selectedCount={selectedCount}
              onReady={onReady}
              onBaoChoose={onBaoChoose}
              onPartnerCall={onPartnerCall}
              onPlay={onPlay}
              onPass={onPass}
            />
          </section>

          <section className="dbz-self-zone" aria-label="我的牌">
            <div className="dbz-hand">
              {selfCards.length > 0 ? (
                selfCards.map((card) => (
                  <button
                    className={`dbz-card-button ${selectedIds.has(card.id) ? "selected" : ""}`}
                    type="button"
                    key={card.id}
                    onClick={() => onToggleCard(card.id)}
                    aria-pressed={selectedIds.has(card.id)}
                  >
                    <DaBanZiCard card={card} />
                  </button>
                ))
              ) : (
                <span className="dbz-hand-placeholder">准备后发牌</span>
              )}
            </div>
          </section>
          {voiceDock}
        </section>
      </main>

      {room.phase === "ended" && <DaBanZiResultDialog room={room} notice={notice} onReady={onReady} />}
    </>
  );
}

function DaBanZiActionBar({
  room,
  self,
  isMyTurn,
  selectedCount,
  onReady,
  onBaoChoose,
  onPartnerCall,
  onPlay,
  onPass
}: {
  room: DaBanZiRoomView;
  self?: DaBanZiPlayerView;
  isMyTurn: boolean;
  selectedCount: number;
  onReady: () => void;
  onBaoChoose: (action: "bao" | "pass") => void;
  onPartnerCall: (option: DaBanZiPartnerCallOption) => void;
  onPlay: () => void;
  onPass: () => void;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="dbz-actions dbz-ready-actions">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready || room.playerCount < 4}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
      </div>
    );
  }

  if (room.phase === "ended") {
    return (
      <div className="dbz-actions dbz-bao-actions">
        <button className="primary-btn" type="button" onClick={onReady}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </div>
    );
  }

  if (room.phase === "bao") {
    if (!isMyTurn) {
      return null;
    }
    return (
      <div className="dbz-actions">
        <button className="primary-btn" type="button" onClick={() => onBaoChoose("bao")}>
          <Crown size={18} aria-hidden="true" />
          包了
        </button>
        <button type="button" onClick={() => onBaoChoose("pass")}>
          不包
        </button>
      </div>
    );
  }

  if (room.phase === "partner_call") {
    if (!isMyTurn || room.partnerCallOptions.length === 0) {
      return <div className="dbz-waiting">等待黑桃 7 玩家叫队友</div>;
    }
    return (
      <div className="dbz-actions dbz-call-options">
        {room.partnerCallOptions.map((option) => (
          <button type="button" key={`${option.suit}-${option.rank}`} onClick={() => onPartnerCall(option)}>
            <Users size={17} aria-hidden="true" />
            叫 {option.label}
          </button>
        ))}
      </div>
    );
  }

  if (!isMyTurn) {
    return <div className="dbz-waiting">等待对手操作</div>;
  }

  return (
    <div className="dbz-actions dbz-play-actions">
      <button className="primary-btn" type="button" onClick={onPlay} disabled={selectedCount === 0}>
        <Shield size={18} aria-hidden="true" />
        出牌 {selectedCount > 0 ? `(${selectedCount})` : ""}
      </button>
      <button type="button" onClick={onPass} disabled={!room.lastPlay}>
        不出
      </button>
    </div>
  );
}

function DaBanZiSeat({
  player,
  active,
  self = false,
  position
}: {
  player: DaBanZiPlayerView;
  active: boolean;
  self?: boolean;
  position: DbzSeatPosition;
}) {
  const hiddenCardCount = Math.min(player.cardCount || 0, 3);
  const previewCards = !self && player.hand ? player.hand.slice(0, 3) : [];
  const role = roleLabel(player.role);
  const lastAction = player.lastAction && player.lastAction !== role ? player.lastAction : undefined;

  return (
    <article className={`dbz-seat ${active ? "active" : ""} ${self ? "self" : ""} pos-${position}`}>
      <div className="dbz-seat-avatar">
        <img className="dbz-seat-avatar-img" src={getDbzAvatarSrc(player.seat)} alt={`${player.nickname}头像`} draggable={false} />
        {active && <img className="dbz-turn-ring" src={DBZ_TURN_RING_SRC} alt="" draggable={false} aria-hidden="true" />}
      </div>
      <div className="dbz-score-chip" aria-label={`积分 ${player.score}`}>
        <img src={DBZ_CHIP_SRC} alt="" draggable={false} />
        <span>{player.score}</span>
      </div>
      <div className="dbz-seat-info">
        <div className="dbz-seat-head">
          <strong>{self ? "你" : player.nickname}</strong>
        </div>
        <p>
          {player.cardCount} 张 · 收 {player.collectedCount}
          {!player.connected ? " · 离线" : ""}
        </p>
        {role && <em className="dbz-seat-role">{role}</em>}
        {player.finishedRank && <em>第 {player.finishedRank} 名出完</em>}
        {lastAction && <em>{lastAction}</em>}
      </div>
      {!self && hiddenCardCount > 0 && (
        <div className="dbz-seat-card-strip" aria-label={`${player.nickname}手牌`}>
          {previewCards.length > 0
            ? previewCards.map((card) => <DaBanZiCard key={card.id} card={card} small />)
            : Array.from({ length: hiddenCardCount }).map((_, index) => <DaBanZiCardBack key={index} small />)}
        </div>
      )}
    </article>
  );
}

function DaBanZiEmptySeat({ seat, position }: { seat: number; position: DbzSeatPosition }) {
  return (
    <div className={`dbz-empty-seat pos-${position}`}>
      <span>{seat + 1}</span>
      <strong>等待入座</strong>
    </div>
  );
}

function DaBanZiCard({ card, small = false }: { card: Card; small?: boolean }) {
  return (
    <div className={`dbz-card ${small ? "small" : ""}`}>
      <img src={getDaBanZiCardImageSrc(card)} alt={`${card.label}${card.suitSymbol}`} draggable={false} loading="lazy" />
    </div>
  );
}

function DaBanZiCardBack({ small = false }: { small?: boolean }) {
  return (
    <div className={`dbz-card dbz-card-back ${small ? "small" : ""}`} aria-hidden="true">
      <img src={DBZ_CARD_BACK_SRC} alt="" draggable={false} loading="lazy" />
    </div>
  );
}

function DaBanZiResultDialog({ room, notice, onReady }: { room: DaBanZiRoomView; notice: string; onReady: () => void }) {
  const result = room.result;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="dbz-result-title">
      <section className="result-dialog dbz-result-dialog">
        <h2 id="dbz-result-title">{notice || result?.winnerLabel || room.message || "本局结束"}</h2>
        {result && (
          <>
            <p>{result.reason}</p>
            <div className="dbz-result-teams">
              {Object.entries(result.teamCollectedCounts).map(([label, count]) => (
                <span key={label}>
                  {label}：{count} 张
                </span>
              ))}
            </div>
            <div className="dbz-result-list">
              {room.players.map((player) => (
                <p key={player.seat}>
                  <strong>{player.nickname}</strong>
                  <span>
                    {result.winnerSeats.includes(player.seat) ? "胜方" : "负方"}
                    {result.finishOrder.includes(player.seat) ? ` · 第 ${result.finishOrder.indexOf(player.seat) + 1} 名` : ""}
                  </span>
                  <b>{result.collectedCounts[player.seat] ?? 0} 张</b>
                  <b className={(result.scores[player.seat] ?? 0) >= 0 ? "score plus" : "score minus"}>
                    {formatScoreDelta(result.scores[player.seat] ?? 0)}
                  </b>
                </p>
              ))}
            </div>
          </>
        )}
        <button className="primary-btn" type="button" onClick={onReady}>
          <PackageCheck size={18} aria-hidden="true" />
          再来一局
        </button>
      </section>
    </div>
  );
}

function phaseLabel(room: DaBanZiRoomView) {
  const labels: Record<DaBanZiRoomView["phase"], string> = {
    lobby: "准备中",
    bao: "包了选择",
    partner_call: "叫队友",
    playing: "出牌中",
    ended: "已结算"
  };
  return labels[room.phase];
}

function modeLabel(mode: DaBanZiRoomView["mode"]) {
  const labels: Record<DaBanZiRoomView["mode"], string> = {
    undecided: "未定",
    two_vs_two: "2v2",
    one_vs_three: "1v3",
    spring: "春天"
  };
  return labels[mode];
}

function roleLabel(role: DaBanZiPlayerView["role"]) {
  const labels: Record<NonNullable<DaBanZiPlayerView["role"]>, string> = {
    banker: "庄家",
    partner: "队友",
    opponent: "对手",
    solo: "包了",
    defender: "防守",
    unknown: ""
  };
  return labels[role ?? "unknown"];
}

function formatScoreDelta(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}

function buildDaBanZiSeatSlots(players: DaBanZiPlayerView[], maxPlayers: number, selfSeat?: number) {
  const playersBySeat = new Map(players.map((player) => [player.seat, player]));
  const startSeat = selfSeat ?? 0;

  return Array.from({ length: Math.min(maxPlayers, DBZ_SEAT_POSITIONS.length) }, (_, index) => {
    const seat = (startSeat + index) % maxPlayers;
    return {
      seat,
      player: playersBySeat.get(seat),
      position: DBZ_SEAT_POSITIONS[index]
    };
  });
}

function getDbzAvatarSrc(seat: number) {
  return DBZ_HEAD_ASSETS[((seat % DBZ_HEAD_ASSETS.length) + DBZ_HEAD_ASSETS.length) % DBZ_HEAD_ASSETS.length];
}

function getDaBanZiCardImageSrc(card: Card) {
  if (card.suit === "joker") {
    return card.color === "red" ? `${DBZ_ASSET_BASE}/cards/card_joker_red.png` : `${DBZ_ASSET_BASE}/cards/card_joker_black.png`;
  }

  const suitName: Record<Exclude<Card["suit"], "joker">, string> = {
    spades: "spade",
    hearts: "heart",
    clubs: "clubs",
    diamonds: "diamond"
  };
  const rankName: Record<Card["rank"], string> = {
    "3": "3",
    "4": "4",
    "5": "5",
    "6": "6",
    "7": "7",
    "8": "8",
    "9": "9",
    "10": "10",
    J: "11",
    Q: "12",
    K: "13",
    A: "1",
    "2": "2",
    SJ: "joker_black",
    BJ: "joker_red"
  };

  return `${DBZ_ASSET_BASE}/cards/card_${suitName[card.suit]}_${rankName[card.rank]}.png`;
}
