/*
 * Kairoo API | Admin
 *
 *   POST /api/admin/track        (publik)  beacon pengunjung dari browser
 *   GET  /api/admin/status       (publik)  apakah admin & Supabase sudah dikonfigurasi
 *   POST /api/admin/login        (publik)  password -> token
 *   GET  /api/admin/session      (admin)   kredensial Supabase Realtime
 *   GET  /api/admin/overview     (admin)   semua angka dashboard (1 RPC)
 *   POST /api/admin/maintenance  (admin)   nyalakan/matikan mode maintenance
 *   POST /api/admin/purge        (admin)   hapus log lama
 *
 * Data pengunjung TIDAK menyimpan IP. Hanya: id acak dari browser, path,
 * domain referrer, jenis perangkat/browser (kasar), dan kode negara dari
 * header Vercel.
 */
import { Router, Request, Response } from 'express';
import { supabase, hasSupabase } from '../supabase/client';
import { hashIp } from '../supabase/hashIp';
import { keepAlive } from './keepAlive';
import {
    isAdminConfigured,
    verifyPassword,
    issueToken,
    requireAdmin,
    lockRemainingMs,
    registerFail,
    clearFails,
    getRealtimeInfo
} from './adminAuth';
import { getMaintenance, setMaintenance } from './maintenance';

export const adminRouter = Router();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const getIp = (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    let ip = '';

    if (typeof forwarded === 'string') ip = forwarded.split(',')[0].trim();
    else if (Array.isArray(forwarded)) ip = (forwarded[0] || '').trim();
    else ip = req.ip || req.socket?.remoteAddress || '';

    return ip.replace('::ffff:', '') || 'unknown';
};

/* ---------------- status publik ---------------- */
adminRouter.get('/status', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
        status: true,
        configured: isAdminConfigured(),
        supabase: hasSupabase,
        realtime: Boolean(process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_JWT_SECRET && hasSupabase)
    });
});

/* ---------------- login ---------------- */
adminRouter.post('/login', async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!isAdminConfigured()) {
        return res.status(503).json({
            status: false,
            code: 'NOT_CONFIGURED',
            message: 'Admin belum dikonfigurasi. Set ADMIN_PASSWORD di Environment Variables Vercel lalu redeploy.'
        });
    }

    const key = hashIp(getIp(req));
    const locked = lockRemainingMs(key);

    if (locked > 0) {
        res.setHeader('Retry-After', String(Math.ceil(locked / 1000)));
        return res.status(429).json({
            status: false,
            code: 'LOCKED',
            retryAfter: Math.ceil(locked / 1000),
            message: 'Terlalu banyak percobaan gagal. Coba lagi beberapa menit lagi.'
        });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!password || password.length > 200 || !verifyPassword(password)) {
        const remaining = registerFail(key);
        await sleep(700); // perlambat tebakan beruntun
        return res.status(401).json({
            status: false,
            code: 'BAD_PASSWORD',
            remaining,
            message: remaining > 0 ? `Password salah. Sisa percobaan: ${remaining}.` : 'Password salah. Akses dikunci sementara.'
        });
    }

    clearFails(key);
    const { token, expiresAt } = issueToken();

    return res.json({ status: true, token, expiresAt, realtime: getRealtimeInfo() });
});

adminRouter.get('/session', requireAdmin, (_req: Request, res: Response) => {
    return res.json({ status: true, realtime: getRealtimeInfo() });
});

/* ---------------- beacon pengunjung (publik) ---------------- */
const trackHits = new Map<string, { n: number; resetAt: number }>();

const parseDevice = (ua: string): string => {
    if (/ipad|tablet/i.test(ua)) return 'tablet';
    if (/mobi|android|iphone|ipod/i.test(ua)) return 'mobile';
    return 'desktop';
};

