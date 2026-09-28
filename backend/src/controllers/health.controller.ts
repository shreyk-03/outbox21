import type { Request, Response } from 'express';
import { checkDatabase } from '../lib/db.js';
import { checkRedis } from '../lib/redis.js';

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const [redis, database] = await Promise.all([checkRedis(), checkDatabase()]);
  res.status(200).json({ status: 'ok', redis, database });
}
