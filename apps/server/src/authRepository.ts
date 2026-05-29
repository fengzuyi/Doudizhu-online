import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

export type AuthUserStatus = "ACTIVE" | "BANNED";

export interface AuthUserRecord {
  id: string;
  account: string;
  nickname: string;
  passwordHash: string;
  salt: string;
  status: AuthUserStatus;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedAt: Date | null;
  createdAt: Date;
  user: AuthUserRecord;
}

export interface AuthRepository {
  findUserByAccount(account: string): Promise<AuthUserRecord | null>;
  createUser(input: {
    account: string;
    nickname: string;
    passwordHash: string;
    salt: string;
    status?: AuthUserStatus;
  }): Promise<AuthUserRecord>;
  updateUserStatus(userId: string, status: AuthUserStatus): Promise<void>;
  updateLastLoginAt(userId: string, at: Date): Promise<void>;
  revokeActiveSessionsForUser(userId: string, replacedAt: Date): Promise<void>;
  createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null>;
  revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void>;
  countUsers(): Promise<number>;
  close?(): Promise<void>;
}

let prismaClient: PrismaClient | undefined;

export function createPrismaAuthRepository() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the database auth system.");
  }

  prismaClient ??= new PrismaClient();
  return new PrismaAuthRepository(prismaClient);
}

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findUserByAccount(account: string): Promise<AuthUserRecord | null> {
    const user = await this.prisma.user.findUnique({ where: { account } });
    return user ? toUserRecord(user) : null;
  }

  async createUser(input: {
    account: string;
    nickname: string;
    passwordHash: string;
    salt: string;
    status?: AuthUserStatus;
  }): Promise<AuthUserRecord> {
    const user = await this.prisma.user.create({
      data: {
        account: input.account,
        nickname: input.nickname,
        passwordHash: input.passwordHash,
        salt: input.salt,
        status: input.status ?? "ACTIVE"
      }
    });

    return toUserRecord(user);
  }

  async updateLastLoginAt(userId: string, at: Date): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: at } });
  }

  async updateUserStatus(userId: string, status: AuthUserStatus): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { status } });
  }

  async revokeActiveSessionsForUser(userId: string, replacedAt: Date): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        replacedAt: null,
        expiresAt: { gt: replacedAt }
      },
      data: { replacedAt }
    });
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    const session = await this.prisma.userSession.create({
      data: input,
      include: { user: true }
    });

    return toSessionRecord(session);
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    return session ? toSessionRecord(session) : null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt }
    });
  }

  async countUsers(): Promise<number> {
    return this.prisma.user.count();
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export class InMemoryAuthRepository implements AuthRepository {
  private readonly usersById = new Map<string, AuthUserRecord>();
  private readonly userIdsByAccount = new Map<string, string>();
  private readonly sessionsByTokenHash = new Map<string, AuthSessionRecord>();

  async findUserByAccount(account: string): Promise<AuthUserRecord | null> {
    const userId = this.userIdsByAccount.get(account);
    return userId ? this.usersById.get(userId) ?? null : null;
  }

  async createUser(input: {
    account: string;
    nickname: string;
    passwordHash: string;
    salt: string;
    status?: AuthUserStatus;
  }): Promise<AuthUserRecord> {
    const now = new Date();
    const user: AuthUserRecord = {
      id: randomUUID(),
      account: input.account,
      nickname: input.nickname,
      passwordHash: input.passwordHash,
      salt: input.salt,
      status: input.status ?? "ACTIVE",
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null
    };
    this.usersById.set(user.id, user);
    this.userIdsByAccount.set(user.account, user.id);
    return user;
  }

  async updateLastLoginAt(userId: string, at: Date): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) {
      this.usersById.set(userId, { ...user, lastLoginAt: at, updatedAt: at });
    }
  }

  async updateUserStatus(userId: string, status: AuthUserStatus): Promise<void> {
    const user = this.usersById.get(userId);
    if (user) {
      const updatedUser = { ...user, status, updatedAt: new Date() };
      this.usersById.set(userId, updatedUser);
      for (const [tokenHash, session] of this.sessionsByTokenHash.entries()) {
        if (session.userId === userId) {
          this.sessionsByTokenHash.set(tokenHash, { ...session, user: updatedUser });
        }
      }
    }
  }

  async revokeActiveSessionsForUser(userId: string, replacedAt: Date): Promise<void> {
    for (const [tokenHash, session] of this.sessionsByTokenHash.entries()) {
      if (session.userId === userId && !session.revokedAt && !session.replacedAt && session.expiresAt > replacedAt) {
        this.sessionsByTokenHash.set(tokenHash, { ...session, replacedAt });
      }
    }
  }

  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<AuthSessionRecord> {
    const user = this.usersById.get(input.userId);
    if (!user) {
      throw new Error(`Missing user ${input.userId}`);
    }

    const session: AuthSessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
      replacedAt: null,
      createdAt: new Date(),
      user
    };
    this.sessionsByTokenHash.set(input.tokenHash, session);
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<AuthSessionRecord | null> {
    return this.sessionsByTokenHash.get(tokenHash) ?? null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (session) {
      this.sessionsByTokenHash.set(tokenHash, { ...session, revokedAt });
    }
  }

  async countUsers(): Promise<number> {
    return this.usersById.size;
  }
}

type PrismaUserLike = {
  id: string;
  account: string;
  nickname: string;
  passwordHash: string;
  salt: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

type PrismaSessionLike = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedAt: Date | null;
  createdAt: Date;
  user: PrismaUserLike;
};

function toUserRecord(user: PrismaUserLike): AuthUserRecord {
  return {
    ...user,
    status: user.status === "BANNED" ? "BANNED" : "ACTIVE"
  };
}

function toSessionRecord(session: PrismaSessionLike): AuthSessionRecord {
  return {
    ...session,
    user: toUserRecord(session.user)
  };
}
