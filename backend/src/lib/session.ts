import type { SessionOptions } from 'express-session';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { env } from '../config/env.js';
import { getDbPool } from './db.js';

const PgStore = connectPgSimple(session);

export const SESSION_COOKIE_NAME = 'reachinbox.sid';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * PostgreSQL-backed session middleware. Sessions survive backend restarts
 * because they live in the "session" table (see Prisma Session model),
 * not in process memory. Never use MemoryStore outside tests.
 */
export function buildSessionMiddleware(opts?: { store?: SessionOptions['store'] }): ReturnType<typeof session> {
  const isProd = env.NODE_ENV === 'production';

  const store =
    opts?.store ??
    new PgStore({
      pool: getDbPool(),
      tableName: 'session',
      createTableIfMissing: false,
      // Disabled under test so vitest processes exit cleanly.
      pruneSessionInterval: env.NODE_ENV === 'test' ? 0 : 60 * 15,
    });

  return session({
    store,
    name: SESSION_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: isProd,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    },
  });
}
