import { Prisma, type Candidate, type CandidateOnboardingStep } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface UpsertCandidateInput {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  name: string;
  age?: number | null;
  phone?: string | null;
  city?: string | null;
  documentTypes?: string[];
  skills?: string[];
  onboardingStep?: CandidateOnboardingStep;
  searchCountry?: string | null;
  searchCity?: string | null;
  searchActivity?: string | null;
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
        age: input.age ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        documentTypes: input.documentTypes ?? [],
        skills: input.skills ?? [],
        onboardingStep: input.onboardingStep ?? "IDLE",
        searchCountry: input.searchCountry ?? null,
        searchCity: input.searchCity ?? null,
        searchActivity: input.searchActivity ?? null,
        resume: input.resume ?? Prisma.JsonNull,
      },
      update: {
        telegramUsername: input.telegramUsername ?? null,
        name: input.name,
        age: input.age ?? null,
        phone: input.phone ?? null,
        city: input.city ?? null,
        documentTypes: input.documentTypes ?? [],
        skills: input.skills ?? [],
        onboardingStep: input.onboardingStep ?? "IDLE",
        searchCountry: input.searchCountry ?? null,
        searchCity: input.searchCity ?? null,
        searchActivity: input.searchActivity ?? null,
        resume: input.resume ?? Prisma.JsonNull,
      },
    });
  }

  async findByTelegramUserId(telegramUserId: bigint): Promise<Candidate | null> {
    return prisma.candidate.findUnique({
      where: {
        telegramUserId,
      },
    });
  }

  async updateByTelegramUserId(telegramUserId: bigint, data: Prisma.CandidateUpdateInput): Promise<Candidate> {
    return prisma.candidate.update({
      where: {
        telegramUserId,
      },
      data,
    });
  }
}
