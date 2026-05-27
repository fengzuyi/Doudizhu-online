import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clipboard,
  Crown,
  HelpCircle,
  LogOut,
  Play,
  Send,
  Settings,
  Users
} from "lucide-react";
import type {
  BidScore,
  Card,
  ChatMessage,
  DaBanZiPartnerCallOption,
  DaBanZiRoomView,
  DaBanZiRoundResult,
  GameKind,
  PlayerSeat,
  PlayerView,
  RoomView,
  RoundResult,
  ZjhCompareReveal,
  ZjhRoomView,
  ZjhRoundResult
} from "@doudizhu/shared";
import { socket } from "./socket.js";
import { GameHall } from "./pages/GameHall.js";
import { LoginPage, type AuthProfile, type LoginPayload, type RegisterPayload } from "./pages/LoginPage.js";
import { ZhaJinHuaTable } from "./pages/ZhaJinHuaTable.js";
import { DaBanZiTable } from "./pages/DaBanZiTable.js";

const AUTH_STORAGE_KEY = "doudizhu:authProfile";
const AUTH_TOKEN_STORAGE_KEY = "doudizhu:authToken";
const ROOM_SESSION_KEY = "doudizhu:activeRoom";

type ActiveView = "login" | "hall" | "doudizhu" | "zha_jin_hua" | "da_ban_zi";

function readStoredAuth(): AuthProfile | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<AuthProfile>;
    if (!parsed.account || !parsed.nickname || parsed.mode !== "account") {
      return null;
    }

    return { account: parsed.account, nickname: parsed.nickname, mode: parsed.mode };
  } catch {
    return null;
  }
}

function readStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) ?? "";
}

function clearStoredAuth() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
  localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  localStorage.removeItem("doudizhu:nickname");
}

function readStoredRoomSession() {
  try {
    return sessionStorage.getItem(ROOM_SESSION_KEY);
  } catch {
    return null;
  }
}

function rememberRoomSession(roomCode: string) {
  try {
    sessionStorage.setItem(ROOM_SESSION_KEY, roomCode);
  } catch {
    // Session storage can be unavailable in private or restricted browser modes.
  }
}

function clearStoredRoomSession() {
  try {
    sessionStorage.removeItem(ROOM_SESSION_KEY);
  } catch {
    // Nothing to clear when session storage is unavailable.
  }
}

interface AuthResponse {
  token: string;
  profile: AuthProfile;
}

interface AuthMeResponse {
  profile: AuthProfile;
}

class ApiException extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type") && options.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers
  });
  const body = (await response.json()) as { code?: string; message?: string };

  if (!response.ok) {
    throw new ApiException(body.code ?? "REQUEST_FAILED", body.message ?? "请求失败。");
  }

  return body as T;
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}

function seatName(seat: PlayerSeat, selfSeat?: PlayerSeat): string {
  if (seat === selfSeat) {
    return "你";
  }

  if (selfSeat === undefined) {
    return `座位 ${seat + 1}`;
  }

  return seat === ((selfSeat + 1) % 3) ? "下家" : "上家";
}

function formatScore(result: RoundResult | undefined, seat: PlayerSeat): string {
  if (!result) {
    return "0";
  }

  const score = result.scores[seat];
  return score > 0 ? `+${score}` : `${score}`;
}

function getPhaseLabel(room: RoomView | null): string {
  if (!room) {
    return "未入座";
  }

  const labels: Record<RoomView["phase"], string> = {
    lobby: "准备中",
    bidding: "叫分中",
    playing: "出牌中",
    ended: "已结算"
  };

  return labels[room.phase];
}

