import { Prisma, type ApplicationStatus } from "@prisma/client";
import { prisma } from "../db/prisma";

export class ApplicationRepository {
  async createOrGet(candidateId: string, vacancyId: string) {
    try {
      return await prisma.vacancyApplication.create({
        data: {
          candidateId,
          vacancyId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return prisma.vacancyApplication.findFirstOrThrow({
          where: {
            candidateId,
            vacancyId,
          },
        });
      }

      throw error;
    }
  }

  async findById(id: string) {
    return prisma.vacancyApplication.findUnique({
      where: { id },
      include: {
        candidate: true,
        vacancy: {
          include: {
            agency: true,
          },
        },
      },
    });
  }

  async updateStatus(id: string, status: ApplicationStatus) {
    return prisma.vacancyApplication.update({
      where: { id },
      data: {
        status,
        reviewedAt: status === "SENT" ? null : new Date(),
      },
      include: {
        candidate: true,
        vacancy: {
          include: {
            agency: true,
          },
        },
      },
    });
  }

  async listByCandidateId(candidateId: string) {
    return prisma.vacancyApplication.findMany({
      where: { candidateId },
      include: {
        vacancy: {
          include: {
            agency: true,
          },
        },
      },
      orderBy: [
        { updatedAt: "desc" },
        { createdAt: "desc" },
      ],
    });
  }
}
