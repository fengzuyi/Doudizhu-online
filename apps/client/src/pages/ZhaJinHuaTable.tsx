import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  Bell,
  ChevronDown,
  CircleSlash,
  Clipboard,
  Crown,
  Eye,
  HelpCircle,
  LogOut,
  Maximize2,
  Minimize2,
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
const ZJH_EFFECT_BASE = "/assets/audio/zhajinhua/effects";
const ZJH_EMPTY_LOG_KEY = "__empty_zjh_turn_log__";
const ZJH_ACTION_SOUND_DEDUPE_MS = 3000;
const ZJH_ACTION_SOUND_STORAGE_PREFIX = "zjh:action-sound:";
const zjhEffectSrc = (fileName: string) => `${ZJH_EFFECT_BASE}/${fileName}`;
const ZJH_SOUND_EFFECTS = {
  dealSequence: zjhEffectSrc("deal_sequence.mp3"),
  callChips: zjhEffectSrc("chips.mp3"),
  raiseChips: zjhEffectSrc("bet_chips.mp3"),
  compareCue: zjhEffectSrc("compare_cue.mp3"),
  settlement: zjhEffectSrc("settlement_bell.mp3"),
  seeVoice: zjhEffectSrc("see_cards_female.mp3"),
  callVoice: zjhEffectSrc("call_i_call_female.mp3"),
  raiseVoice: zjhEffectSrc("raise_female.mp3"),
  foldVoice: zjhEffectSrc("fold_no_call_female.mp3"),
  compareVoice: zjhEffectSrc("compare_female.mp3")
} as const;

type ZjhAudioGlobal = typeof globalThis & {
  __zjhPlayedActionSoundKeys?: Map<string, number>;
  __zjhVoiceAudio?: HTMLAudioElement;
};

function getZjhAudioGlobal() {
  return globalThis as ZjhAudioGlobal;
}

function getZjhPlayedActionSoundKeys() {
  const audioGlobal = getZjhAudioGlobal();
  audioGlobal.__zjhPlayedActionSoundKeys ??= new Map<string, number>();
  return audioGlobal.__zjhPlayedActionSoundKeys;
}

function getZjhVoiceAudio() {
  const audioGlobal = getZjhAudioGlobal();
  audioGlobal.__zjhVoiceAudio ??= new Audio();
  return audioGlobal.__zjhVoiceAudio;
}

function stopZjhActiveVoiceAudio() {
  const voiceAudio = getZjhAudioGlobal().__zjhVoiceAudio;
  if (!voiceAudio) {
    return;
  }

  voiceAudio.pause();
  voiceAudio.currentTime = 0;
}

function playZjhVoiceSound(src: string | undefined, volume: number) {
  if (!src) {
    return;
  }

  const voiceAudio = getZjhVoiceAudio();
  voiceAudio.pause();
  voiceAudio.currentTime = 0;
  voiceAudio.src = src;
  voiceAudio.volume = volume;
  voiceAudio.play().catch(() => undefined);
}

function shouldPlayZjhActionSound(roomCode: string, actionKey: string) {
  const now = Date.now();
  const scopedKey = `${roomCode}:${actionKey}`;
  const playedActionSoundKeys = getZjhPlayedActionSoundKeys();

  for (const [key, playedAt] of playedActionSoundKeys) {
    if (now - playedAt > ZJH_ACTION_SOUND_DEDUPE_MS) {
      playedActionSoundKeys.delete(key);
    }
  }

  if (playedActionSoundKeys.has(scopedKey)) {
    return false;
  }

  if (!claimZjhActionSoundStorageLock(scopedKey, now)) {
    playedActionSoundKeys.set(scopedKey, now);
    return false;
  }

  playedActionSoundKeys.set(scopedKey, now);
  return true;
}

