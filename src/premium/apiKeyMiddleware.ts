/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Middleware inti (poin 16 spesifikasi):
 * 1. API Key tersedia?          -> 401 API Key Required
 * 2. API Key valid (hash cocok)?-> 401 Invalid API Key
 * 3. API Key aktif (bukan revoked/suspended)? -> 401 Invalid API Key
 * 4. User aktif?                -> (profil ada, tidak ada status "nonaktif"
 *                                    terpisah di spec — cukup 1-3 & 5-8)
 * 5. Tier user?                 -> req.premiumAuth.tier
 * 6. Quota?                     -> 429 Daily quota exceeded
 * 7. Rate limit?                -> 429 Too Many Requests
 * 8. Kalau Premium Endpoint, apakah Premium? -> ditangani di
 *    src/premium/premiumProxy.ts (dipasang SETELAH middleware ini)
 * 9. Lolos -> next() ke endpoint asli
 * 10. Catat usage -> res.on('finish') di bawah, HANYA kalau lolos 1-7
 *
 * PENTING: middleware ini TIDAK dipasang global di index.ts (endpoint lama
 * /api/... tanpa API Key TETAP jalan seperti biasa, sesuai "jangan merusak
 * fitur yang sudah ada"). Middleware ini hanya dipasang di:
 *   - GET/POST /api/... yang memang didaftarkan sebagai protected (opsional)
 *   - /premium/:endpointName/* (WAJIB, lihat premiumProxy.ts)
 */
import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, hasPremiumSupabase } from './supabaseAdmin';
import { sha256 } from './apiKey';
import { consumeQuota } from './quota';

export type PremiumAuth = {
    userId: string;
    apiKeyId: string;
    tier: 'free' | 'premium';
    endpointName: string | null;
};

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            premiumAuth?: PremiumAuth;
        }
    }
}

function getApiKeyFromRequest(req: Request): string | null {
    const header = req.headers['x-api-key'];
    if (typeof header === 'string' && header.trim()) return header.trim();
    if (Array.isArray(header) && header[0]) return header[0].trim();
    return null;
}

/*
 * requireApiKey: dipakai sebagai express middleware biasa
 * (app.use(requireApiKey) hanya di route yang butuh, BUKAN global).
 */
export const requireApiKey = async (req: Request, res: Response, next: NextFunction) => {
    if (!hasPremiumSupabase || !supabaseAdmin) {
        return res.status(503).json({
            status: false,
            message: 'Kairoo Premium belum dikonfigurasi di server ini (Supabase belum diisi).'
        });
    }

    const rawKey = getApiKeyFromRequest(req);

    // 1. API Key tersedia?
    if (!rawKey) {
        return res.status(401).json({ status: false, message: 'API Key Required' });
    }

    if (!rawKey.startsWith('kairo_')) {
        return res.status(401).json({ status: false, message: 'Invalid API Key' });
    }

    const keyHash = sha256(rawKey);

    const { data: keyRow, error: keyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, user_id, status, endpoint_name')
        .eq('key_hash', keyHash)
        .maybeSingle();

    // 2. API Key valid?
    if (keyError || !keyRow) {
        return res.status(401).json({ status: false, message: 'Invalid API Key' });
    }

    // 3. API Key aktif (bukan revoked/suspended)?
    if (keyRow.status !== 'active') {
        return res.status(401).json({ status: false, message: 'Invalid API Key' });
    }

    const { data: profile, error: profileError } = await supabaseAdmin
        .from('profiles')
        .select('id, tier, premium_status, premium_expires_at')
        .eq('id', keyRow.user_id)
        .maybeSingle();

    // 4. User aktif (profil ditemukan)?
    if (profileError || !profile) {
        return res.status(401).json({ status: false, message: 'Invalid API Key' });
    }

    // 5. Tier user — Premium yang sudah expired otomatis diperlakukan Free
    //    (tidak menghapus data, hanya menurunkan hak akses saat itu juga).
    const now = Date.now();
    const expiresAt = profile.premium_expires_at ? new Date(profile.premium_expires_at).getTime() : 0;
    const isPremiumActive = profile.tier === 'premium' && profile.premium_status === 'active' && expiresAt > now;
    const effectiveTier: 'free' | 'premium' = isPremiumActive ? 'premium' : 'free';

    // 6 & 7. Quota harian + rate limit per detik (berbasis akun).
    const quota = await consumeQuota(profile.id, effectiveTier);

    if (!quota.allowed) {
        if (quota.reason === 'second') {
            res.setHeader('Retry-After', '1');
            return res.status(429).json({ status: false, message: 'Too many requests. Slow down.' });
        }

        return res.status(429).json({
            status: false,
            message: 'Daily quota exceeded',
            usage: { used: quota.used - 1, limit: quota.limit }
        });
    }

    req.premiumAuth = {
        userId: profile.id,
        apiKeyId: keyRow.id,
        tier: effectiveTier,
        endpointName: keyRow.endpoint_name
    };

    // last_used_at: fire-and-forget, tidak boleh menahan response.
    supabaseAdmin
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', keyRow.id)
        .then(() => {}, () => {});

    next();
};

/*
 * recordUsage: dipasang SETELAH endpoint asli selesai (res.on('finish')),
 * supaya status_code & response_time yang dicatat adalah hasil NYATA dari
 * endpoint, bukan ditebak sebelum dijalankan. Hanya jalan kalau
 * req.premiumAuth ada (artinya sudah lolos requireApiKey di atas).
 */
export const recordUsage = (req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on('finish', () => {
        const auth = req.premiumAuth;
        if (!auth || !supabaseAdmin) return;

        const responseTime = Date.now() - startedAt;
        const endpoint = req.baseUrl && req.path ? `${req.baseUrl}${req.path}` : req.originalUrl.split('?')[0];

        supabaseAdmin
            .from('request_logs')
            .insert({
                user_id: auth.userId,
                api_key_id: auth.apiKeyId,
                endpoint,
                method: req.method,
                status_code: res.statusCode,
                response_time: responseTime
            })
            .then(() => {}, (error: unknown) => {
                console.error('[Premium Usage] Gagal mencatat request_logs:', error);
            });
    });

    next();
};
