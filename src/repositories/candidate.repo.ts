import type { Prisma, Candidate } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface UpsertCandidateInput {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  name: string;
  phone?: string | null;
  city?: string | null;
  resume?: Prisma.InputJsonValue | null;
}

export class CandidateRepository {
  async upsertByTelegramUser(input: UpsertCandidateInput): Promise<Candidate> {
    return prisma.candidate.upsert({
      where: {
        telegramUserId: input.telegramUserId,
      },
      create: {
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername ?? null,
        name: input.name,
        phone: input.phone ?? null,
        city: input.city ?? null,
        resume: input.resume ?? Prisma.JsonNull,
      },
      update: {
        telegramUsername: input.telegramUsername ?? null,
        name: input.name,
        phone: input.phone ?? null,
        city: input.city ?? null,
        resume: input.resume ?? Prisma.JsonNull,
      },
    });
  }
}
