import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let client: Client | null = null;

export function getElasticClient(): Client {
  if (!client) {
    client = new Client({ node: env.ELASTICSEARCH_URL });
  }
  return client;
}

export function emailIndexName(): string {
  return env.ELASTICSEARCH_INDEX;
}

let ensurePromise: Promise<void> | null = null;

/**
 * Create the email index (once per process) with a fixed mapping.
 * Called lazily before the first index/search op — never at boot, so a
 * down Elasticsearch can never prevent the API/worker from starting.
 */
export function ensureEmailIndex(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const index = emailIndexName();
      try {
        const exists = await getElasticClient().indices.exists({ index });
        if (!exists) {
          await getElasticClient().indices.create({
            index,
            mappings: {
              properties: {
                id: { type: 'keyword' },
                userId: { type: 'keyword' },
                campaignId: { type: 'keyword' },
                senderId: { type: 'keyword' },
                senderEmail: { type: 'text' },
                recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
                subject: { type: 'text' },
                body: { type: 'text' },
                status: { type: 'keyword' },
                scheduledAt: { type: 'date' },
                sentAt: { type: 'date' },
                createdAt: { type: 'date' },
                errorMessage: { type: 'text' },
              },
            },
          });
          logger.info({ index }, 'elasticsearch email index created');
        }
      } catch (err) {
        // Reset so a later call retries once ES is back.
        ensurePromise = null;
        throw err;
      }
    })();
  }
  return ensurePromise;
}

/** Test seam: forget memoized client/index state (tests only). */
export function resetElasticClient(): void {
  ensurePromise = null;
  client = null;
}
