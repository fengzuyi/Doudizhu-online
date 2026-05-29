import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bell,
  CircleSlash,
  Clipboard,
  Crown,
  Eye,
  HelpCircle,
  LogOut,
  Play,
  Settings,
  Shield,
  Sparkles,
  Swords
} from "lucide-react";
import { getZjhBetTier, ZJH_BLIND_BETS, ZJH_SEEN_BETS } from "@doudizhu/shared";
import type { Card, ZjhCompareReveal, ZjhPlayerView, ZjhRoomView } from "@doudizhu/shared";

const ZJH_ASSET_BASE = "/assets/zhajinhua";
const ZJH_CARD_BACK_SRC = `${ZJH_ASSET_BASE}/card_back/red_back_line.png`;

interface ZhaJinHuaTableProps {
  room: ZjhRoomView;
  connected: boolean;
  notice: string;
  compareReveal?: ZjhCompareReveal | null;
  onReady: () => void;
  onSee: () => void;
  onCall: () => void;
  onRaise: (amount: number) => void;
  onFold: () => void;
  onCompare: (targetSeat: number) => void;
  onCopyRoomCode: () => void;
  onLeave: () => void;
  onInfo: (message: string) => void;
}

export function ZhaJinHuaTable({
  room,
  connected,
  notice,
  compareReveal,
  onReady,
  onSee,
  onCall,
  onRaise,
  onFold,
  onCompare,
  onCopyRoomCode,
  onLeave,
  onInfo
}: ZhaJinHuaTableProps) {
  const self = room.players.find((player) => player.seat === room.selfSeat);
  const opponents = room.players.filter((player) => player.seat !== room.selfSeat);
  const activeOpponents = opponents.filter((player) => player.connected && !player.folded && room.phase === "playing");
  const isMyTurn = room.phase === "playing" && room.currentTurn === room.selfSeat;
  const selfCards = self?.hand ?? [];
  const [showDealAnimation, setShowDealAnimation] = useState(false);
  const previousPhaseRef = useRef(room.phase);

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = room.phase;

    if (previousPhase !== "playing" && room.phase === "playing") {
      setShowDealAnimation(true);
      const timer = window.setTimeout(() => setShowDealAnimation(false), 1800);
      return () => window.clearTimeout(timer);
    }

    return undefined;
  }, [room.phase, room.roomCode]);

  return (
    <>
      <header className="zjh-header">
        <div className="zjh-header-left">
          <strong className="zjh-brand">炸金花好友房</strong>
          <span className="zjh-pill room">
            房间 <b>{room.roomCode}</b>
            <button type="button" onClick={onCopyRoomCode} aria-label="复制房间号">
              <Clipboard size={15} aria-hidden="true" />
            </button>
          </span>
          <span className="zjh-pill">阶段 {phaseLabel(room.phase)}</span>
          <span className="zjh-pill">底池 {room.pot}</span>
          <span className="zjh-pill">当前注 {room.currentBet}</span>
          <span className="zjh-pill">轮次 {room.round || 0}/{room.maxRounds}</span>
        </div>

        <div className="zjh-header-actions">
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

      <main className="zjh-main">
        <section className="zjh-table" aria-label="炸金花牌桌">
          <div className="zjh-casino-marquee" aria-hidden="true">
            <span>炸金花好友房</span>
          </div>
          <div className="zjh-dealer-zone" aria-hidden="true">
            <div className="zjh-dealer-glow" />
            <div className="zjh-dealer-figure">
              <span className="zjh-dealer-head" />
              <span className="zjh-dealer-body" />
              <span className="zjh-dealer-arm left" />
              <span className="zjh-dealer-arm right" />
            </div>
            <div className="zjh-card-shoe" />
          </div>
          {showDealAnimation && <ZjhDealAnimation players={room.players} selfSeat={room.selfSeat} />}
          <div className="zjh-opponents">
            {opponents.map((player) => (
              <ZjhSeat
                key={player.seat}
                player={player}
                active={room.currentTurn === player.seat}
                self={false}
                banker={room.bankerSeat === player.seat}
              />
            ))}
            {Array.from({ length: room.maxPlayers - room.players.length }).map((_, index) => (
              <div className="zjh-empty-seat" key={index}>
                等待入座
              </div>
            ))}
          </div>

          <section className="zjh-center">
            <div className="zjh-pot">
              <span>底池</span>
              <strong>{room.pot}</strong>
              <small>基础底注 {room.baseAnte}</small>
            </div>
            <div className="zjh-message">
              <Sparkles size={18} aria-hidden="true" />
              {room.message ?? "等待玩家操作"}
            </div>
            <ZjhActionBar
              room={room}
              self={self}
              isMyTurn={isMyTurn}
              compareTargets={activeOpponents}
              onReady={onReady}
              onSee={onSee}
              onCall={onCall}
              onRaise={onRaise}
              onFold={onFold}
              onCompare={onCompare}
            />
          </section>

          <section className="zjh-self-zone" aria-label="我的牌">
            {self && <ZjhSeat player={self} active={room.currentTurn === self.seat} self banker={room.bankerSeat === self.seat} />}
            <div className="zjh-hand">
              {room.phase === "lobby" || !self ? (
                <span className="zjh-hand-placeholder">准备后发牌</span>
              ) : selfCards.length > 0 ? (
                selfCards.map((card) => <ZjhCard key={card.id} card={card} />)
              ) : (
                Array.from({ length: self.cardCount || 3 }).map((_, index) => <ZjhCardBack key={index} />)
              )}
            </div>
          </section>
        </section>
      </main>

      {room.phase === "ended" && <ZjhResultDialog room={room} notice={notice} onReady={onReady} />}
      {compareReveal && <ZjhCompareRevealPanel reveal={compareReveal} />}
    </>
  );
}