function claimZjhActionSoundStorageLock(scopedKey: string, now: number) {
  try {
    const storage = globalThis.localStorage;
    const storageKey = `${ZJH_ACTION_SOUND_STORAGE_PREFIX}${scopedKey}`;
    const previousPlayedAt = Number(storage.getItem(storageKey));

    if (Number.isFinite(previousPlayedAt) && now - previousPlayedAt < ZJH_ACTION_SOUND_DEDUPE_MS) {
      return false;
    }

    storage.setItem(storageKey, String(now));
    return true;
  } catch {
    return true;
  }
}
const ZJH_BRAND_SRC = "/assets/pictures/zhajinghua.png";
const ZJH_BRAND_ROSE_SRC = "/assets/pictures/meigui.png";
const ZJH_WIN_SHENG_SRC = "/assets/pictures/sheng.png";
const ZJH_WIN_LI_LEFT_SRC = "/assets/pictures/li1.png";
const ZJH_WIN_LI_RIGHT_SRC = "/assets/pictures/li2.png";
const ZJH_LEFT_PROMOS = [
  { src: "/assets/pictures/svip.avif", label: "SVIP" },
  { src: "/assets/pictures/manghechoujiang.avif", label: "盲盒抽奖" },
  { src: "/assets/pictures/shishifanshui.avif", label: "实时返水" }
];
const ZJH_RIGHT_PROMOS = [
  { src: "/assets/pictures/vip.avif", label: "VIP" },
  { src: "/assets/pictures/xinrenfuli.avif", label: "新人福利" },
  { src: "/assets/pictures/dailingqu.avif", label: "待领取" }
];
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
  voiceDock?: ReactNode;
}

