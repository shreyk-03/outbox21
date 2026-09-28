import { Queue, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';

export const EMAIL_QUEUE_NAME = 'email-send';

/** Minimal job payload. The database is the source of truth — never put the email body in Redis. */
export interface EmailJobData {
  emailId: string;
}

/** Deterministic job id per logical email: re-enqueueing the same row can never create a second job. (BullMQ forbids ':' in custom ids.) */
export function emailJobId(emailId: string): string {
  return `email-${emailId}`;
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
  queue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
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
