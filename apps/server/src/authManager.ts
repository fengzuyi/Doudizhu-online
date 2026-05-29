import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createPrismaAuthRepository } from "./authRepository.js";
import type { AuthRepository, AuthUserRecord } from "./authRepository.js";

export interface AuthProfile {
  account: string;
  nickname: string;
  mode: "account";
}

export interface AuthSuccess {
  token: string;
  profile: AuthProfile;
}

interface AuthManagerOptions {
  sessionTtlDays?: number;
}

export class AuthException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

function normalizeAccount(account: unknown) {
  return typeof account === "string" ? account.trim().toLowerCase() : "";
}

function normalizeNickname(nickname: unknown) {
  return typeof nickname === "string" ? nickname.trim() : "";
}

function normalizePassword(password: unknown) {
  return typeof password === "string" ? password : "";
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 32).toString("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function assertCredentials(account: string, password: string) {
  if (!account) {
    throw new AuthException("ACCOUNT_REQUIRED", "请输入手机号 / 游戏账号。");
  }
  if (!password) {
    throw new AuthException("PASSWORD_REQUIRED", "请输入密码。");
  }
}

function getSessionTtlDays(options: AuthManagerOptions) {
  const configured = options.sessionTtlDays ?? Number(process.env.AUTH_SESSION_TTL_DAYS ?? 30);
  return Number.isFinite(configured) && configured > 0 ? configured : 30;
}

export class AuthManager {
  private readonly sessionTtlMs: number;

  constructor(
    private readonly repository: AuthRepository = createPrismaAuthRepository(),
    options: AuthManagerOptions = {}
  ) {
    this.sessionTtlMs = getSessionTtlDays(options) * 24 * 60 * 60_000;
  }

  async register(payload: { account?: unknown; nickname?: unknown; password?: unknown }): Promise<AuthSuccess> {
    const account = normalizeAccount(payload.account);
    const nickname = normalizeNickname(payload.nickname);
    const password = normalizePassword(payload.password);

    assertCredentials(account, password);

    if (!nickname) {
      throw new AuthException("NICKNAME_REQUIRED", "请输入昵称。");
    }
    if (await this.repository.findUserByAccount(account)) {
      throw new AuthException("ACCOUNT_EXISTS", "该账号已注册。", 409);
    }

    const salt = randomBytes(16).toString("hex");
    const user = await this.repository.createUser({
      account,
      nickname,
      salt,
      passwordHash: hashPassword(password, salt)
    });

    return this.createSession(user);
  }

  async login(payload: { account?: unknown; password?: unknown }): Promise<AuthSuccess> {
    const account = normalizeAccount(payload.account);
    const password = normalizePassword(payload.password);
    assertCredentials(account, password);

    const user = await this.repository.findUserByAccount(account);
    if (!user) {
      throw new AuthException("ACCOUNT_NOT_FOUND", "账号不存在，请先注册。", 404);
    }
    if (user.status === "BANNED") {
      throw new AuthException("ACCOUNT_BANNED", "账号已被封禁，无法登录。", 403);
    }

    const expected = Buffer.from(user.passwordHash, "hex");
    const actual = Buffer.from(hashPassword(password, user.salt), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AuthException("INVALID_PASSWORD", "密码错误。", 401);
    }

    await this.repository.updateLastLoginAt(user.id, new Date());
    return this.createSession(user);
  }

  async me(token: string | undefined): Promise<AuthProfile> {
    if (!token) {
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }

    const session = await this.repository.findSessionByTokenHash(hashToken(token));
    if (!session) {
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }
    if (session.replacedAt) {
      throw new AuthException("SESSION_REPLACED", "账号已在其他设备登录，请重新登录。", 401);
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }
    if (session.user.status === "BANNED") {
      throw new AuthException("ACCOUNT_BANNED", "账号已被封禁，无法登录。", 403);
    }

    return this.toProfile(session.user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await this.repository.revokeSessionByTokenHash(hashToken(token), new Date());
    }
  }

  async getAccountCount() {
    return this.repository.countUsers();
  }

  async close() {
    await this.repository.close?.();
  }

  private async createSession(user: AuthUserRecord): Promise<AuthSuccess> {
    const now = new Date();
    const token = randomBytes(32).toString("hex");

    await this.repository.revokeActiveSessionsForUser(user.id, now);
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + this.sessionTtlMs)
    });

    return {
      token,
      profile: this.toProfile(user)
    };
  }

  private toProfile(user: AuthUserRecord): AuthProfile {
    return {
      account: user.account,
      nickname: user.nickname,
      mode: "account"
    };
  }
}
