import type Redis from 'ioredis';
import { env } from '../config/env.js';
import { createBullmqConnection } from '../lib/bullmq-connection.js';

/**
 * Distributed send-slot reservation: minimum per-sender delay + hourly rate
 * limit, reserved atomically in Redis via a single Lua script.
 *
 * Keys (all per-sender; never per-recipient):
 * - `email:throttle:{senderId}` → next-allowed-send epoch ms (min delay)
 * - `email:rate:{senderId}:{YYYY-MM-DDTHH}` → sends reserved in that UTC hour
 *
 * The script atomically: computes sendAt = max(now, throttle), picks the
 * hour bucket containing sendAt, rejects when that bucket is full
 * (RATE_LIMIT, retry at next hour boundary), otherwise increments the bucket
 * and advances the throttle. Two workers can never both observe "capacity
 * available" — Redis executes the script atomically.
 *
 * Conservative failure behavior: capacity is reserved BEFORE smtp sends, so a
 * crash between reservation and send consumes capacity without sending
 * (under-send, never over-send).
 *
 * Assumption: MIN_SEND_DELAY_MS is far below one hour, so sendAt always falls
 * in the current or next UTC hour bucket (both keys are passed in).
 */

export function throttleKeyFor(senderId: string): string {
  return `email:throttle:${senderId}`;
}

export function rateKeyFor(senderId: string, bucket: string): string {
  return `email:rate:${senderId}:${bucket}`;
}

/** UTC hour bucket `YYYY-MM-DDTHH` for a timestamp. */
export function utcHourBucket(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}`;
}

/** Start of the next UTC hour (exclusive upper bound of the current hour). */
export function nextHourBoundaryMs(nowMs: number): number {
  return Math.floor(nowMs / 3_600_000) * 3_600_000 + 3_600_000;
}

const RESERVE_SCRIPT = `
local nowMs = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local boundaryMs = tonumber(ARGV[4])
local ttlCurrent = tonumber(ARGV[5])
local ttlNext = tonumber(ARGV[6])
local throttleTtl = tonumber(ARGV[7])

local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
local sendAt = math.max(nowMs, nextAllowed)

local rateKey = KEYS[2]
local rateTtl = ttlCurrent
if sendAt >= boundaryMs then
  rateKey = KEYS[3]
  rateTtl = ttlNext
end

local count = tonumber(redis.call('GET', rateKey) or '0')
if count >= limit then
  return {0, 'RATE_LIMIT', boundaryMs}
end

redis.call('INCR', rateKey)
redis.call('EXPIRE', rateKey, rateTtl)
redis.call('SET', KEYS[1], sendAt + minDelayMs, 'EX', throttleTtl)
return {1, 'OK', sendAt}
`;

export type ReservationResult =
  | { allowed: true; sendAtMs: number }
  | { allowed: false; reason: 'RATE_LIMIT'; retryAtMs: number };

export interface ReserveSlotOptions {
  minDelayMs?: number;
  hourlyLimit: number;
  nowMs?: number;
  /** Test overrides to simulate specific hours without time travel. */
  currentBucket?: string;
  nextBucket?: string;
  boundaryMs?: number;
}

let client: Redis | null = null;

function getClient(): Redis {
  if (!client) client = createBullmqConnection();
  return client;
}

export async function closeReservationClient(): Promise<void> {
  if (client) {
    client.disconnect();
    client = null;
  }
}

export async function reserveSendSlot(senderId: string, opts: ReserveSlotOptions): Promise<ReservationResult> {
  const minDelayMs = opts.minDelayMs ?? env.MIN_SEND_DELAY_MS;
  const nowMs = opts.nowMs ?? Date.now();
  const boundaryMs = opts.boundaryMs ?? nextHourBoundaryMs(nowMs);
  const currentBucket = opts.currentBucket ?? utcHourBucket(nowMs);
  const nextBucket = opts.nextBucket ?? utcHourBucket(boundaryMs);

  // TTLs cover the remainder of each bucket plus a buffer; throttle key only
  // needs to outlive the delay window.
  const ttlCurrent = Math.max(60, Math.ceil((boundaryMs - nowMs) / 1000) + 300);
  const ttlNext = 7_200;
  const throttleTtl = Math.ceil(minDelayMs / 1000) + 300;

  const raw = (await getClient().eval(
    RESERVE_SCRIPT,
    3,
    throttleKeyFor(senderId),
    rateKeyFor(senderId, currentBucket),
    rateKeyFor(senderId, nextBucket),
    String(nowMs),
    String(minDelayMs),
    String(opts.hourlyLimit),
    String(boundaryMs),
    String(ttlCurrent),
    String(ttlNext),
    String(throttleTtl),
  )) as [number, string, number];

  if (raw[0] === 1) {
    return { allowed: true, sendAtMs: Number(raw[2]) };
  }
  return { allowed: false, reason: 'RATE_LIMIT', retryAtMs: Number(raw[2]) };
}
