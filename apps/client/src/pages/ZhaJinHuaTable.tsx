import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bell,
  ChevronDown,
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
  Swords,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { getZjhBetTier, ZJH_BLIND_BETS, ZJH_SEEN_BETS } from "@doudizhu/shared";
import type { Card, ZjhCompareReveal, ZjhPlayerView, ZjhRoomView } from "@doudizhu/shared";

const ZJH_ASSET_BASE = "/assets/zhajinhua";
const ZJH_CARD_BACK_SRC = `${ZJH_ASSET_BASE}/card_back/red_back_line.png`;
const ZJH_CHIP_SRC = "/assets/chips/chips_stacked_green.png";
const ZJH_POT_CHIP_SRCS = [
  ZJH_CHIP_SRC,
  "/assets/chips/chips_stacked_red.png",
  "/assets/chips/chips_stacked_blue.png"
];
const ZJH_TURN_RING_SRC = "/assets/flash/0baa0bf0-d89d-419e-be7a-1bca8cc44b53.362fd_1.png";
const ZJH_MUSIC_SRC = "/assets/audio/zhajinhua.mp3";
const ZJH_HEAD_ASSETS = [
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
  const tableSeatCount = Math.min(Math.max(room.maxPlayers, room.players.length, 2), 12);
  const tableSeatSlots = buildZjhSeatSlots(room.players, tableSeatCount, room.selfSeat);
  const opponents = room.players.filter((player) => player.seat !== room.selfSeat);
  const activeOpponents = opponents.filter((player) => player.connected && !player.folded && room.phase === "playing");
  const isMyTurn = room.phase === "playing" && room.currentTurn === room.selfSeat;
  const canCompare =
    isMyTurn && activeOpponents.length > 0 && room.round > 1 && (Boolean(self?.seen) || activeOpponents.length <= 1);
  const compareTargetSeats = new Set(activeOpponents.map((player) => player.seat));
  const [selectingCompareTarget, setSelectingCompareTarget] = useState(false);
  const [showDealAnimation, setShowDealAnimation] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
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

  useEffect(() => {
    if (!canCompare) {
      setSelectingCompareTarget(false);
    }
  }, [canCompare, room.currentTurn, room.phase, room.roomCode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return undefined;
    }

    audio.volume = musicVolume;
    audio.loop = true;

    if (!musicEnabled) {
      audio.pause();
      return undefined;
    }

    const playMusic = () => {
      audio.play().catch(() => undefined);
    };

    playMusic();
    window.addEventListener("pointerdown", playMusic, { passive: true });
    window.addEventListener("keydown", playMusic);

    return () => {
      window.removeEventListener("pointerdown", playMusic);
      window.removeEventListener("keydown", playMusic);
    };
  }, [musicEnabled, musicVolume]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function compareWithSeat(seat: number) {
    if (!selectingCompareTarget || !compareTargetSeats.has(seat)) {
      return;
    }

    setSelectingCompareTarget(false);
    onCompare(seat);
  }

  function toggleMusic() {
    setMusicEnabled((enabled) => {
      const nextEnabled = !enabled;
      const audio = audioRef.current;
      if (nextEnabled) {
        audio?.play().catch(() => undefined);
      } else {
        audio?.pause();
      }
      return nextEnabled;
    });
  }

  return (
    <>
      <audio ref={audioRef} src={ZJH_MUSIC_SRC} preload="auto" loop />
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
          <button className="zen-icon-button" type="button" onClick={() => setSettingsOpen(true)} aria-label="设置">
            <Settings size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={() => onInfo("帮助中心将在正式版开放。")} aria-label="帮助">
            <HelpCircle size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={toggleMusic} aria-label={musicEnabled ? "关闭背景音乐" : "开启背景音乐"}>
            {musicEnabled ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
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
          <div className="zjh-seat-ring" aria-label="玩家座位">
            {tableSeatSlots.map(({ seat, player }, index) =>
              player ? (
                <ZjhSeat
                  key={player.seat}
                  player={player}
                  active={room.currentTurn === player.seat}
                  self={player.seat === room.selfSeat}
                  banker={room.bankerSeat === player.seat}
                  phase={room.phase}
                  compareSelectable={selectingCompareTarget && compareTargetSeats.has(player.seat)}
                  onCompareTarget={() => compareWithSeat(player.seat)}
                  style={getZjhSeatOrbitStyle(index, tableSeatCount)}
                />
              ) : (
                <ZjhEmptySeat key={`empty-${seat}`} seat={seat} style={getZjhSeatOrbitStyle(index, tableSeatCount)} />
              )
            )}
          </div>

          <section className="zjh-center">
            <div className="zjh-pot" aria-label={`底池 ${room.pot}`}>
              <span className="zjh-pot-stack" aria-hidden="true">
                {ZJH_POT_CHIP_SRCS.map((src, index) => (
                  <img key={src} className={`zjh-pot-chip chip-${index + 1}`} src={src} alt="" draggable={false} />
                ))}
              </span>
              <strong>{room.pot}</strong>
            </div>
            {room.phase !== "lobby" && (
              <div className="zjh-message">
                <Sparkles size={18} aria-hidden="true" />
                {room.message ?? "等待玩家操作"}
              </div>
            )}
            <ZjhActionBar
              room={room}
              self={self}
              isMyTurn={isMyTurn}
              compareTargets={activeOpponents}
              canCompare={canCompare}
              selectingCompareTarget={selectingCompareTarget}
              onReady={onReady}
              onSee={onSee}
              onCall={onCall}
              onRaise={onRaise}
              onFold={onFold}
              onRequestCompare={() => setSelectingCompareTarget((current) => !current)}
              onCancelCompare={() => setSelectingCompareTarget(false)}
            />
          </section>
        </section>
      </main>

      {settingsOpen && (
        <ZjhSettingsDialog
          musicEnabled={musicEnabled}
          musicVolume={musicVolume}
          onMusicEnabledChange={setMusicEnabled}
          onMusicVolumeChange={setMusicVolume}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {room.phase === "ended" && <ZjhResultDialog room={room} notice={notice} onReady={onReady} />}
    </>
  );
}

function ZjhSettingsDialog({
  musicEnabled,
  musicVolume,
  onMusicEnabledChange,
  onMusicVolumeChange,
  onClose
}: {
  musicEnabled: boolean;
  musicVolume: number;
  onMusicEnabledChange: (enabled: boolean) => void;
  onMusicVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  const volumePercent = Math.round(musicVolume * 100);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="zjh-settings-title">
      <section className="zjh-settings-dialog">
        <div className="zjh-settings-header">
          <h2 id="zjh-settings-title">设置</h2>
          <button className="zjh-settings-close" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="zjh-setting-row">
          <div>
            <strong>背景音乐</strong>
            <span>{musicEnabled ? "已开启" : "已关闭"}</span>
          </div>
          <button
            className={`zjh-toggle-button ${musicEnabled ? "is-stop" : "is-start"}`}
            type="button"
            onClick={() => onMusicEnabledChange(!musicEnabled)}
            aria-pressed={musicEnabled}
          >
            {musicEnabled ? "关闭" : "开启"}
          </button>
        </div>

        <label className="zjh-volume-control">
          <span>音量 {volumePercent}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={volumePercent}
            disabled={!musicEnabled}
            onChange={(event) => onMusicVolumeChange(Number(event.target.value) / 100)}
          />
        </label>
      </section>
    </div>
  );
}

function ZjhActionBar({
  room,
  self,
  isMyTurn,
  compareTargets,
  canCompare,
  selectingCompareTarget,
  onReady,
  onSee,
  onCall,
  onRaise,
  onFold,
  onRequestCompare,
  onCancelCompare
}: {
  room: ZjhRoomView;
  self?: ZjhPlayerView;
  isMyTurn: boolean;
  compareTargets: ZjhPlayerView[];
  canCompare: boolean;
  selectingCompareTarget: boolean;
  onReady: () => void;
  onSee: () => void;
  onCall: () => void;
  onRaise: (amount: number) => void;
  onFold: () => void;
  onRequestCompare: () => void;
  onCancelCompare: () => void;
}) {
  const [raiseMenuOpen, setRaiseMenuOpen] = useState(false);

  if (room.phase === "lobby") {
    return (
      <div className="zjh-actions zjh-ready-actions">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
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
    return (
      <div className="zjh-actions zjh-play-actions zjh-see-actions">
        <button
          type="button"
          onClick={() => {
            onCancelCompare();
            onSee();
          }}
          disabled={self?.seen || self?.folded}
        >
          <Eye size={18} aria-hidden="true" />
          {self?.seen ? "已看牌" : "看牌"}
        </button>
      </div>
    );
  }

  const raiseLevels = self?.seen ? ZJH_SEEN_BETS : ZJH_BLIND_BETS;
  const raiseOptions = raiseLevels.map((amount) => {
    const tier = getZjhBetTier(amount, Boolean(self?.seen));
    return {
      amount,
      disabled: tier === undefined || tier <= room.currentBet || tier > room.maxBet
    };
  });
  const canRaise = raiseOptions.some((option) => !option.disabled);

  return (
    <div className="zjh-actions zjh-play-actions">
      <button
        type="button"
        onClick={() => {
          onCancelCompare();
          onSee();
        }}
        disabled={self?.seen || self?.folded}
      >
        <Eye size={18} aria-hidden="true" />
        {self?.seen ? "已看牌" : "看牌"}
      </button>
      <button
        className="primary-btn"
        type="button"
        onClick={() => {
          onCancelCompare();
          onCall();
        }}
      >
        <Shield size={18} aria-hidden="true" />
        跟注
      </button>
      <button
        type="button"
        onClick={() => {
          onCancelCompare();
          onFold();
        }}
      >
        <CircleSlash size={18} aria-hidden="true" />
        弃牌
      </button>
      <div className="zjh-raise-group" aria-label="加注">
        <button
          type="button"
          onClick={() => {
            onCancelCompare();
            setRaiseMenuOpen((current) => !current);
          }}
          disabled={!canRaise}
          aria-expanded={raiseMenuOpen}
          aria-haspopup="menu"
        >
          加注
          <ChevronDown size={17} aria-hidden="true" />
        </button>
        {raiseMenuOpen && (
          <div className="zjh-raise-menu" role="menu" aria-label="选择加注">
            {raiseOptions.map(({ amount, disabled }) => (
              <button
                type="button"
                key={amount}
                onClick={() => {
                  setRaiseMenuOpen(false);
                  onRaise(amount);
                }}
                disabled={disabled}
                role="menuitem"
              >
                加注 {amount}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className={selectingCompareTarget ? "is-active" : ""}
        onClick={() => {
          setRaiseMenuOpen(false);
          onRequestCompare();
        }}
        disabled={!canCompare || compareTargets.length === 0}
        aria-pressed={selectingCompareTarget}
      >
        <Swords size={17} aria-hidden="true" />
        比牌
      </button>
    </div>
  );
}

interface ZjhOrbitStyle extends CSSProperties {
  "--seat-left": string;
  "--seat-top": string;
}

function buildZjhSeatSlots(players: ZjhPlayerView[], seatCount: number, selfSeat?: number) {
  const playersBySeat = new Map(players.map((player) => [player.seat, player]));
  const startSeat = selfSeat ?? 0;

  return Array.from({ length: seatCount }, (_, index) => {
    const seat = (startSeat + index) % seatCount;
    return { seat, player: playersBySeat.get(seat) };
  });
}

function getZjhSeatOrbitStyle(index: number, total: number): ZjhOrbitStyle {
  const angle = (90 + (index * 360) / total) * (Math.PI / 180);
  const x = Math.cos(angle) * 50;
  const y = Math.sin(angle) * 35;

  return {
    "--seat-left": `${x.toFixed(3)}%`,
    "--seat-top": `${y.toFixed(3)}%`
  };
}

function getZjhAvatarSrc(seat: number) {
  return ZJH_HEAD_ASSETS[((seat % ZJH_HEAD_ASSETS.length) + ZJH_HEAD_ASSETS.length) % ZJH_HEAD_ASSETS.length];
}

function ZjhSeat({
  player,
  active,
  self,
  banker,
  phase,
  compareSelectable,
  onCompareTarget,
  style
}: {
  player: ZjhPlayerView;
  active: boolean;
  self: boolean;
  banker: boolean;
  phase: ZjhRoomView["phase"];
  compareSelectable: boolean;
  onCompareTarget: () => void;
  style: ZjhOrbitStyle;
}) {
  const showReady = phase === "lobby";
  const showSeen = phase !== "lobby";
  const seatLeft = Number.parseFloat(style["--seat-left"]);
  const seatTop = Number.parseFloat(style["--seat-top"]);
  const scoreSide = seatLeft > 0 ? "left" : "right";
  const cardSide = self
    ? "self"
    : seatTop < -24
      ? "top-table"
      : seatLeft < -4
        ? "left-table"
        : seatLeft > 4
          ? "right-table"
          : "center-table";
  const seenLabel = player.folded ? "已弃牌" : player.seen ? "已看牌" : "未看牌";
  const visibleCards = player.hand ?? [];
  const cardBackCount = Math.min(player.cardCount || 3, 3);
  const showTurnRing = active && phase === "playing";

  return (
    <article
      className={`zjh-seat ${active ? "active" : ""} ${player.folded ? "folded" : ""} ${self ? "self" : ""} ${
        compareSelectable ? "compare-target" : ""
      }`}
      style={style}
    >
      {showSeen && (
        <div className={`zjh-seat-cards ${cardSide}`} aria-label={`${self ? "我的" : player.nickname}牌`}>
          {visibleCards.length > 0
            ? visibleCards.map((card) => <ZjhCard key={card.id} card={card} />)
            : Array.from({ length: cardBackCount }).map((_, index) => <ZjhCardBack key={index} />)}
        </div>
      )}
      <button
        className={`zjh-avatar-frame ${compareSelectable ? "compare-selectable" : ""}`}
        type="button"
        disabled={!compareSelectable}
        onClick={onCompareTarget}
        aria-label={compareSelectable ? `与${player.nickname}比牌` : `${player.nickname}头像`}
      >
        <img className="zjh-avatar-img" src={getZjhAvatarSrc(player.seat)} alt={`${player.nickname}头像`} draggable={false} />
        {showTurnRing && <img className="zjh-turn-ring" src={ZJH_TURN_RING_SRC} alt="" draggable={false} aria-hidden="true" />}
        <span className="zjh-avatar-name">{self ? "你" : player.nickname}</span>
        {banker && (
          <span className="zjh-seat-badge">
            <Crown size={12} aria-hidden="true" />
            先手
          </span>
        )}
      </button>
      <div className={`zjh-score-chip ${scoreSide}`} aria-label={`积分 ${player.score}`}>
        <img src={ZJH_CHIP_SRC} alt="" draggable={false} />
        <span>{player.score}</span>
      </div>
      <div className="zjh-seat-meta">
        {showSeen && <span>{seenLabel}</span>}
        {showSeen && <span>已下注 {player.invested}</span>}
        {showReady && <span>{player.ready ? "已准备" : "未准备"}</span>}
      </div>
    </article>
  );
}

function ZjhEmptySeat({ seat, style }: { seat: number; style: ZjhOrbitStyle }) {
  return (
    <div className="zjh-empty-seat" style={style}>
      <div className="zjh-avatar-frame empty">
        <span>{seat + 1}</span>
      </div>
      <div className="zjh-seat-meta">
        <span>等待入座</span>
      </div>
    </div>
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

function ZjhResultDialog({ room, onReady }: { room: ZjhRoomView; notice: string; onReady: () => void }) {
  const result = room.result;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="zjh-result-title">
      <section className="result-dialog zjh-result-dialog">
        <h2 id="zjh-result-title">本局结算</h2>
        {result && <p>底池 {result.pot} 分</p>}
        <div className="zjh-result-hands">
          {result?.hands.map((hand) => (
            <div className="zjh-result-row" key={hand.seat}>
              <div>
                <strong>{hand.nickname}</strong>
              </div>
              <div className="zjh-result-card-group">
                <span className="zjh-result-hand-type">{hand.folded ? "弃牌" : hand.handLabel}</span>
                <div className="mini-card-row">
                  {hand.cards.map((card) => (
                    <ZjhCard key={card.id} card={card} />
                  ))}
                </div>
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

function phaseLabel(phase: ZjhRoomView["phase"]) {
  if (phase === "lobby") {
    return "准备中";
  }
  if (phase === "playing") {
    return "下注中";
  }
  return "已结算";
}
