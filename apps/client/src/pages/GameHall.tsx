import {
  Bell,
  History,
  KeyRound,
  LogOut,
  Plus,
  RotateCw,
  Send,
  Settings,
  Sparkles,
  UserRound
} from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import type { ChatMessage, GameKind, GameSessionRecord } from "@doudizhu/shared";
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
  gameRecords: GameSessionRecord[];
  gameRecordsOpen: boolean;
  gameRecordsBusy: boolean;
  gameRecordsError: string;
  onToggleGameRecords: () => void;
  onRefreshGameRecords: () => void;
}

const games = [
  {
    kind: "da_ban_zi" as const,
    name: "打板子",
    action: "选择"
  },
  {
    kind: "zha_jin_hua" as const,
    name: "炸金花",
    action: "选择"
  },
  {
    kind: "doudizhu" as const,
    name: "斗地主",
    action: "选择"
  },
  {
    kind: "mahjong" as const,
    name: "麻将",
    action: "敬请期待"
  }
];

const selectedGameName: Record<GameKind, string> = {
  doudizhu: "斗地主",
  zha_jin_hua: "炸金花",
  da_ban_zi: "打板子"
};

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
  onSendChat,
  gameRecords,
  gameRecordsOpen,
  gameRecordsBusy,
  gameRecordsError,
  onToggleGameRecords,
  onRefreshGameRecords
}: GameHallProps) {
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
      <div className="hall-shooting-stars" aria-hidden="true">
        <span className="login-star-stream stream-1" />
        <span className="login-star-stream stream-2" />
        <span className="login-star-stream stream-3" />
        <span className="login-star-stream stream-4" />
        <span className="login-star-stream stream-5" />
      </div>
      <div className="friends-hall-app">
        <header className="friends-topbar">
          <div className="friends-brand">
            <span className="friends-brand-logo">
              <Sparkles size={23} aria-hidden="true" />
            </span>
            <div>
              <h1>云上棋牌室</h1>
            </div>
          </div>

          <div className="friends-top-actions">
            <div className="friends-record-wrap">
              <button
                className="friends-icon-button"
                type="button"
                onClick={onToggleGameRecords}
                aria-label="游戏记录"
                aria-expanded={gameRecordsOpen}
              >
                <History size={18} aria-hidden="true" />
              </button>
              {gameRecordsOpen && (
                <section className="friends-record-popover" aria-label="游戏记录">
                  <div className="friends-record-head">
                    <div>
                      <h3>游戏记录</h3>
                      <span>{gameRecords.length} 条</span>
                    </div>
                    <button
                      className="friends-record-refresh"
                      type="button"
                      onClick={onRefreshGameRecords}
                      disabled={gameRecordsBusy}
                      aria-label="刷新游戏记录"
                    >
                      <RotateCw size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="friends-record-list">
                    {gameRecordsBusy && gameRecords.length === 0 ? (
                      <p className="friends-record-empty">正在读取记录...</p>
                    ) : gameRecordsError ? (
                      <p className="friends-record-empty">{gameRecordsError}</p>
                    ) : gameRecords.length > 0 ? (
                      gameRecords.map((record) => (
                        <article className="friends-record-item" key={record.id}>
                          <div>
                            <strong>{record.gameName}</strong>
                            <span>
                              房间 {record.roomCode}
                              {record.seat !== undefined ? ` · ${record.seat + 1}号位` : ""}
                            </span>
                          </div>
                          <time>{formatRecordTime(record.leftAt)}</time>
                          <p>{record.resultLabel ?? record.phase}</p>
                          <b>{record.scoreLabel}</b>
                        </article>
                      ))
                    ) : (
                      <p className="friends-record-empty">暂无游戏记录</p>
                    )}
                  </div>
                </section>
              )}
            </div>
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
            <div className="friends-section-head">
              <h3>选择游戏</h3>
              <span>{currentGameName} · 好友房模式</span>
            </div>

            <div className="friends-game-grid">
              {games.map((game) => {
                const selected = game.kind === selectedGame;
                return (
                  <article className={`friends-game-card game-${game.kind} ${selected ? "selected" : ""}`} key={game.name}>
                    <h4>{game.name}</h4>
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

function formatRecordTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
