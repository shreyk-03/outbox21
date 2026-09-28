import nodemailer, { type Transporter } from 'nodemailer';
import { env, isEtherealConfigured } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../middleware/error.middleware.js';

export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface SendEmailResult {
  messageId: string;
  /** Ethereal preview URL (null for non-Ethereal SMTP). Safe to log and return — it opens only the fake inbox message. */
  previewUrl: string | null;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!isEtherealConfigured()) {
    throw new AppError(
      503,
      'EMAIL_NOT_CONFIGURED',
      'Ethereal SMTP credentials are missing. Set ETHEREAL_USER and ETHEREAL_PASSWORD (create a free account at https://ethereal.email).',
    );
  }
  transporter = nodemailer.createTransport({
    host: env.ETHEREAL_HOST,
    port: env.ETHEREAL_PORT,
    secure: env.ETHEREAL_PORT === 465,
    auth: { user: env.ETHEREAL_USER as string, pass: env.ETHEREAL_PASSWORD as string },
  });
  return transporter;
}

/**
 * Send one email via Ethereal SMTP. Logs only the preview URL — never
 * credentials. Throws on transport failure so the caller (worker) can retry.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const info = await getTransporter().sendMail({
    from: env.ETHEREAL_FROM,
    to: input.to,
    subject: input.subject,
    text: input.body,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  logger.info({ to: input.to, messageId: info.messageId, previewUrl }, 'email sent via ethereal');
  return { messageId: info.messageId as string, previewUrl };
}

/** Test seam: reset the cached transporter (used by tests). */
export function resetEmailTransporter(): void {
  transporter = null;
}