export function ZhaJinHuaTable({
  room,
  connected,
  onReady,
  onSee,
  onCall,
  onRaise,
  onFold,
  onCompare,
  onCopyRoomCode,
  onLeave,
  onInfo,
  voiceDock
}: ZhaJinHuaTableProps) {
  const self = room.players.find((player) => player.seat === room.selfSeat);
  const tableSeatCount = Math.min(Math.max(room.maxPlayers, room.players.length, 2), 12);
  const tableSeatSlots = buildZjhSeatSlots(room.players, tableSeatCount, room.selfSeat);
  const opponents = room.players.filter((player) => player.seat !== room.selfSeat);
  const activeOpponents = opponents.filter((player) => player.connected && !player.folded && room.phase === "playing");
  const isMyTurn = room.phase === "playing" && room.currentTurn === room.selfSeat;
  const winnerSeat = room.phase === "ended" ? room.result?.winnerSeat : undefined;
  const tableMessage = formatZjhTableMessage(room.message);
  const canCompare =
    isMyTurn && activeOpponents.length > 0 && room.round > 1 && (Boolean(self?.seen) || activeOpponents.length <= 1);
  const compareTargetSeats = new Set(activeOpponents.map((player) => player.seat));
  const [selectingCompareTarget, setSelectingCompareTarget] = useState(false);
  const [showDealAnimation, setShowDealAnimation] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.35);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.75);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousPhaseRef = useRef(room.phase);
  const soundRoomCodeRef = useRef(room.roomCode);
  const lastSoundTurnLogKeyRef = useRef(getZjhLogKey(room.turnLog.at(-1)) ?? ZJH_EMPTY_LOG_KEY);

  function playZjhEffectSound(src?: string) {
    if (!soundEnabled || !src) {
      return;
    }

    const audio = new Audio(src);
    audio.volume = soundVolume;
    audio.play().catch(() => undefined);
  }

  function playZjhActionVoice(src: string) {
    if (!soundEnabled) {
      return;
    }

    playZjhVoiceSound(src, soundVolume);
  }

  function playZjhActionSounds(action: ZjhRoomView["turnLog"][number]) {
    if (action.action === "see") {
      playZjhActionVoice(ZJH_SOUND_EFFECTS.seeVoice);
      return;
    }

    if (action.action === "call") {
      playZjhEffectSound(ZJH_SOUND_EFFECTS.callChips);
      playZjhActionVoice(ZJH_SOUND_EFFECTS.callVoice);
      return;
    }

    if (action.action === "raise") {
      playZjhEffectSound(ZJH_SOUND_EFFECTS.raiseChips);
      playZjhActionVoice(ZJH_SOUND_EFFECTS.raiseVoice);
      return;
    }

    if (action.action === "fold") {
      playZjhActionVoice(ZJH_SOUND_EFFECTS.foldVoice);
      return;
    }

    if (action.action === "compare") {
      playZjhEffectSound(ZJH_SOUND_EFFECTS.compareCue);
      playZjhActionVoice(ZJH_SOUND_EFFECTS.compareVoice);
    }
  }

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = room.phase;

    if (previousPhase !== "playing" && room.phase === "playing") {
      setShowDealAnimation(true);
      playZjhEffectSound(ZJH_SOUND_EFFECTS.dealSequence);
      const timer = window.setTimeout(() => setShowDealAnimation(false), 1800);
      return () => window.clearTimeout(timer);
    }

    if (previousPhase !== "ended" && room.phase === "ended" && room.result) {
      playZjhEffectSound(ZJH_SOUND_EFFECTS.settlement);
    }

    return undefined;
  }, [room.phase, room.roomCode, room.result, soundEnabled, soundVolume]);

  useEffect(() => {
    const latestAction = room.turnLog.at(-1);
    const latestKey = getZjhLogKey(latestAction) ?? ZJH_EMPTY_LOG_KEY;

    if (soundRoomCodeRef.current !== room.roomCode) {
      soundRoomCodeRef.current = room.roomCode;
      lastSoundTurnLogKeyRef.current = latestKey;
      return;
    }

    const previousKey = lastSoundTurnLogKeyRef.current;
    if (latestKey === previousKey) {
      return;
    }

    if (latestKey === ZJH_EMPTY_LOG_KEY) {
      lastSoundTurnLogKeyRef.current = latestKey;
      return;
    }

    if (previousKey === ZJH_EMPTY_LOG_KEY) {
      if (latestAction && shouldPlayZjhActionSound(room.roomCode, latestKey)) {
        playZjhActionSounds(latestAction);
      }
      lastSoundTurnLogKeyRef.current = latestKey;
      return;
    }

    const previousIndex = room.turnLog.findIndex((action) => getZjhLogKey(action) === previousKey);
    if (previousIndex === -1) {
      lastSoundTurnLogKeyRef.current = latestKey;
      return;
    }

    const newActions = room.turnLog.slice(previousIndex + 1);
    const latestNewAction = newActions.at(-1);
    if (latestNewAction && shouldPlayZjhActionSound(room.roomCode, latestKey)) {
      playZjhActionSounds(latestNewAction);
    }
    lastSoundTurnLogKeyRef.current = latestKey;
  }, [room.roomCode, room.turnLog, soundEnabled, soundVolume]);

  useEffect(() => {
    return () => {
      stopZjhActiveVoiceAudio();
    };
  }, []);

  useEffect(() => {
    if (!soundEnabled) {
      stopZjhActiveVoiceAudio();
    }
  }, [soundEnabled]);

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

  useEffect(() => {
    const syncFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
    };
  }, []);

  function compareWithSeat(seat: number) {
    if (!selectingCompareTarget || !compareTargetSeats.has(seat)) {
      return;
    }

    setSelectingCompareTarget(false);
    onCompare(seat);
  }

  function requestCompare() {
    if (!canCompare || activeOpponents.length === 0) {
      return;
    }

    if (activeOpponents.length === 1) {
      setSelectingCompareTarget(false);
      onCompare(activeOpponents[0].seat);
      return;
    }

    setSelectingCompareTarget((current) => !current);
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

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => onInfo("退出全屏失败，请重试。"));
      return;
    }

    const target = document.querySelector<HTMLElement>(".zjh-game-shell") ?? document.documentElement;
    if (!target.requestFullscreen) {
      onInfo("当前浏览器不支持全屏模式。");
      return;
    }

    await target.requestFullscreen().catch(() => onInfo("全屏模式需要浏览器允许后才能开启。"));
  }

  return (
    <>
      <audio ref={audioRef} src={ZJH_MUSIC_SRC} preload="auto" loop />
      <header className="zjh-header">
        <div className="zjh-header-left">
          <span className="zjh-brand">
            <img className="zjh-brand-rose" src={ZJH_BRAND_ROSE_SRC} alt="" draggable={false} />
            <img className="zjh-brand-logo" src={ZJH_BRAND_SRC} alt="炸金花" draggable={false} />
          </span>
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
          <button className="zen-icon-button" type="button" onClick={toggleFullscreen} aria-label={isFullscreen ? "退出全屏" : "进入全屏"}>
            {isFullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
          </button>
          <button className="zen-leave-button" type="button" onClick={onLeave}>
            <LogOut size={18} aria-hidden="true" />
            离开
          </button>
        </div>
      </header>

      {!connected && <div className="zen-offline-banner">连接已断开，请刷新后重新进入房间。</div>}

      <ZjhPromoRail side="left" promos={ZJH_LEFT_PROMOS} />
      <ZjhPromoRail side="right" promos={ZJH_RIGHT_PROMOS} />

      <main className="zjh-main">
        <section className="zjh-table" aria-label="炸金花牌桌">
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
                  winner={winnerSeat === player.seat}
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
                {tableMessage ?? "等待玩家操作"}
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
              onRequestCompare={requestCompare}
              onCancelCompare={() => setSelectingCompareTarget(false)}
            />
          </section>
          {voiceDock}
        </section>
      </main>

      {settingsOpen && (
        <ZjhSettingsDialog
          musicEnabled={musicEnabled}
          musicVolume={musicVolume}
          soundEnabled={soundEnabled}
          soundVolume={soundVolume}
          onMusicEnabledChange={setMusicEnabled}
          onMusicVolumeChange={setMusicVolume}
          onSoundEnabledChange={setSoundEnabled}
          onSoundVolumeChange={setSoundVolume}
          onClose={() => setSettingsOpen(false)}
        />
      )}

    </>
  );
}

