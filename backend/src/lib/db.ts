import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (pool) return pool;
  pool = new Pool({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
  });
  pool.on('error', (err) => logger.warn({ err }, 'pg pool error'));
  return pool;
}

export async function checkDatabase(): Promise<'connected' | 'disconnected'> {
  try {
    const p = getDbPool();
    const query = p.query('SELECT 1');
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
    await Promise.race([query, timeout]);
    return 'connected';
  } catch {
    return 'disconnected';
  }
}
