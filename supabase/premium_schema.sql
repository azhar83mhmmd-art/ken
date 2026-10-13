-- Kairoo API | Supabase schema untuk Kairoo Premium — Developer Tools
-- Jalankan file ini di Supabase SQL Editor (Project > SQL Editor > New query),
-- SETELAH supabase/schema.sql (file ini tidak menyentuh/mengubah tabel monitor
-- yang sudah ada: api_requests, daily_stats, endpoints, daily_unique_visitors,
-- feedback).
--
-- Desain:
-- - profiles             : 1 baris per akun (dibuat otomatis saat signup lewat
--                           trigger di auth.users), menyimpan status tier/premium
-- - api_keys              : 1 baris per akun (unique(user_id) MENJAMIN aturan
--                           "1 akun = 1 API Key" langsung di level database,
--                           bukan cuma di application code)
-- - request_logs          : log per-request untuk Developer Analytics & Request
--                           History (hanya request yang lolos validasi API Key)
-- - premium_transactions  : histori deposit DigitalPedia untuk klaim Premium,
--                           dipakai untuk reconciliation & mencegah 1 deposit
--                           diklaim lebih dari sekali
--
-- Semua tabel di sini memakai Row Level Security (RLS): user hanya boleh
-- MEMBACA (select) baris miliknya sendiri. Semua PENULISAN (insert/update/
-- delete) — pembuatan API Key, regenerate, revoke, pencatatan usage, klaim
-- Premium — dilakukan lewat backend memakai SUPABASE_SERVICE_ROLE_KEY (yang
-- otomatis melewati RLS), BUKAN langsung dari client. Ini supaya identitas
-- user_id tidak pernah dipercaya mentah-mentah dari request body/client,
-- sesuai catatan keamanan di spesifikasi.

create extension if not exists pgcrypto;

-- =========================================================
-- Trigger helper: auto-update kolom updated_at
-- =========================================================
create or replace function premium_set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- =========================================================
-- 1. profiles — profil akun + status tier/premium
-- =========================================================
create table if not exists profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    email text,
    name text,
    avatar_url text,
    tier text not null default 'free' check (tier in ('free', 'premium')),
    premium_status text not null default 'inactive'
        check (premium_status in ('inactive', 'active', 'expired')),
    premium_started_at timestamptz,
    premium_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at
    before update on profiles
    for each row execute function premium_set_updated_at();

-- Auto-buat baris profiles begitu ada user baru di Supabase Auth
-- (email/password maupun Google OAuth sama-sama masuk ke auth.users).
create or replace function premium_handle_new_user() returns trigger as $$
begin
    insert into public.profiles (id, email, name, avatar_url)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
        new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
    after insert on auth.users
    for each row execute function premium_handle_new_user();

alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
    for select using (auth.uid() = id);

-- Sengaja TIDAK ada policy insert/update/delete untuk role authenticated —
-- perubahan tier/premium_status hanya boleh lewat backend (service role),
-- supaya user tidak bisa menaikkan tier miliknya sendiri lewat client.

-- =========================================================
-- 2. api_keys — API Key per akun (unique(user_id) = 1 akun 1 key)
-- =========================================================
create table if not exists api_keys (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique references profiles (id) on delete cascade,
    name text, -- nama project/identitas key, custom hanya untuk Premium
    key_prefix text not null, -- bagian yang boleh ditampilkan, mis. "kairo_myapp"
    key_hash text not null, -- sha256(full key), raw key TIDAK pernah disimpan
    endpoint_name text unique, -- slug /premium/<endpoint_name>/..., hanya Premium
    status text not null default 'active'
        check (status in ('active', 'revoked', 'suspended')),
    created_at timestamptz not null default now(),
    last_used_at timestamptz,
    revoked_at timestamptz,
    updated_at timestamptz not null default now()
);

create index if not exists idx_api_keys_key_hash on api_keys (key_hash);
create index if not exists idx_api_keys_endpoint_name on api_keys (endpoint_name);

drop trigger if exists trg_api_keys_updated_at on api_keys;
create trigger trg_api_keys_updated_at
    before update on api_keys
    for each row execute function premium_set_updated_at();

alter table api_keys enable row level security;

drop policy if exists "api_keys_select_own" on api_keys;
create policy "api_keys_select_own" on api_keys
    for select using (auth.uid() = user_id);

-- Insert/update/delete (create/regenerate/revoke) sengaja hanya lewat
-- backend (service role) — lihat src/routes/premium/*.ts.

-- =========================================================
-- 3. request_logs — log per-request untuk Analytics & History
-- =========================================================
create table if not exists request_logs (
    id bigint generated always as identity primary key,
    user_id uuid references profiles (id) on delete cascade,
    api_key_id uuid references api_keys (id) on delete set null,
    endpoint text not null,
    method text not null,
    status_code integer not null,
    response_time integer, -- ms, boleh null kalau tidak sempat diukur
    created_at timestamptz not null default now()
);

create index if not exists idx_request_logs_user_created on request_logs (user_id, created_at desc);
create index if not exists idx_request_logs_endpoint on request_logs (endpoint);

alter table request_logs enable row level security;

drop policy if exists "request_logs_select_own" on request_logs;
create policy "request_logs_select_own" on request_logs
    for select using (auth.uid() = user_id);

-- Insert hanya lewat backend (service role) setelah request lolos validasi
-- API Key — request tanpa/dengan API Key invalid TIDAK pernah masuk sini.

-- =========================================================
-- 4. premium_transactions — histori deposit DigitalPedia utk klaim Premium
-- =========================================================
create table if not exists premium_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles (id) on delete cascade,
    deposit_id text not null unique, -- id dari pay.digitalpedia.web.id, cegah klaim ganda
    amount integer not null,
    status text not null default 'pending'
        check (status in ('pending', 'success', 'expired', 'canceled')),
    premium_days_granted integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_premium_tx_user on premium_transactions (user_id, created_at desc);

drop trigger if exists trg_premium_tx_updated_at on premium_transactions;
create trigger trg_premium_tx_updated_at
    before update on premium_transactions
    for each row execute function premium_set_updated_at();

alter table premium_transactions enable row level security;

drop policy if exists "premium_tx_select_own" on premium_transactions;
create policy "premium_tx_select_own" on premium_transactions
    for select using (auth.uid() = user_id);

-- Insert/update (create deposit, update status hasil polling) hanya lewat
-- backend (service role) — deposit_id UNIQUE mencegah 1 deposit sukses yang
-- sama dipakai berkali-kali untuk klaim Premium.
