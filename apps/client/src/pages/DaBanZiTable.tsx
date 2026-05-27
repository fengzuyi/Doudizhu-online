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
  onInfo
}: DaBanZiTableProps) {
  const self = room.players.find((player) => player.seat === room.selfSeat);
  const opponents = room.players.filter((player) => player.seat !== room.selfSeat);
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
          <strong className="dbz-brand">打板子好友房</strong>
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
          <div className="dbz-opponents">
            {opponents.map((player) => (
              <DaBanZiSeat key={player.seat} player={player} active={room.currentTurn === player.seat || room.baoCurrentSeat === player.seat} />
            ))}
            {Array.from({ length: room.maxPlayers - room.players.length }).map((_, index) => (
              <div className="dbz-empty-seat" key={index}>
                等待入座
              </div>
            ))}
          </div>

          <section className="dbz-center">
            <div className="dbz-status-card">
              <Sparkles size={18} aria-hidden="true" />
              <strong>{room.message ?? "等待玩家操作"}</strong>
              {room.calledPartnerCard && <span>叫牌：{room.calledPartnerCard.label}</span>}
              {room.freeLeadRemaining > 0 && <span>包了连出剩余 {room.freeLeadRemaining} 次</span>}
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
            {self && <DaBanZiSeat player={self} active={room.currentTurn === self.seat || room.baoCurrentSeat === self.seat} self />}
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
        </section>

        <aside className="dbz-log-panel" aria-label="牌局记录">
          <h3>牌局记录</h3>
          <div>
            {room.turnLog.slice(-10).map((event, index) => (
              <p key={`${event.at}-${index}`}>
                <strong>{event.nickname ?? "系统"}</strong>
                {event.label}
              </p>
            ))}
          </div>
        </aside>
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
      <div className="dbz-actions">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready || room.playerCount < 4}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
        <span>{room.playerCount < 4 ? "等待 4 人坐满" : "全员准备后开始"}</span>
      </div>
    );
  }

  if (room.phase === "ended") {
    return (
      <div className="dbz-actions">
        <button className="primary-btn" type="button" onClick={onReady}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </div>
    );
  }

  if (room.phase === "bao") {
    if (!isMyTurn) {
      return <div className="dbz-waiting">等待玩家选择是否包了</div>;
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
    <div className="dbz-actions">
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

function DaBanZiSeat({ player, active, self = false }: { player: DaBanZiPlayerView; active: boolean; self?: boolean }) {
  return (
    <article className={`dbz-seat ${active ? "active" : ""} ${self ? "self" : ""}`}>
      <div className="dbz-seat-head">
        <strong>{self ? "你" : `座位 ${player.seat + 1}`}</strong>
        <span>{roleLabel(player.role)}</span>
      </div>
      <h3>{player.nickname}</h3>
      <p>
        {player.cardCount} 张 · 收 {player.collectedCount} · {player.connected ? "在线" : "离线"}
      </p>
      {player.finishedRank && <p>第 {player.finishedRank} 名出完</p>}
      {player.lastAction && <em>{player.lastAction}</em>}
    </article>
  );
}

function DaBanZiCard({ card, small = false }: { card: Card; small?: boolean }) {
  return (
    <div className={`playing-card dbz-card ${small ? "small" : ""} ${card.color}`}>
      <span className="card-corner">
        <span className="card-rank">{card.label}</span>
        <span className="card-suit">{card.suitSymbol}</span>
      </span>
      <span className="card-center-suit">{card.suitSymbol}</span>
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
    unknown: "身份隐藏"
  };
  return labels[role ?? "unknown"];
}
