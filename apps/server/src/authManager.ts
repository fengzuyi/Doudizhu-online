import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface AuthProfile {
  account: string;
  nickname: string;
  mode: "account";
}

export interface AuthSuccess {
  token: string;
  profile: AuthProfile;
}

interface AccountRecord {
  account: string;
  nickname: string;
  passwordHash: string;
  salt: string;
}

interface AuthStoreFile {
  accounts: AccountRecord[];
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

function assertCredentials(account: string, password: string) {
  if (!account) {
    throw new AuthException("ACCOUNT_REQUIRED", "请输入手机号 / 游戏账号。");
  }
  if (!password) {
    throw new AuthException("PASSWORD_REQUIRED", "请输入密码。");
  }
}

export class AuthManager {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly sessions = new Map<string, string>();

  constructor(private readonly storePath: string | null = defaultAuthStorePath()) {
    this.loadAccounts();
  }

  register(payload: { account?: unknown; nickname?: unknown; password?: unknown }): AuthSuccess {
    const account = normalizeAccount(payload.account);
    const nickname = normalizeNickname(payload.nickname);
    const password = normalizePassword(payload.password);

    assertCredentials(account, password);

    if (!nickname) {
      throw new AuthException("NICKNAME_REQUIRED", "请输入昵称。");
    }
    if (this.accounts.has(account)) {
      throw new AuthException("ACCOUNT_EXISTS", "该账号已注册。", 409);
    }

    const salt = randomBytes(16).toString("hex");
    this.accounts.set(account, {
      account,
      nickname,
      salt,
      passwordHash: hashPassword(password, salt)
    });
    this.saveAccounts();

    return this.createSession(account);
  }

  login(payload: { account?: unknown; password?: unknown }): AuthSuccess {
    const account = normalizeAccount(payload.account);
    const password = normalizePassword(payload.password);
    assertCredentials(account, password);

    const record = this.accounts.get(account);
    if (!record) {
      throw new AuthException("ACCOUNT_NOT_FOUND", "账号不存在，请先注册。", 404);
    }

    const expected = Buffer.from(record.passwordHash, "hex");
    const actual = Buffer.from(hashPassword(password, record.salt), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AuthException("INVALID_PASSWORD", "密码错误。", 401);
    }

    return this.createSession(account);
  }

  me(token: string | undefined): AuthProfile {
    const account = token ? this.sessions.get(token) : undefined;
    if (!account) {
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }

    const record = this.accounts.get(account);
    if (!record) {
      this.sessions.delete(token ?? "");
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }

    return this.toProfile(record);
  }

  logout(token: string | undefined) {
    if (token) {
      this.sessions.delete(token);
    }
  }

  private createSession(account: string): AuthSuccess {
    const record = this.accounts.get(account);
    if (!record) {
      throw new AuthException("ACCOUNT_NOT_FOUND", "账号不存在，请先注册。", 404);
    }

    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, account);
    return {
      token,
      profile: this.toProfile(record)
    };
  }

  private toProfile(record: AccountRecord): AuthProfile {
    return {
      account: record.account,
      nickname: record.nickname,
      mode: "account"
    };
  }

  private loadAccounts() {
    if (!this.storePath || !existsSync(this.storePath)) {
      return;
    }

    const parsed = JSON.parse(readFileSync(this.storePath, "utf8")) as Partial<AuthStoreFile>;
    for (const record of parsed.accounts ?? []) {
      if (isAccountRecord(record)) {
        this.accounts.set(record.account, record);
      }
    }
  }

  private saveAccounts() {
    if (!this.storePath) {
      return;
    }

    mkdirSync(dirname(this.storePath), { recursive: true });
    const payload: AuthStoreFile = {
      accounts: [...this.accounts.values()]
    };
    writeFileSync(this.storePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}

function defaultAuthStorePath() {
  return process.env.AUTH_STORE_PATH ?? fileURLToPath(new URL("../data/auth-store.json", import.meta.url));
}

function isAccountRecord(record: unknown): record is AccountRecord {
  if (!record || typeof record !== "object") {
    return false;
  }

  const candidate = record as Partial<AccountRecord>;
  return (
    typeof candidate.account === "string" &&
    typeof candidate.nickname === "string" &&
    typeof candidate.passwordHash === "string" &&
    typeof candidate.salt === "string"
  );
}
