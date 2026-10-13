/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Util generate/hash/parse API Key. Format:
 *   kairo_<slug>_<secret>
 * <slug>       : "myapp" (custom, Premium) atau "default" (Free)
 * <secret>     : random cryptographically secure, TIDAK PERNAH ditentukan user
 *
 * Raw key hanya boleh ditampilkan sekali (saat create/regenerate). Yang
 * disimpan permanen di DB adalah key_hash (sha256), sesuai poin keamanan
 * spesifikasi.
 */
import crypto from 'crypto';

const KEY_PREFIX = 'kairo';
const SECRET_BYTES = 24; // -> 32 base64url chars

const RESERVED_ENDPOINT_NAMES = new Set([
    'api', 'premium', 'docs', 'monitor', 'status', 'logs', 'feedback',
    'about', 'privacy', 'terms', 'stats', 'config', 'src', 'public',
    'login', 'signup', 'auth', 'dashboard', 'admin', 'static', 'assets',
    'favicon.ico', 'health', 'webhook', 'webhooks'
]);

function randomSecret(): string {
    return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

/*
 * Normalisasi & validasi custom endpoint name (poin 5 spesifikasi).
 * - hanya huruf/angka/dash/underscore
 * - tanpa spasi
 * - panjang 3-32 karakter
 * - tidak boleh reserved route
 * - cegah path traversal (karakter di luar whitelist otomatis ditolak,
 *   jadi "..", "/", "%2e" dsb. tidak pernah lolos)
 */
export function normalizeEndpointName(input: string): { ok: true; value: string } | { ok: false; reason: string } {
    const value = String(input || '').trim().toLowerCase();

    if (!value) return { ok: false, reason: 'Nama endpoint tidak boleh kosong.' };
    if (value.length < 3 || value.length > 32) {
        return { ok: false, reason: 'Nama endpoint harus 3-32 karakter.' };
    }
    if (!/^[a-z0-9_-]+$/.test(value)) {
        return { ok: false, reason: 'Nama endpoint hanya boleh huruf, angka, dash (-), dan underscore (_), tanpa spasi.' };
    }
    if (RESERVED_ENDPOINT_NAMES.has(value)) {
        return { ok: false, reason: `"${value}" adalah nama route sistem dan tidak boleh dipakai.` };
    }

    return { ok: true, value };
}

/*
 * Slug untuk bagian tampilan API Key (kairo_<slug>_secret). Free tier
 * selalu "default" (tidak bisa custom); Premium boleh pakai endpoint_name
 * yang sudah divalidasi normalizeEndpointName.
 */
function slugForKey(endpointName: string | null): string {
    return endpointName || 'default';
}

export function generateApiKey(endpointName: string | null): { rawKey: string; prefix: string; hash: string } {
    const slug = slugForKey(endpointName);
    const secret = randomSecret();
    const rawKey = `${KEY_PREFIX}_${slug}_${secret}`;
    const prefix = `${KEY_PREFIX}_${slug}`;

    return { rawKey, prefix, hash: sha256(rawKey) };
}

export function maskApiKey(prefix: string): string {
    return `${prefix}_${'•'.repeat(8)}`;
}
