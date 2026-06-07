import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analyzeHand, validatePlay } from "@doudizhu/shared";
import {
  Bell,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clipboard,
  Crown,
  HelpCircle,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Send,
  Settings,
  Users
} from "lucide-react";
import {
  Room as LiveKitRoom,
  RoomEvent,
  Track,
  ParticipantEvent,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication
} from "livekit-client";
import type {
  BidScore,
  Card,
  ChatMessage,
  DaBanZiPartnerCallOption,
  DaBanZiRoomView,
  DaBanZiRoundResult,
  GameKind,
  GameSessionRecord,
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
import { AdminPage } from "./pages/AdminPage.js";
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

function copyTextWithSelection(text: string) {
  const textarea = document.createElement("textarea");
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers that expose Clipboard API but deny it at runtime.
    }
  }

  return copyTextWithSelection(text);
}

interface AuthResponse {
  token: string;
  profile: AuthProfile;
}

interface AuthMeResponse {
  profile: AuthProfile;
}

interface VoiceTokenResponse {
  url: string;
  token: string;
  roomName: string;
  participantName: string;
}

interface GameRecordsResponse {
  records: GameSessionRecord[];
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
  const text = await response.text();
  let body: { code?: string; message?: string } = {};
  if (text) {
    try {
      body = JSON.parse(text) as { code?: string; message?: string };
    } catch {
      body = { code: "INVALID_RESPONSE", message: "服务器返回了无效响应，请确认后端服务正在运行。" };
    }
  }

