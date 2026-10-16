import { PrismaClient } from '@prisma/client';
import { config } from '../config.ts';

declare global {
  var prismaClient: PrismaClient | undefined;
}

export const prisma = globalThis.prismaClient ?? new PrismaClient({
  datasources: { db: { url: config.DATABASE_URL } },
});

if (config.NODE_ENV !== 'production') globalThis.prismaClient = prisma;
