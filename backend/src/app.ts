import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { assertProductionSecrets, env } from './config/env.js';
import { configureGoogleOAuth } from './config/google-oauth.js';
import { buildSessionMiddleware } from './lib/session.js';
import { errorMiddleware, notFoundMiddleware } from './middleware/error.middleware.js';
import { authRouter } from './routes/auth.routes.js';
import { emailsRouter } from './routes/emails.routes.js';
import { healthRouter } from './routes/health.routes.js';

export function createApp() {
  assertProductionSecrets();
  configureGoogleOAuth();

  const app = express();
  if (env.NODE_ENV === 'production') {
    // Required for secure cookies when running behind a proxy.
    app.set('trust proxy', 1);
  }

  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp());
  app.use(buildSessionMiddleware());

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', emailsRouter);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
