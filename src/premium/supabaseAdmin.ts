/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Client Supabase khusus modul Premium. Sengaja terpisah dari
 * src/supabase/client.ts (yang lama, dipakai Server Monitor) supaya
 * modul Premium tidak pernah menyentuh/mengubah perilaku monitor.
 * Pola hasX yang aman-crash tetap sama persis.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const isPlaceholder = (v: string): boolean => {
    const n = v.trim().toLowerCase();
    if (!n) return true;
    return n.includes('xxxx') || n.includes('your-project');
};

const supabaseUrl = process.env.SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const hasPremiumSupabase =
    Boolean(supabaseUrl) &&
    Boolean(serviceRoleKey) &&
    !isPlaceholder(supabaseUrl) &&
    !isPlaceholder(serviceRoleKey);

if (!hasPremiumSupabase) {
    console.warn(
        '[!] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY belum lengkap — ' +
        'Kairoo Premium (API Key, dashboard, analytics) berjalan dalam mode nonaktif.'
    );
}

let client: SupabaseClient | null = null;

if (hasPremiumSupabase) {
    try {
        client = createClient(supabaseUrl, serviceRoleKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
    } catch (error) {
        console.error(
            '[✗] Gagal membuat Supabase admin client untuk Premium:',
            error instanceof Error ? error.message : error
        );
        client = null;
    }
}

// service-role client: HANYA dipakai di backend (bypass RLS). Jangan
// pernah expose instance ini atau SERVICE_ROLE_KEY ke response/frontend.
export const supabaseAdmin: SupabaseClient | null = client;