function ZjhPromoRail({ side, promos }: { side: "left" | "right"; promos: Array<{ src: string; label: string }> }) {
  return (
    <aside className={`zjh-promo-rail ${side}`} aria-label={side === "left" ? "左侧活动" : "右侧活动"}>
      {promos.map((promo) => (
        <button className="zjh-promo-card" type="button" key={promo.src} aria-label={promo.label}>
          <img src={promo.src} alt={promo.label} draggable={false} loading="lazy" />
        </button>
      ))}
    </aside>
  );
}

function ZjhSettingsDialog({
  musicEnabled,
  musicVolume,
  soundEnabled,
  soundVolume,
  onMusicEnabledChange,
  onMusicVolumeChange,
  onSoundEnabledChange,
  onSoundVolumeChange,
  onClose
}: {
  musicEnabled: boolean;
  musicVolume: number;
  soundEnabled: boolean;
  soundVolume: number;
  onMusicEnabledChange: (enabled: boolean) => void;
  onMusicVolumeChange: (volume: number) => void;
  onSoundEnabledChange: (enabled: boolean) => void;
  onSoundVolumeChange: (volume: number) => void;
  onClose: () => void;
}) {
  const volumePercent = Math.round(musicVolume * 100);
  const soundVolumePercent = Math.round(soundVolume * 100);

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

        <div className="zjh-setting-row">
          <div>
            <strong>游戏音效</strong>
            <span>{soundEnabled ? "已开启" : "已关闭"}</span>
          </div>
          <button
            className={`zjh-toggle-button ${soundEnabled ? "is-stop" : "is-start"}`}
            type="button"
            onClick={() => onSoundEnabledChange(!soundEnabled)}
            aria-pressed={soundEnabled}
          >
            {soundEnabled ? "关闭" : "开启"}
          </button>
        </div>

        <label className="zjh-volume-control">
          <span>音效音量 {soundVolumePercent}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={soundVolumePercent}
            disabled={!soundEnabled}
            onChange={(event) => onSoundVolumeChange(Number(event.target.value) / 100)}
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
      <div className="zjh-actions zjh-ended-actions">
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
  winner,
  compareSelectable,
  onCompareTarget,
  style
}: {
  player: ZjhPlayerView;
  active: boolean;
  self: boolean;
  banker: boolean;
  phase: ZjhRoomView["phase"];
  winner: boolean;
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
          {winner && <ZjhWinMark />}
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

function ZjhWinMark() {
  return (
    <span className="zjh-win-mark" aria-label="胜利">
      <img className="sheng" src={ZJH_WIN_SHENG_SRC} alt="" draggable={false} />
      <span className="li" aria-hidden="true">
        <img className="li-left" src={ZJH_WIN_LI_LEFT_SRC} alt="" draggable={false} />
        <img className="li-right" src={ZJH_WIN_LI_RIGHT_SRC} alt="" draggable={false} />
      </span>
    </span>
  );
}

function getZjhLogKey(action?: ZjhRoomView["turnLog"][number]) {
  if (!action) {
    return undefined;
  }

  return `${action.at}:${action.action}:${action.seat ?? "system"}:${action.label}`;
}


function formatZjhTableMessage(message?: string) {
  const cleaned = message?.replace(/^只剩一名玩家[，,]?\s*/, "").trim();
  return cleaned || undefined;
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

function phaseLabel(phase: ZjhRoomView["phase"]) {
  if (phase === "lobby") {
    return "准备中";
  }
  if (phase === "playing") {
    return "下注中";
  }
  return "已结算";
}
