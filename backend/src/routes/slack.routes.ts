import { Router } from 'express';
import { slackCallback, slackConnect, slackDisconnect, slackStatus } from '../controllers/slack.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const slackRouter = Router();

slackRouter.use(requireAuth);

slackRouter.get('/slack/connect', slackConnect);
slackRouter.get('/slack/callback', slackCallback);
slackRouter.get('/slack/status', slackStatus);
slackRouter.post('/slack/disconnect', slackDisconnect);
