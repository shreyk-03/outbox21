import Redis from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import { closeEmailQueue, getEmailQueue } from '../queues/email.queue.js';
import {
  claimSendSlot,
  closeReservationClient,
  nextHourBoundaryMs,
  rateKeyFor,
  reserveSendSlot,
  throttleKeyFor,
  utcHourBucket,
} from '../services/send-reservation.service.js';
import { processEmailJob, type ProcessableEmailJob } from '../workers/email.worker.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const TAG = `phase5-rate-${Date.now()}`;
let identity: TestIdentity;

// Isolated Redis queue: parallel test files must never share jobs.
process.env.EMAIL_QUEUE_NAME = `email-send-${TAG}`;

function senderKey(n: number): string {
  return `${TAG}-sender-${n}`;
}

function stubJob(emailId: string, attemptsMade = 0, slotMs?: number, reserved?: boolean): ProcessableEmailJob {
  return {
    id: `rl-job-${Math.random().toString(36).slice(2)}`,
    data: { emailId, ...(slotMs === undefined ? {} : { slotMs }), ...(reserved ? { reserved } : {}) },
    attemptsMade,
    opts: { attempts: 3 },
  };
}

const noopDeps = {
  sender: async () => ({ messageId: 'x', previewUrl: null }),
  onRateLimit: async () => undefined,
  indexEmail: async () => undefined,
  gate: async () => ({ allowed: true as const, retryInMs: 0 }),
};

beforeAll(async () => {
  await cleanupTestData(TAG);
  identity = await createTestIdentity(TAG, 'rl');
});

