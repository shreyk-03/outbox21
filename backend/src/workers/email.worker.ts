import { Worker, type Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';
import { EMAIL_QUEUE_NAME, type EmailJobData } from '../queues/email.queue.js';
import { sendEmail, type SendEmailInput, type SendEmailResult } from '../services/email.service.js';

export type EmailSender = (input: SendEmailInput) => Promise<SendEmailResult>;

/** Only these fields of a BullMQ job are needed; keeps the processor unit-testable. */
export type ProcessableEmailJob = Pick<Job<EmailJobData>, 'id' | 'data' | 'attemptsMade' | 'opts'>;

export type ProcessOutcome = 'sent' | 'skipped';

/**
 * A PROCESSING row fresher than this is assumed to be owned by a live
 * worker (concurrent duplicate delivery) — not a crash. Older rows are
 * treated as crashed-worker recovery. See processEmailJob.
 */
export const RECOVERY_GRACE_MS = 2 * 60 * 1000;

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
 * Process one email-send job. Database (Prisma) is the source of truth;
 * the job carries only { emailId }.
 *
 * - Missing row → complete silently (row deleted; nothing to do).
 * - SENT / FAILED → complete without sending (idempotent redelivery).
 * - SCHEDULED → atomically claim (conditional UPDATE … WHERE status =
 *   SCHEDULED). Exactly one worker wins the race; losers re-read the row.
 * - PROCESSING → another delivery of an in-flight email:
 *   - BullMQ retry (attemptsMade > 0) → the previous attempt failed while
 *     sending, so send again;
 *   - stale claim (older than RECOVERY_GRACE_MS) → previous worker died
 *     without finishing (crash before send / crash during DB write), so
 *     recover by sending;
 *   - otherwise → a live worker owns it; throw a retryable error so BullMQ
 *     redelivers later (by then it is usually SENT → skip). This is what
 *     prevents concurrent duplicates.
 * - Retryable send failure → record the error and throw so BullMQ retries
 *   with exponential backoff. On the final attempt the row goes FAILED.
 */
export async function processEmailJob(
  job: ProcessableEmailJob,
  sender: EmailSender = sendEmail,
): Promise<ProcessOutcome> {
  const emailId = job.data?.emailId;
  if (!emailId || typeof emailId !== 'string') {
    logger.warn({ jobId: job.id }, 'email job without emailId; completing without action');
    return 'skipped';
  }

  const email = await prisma.scheduledEmail.findUnique({ where: { id: emailId } });
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
    // SCHEDULED → PROCESSING guarded by the status predicate: atomic claim.
    const claimed = await prisma.scheduledEmail.updateMany({
      where: { id: emailId, status: 'SCHEDULED' },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
    if (claimed.count === 0) {
      // Lost the race — re-read and let the state machine above decide.
      logger.info({ emailId }, 'lost claim race; re-reading row state');
      return processEmailJob(job, sender);
    }
    logger.info({ emailId, jobId: job.id }, 'email claimed SCHEDULED → PROCESSING');
  }

  try {
    const { previewUrl } = await sender({ to: email.recipient, subject: email.subject, body: email.body });
    await prisma.scheduledEmail.update({
      where: { id: emailId },
      data: { status: 'SENT', sentAt: new Date(), errorMessage: null },
    });
    logger.info({ emailId, previewUrl }, 'email sent PROCESSING → SENT');
    return 'sent';
  } catch (err) {
    const errorMessage = sanitizeErrorMessage(err);
    const lastAttempt = job.attemptsMade + 1 >= maxAttemptsFor(job);
    if (lastAttempt) {
      await prisma.scheduledEmail.update({ where: { id: emailId }, data: { status: 'FAILED', errorMessage } });
      logger.error({ emailId, errorMessage }, 'email failed permanently PROCESSING → FAILED');
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

  const w = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, (job) => processEmailJob(job, sender), {
    connection: createBullmqConnection(),
    concurrency,
  });

  w.on('completed', (job) => logger.info({ jobId: job.id, emailId: job.data?.emailId }, 'job completed'));
  w.on('failed', (job, err) =>
    logger.warn({ jobId: job?.id, emailId: job?.data?.emailId, attemptsMade: job?.attemptsMade, err: String(err) }, 'job failed'),
  );
  w.on('stalled', (jobId) => logger.warn({ jobId }, 'job stalled (lock lost; will be redelivered)'));
  w.on('error', (err) => logger.error({ err }, 'worker error'));

  logger.info({ concurrency, queue: EMAIL_QUEUE_NAME }, 'email worker started');
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
