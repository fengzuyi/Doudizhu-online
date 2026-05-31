import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  Ban,
  LogOut,
  MessageSquareOff,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserX
} from "lucide-react";
import type { ChatMessage } from "@doudizhu/shared";

const ADMIN_TOKEN_STORAGE_KEY = "doudizhu:adminToken";

interface AdminProfile {
  account: string;
  role: "super_admin";
}

interface AdminUser {
  id: string;
  account: string;
  nickname: string;
  status: "ACTIVE" | "BANNED";
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  activeSessionCount: number;
  muted: boolean;
  muteReason?: string;
}

interface AdminAuditLog {
  id: string;
  at: number;
  admin: string;
  action: string;
  target?: string;
  reason?: string;
}

class AdminApiError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function adminRequest<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body) {
    headers.set("content-type", "application/json");
  }
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let body: { code?: string; message?: string } = {};
  if (text) {
    body = JSON.parse(text) as { code?: string; message?: string };
  }

  if (!response.ok) {
    throw new AdminApiError(body.code ?? "REQUEST_FAILED", body.message ?? "请求失败");
  }

  return body as T;
}

function formatAdminTime(value: string | number | null | undefined) {
  if (!value) {
    return "未记录";
  }

  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    "admin.login": "管理员登录",
    "admin.logout": "管理员退出",
    "user.ban": "封禁账号",
    "user.unban": "解封账号",
    "user.revoke_sessions": "强制下线",
    "chat.mute": "禁言用户",
    "chat.unmute": "解除禁言",
    "chat.delete_message": "删除聊天",
    "chat.clear_messages": "清空聊天"
  };

  return labels[action] ?? action;
}

