import type { NextFunction, Request, Response } from 'express';
import { env, isSlackConfigured } from '../config/env.js';
import { AppError } from '../middleware/error.middleware.js';
import {
  buildSlackAuthorizeUrl,
  connectSlackAccount,
  disconnectSlack,
  getSlackStatus,
  isValidOAuthState,
  newOAuthState,
  toSlackError,
} from '../services/slack.service.js';

function frontendUrl(path: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}${path}`;
}

export function slackConnect(req: Request, res: Response, next: NextFunction): void {
  if (!isSlackConfigured()) {
    next(new AppError(503, 'SLACK_NOT_CONFIGURED', 'Slack OAuth is not configured on this server'));
    return;
  }
  const state = newOAuthState();
  req.session.slackOAuthState = state;
  req.session.save((err) => {
    if (err) {
      next(err);
      return;
    }
    res.redirect(buildSlackAuthorizeUrl(state));
  });
}

export async function slackCallback(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!isSlackConfigured()) {
      res.redirect(frontendUrl('/dashboard?slack=error'));
      return;
    }
    const { code, state, error } = req.query as Record<string, unknown>;
    // Never trust a user id from the query — identity comes from requireAuth.
    if (typeof error === 'string' || typeof code !== 'string' || !isValidOAuthState(state, req.session.slackOAuthState)) {
      res.redirect(frontendUrl('/dashboard?slack=error'));
      return;
    }
    delete req.session.slackOAuthState;
    await connectSlackAccount(req.authUser!.id, code);
    res.redirect(frontendUrl('/dashboard?slack=connected'));
  } catch (err) {
    next(toSlackError(err));
  }
}

export async function slackStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json(await getSlackStatus(req.authUser!.id));
  } catch (err) {
    next(err);
  }
}

export async function slackDisconnect(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await disconnectSlack(req.authUser!.id);
    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}
