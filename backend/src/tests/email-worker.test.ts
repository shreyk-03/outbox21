import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { closeEmailQueue, defaultEmailJobOptions, getEmailQueue } from '../queues/email.queue.js';
import { scheduleEmail } from '../services/email-scheduler.service.js';
import type { SendEmailInput, SendEmailResult } from '../services/email.service.js';
import {
  closeEmailWorker,
  createEmailWorker,
  processEmailJob,
  type EmailSender,
  type ProcessableEmailJob,
} from '../workers/email.worker.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const TAG = `phase4-worker-${Date.now()}`;
let identity: TestIdentity;

// Isolated Redis queue: parallel test files must never share jobs.
process.env.EMAIL_QUEUE_NAME = `email-send-${TAG}`;

function stubJob(emailId: string | undefined, attemptsMade = 0): ProcessableEmailJob {
  return { id: `test-job-${Math.random().toString(36).slice(2)}`, data: { emailId: emailId as string }, attemptsMade, opts: { attempts: 3 } };
}

function recordingSender(failuresBeforeSuccess = 0, delayMs = 0) {
  const calls: SendEmailInput[] = [];
  let failuresLeft = failuresBeforeSuccess;
  const fn = async (input: SendEmailInput): Promise<SendEmailResult> => {
    calls.push(input);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw new Error('smtp transient failure');
    }
    return { messageId: 'test-msg', previewUrl: null };
  };
  return { calls, fn };
}

/**
 * Phase 4 unit tests exercise claim/send logic with an always-available slot
 * (real reservation is covered by the rate-limit suite + live e2e below).
 */
function immediateDeps(fn: EmailSender) {
  return {
    sender: fn,
    reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() }),
    onRateLimit: async () => undefined,
    indexEmail: async () => undefined,
  };
}

async function createScheduledRow(recipient = 'worker@example.com') {
  const campaign = await prisma.emailCampaign.create({
    data: {
      userId: identity.userId,
      senderId: identity.senderId,
      subject: 'Worker test',
      body: 'Hello worker',
      startTime: new Date(),
      delayMs: 0,
      hourlyLimit: 100,
    },
  });
  return prisma.scheduledEmail.create({
    data: {
      campaignId: campaign.id,
      userId: identity.userId,
      senderId: identity.senderId,
      recipient,
      subject: 'Worker test',
      body: 'Hello worker',
      scheduledAt: new Date(),
    },
  });
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  await cleanupTestData(TAG);
  identity = await createTestIdentity(TAG, 'w');
});

afterAll(async () => {
  await closeEmailWorker();
  await getEmailQueue().obliterate({ force: true }).catch(() => undefined);
  await closeEmailQueue();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('worker: state transitions', () => {
  it('SCHEDULED → PROCESSING → SENT, sender called once with row data', async () => {
    const row = await createScheduledRow();
    const { calls, fn } = recordingSender();
    const outcome = await processEmailJob(stubJob(row.id), immediateDeps(fn));
    expect(outcome).toBe('sent');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ to: row.recipient, subject: row.subject, body: row.body });
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('SENT');
    expect(after?.sentAt).toBeTruthy();
  });

  it('already SENT email is not sent again', async () => {
    const row = await createScheduledRow('sent@example.com');
    await prisma.scheduledEmail.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
    const { calls, fn } = recordingSender();
    expect(await processEmailJob(stubJob(row.id), immediateDeps(fn))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('FAILED email is not resent', async () => {
    const row = await createScheduledRow('failed@example.com');
    await prisma.scheduledEmail.update({ where: { id: row.id }, data: { status: 'FAILED', errorMessage: 'old' } });
    const { calls, fn } = recordingSender();
    expect(await processEmailJob(stubJob(row.id), immediateDeps(fn))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('missing email record does not throw', async () => {
    const { calls, fn } = recordingSender();
    expect(await processEmailJob(stubJob('00000000-0000-0000-0000-000000000000'), immediateDeps(fn))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('malformed job (no emailId) does not throw', async () => {
    const { calls, fn } = recordingSender();
    expect(await processEmailJob(stubJob(undefined), immediateDeps(fn))).toBe('skipped');
    expect(calls).toHaveLength(0);
  });
});

describe('worker: retries and failure', () => {
  it('retryable failure keeps PROCESSING, records error, and throws', async () => {
    const row = await createScheduledRow('retry@example.com');
    const { calls, fn } = recordingSender(Number.POSITIVE_INFINITY);
    await expect(processEmailJob(stubJob(row.id, 0), immediateDeps(fn))).rejects.toThrow('smtp transient failure');
    expect(calls).toHaveLength(1);
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('PROCESSING');
    expect(after?.errorMessage).toContain('smtp transient failure');
  });

  it('exhausted attempts → FAILED with error message', async () => {
    const row = await createScheduledRow('exhausted@example.com');
    const { fn } = recordingSender(Number.POSITIVE_INFINITY);
    await expect(processEmailJob(stubJob(row.id, 2), immediateDeps(fn))).rejects.toThrow();
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('FAILED');
    expect(after?.errorMessage).toContain('smtp transient failure');
  });

  it('queue defaults: 3 attempts with exponential backoff', () => {
    const opts = defaultEmailJobOptions();
    expect(opts.attempts).toBe(3);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 5000 });
  });
});

describe('worker: concurrency safety', () => {
  it('two concurrent deliveries claim once; sender runs exactly once', async () => {
    const row = await createScheduledRow('race@example.com');
    const { calls, fn } = recordingSender(0, 150);
    const results = await Promise.allSettled([processEmailJob(stubJob(row.id), immediateDeps(fn)), processEmailJob(stubJob(row.id), immediateDeps(fn))]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('SENT');
  });
});

describe('worker: live BullMQ end-to-end (real Redis)', () => {
  it(
    'scheduled email flows through the real queue to SENT',
    async () => {
      const { calls, fn } = recordingSender();
      const worker = createEmailWorker({ sender: fn, concurrency: 2 });

      const scheduled = await scheduleEmail(identity.userId, {
        senderId: identity.senderId,
        recipient: 'live@example.com',
        subject: 'Live queue',
        body: 'Through Redis',
        scheduledAt: new Date(Date.now() + 1500).toISOString(),
      });
      expect(scheduled.status).toBe('SCHEDULED');

      await waitFor(async () => {
        const row = await prisma.scheduledEmail.findUnique({ where: { id: scheduled.id } });
        return row?.status === 'SENT';
      }, 25_000);

      // The shared test queue may hold other files' jobs (vitest runs files
      // in parallel); assert exactly one delivery for OUR recipient.
      const liveCalls = calls.filter((c) => c.to === 'live@example.com');
      expect(liveCalls).toHaveLength(1);
      await worker.close();
    },
    30_000,
  );
});
