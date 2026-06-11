import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { Bell, Clipboard, HelpCircle, LogOut, Settings } from "lucide-react";
import type { FighterInputState, FighterPlayerView, FighterRoomView } from "@doudizhu/shared";

interface FighterTableProps {
  room: FighterRoomView;
  connected: boolean;
  notice: string;
  onInput: (input: FighterInputState) => void;
  onCopyRoomCode: () => void;
  onLeave: () => void;
  onInfo: (message: string) => void;
  voiceDock?: ReactNode;
}

type FighterSpriteStyle = CSSProperties & {
  "--fighter-x": string;
  "--fighter-y": string;
  "--fighter-direction": string;
};

type FighterHealthStyle = CSSProperties & {
  "--fighter-hp": string;
};

const MOVE_KEYS = {
  left: new Set(["ArrowLeft", "KeyA"]),
  right: new Set(["ArrowRight", "KeyD"]),
  jump: new Set(["ArrowUp", "KeyW", "Space"]),
  attack: new Set(["KeyJ", "KeyK", "Enter"])
};

const FIGHTER_ASSET_BASE = "/assets/fighter";

const FIGHTER_FRAME_SETS = [
  {
    idle: makeNumberedFrames("stick", "stickMan", 1, 3),
    move: makeNumberedFrames("stick", "stickMan", 12, 20),
    jump: makeNumberedFrames("stick", "stickMan", 20, 28),
    attack: makeNumberedFrames("stick", "stickMan", 31, 38),
    hurt: makeNumberedFrames("stick", "stickMan", 23, 27)
  },
  {
    idle: makeNumberedFrames("npc1", "stickMan", 1, 8),
    move: makeNumberedFrames("npc1", "stickMan", 9, 16),
    jump: makeNumberedFrames("npc1", "stickMan", 35, 40),
    attack: makeNumberedFrames("npc1", "stickMan", 50, 66),
    hurt: makeNumberedFrames("npc1", "stickMan", 42, 48)
  }
] as const;

const HIT_FLASH_FRAMES = Array.from({ length: 5 }, (_, index) => `${FIGHTER_ASSET_BASE}/flash/out${index + 1}.png`);

export function FighterTable({
  room,
  connected,
  notice,
  onInput,
  onCopyRoomCode,
  onLeave,
  onInfo,
  voiceDock
}: FighterTableProps) {
  const self = room.players.find((player) => player.seat === room.selfSeat);
  const opponent = room.players.find((player) => player.seat !== room.selfSeat);
  const canControl = connected && room.phase === "fighting" && Boolean(self?.connected);
  const onInputRef = useRef(onInput);
  const canControlRef = useRef(canControl);
  const pressedKeysRef = useRef(new Set<string>());
  const touchMoveRef = useRef({ left: false, right: false });
  const lastMoveRef = useRef({ left: false, right: false });

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    canControlRef.current = canControl;
    if (!canControl) {
      pressedKeysRef.current.clear();
      touchMoveRef.current = { left: false, right: false };
      lastMoveRef.current = { left: false, right: false };
      onInputRef.current({ left: false, right: false });
    }
  }, [canControl, room.roomCode]);

  useEffect(() => {
    function emitMove(action?: "jump" | "attack") {
      if (!canControlRef.current) {
        return;
      }

      const keys = pressedKeysRef.current;
      const touchMove = touchMoveRef.current;
      const left = touchMove.left || hasAny(keys, MOVE_KEYS.left);
      const right = touchMove.right || hasAny(keys, MOVE_KEYS.right);
      const lastMove = lastMoveRef.current;
      const movementChanged = left !== lastMove.left || right !== lastMove.right;

      if (!movementChanged && !action) {
        return;
      }

      lastMoveRef.current = { left, right };
      onInputRef.current({
        left,
        right,
        jump: action === "jump" || undefined,
        attack: action === "attack" || undefined
      });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTextInput(event.target)) {
        return;
      }

      if (MOVE_KEYS.jump.has(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          emitMove("jump");
        }
        return;
      }

      if (MOVE_KEYS.attack.has(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          emitMove("attack");
        }
        return;
      }

      if (MOVE_KEYS.left.has(event.code) || MOVE_KEYS.right.has(event.code)) {
        event.preventDefault();
        pressedKeysRef.current.add(event.code);
        emitMove();
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (MOVE_KEYS.left.has(event.code) || MOVE_KEYS.right.has(event.code)) {
        pressedKeysRef.current.delete(event.code);
        emitMove();
      }
    }

    function handleBlur() {
      pressedKeysRef.current.clear();
      touchMoveRef.current = { left: false, right: false };
      lastMoveRef.current = { left: false, right: false };
      onInputRef.current({ left: false, right: false });
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      handleBlur();
    };
  }, []);

  return (
    <>
      <header className="fighter-header">
        <div className="fighter-header-left">
          <strong className="fighter-brand">火柴人决斗</strong>
          <span className="fighter-pill room">
            房间 <b>{room.roomCode}</b>
            <button type="button" onClick={onCopyRoomCode} aria-label="复制房间号">
              <Clipboard size={15} aria-hidden="true" />
            </button>
          </span>
          <span className="fighter-pill">阶段 {phaseLabel(room.phase)}</span>
          <span className="fighter-pill">人数 {room.playerCount}/2</span>
          <span className="fighter-pill timer">{formatTimer(room)}</span>
        </div>

        <div className="fighter-header-actions">
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

      {!connected && <div className="zen-offline-banner">连接已断开，正在尝试重连房间。</div>}

      <main className="fighter-main">
        <section className="fighter-stage-wrap" aria-label="火柴人决斗场">
          <div className="fighter-hud">
            <FighterStatus player={self} label="你" align="left" />
            <div className="fighter-round-status">
              <strong>{centerStatus(room)}</strong>
              <span>{room.message ?? "等待玩家操作"}</span>
            </div>
            <FighterStatus player={opponent} label="对手" align="right" />
          </div>

          <div className={`fighter-stage phase-${room.phase}`}>
            {room.players.map((player) => (
              <FighterSprite
                key={player.seat}
                player={player}
                arena={room.arena}
                self={player.seat === room.selfSeat}
                serverTime={room.serverTime}
              />
            ))}
            <div className="fighter-ground" aria-hidden="true" />
          </div>

          {voiceDock}
        </section>
      </main>

      {room.phase === "ended" && <FighterResultDialog room={room} notice={notice} />}
    </>
  );
}

