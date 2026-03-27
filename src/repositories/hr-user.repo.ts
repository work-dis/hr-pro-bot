import { Prisma, type HrUser, type HrOnboardingStep } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface UpsertHrUserInput {
  telegramUserId: bigint;
  telegramUsername?: string | null;
  name: string;
  agencyId: string;
  canManageVacancies?: boolean;
  isActive?: boolean;
  onboardingStep?: HrOnboardingStep;
  vacancyDraft?: Prisma.InputJsonValue | null;
}

export class HrUserRepository {
  async upsert(input: UpsertHrUserInput): Promise<HrUser> {
    return prisma.hrUser.upsert({
      where: {
        telegramUserId: input.telegramUserId,
      },
      create: {
        telegramUserId: input.telegramUserId,
        telegramUsername: input.telegramUsername ?? null,
        name: input.name,
        agencyId: input.agencyId,
        canManageVacancies: input.canManageVacancies ?? true,
        isActive: input.isActive ?? true,
        onboardingStep: input.onboardingStep ?? "IDLE",
        vacancyDraft: input.vacancyDraft ?? Prisma.JsonNull,
      },
      update: {
        telegramUsername: input.telegramUsername ?? null,
        name: input.name,
        agencyId: input.agencyId,
        canManageVacancies: input.canManageVacancies ?? true,
        isActive: input.isActive ?? true,
        onboardingStep: input.onboardingStep ?? "IDLE",
        vacancyDraft: input.vacancyDraft ?? Prisma.JsonNull,
      },
    });
  }

  async findByTelegramUserId(telegramUserId: bigint) {
    return prisma.hrUser.findUnique({
      where: {
        telegramUserId,
      },
      include: {
        agency: true,
      },
    });
  }

  async updateByTelegramUserId(telegramUserId: bigint, data: Prisma.HrUserUpdateInput) {
    return prisma.hrUser.update({
      where: {
        telegramUserId,
      },
      data,
      include: {
        agency: true,
      },
    });
  }
}
