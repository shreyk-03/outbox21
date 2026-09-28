import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const app = createApp();
const agent = request(app);
const TAG = `phase5-board-${Date.now()}`;

let admin: TestIdentity;
let other: TestIdentity;

beforeAll(async () => {
  await cleanupTestData(TAG);
  admin = await createTestIdentity(TAG, 'admin');
  other = await createTestIdentity(TAG, 'other');
  delete process.env.BULL_BOARD_ADMIN_EMAIL;
});

afterAll(async () => {
  delete process.env.BULL_BOARD_ADMIN_EMAIL;
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('bull board', () => {
  it('unauthenticated callers cannot access it', async () => {
    const res = await agent.get('/admin/queues/');
    expect(res.status).toBe(401);
  });

  it('is disabled (404) when no admin email is configured', async () => {
    const res = await agent.get('/admin/queues/').set('Cookie', admin.cookie);
    expect(res.status).toBe(404);
  });

  it('non-admin authenticated users get 403', async () => {
    process.env.BULL_BOARD_ADMIN_EMAIL = admin.userId + '@example.com';
    const res = await agent.get('/admin/queues/').set('Cookie', other.cookie);
    expect(res.status).toBe(403);
  });

  it('the configured admin can load the dashboard', async () => {
    // createTestIdentity builds `${TAG}-admin@example.com` (already lowercase).
    process.env.BULL_BOARD_ADMIN_EMAIL = `${TAG}-admin@example.com`;
    const res = await agent.get('/admin/queues/').set('Cookie', admin.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});
