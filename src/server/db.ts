/**
 * Prisma client singleton.
 *
 * Next.js dev-mode hot reload re-evaluates modules, so the client is cached on
 * globalThis to avoid exhausting the connection pool with one client per reload.
 */

import { PrismaClient } from '@/generated/prisma';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