afterAll(async () => {
  // Remove any delayed replacement jobs created by reschedule tests.
  await getEmailQueue().getDelayed().then((jobs) => Promise.all(jobs.map((j) => j.remove()))).catch(() => undefined);
  await getEmailQueue().obliterate({ force: true }).catch(() => undefined);
  await closeEmailQueue();
  await closeReservationClient();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('rate limit: hourly bucket', () => {
  it('allows sends below the limit', async () => {
    const sid = senderKey(1);
    for (let i = 0; i < 3; i++) {
      const r = await reserveSendSlot(sid, { hourlyLimit: 5, minDelayMs: 0 });
      expect(r.allowed).toBe(true);
    }
  });

  it('rejects exactly at the limit with retry at next boundary', async () => {
    const sid = senderKey(2);
    const nowMs = Date.now();
    const boundary = nextHourBoundaryMs(nowMs);
    for (let i = 0; i < 2; i++) {
      expect((await reserveSendSlot(sid, { hourlyLimit: 2, minDelayMs: 0 })).allowed).toBe(true);
    }
    const over = await reserveSendSlot(sid, { hourlyLimit: 2, minDelayMs: 0 });
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(over.reason).toBe('RATE_LIMIT');
      expect(over.retryAtMs).toBe(boundary);
    }
  });

  it('different senders have independent limits', async () => {
    const full = senderKey(3);
    const fresh = senderKey(4);
    for (let i = 0; i < 2; i++) {
      await reserveSendSlot(full, { hourlyLimit: 2, minDelayMs: 0 });
    }
    expect((await reserveSendSlot(full, { hourlyLimit: 2, minDelayMs: 0 })).allowed).toBe(false);
    expect((await reserveSendSlot(fresh, { hourlyLimit: 2, minDelayMs: 0 })).allowed).toBe(true);
  });

  it('new hour allows sending again (synthetic buckets)', async () => {
    const sid = senderKey(5);
    const hourA = '2000-01-01T10';
    const hourB = '2000-01-01T11';
    const boundary = Date.parse('2000-01-01T11:00:00Z');
    const nowA = Date.parse('2000-01-01T10:30:00Z');
    for (let i = 0; i < 2; i++) {
      const r = await reserveSendSlot(sid, {
        hourlyLimit: 2,
        minDelayMs: 0,
        nowMs: nowA,
        currentBucket: hourA,
        nextBucket: hourB,
        boundaryMs: boundary,
      });
      expect(r.allowed).toBe(true);
    }
    const full = await reserveSendSlot(sid, {
      hourlyLimit: 2,
      minDelayMs: 0,
      nowMs: nowA,
      currentBucket: hourA,
      nextBucket: hourB,
      boundaryMs: boundary,
    });
    expect(full.allowed).toBe(false);
    // Next hour, same sender: capacity is fresh.
    const next = await reserveSendSlot(sid, {
      hourlyLimit: 2,
      minDelayMs: 0,
      nowMs: boundary + 1000,
      currentBucket: hourB,
      nextBucket: '2000-01-01T12',
      boundaryMs: boundary + 3_600_000,
    });
    expect(next.allowed).toBe(true);
  });
});

describe('rate limit: minimum delay', () => {
  it('spaces reservations by minDelayMs', async () => {
    const sid = senderKey(6);
    const t0 = Date.now();
    const first = await reserveSendSlot(sid, { hourlyLimit: 100, minDelayMs: 5000, nowMs: t0 });
    expect(first.allowed).toBe(true);
    if (first.allowed) expect(first.sendAtMs).toBe(t0);
    const second = await reserveSendSlot(sid, { hourlyLimit: 100, minDelayMs: 5000, nowMs: t0 + 100 });
    expect(second.allowed).toBe(true);
    if (second.allowed) expect(second.sendAtMs).toBe(t0 + 5000);
  });

  it('concurrent reservations serialize slots (no two share a slot)', async () => {
    const sid = senderKey(7);
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reserveSendSlot(sid, { hourlyLimit: 100, minDelayMs: 1000, nowMs: t0 }),
      ),
    );
    const slots = results.flatMap((r) => (r.allowed ? [r.sendAtMs] : []));
    expect(slots).toHaveLength(5);
    expect(new Set(slots).size).toBe(5);
    expect(Math.max(...slots) - Math.min(...slots)).toBe(4000);
  });

  it('concurrent reservations cannot exceed the hourly limit', async () => {
    const sid = senderKey(8);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => reserveSendSlot(sid, { hourlyLimit: 3, minDelayMs: 0 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(results.filter((r) => !r.allowed)).toHaveLength(7);
  });
});

describe('rate limit: persistence', () => {
  it('counters survive a fresh connection (worker restart equivalent)', async () => {
    const sid = senderKey(9);
    await reserveSendSlot(sid, { hourlyLimit: 1, minDelayMs: 0 });
    // A brand-new client = what a restarted worker would see. Nothing in memory.
    const fresh = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
    try {
      const count = await fresh.get(rateKeyFor(sid, utcHourBucket(Date.now())));
      expect(count).toBe('1');
      const throttle = await fresh.get(throttleKeyFor(sid));
      expect(throttle).toBeTruthy();
    } finally {
      fresh.disconnect();
    }
    expect((await reserveSendSlot(sid, { hourlyLimit: 1, minDelayMs: 0 })).allowed).toBe(false);
  });
});

describe('worker: rescheduling', () => {
  async function createRow() {
    const campaign = await prisma.emailCampaign.create({
      data: {
        userId: identity.userId,
        senderId: identity.senderId,
        subject: 'Reschedule me',
        body: 'Hello',
        startTime: new Date(),
        delayMs: 0,
        hourlyLimit: 1,
      },
    });
    return prisma.scheduledEmail.create({
      data: {
        campaignId: campaign.id,
        userId: identity.userId,
        senderId: identity.senderId,
        recipient: `rs-${Math.random().toString(36).slice(2)}@example.com`,
        subject: 'Reschedule me',
        body: 'Hello',
        scheduledAt: new Date(),
      },
    });
  }

  it('rate-limited email returns to SCHEDULED with a future slot + replacement job', async () => {
    const row = await createRow();
    const retryAt = Date.now() + 60_000;
    let alerted = 0;
    const outcome = await processEmailJob(stubJob(row.id), {
      ...noopDeps,
      reserve: async () => ({ allowed: false as const, reason: 'RATE_LIMIT' as const, retryAtMs: retryAt }),
      onRateLimit: async () => {
        alerted += 1;
      },
    });
    expect(outcome).toBe('rescheduled');
    expect(alerted).toBe(1);
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('SCHEDULED');
    expect(after?.scheduledAt.getTime()).toBe(retryAt);
    expect(after?.bullmqJobId).toContain(row.id);
    const job = await getEmailQueue().getJob(after!.bullmqJobId as string);
    expect(job).toBeTruthy();
    expect(job?.data.emailId).toBe(row.id);
    await job?.remove();
  });

  it('min-delay slot in the future reschedules without consuming a retry', async () => {
    const row = await createRow();
    const slot = Date.now() + 30_000;
    const outcome = await processEmailJob(stubJob(row.id), {
      ...noopDeps,
      reserve: async () => ({ allowed: true as const, sendAtMs: slot }),
    });
    expect(outcome).toBe('rescheduled');
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('SCHEDULED');
    const job = await getEmailQueue().getJob(after!.bullmqJobId as string);
    expect(job?.opts.delay).toBeGreaterThan(0);
    await job?.remove();
  });

  it('rescheduled email stays eligible and sends when capacity exists', async () => {
    const row = await createRow();
    let calls = 0;
    // First execution: hour full → rescheduled.
    const first = await processEmailJob(stubJob(row.id), {
      ...noopDeps,
      reserve: async () => ({ allowed: false as const, reason: 'RATE_LIMIT' as const, retryAtMs: Date.now() + 1000 }),
    });
    expect(first).toBe('rescheduled');
    // Replacement fires later with capacity → sends.
    const second = await processEmailJob(stubJob(row.id, 0), {
      ...noopDeps,
      sender: async () => {
        calls += 1;
        return { messageId: 'm', previewUrl: null };
      },
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() }),
    });
    expect(second).toBe('sent');
    expect(calls).toBe(1);
    expect((await prisma.scheduledEmail.findUnique({ where: { id: row.id } }))?.status).toBe('SENT');
  });
});

