import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  DATABASE_URL: z.string().default('postgresql://reachinbox:reachinbox@localhost:5432/reachinbox'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  SESSION_SECRET: z.string().default('dev-session-secret-change-me'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/auth/google/callback'),
  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().default(587),
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASSWORD: z.string().optional(),
  ETHEREAL_FROM: z.string().default('ReachInbox <no-reply@ethereal.email>'),
  WORKER_CONCURRENCY: z.coerce.number().default(5),
  MAX_ATTEMPTS: z.coerce.number().default(3),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isEtherealConfigured(): boolean {
  return Boolean(env.ETHEREAL_USER && env.ETHEREAL_PASSWORD);
}

export function assertProductionSecrets(): void {
  if (env.NODE_ENV === 'production' && env.SESSION_SECRET === 'dev-session-secret-change-me') {
    throw new Error('SESSION_SECRET must be set to a strong random value in production');
  }
}
