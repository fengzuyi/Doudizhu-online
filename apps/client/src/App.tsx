import { useEffect, useMemo, useState } from "react";
import { CircleSlash, Clipboard, Crown, LogOut, Play, Send, Users } from "lucide-react";
import type { BidScore, Card, PlayerSeat, PlayerView, RoomView, RoundResult } from "@doudizhu/shared";
import { socket } from "./socket.js";

const SEATS = [0, 1, 2] as const satisfies PlayerSeat[];

function seatName(seat: PlayerSeat, selfSeat?: PlayerSeat): string {
  if (seat === selfSeat) {
    return "你";
  }

  if (selfSeat === undefined) {
    return `座位 ${seat + 1}`;
  }

  return seat === ((selfSeat + 1) % 3) ? "下家" : "上家";
}

function formatScore(result: RoundResult | undefined, seat: PlayerSeat): string {
  if (!result) {
    return "0";
  }

  const score = result.scores[seat];
  return score > 0 ? `+${score}` : `${score}`;
}

function getPhaseLabel(room: RoomView | null): string {
  if (!room) {
    return "未入座";
  }

  const labels: Record<RoomView["phase"], string> = {
    lobby: "准备中",
    bidding: "叫分中",
    playing: "出牌中",
    ended: "已结算"
  };

  return labels[room.phase];
}

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [nickname, setNickname] = useState(() => localStorage.getItem("doudizhu:nickname") ?? "");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [room, setRoom] = useState<RoomView | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<string>("");
  const [endedNotice, setEndedNotice] = useState<string>("");

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }

    function onDisconnect() {
      setConnected(false);
      setToast("连接已断开。");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", ({ roomView }) => {
      setRoom(roomView);
      setSelectedIds(new Set());
      if (roomView.phase !== "ended") {
        setEndedNotice("");
      }
    });
    socket.on("game:error", ({ message }) => {
      setToast(message);
    });
    socket.on("game:ended", ({ result, message }) => {
      if (message) {
        setEndedNotice(message);
      } else if (result) {
        setEndedNotice(result.landlordWon ? "地主获胜" : "农民获胜");
      }
    });

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state");
      socket.off("game:error");
      socket.off("game:ended");
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const self = useMemo(
    () => room?.players.find((player) => player.seat === room.selfSeat),
    [room]
  );
  const selfHand = self?.hand ?? [];
  const selectedCards = selfHand.filter((card) => selectedIds.has(card.id));
  const opponents = useMemo(() => {
    if (!room || room.selfSeat === undefined) {
      return room?.players.filter((player) => player.seat !== room?.selfSeat) ?? [];
    }

    return [((room.selfSeat + 2) % 3) as PlayerSeat, ((room.selfSeat + 1) % 3) as PlayerSeat]
      .map((seat) => room.players.find((player) => player.seat === seat))
      .filter((player): player is PlayerView => Boolean(player));
  }, [room]);

  function ensureNickname(): string | null {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setToast("请先输入昵称。");
      return null;
    }

    localStorage.setItem("doudizhu:nickname", trimmed);
    return trimmed;
  }

  function createRoom() {
    const name = ensureNickname();
    if (!name) {
      return;
    }
    socket.emit("room:create", { nickname: name });
  }

  function joinRoom() {
    const name = ensureNickname();
    const roomCode = roomCodeInput.trim().toUpperCase();
    if (!name) {
      return;
    }
    if (!roomCode) {
      setToast("请输入房间号。");
      return;
    }
    socket.emit("room:join", { roomCode, nickname: name });
  }

  function chooseBid(score: BidScore) {
    socket.emit("bid:choose", { score });
  }

  function toggleCard(cardId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

  function playSelected() {
    socket.emit("play:cards", { cardIds: [...selectedIds] });
  }

  function copyRoomCode() {
    if (!room) {
      return;
    }

    navigator.clipboard
      ?.writeText(room.roomCode)
      .then(() => setToast("房间号已复制。"))
      .catch(() => setToast("复制失败，请手动选择房间号。"));
  }

  if (!room) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Dou Dizhu Online</p>
            <h1>在线斗地主</h1>
          </div>
          <ConnectionPill connected={connected} />
        </header>

        <main className="lobby-panel">
          <section className="brand-panel">
            <div className="brand-mark">
              <Crown size={36} aria-hidden="true" />
            </div>
            <h2>三人真人房</h2>
            <p>本机演示版</p>
          </section>

          <section className="entry-panel" aria-label="进入房间">
            <label>
              昵称
              <input
                value={nickname}
                maxLength={16}
                onChange={(event) => setNickname(event.target.value)}
                placeholder="例如：阿明"
              />
            </label>
            <button className="primary-btn" type="button" onClick={createRoom}>
              <Users size={18} aria-hidden="true" />
              创建房间
            </button>
            <div className="join-row">
              <label>
                房间号
                <input
                  value={roomCodeInput}
                  maxLength={4}
                  onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                  placeholder="ABCD"
                />
              </label>
              <button type="button" onClick={joinRoom}>
                <Play size={18} aria-hidden="true" />
                加入
              </button>
            </div>
          </section>
        </main>

        <Toast message={toast} />
      </div>
    );
  }

  const isMyTurn = room.currentTurn === room.selfSeat;
  const canPass = Boolean(room.lastPlay?.seat !== undefined && room.lastPlay.seat !== room.selfSeat);

  return (
    <div className="app-shell game-shell">
      <header className="game-header">
        <div className="room-meta">
          <span className="room-code">房间 {room.roomCode}</span>
          <button className="icon-btn" type="button" onClick={copyRoomCode} aria-label="复制房间号">
            <Clipboard size={18} aria-hidden="true" />
          </button>
          <span className="phase-pill">{getPhaseLabel(room)}</span>
          <span className="phase-pill">最高 {room.highestBidScore > 0 ? `${room.highestBidScore}分` : "未叫"}</span>
          <span className="phase-pill strong">倍数 x{room.multiplier}</span>
        </div>
        <div className="header-actions">
          <ConnectionPill connected={connected} />
          <button className="ghost-btn" type="button" onClick={() => socket.emit("room:leave")}>
            <LogOut size={18} aria-hidden="true" />
            离开
          </button>
        </div>
      </header>

      <main className="table-surface">
        <section className="opponents-row" aria-label="其他玩家">
          {opponents.map((player) => (
            <SeatPanel
              key={player.seat}
              player={player}
              label={seatName(player.seat, room.selfSeat)}
              active={room.currentTurn === player.seat}
              result={room.result}
            />
          ))}
          {opponents.length === 0 && <EmptySeats />}
        </section>

        <section className="center-table" aria-label="牌桌">
          <div className="bottom-cards">
            <span>底牌</span>
            <div className="mini-card-row">
              {room.bottomCards.length > 0
                ? room.bottomCards.map((card) => <CardView key={card.id} card={card} compact />)
                : Array.from({ length: room.hiddenBottomCount }).map((_, index) => <CardBack key={index} compact />)}
            </div>
          </div>

          <div className="last-play">
            <span>上一手</span>
            {room.lastPlay ? (
              <>
                <strong>{room.lastPlay.nickname} · {room.lastPlay.label}</strong>
                <div className="mini-card-row">
                  {room.lastPlay.cards?.map((card) => <CardView key={card.id} card={card} compact />)}
                </div>
              </>
            ) : (
              <strong>新一轮</strong>
            )}
          </div>

          <div className="message-strip">{room.message}</div>
        </section>

        <section className="action-zone" aria-label="操作区">
          <ActionBar
            room={room}
            self={self}
            isMyTurn={isMyTurn}
            selectedCount={selectedCards.length}
            canPass={canPass}
            onReady={() => socket.emit("game:ready")}
            onBid={chooseBid}
            onPlay={playSelected}
            onPass={() => socket.emit("play:pass")}
            onClear={() => setSelectedIds(new Set())}
          />
        </section>

        <section className="self-area" aria-label="我的手牌">
          {self && (
            <SeatPanel
              player={self}
              label={seatName(self.seat, room.selfSeat)}
              active={isMyTurn}
              result={room.result}
              compact
            />
          )}
          <div className="hand-grid">
            {selfHand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedIds.has(card.id)}
                onClick={() => toggleCard(card.id)}
              />
            ))}
          </div>
        </section>

        <aside className="turn-log" aria-label="牌局记录">
          <h2>牌局记录</h2>
          <div className="log-list">
            {room.turnLog.map((event) => (
              <div className="log-line" key={`${event.at}-${event.label}-${event.seat ?? "system"}`}>
                <span>{event.nickname ?? "系统"}</span>
                <strong>{event.label}</strong>
              </div>
            ))}
          </div>
        </aside>
      </main>

      {room.phase === "ended" && <ResultDialog room={room} notice={endedNotice} />}
      <Toast message={toast} />
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return <span className={`connection-pill ${connected ? "online" : "offline"}`}>{connected ? "已连接" : "离线"}</span>;
}

