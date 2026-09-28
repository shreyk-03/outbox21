import { emailIndexName, ensureEmailIndex, getElasticClient } from '../lib/elasticsearch.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

/**
 * Elasticsearch is a search/read optimization layer. PostgreSQL is the source
 * of truth (eventual consistency). Indexing helpers NEVER throw to callers —
 * use the `Safe` variants from scheduling/sending paths so an ES outage can
 * never fail an email.
 */

export interface EmailSearchHit {
  id: string;
  recipient: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  senderEmail: string | null;
}

function toDoc(email: {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  errorMessage: string | null;
  sender: { email: string } | null;
}): Record<string, unknown> {
  return {
    id: email.id,
    userId: email.userId,
    campaignId: email.campaignId,
    senderId: email.senderId,
    senderEmail: email.sender?.email ?? null,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    ...(email.sentAt ? { sentAt: email.sentAt.toISOString() } : {}),
    createdAt: email.createdAt.toISOString(),
    ...(email.errorMessage ? { errorMessage: email.errorMessage } : {}),
  };
}

/** Upsert the ES document for an email row. Throws on ES errors. */
export async function indexEmailById(emailId: string): Promise<void> {
  const email = await prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: { sender: { select: { email: true } } },
  });
  if (!email) return;
  await ensureEmailIndex();
  await getElasticClient().index({ index: emailIndexName(), id: email.id, document: toDoc(email) });
  logger.debug({ emailId }, 'email indexed in elasticsearch');
}

/** Indexing that never throws (for scheduling/sending paths). */
export async function indexEmailByIdSafe(emailId: string): Promise<void> {
  try {
    await indexEmailById(emailId);
  } catch (err) {
    logger.warn({ err, emailId }, 'elasticsearch indexing failed; email flow continues');
  }
}

/** Full-text search over the caller's own emails only. */
export async function searchEmails(userId: string, q: string, size = 20): Promise<EmailSearchHit[]> {
  const query = q.trim();
  if (!query) throw new AppError(400, 'VALIDATION_ERROR', 'q must be a non-empty search string');
  await ensureEmailIndex();
  const res = await getElasticClient().search({
    index: emailIndexName(),
    size: Math.min(Math.max(size, 1), 50),
    sort: [{ scheduledAt: { order: 'desc' } }],
    query: {
      bool: {
        filter: [{ term: { userId } }],
        must: [
          {
            multi_match: {
              query,
              fields: ['recipient^3', 'subject^2', 'body', 'senderEmail^2'],
            },
          },
        ],
      },
    },
  });
  return res.hits.hits.map((h) => {
    const s = h._source as Record<string, unknown>;
    return {
      id: String(s.id),
      recipient: String(s.recipient ?? ''),
      subject: String(s.subject ?? ''),
      status: String(s.status ?? ''),
      scheduledAt: String(s.scheduledAt ?? ''),
      sentAt: s.sentAt ? String(s.sentAt) : null,
      senderEmail: s.senderEmail ? String(s.senderEmail) : null,
    };
  });
}
