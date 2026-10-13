/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Middleware auth DASHBOARD (bukan API Key). Memverifikasi Supabase Auth
 * JWT dari header Authorization: Bearer <access_token> yang dikirim
 * frontend setelah user login (email/password atau Google OAuth).
 *
 * Endpoint dashboard (create/regenerate/revoke key, analytics, history,
 * klaim premium) memakai middleware ini — BUKAN requireApiKey — karena
 * itu untuk request API publik dengan x-api-key, sedangkan ini untuk
 * pemilik akun yang mengelola akunnya sendiri.
 *
 * Identitas user_id SELALU diambil dari token yang diverifikasi Supabase,
 * TIDAK PERNAH dipercaya dari request body/query (poin keamanan spec).
 */
import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, hasPremiumSupabase } from './supabaseAdmin';

export type DashboardUser = { id: string; email: string | null };

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            dashboardUser?: DashboardUser;
        }
    }
}

export const requireDashboardAuth = async (req: Request, res: Response, next: NextFunction) => {
    if (!hasPremiumSupabase || !supabaseAdmin) {
        return res.status(503).json({ status: false, message: 'Kairoo Premium belum dikonfigurasi di server ini.' });
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
        return res.status(401).json({ status: false, message: 'Login diperlukan.' });
    }

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
        return res.status(401).json({ status: false, message: 'Sesi login tidak valid, silakan login ulang.' });
    }

    req.dashboardUser = { id: data.user.id, email: data.user.email ?? null };
    next();
};
