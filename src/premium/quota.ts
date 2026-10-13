/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Quota harian + rate limit per detik BERBASIS AKUN (bukan IP), lewat
 * Upstash Redis. Terpisah dari src/middleware/rateLimit.ts (yang lama,
 * berbasis IP, tetap berjalan seperti biasa untuk semua request).
 *
 * Key Redis:
 *   quota:{user_id}:daily        -> counter, TTL sampai tengah malam UTC+7
 *   rate:{user_id}:second        -> counter, TTL 1 detik
 *
 * Kalau Upstash tidak dikonfigurasi, fallback ke memory (aman-crash,
 * sama seperti pola rateLimit.ts) — cukup untuk 1 instance/local/Termux,
 * TIDAK akurat lintas-instance di Vercel (banyak cold start = banyak
 * memory terpisah). Karena itu quota/rate limit Premium HANYA benar-benar
 * presisi kalau UPSTASH_REDIS_REST_URL/TOKEN diisi.
 */
import { Redis } from '@upstash/redis';

const isPlaceholder = (v: string): boolean => {
    const n = v.trim().toLowerCase();
    if (!n) return true;
    return n.includes('xxxx');
};

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL || '';
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';

const hasRedis = Boolean(upstashUrl) && Boolean(upstashToken) && !isPlaceholder(upstashUrl);

let redis: Redis | null = null;
if (hasRedis) {
    try {
        redis = Redis.fromEnv();
    } catch (error) {
        console.error(
            '[✗] Gagal membuat Upstash Redis client untuk quota Premium, fallback ke memory:',
            error instanceof Error ? error.message : error
        );
        redis = null;
    }
}

export const FREE_DAILY_QUOTA = 1000;
export const FREE_RATE_PER_SECOND = 10;
export const PREMIUM_DAILY_QUOTA = 10000;
export const PREMIUM_RATE_PER_SECOND = 50;

function secondsUntilMidnightJakarta(): number {
    const now = new Date();
    // WIB = UTC+7, tanpa perlu library timezone tambahan.
    const jakartaMs = now.getTime() + 7 * 60 * 60 * 1000;
    const jakarta = new Date(jakartaMs);
    const next = new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate() + 1));
    const nextUtcMs = next.getTime() - 7 * 60 * 60 * 1000;
    return Math.max(1, Math.ceil((nextUtcMs - now.getTime()) / 1000));
}

function dailyDateKeyJakarta(): string {
    const now = new Date();
    const jakarta = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return jakarta.toISOString().slice(0, 10); // YYYY-MM-DD
}

type MemoryDaily = { date: string; count: number };
const memoryDaily = new Map<string, MemoryDaily>();
const memorySecond = new Map<string, { windowStart: number; count: number }>();

export type QuotaResult = {
    allowed: boolean;
    reason?: 'daily' | 'second';
    used: number;
    limit: number;
};

/*
 * Cek + increment rate per detik. Dipanggil SEBELUM quota harian supaya
 * burst pendek tidak ikut memakan quota harian kalau memang harus ditolak.
 */
async function checkRatePerSecond(userId: string, limit: number): Promise<boolean> {
    const key = `rate:${userId}:second`;

    if (redis) {
        try {
            const count = await redis.incr(key);
            if (count === 1) await redis.expire(key, 1);
            return count <= limit;
        } catch (error) {
            console.error('[Premium Quota] Redis error (rate), fallback memory:', error);
        }
    }

    const now = Date.now();
    const windowStart = Math.floor(now / 1000) * 1000;
    const entry = memorySecond.get(userId);

    if (!entry || entry.windowStart !== windowStart) {
        memorySecond.set(userId, { windowStart, count: 1 });
        return true;
    }

    entry.count += 1;
    return entry.count <= limit;
}

async function checkAndIncrementDaily(userId: string, limit: number): Promise<QuotaResult> {
    const key = `quota:${userId}:daily`;

    if (redis) {
        try {
            const count = await redis.incr(key);
            if (count === 1) await redis.expire(key, secondsUntilMidnightJakarta());
            return { allowed: count <= limit, used: count, limit };
        } catch (error) {
            console.error('[Premium Quota] Redis error (daily), fallback memory:', error);
        }
    }

    const dateKey = dailyDateKeyJakarta();
    let entry = memoryDaily.get(userId);

    if (!entry || entry.date !== dateKey) {
        entry = { date: dateKey, count: 0 };
        memoryDaily.set(userId, entry);
    }

    entry.count += 1;
    return { allowed: entry.count <= limit, used: entry.count, limit };
}

/*
 * consumeQuota HANYA dipanggil setelah API Key dinyatakan valid & aktif.
 * Kalau ditolak (baik rate/detik maupun quota harian), pemanggil WAJIB
 * tidak menjalankan endpoint asli dan tidak mencatat request_logs — sesuai
 * aturan "request yang ditolak sebelum endpoint dijalankan tidak dihitung
 * sebagai usage" (bedakan dari counter Redis di sini yang memang menghitung
 * SEMUA percobaan untuk keperluan rate limiting itu sendiri, bukan usage
 * resmi yang ditampilkan di Developer Analytics — usage resmi berasal dari
 * COUNT(request_logs), lihat src/premium/usage.ts).
 */
export async function consumeQuota(userId: string, tier: 'free' | 'premium'): Promise<QuotaResult> {
    const dailyLimit = tier === 'premium' ? PREMIUM_DAILY_QUOTA : FREE_DAILY_QUOTA;
    const rateLimit = tier === 'premium' ? PREMIUM_RATE_PER_SECOND : FREE_RATE_PER_SECOND;

    const rateOk = await checkRatePerSecond(userId, rateLimit);
    if (!rateOk) {
        return { allowed: false, reason: 'second', used: rateLimit + 1, limit: rateLimit };
    }

    return checkAndIncrementDaily(userId, dailyLimit);
}

export const hasPremiumRedis = hasRedis;
