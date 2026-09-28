import { Router } from 'express';
import { detailHandler, scheduledHandler, sentHandler, scheduleHandler } from '../controllers/emails.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

emailsRouter.post('/emails/schedule', scheduleHandler);
emailsRouter.get('/emails/scheduled', scheduledHandler);
emailsRouter.get('/emails/sent', sentHandler);
emailsRouter.get('/emails/:id', detailHandler);