describe('send gate: atomic spacing', () => {
  async function createGateRow() {
    const campaign = await prisma.emailCampaign.create({
      data: {
        userId: identity.userId,
        senderId: identity.senderId,
        subject: 'Gate test',
        body: 'Hello',
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
        recipient: `gate-${Math.random().toString(36).slice(2)}@example.com`,
        subject: 'Gate test',
        body: 'Hello',
        scheduledAt: new Date(),
      },
    });
  }

  it('admits exactly one of many concurrent contenders', async () => {
    const sid = senderKey(20);
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimSendSlot(sid, { minDelayMs: 5000, nowMs: t0 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(1);
    expect(results.filter((r) => !r.allowed)).toHaveLength(7);
  });

  it('denies within the window with retryIn, admits after it (deterministic clock)', async () => {
    const sid = senderKey(21);
    const t0 = 1_700_000_000_000;
    expect(await claimSendSlot(sid, { minDelayMs: 2000, nowMs: t0 })).toEqual({ allowed: true, retryInMs: 0 });
    const denied = await claimSendSlot(sid, { minDelayMs: 2000, nowMs: t0 + 500 });
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.retryInMs).toBe(1500);
    expect(await claimSendSlot(sid, { minDelayMs: 2000, nowMs: t0 + 2000 })).toEqual({
      allowed: true,
      retryInMs: 0,
    });
  });

  it('processor reschedules (without retry) when the gate is busy', async () => {
    const row = await createGateRow();
    let calls = 0;
    const outcome = await processEmailJob(stubJob(row.id), {
      ...noopDeps,
      sender: async () => {
        calls += 1;
        return { messageId: 'm', previewUrl: null };
      },
      // Stubbed immediate slot: this test exercises the GATE, not bidding,
      // and must not advance the shared throttle (test isolation).
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() }),
      gate: async () => ({ allowed: false as const, retryInMs: 1500 }),
    });
    expect(outcome).toBe('rescheduled');
    expect(calls).toBe(0);
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    expect(after?.status).toBe('SCHEDULED');
    const job = await getEmailQueue().getJob(after!.bullmqJobId as string);
    expect(job).toBeTruthy();
    await job?.remove();
  });

  it('matured slot + busy gate reschedules instead of sending', async () => {
    const row = await createGateRow();
    let calls = 0;
    const outcome = await processEmailJob(stubJob(row.id, 0, Date.now() - 1000, true), {
      ...noopDeps,
      sender: async () => {
        calls += 1;
        return { messageId: 'm', previewUrl: null };
      },
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() }),
      gate: async () => ({ allowed: false as const, retryInMs: 800 }),
    });
    expect(outcome).toBe('rescheduled');
    expect(calls).toBe(0);
    const after = await prisma.scheduledEmail.findUnique({ where: { id: row.id } });
    const job = await getEmailQueue().getJob(after!.bullmqJobId as string);
    await job?.remove();
  });
});

