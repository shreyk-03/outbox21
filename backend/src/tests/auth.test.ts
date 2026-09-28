import signature from 'cookie-signature';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { env } from '../config/env.js';
import { SESSION_COOKIE_NAME } from '../lib/session.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { upsertGoogleUser } from '../services/auth.service.js';

const app = createApp();
const agent = request(app);

const TEST_TAG = `phase3-test-${Date.now()}`;

function sessionCookie(sid: string): string {
  const signed = `s:${signature.sign(sid, env.SESSION_SECRET)}`;
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
}

async function seedSession(userId: string): Promise<string> {
  const sid = `${TEST_TAG}-sid-${Math.random().toString(36).slice(2)}`;
  const sess = JSON.stringify({
    cookie: { originalMaxAge: 604800000, httpOnly: true, path: '/' },
    userId,
  });
  await prisma.$executeRaw`INSERT INTO "session" (sid, sess, expire) VALUES (${sid}, ${sess}::jsonb, NOW() + INTERVAL '1 hour')`;
  return sid;
}

async function cleanup(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "session" WHERE sid LIKE ${`${TEST_TAG}%`}`;
  await prisma.user.deleteMany({ where: { googleId: { startsWith: TEST_TAG } } });
  await prisma.user.deleteMany({ where: { email: { contains: TEST_TAG } } });
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('auth: unauthenticated', () => {
  it('GET /api/auth/me without session → 401', async () => {
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
  });

  it('POST /api/auth/logout without session → 200 and clears cookie', async () => {
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const setCookie = res.headers['set-cookie'] as unknown as string[];
    expect(setCookie.join(';')).toContain(SESSION_COOKIE_NAME);
  });

  it('stale session (unknown userId) → 401', async () => {
    const sid = await seedSession('00000000-0000-0000-0000-000000000000');
    const res = await agent.get('/api/auth/me').set('Cookie', sessionCookie(sid));
    expect(res.status).toBe(401);
  });
});

describe('auth: google user upsert (no Google network involved)', () => {
  it('creates then reuses the same row (no duplicates) and updates profile', async () => {
    const gid = `${TEST_TAG}-gid-1`;
    const first = await upsertGoogleUser({
      googleId: gid,
      email: `${TEST_TAG}-1@example.com`,
      name: 'Phase Three',
      avatarUrl: null,
    });
    const second = await upsertGoogleUser({
      googleId: gid,
      email: `${TEST_TAG}-1@example.com`,
      name: 'Phase Three Renamed',
      avatarUrl: 'https://example.com/a.png',
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Phase Three Renamed');
    const count = await prisma.user.count({ where: { googleId: gid } });
    expect(count).toBe(1);
  });
});

describe('auth: authenticated session', () => {
  it('session for user A returns only user A (no leakage, no secrets)', async () => {
    const userA = await upsertGoogleUser({
      googleId: `${TEST_TAG}-gid-A`,
      email: `${TEST_TAG}-a@example.com`,
      name: 'User A',
      avatarUrl: null,
    });
    await upsertGoogleUser({
      googleId: `${TEST_TAG}-gid-B`,
      email: `${TEST_TAG}-b@example.com`,
      name: 'User B',
      avatarUrl: null,
    });

    const sid = await seedSession(userA.id);
    const res = await agent.get('/api/auth/me').set('Cookie', sessionCookie(sid));

    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.user).toEqual({ id: userA.id, name: 'User A', email: `${TEST_TAG}-a@example.com`, avatarUrl: null });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('googleId');
    expect(raw).not.toContain('SESSION_SECRET');
    expect(raw).not.toContain('accessToken');
    expect(raw).not.toContain(`${TEST_TAG}-b@example.com`);
  });

  it('logout destroys the session: cookie stops working afterwards', async () => {
    const user = await upsertGoogleUser({
      googleId: `${TEST_TAG}-gid-C`,
      email: `${TEST_TAG}-c@example.com`,
      name: 'User C',
      avatarUrl: null,
    });
    const sid = await seedSession(user.id);
    const cookie = sessionCookie(sid);

    const before = await agent.get('/api/auth/me').set('Cookie', cookie);
    expect(before.status).toBe(200);

    const logoutRes = await agent.post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);

    const after = await agent.get('/api/auth/me').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});

describe('auth: google entry point', () => {
  it('never 500s and never leaks the client secret', async () => {
    const res = await agent.get('/api/auth/google').redirects(0);
    expect([302, 503]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('accounts.google.com');
      expect(res.headers.location).not.toContain('client_secret');
    } else {
      expect(res.body.error.code).toBe('OAUTH_NOT_CONFIGURED');
    }
  });
});