function EmptySeats() {
  return (
    <div className="empty-seats">
      <Users size={22} aria-hidden="true" />
      等待玩家入座
    </div>
  );
}

function SeatPanel({
  player,
  label,
  active,
  result,
  compact = false
}: {
  player: PlayerView;
  label: string;
  active: boolean;
  result?: RoundResult;
  compact?: boolean;
}) {
  return (
    <article className={`seat-panel ${active ? "active" : ""} ${compact ? "compact" : ""}`}>
      <div className="seat-title">
        <span>{label}</span>
        {player.isLandlord && <Crown size={16} aria-label="地主" />}
      </div>
      <strong>{player.nickname}</strong>
      <div className="seat-stats">
        <span>{player.cardCount} 张</span>
        <span>{player.connected ? "在线" : "离线"}</span>
        {result && <span className={result.scores[player.seat] >= 0 ? "score plus" : "score minus"}>{formatScore(result, player.seat)}</span>}
      </div>
      {player.lastAction && <p>{player.lastAction}</p>}
    </article>
  );
}

function ActionBar({
  room,
  self,
  isMyTurn,
  selectedCount,
  canPass,
  onReady,
  onBid,
  onPlay,
  onPass,
  onClear
}: {
  room: RoomView;
  self?: PlayerView;
  isMyTurn: boolean;
  selectedCount: number;
  canPass: boolean;
  onReady: () => void;
  onBid: (score: BidScore) => void;
  onPlay: () => void;
  onPass: () => void;
  onClear: () => void;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="actions">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
      </div>
    );
  }

  if (room.phase === "bidding") {
    if (!isMyTurn) {
      return <div className="waiting-text">等待玩家操作</div>;
    }

    return (
      <div className="actions">
        <button type="button" onClick={() => onBid(0)}>
          <CircleSlash size={18} aria-hidden="true" />
          不叫
        </button>
        {[1, 2, 3].map((score) => (
          <button
            className={score === 3 ? "primary-btn" : ""}
            type="button"
            key={score}
            onClick={() => onBid(score as BidScore)}
            disabled={score <= room.highestBidScore}
          >
            <Crown size={18} aria-hidden="true" />
            {score}分
          </button>
        ))}
      </div>
    );
  }

  if (room.phase === "playing") {
    if (!isMyTurn) {
      return <div className="waiting-text">等待对手出牌</div>;
    }

    return (
      <div className="actions">
        <button className="primary-btn" type="button" onClick={onPlay} disabled={selectedCount === 0}>
          <Send size={18} aria-hidden="true" />
          出牌
        </button>
        <button type="button" onClick={onPass} disabled={!canPass}>
          <CircleSlash size={18} aria-hidden="true" />
          不出
        </button>
        <button className="ghost-btn" type="button" onClick={onClear} disabled={selectedCount === 0}>
          清空选择
        </button>
      </div>
    );
  }

  return (
    <div className="actions">
      <button className="primary-btn" type="button" onClick={onReady}>
        <Play size={18} aria-hidden="true" />
        再来一局
      </button>
    </div>
  );
}

