import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../middleware/error.middleware.js';
import { emailJobId, getEmailQueue } from '../queues/email.queue.js';
import { indexEmailByIdSafe } from './email-search.service.js';

export const scheduleEmailSchema = z.object({
  senderId: z.string().uuid('senderId must be a valid UUID'),
  recipient: z.string().trim().email('recipient must be a valid email address').max(320),
  subject: z.string().trim().min(1, 'subject is required').max(998),
  body: z.string().min(1, 'body is required').max(200_000),
  scheduledAt: z.coerce.date({ invalid_type_error: 'scheduledAt must be a valid ISO timestamp' }),
});

export type ScheduleEmailInput = z.infer<typeof scheduleEmailSchema>;

export interface ScheduledEmailResult {
  id: string;
  status: string;
  recipient: string;
  subject: string;
  scheduledAt: Date;
  bullmqJobId: string;
  delayMs: number;
}

function parseInput(raw: unknown): ScheduleEmailInput {
  const parsed = scheduleEmailSchema.safeParse(raw);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new AppError(400, 'VALIDATION_ERROR', message);
  }
  return parsed.data;
}

/**
 * Schedule a single email: create the DB record, enqueue a BullMQ delayed
 * job holding only { emailId }, then persist the job id on the row.
 *
 * Phase 4 has no campaign API yet, so each single send auto-creates a
 * minimal one-recipient EmailCampaign (the required parent row). Bulk
 * campaigns arrive in a later phase.
 *
 * Consistency: PostgreSQL and Redis cannot share one atomic transaction.
 * Order of operations is DB-first so the database (source of truth) never
 * references a job that doesn't exist. If storing bullmqJobId fails after
 * the job was enqueued, the job is removed best-effort so no orphan job can
 * send an email the API reported as failed.
 */
export async function scheduleEmail(userId: string, rawInput: unknown): Promise<ScheduledEmailResult> {
  const input = parseInput(rawInput);

  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId } });
  if (!sender) {
    // 404 (not 403) so one user can't probe another user's sender ids.
    throw new AppError(404, 'SENDER_NOT_FOUND', 'Sender not found');
  }

  const scheduledAt = input.scheduledAt;
  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());

  const email = await prisma.$transaction(async (tx) => {
    const campaign = await tx.emailCampaign.create({
      data: {
        userId,
        senderId: sender.id,
        subject: input.subject,
        body: input.body,
        startTime: scheduledAt,
        delayMs: 0,
        hourlyLimit: sender.hourlyLimit,
      },
    });
    return tx.scheduledEmail.create({
      data: {
        campaignId: campaign.id,
        userId,
        senderId: sender.id,
        recipient: input.recipient.toLowerCase(),
        subject: input.subject,
        body: input.body,
        scheduledAt,
      },
    });
  });

  const jobId = emailJobId(email.id, scheduledAt.getTime());
  const queue = getEmailQueue();
  const job = await queue.add('send', { emailId: email.id, slotMs: scheduledAt.getTime() }, { jobId, delay: delayMs });

  try {
    await prisma.scheduledEmail.update({ where: { id: email.id }, data: { bullmqJobId: job.id as string } });
  } catch (err) {
    // Orphan-job cleanup: the API reports failure, so no job may survive for this row.
    await job.remove().catch((removeErr) => logger.warn({ removeErr, emailId: email.id }, 'failed to remove orphan job'));
    throw err;
  }

  logger.info({ emailId: email.id, jobId: job.id, delayMs }, 'email scheduled');
  await indexEmailByIdSafe(email.id);
  return {
    id: email.id,
    status: email.status,
    recipient: email.recipient,
    subject: email.subject,
    scheduledAt: email.scheduledAt,
    bullmqJobId: job.id as string,
    delayMs,
  };
}

const emailListSelect = {
  id: true,
  recipient: true,
  subject: true,
  scheduledAt: true,
  sentAt: true,
  status: true,
  attempts: true,
  createdAt: true,
} as const;

/** Pending emails (SCHEDULED + PROCESSING), oldest scheduled first. */
export function getScheduledEmails(userId: string) {
  return prisma.scheduledEmail.findMany({
    where: { userId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
    select: emailListSelect,
    orderBy: { scheduledAt: 'asc' },
  });
}

/** Sent emails, newest first. */
export function getSentEmails(userId: string) {
  return prisma.scheduledEmail.findMany({
    where: { userId, status: 'SENT' },
    select: emailListSelect,
    orderBy: { sentAt: 'desc' },
  });
}

/** Single email detail; 404 unless owned by the caller (never leaks other users' rows). */
export async function getEmailById(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }
  const email = await prisma.scheduledEmail.findFirst({
    where: { id, userId },
    select: { ...emailListSelect, body: true, errorMessage: true, bullmqJobId: true },
  });
  if (!email) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }
  return email;
}
