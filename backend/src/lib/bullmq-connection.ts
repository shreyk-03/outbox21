import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Dedicated connection factory for BullMQ (Queue / Worker / QueueEvents).
 *
 * BullMQ requires `maxRetriesPerRequest: null` and a SEPARATE connection per
 * instance — never share one client between a Queue and a Worker, and never
 * reuse the fail-fast health-check client from lib/redis.ts (it disables
 * retries and offline queueing, which BullMQ needs to survive Redis blips).
 *
 * Nothing here ever flushes Redis. Delayed/waiting jobs persist in Redis
 * (AOF via docker-compose), so schedules survive API/worker restarts.
 */
export function createBullmqConnection(): Redis {
  const connection = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  connection.on('error', (err) => logger.warn({ err }, 'bullmq redis error'));
  return connection;
}
