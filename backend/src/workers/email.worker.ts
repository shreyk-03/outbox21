import { Worker, type Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';
import { emailJobId, emailQueueName, getEmailQueue, type EmailJobData } from '../queues/email.queue.js';
import { sendEmail, type SendEmailInput, type SendEmailResult } from '../services/email.service.js';
import { reserveSendSlot } from '../services/send-reservation.service.js';
import { notifyRateLimitHit } from '../services/slack.service.js';
import { indexEmailByIdSafe } from '../services/email-search.service.js';

export type EmailSender = (input: SendEmailInput) => Promise<SendEmailResult>;

/** Only these fields of a BullMQ job are needed; keeps the processor unit-testable. */
export type ProcessableEmailJob = Pick<Job<EmailJobData>, 'id' | 'data' | 'attemptsMade' | 'opts'>;

export type ProcessOutcome = 'sent' | 'skipped' | 'rescheduled';

export interface RateLimitInfo {
  senderId: string;
  senderEmail: string;
  hourlyLimit: number;
  retryAtMs: number;
}

export interface ProcessDeps {
  sender?: EmailSender;
  reserve?: (senderId: string, hourlyLimit: number) => Promise<{ allowed: true; sendAtMs: number } | { allowed: false; reason: 'RATE_LIMIT'; retryAtMs: number }>;
  onRateLimit?: (info: RateLimitInfo) => Promise<void>;
  indexEmail?: (emailId: string) => Promise<void>;
}

const defaultDeps: Required<ProcessDeps> = {
  sender: sendEmail,
  reserve: (senderId, hourlyLimit) => reserveSendSlot(senderId, { hourlyLimit }),
  onRateLimit: (info) => notifyRateLimitHit(info),
  indexEmail: (emailId) => indexEmailByIdSafe(emailId),
};

/**
 * A PROCESSING row fresher than this is assumed to be owned by a live
 * worker (concurrent duplicate delivery) — not a crash. Older rows are
 * treated as crashed-worker recovery. See processEmailJob.
 */
export const RECOVERY_GRACE_MS = 2 * 60 * 1000;

/**
 * A replacement job firing at/after its already-paid-for slot (within this
 * grace) SENDS instead of re-bidding. Without this, concurrent emails
 * leapfrog the shared throttle watermark forever: each firing finds the
 * watermark advanced by a sibling and reschedules, so nothing ever sends
 * (observed live with attempts climbing and slots drifting +5s per cycle).
 * Only replacement jobs (reserved: true) may honor — initial jobs always bid
 * so bursts serialize. Firing jitter is seconds; anything later re-bids.
 */
export const SLOT_GRACE_MS = 30_000;

function sanitizeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const withoutSecrets =
    env.ETHEREAL_PASSWORD && raw.includes(env.ETHEREAL_PASSWORD)
      ? raw.split(env.ETHEREAL_PASSWORD).join('[redacted]')
      : raw;
  return withoutSecrets.slice(0, 1000);
}

function maxAttemptsFor(job: ProcessableEmailJob): number {
  return job.opts?.attempts ?? env.MAX_ATTEMPTS;
}

/**
 * Move a claimed (PROCESSING) email to a future slot WITHOUT consuming a
 * BullMQ retry: create the replacement delayed job (deterministic id per
 * email+slot), flip the row back to SCHEDULED, and complete the current job
 * successfully. No sleep, no polling, no busy loop — the replacement job
 * re-fires at the right time and re-runs reservation then.
 */