export function AdminPage() {
  const [token, setToken] = useState(() => localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) ?? "");
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [logs, setLogs] = useState<AdminAuditLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const activeUsers = useMemo(() => users.filter((user) => user.status === "ACTIVE").length, [users]);
  const bannedUsers = users.length - activeUsers;
  const mutedUsers = useMemo(() => users.filter((user) => user.muted).length, [users]);

  async function loadAdminData(currentToken = token) {
    if (!currentToken) {
      return;
    }

    const [meResult, usersResult, messagesResult, logsResult] = await Promise.all([
      adminRequest<{ profile: AdminProfile }>("/api/admin/me", currentToken),
      adminRequest<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(query)}`, currentToken),
      adminRequest<{ messages: ChatMessage[] }>("/api/admin/chat/messages", currentToken),
      adminRequest<{ logs: AdminAuditLog[] }>("/api/admin/audit", currentToken)
    ]);

    setProfile(meResult.profile);
    setUsers(usersResult.users);
    setMessages(messagesResult.messages);
    setLogs(logsResult.logs);
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    loadAdminData(token).catch((error: unknown) => {
      if (error instanceof AdminApiError && error.code === "ADMIN_UNAUTHORIZED") {
        localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        setToken("");
        setProfile(null);
      }
      setNotice(error instanceof Error ? error.message : "加载管理后台失败");
    });
  }, [token]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const result = await adminRequest<{ token: string; profile: AdminProfile }>("/api/admin/login", "", {
        method: "POST",
        body: JSON.stringify({ account, password })
      });
      localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, result.token);
      setToken(result.token);
      setProfile(result.profile);
      setPassword("");
      await loadAdminData(result.token);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setNotice("");
    try {
      await loadAdminData();
      setNotice("已刷新");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "刷新失败");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (token) {
      await adminRequest<{ ok: boolean }>("/api/admin/logout", token, { method: "POST" }).catch(() => undefined);
    }
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setToken("");
    setProfile(null);
  }

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await loadAdminData();
      setNotice(success);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function askReason(label: string) {
    return window.prompt(`${label}原因，可留空`)?.trim() ?? "";
  }

  if (!profile) {
    return (
      <main className="admin-page admin-login-page">
        <form className="admin-login-panel" onSubmit={handleLogin}>
          <div className="admin-login-head">
            <ShieldCheck size={30} aria-hidden="true" />
            <div>
              <p>后台管理</p>
              <h1>管理员登录</h1>
            </div>
          </div>
          <label>
            管理员账号
            <input value={account} onChange={(event) => setAccount(event.target.value)} autoComplete="username" />
          </label>
          <label>
            管理员密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {notice && <p className="admin-notice">{notice}</p>}
          <button className="admin-primary-button" type="submit" disabled={busy}>
            {busy ? "登录中..." : "进入后台"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <div>
          <p>后台管理</p>
          <h1>运营控制台</h1>
        </div>
        <div className="admin-top-actions">
          <span>{profile.account}</span>
          <button type="button" onClick={refresh} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
          <button type="button" onClick={logout}>
            <LogOut size={16} aria-hidden="true" />
            退出
          </button>
        </div>
      </header>

      <section className="admin-metrics" aria-label="概览">
        <article>
          <span>用户</span>
          <strong>{users.length}</strong>
        </article>
        <article>
          <span>封禁</span>
          <strong>{bannedUsers}</strong>
        </article>
        <article>
          <span>禁言</span>
          <strong>{mutedUsers}</strong>
        </article>
        <article>
          <span>聊天</span>
          <strong>{messages.length}</strong>
        </article>
      </section>

      {notice && <p className="admin-notice admin-dashboard-notice">{notice}</p>}

      <section className="admin-grid">
        <article className="admin-panel admin-users-panel">
          <div className="admin-panel-head">
            <div>
              <h2>用户账号</h2>
              <p>封禁、解封、禁言和强制下线</p>
            </div>
            <form
              className="admin-search"
              onSubmit={(event) => {
                event.preventDefault();
                refresh();
              }}
            >
              <Search size={16} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索账号或昵称" />
            </form>
          </div>
          <div className="admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>账号</th>
                  <th>昵称</th>
                  <th>状态</th>
                  <th>会话</th>
                  <th>最近登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.account}</td>
                    <td>{user.nickname}</td>
                    <td>
                      <span className={`admin-status ${user.status === "ACTIVE" ? "active" : "banned"}`}>
                        {user.status === "ACTIVE" ? "正常" : "封禁"}
                      </span>
                      {user.muted && <span className="admin-status muted">禁言</span>}
                    </td>
                    <td>{user.activeSessionCount}</td>
                    <td>{formatAdminTime(user.lastLoginAt)}</td>
                    <td>
                      <div className="admin-row-actions">
                        {user.status === "ACTIVE" ? (
                          <button
                            type="button"
                            onClick={() => {
                              const reason = askReason(`封禁 ${user.account}`);
                              runAction(
                                () =>
                                  adminRequest(`/api/admin/users/${encodeURIComponent(user.account)}/status`, token, {
                                    method: "POST",
                                    body: JSON.stringify({ status: "BANNED", reason })
                                  }),
                                "已封禁账号"
                              );
                            }}
                            disabled={busy}
                          >
                            <Ban size={14} aria-hidden="true" />
                            封禁
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              runAction(
                                () =>
                                  adminRequest(`/api/admin/users/${encodeURIComponent(user.account)}/status`, token, {
                                    method: "POST",
                                    body: JSON.stringify({ status: "ACTIVE" })
                                  }),
                                "已解封账号"
                              )
                            }
                            disabled={busy}
                          >
                            解封
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const reason = user.muted ? "" : askReason(`禁言 ${user.account}`);
                            runAction(
                              () =>
                                adminRequest(`/api/admin/users/${encodeURIComponent(user.account)}/mute`, token, {
                                  method: "POST",
                                  body: JSON.stringify({ muted: !user.muted, reason })
                                }),
                              user.muted ? "已解除禁言" : "已禁言用户"
                            );
                          }}
                          disabled={busy}
                        >
                          <MessageSquareOff size={14} aria-hidden="true" />
                          {user.muted ? "解禁" : "禁言"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const reason = askReason(`强制 ${user.account} 下线`);
                            runAction(
                              () =>
                                adminRequest(`/api/admin/users/${encodeURIComponent(user.account)}/sessions/revoke`, token, {
                                  method: "POST",
                                  body: JSON.stringify({ reason })
                                }),
                              "已强制下线"
                            );
                          }}
                          disabled={busy}
                        >
                          <UserX size={14} aria-hidden="true" />
                          下线
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="admin-panel admin-chat-panel">
          <div className="admin-panel-head">
            <div>
              <h2>大厅聊天</h2>
              <p>删除违规消息，保留最近记录</p>
            </div>
            <button
              className="admin-chat-clear-button"
              type="button"
              onClick={() => {
                if (!window.confirm("确定清空大厅聊天记录？")) {
                  return;
                }
                runAction(
                  () =>
                    adminRequest("/api/admin/chat/messages", token, {
                      method: "DELETE"
                    }),
                  "已清空大厅聊天"
                );
              }}
              disabled={busy || messages.length === 0}
            >
              <Trash2 size={14} aria-hidden="true" />
              清空
            </button>
          </div>
          <div className="admin-chat-list">
            {messages.length === 0 ? (
              <p className="admin-empty">暂无聊天记录</p>
            ) : (
              messages
                .slice()
                .reverse()
                .map((message) => (
                  <div className="admin-chat-item" key={message.id}>
                    <div>
                      <strong>{message.nickname}</strong>
                      <span>{message.account}</span>
                      <time>{formatAdminTime(message.at)}</time>
                    </div>
                    <p>{message.text}</p>
                    <button
                      type="button"
                      onClick={() => {
                        const reason = askReason("删除聊天");
                        runAction(
                          () =>
                            adminRequest(`/api/admin/chat/messages/${encodeURIComponent(message.id)}`, token, {
                              method: "DELETE",
                              body: JSON.stringify({ reason })
                            }),
                          "已删除聊天"
                        );
                      }}
                      disabled={busy}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      删除
                    </button>
                  </div>
                ))
            )}
          </div>
        </article>

        <article className="admin-panel admin-audit-panel">
          <div className="admin-panel-head">
            <div>
              <h2>操作日志</h2>
              <p>最近 100 条后台操作</p>
            </div>
          </div>
          <div className="admin-audit-list">
            {logs.length === 0 ? (
              <p className="admin-empty">暂无操作记录</p>
            ) : (
              logs.map((log) => (
                <div className="admin-audit-item" key={log.id}>
                  <strong>{getActionLabel(log.action)}</strong>
                  <span>{formatAdminTime(log.at)}</span>
                  <p>
                    {log.admin}
                    {log.target ? ` -> ${log.target}` : ""}
                    {log.reason ? `：${log.reason}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