export default function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [authProfile, setAuthProfile] = useState<AuthProfile | null>(() => readStoredAuth());
  const [authToken, setAuthToken] = useState(() => readStoredToken());
  const [authBusy, setAuthBusy] = useState(false);
  const [authChecking, setAuthChecking] = useState(() => Boolean(readStoredAuth() && readStoredToken()));
  const [activeView, setActiveView] = useState<ActiveView>(() => (readStoredAuth() && readStoredToken() ? "hall" : "login"));
  const [nickname, setNickname] = useState(() => readStoredAuth()?.nickname ?? "");
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameKind>("doudizhu");
  const [zjhMaxPlayers, setZjhMaxPlayers] = useState(4);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [zjhRoom, setZjhRoom] = useState<ZjhRoomView | null>(null);
  const [daBanZiRoom, setDaBanZiRoom] = useState<DaBanZiRoomView | null>(null);
  const [zjhCompareReveal, setZjhCompareReveal] = useState<ZjhCompareReveal | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [toast, setToast] = useState<string>("");
  const [endedNotice, setEndedNotice] = useState<string>("");
  const [zjhEndedNotice, setZjhEndedNotice] = useState<string>("");
  const [daBanZiEndedNotice, setDaBanZiEndedNotice] = useState<string>("");
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [gameHeaderCollapsed, setGameHeaderCollapsed] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatOnlineCount, setChatOnlineCount] = useState(0);
  const [chatJoined, setChatJoined] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [gameChatOpen, setGameChatOpen] = useState(false);
  const roomRef = useRef<RoomView | null>(null);
  const zjhRoomRef = useRef<ZjhRoomView | null>(null);
  const daBanZiRoomRef = useRef<DaBanZiRoomView | null>(null);
  const suppressRoomStateRef = useRef(false);
  const suppressZjhRoomStateRef = useRef(false);
  const suppressDaBanZiRoomStateRef = useRef(false);

  const resetRoomSession = useCallback((message?: string) => {
    roomRef.current = null;
    zjhRoomRef.current = null;
    daBanZiRoomRef.current = null;
    clearStoredRoomSession();
    setLeaveConfirmOpen(false);
    setRoom(null);
    setZjhRoom(null);
    setDaBanZiRoom(null);
    setZjhCompareReveal(null);
    setZjhCompareReveal(null);
    setSelectedIds(new Set());
    setEndedNotice("");
    setZjhEndedNotice("");
    setDaBanZiEndedNotice("");
    setRoomCodeInput("");
    setActiveView("hall");
    if (message) {
      setToast(message);
    }
  }, []);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    zjhRoomRef.current = zjhRoom;
  }, [zjhRoom]);

  useEffect(() => {
    daBanZiRoomRef.current = daBanZiRoom;
  }, [daBanZiRoom]);

  useEffect(() => {
    const staleRoomCode = readStoredRoomSession();
    if (!staleRoomCode) {
      return;
    }

    resetRoomSession(`刷新后已离开房间 ${staleRoomCode}，请重新创建或加入。`);
  }, [resetRoomSession]);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }

    function onDisconnect() {
      setConnected(false);
      if (roomRef.current || zjhRoomRef.current || daBanZiRoomRef.current) {
        resetRoomSession("连接已断开，当前房间已清理，请重新创建或加入。");
        return;
      }

      setToast("连接已断开。");
    }

    function onRoomState({ roomView }: { roomView: RoomView }) {
      if (suppressRoomStateRef.current) {
        suppressRoomStateRef.current = false;
        return;
      }

      roomRef.current = roomView;
      zjhRoomRef.current = null;
      daBanZiRoomRef.current = null;
      rememberRoomSession(roomView.roomCode);
      setRoom(roomView);
      setZjhRoom(null);
      setDaBanZiRoom(null);
      setActiveView("doudizhu");
      setSelectedIds(new Set());
      if (roomView.phase !== "ended") {
        setEndedNotice("");
      }
    }

    function onZjhRoomState({ roomView }: { roomView: ZjhRoomView }) {
      if (suppressZjhRoomStateRef.current) {
        suppressZjhRoomStateRef.current = false;
        return;
      }

      zjhRoomRef.current = roomView;
      roomRef.current = null;
      daBanZiRoomRef.current = null;
      rememberRoomSession(`zjh:${roomView.roomCode}`);
      setZjhRoom(roomView);
      setRoom(null);
      setDaBanZiRoom(null);
      setActiveView("zha_jin_hua");
      setSelectedIds(new Set());
      if (roomView.phase !== "ended") {
        setZjhEndedNotice("");
      }
    }

    function onDaBanZiRoomState({ roomView }: { roomView: DaBanZiRoomView }) {
      if (suppressDaBanZiRoomStateRef.current) {
        suppressDaBanZiRoomStateRef.current = false;
        return;
      }

      daBanZiRoomRef.current = roomView;
      roomRef.current = null;
      zjhRoomRef.current = null;
      rememberRoomSession(`dbz:${roomView.roomCode}`);
      setDaBanZiRoom(roomView);
      setRoom(null);
      setZjhRoom(null);
      setActiveView("da_ban_zi");
      setSelectedIds(new Set());
      if (roomView.phase !== "ended") {
        setDaBanZiEndedNotice("");
      }
    }

    function onZjhCompareReveal({ reveal }: { reveal: ZjhCompareReveal }) {
      setZjhCompareReveal(reveal);
    }

    function onGameError({ code, message }: { code: string; message: string }) {
      if (["NO_ROOM", "NO_PLAYER", "ROOM_NOT_FOUND"].includes(code)) {
        resetRoomSession(message);
        return;
      }

      setToast(message);
    }

    function onGameEnded({ result, message }: { result?: RoundResult; message?: string }) {
      if (message) {
        setEndedNotice(message);
      } else if (result) {
        setEndedNotice(result.landlordWon ? "地主获胜" : "农民获胜");
      }
    }

    function onZjhGameEnded({ result, message }: { result?: ZjhRoundResult; message?: string }) {
      if (message) {
        setZjhEndedNotice(message);
      } else if (result) {
        setZjhEndedNotice(`${result.winnerNickname} 赢得本局`);
      }
    }

    function onDaBanZiGameEnded({ result, message }: { result?: DaBanZiRoundResult; message?: string }) {
      if (message) {
        setDaBanZiEndedNotice(message);
      } else if (result) {
        setDaBanZiEndedNotice(result.winnerLabel);
      }
    }

    function onChatState({ messages, onlineCount }: { messages: ChatMessage[]; onlineCount: number }) {
      setChatMessages(messages);
      setChatOnlineCount(onlineCount);
      setChatJoined(true);
    }

    function onChatMessage({ message }: { message: ChatMessage }) {
      setChatMessages((current) => [...current, message].slice(-50));
    }

    function onChatError({ code, message }: { code: string; message: string }) {
      if (["UNAUTHORIZED", "CHAT_JOIN_FAILED"].includes(code)) {
        setChatJoined(false);
      }
      setToast(message);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("zjh:room:state", onZjhRoomState);
    socket.on("dbz:room:state", onDaBanZiRoomState);
    socket.on("zjh:compare:reveal", onZjhCompareReveal);
    socket.on("game:error", onGameError);
    socket.on("game:ended", onGameEnded);
    socket.on("zjh:game:ended", onZjhGameEnded);
    socket.on("dbz:game:ended", onDaBanZiGameEnded);
    socket.on("chat:state", onChatState);
    socket.on("chat:message", onChatMessage);
    socket.on("chat:error", onChatError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("zjh:room:state", onZjhRoomState);
      socket.off("dbz:room:state", onDaBanZiRoomState);
      socket.off("zjh:compare:reveal", onZjhCompareReveal);
      socket.off("game:error", onGameError);
      socket.off("game:ended", onGameEnded);
      socket.off("zjh:game:ended", onZjhGameEnded);
      socket.off("dbz:game:ended", onDaBanZiGameEnded);
      socket.off("chat:state", onChatState);
      socket.off("chat:message", onChatMessage);
      socket.off("chat:error", onChatError);
    };
  }, [resetRoomSession]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!zjhCompareReveal) {
      return;
    }

    const timer = window.setTimeout(() => setZjhCompareReveal(null), 3200);
    return () => window.clearTimeout(timer);
  }, [zjhCompareReveal]);

  useEffect(() => {
    const storedToken = readStoredToken();
    if (!storedToken) {
      setAuthChecking(false);
      return;
    }

    let cancelled = false;
    requestJson<AuthMeResponse>("/api/auth/me", {
      method: "GET",
      headers: authHeaders(storedToken)
    })
      .then(({ profile }) => {
        if (cancelled) {
          return;
        }
        setAuthProfile(profile);
        setAuthToken(storedToken);
        setNickname(profile.nickname);
        setActiveView("hall");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        clearStoredAuth();
        setAuthProfile(null);
        setAuthToken("");
        setNickname("");
        setActiveView("login");
        setChatMessages([]);
        setChatOnlineCount(0);
        setChatJoined(false);
        setChatDraft("");
        setGameChatOpen(false);
        setToast(error instanceof Error ? error.message : "登录已过期，请重新登录。");
      })
      .finally(() => {
        if (!cancelled) {
          setAuthChecking(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authProfile || !authToken || !connected) {
      if (!connected) {
        setChatJoined(false);
      }
      return;
    }

    socket.emit("chat:join", { token: authToken });
  }, [authProfile, authToken, connected]);

  const self = useMemo(() => room?.players.find((player) => player.seat === room.selfSeat), [room]);
  const selfHand = self?.hand ?? [];
  const selectedCards = selfHand.filter((card) => selectedIds.has(card.id));
  const activeSeat = room?.phase === "bidding" ? room.bidCurrentSeat ?? room.currentTurn : room?.currentTurn;
  const opponents = useMemo(() => {
    if (!room || room.selfSeat === undefined) {
      return room?.players.filter((player) => player.seat !== room?.selfSeat) ?? [];
    }

    return [((room.selfSeat + 2) % 3) as PlayerSeat, ((room.selfSeat + 1) % 3) as PlayerSeat]
      .map((seat) => room.players.find((player) => player.seat === seat))
      .filter((player): player is PlayerView => Boolean(player));
  }, [room]);
  const waitingOpponentSlots = Math.max(0, 2 - opponents.length);

  function completeLogin(profile: AuthProfile, token: string, remember: boolean) {
    const cleanProfile = { ...profile, nickname: profile.nickname.trim() };
    roomRef.current = null;
    zjhRoomRef.current = null;
    daBanZiRoomRef.current = null;
    clearStoredRoomSession();
    setAuthProfile(cleanProfile);
    setAuthToken(token);
    setActiveView("hall");
    setNickname(cleanProfile.nickname);
    setRoom(null);
    setZjhRoom(null);
    setDaBanZiRoom(null);
    if (remember) {
      localStorage.setItem("doudizhu:nickname", cleanProfile.nickname);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(cleanProfile));
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    } else {
      clearStoredAuth();
    }
    setToast("");
  }

  async function loginWithAccount({ account, password, remember }: LoginPayload) {
    const trimmed = account.trim();
    if (!trimmed) {
      setToast("请输入手机号 / 游戏账号。");
      return;
    }
    if (!password) {
      setToast("请输入密码。");
      return;
    }

    setAuthBusy(true);
    try {
      const result = await requestJson<AuthResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ account: trimmed, password })
      });
      completeLogin(result.profile, result.token, remember);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "登录失败。");
    } finally {
      setAuthBusy(false);
    }
  }

  async function registerAccount(payload: RegisterPayload, remember: boolean) {
    setAuthBusy(true);
    try {
      const result = await requestJson<AuthResponse>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      completeLogin(result.profile, result.token, remember);
      setToast("注册成功，已登录。");
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "注册失败。");
      return false;
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    socket.emit("chat:leave");
    if (room) {
      suppressRoomStateRef.current = true;
      socket.emit("room:leave");
    }
    if (zjhRoom) {
      suppressZjhRoomStateRef.current = true;
      socket.emit("zjh:room:leave");
    }
    if (daBanZiRoom) {
      suppressDaBanZiRoomStateRef.current = true;
      socket.emit("dbz:room:leave");
    }
    if (authToken) {
      requestJson<{ ok: boolean }>("/api/auth/logout", {
        method: "POST",
        headers: authHeaders(authToken),
        body: JSON.stringify({})
      }).catch(() => undefined);
    }

    setAuthProfile(null);
    setAuthToken("");
    setActiveView("login");
    roomRef.current = null;
    zjhRoomRef.current = null;
    daBanZiRoomRef.current = null;
    setRoom(null);
    setZjhRoom(null);
    setDaBanZiRoom(null);
    setSelectedIds(new Set());
    setRoomCodeInput("");
    setNickname("");
    setEndedNotice("");
    setZjhEndedNotice("");
    setDaBanZiEndedNotice("");
    setLeaveConfirmOpen(false);
    setChatMessages([]);
    setChatOnlineCount(0);
    setChatJoined(false);
    setChatDraft("");
    setGameChatOpen(false);
    clearStoredRoomSession();
    clearStoredAuth();
    setToast("已退出登录。");
  }

  function leaveRoom() {
    setLeaveConfirmOpen(false);
    if (activeView === "da_ban_zi" || daBanZiRoom) {
      suppressDaBanZiRoomStateRef.current = true;
      socket.emit("dbz:room:leave");
    } else if (activeView === "zha_jin_hua" || zjhRoom) {
      suppressZjhRoomStateRef.current = true;
      socket.emit("zjh:room:leave");
    } else {
      suppressRoomStateRef.current = true;
      socket.emit("room:leave");
    }
    resetRoomSession("已离开房间。");
  }

  function requestLeaveRoom() {
    if (
      room?.phase === "bidding" ||
      room?.phase === "playing" ||
      zjhRoom?.phase === "playing" ||
      (daBanZiRoom && daBanZiRoom.phase !== "lobby" && daBanZiRoom.phase !== "ended")
    ) {
      setLeaveConfirmOpen(true);
      return;
    }

    leaveRoom();
  }

  function ensureNickname(): string | null {
    const trimmed = nickname.trim();
    if (!trimmed) {
      setToast("请先输入昵称。");
      return null;
    }

    return trimmed;
  }

  function createRoom() {
    const name = ensureNickname();
    if (!name) {
      return;
    }
    if (selectedGame === "zha_jin_hua") {
      suppressZjhRoomStateRef.current = false;
      socket.emit("zjh:room:create", { nickname: name, maxPlayers: zjhMaxPlayers });
      return;
    }
    if (selectedGame === "da_ban_zi") {
      suppressDaBanZiRoomStateRef.current = false;
      socket.emit("dbz:room:create", { nickname: name });
      return;
    }

    suppressRoomStateRef.current = false;
    socket.emit("room:create", { nickname: name });
  }

  function joinRoom() {
    const name = ensureNickname();
    const roomCode = roomCodeInput.trim().toUpperCase();
    if (!name) {
      return;
    }
    if (!roomCode) {
      setToast("请输入房间号。");
      return;
    }
    if (selectedGame === "zha_jin_hua") {
      suppressZjhRoomStateRef.current = false;
      socket.emit("zjh:room:join", { roomCode, nickname: name });
      return;
    }
    if (selectedGame === "da_ban_zi") {
      suppressDaBanZiRoomStateRef.current = false;
      socket.emit("dbz:room:join", { roomCode, nickname: name });
      return;
    }

    suppressRoomStateRef.current = false;
    socket.emit("room:join", { roomCode, nickname: name });
  }

  function chooseBid(score: BidScore) {
    socket.emit("bid:choose", { score });
  }

  function toggleCard(cardId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }

  function playSelected() {
    socket.emit("play:cards", { cardIds: [...selectedIds] });
  }

  function playDaBanZiSelected() {
    socket.emit("dbz:play:cards", { cardIds: [...selectedIds] });
  }

  function copyRoomCode() {
    const code = room?.roomCode ?? zjhRoom?.roomCode ?? daBanZiRoom?.roomCode;
    if (!code) {
      return;
    }

    navigator.clipboard
      ?.writeText(code)
      .then(() => setToast("房间号已复制。"))
      .catch(() => setToast("复制失败，请手动选择房间号。"));
  }

  function sendChatMessage() {
    const text = chatDraft.trim();
    if (!text) {
      setToast("请输入聊天内容。");
      return;
    }
    if (!chatJoined) {
      setToast("大厅聊天正在连接，请稍后再试。");
      return;
    }

    socket.emit("chat:send", { text });
    setChatDraft("");
  }

  if (authChecking) {
    return (
      <main className="login-page auth-checking-page" aria-label="验证登录状态">
        <section className="login-card-panel auth-checking-panel">
          <div className="login-card-heading">
            <Play size={28} aria-hidden="true" />
            <div>
              <h2>正在验证登录状态</h2>
              <p>请稍候，正在连接本机账号服务。</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (!authProfile || activeView === "login") {
    return (
      <>
        <LoginPage
          connected={connected}
          initialAccount={authProfile?.account ?? ""}
          isBusy={authBusy}
          onLogin={loginWithAccount}
          onRegister={registerAccount}
          onInfo={setToast}
        />
        <Toast message={toast} />
      </>
    );
  }

  if (activeView === "hall" || (!room && !zjhRoom && !daBanZiRoom)) {
    return (
      <>
        <GameHall
          profile={authProfile}
          connected={connected}
          selectedGame={selectedGame}
          zjhMaxPlayers={zjhMaxPlayers}
          roomCodeInput={roomCodeInput}
          onGameSelect={setSelectedGame}
          onZjhMaxPlayersChange={setZjhMaxPlayers}
          onRoomCodeInputChange={setRoomCodeInput}
          onCreateRoom={createRoom}
          onJoinRoom={joinRoom}
          onUnavailable={(gameName) => setToast(`${gameName} 敬请期待。`)}
          onInfo={setToast}
          onLogout={logout}
          chatMessages={chatMessages}
          chatOnlineCount={chatOnlineCount}
          chatJoined={chatJoined}
          chatDraft={chatDraft}
          onChatDraftChange={setChatDraft}
          onSendChat={sendChatMessage}
        />
        <Toast message={toast} />
      </>
    );
  }

  if (activeView === "zha_jin_hua" && zjhRoom) {
    return (
      <div className="zjh-game-shell">
        <ZhaJinHuaTable
          room={zjhRoom}
          connected={connected}
          notice={zjhEndedNotice}
          compareReveal={zjhCompareReveal}
          onReady={() => socket.emit("zjh:game:ready")}
          onSee={() => socket.emit("zjh:action:see")}
          onCall={() => socket.emit("zjh:action:call")}
          onRaise={(amount) => socket.emit("zjh:action:raise", { amount })}
          onFold={() => socket.emit("zjh:action:fold")}
          onCompare={(targetSeat) => socket.emit("zjh:action:compare", { targetSeat })}
          onCopyRoomCode={copyRoomCode}
          onLeave={requestLeaveRoom}
          onInfo={setToast}
        />
        {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
        <GameChatDock
          open={gameChatOpen}
          messages={chatMessages}
          onlineCount={chatOnlineCount}
          joined={chatJoined}
          connected={connected}
          account={authProfile.account}
          draft={chatDraft}
          onDraftChange={setChatDraft}
          onSend={sendChatMessage}
          onToggle={() => setGameChatOpen((current) => !current)}
        />
        <Toast message={toast} />
      </div>
    );
  }

  if (activeView === "da_ban_zi" && daBanZiRoom) {
    return (
      <div className="dbz-game-shell">
        <DaBanZiTable
          room={daBanZiRoom}
          connected={connected}
          notice={daBanZiEndedNotice}
          selectedIds={selectedIds}
          onToggleCard={toggleCard}
          onReady={() => socket.emit("dbz:game:ready")}
          onBaoChoose={(action) => socket.emit("dbz:bao:choose", { action })}
          onPartnerCall={(option: DaBanZiPartnerCallOption) =>
            socket.emit("dbz:partner:call", { rank: option.rank, suit: option.suit })
          }
          onPlay={playDaBanZiSelected}
          onPass={() => socket.emit("dbz:play:pass")}
          onCopyRoomCode={copyRoomCode}
          onLeave={requestLeaveRoom}
          onInfo={setToast}
        />
        {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
        <GameChatDock
          open={gameChatOpen}
          messages={chatMessages}
          onlineCount={chatOnlineCount}
          joined={chatJoined}
          connected={connected}
          account={authProfile.account}
          draft={chatDraft}
          onDraftChange={setChatDraft}
          onSend={sendChatMessage}
          onToggle={() => setGameChatOpen((current) => !current)}
        />
        <Toast message={toast} />
      </div>
    );
  }

  if (!room) {
    return <Toast message={toast} />;
  }

  const isMyTurn = activeSeat === room.selfSeat;
  const canPass = Boolean(room.lastPlay?.seat !== undefined && room.lastPlay.seat !== room.selfSeat);

  return (
    <div className="zen-game-shell">
      <header className={`zen-game-header ${gameHeaderCollapsed ? "is-collapsed" : ""}`}>
        <div className="zen-header-left">
          <strong className="zen-brand-title">云上棋牌室</strong>
          <button
            className="zen-header-toggle"
            type="button"
            aria-controls="zen-header-controls"
            aria-expanded={!gameHeaderCollapsed}
            onClick={() => setGameHeaderCollapsed((current) => !current)}
          >
            {gameHeaderCollapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
            {gameHeaderCollapsed ? "展开" : "收起"}
          </button>
          <span className="zen-mobile-summary">
            房间 {room.roomCode} · {getPhaseLabel(room)} · x{room.multiplier}
          </span>
          <span className="zen-header-divider" aria-hidden="true" />
          <div className="zen-room-pills" aria-label="房间状态">
            <span className="zen-pill room">
              <span>房间</span>
              <strong>{room.roomCode}</strong>
              <button className="zen-copy-button" type="button" onClick={copyRoomCode} aria-label="复制房间号">
                <Clipboard size={16} aria-hidden="true" />
              </button>
            </span>
            <span className="zen-pill">阶段 {getPhaseLabel(room)}</span>
            <span className="zen-pill">最高 {room.highestBidScore > 0 ? `${room.highestBidScore}分` : "未叫"}</span>
            <span className="zen-pill">倍数 x{room.multiplier}</span>
          </div>
        </div>

        <div className="zen-header-actions" id="zen-header-controls">
          <ConnectionPill connected={connected} />
          <button className="zen-icon-button" type="button" onClick={() => setToast("通知中心将在正式版开放。")} aria-label="通知">
            <Bell size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={() => setToast("设置将在正式版开放。")} aria-label="设置">
            <Settings size={18} aria-hidden="true" />
          </button>
          <button className="zen-icon-button" type="button" onClick={() => setToast("帮助中心将在正式版开放。")} aria-label="帮助">
            <HelpCircle size={18} aria-hidden="true" />
          </button>
          <button className="zen-leave-button" type="button" onClick={requestLeaveRoom}>
            <LogOut size={18} aria-hidden="true" />
            离开
          </button>
        </div>
      </header>

      {!connected && <div className="zen-offline-banner">连接已断开，请检查本地服务或刷新后重新进入房间。</div>}

      <main className="zen-game-main">
        <section className={`zen-table phase-${room.phase}`} aria-label="斗地主牌桌">
          <section className="zen-opponents-row" aria-label="其他玩家">
            {opponents.map((player) => (
              <SeatPanel
                key={player.seat}
                player={player}
                label={seatName(player.seat, room.selfSeat)}
                active={activeSeat === player.seat}
                result={room.result}
              />
            ))}
            {Array.from({ length: waitingOpponentSlots }).map((_, index) => (
              <EmptySeats key={`waiting-${index}`} />
            ))}
          </section>

          <section className="zen-center-zone" aria-label="牌桌中央">
            <div className="zen-bottom-cards">
              <span>底牌</span>
              <div className="mini-card-row zen-bottom-card-row">
                {room.bottomCards.length > 0
                  ? room.bottomCards.map((card) => <CardView key={card.id} card={card} compact />)
                  : Array.from({ length: room.hiddenBottomCount }).map((_, index) => <CardBack key={index} compact />)}
              </div>
            </div>

            <div className="zen-last-play">
              <span>上一手</span>
              {room.lastPlay ? (
                <>
                  <strong>
                    {room.lastPlay.nickname} · {room.lastPlay.label}
                  </strong>
                  <div className="mini-card-row zen-last-card-row">
                    {room.lastPlay.cards?.map((card) => <CardView key={card.id} card={card} compact />)}
                  </div>
                </>
              ) : (
                <strong>新一轮</strong>
              )}
            </div>

            <div className="zen-message-strip">{room.message}</div>
          </section>

          <div className="zen-actions" aria-label="操作区">
            <ActionBar
              room={room}
              self={self}
              isMyTurn={isMyTurn}
              selectedCount={selectedCards.length}
              canPass={canPass}
              onReady={() => socket.emit("game:ready")}
              onBid={chooseBid}
              onPlay={playSelected}
              onPass={() => socket.emit("play:pass")}
              onClear={() => setSelectedIds(new Set())}
            />
          </div>

          <section className="zen-hand-area" aria-label="我的手牌">
            <div className="zen-hand-layout">
              {selfHand.length > 0 && (
                <div className="hand-grid zen-hand-grid">
                  {selfHand.map((card) => (
                    <CardView
                      key={card.id}
                      card={card}
                      selected={selectedIds.has(card.id)}
                      onClick={() => toggleCard(card.id)}
                    />
                  ))}
                </div>
              )}
              <div className="zen-hand-count" aria-label={`剩余 ${self?.cardCount ?? 0} 张手牌`}>
                <strong>{self?.cardCount ?? 0}</strong>
                <span>张手牌</span>
              </div>
            </div>
          </section>
        </section>
      </main>

      {room.phase === "ended" && <ResultDialog room={room} notice={endedNotice} />}
      {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
      <GameChatDock
        open={gameChatOpen}
        messages={chatMessages}
        onlineCount={chatOnlineCount}
        joined={chatJoined}
        connected={connected}
        account={authProfile.account}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        onSend={sendChatMessage}
        onToggle={() => setGameChatOpen((current) => !current)}
      />
      <Toast message={toast} />
    </div>
  );
}

function ConnectionPill({ connected }: { connected: boolean }) {
  return <span className={`connection-pill ${connected ? "online" : "offline"}`}>{connected ? "已连接" : "离线"}</span>;
}

function EmptySeats() {
  return (
    <div className="empty-seats">
      <Users size={22} aria-hidden="true" />
      等待玩家入座
    </div>
  );
}

function SeatPanel({
  player,
  label,
  active,
  result,
  compact = false
}: {
  player: PlayerView;
  label: string;
  active: boolean;
  result?: RoundResult;
  compact?: boolean;
}) {
  const score = result?.scores[player.seat] ?? 0;

  return (
    <article
      className={`seat-panel ${active ? "active" : ""} ${compact ? "compact" : ""} ${player.isLandlord ? "landlord" : ""} ${
        player.connected ? "" : "offline"
      }`}
    >
      <div className="seat-title">
        <span>{label}</span>
        {player.isLandlord && (
          <span className="role-badge">
            <Crown size={14} aria-hidden="true" />
            地主
          </span>
        )}
      </div>
      <strong>{player.nickname}</strong>
      <div className="seat-stats">
        <span>{player.cardCount} 张</span>
        <span>{player.connected ? "在线" : "离线"}</span>
        {result && <span className={score >= 0 ? "score plus" : "score minus"}>{formatScore(result, player.seat)}</span>}
      </div>
      {player.lastAction && <p>{player.lastAction}</p>}
    </article>
  );
}

function ActionBar({
  room,
  self,
  isMyTurn,
  selectedCount,
  canPass,
  onReady,
  onBid,
  onPlay,
  onPass,
  onClear
}: {
  room: RoomView;
  self?: PlayerView;
  isMyTurn: boolean;
  selectedCount: number;
  canPass: boolean;
  onReady: () => void;
  onBid: (score: BidScore) => void;
  onPlay: () => void;
  onPass: () => void;
  onClear: () => void;
}) {
  if (room.phase === "lobby") {
    return (
      <div className="actions action-card">
        <button className="primary-btn" type="button" onClick={onReady} disabled={self?.ready}>
          <Play size={18} aria-hidden="true" />
          {self?.ready ? "已准备" : "准备"}
        </button>
      </div>
    );
  }

  if (room.phase === "bidding") {
    if (!isMyTurn) {
      return <div className="waiting-text">等待玩家叫分</div>;
    }

    return (
      <div className="actions action-card" aria-label="叫分操作">
        <button type="button" onClick={() => onBid(0)}>
          <CircleSlash size={18} aria-hidden="true" />
          不叫
        </button>
        {[1, 2, 3].map((score) => (
          <button
            className={score === 3 ? "primary-btn" : ""}
            type="button"
            key={score}
            onClick={() => onBid(score as BidScore)}
            disabled={score <= room.highestBidScore}
          >
            <Crown size={18} aria-hidden="true" />
            {score}分
          </button>
        ))}
      </div>
    );
  }

  if (room.phase === "playing") {
    if (!isMyTurn) {
      return <div className="waiting-text">等待对手出牌</div>;
    }

    return (
      <div className="actions action-card" aria-label="出牌操作">
        <button className="primary-btn" type="button" onClick={onPlay} disabled={selectedCount === 0}>
          <Send size={18} aria-hidden="true" />
          出牌
        </button>
        <button type="button" onClick={onPass} disabled={!canPass}>
          <CircleSlash size={18} aria-hidden="true" />
          不出
        </button>
        <button className="ghost-btn" type="button" onClick={onClear} disabled={selectedCount === 0}>
          清空选择
        </button>
      </div>
    );
  }

  return (
    <div className="actions action-card">
      <button className="primary-btn" type="button" onClick={onReady}>
        <Play size={18} aria-hidden="true" />
        再来一局
      </button>
    </div>
  );
}

function CardView({
  card,
  selected = false,
  compact = false,
  onClick
}: {
  card: Card;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="card-corner">
        <span className="card-rank">{card.label}</span>
        <span className="card-suit">{card.suitSymbol}</span>
      </span>
      <span className="card-center-suit">{card.suit === "joker" ? card.label : card.suitSymbol}</span>
    </>
  );

  if (!onClick) {
    return <div className={`playing-card ${card.color} ${compact ? "compact" : ""}`}>{content}</div>;
  }

  return (
    <button
      className={`playing-card selectable ${card.color} ${selected ? "selected" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${selected ? "取消选择" : "选择"} ${card.label}${card.suit === "joker" ? "" : card.suitSymbol}`}
    >
      {content}
    </button>
  );
}

function CardBack({ compact = false }: { compact?: boolean }) {
  return <div className={`card-back ${compact ? "compact" : ""}`} aria-hidden="true" />;
}

function ResultDialog({ room, notice }: { room: RoomView; notice: string }) {
  const result = room.result;
  const title = notice || (result ? (result.landlordWon ? "地主获胜" : "农民获胜") : room.message ?? "本局结束");

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="result-title">
      <section className="result-dialog">
        <h2 id="result-title">{title}</h2>
        {result && <p>最终倍数 x{result.multiplier}</p>}
        <div className="result-list">
          {room.players.map((player) => (
            <div className="result-row" key={player.seat}>
              <span>
                {player.nickname}
                {player.isLandlord ? " · 地主" : " · 农民"}
              </span>
              <strong className={result && result.scores[player.seat] >= 0 ? "score plus" : "score minus"}>
                {formatScore(result, player.seat)}
              </strong>
            </div>
          ))}
        </div>
        <button className="primary-btn" type="button" onClick={() => socket.emit("game:ready")}>
          <Play size={18} aria-hidden="true" />
          再来一局
        </button>
      </section>
    </div>
  );
}

function LeaveConfirmDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title">
      <section className="leave-confirm-dialog">
        <div className="leave-confirm-icon" aria-hidden="true">
          <LogOut size={26} />
        </div>
        <h2 id="leave-confirm-title">确认离开本局？</h2>
        <p>当前正在对局中，离开会结束你在本局的参与，并可能影响其他玩家的牌局。</p>
        <div className="leave-confirm-actions">
          <button className="primary-btn" type="button" onClick={onCancel}>
            继续游戏
          </button>
          <button className="danger-btn" type="button" onClick={onConfirm}>
            <LogOut size={18} aria-hidden="true" />
            确认离开
          </button>
        </div>
      </section>
    </div>
  );
}

function GameChatDock({
  open,
  messages,
  onlineCount,
  joined,
  connected,
  account,
  draft,
  onDraftChange,
  onSend,
  onToggle
}: {
  open: boolean;
  messages: ChatMessage[];
  onlineCount: number;
  joined: boolean;
  connected: boolean;
  account: string;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onToggle: () => void;
}) {
  const messagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const node = messagesRef.current;
    if (!node) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, open]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSend();
  }

  return (
    <aside className={`game-chat-dock ${open ? "open" : ""}`} aria-label="大厅聊天">
      <button className="game-chat-toggle" type="button" aria-expanded={open} onClick={onToggle}>
        <Send size={18} aria-hidden="true" />
        大厅聊天
        <span>{joined ? `${onlineCount}人` : "连接中"}</span>
      </button>
      {open && (
        <section className="game-chat-panel">
          <div className="game-chat-head">
            <strong>大厅聊天</strong>
            <span>{joined ? `${onlineCount} 人在线` : "正在连接"}</span>
          </div>
          <div className="game-chat-messages" ref={messagesRef}>
            {messages.length > 0 ? (
              messages.map((message) => (
                <p className={`game-chat-message ${message.account === account ? "from-self" : ""}`} key={message.id}>
                  <span>
                    <strong>{message.nickname}</strong>
                    <time>{formatChatTime(message.at)}</time>
                  </span>
                  {message.text}
                </p>
              ))
            ) : (
              <p className="game-chat-message">
                <span>
                  <strong>系统</strong>
                </span>
                暂无消息，发一句招呼吧。
              </p>
            )}
          </div>
          <form className="game-chat-form" onSubmit={handleSubmit}>
            <input
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder="发一句消息"
              aria-label="大厅聊天消息"
              maxLength={120}
              disabled={!connected || !joined}
            />
            <button type="submit" aria-label="发送消息" disabled={!connected || !joined || !draft.trim()}>
              <Send size={18} aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
    </aside>
  );
}

function formatChatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function Toast({ message }: { message: string }) {
  return message ? (
    <div className="toast" role="status">
      {message}
    </div>
  ) : null;
}
