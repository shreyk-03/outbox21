import signature from 'cookie-signature';
import { env } from '../config/env.js';
import { SESSION_COOKIE_NAME } from '../lib/session.js';
import { prisma } from '../lib/prisma.js';
import { upsertGoogleUser } from '../services/auth.service.js';

/** Shared helpers for Phase 4 tests (real PostgreSQL sessions). */
export function sessionCookie(sid: string): string {
  const signed = `s:${signature.sign(sid, env.SESSION_SECRET)}`;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}

export async function seedSession(tag: string, userId: string): Promise<string> {
  const sid = `${tag}-sid-${Math.random().toString(36).slice(2)}`;
  const sess = JSON.stringify({
    cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' },
    userId,
  });
  await prisma.$executeRaw`INSERT INTO "session" (sid, sess, expire) VALUES (${sid}, ${sess}::jsonb, NOW() + INTERVAL '1 hour')`;
  return sid;
}

export interface TestIdentity {
  userId: string;
  senderId: string;
  cookie: string;
}

export async function createTestIdentity(tag: string, label: string): Promise<TestIdentity> {
  const user = await upsertGoogleUser({
    googleId: `${tag}-gid-${label}`,
    email: `${tag}-${label}@example.com`,
    name: `Test ${label}`,
    avatarUrl: null,
  });
  const sender = await prisma.sender.create({
    data: { userId: user.id, email: `${tag}-sender-${label}@example.com`, name: `Sender ${label}`, hourlyLimit: 100 },
  });
  const sid = await seedSession(tag, user.id);
  return { userId: user.id, senderId: sender.id, cookie: sessionCookie(sid) };
}

export async function cleanupTestData(tag: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "session" WHERE sid LIKE ${`${tag}%`}`;
  await prisma.user.deleteMany({ where: { googleId: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { email: { contains: tag } } });
}
