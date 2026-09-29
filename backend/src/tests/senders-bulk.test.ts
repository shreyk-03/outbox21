import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { closeEmailQueue, getEmailQueue } from '../queues/email.queue.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const app = createApp();
const agent = request(app);
const TAG = `phase6-api-${Date.now()}`;

// Isolated Redis queue: parallel test files must never share jobs.
process.env.EMAIL_QUEUE_NAME = `email-send-${TAG}`;

let userA: TestIdentity;
let userB: TestIdentity;

function futureIso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

beforeAll(async () => {
  await cleanupTestData(TAG);
  userA = await createTestIdentity(TAG, 'a');
  userB = await createTestIdentity(TAG, 'b');
});

afterAll(async () => {
  await getEmailQueue().obliterate({ force: true }).catch(() => undefined);
  await closeEmailQueue();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('senders API', () => {
  it('rejects unauthenticated list/create (401)', async () => {
    expect((await agent.get('/api/senders')).status).toBe(401);
    expect((await agent.post('/api/senders').send({ email: 'x@example.com', name: 'X' })).status).toBe(401);
  });

  it('lists only the caller’s senders', async () => {
    const res = await agent.get('/api/senders').set('Cookie', userA.cookie);
    expect(res.status).toBe(200);
    expect(res.body.senders).toHaveLength(1);
    expect(res.body.senders[0]).toMatchObject({ id: userA.senderId, hourlyLimit: 100 });
    expect(res.body.senders[0]).not.toHaveProperty('userId');
  });

  it('creates a sender with validation', async () => {
    const ok = await agent
      .post('/api/senders')
      .set('Cookie', userA.cookie)
      .send({ email: 'New-Sender@Example.com', name: 'Newsletter', hourlyLimit: 50 });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ email: 'new-sender@example.com', name: 'Newsletter', hourlyLimit: 50 });

    const bad = await agent.post('/api/senders').set('Cookie', userA.cookie).send({ email: 'nope', name: '' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects duplicate sender email per user (409), allows same email for another user', async () => {
    const dup = await agent
      .post('/api/senders')
      .set('Cookie', userA.cookie)
      .send({ email: 'new-sender@example.com', name: 'Dupe' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SENDER_EXISTS');

    const other = await agent
      .post('/api/senders')
      .set('Cookie', userB.cookie)
      .send({ email: 'new-sender@example.com', name: 'Theirs' });
    expect(other.status).toBe(201);
  });
});

describe('POST /api/emails/schedule/bulk', () => {
  it('rejects unauthenticated requests (401)', async () => {
    const res = await agent.post('/api/emails/schedule/bulk').send({
      senderId: userA.senderId,
      subject: 'Hi',
      body: 'Hello',
      scheduledAt: futureIso(60_000),
      recipients: ['x@example.com'],
    });
    expect(res.status).toBe(401);
  });

  it('validates input (400): bad recipient, empty list, oversize list, bad delay', async () => {
    const base = {
      senderId: userA.senderId,
      subject: 'Hi',
      body: 'Hello',
      scheduledAt: futureIso(60_000),
      delayMs: 2000,
    };
    const badRecipient = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({ ...base, recipients: ['ok@example.com', 'not-an-email'] });
    expect(badRecipient.status).toBe(400);

    const empty = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({ ...base, recipients: [] });
    expect(empty.status).toBe(400);

    const huge = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({ ...base, recipients: Array.from({ length: 1001 }, (_, i) => `u${i}@example.com`) });
    expect(huge.status).toBe(400);

    const badDelay = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({ ...base, delayMs: -5, recipients: ['ok@example.com'] });
    expect(badDelay.status).toBe(400);
  });

  it('rejects another user’s sender (404)', async () => {
    const res = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userB.senderId,
        subject: 'Hi',
        body: 'Hello',
        scheduledAt: futureIso(60_000),
        recipients: ['x@example.com'],
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SENDER_NOT_FOUND');
  });

  it('schedules a deduped batch with staggered slots and one campaign', async () => {
    const start = Date.now() + 120_000;
    const res = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userA.senderId,
        subject: 'Batch hello',
        body: 'Batch body',
        scheduledAt: new Date(start).toISOString(),
        delayMs: 5000,
        recipients: ['B-One@Example.com', 'b-two@example.com', 'b-one@example.com'],
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      totalRecipients: 2,
      scheduled: 2,
      failed: 0,
      duplicatesRemoved: 1,
      status: 'scheduled',
    });
    expect(res.body.campaignId).toBeTruthy();

    const rows = await prisma.scheduledEmail.findMany({
      where: { campaignId: res.body.campaignId },
      orderBy: { scheduledAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.recipient)).toEqual(['b-one@example.com', 'b-two@example.com']);
    expect(rows[1].scheduledAt.getTime() - rows[0].scheduledAt.getTime()).toBe(5000);
    for (const row of rows) {
      expect(row.bullmqJobId).toBeTruthy();
      const job = await getEmailQueue().getJob(row.bullmqJobId as string);
      expect(job).toBeTruthy();
      expect(job?.data).toEqual({ emailId: row.id, slotMs: row.scheduledAt.getTime() });
      expect(job?.opts.delay).toBeGreaterThan(0);
    }

    const campaign = await prisma.emailCampaign.findUnique({ where: { id: res.body.campaignId } });
    expect(campaign?.hourlyLimit).toBe(100);
    expect(campaign?.delayMs).toBe(5000);
  });

  it('past start time yields immediate (zero-delay) first slot', async () => {
    const res = await agent
      .post('/api/emails/schedule/bulk')
      .set('Cookie', userA.cookie)
      .send({
        senderId: userA.senderId,
        subject: 'Now',
        body: 'Immediate',
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
        delayMs: 1000,
        recipients: ['now-bulk@example.com'],
      });
    expect(res.status).toBe(201);
    expect(res.body.scheduled).toBe(1);
    const row = await prisma.scheduledEmail.findFirst({ where: { recipient: 'now-bulk@example.com' } });
    const job = await getEmailQueue().getJob(row?.bullmqJobId as string);
    expect(job?.opts.delay).toBe(0);
  });
});
