import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { ChatMessage } from "@doudizhu/shared";

export interface AdminAuditLogRecord {
  id: string;
  at: number;
  admin: string;
  action: string;
  target?: string;
  reason?: string;
}

export interface ChatMuteRecord {
  account: string;
  mutedAt: number;
  mutedBy: string;
  reason?: string;
}

export interface AdminRepository {
  listChatMessages(limit: number): Promise<ChatMessage[]>;
  addChatMessage(message: ChatMessage): Promise<void>;
  deleteChatMessage(id: string): Promise<ChatMessage | null>;
  clearChatMessages(): Promise<number>;
  trimChatMessages(max: number): Promise<void>;
  listChatMutes(): Promise<ChatMuteRecord[]>;
  setChatMute(input: { account: string; mutedBy: string; reason?: string }): Promise<void>;
  deleteChatMute(account: string): Promise<void>;
  addAuditLog(input: { admin: string; action: string; target?: string; reason?: string }): Promise<void>;
  listAuditLogs(limit: number): Promise<AdminAuditLogRecord[]>;
  close?(): Promise<void>;
}

let prismaClient: PrismaClient | undefined;

export function createPrismaAdminRepository() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the admin persistence system.");
  }

  prismaClient ??= new PrismaClient();
  return new PrismaAdminRepository(prismaClient);
}

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listChatMessages(limit: number): Promise<ChatMessage[]> {
    const messages = await (this.prisma as any).chatMessage.findMany({
      orderBy: { at: "desc" },
      take: limit
    });

    return messages.reverse().map(toChatMessage);
  }

  async addChatMessage(message: ChatMessage): Promise<void> {
    await (this.prisma as any).chatMessage.create({
      data: {
        ...message,
        at: new Date(message.at)
      }
    });
  }

  async deleteChatMessage(id: string): Promise<ChatMessage | null> {
    const message = await (this.prisma as any).chatMessage.findUnique({ where: { id } });
    if (!message) {
      return null;
    }

    await (this.prisma as any).chatMessage.delete({ where: { id } });
    return toChatMessage(message);
  }

  async clearChatMessages(): Promise<number> {
    const result = await (this.prisma as any).chatMessage.deleteMany();
    return result.count;
  }

  async trimChatMessages(max: number): Promise<void> {
    const oldMessages = await (this.prisma as any).chatMessage.findMany({
      orderBy: { at: "desc" },
      skip: max,
      select: { id: true }
    });
    const ids = oldMessages.map((message: { id: string }) => message.id);
    if (ids.length > 0) {
      await (this.prisma as any).chatMessage.deleteMany({ where: { id: { in: ids } } });
    }
  }

  async listChatMutes(): Promise<ChatMuteRecord[]> {
    const mutes = await (this.prisma as any).chatMute.findMany();
    return mutes.map(toChatMuteRecord);
  }

  async setChatMute(input: { account: string; mutedBy: string; reason?: string }): Promise<void> {
    await (this.prisma as any).chatMute.upsert({
      where: { account: input.account },
      update: {
        mutedAt: new Date(),
        mutedBy: input.mutedBy,
        reason: input.reason || null
      },
      create: {
        account: input.account,
        mutedBy: input.mutedBy,
        reason: input.reason || null
      }
    });
  }

  async deleteChatMute(account: string): Promise<void> {
    await (this.prisma as any).chatMute.deleteMany({ where: { account } });
  }

  async addAuditLog(input: { admin: string; action: string; target?: string; reason?: string }): Promise<void> {
    await (this.prisma as any).adminAuditLog.create({
      data: {
        id: randomUUID(),
        admin: input.admin,
        action: input.action,
        target: input.target || null,
        reason: input.reason || null
      }
    });
    await this.trimAuditLogs(200);
  }

  async listAuditLogs(limit: number): Promise<AdminAuditLogRecord[]> {
    const logs = await (this.prisma as any).adminAuditLog.findMany({
      orderBy: { at: "desc" },
      take: limit
    });

    return logs.map(toAdminAuditLogRecord);
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private async trimAuditLogs(max: number) {
    const oldLogs = await (this.prisma as any).adminAuditLog.findMany({
      orderBy: { at: "desc" },
      skip: max,
      select: { id: true }
    });
    const ids = oldLogs.map((log: { id: string }) => log.id);
    if (ids.length > 0) {
      await (this.prisma as any).adminAuditLog.deleteMany({ where: { id: { in: ids } } });
    }
  }
}

