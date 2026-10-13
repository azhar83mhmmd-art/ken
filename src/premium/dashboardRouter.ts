/*
 * Kairoo API | Kairoo Premium — Developer Tools
 * Gabungan semua route dashboard di bawah /api/premium/*.
 * Dipasang terpisah dari /premium/* (proxy publik) di index.ts.
 */
import { Router } from 'express';
import { apiKeyRoutes } from './routes/apiKeyRoutes';
import { analyticsRoutes } from './routes/analyticsRoutes';
import { premiumRoutes } from './routes/premiumRoutes';

export const dashboardRouter = Router();

dashboardRouter.use(apiKeyRoutes);
dashboardRouter.use(analyticsRoutes);
dashboardRouter.use(premiumRoutes);
