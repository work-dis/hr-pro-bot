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
      where: {
        isActive: true,
      },
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
        isActive: true,
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

  async findAvailableCountries(): Promise<string[]> {
    const rows = await prisma.vacancy.findMany({
      where: {
        isActive: true,
        country: {
          not: "",
        },
      },
      select: {
        country: true,
      },
      distinct: ["country"],
      orderBy: {
        country: "asc",
      },
    });

    return rows.map((row) => row.country);
  }

  async findAvailableCities(country: string): Promise<string[]> {
    const rows = await prisma.vacancy.findMany({
      where: {
        isActive: true,
        country: {
          equals: country,
          mode: "insensitive",
        },
        city: {
          not: "",
        },
      },
      select: {
        city: true,
      },
      distinct: ["city"],
      orderBy: {
        city: "asc",
      },
    });

    return rows.map((row) => row.city);
  }

  async findAvailableActivities(filters: { country: string; city?: string | null }): Promise<string[]> {
    const rows = await prisma.vacancy.findMany({
      where: {
        isActive: true,
        country: {
          equals: filters.country,
          mode: "insensitive",
        },
        city: filters.city
          ? {
              equals: filters.city,
              mode: "insensitive",
            }
          : undefined,
        activity: {
          not: "",
        },
      },
      select: {
        activity: true,
      },
      distinct: ["activity"],
      orderBy: {
        activity: "asc",
      },
    });

    return rows.map((row) => row.activity);
  }

  async findById(id: string): Promise<VacancyWithAgency | null> {
    return prisma.vacancy.findUnique({
      where: { id },
      include: { agency: true },
    });
  }

  async listByAgencyId(agencyId: string): Promise<VacancyWithAgency[]> {
    return prisma.vacancy.findMany({
      where: {
        agencyId,
      },
      include: {
        agency: true,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
  }

  async createForAgency(input: {
    agencyId: string;
    title: string;
    country: string;
    city: string;
    activity: string;
    salary: string;
  }): Promise<VacancyWithAgency> {
    return prisma.vacancy.create({
      data: {
        agencyId: input.agencyId,
        title: input.title,
        country: input.country,
        city: input.city,
        activity: input.activity,
        salary: input.salary,
        isActive: true,
      },
      include: {
        agency: true,
      },
    });
  }

  async toggleActiveForAgency(vacancyId: string, agencyId: string): Promise<VacancyWithAgency | null> {
    const vacancy = await prisma.vacancy.findFirst({
      where: {
        id: vacancyId,
        agencyId,
      },
    });

    if (!vacancy) {
      return null;
    }

    return prisma.vacancy.update({
      where: {
        id: vacancyId,
      },
      data: {
        isActive: !vacancy.isActive,
      },
      include: {
        agency: true,
      },
    });
  }

  async deleteForAgency(vacancyId: string, agencyId: string): Promise<VacancyWithAgency | null> {
    const vacancy = await prisma.vacancy.findFirst({
      where: {
        id: vacancyId,
        agencyId,
      },
      include: {
        agency: true,
      },
    });

    if (!vacancy) {
      return null;
    }

    await prisma.vacancy.delete({
      where: {
        id: vacancyId,
      },
    });

    return vacancy;
  }
}
