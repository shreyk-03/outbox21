import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger.js';
import { getEmailQueue } from '../queues/email.queue.js';

/**
 * Live BullMQ dashboard. Protection model:
 * - requireAuth always runs first (no anonymous access, ever).
 * - If BULL_BOARD_ADMIN_EMAIL is unset, the board is DISABLED (404) — a
 *   production queue dashboard must never be public by default.
 * - If set, only the authenticated user with that email may view it.
 * Read at request time (not import time) so tests can set the variable.
 */
export function bullBoardAdminEmail(): string | null {
  const raw = process.env.BULL_BOARD_ADMIN_EMAIL?.trim();
  return raw ? raw.toLowerCase() : null;
}

export function requireBullBoardAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminEmail = bullBoardAdminEmail();
  if (!adminEmail) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
    return;
  }
  if (req.authUser?.email.toLowerCase() !== adminEmail) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    return;
  }
  next();
}

let router: ReturnType<ExpressAdapter['getRouter']> | null = null;

export function getBullBoardRouter() {
  if (!router) {
    const serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({ queues: [new BullMQAdapter(getEmailQueue())], serverAdapter });
    router = serverAdapter.getRouter();
    logger.info('bull board mounted at /admin/queues (auth + admin-gated)');
  }
  return router;
}
