import { type FormEvent, useState } from "react";
import { Gamepad2, ShieldCheck, Sparkles, UserPlus, X } from "lucide-react";

export interface AuthProfile {
  account: string;
  nickname: string;
  mode: "account";
}

export interface LoginPayload {
  account: string;
  password: string;
  remember: boolean;
}

export interface RegisterPayload {
  account: string;
  nickname: string;
  password: string;
}

interface LoginPageProps {
  connected: boolean;
  initialAccount: string;
  isBusy: boolean;
  onLogin: (payload: LoginPayload) => Promise<void>;
  onRegister: (payload: RegisterPayload, remember: boolean) => Promise<boolean>;
  onInfo: (message: string) => void;
}

export function LoginPage({ connected, initialAccount, isBusy, onLogin, onRegister, onInfo }: LoginPageProps) {
  const [account, setAccount] = useState(initialAccount);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [formError, setFormError] = useState("");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerAccount, setRegisterAccount] = useState("");
  const [registerNickname, setRegisterNickname] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registerError, setRegisterError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanAccount = account.trim();
    if (!cleanAccount) {
      setFormError("请输入手机号 / 游戏账号。");
      return;
    }
    if (!password) {
      setFormError("请输入密码。");
      return;
    }

    setFormError("");
    await onLogin({ account: cleanAccount, password, remember });
  }

  function closeRegister() {
    if (isBusy) {
      return;
    }

    setRegisterOpen(false);
    setRegisterError("");
  }

  async function handleRegisterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanAccount = registerAccount.trim();
    const cleanNickname = registerNickname.trim();

    if (!cleanAccount) {
      setRegisterError("请输入游戏账号。");
      return;
    }
    if (!cleanNickname) {
      setRegisterError("请输入昵称。");
      return;
    }
    if (!registerPassword) {
      setRegisterError("请输入密码。");
      return;
    }
    if (registerPassword !== confirmPassword) {
      setRegisterError("两次输入的密码不一致。");
      return;
    }

    setRegisterError("");
    const success = await onRegister({ account: cleanAccount, nickname: cleanNickname, password: registerPassword }, remember);
    if (success) {
      setRegisterOpen(false);
    }
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
              disabled={isBusy}
            />
          </label>

          <label className="login-form-group">
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="请输入密码"
              autoComplete="current-password"
              disabled={isBusy}
            />
          </label>

          {formError && <div className="form-error">{formError}</div>}

          <div className="login-options">
            <label className="remember-option">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                disabled={isBusy}
              />
              <span>记住登录状态</span>
            </label>
            <button className="text-button" type="button" onClick={() => onInfo("演示版暂未接入找回密码。")}>
              忘记密码？
            </button>
          </div>

          <button className="login-button" type="submit" disabled={isBusy}>
            {isBusy ? "登录中..." : "登录游戏"}
          </button>
        </form>

        <div className="register-action">
          <button type="button" onClick={() => setRegisterOpen(true)} disabled={isBusy}>
            <UserPlus size={18} aria-hidden="true" />
            注册账号
          </button>
        </div>

        <p className="safe-tip">
          <ShieldCheck size={15} aria-hidden="true" />
          安全健康游戏 · 未成年人请在监护人指导下使用
        </p>

        <div className="notice-box">
          <h3>温馨提示</h3>
          <p>当前为本机演示版，账号只保存在后端内存中，服务重启后需要重新注册。</p>
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

      {registerOpen && (
        <div className="modal-backdrop register-backdrop" role="dialog" aria-modal="true" aria-labelledby="register-title">
          <section className="register-dialog">
            <div className="register-dialog-head">
              <div>
                <p className="eyebrow">创建账号</p>
                <h2 id="register-title">注册账号</h2>
              </div>
              <button className="register-close" type="button" onClick={closeRegister} aria-label="关闭注册弹窗" disabled={isBusy}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <form className="register-form" onSubmit={handleRegisterSubmit}>
              <label className="login-form-group">
                游戏账号
                <input
                  value={registerAccount}
                  maxLength={16}
                  onChange={(event) => setRegisterAccount(event.target.value)}
                  placeholder="例如 player001"
                  autoComplete="username"
                  disabled={isBusy}
                />
              </label>

              <label className="login-form-group">
                昵称
                <input
                  value={registerNickname}
                  maxLength={16}
                  onChange={(event) => setRegisterNickname(event.target.value)}
                  placeholder="例如 阿星"
                  autoComplete="nickname"
                  disabled={isBusy}
                />
              </label>

              <label className="login-form-group">
                密码
                <input
                  type="password"
                  value={registerPassword}
                  onChange={(event) => setRegisterPassword(event.target.value)}
                  placeholder="请输入密码"
                  autoComplete="new-password"
                  disabled={isBusy}
                />
              </label>

              <label className="login-form-group">
                确认密码
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  disabled={isBusy}
                />
              </label>

              {registerError && <div className="form-error">{registerError}</div>}

              <button className="login-button" type="submit" disabled={isBusy}>
                {isBusy ? "注册中..." : "注册并登录"}
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
