import { prisma } from './lib/prisma.js';
import { logger } from './lib/logger.js';
import { getDbPool } from './lib/db.js';
import { closeEmailWorker, getEmailWorker } from './workers/email.worker.js';

/**
 * Standalone email worker process (`npm run worker:dev` / `npm run worker`).
 * Consumes the persistent "email-send" queue from Redis. It never creates or
 * recreates jobs — delayed jobs already in Redis are picked up as-is, which
 * is what makes scheduling survive restarts.
 */
async function main(): Promise<void> {
  getEmailWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    await closeEmailWorker();
    await prisma.$disconnect();
    await getDbPool().end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'worker failed to start');
  process.exit(1);
});
