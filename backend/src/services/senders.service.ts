import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/error.middleware.js';

export const createSenderSchema = z.object({
  email: z.string().trim().toLowerCase().email('email must be a valid email address').max(320),
  name: z.string().trim().min(1, 'name is required').max(200),
  hourlyLimit: z.coerce.number().int('hourlyLimit must be an integer').min(1).max(100000).default(200),
});

export type CreateSenderInput = z.infer<typeof createSenderSchema>;

const senderSelect = { id: true, email: true, name: true, hourlyLimit: true, createdAt: true } as const;

/** All senders owned by the user, oldest first. */
export function listSenders(userId: string) {
  return prisma.sender.findMany({ where: { userId }, select: senderSelect, orderBy: { createdAt: 'asc' } });
}

/** Create a sender for the user; email must be unique per user (409 on conflict). */
export async function createSender(userId: string, rawInput: unknown) {
  const parsed = createSenderSchema.safeParse(rawInput);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new AppError(400, 'VALIDATION_ERROR', message);
  }
  try {
    return await prisma.sender.create({ data: { userId, ...parsed.data }, select: senderSelect });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'SENDER_EXISTS', 'You already have a sender with this email address');
    }
    throw err;
  }
}
