import { randomBytes, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';
import { nextHourBoundaryMs, utcHourBucket } from './send-reservation.service.js';

/**
 * Slack integration: OAuth connect + rate-limit DM alerts.
 * Real Slack Web API calls (fetch). No SDK. Tokens live only in the
 * SlackConnection row — never in logs or API responses.
 */

export const SLACK_SCOPES = ['chat:write', 'im:write', 'users:read'] as const;

export function slackAlertKeyFor(senderId: string, bucket: string): string {
  return `slack:alert:${senderId}:${bucket}`;
}

export interface SlackTokenInfo {
  accessToken: string;
  teamId: string | null;
  teamName: string | null;
  slackUserId: string | null;
}

export interface SlackApiClient {
  exchangeCode(code: string): Promise<SlackTokenInfo>;
  openDm(accessToken: string, slackUserId: string): Promise<string>;
  postMessage(accessToken: string, channelId: string, text: string): Promise<void>;
}

async function readJson(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`slack ${what} failed with HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const fetchSlackApi: SlackApiClient = {
  async exchangeCode(code: string): Promise<SlackTokenInfo> {
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.SLACK_CLIENT_ID as string,
        client_secret: env.SLACK_CLIENT_SECRET as string,
        code,
        redirect_uri: env.SLACK_REDIRECT_URI,
      }),
    });
    const data = await readJson(res, 'oauth exchange');
    if (data.ok !== true) throw new Error(`slack oauth exchange failed: ${String(data.error ?? 'unknown')}`);
    const authed = (data.authed_user ?? {}) as Record<string, unknown>;
    const team = (data.team ?? {}) as Record<string, unknown>;
    const accessToken = data.access_token ?? authed.access_token;
    if (typeof accessToken !== 'string' || !accessToken) throw new Error('slack oauth exchange returned no token');
    return {
      accessToken,
      teamId: typeof team.id === 'string' ? team.id : null,
      teamName: typeof team.name === 'string' ? team.name : null,
      slackUserId: typeof authed.id === 'string' ? authed.id : null,
    };
  },

  async openDm(accessToken: string, slackUserId: string): Promise<string> {
    const res = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ users: slackUserId }),
    });
    const data = await readJson(res, 'conversations.open');
    if (data.ok !== true) throw new Error(`slack conversations.open failed: ${String(data.error ?? 'unknown')}`);
    const channel = (data.channel ?? {}) as Record<string, unknown>;
    if (typeof channel.id !== 'string') throw new Error('slack conversations.open returned no channel');
    return channel.id;
  },

  async postMessage(accessToken: string, channelId: string, text: string): Promise<void> {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ channel: channelId, text }),
    });
    const data = await readJson(res, 'chat.postMessage');
    if (data.ok !== true) throw new Error(`slack chat.postMessage failed: ${String(data.error ?? 'unknown')}`);
  },
};

let apiClient: SlackApiClient = fetchSlackApi;

/** Test seam: swap the Slack HTTP layer (reset with the default client). */
export function setSlackApiClient(client: SlackApiClient): void {
  apiClient = client;
}

export function resetSlackApiClient(): void {
  apiClient = fetchSlackApi;
}

export function buildSlackAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID as string,
    scope: SLACK_SCOPES.join(','),
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export function newOAuthState(): string {
  return randomBytes(32).toString('hex');
}

export function isValidOAuthState(provided: unknown, expected: unknown): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Exchange the code and upsert the user's connection (reconnect replaces). */
export async function connectSlackAccount(userId: string, code: string) {
  const info = await apiClient.exchangeCode(code);
  return prisma.slackConnection.upsert({
    where: { userId },
    update: {
      accessToken: info.accessToken,
      teamId: info.teamId,
      teamName: info.teamName,
      slackUserId: info.slackUserId,
    },
    create: {
      userId,
      accessToken: info.accessToken,
      teamId: info.teamId,
      teamName: info.teamName,
      slackUserId: info.slackUserId,
    },
    select: { teamId: true, teamName: true, updatedAt: true },
  });
}

export async function getSlackStatus(userId: string): Promise<{ connected: boolean; teamName: string | null }> {
  const conn = await prisma.slackConnection.findUnique({ where: { userId }, select: { teamName: true } });
  if (!conn) return { connected: false, teamName: null };
  return { connected: true, teamName: conn.teamName };
}

export async function disconnectSlack(userId: string): Promise<void> {
  await prisma.slackConnection.deleteMany({ where: { userId } });
}

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) redis = createBullmqConnection();
  return redis;
}

export async function closeSlackRedis(): Promise<void> {
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

export interface RateLimitAlertInput {
  senderId: string;
  senderEmail: string;
  hourlyLimit: number;
  retryAtMs: number;
}

/**
 * Best-effort rate-limit DM. NEVER throws — Slack failure must never fail
 * email sending. Idempotent per sender+UTC-hour via atomic SET NX: of N
 * workers hitting the same limit, exactly one sends.
 */
export async function notifyRateLimitHit(input: RateLimitAlertInput): Promise<void> {
  try {
    const sender = await prisma.sender.findUnique({
      where: { id: input.senderId },
      select: { userId: true },
    });
    if (!sender) {
      logger.warn({ senderId: input.senderId }, 'slack alert skipped: sender not found');
      return;
    }
    const conn = await prisma.slackConnection.findUnique({ where: { userId: sender.userId } });
    if (!conn || !conn.slackUserId) {
      logger.info({ senderId: input.senderId }, 'slack alert skipped: workspace not connected');
      return;
    }

    const nowMs = Date.now();
    const bucket = utcHourBucket(nowMs);
    const ttlSec = Math.max(60, Math.ceil((nextHourBoundaryMs(nowMs) - nowMs) / 1000) + 300);
    const acquired = await getRedis().set(slackAlertKeyFor(input.senderId, bucket), '1', 'EX', ttlSec, 'NX');
    if (acquired !== 'OK') {
      logger.info({ senderId: input.senderId, bucket }, 'slack alert skipped: already sent for this hour');
      return;
    }

    const pending = await prisma.scheduledEmail.count({
      where: { senderId: input.senderId, status: { in: ['SCHEDULED', 'PROCESSING'] } },
    });
    const text =
      `Email sending for ${input.senderEmail} reached its hourly limit ` +
      `(${input.hourlyLimit} emails/hour, UTC hour ${bucket}). ` +
      `${pending} email(s) pending — rescheduled for the next available window starting ` +
      `${new Date(input.retryAtMs).toISOString()}.`;
    const channelId = await apiClient.openDm(conn.accessToken, conn.slackUserId);
    await apiClient.postMessage(conn.accessToken, channelId, text);
    logger.info({ senderId: input.senderId, bucket }, 'slack rate-limit alert sent');
  } catch (err) {
    logger.warn({ err, senderId: input.senderId }, 'slack rate-limit alert failed; email flow continues');
  }
}

export function toSlackError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError(502, 'SLACK_ERROR', 'Slack request failed; please try again');
}
