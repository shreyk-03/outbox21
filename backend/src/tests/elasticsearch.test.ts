import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getElasticClient, emailIndexName, resetElasticClient } from '../lib/elasticsearch.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { indexEmailById, indexEmailByIdSafe, searchEmails } from '../services/email-search.service.js';
import { processEmailJob, type ProcessableEmailJob } from '../workers/email.worker.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const app = createApp();
const agent = request(app);
const TAG = `phase5-es-${Date.now()}`;

let userA: TestIdentity;
let userB: TestIdentity;

async function createRow(owner: TestIdentity, recipient: string, subject: string, body: string) {
  const campaign = await prisma.emailCampaign.create({
    data: {
      userId: owner.userId,
      senderId: owner.senderId,
      subject,
      body,
      startTime: new Date(),
      delayMs: 0,
      hourlyLimit: 100,
    },
  });
  return prisma.scheduledEmail.create({
    data: {
      campaignId: campaign.id,
      userId: owner.userId,
      senderId: owner.senderId,
      recipient,
      subject,
      body,
      scheduledAt: new Date(),
    },
  });
}

async function refresh(): Promise<void> {
  await getElasticClient().indices.refresh({ index: emailIndexName() });
}

beforeAll(async () => {
  await cleanupTestData(TAG);
  userA = await createTestIdentity(TAG, 'a');
  userB = await createTestIdentity(TAG, 'b');
}, 30_000);

afterAll(async () => {
  await getElasticClient()
    .deleteByQuery({ index: emailIndexName(), query: { prefix: { recipient: `${TAG}-` } } })
    .catch(() => undefined);
  resetElasticClient();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('elasticsearch: indexing', () => {
  it('indexes a scheduled email with useful fields and no secrets', async () => {
    const row = await createRow(userA, `${TAG}-index@example.com`, `${TAG} welcome`, 'hello body');
    await indexEmailById(row.id);
    await refresh();
    const doc = await getElasticClient().get({ index: emailIndexName(), id: row.id });
    const src = doc._source as Record<string, unknown>;
    expect(src.recipient).toBe(`${TAG}-index@example.com`);
    expect(src.status).toBe('SCHEDULED');
    expect(src.userId).toBe(userA.userId);
    expect(JSON.stringify(src)).not.toContain('accessToken');
    expect(src).not.toHaveProperty('accessToken');
  });

  it('updates the document on SENT and FAILED', async () => {
    const row = await createRow(userA, `${TAG}-status@example.com`, `${TAG} status`, 'body');
    await prisma.scheduledEmail.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
    await indexEmailById(row.id);
    await refresh();
    const sent = (await getElasticClient().get({ index: emailIndexName(), id: row.id }))._source as Record<string, unknown>;
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toBeTruthy();

    await prisma.scheduledEmail.update({
      where: { id: row.id },
      data: { status: 'FAILED', errorMessage: 'smtp boom' },
    });
    await indexEmailById(row.id);
    await refresh();
    const failed = (await getElasticClient().get({ index: emailIndexName(), id: row.id }))._source as Record<string, unknown>;
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toBe('smtp boom');
  });

  it('safe wrapper never throws (missing row)', async () => {
    await expect(indexEmailByIdSafe('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});

describe('elasticsearch: search API', () => {
  it('finds by recipient, subject, and body — own emails only', async () => {
    await createRow(userA, `${TAG}-findme@example.com`, `${TAG} subject unicorn`, `${TAG} body rainbow`);
    await createRow(userB, `${TAG}-other@example.com`, `${TAG} subject unicorn`, `${TAG} body rainbow`);
    // Index all TAG rows for both users.
    const rows = await prisma.scheduledEmail.findMany({ where: { recipient: { startsWith: `${TAG}-` } } });
    for (const r of rows) await indexEmailById(r.id);
    await refresh();

    const byRecipient = await agent.get('/api/emails/search').set('Cookie', userA.cookie).query({ q: `${TAG}-findme` });
    expect(byRecipient.status).toBe(200);
    expect(byRecipient.body.emails.map((e: { recipient: string }) => e.recipient)).toContain(`${TAG}-findme@example.com`);
    expect(byRecipient.body.emails.map((e: { recipient: string }) => e.recipient)).not.toContain(`${TAG}-other@example.com`);

    const bySubject = await agent.get('/api/emails/search').set('Cookie', userA.cookie).query({ q: 'unicorn' });
    expect(bySubject.body.emails.length).toBeGreaterThan(0);
    for (const e of bySubject.body.emails) expect(e.id).toBeTruthy();

    const byBody = await agent.get('/api/emails/search').set('Cookie', userA.cookie).query({ q: 'rainbow' });
    expect(byBody.body.emails.length).toBeGreaterThan(0);
  });

  it('service-level search never leaks across users', async () => {
    const hits = await searchEmails(userB.userId, `${TAG}-findme`);
    expect(hits.map((h) => h.recipient)).not.toContain(`${TAG}-findme@example.com`);
  });

  it('rejects empty queries and unauthenticated callers', async () => {
    const empty = await agent.get('/api/emails/search').set('Cookie', userA.cookie).query({ q: '   ' });
    expect(empty.status).toBe(400);
    const unauth = await agent.get('/api/emails/search').query({ q: 'x' });
    expect(unauth.status).toBe(401);
  });
});

describe('elasticsearch: failure isolation', () => {
  it('indexing failure does not break sending', async () => {
    const row = await createRow(userA, `${TAG}-iso@example.com`, 'iso', 'body');
    let senderCalls = 0;
    const job: ProcessableEmailJob = { id: 'iso-job', data: { emailId: row.id }, attemptsMade: 0, opts: { attempts: 3 } };
    const outcome = await processEmailJob(job, {
      sender: async () => {
        senderCalls += 1;
        return { messageId: 'm', previewUrl: null };
      },
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() }),
      onRateLimit: async () => undefined,
      indexEmail: async () => {
        throw new Error('elasticsearch is down');
      },
    });
    expect(outcome).toBe('sent');
    expect(senderCalls).toBe(1);
    expect((await prisma.scheduledEmail.findUnique({ where: { id: row.id } }))?.status).toBe('SENT');
  });
});
