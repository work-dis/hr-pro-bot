import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function createPrismaClient() {
  return new PrismaClient({
    datasources: {
      db: {
        url: env.databaseUrl,
      },
    },
    log: env.nodeEnv === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = global.prismaGlobal ?? createPrismaClient();

if (env.nodeEnv !== "production") {
  global.prismaGlobal = prisma;
}
