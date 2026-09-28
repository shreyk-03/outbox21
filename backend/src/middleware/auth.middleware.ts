import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { AppError } from './error.middleware.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

/**
 * Protects user-scoped routes. The session cookie only carries an opaque
 * session id; identity comes from req.session.userId and the user row is
 * reloaded from PostgreSQL (source of truth) on every request, so a deleted
 * user immediately loses access even with a live cookie.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      req.session?.destroy(() => undefined);
      throw new AppError(401, 'UNAUTHENTICATED', 'Session is no longer valid');
    }
    req.authUser = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
    next();
  } catch (err) {
    next(err);
  }
}
