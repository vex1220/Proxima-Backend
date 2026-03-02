import { PrismaClient, Prisma } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const datasourceUrl = process.env.PGBOUNCER_URL || process.env.DATABASE_URL;

export const prisma = globalForPrisma.prisma || new PrismaClient({
  datasources: datasourceUrl ? { db: { url: datasourceUrl } } : undefined,
});

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export type DB = Prisma.TransactionClient | PrismaClient;

export async function runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}