import type { NextFunction, Request, Response } from 'express';
import { createSender, listSenders } from '../services/senders.service.js';

export async function listSendersHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({ senders: await listSenders(req.authUser!.id) });
  } catch (err) {
    next(err);
  }
}

export async function createSenderHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(201).json(await createSender(req.authUser!.id, req.body));
  } catch (err) {
    next(err);
  }
}