async function rescheduleToSlot(emailId: string, senderId: string, sendAtMs: number): Promise<void> {
  const newJobId = emailJobId(emailId, sendAtMs);
  const delayMs = Math.max(0, sendAtMs - Date.now());
  const queue = getEmailQueue();

  try {
    await queue.add('send', { emailId, slotMs: sendAtMs, reserved: true }, { jobId: newJobId, delay: delayMs });
  } catch (err) {
    if (!/already exists|duplicate/i.test(String((err as Error)?.message ?? err))) throw err;
    logger.info({ emailId, newJobId }, 'replacement job already exists; keeping it');
  }

  try {
    const moved = await prisma.scheduledEmail.updateMany({
      where: { id: emailId, status: 'PROCESSING' },
      data: { status: 'SCHEDULED', scheduledAt: new Date(sendAtMs), bullmqJobId: newJobId },
    });
    if (moved.count === 0) {
      logger.warn({ emailId }, 'row left PROCESSING during reschedule; leaving replacement job to converge');
    }
  } catch (err) {
    await queue
      .getJob(newJobId)
      .then((j) => j?.remove())
      .catch((removeErr) => logger.warn({ removeErr, emailId }, 'failed to remove orphan reschedule job'));
    throw err;
  }
  logger.info({ emailId, newJobId, sendAt: new Date(sendAtMs).toISOString(), delayMs }, 'email rescheduled to future slot');
}

/**
 * Process one email-send job. Database (Prisma) is the source of truth;
 * the job carries only { emailId }.
 *
 * - Missing row → complete silently. SENT / FAILED → complete without sending.
 * - SCHEDULED → atomically claim (conditional UPDATE). Exactly one worker wins.
 * - PROCESSING redelivery → retry (attemptsMade > 0) or stale-claim recovery
 *   proceeds; a fresh claim owned by a live worker throws retryable.
 * - After claiming, reserve a distributed send slot (min delay + hourly
 *   limit, one atomic Lua script). If the slot is in the future → reschedule
 *   (delayed replacement job, no retry consumed). If the hour is full →
 *   reschedule at the next hour boundary + best-effort Slack alert.
 * - Otherwise send via SMTP → SENT (+ES index), or retry/FAILED as Phase 4.
 */
