import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { getDbPool } from '../lib/db.js';
import { prisma } from '../lib/prisma.js';
import {
  closeSlackRedis,
  getSlackStatus,
  isValidOAuthState,
  newOAuthState,
  notifyRateLimitHit,
  resetSlackApiClient,
  setSlackApiClient,
  type SlackApiClient,
} from '../services/slack.service.js';
import { cleanupTestData, createTestIdentity, type TestIdentity } from './test-utils.js';

const app = createApp();
const agent = request(app);
const TAG = `phase5-slack-${Date.now()}`;

let identity: TestIdentity;
const posts: Array<{ channelId: string; text: string }> = [];
let failMode = false;

const fakeSlack: SlackApiClient = {
  async exchangeCode() {
    return { accessToken: 'xoxp-test-token', teamId: 'T123', teamName: 'Test Team', slackUserId: 'U123' };
  },
  async openDm() {
    return 'D123';
  },
  async postMessage(_token, channelId, text) {
    if (failMode) throw new Error('slack is down');
    posts.push({ channelId, text });
  },
};

beforeAll(async () => {
  await cleanupTestData(TAG);
  identity = await createTestIdentity(TAG, 's');
  setSlackApiClient(fakeSlack);
});

afterAll(async () => {
  resetSlackApiClient();
  await closeSlackRedis();
  await cleanupTestData(TAG);
  await prisma.$disconnect();
  await getDbPool().end();
});

describe('slack: OAuth entry points', () => {
  it('unauthenticated connect is rejected', async () => {
    const res = await agent.get('/api/slack/connect');
    expect(res.status).toBe(401);
  });

  it('connect redirects to Slack (or 503 when unconfigured), never leaking secrets', async () => {
    const res = await agent.get('/api/slack/connect').set('Cookie', identity.cookie).redirects(0);
    expect([302, 503]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('https://slack.com/oauth/v2/authorize');
      expect(res.headers.location).toContain('state=');
      expect(res.headers.location).not.toContain('client_secret');
    } else {
      expect(res.body.error.code).toBe('SLACK_NOT_CONFIGURED');
    }
  });

  it('OAuth state is unguessable and validated strictly', () => {
    expect(newOAuthState()).not.toBe(newOAuthState());
    expect(isValidOAuthState('abc', 'abc')).toBe(true);
    expect(isValidOAuthState('abc', 'abd')).toBe(false);
    expect(isValidOAuthState(undefined, 'abc')).toBe(false);
    expect(isValidOAuthState('abc', undefined)).toBe(false);
    expect(isValidOAuthState('', '')).toBe(false);
  });
});

describe('slack: connection lifecycle (fake Slack API, real DB)', () => {
  it('callback stores the connection; token never appears in responses', async () => {
    // Simulate what the callback does after a valid code+state exchange.
    const { connectSlackAccount } = await import('../services/slack.service.js');
    const stored = await connectSlackAccount(identity.userId, 'test-code');
    expect(stored.teamName).toBe('Test Team');

    const status = await agent.get('/api/slack/status').set('Cookie', identity.cookie);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ connected: true, teamName: 'Test Team' });
    expect(JSON.stringify(status.body)).not.toContain('xoxp-test-token');

    const row = await prisma.slackConnection.findUnique({ where: { userId: identity.userId } });
    expect(row?.accessToken).toBe('xoxp-test-token');
  });

  it('reconnect replaces the existing connection (no duplicates)', async () => {
    const { connectSlackAccount } = await import('../services/slack.service.js');
    await connectSlackAccount(identity.userId, 'code-2');
    const count = await prisma.slackConnection.count({ where: { userId: identity.userId } });
    expect(count).toBe(1);
  });

  it('disconnect removes the connection', async () => {
    const res = await agent.post('/api/slack/disconnect').set('Cookie', identity.cookie);
    expect(res.status).toBe(200);
    const status = await getSlackStatus(identity.userId);
    expect(status).toEqual({ connected: false, teamName: null });
  });
});

describe('slack: rate-limit alerts', () => {
  beforeAll(async () => {
    // Reconnect (previous test disconnected).
    const { connectSlackAccount } = await import('../services/slack.service.js');
    await connectSlackAccount(identity.userId, 'test-code');
    posts.length = 0;
  });

  function alertInput() {
    return {
      senderId: identity.senderId,
      senderEmail: `${TAG}-sender-s@example.com`,
      hourlyLimit: 2,
      retryAtMs: Date.now() + 3_600_000,
    };
  }

  it('sends one alert with factual details on first hit', async () => {
    await notifyRateLimitHit(alertInput());
    expect(posts).toHaveLength(1);
    expect(posts[0].text).toContain(`${TAG}-sender-s@example.com`);
    expect(posts[0].text).toContain('2');
    expect(JSON.stringify(posts[0])).not.toContain('xoxp-test-token');
  });

  it('concurrent hits in the same hour produce exactly one alert', async () => {
    await Promise.all(Array.from({ length: 10 }, () => notifyRateLimitHit(alertInput())));
    expect(posts).toHaveLength(1);
  });

  it('Slack failure never throws (email flow continues)', async () => {
    failMode = true;
    try {
      // Different sender → different alert key → attempts a real (failing) post.
      const other = await createTestIdentity(TAG, 's2');
      const { connectSlackAccount } = await import('../services/slack.service.js');
      await connectSlackAccount(other.userId, 'code-x');
      await expect(
        notifyRateLimitHit({ senderId: other.senderId, senderEmail: 'x@example.com', hourlyLimit: 1, retryAtMs: Date.now() }),
      ).resolves.toBeUndefined();
    } finally {
      failMode = false;
    }
  });

  it('no connection → skipped silently, no throw', async () => {
    const other = await createTestIdentity(TAG, 's3');
    await expect(
      notifyRateLimitHit({ senderId: other.senderId, senderEmail: 'y@example.com', hourlyLimit: 1, retryAtMs: Date.now() }),
    ).resolves.toBeUndefined();
    expect(posts).toHaveLength(1);
  });
});
