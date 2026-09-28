import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (redis) return redis;
  redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    // Fail fast for health checks / Phase 1 (no infra running is normal).
    // BullMQ phases will use their own connection options with retries.
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  redis.on('error', (err) => logger.warn({ err }, 'redis error'));
  return redis;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function checkRedis(): Promise<'connected' | 'disconnected'> {
  try {
    const client = getRedis();
    await withTimeout(client.ping(), 2000);
    return 'connected';
  } catch {
    return 'disconnected';
  }
}
