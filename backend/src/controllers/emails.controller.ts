import type { NextFunction, Request, Response } from 'express';
import {
  getEmailById,
  getScheduledEmails,
  getSentEmails,
  scheduleBulkEmails,
  scheduleEmail,
} from '../services/email-scheduler.service.js';
import { searchEmails } from '../services/email-search.service.js';

export async function scheduleHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await scheduleEmail(req.authUser!.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function scheduleBulkHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await scheduleBulkEmails(req.authUser!.id, req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function scheduledHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const emails = await getScheduledEmails(req.authUser!.id);
    res.status(200).json({ emails });
  } catch (err) {
    next(err);
  }
}

export async function sentHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const emails = await getSentEmails(req.authUser!.id);
    res.status(200).json({ emails });
  } catch (err) {
    next(err);
  }
}

export async function detailHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const email = await getEmailById(req.authUser!.id, req.params.id as string);
    res.status(200).json(email);
  } catch (err) {
    next(err);
  }
}

export async function searchHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const emails = await searchEmails(req.authUser!.id, String(req.query.q ?? ''));
    res.status(200).json({ emails });
  } catch (err) {
    next(err);
  }
}