describe('worker: matured slots (anti-livelock)', () => {
  async function createRow() {
    const campaign = await prisma.emailCampaign.create({
      data: {
        userId: identity.userId,
        senderId: identity.senderId,
        subject: 'Slot test',
        body: 'Hello',
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
        recipient: `slot-${Math.random().toString(36).slice(2)}@example.com`,
        subject: 'Slot test',
        body: 'Hello',
        scheduledAt: new Date(),
      },
    });
  }

  it('matured replacement slot sends even when the shared throttle moved ahead', async () => {
    const row = await createRow();
    let calls = 0;
    // Throttle advanced by a sibling, but our paid slot (2s ago) matured → send.
    const outcome = await processEmailJob(stubJob(row.id, 0, Date.now() - 2000, true), {
      ...noopDeps,
      sender: async () => {
        calls += 1;
        return { messageId: 'm', previewUrl: null };
      },
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() + 5000 }),
    });
    expect(outcome).toBe('sent');
    expect(calls).toBe(1);
  });

  it('fresh jobs never honor slots: bursts always serialize through bidding', async () => {
    const row = await createRow();
    // Same situation but an INITIAL job (no reserved flag) → must re-bid.
    const outcome = await processEmailJob(stubJob(row.id, 0, Date.now() - 2000), {
      ...noopDeps,
      reserve: async () => ({ allowed: true as const, sendAtMs: Date.now() + 5000 }),
    });
    expect(outcome).toBe('rescheduled');
  });

  it('long-overdue replacement slot re-bids instead of sending', async () => {
    const row = await createRow();
    const slot = Date.now() + 30_000;
    const outcome = await processEmailJob(stubJob(row.id, 0, Date.now() - 120_000, true), {
      ...noopDeps,
      reserve: async () => ({ allowed: true as const, sendAtMs: slot }),
    });
    expect(outcome).toBe('rescheduled');
  });

  it('two leapfrogging emails converge and both send (real Lua reservation)', async () => {
    const { reserveSendSlot } = await import('../services/send-reservation.service.js');
    const realReserve = (senderId: string, hourlyLimit: number) =>
      reserveSendSlot(senderId, { hourlyLimit, minDelayMs: 300 });
    const mkSender = () => {
      let calls = 0;
      return {
        calls: () => calls,
        sender: async () => {
          calls += 1;
          return { messageId: 'm', previewUrl: null };
        },
      };
    };
    const a = mkSender();
    const b = mkSender();
    const rowA = await createRow();
    const rowB = await createRow();

    // Two fresh jobs bidding: one sends immediately, the other takes a slot.
    const firstA = await processEmailJob(stubJob(rowA.id), { ...noopDeps, sender: a.sender, reserve: realReserve });
    const firstB = await processEmailJob(stubJob(rowB.id), { ...noopDeps, sender: b.sender, reserve: realReserve });
    expect([firstA, firstB].filter((o) => o === 'sent')).toHaveLength(1);
    expect([firstA, firstB].filter((o) => o === 'rescheduled')).toHaveLength(1);

    // The loser re-fires at its paid slot as a replacement job: must send.
    const loserId = firstA === 'sent' ? rowB.id : rowA.id;
    const loser = firstA === 'sent' ? b : a;
    const loserRow = await prisma.scheduledEmail.findUnique({ where: { id: loserId } });
    const waitMs = Math.max(0, loserRow!.scheduledAt.getTime() - Date.now() + 100);
    await new Promise((r) => setTimeout(r, waitMs));
    const second = await processEmailJob(stubJob(loserId, 0, loserRow!.scheduledAt.getTime(), true), {
      ...noopDeps,
      sender: loser.sender,
      reserve: realReserve,
    });
    expect(second).toBe('sent');
    expect(a.calls() + b.calls()).toBe(2);
  }, 30_000);
});
