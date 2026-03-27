import { Prisma } from "@prisma/client";
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
}