const parseBrowser = (ua: string): string => {
    if (/edg\//i.test(ua)) return 'Edge';
    if (/opr\/|opera/i.test(ua)) return 'Opera';
    if (/firefox|fxios/i.test(ua)) return 'Firefox';
    if (/samsungbrowser/i.test(ua)) return 'Samsung';
    if (/chrome|crios/i.test(ua)) return 'Chrome';
    if (/safari/i.test(ua)) return 'Safari';
    return 'Lainnya';
};

adminRouter.post('/track', async (req: Request, res: Response) => {
    try {
        if (!hasSupabase || !supabase) return res.status(204).end();

        const body = req.body || {};
        const vid = typeof body.vid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.vid) ? body.vid : '';
        if (!vid) return res.status(204).end();

        // batasi: maks 90 beacon / menit / IP
        const ipKey = hashIp(getIp(req));
        const now = Date.now();
        const hit = trackHits.get(ipKey);

        if (!hit || hit.resetAt < now) trackHits.set(ipKey, { n: 1, resetAt: now + 60_000 });
        else if (++hit.n > 90) return res.status(204).end();

        if (trackHits.size > 3000) {
            for (const [k, v] of trackHits) if (v.resetAt < now) trackHits.delete(k);
        }

        let path = typeof body.path === 'string' ? body.path.split('?')[0].slice(0, 120) : '/';
        if (!path.startsWith('/')) path = '/' + path;
        if (path.startsWith('/admin')) return res.status(204).end();

        const ref = typeof body.ref === 'string' && body.ref ? body.ref.slice(0, 80) : null;
        const ua = String(req.headers['user-agent'] || '');
        const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2) || null;

        const task = Promise.resolve(
            supabase.rpc('track_site_visit', {
                p_vid: vid,
                p_path: path,
                p_ref: ref,
                p_device: parseDevice(ua),
                p_browser: parseBrowser(ua),
                p_country: country,
                p_pageview: body.pv !== false
            })
        ).then(({ error }: { error: any }) => {
            if (error) console.error('[Admin] track gagal:', error.message);
        });

        keepAlive(task);
        await task;
    } catch (error: any) {
        console.error('[Admin] track error:', error?.message || error);
    }

    return res.status(204).end();
});

/* ---------------- dashboard ---------------- */
const serverInfo = () => {
    const mem = process.memoryUsage();

    return {
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1048576),
        heapMb: Math.round(mem.heapUsed / 1048576),
        node: process.version,
        platform: process.env.VERCEL ? 'Vercel' : process.platform,
        region: process.env.VERCEL_REGION || null
    };
};

adminRouter.get('/overview', requireAdmin, async (_req: Request, res: Response) => {
    if (!hasSupabase || !supabase) {
        return res.json({ status: true, supabase: false, server: serverInfo() });
    }

    const { data, error } = await supabase.rpc('kairoo_admin_overview');

    if (error) {
        return res.status(500).json({
            status: false,
            code: 'RPC_ERROR',
            message: error.message,
            hint: 'Jalankan supabase/admin_schema.sql di Supabase SQL Editor.'
        });
    }

    return res.json({
        status: true,
        supabase: true,
        data,
        maintenance: await getMaintenance(true),
        server: serverInfo(),
        serverTime: new Date().toISOString()
    });
});

adminRouter.post('/maintenance', requireAdmin, async (req: Request, res: Response) => {
    const enabled = req.body?.enabled === true;
    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    const result = await setMaintenance(enabled, message);

    if (!result.ok) {
        return res.status(500).json({ status: false, message: result.error || 'Gagal menyimpan.' });
    }

    return res.json({ status: true, maintenance: result.state });
});

adminRouter.post('/purge', requireAdmin, async (req: Request, res: Response) => {
    if (!hasSupabase || !supabase) {
        return res.status(503).json({ status: false, message: 'Supabase belum dikonfigurasi.' });
    }

    const raw = parseInt(String(req.body?.days), 10);
    const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, raw)) : 14;

    const { data, error } = await supabase.rpc('kairoo_admin_purge', { p_days: days });

    if (error) return res.status(500).json({ status: false, message: error.message });

    return res.json({ status: true, days, deleted: data });
});