export class InMemoryAdminRepository implements AdminRepository {
  private readonly chatMessages = new Map<string, ChatMessage>();
  private readonly chatMutes = new Map<string, ChatMuteRecord>();
  private readonly auditLogs: AdminAuditLogRecord[] = [];

  async listChatMessages(limit: number): Promise<ChatMessage[]> {
    return [...this.chatMessages.values()]
      .sort((left, right) => left.at - right.at)
      .slice(-limit);
  }

  async addChatMessage(message: ChatMessage): Promise<void> {
    this.chatMessages.set(message.id, message);
  }

  async deleteChatMessage(id: string): Promise<ChatMessage | null> {
    const message = this.chatMessages.get(id) ?? null;
    this.chatMessages.delete(id);
    return message;
  }

  async clearChatMessages(): Promise<number> {
    const count = this.chatMessages.size;
    this.chatMessages.clear();
    return count;
  }

  async trimChatMessages(max: number): Promise<void> {
    const messages = await this.listChatMessages(Number.MAX_SAFE_INTEGER);
    for (const message of messages.slice(0, Math.max(0, messages.length - max))) {
      this.chatMessages.delete(message.id);
    }
  }

  async listChatMutes(): Promise<ChatMuteRecord[]> {
    return [...this.chatMutes.values()];
  }

  async setChatMute(input: { account: string; mutedBy: string; reason?: string }): Promise<void> {
    this.chatMutes.set(input.account, {
      account: input.account,
      mutedAt: Date.now(),
      mutedBy: input.mutedBy,
      reason: input.reason
    });
  }

  async deleteChatMute(account: string): Promise<void> {
    this.chatMutes.delete(account);
  }

  async addAuditLog(input: { admin: string; action: string; target?: string; reason?: string }): Promise<void> {
    this.auditLogs.push({
      id: randomUUID(),
      at: Date.now(),
      ...input
    });
    if (this.auditLogs.length > 200) {
      this.auditLogs.splice(0, this.auditLogs.length - 200);
    }
  }

  async listAuditLogs(limit: number): Promise<AdminAuditLogRecord[]> {
    return this.auditLogs
      .slice()
      .sort((left, right) => right.at - left.at)
      .slice(0, limit);
  }
}

type PrismaChatMessageLike = {
  id: string;
  account: string;
  nickname: string;
  text: string;
  at: Date;
};

type PrismaChatMuteLike = {
  account: string;
  mutedAt: Date;
  mutedBy: string;
  reason: string | null;
};

type PrismaAdminAuditLogLike = {
  id: string;
  at: Date;
  admin: string;
  action: string;
  target: string | null;
  reason: string | null;
};

function toChatMessage(message: PrismaChatMessageLike): ChatMessage {
  return {
    id: message.id,
    account: message.account,
    nickname: message.nickname,
    text: message.text,
    at: message.at.getTime()
  };
}

function toChatMuteRecord(mute: PrismaChatMuteLike): ChatMuteRecord {
  return {
    account: mute.account,
    mutedAt: mute.mutedAt.getTime(),
    mutedBy: mute.mutedBy,
    reason: mute.reason ?? undefined
  };
}

function toAdminAuditLogRecord(log: PrismaAdminAuditLogLike): AdminAuditLogRecord {
  return {
    id: log.id,
    at: log.at.getTime(),
    admin: log.admin,
    action: log.action,
    target: log.target ?? undefined,
    reason: log.reason ?? undefined
  };
}
