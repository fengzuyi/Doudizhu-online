import {
  Bell,
  Blocks,
  CircleDot,
  Crown,
  Gamepad2,
  KeyRound,
  LogOut,
  Plus,
  Send,
  Settings,
  Sparkles,
  UserRound
} from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import type { ChatMessage, GameKind } from "@doudizhu/shared";
import type { AuthProfile } from "./LoginPage.js";

interface GameHallProps {
  profile: AuthProfile;
  connected: boolean;
  selectedGame: GameKind;
  zjhMaxPlayers: number;
  roomCodeInput: string;
  onGameSelect: (game: GameKind) => void;
  onZjhMaxPlayersChange: (value: number) => void;
  onRoomCodeInputChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onUnavailable: (gameName: string) => void;
  onInfo: (message: string) => void;
  onLogout: () => void;
  chatMessages: ChatMessage[];
  chatOnlineCount: number;
  chatJoined: boolean;
  chatDraft: string;
  onChatDraftChange: (value: string) => void;
  onSendChat: () => void;
}

const games = [
  {
    kind: "doudizhu" as const,
    name: "斗地主",
    description: "三人好友局，轮流叫分，服务端判定出牌。",
    action: "选择",
    available: true,
    Icon: Crown
  },
  {
    kind: "zha_jin_hua" as const,
    name: "炸金花",
    description: "2-12 人三张牌局，支持看牌、跟注、加注、比牌和弃牌。",
    action: "选择",
    available: true,
    Icon: CircleDot
  },
  {
    kind: "da_ban_zi" as const,
    name: "打板子",
    description: "四人固定好友房，支持包了、叫队友、隐藏身份和收牌数结算。",
    action: "选择",
    available: true,
    Icon: Gamepad2
  },
  {
    kind: "mahjong" as const,
    name: "麻将",
    description: "好友同桌，适合慢节奏休闲对局。",
    action: "敬请期待",
    available: false,
    Icon: Blocks
  },
  {
    kind: "paodekuai" as const,
    name: "跑得快",
    description: "规则简单，适合碎片时间一起玩。",
    action: "敬请期待",
    available: false,
    Icon: Gamepad2
  }
];

const selectedGameName: Record<GameKind, string> = {
  doudizhu: "斗地主",
  zha_jin_hua: "炸金花",
  da_ban_zi: "打板子"
};

function avatarText(nickname: string) {
  return nickname.trim().slice(0, 1).toUpperCase() || "玩";
}

