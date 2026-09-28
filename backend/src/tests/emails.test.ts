import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { closeEmailQueue, emailJobId, getEmailQueue } from '../queues/email.queue.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const app = createApp();
const agent = request(app);
const TAG = `phase4-api-${Date.now()}`;

let userA: TestIdentity;
let userB: TestIdentity;
const jobIds: string[] = [];

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

beforeAll(async () => {
  await cleanupTestData(TAG);
  userA = await createTestIdentity(TAG, 'a');
  userB = await createTestIdentity(TAG, 'b');
});

afterAll(async () => {
  for (const jobId of jobIds) {
    await getEmailQueue().getJob(jobId).then((j) => j?.remove()).catch(() => undefined);
  }
  await closeEmailQueue();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('POST /api/emails/schedule', () => {
  it('rejects unauthenticated requests (401)', async () => {
    const res = await agent.post('/api/emails/schedule').send({
      senderId: userA.senderId,
      recipient: 'x@example.com',
      subject: 'Hi',
      body: 'Hello',
      scheduledAt: futureIso(60_000),
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects invalid input with 400', async () => {
    const cases: Array<{ overrides: Record<string, string> }> = [
      { overrides: { recipient: 'not-an-email', subject: 'Hi', body: 'Hello' } },
      { overrides: { recipient: 'ok@example.com', subject: '', body: 'Hello' } },
      { overrides: { recipient: 'ok@example.com', subject: 'Hi', body: '' } },
      { overrides: { recipient: 'ok@example.com', subject: 'Hi', body: 'Hello', scheduledAt: 'not-a-date' } },
      { overrides: { recipient: 'ok@example.com', subject: 'Hi', body: 'Hello', senderId: 'not-a-uuid' } },
    ];
    for (const { overrides } of cases) {
      const res = await agent
        .post('/api/emails/schedule')
        .set('Cookie', userA.cookie)
        .send({ senderId: userA.senderId, scheduledAt: futureIso(60_000), ...overrides });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it("rejects another user's sender (404, ownership-safe)", async () => {
    const res = await agent
      .post('/api/emails/schedule')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userB.senderId,
        recipient: 'x@example.com',
        subject: 'Hi',
        body: 'Hello',
        scheduledAt: futureIso(60_000),
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SENDER_NOT_FOUND');
  });

  it('schedules future email: DB row + delayed BullMQ job', async () => {
    const res = await agent
      .post('/api/emails/schedule')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userA.senderId,
        recipient: 'future@example.com',
        subject: 'Future',
        body: 'See you soon',
        scheduledAt: futureIso(120_000),
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'SCHEDULED', recipient: 'future@example.com' });
    expect(res.body.id).toBeTruthy();
    expect(res.body.bullmqJobId).toBe(emailJobId(res.body.id));
    expect(res.body.delayMs).toBeGreaterThan(0);
    jobIds.push(res.body.bullmqJobId);

    const row = await prisma.scheduledEmail.findUnique({ where: { id: res.body.id } });
    expect(row?.status).toBe('SCHEDULED');
    expect(row?.bullmqJobId).toBe(res.body.bullmqJobId);

    const job = await getEmailQueue().getJob(res.body.bullmqJobId);
    expect(job).toBeTruthy();
    expect(job?.data).toEqual({ emailId: res.body.id });
    expect(job?.opts.delay).toBeGreaterThan(0);
  });

  it('past scheduledAt results in zero delay', async () => {
    const res = await agent
      .post('/api/emails/schedule')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userA.senderId,
        recipient: 'now@example.com',
        subject: 'Now',
        body: 'Immediately',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.delayMs).toBe(0);
    jobIds.push(res.body.bullmqJobId);
    const job = await getEmailQueue().getJob(res.body.bullmqJobId);
    expect(job?.opts.delay).toBe(0);
  });

  it('response exposes no internal connection details', async () => {
    const res = await agent
      .post('/api/emails/schedule')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userA.senderId,
        recipient: 'clean@example.com',
        subject: 'Clean',
        body: 'No secrets',
        scheduledAt: futureIso(300_000),
      });
    jobIds.push(res.body.bullmqJobId);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('redis');
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('DATABASE_URL');
  });
});

describe('GET /api/emails/scheduled, /sent, /:id', () => {
  it('scheduled returns only own pending emails, oldest first', async () => {
    // B owns a pending email that A must never see.
    const bRes = await agent
      .post('/api/emails/schedule')
      .set('Cookie', userB.cookie)
      .send({
        senderId: userB.senderId,
        recipient: 'b-hidden@example.com',
        subject: 'Hidden',
        body: 'Not for A',
        scheduledAt: futureIso(400_000),
      });
    jobIds.push(bRes.body.bullmqJobId);

    const res = await agent.get('/api/emails/scheduled').set('Cookie', userA.cookie);
    expect(res.status).toBe(200);
    const recipients: string[] = res.body.emails.map((e: { recipient: string }) => e.recipient);
    expect(recipients).not.toContain('b-hidden@example.com');
    expect(res.body.emails.length).toBeGreaterThan(0);
    for (const e of res.body.emails) {
      expect(['SCHEDULED', 'PROCESSING']).toContain(e.status);
    }
    const times = res.body.emails.map((e: { scheduledAt: string }) => new Date(e.scheduledAt).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('sent returns only own SENT emails', async () => {
    const email = await prisma.scheduledEmail.findFirst({ where: { userId: userA.userId } });
    await prisma.scheduledEmail.update({ where: { id: email!.id }, data: { status: 'SENT', sentAt: new Date() } });

    const res = await agent.get('/api/emails/sent').set('Cookie', userA.cookie);
    expect(res.status).toBe(200);
    expect(res.body.emails.length).toBeGreaterThan(0);
    for (const e of res.body.emails) {
      expect(e.status).toBe('SENT');
    }
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('b-hidden@example.com');
  });

  it('detail returns own email with body; 404 for others/missing/malformed', async () => {
    const own = await prisma.scheduledEmail.findFirst({ where: { userId: userA.userId } });
    const ok = await agent.get(`/api/emails/${own!.id}`).set('Cookie', userA.cookie);
    expect(ok.status).toBe(200);
    expect(ok.body.id).toBe(own!.id);
    expect(ok.body.body).toBeTruthy();

    const other = await prisma.scheduledEmail.findFirst({ where: { userId: userB.userId } });
    const forbidden = await agent.get(`/api/emails/${other!.id}`).set('Cookie', userA.cookie);
    expect(forbidden.status).toBe(404);

    const missing = await agent.get('/api/emails/00000000-0000-0000-0000-000000000000').set('Cookie', userA.cookie);
    expect(missing.status).toBe(404);

    const malformed = await agent.get('/api/emails/not-a-uuid').set('Cookie', userA.cookie);
    expect(malformed.status).toBe(404);
  });

  it('list/detail endpoints require auth', async () => {
    expect((await agent.get('/api/emails/scheduled')).status).toBe(401);
    expect((await agent.get('/api/emails/sent')).status).toBe(401);
    expect((await agent.get('/api/emails/00000000-0000-0000-0000-000000000000')).status).toBe(401);
  });
});