function FighterStatus({ player, label, align }: { player?: FighterPlayerView; label: string; align: "left" | "right" }) {
  const hpPercent = player ? Math.max(0, Math.min(100, (player.hp / player.maxHp) * 100)) : 0;
  const style: FighterHealthStyle = { "--fighter-hp": `${hpPercent}%` };

  return (
    <article className={`fighter-status ${align}`}>
      <div>
        <strong>{player ? (label === "你" ? "你" : player.nickname) : "等待入座"}</strong>
        <span>{player ? `${player.score} 胜点${player.connected ? "" : " · 离线"}` : "空位"}</span>
      </div>
      <div className="fighter-health" style={style} aria-label={`血量 ${Math.round(hpPercent)}%`}>
        <span />
      </div>
    </article>
  );
}

function FighterSprite({
  player,
  arena,
  self,
  serverTime
}: {
  player: FighterPlayerView;
  arena: FighterRoomView["arena"];
  self: boolean;
  serverTime: number;
}) {
  const previousPositionRef = useRef({ x: player.x, y: player.y });
  const attackStateRef = useRef({ active: false, startedAt: serverTime });
  const stunStateRef = useRef({ active: false, startedAt: serverTime });
  const previousPosition = previousPositionRef.current;
  const moving = player.grounded && Math.abs(player.x - previousPosition.x) > 1;

  previousPositionRef.current = { x: player.x, y: player.y };

  if (player.attacking && !attackStateRef.current.active) {
    attackStateRef.current = { active: true, startedAt: serverTime };
  } else if (!player.attacking && attackStateRef.current.active) {
    attackStateRef.current = { ...attackStateRef.current, active: false };
  }

  if (player.stunned && !stunStateRef.current.active) {
    stunStateRef.current = { active: true, startedAt: serverTime };
  } else if (!player.stunned && stunStateRef.current.active) {
    stunStateRef.current = { ...stunStateRef.current, active: false };
  }

  const spriteFrame = pickSpriteFrame({
    player,
    moving,
    serverTime,
    attackStartedAt: attackStateRef.current.startedAt,
    stunStartedAt: stunStateRef.current.startedAt
  });
  const flashFrame = HIT_FLASH_FRAMES[cycleIndex(serverTime - stunStateRef.current.startedAt, HIT_FLASH_FRAMES.length, 48)];
  const style: FighterSpriteStyle = {
    "--fighter-x": `${(player.x / arena.width) * 100}%`,
    "--fighter-y": `${(player.y / arena.height) * 100}%`,
    "--fighter-direction": player.facing === "right" ? "1" : "-1"
  };

  return (
    <div
      className={`fighter-sprite ${self ? "self" : "opponent"} ${player.attacking ? "attacking" : ""} ${
        player.stunned ? "stunned" : ""
      } ${moving ? "moving" : ""} ${player.grounded ? "grounded" : "airborne"}`}
      style={style}
      aria-label={`${player.nickname}${player.stunned ? "受击" : ""}`}
    >
      <img className="fighter-sprite-image" src={spriteFrame} alt="" draggable={false} />
      {player.stunned && <img className="fighter-hit-flash" src={flashFrame} alt="" aria-hidden="true" draggable={false} />}
      <span className="fighter-name">{self ? "你" : player.nickname}</span>
    </div>
  );
}