function ZjhActionBar({
  room,
  self,
  isMyTurn,
  compareTargets,
  onReady,
  onSee,
  onCall,
  onRaise,
  onFold,
  onCompare
}: {
  room: ZjhRoomView;
  self?: ZjhPlayerView;
  isMyTurn: boolean;
  compareTargets: ZjhPlayerView[];
  onReady: () => void;
  onSee: () => void;
  onCall: () => void;
  onRaise: (amount: number) => void;
  onFold: () => void;
  onCompare: (targetSeat: number) => void;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="zjh-actions">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
        <span>{room.playerCount >= 2 ? "全员准备后开始" : "至少 2 人开局"}</span>
      </div>
    );
  }

  if (room.phase === "ended") {
    return (
      <div className="zjh-actions">
        <button className="primary-btn" type="button" onClick={onReady}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </div>
    );
  }

  if (!isMyTurn) {
    return <div className="zjh-waiting">等待对手操作</div>;
  }

  const raiseLevels = self?.seen ? ZJH_SEEN_BETS : ZJH_BLIND_BETS;
  const canCompare = room.round > 1 && (Boolean(self?.seen) || compareTargets.length <= 1);

  return (
    <div className="zjh-actions">
      <button type="button" onClick={onSee} disabled={self?.seen}>
        <Eye size={18} aria-hidden="true" />
        {self?.seen ? "已看牌" : "看牌"}
      </button>
      <button className="primary-btn" type="button" onClick={onCall}>
        <Shield size={18} aria-hidden="true" />
        跟注
      </button>
      <button type="button" onClick={onFold}>
        <CircleSlash size={18} aria-hidden="true" />
        弃牌
      </button>
      <div className="zjh-raise-group" aria-label="加注">
        {raiseLevels.map((amount) => {
          const tier = getZjhBetTier(amount, Boolean(self?.seen));
          return (
            <button
              type="button"
              key={amount}
              onClick={() => onRaise(amount)}
              disabled={tier === undefined || tier <= room.currentBet || tier > room.maxBet}
            >
              下注 {amount}
            </button>
          );
        })}
      </div>
      {canCompare ? (
        <div className="zjh-compare-group" aria-label="比牌">
          {compareTargets.map((target) => (
            <button type="button" key={target.seat} onClick={() => onCompare(target.seat)}>
              <Swords size={17} aria-hidden="true" />
              比 {target.nickname}
            </button>
          ))}
        </div>
      ) : (
        <span className="zjh-action-hint">{room.round <= 1 ? "第一轮后可比牌" : "未看牌只剩两人时可比牌"}</span>
      )}
    </div>
  );
}

