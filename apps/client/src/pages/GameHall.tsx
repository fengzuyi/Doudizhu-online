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
import { type FormEvent } from "react";
import type { AuthProfile } from "./LoginPage.js";

interface GameHallProps {
  profile: AuthProfile;
  connected: boolean;
  roomCodeInput: string;
  onRoomCodeInputChange: (value: string) => void;
  onCreateDoudizhuRoom: () => void;
  onJoinDoudizhuRoom: () => void;
  onUnavailable: (gameName: string) => void;
  onInfo: (message: string) => void;
  onLogout: () => void;
}

const friends = [
  { initial: "林", name: "林同学", status: "在线 · 空闲", action: "邀请" },
  { initial: "周", name: "小周", status: "在线 · 大厅", action: "邀请" },
  { initial: "源", name: "阿源", status: "游戏中", action: "观战" },
  { initial: "陈", name: "陈哥", status: "离线", action: "留言" }
];

const games = [
  {
    name: "斗地主",
    description: "三人好友局，适合最常用的朋友开黑玩法。",
    action: "开始",
    available: true,
    Icon: Crown
  },
  {
    name: "炸金花",
    description: "短局轻松，适合几个人快速来一把。",
    action: "敬请期待",
    available: false,
    Icon: CircleDot
  },
  {
    name: "麻将",
    description: "好友同桌，适合慢节奏休闲对局。",
    action: "敬请期待",
    available: false,
    Icon: Blocks
  },
  {
    name: "跑得快",
    description: "规则简单，适合碎片时间一起玩。",
    action: "敬请期待",
    available: false,
    Icon: Gamepad2
  }
];

function avatarText(nickname: string) {
  return nickname.trim().slice(0, 1).toUpperCase() || "玩";
}

export function GameHall({
  profile,
  connected,
  roomCodeInput,
  onRoomCodeInputChange,
  onCreateDoudizhuRoom,
  onJoinDoudizhuRoom,
  onUnavailable,
  onInfo,
  onLogout
}: GameHallProps) {
  const avatar = avatarText(profile.nickname);

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onJoinDoudizhuRoom();
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
                  <p>{profile.mode === "guest" ? "游客试玩" : "账号玩家"} · ID 30216</p>
                </div>
              </div>
            </section>

            <section className="friends-room-card" aria-label="房间">
              <h3>房间</h3>
              <button className="friends-primary-button" type="button" onClick={onCreateDoudizhuRoom}>
                <Plus size={18} aria-hidden="true" />
                创建好友房
              </button>
              <form className="friends-room-form" onSubmit={handleJoinSubmit}>
                <label>
                  房间号
                  <input
                    value={roomCodeInput}
                    maxLength={4}
                    onChange={(event) => onRoomCodeInputChange(event.target.value.toUpperCase())}
                    placeholder="输入房间号加入"
                    autoComplete="off"
                  />
                </label>
                <button className="friends-secondary-button" type="submit">
                  <KeyRound size={18} aria-hidden="true" />
                  加入房间
                </button>
              </form>
            </section>

            <section className="friends-list-card" aria-label="在线好友">
              <h3>在线好友</h3>
              <div className="friends-list">
                {friends.map((friend) => (
                  <div className="friends-row" key={friend.name}>
                    <div className="friends-row-main">
                      <span className="friends-row-avatar">{friend.initial}</span>
                      <div>
                        <strong>{friend.name}</strong>
                        <span>{friend.status}</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => onInfo(`${friend.name} 的${friend.action}功能将在正式版开放。`)}>
                      {friend.action}
                    </button>
                  </div>
                ))}
              </div>
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
              <span>好友局模式</span>
            </div>

            <div className="friends-game-grid">
              {games.map((game) => {
                const Icon = game.Icon;
                return (
                  <article className="friends-game-card" key={game.name}>
                    <span className="friends-game-icon">
                      <Icon size={26} aria-hidden="true" />
                    </span>
                    <h4>{game.name}</h4>
                    <p>{game.description}</p>
                    <button
                      type="button"
                      onClick={
                        game.available
                          ? () => onInfo("请在左侧房间区创建或加入斗地主好友房。")
                          : () => onUnavailable(game.name)
                      }
                    >
                      {game.action}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="friends-panel friends-right-panel">
            <section className="friends-current-room" aria-label="当前房间">
              <h3>当前房间</h3>
              <div className="friends-room-number">无房间</div>
              <p>创建房间后会进入斗地主等待页，房号、人数和准备状态由牌局页面显示。</p>
            </section>

            <section className="friends-chat-card" aria-label="好友消息">
              <h3>好友消息</h3>
              <div className="friends-messages">
                <p>
                  <strong>林同学：</strong>今晚玩斗地主吗？
                </p>
                <p>
                  <strong>小周：</strong>我等下就来。
                </p>
                <p>
                  <strong>系统：</strong>你可以创建房间并复制房号。
                </p>
              </div>
              <form
                className="friends-chat-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  onInfo("好友消息将在正式版开放。");
                }}
              >
                <input placeholder="发一句消息" aria-label="好友消息" />
                <button type="submit" aria-label="发送消息">
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
