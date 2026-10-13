/*
 * Kairoo Premium — Developer Tools
 * Wrapper Supabase Auth di browser (login email/password, Google OAuth,
 * simpan session, expose access_token untuk dipakai fetch ke /api/premium/*).
 *
 * Dimuat via <script type="module"> di premium.html. Supabase URL/anon key
 * diambil dari GET /config (endpoint publik yang sudah ada) supaya tidak
 * perlu hardcode atau expose lewat file terpisah.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let supabase = null;
let configPromise = null;

async function getConfig() {
    if (!configPromise) {
        configPromise = fetch('/config').then((r) => r.json());
    }
    return configPromise;
}

export async function getSupabaseClient() {
    if (supabase) return supabase;

    const config = await getConfig();
    const url = config?.premium?.supabase_url;
    const anonKey = config?.premium?.supabase_anon_key;

    if (!url || !anonKey) {
        throw new Error('PREMIUM_NOT_CONFIGURED');
    }

    supabase = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
    });

    return supabase;
}

export async function getSession() {
    const client = await getSupabaseClient();
    const { data } = await client.auth.getSession();
    return data.session || null;
}

export async function signInWithPassword(email, password) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
}

export async function signUpWithPassword(email, password) {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    return data.session;
}

export async function signInWithGoogle() {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/premium' }
    });
    if (error) throw new Error(error.message);
}

export async function signOut() {
    const client = await getSupabaseClient();
    await client.auth.signOut();
}

/*
 * apiFetch: helper untuk memanggil /api/premium/* dengan Authorization
 * header otomatis dari session aktif. Melempar error kalau belum login.
 */
export async function apiFetch(path, options = {}) {
    const session = await getSession();
    if (!session) throw new Error('NOT_LOGGED_IN');

    const res = await fetch(path, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
            ...(options.headers || {})
        }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(data?.message || `Request gagal (${res.status})`);
    }

    return data;
}

export async function onAuthChange(callback) {
    const client = await getSupabaseClient();
    client.auth.onAuthStateChange((_event, session) => callback(session));
}