function ZjhSeat({ player, active, self, banker }: { player: ZjhPlayerView; active: boolean; self: boolean; banker: boolean }) {
  return (
    <article className={`zjh-seat ${active ? "active" : ""} ${player.folded ? "folded" : ""} ${self ? "self" : ""}`}>
      <div className="zjh-seat-head">
        <strong>{self ? "你" : `座位 ${player.seat + 1}`}</strong>
        {banker && (
          <span>
            <Crown size={14} aria-hidden="true" />
            先手
          </span>
        )}
      </div>
      <h3>{player.nickname}</h3>
      <p>
        {player.cardCount || 0} 张 · {player.connected ? "在线" : "离线"} · {player.seen ? "已看" : "未看"}
      </p>
      <p>积分 {player.score} · 已下 {player.invested}</p>
      {player.lastAction && <em>{player.lastAction}</em>}
      {player.hand && (
        <div className="zjh-seat-cards" aria-label={`${player.nickname} 的明牌`}>
          {player.hand.map((card) => (
            <ZjhCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </article>
  );
}

type DealCardStyle = CSSProperties & {
  "--deal-index": string;
  "--deal-x": string;
  "--deal-y": string;
};

function ZjhDealAnimation({ players, selfSeat }: { players: ZjhPlayerView[]; selfSeat?: number }) {
  return (
    <div className="zjh-deal-layer" aria-hidden="true">
      {players.flatMap((player, playerIndex) =>
        Array.from({ length: 3 }).map((_, cardIndex) => {
          const style = getDealCardStyle(player, playerIndex, cardIndex, selfSeat);
          return <span className="zjh-deal-card" style={style} key={`${player.seat}-${cardIndex}`} />;
        })
      )}
    </div>
  );
}

function getDealCardStyle(player: ZjhPlayerView, playerIndex: number, cardIndex: number, selfSeat?: number): DealCardStyle {
  if (selfSeat !== undefined && player.seat === selfSeat) {
    return {
      "--deal-index": String(playerIndex * 3 + cardIndex),
      "--deal-x": `${(cardIndex - 1) * 58}px`,
      "--deal-y": "min(58vh, 560px)"
    };
  }

  const opponentTargets = [
    { x: "-250px", y: "170px" },
    { x: "250px", y: "170px" },
    { x: "-280px", y: "340px" },
    { x: "280px", y: "340px" },
    { x: "-120px", y: "300px" },
    { x: "120px", y: "300px" }
  ];
  const target = opponentTargets[playerIndex % opponentTargets.length];

  return {
    "--deal-index": String(playerIndex * 3 + cardIndex),
    "--deal-x": `calc(${target.x} + ${(cardIndex - 1) * 22}px)`,
    "--deal-y": target.y
  };
}

function ZjhCard({ card }: { card: Card }) {
  return (
    <div className={`playing-card zjh-card ${card.color}`}>
      <img src={getZjhCardImageSrc(card)} alt={`${card.label}${card.suitSymbol}`} draggable={false} loading="lazy" />
    </div>
  );
}

function ZjhCardBack() {
  return (
    <div className="card-back zjh-card-back" aria-hidden="true">
      <img src={ZJH_CARD_BACK_SRC} alt="" draggable={false} loading="lazy" />
    </div>
  );
}

function getZjhCardImageSrc(card: Card) {
  if (card.suit === "joker") {
    return card.color === "red"
      ? `${ZJH_ASSET_BASE}/cards/card_joker_red.png`
      : `${ZJH_ASSET_BASE}/cards/card_joker_black.png`;
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

  return `${ZJH_ASSET_BASE}/cards/card_${suitName[card.suit]}_${rankName[card.rank]}.png`;
}

function ZjhResultDialog({ room, notice, onReady }: { room: ZjhRoomView; notice: string; onReady: () => void }) {
  const result = room.result;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="zjh-result-title">
      <section className="result-dialog zjh-result-dialog">
        <h2 id="zjh-result-title">{notice || room.message || "本局结束"}</h2>
        {result && <p>底池 {result.pot} 分</p>}
        <div className="zjh-result-hands">
          {result?.hands.map((hand) => (
            <div className="zjh-result-row" key={hand.seat}>
              <div>
                <strong>{hand.nickname}</strong>
                <span>{hand.folded ? "弃牌" : hand.handLabel}</span>
              </div>
              <div className="mini-card-row">
                {hand.cards.map((card) => (
                  <ZjhCard key={card.id} card={card} />
                ))}
              </div>
              <b className={(result.scores[hand.seat] ?? 0) >= 0 ? "score plus" : "score minus"}>
                {(result.scores[hand.seat] ?? 0) >= 0 ? "+" : ""}
                {result.scores[hand.seat] ?? 0}
              </b>
            </div>
          ))}
        </div>
        <button className="primary-btn" type="button" onClick={onReady}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </section>
    </div>
  );
}

function ZjhCompareRevealPanel({ reveal }: { reveal: ZjhCompareReveal }) {
  return (
    <section className="zjh-compare-reveal" aria-live="polite" aria-label="比牌亮牌">
      <div>
        <span>比牌查看</span>
        <strong>{reveal.targetNickname}</strong>
        <small>{reveal.handLabel} · 稍后自动隐藏</small>
      </div>
      <div className="zjh-compare-reveal-cards">
        {reveal.cards.map((card) => (
          <ZjhCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}

function phaseLabel(phase: ZjhRoomView["phase"]) {
  if (phase === "lobby") {
    return "准备中";
  }
  if (phase === "playing") {
    return "下注中";
  }
  return "已结算";
}