  if (!response.ok) {
    throw new ApiException(body.code ?? "REQUEST_FAILED", body.message ?? "请求失败，请稍后再试。");
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
  const isAdminRoute = window.location.pathname.startsWith("/admin");
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
  const [gameChatUnreadCount, setGameChatUnreadCount] = useState(0);
  const [gameRecords, setGameRecords] = useState<GameSessionRecord[]>([]);
  const [gameRecordsOpen, setGameRecordsOpen] = useState(false);
  const [gameRecordsBusy, setGameRecordsBusy] = useState(false);
  const [gameRecordsError, setGameRecordsError] = useState("");
  const roomRef = useRef<RoomView | null>(null);
  const zjhRoomRef = useRef<ZjhRoomView | null>(null);
  const daBanZiRoomRef = useRef<DaBanZiRoomView | null>(null);
  const activeViewRef = useRef<ActiveView>(activeView);
  const gameChatOpenRef = useRef(gameChatOpen);
  const authAccountRef = useRef(authProfile?.account ?? "");
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

  const clearAuthSession = useCallback((message?: string) => {
    socket.emit("chat:leave");
    const hadRoom = Boolean(roomRef.current);
    const hadZjhRoom = Boolean(zjhRoomRef.current);
    const hadDaBanZiRoom = Boolean(daBanZiRoomRef.current);
    roomRef.current = null;
    zjhRoomRef.current = null;
    daBanZiRoomRef.current = null;
    if (hadRoom) {
      suppressRoomStateRef.current = true;
      socket.emit("room:leave");
    }
    if (hadZjhRoom) {
      suppressZjhRoomStateRef.current = true;
      socket.emit("zjh:room:leave");
    }
    if (hadDaBanZiRoom) {
      suppressDaBanZiRoomStateRef.current = true;
      socket.emit("dbz:room:leave");
    }
    clearStoredAuth();
    clearStoredRoomSession();
    setAuthProfile(null);
    setAuthToken("");
    setNickname("");
    setActiveView("login");
    setRoom(null);
    setZjhRoom(null);
    setDaBanZiRoom(null);
    setSelectedIds(new Set());
    setEndedNotice("");
    setZjhEndedNotice("");
    setDaBanZiEndedNotice("");
    setChatMessages([]);
    setChatOnlineCount(0);
    setChatJoined(false);
    setChatDraft("");
    setGameChatOpen(false);
    setGameChatUnreadCount(0);
    setGameRecords([]);
    setGameRecordsOpen(false);
    setGameRecordsBusy(false);
    setGameRecordsError("");
    setLeaveConfirmOpen(false);
    if (message) {
      setToast(message);
    }
  }, []);

  const refreshGameRecords = useCallback(async () => {
    if (!authToken) {
      setGameRecords([]);
      return;
    }

    setGameRecordsBusy(true);
    setGameRecordsError("");
    try {
      const result = await requestJson<GameRecordsResponse>("/api/game-records?limit=30", {
        method: "GET",
        headers: authHeaders(authToken)
      });
      setGameRecords(result.records);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取游戏记录失败。";
      setGameRecordsError(message);
      setToast(message);
    } finally {
      setGameRecordsBusy(false);
    }
  }, [authToken]);

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
    activeViewRef.current = activeView;
    if (activeView === "hall" || activeView === "login") {
      setGameChatUnreadCount(0);
    }
  }, [activeView]);

  useEffect(() => {
    gameChatOpenRef.current = gameChatOpen;
    if (gameChatOpen) {
      setGameChatUnreadCount(0);
    }
  }, [gameChatOpen]);

  useEffect(() => {
    authAccountRef.current = authProfile?.account ?? "";
  }, [authProfile?.account]);

  useEffect(() => {
    function onConnect() {
      setConnected(true);
    }

    function onDisconnect() {
      setConnected(false);
      if (roomRef.current || zjhRoomRef.current || daBanZiRoomRef.current) {
        setToast("连接已断开，正在尝试重连房间。");
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
      if (
        !gameChatOpenRef.current &&
        activeViewRef.current !== "hall" &&
        activeViewRef.current !== "login" &&
        message.account !== authAccountRef.current
      ) {
        setGameChatUnreadCount((count) => Math.min(count + 1, 99));
      }
    }

    function onChatError({ code, message }: { code: string; message: string }) {
      if (["UNAUTHORIZED", "CHAT_JOIN_FAILED"].includes(code)) {
        setChatJoined(false);
      }
      if (code === "SESSION_REPLACED") {
        clearAuthSession(message);
        return;
      }
      setToast(message);
    }

    function onAuthSessionReplaced({ message }: { message: string }) {
      clearAuthSession(message);
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
    socket.on("auth:session_replaced", onAuthSessionReplaced);

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
      socket.off("auth:session_replaced", onAuthSessionReplaced);
    };
  }, [clearAuthSession, resetRoomSession]);

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
        setGameRecords([]);
        setGameRecordsOpen(false);
        setGameRecordsBusy(false);
        setGameRecordsError("");
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

    socket.emit("auth:bind", { token: authToken });
    socket.emit("chat:join", { token: authToken });
  }, [authProfile, authToken, connected]);

  useEffect(() => {
    if (!authToken || activeView !== "hall") {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshGameRecords();
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeView, authToken, refreshGameRecords]);

  const self = useMemo(() => room?.players.find((player) => player.seat === room.selfSeat), [room]);
  const selfHand = self?.hand ?? [];
  const selectedCards = selfHand.filter((card) => selectedIds.has(card.id));
  const daBanZiSelf = useMemo(
    () => daBanZiRoom?.players.find((player) => player.seat === daBanZiRoom.selfSeat),
    [daBanZiRoom]
  );
  const daBanZiSelfHand = daBanZiSelf?.hand ?? [];
  const daBanZiSelectedCards = daBanZiSelfHand.filter((card) => selectedIds.has(card.id));
  const selectableHandIdKey = useMemo(() => {
    const currentHand =
      activeView === "da_ban_zi" ? daBanZiSelfHand : activeView === "doudizhu" ? selfHand : [];
    return currentHand.map((card) => card.id).join("|");
  }, [activeView, daBanZiSelfHand, selfHand]);
  const previousPlayAnalysis = useMemo(() => {
    if (!room?.lastPlay?.cards?.length) {
      return undefined;
    }

    return analyzeHand(room.lastPlay.cards) ?? undefined;
  }, [room?.lastPlay?.cards]);
  const selectedPlayValidation = useMemo(() => {
    if (selectedCards.length === 0) {
      return null;
    }

    return validatePlay(selectedCards, previousPlayAnalysis);
  }, [previousPlayAnalysis, selectedCards]);
  const canPlaySelection = selectedPlayValidation?.ok ?? false;
  const selectedPlayHint =
    selectedCards.length === 0
      ? ""
      : selectedPlayValidation?.ok
        ? `${selectedPlayValidation.analysis.label} · ${selectedCards.length} 张，可出`
        : selectedPlayValidation?.reason ?? "这组牌暂时不能出。";
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

  useEffect(() => {
    const validIds = new Set(selectableHandIdKey ? selectableHandIdKey.split("|") : []);

    setSelectedIds((current) => {
      if (current.size === 0) {
        return current;
      }

      const next = new Set([...current].filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [selectableHandIdKey]);

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
    setGameRecords([]);
    setGameRecordsOpen(false);
    setGameRecordsError("");
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
    setGameRecords([]);
    setGameRecordsOpen(false);
    setGameRecordsBusy(false);
    setGameRecordsError("");
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
    socket.emit("play:cards", { cardIds: selectedCards.map((card) => card.id) });
  }

  function playDaBanZiSelected() {
    socket.emit("dbz:play:cards", { cardIds: daBanZiSelectedCards.map((card) => card.id) });
  }

  async function copyRoomCode() {
    const code = room?.roomCode ?? zjhRoom?.roomCode ?? daBanZiRoom?.roomCode;
    if (!code) {
      return;
    }

    const copied = await copyTextToClipboard(code);
    setToast(copied ? "房间号已复制。" : "复制失败，请手动选择房间号。");
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

  function toggleGameChat() {
    setGameChatOpen((current) => !current);
  }

  function toggleGameRecords() {
    setGameRecordsOpen((current) => {
      const next = !current;
      if (next) {
        void refreshGameRecords();
      }
      return next;
    });
  }

  if (isAdminRoute) {
    return <AdminPage />;
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
          gameRecords={gameRecords}
          gameRecordsOpen={gameRecordsOpen}
          gameRecordsBusy={gameRecordsBusy}
          gameRecordsError={gameRecordsError}
          onToggleGameRecords={toggleGameRecords}
          onRefreshGameRecords={refreshGameRecords}
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
          voiceDock={
            <GameVoiceDock
              authToken={authToken}
              gameKind="zha_jin_hua"
              roomCode={zjhRoom.roomCode}
              connected={connected}
              onInfo={setToast}
            />
          }
        />
        {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
        <GameChatDock
          open={gameChatOpen}
          unreadCount={gameChatUnreadCount}
          messages={chatMessages}
          onlineCount={chatOnlineCount}
          joined={chatJoined}
          connected={connected}
          account={authProfile.account}
          draft={chatDraft}
          onDraftChange={setChatDraft}
          onSend={sendChatMessage}
          onToggle={toggleGameChat}
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
          voiceDock={
            <GameVoiceDock
              authToken={authToken}
              gameKind="da_ban_zi"
              roomCode={daBanZiRoom.roomCode}
              connected={connected}
              onInfo={setToast}
            />
          }
        />
        {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
        <GameChatDock
          open={gameChatOpen}
          unreadCount={gameChatUnreadCount}
          messages={chatMessages}
          onlineCount={chatOnlineCount}
          joined={chatJoined}
          connected={connected}
          account={authProfile.account}
          draft={chatDraft}
          onDraftChange={setChatDraft}
          onSend={sendChatMessage}
          onToggle={toggleGameChat}
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
              canPlaySelection={canPlaySelection}
              selectedHint={selectedPlayHint}
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
          <GameVoiceDock
            authToken={authToken}
            gameKind="doudizhu"
            roomCode={room.roomCode}
            connected={connected}
            onInfo={setToast}
          />
        </section>
      </main>

      {room.phase === "ended" && <ResultDialog room={room} notice={endedNotice} />}
      {leaveConfirmOpen && <LeaveConfirmDialog onCancel={() => setLeaveConfirmOpen(false)} onConfirm={leaveRoom} />}
      <GameChatDock
        open={gameChatOpen}
        unreadCount={gameChatUnreadCount}
        messages={chatMessages}
        onlineCount={chatOnlineCount}
        joined={chatJoined}
        connected={connected}
        account={authProfile.account}
        draft={chatDraft}
        onDraftChange={setChatDraft}
        onSend={sendChatMessage}
        onToggle={toggleGameChat}
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
  canPlaySelection,
  selectedHint,
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
  canPlaySelection: boolean;
  selectedHint: string;
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
      <div className="play-action-stack action-card" aria-label="出牌操作">
        {selectedHint && (
          <div className={`play-selection-hint ${canPlaySelection ? "valid" : "invalid"}`} role="status">
            {selectedHint}
          </div>
        )}
        <div className="actions">
          <button className="primary-btn" type="button" onClick={onPlay} disabled={!canPlaySelection}>
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
  unreadCount,
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
  unreadCount: number;
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
        {unreadCount > 0 && (
          <b className="game-chat-unread" aria-label={`${unreadCount} 条未读消息`}>
            {unreadCount}
          </b>
        )}
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

const VOICE_AUDIO_OPTIONS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
};
const VOICE_INPUT_HOLD_MS = 360;

type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

function GameVoiceDock({
  authToken,
  gameKind,
  roomCode,
  connected,
  onInfo
}: {
  authToken: string;
  gameKind: GameKind;
  roomCode: string;
  connected: boolean;
  onInfo: (message: string) => void;
}) {
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const voiceRoomRef = useRef<LiveKitRoom | null>(null);
  const voiceInputTimerRef = useRef<number | undefined>(undefined);
  const cleanupLocalSpeakingListenerRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [voiceInputActive, setVoiceInputActive] = useState(false);

  const joined = status === "connected" || status === "reconnecting";

  function attachRemoteAudio(track: RemoteTrack, participant: RemoteParticipant) {
    if (track.kind !== Track.Kind.Audio) {
      return;
    }

    const element = track.attach();
    element.autoplay = true;
    element.muted = false;
    element.volume = 1;
    element.setAttribute("playsinline", "true");
    element.dataset.participantIdentity = participant.identity;
    element.style.display = "none";
    audioContainerRef.current?.appendChild(element);
    element.play?.().catch(() => undefined);
  }

  function attachExistingRemoteAudio(room: LiveKitRoom) {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.isSubscribed && publication.track) {
          attachRemoteAudio(publication.track, participant);
        }
      }
    }
  }

  function clearVoiceInputTimer() {
    if (voiceInputTimerRef.current === undefined) {
      return;
    }

    window.clearTimeout(voiceInputTimerRef.current);
    voiceInputTimerRef.current = undefined;
  }

  function holdVoiceInput() {
    clearVoiceInputTimer();
    setVoiceInputActive(true);
    voiceInputTimerRef.current = window.setTimeout(() => {
      voiceInputTimerRef.current = undefined;
      setVoiceInputActive(false);
    }, VOICE_INPUT_HOLD_MS);
  }

  function fadeVoiceInput() {
    clearVoiceInputTimer();
    voiceInputTimerRef.current = window.setTimeout(() => {
      voiceInputTimerRef.current = undefined;
      setVoiceInputActive(false);
    }, VOICE_INPUT_HOLD_MS);
  }

  function clearVoiceInputState() {
    clearVoiceInputTimer();
    setVoiceInputActive(false);
  }

  function stopLocalSpeakingListener() {
    cleanupLocalSpeakingListenerRef.current?.();
    cleanupLocalSpeakingListenerRef.current = null;
  }

  function startLocalSpeakingListener(room: LiveKitRoom) {
    stopLocalSpeakingListener();
    const participant = room.localParticipant;
    const handleSpeakingChanged = (speaking: boolean) => {
      if (speaking) {
        holdVoiceInput();
      } else {
        fadeVoiceInput();
      }
    };

    participant.on(ParticipantEvent.IsSpeakingChanged, handleSpeakingChanged);
    cleanupLocalSpeakingListenerRef.current = () => {
      participant.off(ParticipantEvent.IsSpeakingChanged, handleSpeakingChanged);
    };
  }

  function resetVoiceState(nextStatus: VoiceStatus = "idle") {
    stopLocalSpeakingListener();
    clearVoiceInputState();
    voiceRoomRef.current?.removeAllListeners();
    voiceRoomRef.current?.disconnect();
    voiceRoomRef.current = null;
    audioContainerRef.current?.replaceChildren();
    setStatus(nextStatus);
    setMicEnabled(false);
  }

  useEffect(() => {
    return () => resetVoiceState();
  }, [gameKind, roomCode]);

  async function connectVoice() {
    if (busy || voiceRoomRef.current) {
      return;
    }

    if (!connected) {
      onInfo("游戏连接恢复后才能加入语音。");
      return;
    }

    setBusy(true);
    setStatus("connecting");

    const livekitRoom = new LiveKitRoom({
      adaptiveStream: false,
      dynacast: false,
      audioCaptureDefaults: VOICE_AUDIO_OPTIONS
    });
    voiceRoomRef.current = livekitRoom;
    void livekitRoom.startAudio().catch(() => undefined);

    try {
      const credentials = await requestJson<VoiceTokenResponse>("/api/voice/token", {
        method: "POST",
        headers: authHeaders(authToken),
        body: JSON.stringify({ gameKind, roomCode })
      });

      livekitRoom
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
          attachRemoteAudio(track, participant);
          void livekitRoom.startAudio().catch(() => undefined);
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach().forEach((element) => element.remove());
        })
        .on(RoomEvent.AudioPlaybackStatusChanged, (canPlayback: boolean) => {
          if (!canPlayback) {
            onInfo("浏览器阻止了语音播放，请再次点击语音按钮或开启麦克风以解锁声音。");
          }
        })
        .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
          if (speakers.some((speaker) => speaker.identity === livekitRoom?.localParticipant.identity)) {
            holdVoiceInput();
          } else {
            fadeVoiceInput();
          }
        })
        .on(RoomEvent.Reconnecting, () => setStatus("reconnecting"))
        .on(RoomEvent.Reconnected, () => setStatus("connected"))
        .on(RoomEvent.Disconnected, () => resetVoiceState())
        .on(RoomEvent.MediaDevicesError, () => {
          const message = "麦克风不可用，请检查浏览器权限或设备。";
          clearVoiceInputState();
          setMicEnabled(false);
          onInfo(message);
        });

      startLocalSpeakingListener(livekitRoom);
      await livekitRoom.connect(credentials.url, credentials.token);
      attachExistingRemoteAudio(livekitRoom);
      void livekitRoom.startAudio().catch(() => undefined);

      let microphoneStarted = false;
      if (!window.isSecureContext) {
        onInfo("当前页面不是安全环境，浏览器会禁止麦克风。请用 localhost 或 HTTPS 打开游戏。");
      } else {
        try {
          await livekitRoom.localParticipant.setMicrophoneEnabled(true, VOICE_AUDIO_OPTIONS);
          setMicEnabled(true);
          microphoneStarted = true;
        } catch (error) {
          const message = error instanceof Error ? error.message : "麦克风开启失败，请检查浏览器权限。";
          clearVoiceInputState();
          setMicEnabled(false);
          onInfo(message);
        }
      }

      setStatus("connected");
      onInfo(microphoneStarted ? "已加入房间语音，麦克风已开启。" : "已加入房间语音，但麦克风未开启。");
    } catch (error) {
      livekitRoom?.removeAllListeners();
      livekitRoom?.disconnect();
      if (voiceRoomRef.current === livekitRoom) {
        voiceRoomRef.current = null;
      }
      audioContainerRef.current?.replaceChildren();
      stopLocalSpeakingListener();
      clearVoiceInputState();
      const message = error instanceof Error ? error.message : "加入语音失败，请稍后再试。";
      setStatus("error");
      setMicEnabled(false);
      onInfo(message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleMicrophone() {
    const room = voiceRoomRef.current;
    if (!room || busy) {
      return;
    }
    if (!window.isSecureContext) {
      onInfo("当前页面不是安全环境，浏览器会禁止麦克风。请用 localhost 或 HTTPS 打开游戏。");
      return;
    }

    const nextEnabled = !micEnabled;
    setBusy(true);
    try {
      void room.startAudio().catch(() => undefined);
      await room.localParticipant.setMicrophoneEnabled(nextEnabled, VOICE_AUDIO_OPTIONS);
      setMicEnabled(nextEnabled);
      if (!nextEnabled) {
        clearVoiceInputState();
      }
    } catch (error) {
      if (nextEnabled) {
        setMicEnabled(false);
      }
      clearVoiceInputState();
      const message = error instanceof Error ? error.message : "麦克风切换失败，请检查浏览器权限。";
      onInfo(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      className={`game-voice-dock ${joined ? "joined" : ""} ${micEnabled ? "mic-enabled" : ""} ${
        voiceInputActive ? "voice-input-active" : micEnabled ? "voice-input-idle" : ""
      }`}
      aria-label="房间语音"
    >
      <div className="game-voice-card">
        {!joined ? (
          <button className="game-voice-main" type="button" onClick={connectVoice} disabled={busy || !connected}>
            <Mic size={16} aria-hidden="true" />
            <span>加入语音</span>
          </button>
        ) : (
          <>
            <button
              className={`game-voice-main ${micEnabled ? "mic-on" : ""} ${
                voiceInputActive ? "voice-active" : micEnabled ? "voice-idle" : ""
              }`}
              type="button"
              onClick={toggleMicrophone}
              disabled={busy}
              aria-pressed={micEnabled}
            >
              {micEnabled ? <Mic size={18} aria-hidden="true" /> : <MicOff size={18} aria-hidden="true" />}
              <span>{micEnabled ? "麦克风已开" : "麦克风已关"}</span>
            </button>
            <button className="game-voice-icon" type="button" onClick={() => resetVoiceState()} aria-label="退出语音">
              <PhoneOff size={18} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
      <div ref={audioContainerRef} className="game-voice-audio" aria-hidden="true" />
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