function FighterResultDialog({ room, notice }: { room: FighterRoomView; notice: string }) {
  const result = room.result;
  const title = notice || (result?.winnerNickname ? `${result.winnerNickname} 获胜` : result?.reason ?? "本局结束");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="fighter-result-title">
      <section className="result-dialog fighter-result-dialog">
        <h2 id="fighter-result-title">{title}</h2>
        {result && (
          <>
            <p>{result.reason}</p>
            <div className="fighter-result-list">
              {room.players.map((player) => (
                <p key={player.seat}>
                  <strong>{player.nickname}</strong>
                  <span>剩余血量 {result.remainingHp[player.seat] ?? player.hp}</span>
                  <b className={(result.scores[player.seat] ?? 0) >= 0 ? "score plus" : "score minus"}>
                    {formatScoreDelta(result.scores[player.seat] ?? 0)}
                  </b>
                </p>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function pickSpriteFrame({
  player,
  moving,
  serverTime,
  attackStartedAt,
  stunStartedAt
}: {
  player: FighterPlayerView;
  moving: boolean;
  serverTime: number;
  attackStartedAt: number;
  stunStartedAt: number;
}) {
  const frameSet = FIGHTER_FRAME_SETS[player.seat % FIGHTER_FRAME_SETS.length] ?? FIGHTER_FRAME_SETS[0];
  if (player.attacking) {
    return frameSet.attack[cycleIndex(serverTime - attackStartedAt, frameSet.attack.length, 42)];
  }
  if (player.stunned) {
    return frameSet.hurt[cycleIndex(serverTime - stunStartedAt, frameSet.hurt.length, 58)];
  }
  if (!player.grounded) {
    return frameSet.jump[cycleIndex(serverTime, frameSet.jump.length, 72)];
  }
  if (moving) {
    return frameSet.move[cycleIndex(serverTime, frameSet.move.length, 72)];
  }
  return frameSet.idle[cycleIndex(serverTime, frameSet.idle.length, 180)];
}

function cycleIndex(time: number, length: number, frameMs: number) {
  return Math.max(0, Math.floor(Math.max(0, time) / frameMs) % length);
}

function makeNumberedFrames(folder: string, prefix: string, start: number, end: number) {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => `${FIGHTER_ASSET_BASE}/${folder}/${prefix}${String(start + index).padStart(4, "0")}.png`
  );
}

function hasAny(keys: Set<string>, candidates: Set<string>) {
  for (const key of candidates) {
    if (keys.has(key)) {
      return true;
    }
  }
  return false;
}

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function phaseLabel(phase: FighterRoomView["phase"]) {
  const labels: Record<FighterRoomView["phase"], string> = {
    lobby: "准备中",
    countdown: "倒计时",
    fighting: "决斗中",
    ended: "已结束"
  };
  return labels[phase];
}

function centerStatus(room: FighterRoomView) {
  if (room.phase === "countdown") {
    return `倒计时 ${formatCountdown(room)}`;
  }
  if (room.phase === "fighting") {
    return formatTimer(room);
  }
  if (room.phase === "ended") {
    return room.result?.winnerNickname ? `${room.result.winnerNickname} 胜` : "平局";
  }
  return room.playerCount < 2 ? "等待对手" : "准备开局";
}

function formatCountdown(room: FighterRoomView) {
  if (room.countdownEndsAt === undefined) {
    return "3";
  }
  return String(Math.max(1, Math.ceil((room.countdownEndsAt - room.serverTime) / 1000)));
}

function formatTimer(room: FighterRoomView) {
  if (room.phase === "countdown") {
    return `${formatCountdown(room)}s`;
  }
  if (room.roundEndsAt === undefined) {
    return "90s";
  }
  return `${Math.max(0, Math.ceil((room.roundEndsAt - room.serverTime) / 1000))}s`;
}

function formatScoreDelta(score: number) {
  return score > 0 ? `+${score}` : `${score}`;
}
