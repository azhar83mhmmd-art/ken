/*
 * Kairoo API | Admin
 *
 * Di Vercel (serverless), proses bisa dibekukan begitu response selesai
 * dikirim, sehingga pekerjaan "fire-and-forget" (mis. insert ke Supabase)
 * kadang tidak sempat selesai. Vercel menyediakan waitUntil() lewat
 * request-context global; helper ini memakainya kalau ada (tanpa menambah
 * dependency), dan diam saja di lingkungan lain (lokal/VPS).
 */
export const keepAlive = (task: Promise<unknown>): void => {
    try {
        const holder = (globalThis as any)[Symbol.for('@vercel/request-context')];
        const ctx = holder && typeof holder.get === 'function' ? holder.get() : null;

        if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(task.catch(() => undefined));
        }
    } catch {
        /* abaikan: ini hanya optimisasi */
    }
};
