import type { NextFunction, Request, Response } from 'express';
import type { Profile } from 'passport-google-oauth20';
import { env, isGoogleOAuthConfigured } from '../config/env.js';
import { passport } from '../config/google-oauth.js';
import { SESSION_COOKIE_NAME } from '../lib/session.js';
import { AppError } from '../middleware/error.middleware.js';
import { toGoogleProfileInput, upsertGoogleUser } from '../services/auth.service.js';

function dashboardUrl(): string {
  return `${env.FRONTEND_URL.replace(/\/$/, '')}/dashboard`;
}

function loginUrl(error?: string): string {
  const base = `${env.FRONTEND_URL.replace(/\/$/, '')}/login`;
  return error ? `${base}?error=${encodeURIComponent(error)}` : base;
}

export function googleStart(req: Request, res: Response, next: NextFunction): void {
  if (!isGoogleOAuthConfigured()) {
    next(new AppError(503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured on this server'));
    return;
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
}

export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  if (!isGoogleOAuthConfigured()) {
    next(new AppError(503, 'OAUTH_NOT_CONFIGURED', 'Google OAuth is not configured on this server'));
    return;
  }
  passport.authenticate('google', { session: false }, (err: unknown, profile: Profile | false) => {
    if (err || !profile) {
      res.redirect(loginUrl('oauth_failed'));
      return;
    }
    let input;
    try {
      input = toGoogleProfileInput(profile);
    } catch {
      res.redirect(loginUrl('oauth_failed'));
      return;
    }
    upsertGoogleUser(input)
      .then((user) => {
        // Regenerate the session id on login (session-fixation protection),
        // then persist only the opaque user id server-side.
        req.session.regenerate((regenErr) => {
          if (regenErr) {
            next(regenErr);
            return;
          }
          req.session.userId = user.id;
          req.session.save((saveErr) => {
            if (saveErr) {
              next(saveErr);
              return;
            }
            res.redirect(dashboardUrl());
          });
        });
      })
      .catch((upsertErr: unknown) => {
        if (upsertErr instanceof AppError && upsertErr.code === 'ACCOUNT_CONFLICT') {
          res.redirect(loginUrl('account_conflict'));
          return;
        }
        next(upsertErr);
      });
  })(req, res, next);
}

export function me(req: Request, res: Response): void {
  res.status(200).json({ authenticated: true, user: req.authUser });
}

export function logout(req: Request, res: Response, next: NextFunction): void {
  const clearAndRespond = () => {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.status(200).json({ success: true });
  };
  // Logout is idempotent: no session → still 200 + clear cookie.
  if (!req.session) {
    clearAndRespond();
    return;
  }
  req.session.destroy((err) => {
    if (err) {
      next(err);
      return;
    }
    clearAndRespond();
  });
}
