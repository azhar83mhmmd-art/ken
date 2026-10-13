/*
 * Kairoo API | Kairoo Premium — Developer Tools
 * Dashboard: create / regenerate / revoke API Key. Semua write lewat
 * supabaseAdmin (service role, bypass RLS) — user_id dari JWT terverifikasi,
 * bukan dari body (lihat authUser.ts).
 *
 * WAJIB (poin 2 & 5 spesifikasi):
 * - 1 akun hanya 1 API Key (unique(user_id) di DB + upsert di sini)
 * - Regenerate hanya mengganti key lama (row yang sama, id tetap)
 * - Custom API Key (nama/endpoint_name) hanya untuk Premium
 * - Custom endpoint name harus unik, divalidasi normalizeEndpointName
 */
import { Router, Request, Response } from 'express';
import { requireDashboardAuth } from '../authUser';
import { supabaseAdmin } from '../supabaseAdmin';
import { generateApiKey, maskApiKey, normalizeEndpointName } from '../apiKey';

export const apiKeyRoutes = Router();
apiKeyRoutes.use(requireDashboardAuth);

async function getEffectiveTier(userId: string): Promise<'free' | 'premium'> {
    const { data: profile } = await supabaseAdmin!
        .from('profiles')
        .select('tier, premium_status, premium_expires_at')
        .eq('id', userId)
        .maybeSingle();

    if (!profile) return 'free';

    const expiresAt = profile.premium_expires_at ? new Date(profile.premium_expires_at).getTime() : 0;
    const active = profile.tier === 'premium' && profile.premium_status === 'active' && expiresAt > Date.now();
    return active ? 'premium' : 'free';
}

// GET /api/premium/keys — lihat key milik sendiri (masked)
apiKeyRoutes.get('/keys', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;

    const { data: key, error } = await supabaseAdmin!
        .from('api_keys')
        .select('id, name, key_prefix, endpoint_name, status, created_at, last_used_at, revoked_at')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) {
        return res.status(500).json({ status: false, message: 'Gagal mengambil API Key.' });
    }

    if (!key) {
        return res.json({ status: true, has_key: false, key: null });
    }

    return res.json({
        status: true,
        has_key: true,
        key: { ...key, masked_key: maskApiKey(key.key_prefix) }
    });
});

// POST /api/premium/keys — buat API Key (hanya kalau belum punya)
apiKeyRoutes.post('/keys', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;
    const projectName = String(req.body?.name || '').trim();

    const { data: existing } = await supabaseAdmin!
        .from('api_keys')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

    if (existing) {
        return res.status(409).json({ status: false, message: 'Kamu sudah memiliki API Key. Gunakan Regenerate untuk mengganti.' });
    }

    const tier = await getEffectiveTier(userId);

    let endpointName: string | null = null;

    if (tier === 'premium' && projectName) {
        const normalized = normalizeEndpointName(projectName);
        if (!normalized.ok) {
            return res.status(400).json({ status: false, message: normalized.reason });
        }

        const { data: taken } = await supabaseAdmin!
            .from('api_keys')
            .select('id')
            .eq('endpoint_name', normalized.value)
            .maybeSingle();

        if (taken) {
            return res.status(409).json({ status: false, message: 'Nama endpoint ini sudah dipakai akun lain.' });
        }

        endpointName = normalized.value;
    }

    const generated = generateApiKey(endpointName);

    const { data: inserted, error } = await supabaseAdmin!
        .from('api_keys')
        .insert({
            user_id: userId,
            name: tier === 'premium' ? (projectName || null) : null,
            key_prefix: generated.prefix,
            key_hash: generated.hash,
            endpoint_name: endpointName,
            status: 'active'
        })
        .select('id, name, key_prefix, endpoint_name, status, created_at')
        .single();

    if (error || !inserted) {
        return res.status(500).json({ status: false, message: 'Gagal membuat API Key.' });
    }

    // raw_key hanya muncul di response ini, sekali saja.
    return res.status(201).json({
        status: true,
        key: inserted,
        raw_key: generated.rawKey,
        premium_endpoint: endpointName ? `/premium/${endpointName}` : null
    });
});

// POST /api/premium/keys/regenerate — ganti secret, row/id tetap sama
apiKeyRoutes.post('/keys/regenerate', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;

    const { data: existing } = await supabaseAdmin!
        .from('api_keys')
        .select('id, endpoint_name, status')
        .eq('user_id', userId)
        .maybeSingle();

    if (!existing) {
        return res.status(404).json({ status: false, message: 'Kamu belum memiliki API Key.' });
    }

    const generated = generateApiKey(existing.endpoint_name);

    const { data: updated, error } = await supabaseAdmin!
        .from('api_keys')
        .update({
            key_prefix: generated.prefix,
            key_hash: generated.hash,
            status: 'active',
            revoked_at: null
        })
        .eq('id', existing.id)
        .select('id, name, key_prefix, endpoint_name, status, created_at')
        .single();

    if (error || !updated) {
        return res.status(500).json({ status: false, message: 'Gagal regenerate API Key.' });
    }

    return res.json({ status: true, key: updated, raw_key: generated.rawKey });
});

// POST /api/premium/keys/revoke
apiKeyRoutes.post('/keys/revoke', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;

    const { data: updated, error } = await supabaseAdmin!
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select('id')
        .maybeSingle();

    if (error) {
        return res.status(500).json({ status: false, message: 'Gagal revoke API Key.' });
    }
    if (!updated) {
        return res.status(404).json({ status: false, message: 'Kamu belum memiliki API Key.' });
    }

    return res.json({ status: true, message: 'API Key berhasil di-revoke.' });
});
