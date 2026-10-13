/*
 * Kairoo API | Kairoo Premium — Developer Tools
 * Dashboard: Developer Analytics (poin 8) + Request History (poin 9).
 * Sumber data: request_logs (hanya diisi oleh recordUsage setelah request
 * lolos validasi API Key — lihat apiKeyMiddleware.ts).
 */
import { Router, Request, Response } from 'express';
import { requireDashboardAuth } from '../authUser';
import { supabaseAdmin } from '../supabaseAdmin';

export const analyticsRoutes = Router();
analyticsRoutes.use(requireDashboardAuth);

function todayRangeJakarta(): { fromIso: string; toIso: string } {
    const now = new Date();
    const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const startJakarta = new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate()));
    const fromUtcMs = startJakarta.getTime() - 7 * 60 * 60 * 1000;
    const toUtcMs = fromUtcMs + 24 * 60 * 60 * 1000;
    return { fromIso: new Date(fromUtcMs).toISOString(), toIso: new Date(toUtcMs).toISOString() };
}

// GET /api/premium/analytics — ringkasan hari ini + top endpoints
analyticsRoutes.get('/analytics', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;
    const { fromIso, toIso } = todayRangeJakarta();

    const { data: rows, error } = await supabaseAdmin!
        .from('request_logs')
        .select('endpoint, status_code')
        .eq('user_id', userId)
        .gte('created_at', fromIso)
        .lt('created_at', toIso)
        .limit(20000);

    if (error) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil analytics.' });
    }

    const list = rows || [];
    const total = list.length;
    const success = list.filter((r) => r.status_code >= 200 && r.status_code < 400).length;
    const failed = total - success;

    const perEndpoint = new Map<string, number>();
    for (const r of list) {
        perEndpoint.set(r.endpoint, (perEndpoint.get(r.endpoint) || 0) + 1);
    }
    const topEndpoints = [...perEndpoint.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([endpoint, count]) => ({ endpoint, count }));

    const { data: profile } = await supabaseAdmin!
        .from('profiles')
        .select('tier, premium_status, premium_expires_at')
        .eq('id', userId)
        .maybeSingle();

    const expiresAt = profile?.premium_expires_at ? new Date(profile.premium_expires_at).getTime() : 0;
    const isPremium = profile?.tier === 'premium' && profile?.premium_status === 'active' && expiresAt > Date.now();
    const dailyLimit = isPremium ? 10000 : 1000;

    return res.json({
        status: true,
        today: { requests: total, success, failed },
        usage: { used: total, limit: dailyLimit },
        top_endpoints: topEndpoints
    });
});

// GET /api/premium/history?page=1&page_size=20
analyticsRoutes.get('/history', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 20));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await supabaseAdmin!
        .from('request_logs')
        .select('endpoint, method, status_code, response_time, created_at', { count: 'exact' })
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(from, to);

    if (error) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil request history.' });
    }

    return res.json({
        status: true,
        page,
        page_size: pageSize,
        total: count ?? 0,
        history: data || []
    });
});
