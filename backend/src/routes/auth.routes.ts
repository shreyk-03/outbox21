import { Router } from 'express';
import { googleCallback, googleStart, logout, me } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

export const authRouter = Router();

authRouter.get('/auth/google', googleStart);
authRouter.get('/auth/google/callback', googleCallback);
authRouter.get('/auth/me', requireAuth, me);
authRouter.post('/auth/logout', logout);