function CardView({
  card,
  selected = false,
  compact = false,
  onClick
}: {
  card: Card;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="card-rank">{card.label}</span>
      <span className="card-suit">{card.suitSymbol}</span>
    </>
  );

  if (!onClick) {
    return <div className={`playing-card ${card.color} ${compact ? "compact" : ""}`}>{content}</div>;
  }

  return (
    <button
      className={`playing-card selectable ${card.color} ${selected ? "selected" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${selected ? "取消选择" : "选择"} ${card.label}${card.suit === "joker" ? "" : card.suitSymbol}`}
    >
      {content}
    </button>
  );
}

function CardBack({ compact = false }: { compact?: boolean }) {
  return <div className={`card-back ${compact ? "compact" : ""}`} aria-hidden="true" />;
}

function ResultDialog({ room, notice }: { room: RoomView; notice: string }) {
  const result = room.result;
  const title = notice || (result ? (result.landlordWon ? "地主获胜" : "农民获胜") : room.message ?? "本局结束");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <section className="result-dialog">
        <h2 id="result-title">{title}</h2>
        {result && <p>最终倍数 x{result.multiplier}</p>}
        <div className="result-list">
          {room.players.map((player) => (
            <div className="result-row" key={player.seat}>
              <span>
                {player.nickname}
                {player.isLandlord ? " · 地主" : " · 农民"}
              </span>
              <strong className={result && result.scores[player.seat] >= 0 ? "score plus" : "score minus"}>
                {formatScore(result, player.seat)}
              </strong>
            </div>
          ))}
        </div>
        <button className="primary-btn" type="button" onClick={() => socket.emit("game:ready")}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </section>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return message ? <div className="toast" role="status">{message}</div> : null;
}
