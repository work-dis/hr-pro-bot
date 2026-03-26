import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export type VacancyWithAgency = Prisma.VacancyGetPayload<{
  include: {
    agency: true;
  };
}>;

export class VacancyRepository {
  async findRelevant(city?: string | null): Promise<VacancyWithAgency[]> {
    return prisma.vacancy.findMany({
      include: {
        agency: true,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
      ],
      take: 200,
    });
  }
}
