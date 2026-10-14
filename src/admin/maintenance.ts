/*
 * Kairoo API | Admin
 *
 * Mode maintenance yang bisa dinyalakan dari dashboard admin. Status
 * disimpan di Supabase (tabel admin_settings, key = 'maintenance') jadi
 * berlaku untuk semua instance serverless. Hanya endpoint produk
 * (/api/<kategori>/..., /premium/...) yang diblokir dengan 503; halaman
 * web, /docs, /config, dan dashboard admin tetap bisa dibuka.
 */
import { Request, Response, NextFunction } from 'express';
import { supabase, hasSupabase } from '../supabase/client';
import { endpointsRegistry } from '../registry';

export type MaintenanceState = { enabled: boolean; message: string };

const DEFAULT_MESSAGE = 'Sedang maintenance, coba lagi beberapa saat lagi.';
const TTL_MS = 10_000;

let cache: MaintenanceState = { enabled: false, message: DEFAULT_MESSAGE };
let cachedAt = 0;
let refreshing: Promise<void> | null = null;

const categories = Object.keys(endpointsRegistry).map((c) => c.toLowerCase());

const isProductPath = (p: string): boolean => {
    if (p.startsWith('/premium/')) return true;
    if (!p.startsWith('/api/')) return false;

    const category = p.split('/')[2] || '';
    return categories.includes(category.toLowerCase());
};

const normalize = (value: any): MaintenanceState => ({
    enabled: Boolean(value && value.enabled),
    message:
        value && typeof value.message === 'string' && value.message.trim()
            ? value.message.trim().slice(0, 200)
            : DEFAULT_MESSAGE
});

const refresh = async (): Promise<void> => {
    if (!hasSupabase || !supabase) return;

    try {
        const { data, error } = await supabase
            .from('admin_settings')
            .select('value')
            .eq('key', 'maintenance')
            .maybeSingle();

        if (!error && data) cache = normalize((data as any).value);
    } catch {
        /* tabel belum dibuat / jaringan: pertahankan cache lama */
    } finally {
        cachedAt = Date.now();
    }
};

export const getMaintenance = async (force = false): Promise<MaintenanceState> => {
    if (force || Date.now() - cachedAt > TTL_MS) {
        if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
        await Promise.race([refreshing, new Promise<void>((r) => setTimeout(r, 1500))]);
    }

    return cache;
};

export const setMaintenance = async (
    enabled: boolean,
    message: string
): Promise<{ ok: boolean; error?: string; state?: MaintenanceState }> => {
    if (!hasSupabase || !supabase) return { ok: false, error: 'Supabase belum dikonfigurasi.' };

    const state = normalize({ enabled, message });
    const { error } = await supabase
        .from('admin_settings')
        .upsert({ key: 'maintenance', value: state, updated_at: new Date().toISOString() });

    if (error) return { ok: false, error: error.message };

    cache = state;
    cachedAt = Date.now();
    return { ok: true, state };
};

export const maintenanceGuard = async (req: Request, res: Response, next: NextFunction) => {
    if (!isProductPath(req.path)) return next();

    try {
        const state = await getMaintenance();

        if (state.enabled) {
            res.setHeader('Retry-After', '120');
            return res.status(503).json({
                status: false,
                maintenance: true,
                message: state.message
            });
        }
    } catch {
        /* jangan pernah menjatuhkan API karena fitur ini */
    }

    return next();
};
