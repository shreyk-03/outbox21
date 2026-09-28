import { Router } from 'express';
import {
  detailHandler,
  scheduledHandler,
  searchHandler,
  sentHandler,
  scheduleHandler,
} from '../controllers/emails.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

emailsRouter.post('/emails/schedule', scheduleHandler);
emailsRouter.get('/emails/scheduled', scheduledHandler);
emailsRouter.get('/emails/sent', sentHandler);
// NOTE: /search must precede /:id or Express would treat "search" as an id.
emailsRouter.get('/emails/search', searchHandler);
emailsRouter.get('/emails/:id', detailHandler);
