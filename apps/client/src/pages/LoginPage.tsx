import { type FormEvent, useState } from "react";
import { Gamepad2, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";

export interface AuthProfile {
  nickname: string;
  mode: "account" | "guest";
}

interface LoginPageProps {
  connected: boolean;
  initialAccount: string;
  onLogin: (account: string) => void;
  onGuestLogin: () => void;
  onInfo: (message: string) => void;
}

export function LoginPage({ connected, initialAccount, onLogin, onGuestLogin, onInfo }: LoginPageProps) {
  const [account, setAccount] = useState(initialAccount);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onLogin(account);
  }

  return (
    <main className="login-page" aria-label="棋牌游戏登录">
      <div className="floating-symbol symbol-1">♠</div>
      <div className="floating-symbol symbol-2">♥</div>
      <div className="floating-symbol symbol-3">♣</div>
      <div className="floating-symbol symbol-4">♦</div>
      <div className="floating-symbol symbol-5">中</div>

      <section className="login-hero" aria-label="大厅介绍">
        <div className="login-tag">
          <Sparkles size={16} aria-hidden="true" />
          轻松开局 · 好友同桌
        </div>

        <h1>云上棋牌室</h1>
        <p>
          柔和节奏，安静开局。
          <br />
          登录后进入游戏大厅，选择你想玩的好友牌局。
        </p>

        <div className="login-table-visual" aria-hidden="true">
          <div className="login-table-inner" />
          <div className="login-cards">
            <div className="login-card-face login-card-1">A</div>
            <div className="login-card-face login-card-2">K</div>
            <div className="login-card-face login-card-3">Q</div>
            <div className="login-card-face login-card-4">J</div>
            <div className="login-card-face login-card-5">10</div>
          </div>
        </div>

        <div className="recommend-box">今日推荐：斗地主好友房 · 慢速出牌 · 新手友好</div>
      </section>

      <section className="login-card-panel" aria-label="登录游戏">
        <div className="login-card-heading">
          <Gamepad2 size={28} aria-hidden="true" />
          <div>
            <h2>欢迎回来</h2>
            <p>登录后进入大厅，继续你的好友房牌局</p>
          </div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-form-group">
            手机号 / 游戏账号
            <input
              value={account}
              maxLength={16}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="请输入手机号 / 游戏账号"
              autoComplete="username"
            />
          </label>

          <label className="login-form-group">
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="演示版可不填写"
              autoComplete="current-password"
            />
          </label>

          <div className="login-options">
            <label className="remember-option">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>记住登录状态</span>
            </label>
            <button className="text-button" type="button" onClick={() => onInfo("演示版暂未接入找回密码。")}>
              忘记密码？
            </button>
          </div>

          <button className="login-button" type="submit">
            登录游戏
          </button>
        </form>

        <div className="quick-login">
          <button type="button" onClick={() => onInfo("演示版暂未接入微信登录。")}>
            <MessageCircle size={18} aria-hidden="true" />
            微信登录
          </button>
          <button type="button" onClick={onGuestLogin}>
            <Gamepad2 size={18} aria-hidden="true" />
            游客试玩
          </button>
        </div>

        <p className="safe-tip">
          <ShieldCheck size={15} aria-hidden="true" />
          安全健康游戏 · 未成年人请在监护人指导下使用
        </p>

        <div className="notice-box">
          <h3>温馨提示</h3>
          <p>当前为本机演示版，登录只保存昵称，不会创建真实账号或上传个人信息。</p>
        </div>

        <div className="links" aria-label="法律链接">
          <button type="button" onClick={() => onInfo("用户协议将在正式版开放。")}>
            用户协议
          </button>
          <span>·</span>
          <button type="button" onClick={() => onInfo("隐私政策将在正式版开放。")}>
            隐私政策
          </button>
          <span>·</span>
          <button type="button" onClick={() => onInfo("适龄提示：请健康游戏，理性娱乐。")}>
            适龄提示
          </button>
        </div>

        <span className={`login-status ${connected ? "online" : "offline"}`}>
          {connected ? "服务已连接" : "服务离线"}
        </span>
      </section>
    </main>
  );
}