export async function processEmailJob(job: ProcessableEmailJob, deps: ProcessDeps = {}): Promise<ProcessOutcome> {
  const { sender, reserve, onRateLimit, indexEmail } = { ...defaultDeps, ...deps };
  // Structural guarantee: indexing can never break sending, no matter what
  // indexEmail implementation is injected.
  const safeIndex = async (id: string): Promise<void> => {
    try {
      await indexEmail(id);
    } catch (err) {
      logger.warn({ err, emailId: id }, 'elasticsearch indexing failed; email flow continues');
    }
  };
  const emailId = job.data?.emailId;
  if (!emailId || typeof emailId !== 'string') {
    logger.warn({ jobId: job.id }, 'email job without emailId; completing without action');
    return 'skipped';
  }

  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: { sender: { select: { id: true, email: true, hourlyLimit: true } } },
  });
  if (!email) {
    logger.warn({ emailId }, 'scheduled email not found; completing without action');
    return 'skipped';
  }
  if (email.status === 'SENT') {
    logger.info({ emailId }, 'email already SENT; skipping resend');
    return 'skipped';
  }
  if (email.status === 'FAILED') {
    logger.info({ emailId }, 'email already FAILED; not resending');
    return 'skipped';
  }

  if (email.status === 'PROCESSING') {
    const isRetry = job.attemptsMade > 0;
    const isStale = Date.now() - email.updatedAt.getTime() > RECOVERY_GRACE_MS;
    if (!isRetry && !isStale) {
      logger.info({ emailId, jobId: job.id }, 'email claimed by a live worker; requeueing via retry');
      throw new Error(`email ${emailId} is already being processed by another worker`);
    }
    logger.info({ emailId, isRetry, isStale }, 'recovering in-flight email (retry or stale claim)');
  } else {
    const claimed = await prisma.scheduledEmail.updateMany({
      where: { id: emailId, status: 'SCHEDULED' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      logger.info({ emailId }, 'lost claim race; re-reading row state');
      return processEmailJob(job, deps);
    }
    logger.info({ emailId, jobId: job.id }, 'email claimed SCHEDULED → PROCESSING');
  }

  if (!email.sender) {
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: { status: 'FAILED', errorMessage: 'Sender no longer exists' },
    });
    logger.error({ emailId }, 'sender missing; email marked FAILED');
    return 'skipped';
  }

  const reservation = await reserve(email.sender.id, email.sender.hourlyLimit);
  if (!reservation.allowed) {
    logger.warn(
      { emailId, senderId: email.sender.id, retryAt: new Date(reservation.retryAtMs).toISOString() },
      'hourly rate limit reached; rescheduling',
    );
    await rescheduleToSlot(emailId, email.sender.id, reservation.retryAtMs);
    await safeIndex(emailId);
    await onRateLimit({
      senderId: email.sender.id,
      senderEmail: email.sender.email,
      hourlyLimit: email.sender.hourlyLimit,
      retryAtMs: reservation.retryAtMs,
    });
    return 'rescheduled';
  }
  const nowMs = Date.now();
  // A replacement job firing at/after its already-paid-for slot sends
  // instead of re-bidding (prevents reservation leapfrog livelock). Initial
  // jobs never honor: a burst of fresh jobs must always serialize through
  // the reservation so minimum spacing holds.
  const slotMatured =
    job.data.reserved === true &&
    job.data.slotMs != null &&
    nowMs >= job.data.slotMs &&
    nowMs - job.data.slotMs <= SLOT_GRACE_MS;
  if (!slotMatured && reservation.sendAtMs > nowMs) {
    logger.info(
      { emailId, senderId: email.sender.id, sendAt: new Date(reservation.sendAtMs).toISOString() },
      'minimum send delay not yet satisfied; rescheduling',
    );
    await rescheduleToSlot(emailId, email.sender.id, reservation.sendAtMs);
    await safeIndex(emailId);
    return 'rescheduled';
  }
  if (slotMatured) {
    logger.info({ emailId, slot: new Date(job.data.slotMs as number).toISOString() }, 'slot matured; sending');
  }

  try {
    const { previewUrl } = await sender({ to: email.recipient, subject: email.subject, body: email.body });
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: { status: 'SENT', sentAt: new Date(), errorMessage: null },
    });
    logger.info({ emailId, previewUrl }, 'email sent PROCESSING → SENT');
    await safeIndex(emailId);
    return 'sent';
  } catch (err) {
    const errorMessage = sanitizeErrorMessage(err);
    const lastAttempt = job.attemptsMade + 1 >= maxAttemptsFor(job);
    if (lastAttempt) {
      await prisma.scheduledEmail.update({ where: { id: emailId }, data: { status: 'FAILED', errorMessage } });
      logger.error({ emailId, errorMessage }, 'email failed permanently PROCESSING → FAILED');
      await safeIndex(emailId);
    } else {
      await prisma.scheduledEmail.update({ where: { id: emailId }, data: { errorMessage } });
      logger.warn({ emailId, errorMessage, attempt: job.attemptsMade + 1 }, 'email send failed; BullMQ will retry');
    }
    throw err;
  }
}

export interface CreateEmailWorkerOptions {
  concurrency?: number;
  sender?: EmailSender;
}

let worker: Worker<EmailJobData> | null = null;

export function createEmailWorker(opts: CreateEmailWorkerOptions = {}): Worker<EmailJobData> {
  const concurrency = opts.concurrency ?? env.WORKER_CONCURRENCY;
  const sender = opts.sender ?? sendEmail;

  const w = new Worker<EmailJobData>(emailQueueName(), (job) => processEmailJob(job, { sender }), {
    connection: createBullmqConnection(),
    concurrency,
  });

  w.on('completed', (job) => logger.info({ jobId: job.id, emailId: job.data?.emailId }, 'job completed'));
  w.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, emailId: job?.data?.emailId, attemptsMade: job?.attemptsMade, err: String(err) }, 'job failed'),
  );
  w.on('stalled', (jobId) => logger.warn({ jobId }, 'job stalled (lock lost; will be redelivered)'));
  w.on('error', (err) => logger.error({ err }, 'worker error'));

  logger.info({ concurrency, queue: emailQueueName() }, 'email worker started');
  return w;
}

/** Singleton used by the standalone worker process. */
export function getEmailWorker(): Worker<EmailJobData> {
  if (!worker) worker = createEmailWorker();
  return worker;
}

export async function closeEmailWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
