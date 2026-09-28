import passport from 'passport';
import { Strategy as GoogleStrategy, type Profile } from 'passport-google-oauth20';
import { env, isGoogleOAuthConfigured } from '../config/env.js';
import { logger } from '../lib/logger.js';

/**
 * Google OAuth 2.0 via Passport. Passport handles ONLY the OAuth dance
 * (redirect → code exchange → verified profile). Authenticated identity is
 * then stored as req.session.userId by the auth controller — passport's own
 * login/session layer is intentionally not used (see auth.routes.ts).
 */
export function configureGoogleOAuth(): void {
  if (!isGoogleOAuthConfigured()) {
    logger.warn('Google OAuth not configured (missing GOOGLE_CLIENT_ID/SECRET); /api/auth/google will return 503');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID as string,
        clientSecret: env.GOOGLE_CLIENT_SECRET as string,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      (_accessToken, _refreshToken, profile: Profile, done) => {
        // Never log tokens. Only the verified profile moves forward.
        logger.debug({ googleId: profile.id }, 'google oauth profile received');
        done(null, profile);
      },
    ),
  );
}

export { passport };
