import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

export interface ApiErrorBody {
  success: false;
  error: { code: string; message: string };
}

export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiErrorBody = {
      success: false,
      error: { code: err.code, message: err.message },
    };
    res.status(err.statusCode).json(body);
    return;
  }
  logger.error({ err }, 'unhandled error');
  const body: ApiErrorBody = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: env.NODE_ENV === 'production' ? 'Internal server error' : String((err as Error)?.message ?? err),
    },
  };
  res.status(500).json(body);
}

export function notFoundMiddleware(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } });
}
