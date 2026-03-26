import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";

export interface MarkProcessedUpdateInput {
  updateId: bigint;
  chatId?: bigint | null;
  messageId?: bigint | null;
}

export class ProcessedUpdateRepository {
  async claim(input: MarkProcessedUpdateInput): Promise<boolean> {
    try {
      await prisma.processedUpdate.create({
        data: {
          updateId: input.updateId,
          chatId: input.chatId ?? null,
          messageId: input.messageId ?? null,
          status: "PROCESSING",
        },
      });

      return true;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      const existing = await prisma.processedUpdate.findUnique({
        where: {
          updateId: input.updateId,
        },
      });

      if (!existing) {
        return false;
      }

      if (existing.status === "PROCESSED" || existing.status === "PROCESSING") {
        return false;
      }

      const claimed = await prisma.processedUpdate.updateMany({
        where: {
          id: existing.id,
          status: "FAILED",
        },
        data: {
          status: "PROCESSING",
          lastError: null,
          chatId: input.chatId ?? existing.chatId,
          messageId: input.messageId ?? existing.messageId,
        },
      });

      return claimed.count === 1;
    }
  }

  async markProcessed(updateId: bigint): Promise<void> {
    await prisma.processedUpdate.update({
      where: {
        updateId,
      },
      data: {
        status: "PROCESSED",
        lastError: null,
        processedAt: new Date(),
      },
    });
  }

  async markFailed(updateId: bigint, errorMessage: string): Promise<void> {
    await prisma.processedUpdate.update({
      where: {
        updateId,
      },
      data: {
        status: "FAILED",
        lastError: errorMessage.slice(0, 1000),
      },
    });
  }
}
