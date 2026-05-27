import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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

interface BackupOptions {
  backupDir?: string;
  keep?: number;
  now?: Date;
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
  private readonly activeTokensByAccount = new Map<string, string>();
  private readonly replacedTokens = new Set<string>();

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
      if (token && this.replacedTokens.has(token)) {
        this.replacedTokens.delete(token);
        throw new AuthException("SESSION_REPLACED", "账号已在其他设备登录，请重新登录。", 401);
      }
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }

    if (this.activeTokensByAccount.get(account) !== token) {
      this.sessions.delete(token ?? "");
      throw new AuthException("SESSION_REPLACED", "账号已在其他设备登录，请重新登录。", 401);
    }

    const record = this.accounts.get(account);
    if (!record) {
      this.sessions.delete(token ?? "");
      this.activeTokensByAccount.delete(account);
      throw new AuthException("UNAUTHORIZED", "登录已过期，请重新登录。", 401);
    }

    return this.toProfile(record);
  }

  logout(token: string | undefined) {
    if (token) {
      const account = this.sessions.get(token);
      this.sessions.delete(token);
      this.replacedTokens.delete(token);
      if (account && this.activeTokensByAccount.get(account) === token) {
        this.activeTokensByAccount.delete(account);
      }
    }
  }

  getAccountCount() {
    return this.accounts.size;
  }

  getStorePath() {
    return this.storePath;
  }

  backupAccounts(options: BackupOptions = {}) {
    if (!this.storePath || !existsSync(this.storePath)) {
      return undefined;
    }

    const backupDir = options.backupDir ?? process.env.AUTH_BACKUP_DIR ?? join(dirname(this.storePath), "backups");
    const keep = options.keep ?? Number(process.env.AUTH_BACKUP_KEEP ?? 20);
    const now = options.now ?? new Date();
    mkdirSync(backupDir, { recursive: true });

    const stamp = now.toISOString().replace(/[:.]/g, "-");
    const sourceName = basename(this.storePath);
    const backupPath = join(backupDir, `${sourceName}.${stamp}.bak`);
    copyFileSync(this.storePath, backupPath);
    this.pruneBackups(backupDir, sourceName, Number.isFinite(keep) && keep > 0 ? keep : 20);

    return {
      path: backupPath,
      accountCount: this.accounts.size
    };
  }

  private createSession(account: string): AuthSuccess {
    const record = this.accounts.get(account);
    if (!record) {
      throw new AuthException("ACCOUNT_NOT_FOUND", "账号不存在，请先注册。", 404);
    }

    this.revokeAccountSessions(account);
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, account);
    this.activeTokensByAccount.set(account, token);
    return {
      token,
      profile: this.toProfile(record)
    };
  }

  private revokeAccountSessions(account: string) {
    for (const [token, sessionAccount] of this.sessions.entries()) {
      if (sessionAccount === account) {
        this.sessions.delete(token);
        this.replacedTokens.add(token);
      }
    }
    this.activeTokensByAccount.delete(account);
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

  private pruneBackups(backupDir: string, sourceName: string, keep: number) {
    const prefix = `${sourceName}.`;
    const backups = readdirSync(backupDir)
      .filter((name) => name.startsWith(prefix) && name.endsWith(".bak"))
      .map((name) => {
        const path = join(backupDir, name);
        return { name, path, mtime: statSync(path).mtimeMs };
      })
      .sort((a, b) => b.name.localeCompare(a.name) || b.mtime - a.mtime);

    for (const item of backups.slice(keep)) {
      unlinkSync(item.path);
    }
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
