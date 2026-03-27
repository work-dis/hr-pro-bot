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

  async search(filters: { country?: string | null; city?: string | null; activity?: string | null }): Promise<VacancyWithAgency[]> {
    return prisma.vacancy.findMany({
      where: {
        country: filters.country
          ? {
              equals: filters.country,
              mode: "insensitive",
            }
          : undefined,
        city: filters.city
          ? {
              equals: filters.city,
              mode: "insensitive",
            }
          : undefined,
        activity: filters.activity
          ? {
              equals: filters.activity,
              mode: "insensitive",
            }
          : undefined,
      },
      include: {
        agency: true,
      },
      orderBy: [{ createdAt: "desc" }],
      take: 10,
    });
  }

  async findById(id: string): Promise<VacancyWithAgency | null> {
    return prisma.vacancy.findUnique({
      where: { id },
      include: { agency: true },
    });
  }
}
