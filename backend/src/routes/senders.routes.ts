import { Router } from 'express';
import { createSenderHandler, listSendersHandler } from '../controllers/senders.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const sendersRouter = Router();

sendersRouter.use(requireAuth);

sendersRouter.get('/senders', listSendersHandler);
sendersRouter.post('/senders', createSenderHandler);
