import type { Profile } from 'passport-google-oauth20';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

export interface GoogleProfileInput {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export function toGoogleProfileInput(profile: Profile): GoogleProfileInput {
  const email = profile.emails?.[0]?.value?.trim().toLowerCase();
  if (!profile.id || !email) {
    throw new AppError(400, 'OAUTH_PROFILE_INCOMPLETE', 'Google did not return a usable profile (missing id or email)');
  }
  return {
    googleId: profile.id,
    email,
    name: profile.displayName?.trim() || email,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}

/**
 * Find-or-create the User for a verified Google profile.
 *
 * Matching is by googleId (Google's stable subject) — never by email alone,
 * so a Google account can never silently take over an unrelated row that
 * happens to share an email string. If the email belongs to a different
 * googleId (e.g. legacy/manual rows), we fail loudly instead of merging.
 */
export async function upsertGoogleUser(input: GoogleProfileInput) {
  const existing = await prisma.user.findUnique({ where: { googleId: input.googleId } });
  if (existing) {
    if (
      existing.email !== input.email ||
      existing.name !== input.name ||
      (existing.avatarUrl ?? null) !== input.avatarUrl
    ) {
      return prisma.user.update({
        where: { id: existing.id },
        data: { email: input.email, name: input.name, avatarUrl: input.avatarUrl },
      });
    }
    return existing;
  }

  try {
    return await prisma.user.create({
      data: {
        googleId: input.googleId,
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(
        409,
        'ACCOUNT_CONFLICT',
        'This email is already associated with a different sign-in. Please use the original sign-in method.',
      );
    }
    throw err;
  }
}
