import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'],
});

export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  if (!process.env['DATABASE_URL']) {
    return { ok: false, error: 'DATABASE_URL environment variable is not configured' };
  }
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Database health check failed');
    return { ok: false, error: message };
  }
}
