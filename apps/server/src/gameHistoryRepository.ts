import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { GameKind, GameSessionRecord } from "@doudizhu/shared";

export interface GameSessionCreateInput {
  account: string;
  nickname: string;
  gameKind: GameKind;
  gameName: string;
  roomCode: string;
  seat?: number;
  enteredAt: number;
  leftAt: number;
  finalScore: number;
  scoreLabel: string;
  resultLabel?: string;
  leaveReason?: string;
  phase: string;
}

export interface GameHistoryRepository {
  addGameSession(input: GameSessionCreateInput): Promise<GameSessionRecord>;
  listGameSessions(account: string, limit: number): Promise<GameSessionRecord[]>;
  close?(): Promise<void>;
}

let prismaClient: PrismaClient | undefined;

export function createPrismaGameHistoryRepository() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the game history system.");
  }

  prismaClient ??= new PrismaClient();
  return new PrismaGameHistoryRepository(prismaClient);
}

export class PrismaGameHistoryRepository implements GameHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async addGameSession(input: GameSessionCreateInput): Promise<GameSessionRecord> {
    const record = await (this.prisma as any).gameSessionRecord.create({
      data: {
        account: input.account,
        nickname: input.nickname,
        gameKind: input.gameKind,
        gameName: input.gameName,
        roomCode: input.roomCode,
        seat: input.seat ?? null,
        enteredAt: new Date(input.enteredAt),
        leftAt: new Date(input.leftAt),
        finalScore: input.finalScore,
        scoreLabel: input.scoreLabel,
        resultLabel: input.resultLabel ?? null,
        leaveReason: input.leaveReason ?? null,
        phase: input.phase
      }
    });

    return toGameSessionRecord(record);
  }

  async listGameSessions(account: string, limit: number): Promise<GameSessionRecord[]> {
    const records = await (this.prisma as any).gameSessionRecord.findMany({
      where: { account },
      orderBy: { leftAt: "desc" },
      take: limit
    });

    return records.map(toGameSessionRecord);
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export class InMemoryGameHistoryRepository implements GameHistoryRepository {
  private readonly records: GameSessionRecord[] = [];

  async addGameSession(input: GameSessionCreateInput): Promise<GameSessionRecord> {
    const record: GameSessionRecord = {
      id: randomUUID(),
      account: input.account,
      nickname: input.nickname,
      gameKind: input.gameKind,
      gameName: input.gameName,
      roomCode: input.roomCode,
      seat: input.seat,
      enteredAt: input.enteredAt,
      leftAt: input.leftAt,
      finalScore: input.finalScore,
      scoreLabel: input.scoreLabel,
      resultLabel: input.resultLabel,
      leaveReason: input.leaveReason,
      phase: input.phase
    };

    this.records.push(record);
    return record;
  }

  async listGameSessions(account: string, limit: number): Promise<GameSessionRecord[]> {
    return this.records
      .filter((record) => record.account === account)
      .sort((left, right) => right.leftAt - left.leftAt)
      .slice(0, limit);
  }
}

type PrismaGameSessionRecordLike = {
  id: string;
  account: string;
  nickname: string;
  gameKind: string;
  gameName: string;
  roomCode: string;
  seat: number | null;
  enteredAt: Date;
  leftAt: Date;
  finalScore: number;
  scoreLabel: string;
  resultLabel: string | null;
  leaveReason: string | null;
  phase: string;
};

function toGameSessionRecord(record: PrismaGameSessionRecordLike): GameSessionRecord {
  return {
    id: record.id,
    account: record.account,
    nickname: record.nickname,
    gameKind: toGameKind(record.gameKind),
    gameName: record.gameName,
    roomCode: record.roomCode,
    seat: record.seat ?? undefined,
    enteredAt: record.enteredAt.getTime(),
    leftAt: record.leftAt.getTime(),
    finalScore: record.finalScore,
    scoreLabel: record.scoreLabel,
    resultLabel: record.resultLabel ?? undefined,
    leaveReason: record.leaveReason ?? undefined,
    phase: record.phase
  };
}

function toGameKind(value: string): GameKind {
  return value === "zha_jin_hua" || value === "da_ban_zi" || value === "fighter" ? value : "doudizhu";
}
