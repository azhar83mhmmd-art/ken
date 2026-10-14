/*
 * Kairoo API | Admin
 *
 * Autentikasi admin sederhana & aman untuk serverless:
 *  - Password admin dari env ADMIN_PASSWORD (TIDAK disimpan di database,
 *    TIDAK pernah dikirim ke browser).
 *  - Login sukses -> token bertanda tangan HMAC-SHA256 (stateless), berlaku
 *    12 jam, dikirim lewat header Authorization: Bearer <token>.
 *  - Batas percobaan login gagal per IP (hash) supaya tidak bisa ditebak
 *    berulang-ulang.
 *  - Opsional: JWT khusus Supabase Realtime (butuh SUPABASE_JWT_SECRET)
 *    supaya dashboard bisa menerima event realtime langsung dari Supabase
 *    dengan RLS (hanya token admin yang boleh membaca tabel log).
 */
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

const PASSWORD = process.env.ADMIN_PASSWORD || '';

const SECRET =
    process.env.ADMIN_TOKEN_SECRET ||
    (PASSWORD
        ? crypto
              .createHash('sha256')
              .update(`kairoo-admin:${PASSWORD}:${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`)
              .digest('hex')
        : '');

export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export const isAdminConfigured = (): boolean => PASSWORD.length > 0 && SECRET.length > 0;

const b64u = (input: Buffer | string): string =>
    Buffer.from(input).toString('base64url');

const sign = (body: string): string =>
    crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

const sha = (value: string): Buffer =>
    crypto.createHash('sha256').update(value).digest();

export const verifyPassword = (candidate: string): boolean => {
    if (!isAdminConfigured()) return false;
    // bandingkan hash (panjang sama) -> constant-time, tidak bocor panjang password
    return crypto.timingSafeEqual(sha(candidate), sha(PASSWORD));
};

export const issueToken = (): { token: string; expiresAt: number } => {
    const now = Date.now();
    const expiresAt = now + TOKEN_TTL_MS;
    const payload = b64u(
        JSON.stringify({ role: 'admin', iat: now, exp: expiresAt, n: crypto.randomBytes(6).toString('hex') })
    );

    return { token: `${payload}.${sign(payload)}`, expiresAt };
};

export const verifyToken = (token: string): boolean => {
    if (!isAdminConfigured() || typeof token !== 'string') return false;

    const parts = token.split('.');
    if (parts.length !== 2) return false;

    const [payload, signature] = parts;
    const expected = sign(payload);

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return data && data.role === 'admin' && typeof data.exp === 'number' && data.exp > Date.now();
    } catch {
        return false;
    }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!verifyToken(token)) {
        return res.status(401).json({
            status: false,
            code: 'UNAUTHORIZED',
            message: 'Sesi admin tidak valid atau sudah berakhir. Silakan login lagi.'
        });
    }

    return next();
};

/* ---------------- batas percobaan login ---------------- */
type Attempt = { fails: number; firstAt: number; lockedUntil: number };

const attempts = new Map<string, Attempt>();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export const lockRemainingMs = (key: string): number => {
    const a = attempts.get(key);
    if (!a) return 0;
    const now = Date.now();

    if (a.lockedUntil > now) return a.lockedUntil - now;
    if (now - a.firstAt > WINDOW_MS) attempts.delete(key);

    return 0;
};

export const registerFail = (key: string): number => {
    const now = Date.now();
    let a = attempts.get(key);

    if (!a || now - a.firstAt > WINDOW_MS) {
        a = { fails: 0, firstAt: now, lockedUntil: 0 };
    }

    a.fails += 1;
    if (a.fails >= MAX_FAILS) a.lockedUntil = now + LOCK_MS;
    attempts.set(key, a);

    if (attempts.size > 2000) {
        for (const [k, v] of attempts) {
            if (v.lockedUntil < now && now - v.firstAt > WINDOW_MS) attempts.delete(k);
        }
    }

    return Math.max(0, MAX_FAILS - a.fails);
};

export const clearFails = (key: string): void => {
    attempts.delete(key);
};

/* ---------------- Supabase Realtime (opsional) ---------------- */
export type RealtimeInfo = { url: string; anonKey: string; jwt: string } | null;

export const getRealtimeInfo = (): RealtimeInfo => {
    const url = process.env.SUPABASE_URL || '';
    const anonKey = process.env.SUPABASE_ANON_KEY || '';
    const jwtSecret = process.env.SUPABASE_JWT_SECRET || '';

    if (!url || !anonKey || !jwtSecret) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64u(
        JSON.stringify({
            aud: 'authenticated',
            role: 'authenticated',
            sub: '00000000-0000-4000-8000-00000000a001',
            app_role: 'kairoo_admin',
            iat: now,
            exp: now + Math.floor(TOKEN_TTL_MS / 1000)
        })
    );
    const sig = crypto.createHmac('sha256', jwtSecret).update(`${header}.${body}`).digest('base64url');

    return { url, anonKey, jwt: `${header}.${body}.${sig}` };
};
