import { Queue, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';

export const EMAIL_QUEUE_NAME = 'email-send';

/**
 * Queue name override (used by tests so parallel test files never share a
 * Redis queue: live consumers in one file must not steal another file's
 * jobs, and delayed-job cleanup must not delete them either). Production
 * always uses the default.
 */
export function emailQueueName(): string {
  return process.env.EMAIL_QUEUE_NAME?.trim() || EMAIL_QUEUE_NAME;
}

/** Minimal job payload. The database is the source of truth — never put the email body in Redis. */
export interface EmailJobData {
  emailId: string;
  /**
   * The reserved slot (epoch ms) this execution is firing for. Lets the
   * worker send when its slot has matured instead of re-bidding forever
   * (see SLOT_GRACE_MS in the worker). Optional for backward compatibility.
   */
  slotMs?: number;
  /**
   * True only on replacement jobs created by rescheduling — i.e. this slot
   * was already paid for (counter consumed, throttle advanced) by an earlier
   * execution. Initial jobs never carry it, so a burst of fresh jobs always
   * serializes through the reservation instead of all sending at once.
   */
  reserved?: boolean;
}

/**
 * Deterministic job id per logical email AND target slot: re-enqueueing the
 * same row for the same slot can never create a second job, while
 * reschedules for different slots get distinct ids (BullMQ forbids reusing
 * the id of a retained completed/failed job, and forbids ':' in custom ids).
 */
export function emailJobId(emailId: string, slotMs: number): string {
  return `email-${emailId}-${slotMs}`;
}

let queue: Queue<EmailJobData> | null = null;

export function defaultEmailJobOptions(): JobsOptions {
  return {
    attempts: env.MAX_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5000 },
    // Bounded history so Redis doesn't grow forever. Delayed/waiting jobs
    // are never removed before execution — only finished ones, capped.
    removeOnComplete: 1000,
    removeOnFail: 5000,
  };
}

export function getEmailQueue(): Queue<EmailJobData> {
  if (queue) return queue;
  queue = new Queue<EmailJobData>(emailQueueName(), {
    connection: createBullmqConnection(),
    defaultJobOptions: defaultEmailJobOptions(),
  });
  return queue;
}

export async function closeEmailQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