export function GameHall({
  profile,
  connected,
  selectedGame,
  zjhMaxPlayers,
  roomCodeInput,
  onGameSelect,
  onZjhMaxPlayersChange,
  onRoomCodeInputChange,
  onCreateRoom,
  onJoinRoom,
  onUnavailable,
  onInfo,
  onLogout,
  chatMessages,
  chatOnlineCount,
  chatJoined,
  chatDraft,
  onChatDraftChange,
  onSendChat
}: GameHallProps) {
  const avatar = avatarText(profile.nickname);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const currentGameName = selectedGameName[selectedGame];

  useEffect(() => {
    const node = messagesRef.current;
    if (!node) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages.length]);

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoinRoom();
  }

  function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSendChat();
  }

  return (
    <main className="hall-page friends-hall" aria-label="游戏大厅">
      <div className="friends-hall-app">
        <header className="friends-topbar">
          <div className="friends-brand">
            <span className="friends-brand-logo">
              <Sparkles size={23} aria-hidden="true" />
            </span>
            <div>
              <h1>云上棋牌室</h1>
              <p>朋友局 · 轻松玩 · 不打扰</p>
            </div>
          </div>

          <div className="friends-top-actions">
            <span className="friends-user-chip">
              <span className="friends-small-avatar">{avatar}</span>
              <strong>{profile.nickname}</strong>
            </span>
            <span className={`friends-service ${connected ? "online" : "offline"}`}>
              {connected ? "服务已连接" : "服务离线"}
            </span>
            <button className="friends-icon-button" type="button" onClick={() => onInfo("通知中心将在正式版开放。")} aria-label="通知">
              <Bell size={18} aria-hidden="true" />
            </button>
            <button className="friends-icon-button" type="button" onClick={() => onInfo("设置将在正式版开放。")} aria-label="设置">
              <Settings size={18} aria-hidden="true" />
            </button>
            <button className="friends-logout-button" type="button" onClick={onLogout}>
              <LogOut size={18} aria-hidden="true" />
              退出
            </button>
          </div>
        </header>

        <section className="friends-main" aria-label="朋友局大厅">
          <aside className="friends-panel friends-left-panel">
            <section className="friends-profile-card" aria-label="玩家信息">
              <div className="friends-profile-row">
                <span className="friends-avatar">
                  <UserRound size={30} aria-hidden="true" />
                </span>
                <div>
                  <h2>{profile.nickname}</h2>
                  <p>账号玩家 · {profile.account}</p>
                </div>
              </div>
            </section>

            <section className="friends-room-card" aria-label="房间">
              <h3>{currentGameName}房间</h3>
              {selectedGame === "zha_jin_hua" && (
                <label className="friends-room-select">
                  人数上限
                  <select value={zjhMaxPlayers} onChange={(event) => onZjhMaxPlayersChange(Number(event.target.value))}>
                    {[2, 3, 4, 5, 6, 8, 10, 12].map((count) => (
                      <option value={count} key={count}>
                        {count} 人
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button className="friends-primary-button" type="button" onClick={onCreateRoom} disabled={!connected}>
                <Plus size={18} aria-hidden="true" />
                创建{currentGameName}房
              </button>
              <form className="friends-room-form" onSubmit={handleJoinSubmit}>
                <label>
                  房间号
                  <input
                    value={roomCodeInput}
                    maxLength={4}
                    onChange={(event) => onRoomCodeInputChange(event.target.value.toUpperCase())}
                    placeholder={`输入${currentGameName}房间号`}
                    autoComplete="off"
                    disabled={!connected}
                  />
                </label>
                <button className="friends-secondary-button" type="submit" disabled={!connected}>
                  <KeyRound size={18} aria-hidden="true" />
                  加入房间
                </button>
              </form>
            </section>
          </aside>

          <section className="friends-panel friends-center-panel">
            <div className="friends-welcome">
              <div>
                <h2>和朋友开一局吗？</h2>
                <p>选择游戏后创建房间，把房号发给好友。界面保持简单，只保留一起玩需要的功能。</p>
              </div>
              <div className="friends-table-art" aria-hidden="true">
                <span className="friends-mini-card friends-card-one">A</span>
                <span className="friends-mini-card friends-card-two">K</span>
                <span className="friends-mini-card friends-card-three">Q</span>
              </div>
            </div>

            <div className="friends-section-head">
              <h3>选择游戏</h3>
              <span>{currentGameName} · 好友房模式</span>
            </div>

            <div className="friends-game-grid">
              {games.map((game) => {
                const Icon = game.Icon;
                const selected = game.kind === selectedGame;
                return (
                  <article className={`friends-game-card ${selected ? "selected" : ""}`} key={game.name}>
                    <span className="friends-game-icon">
                      <Icon size={26} aria-hidden="true" />
                    </span>
                    <h4>{game.name}</h4>
                    <p>{game.description}</p>
                    <button
                      type="button"
                      onClick={
                        game.kind === "doudizhu" || game.kind === "zha_jin_hua" || game.kind === "da_ban_zi"
                          ? () => onGameSelect(game.kind)
                          : () => onUnavailable(game.name)
                      }
                    >
                      {selected ? "已选择" : game.action}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="friends-panel friends-right-panel">
            <section className="friends-chat-card" aria-label="大厅聊天">
              <div className="friends-chat-head">
                <h3>大厅聊天</h3>
                <span>{chatJoined ? `${chatOnlineCount} 人在线` : "连接中"}</span>
              </div>
              <div className="friends-messages" ref={messagesRef}>
                {chatMessages.length > 0 ? (
                  chatMessages.map((message) => (
                    <p key={message.id} className={message.account === profile.account ? "from-self" : ""}>
                      <span className="friends-chat-message-meta">
                        <strong>{message.nickname}</strong>
                        <time>{formatChatTime(message.at)}</time>
                      </span>
                      {message.text}
                    </p>
                  ))
                ) : (
                  <p>
                    <strong>系统：</strong>暂无消息，发一句招呼吧。
                  </p>
                )}
              </div>
              <form className="friends-chat-form" onSubmit={handleChatSubmit}>
                <input
                  value={chatDraft}
                  onChange={(event) => onChatDraftChange(event.target.value)}
                  placeholder="发一句消息"
                  aria-label="大厅聊天消息"
                  maxLength={120}
                  disabled={!connected || !chatJoined}
                />
                <button type="submit" aria-label="发送消息" disabled={!connected || !chatJoined || !chatDraft.trim()}>
                  <Send size={18} aria-hidden="true" />
                </button>
              </form>
            </section>
          </aside>
        </section>
      </div>
    </main>
  );
}

function formatChatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}
