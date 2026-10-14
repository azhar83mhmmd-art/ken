-- Kairoo API | Supabase schema untuk ADMIN DASHBOARD (/admin)
-- Jalankan di Supabase SQL Editor SETELAH supabase/schema.sql.
-- Aman dijalankan berulang kali (idempotent).
--
-- Yang dibuat:
--   site_visits    : 1 baris per page view (tanpa IP; hanya id acak browser)
--   site_presence  : 1 baris per pengunjung aktif (untuk "online sekarang")
--   admin_settings : pengaturan admin (mode maintenance)
--   RPC            : track_site_visit, kairoo_admin_overview, kairoo_admin_purge
--   RLS + Realtime : hanya token admin yang boleh MEMBACA tabel log

create extension if not exists pgcrypto;

-- =========================================================
-- 1. Tabel
-- =========================================================
create table if not exists site_visits (
    id bigint generated always as identity primary key,
    visitor_id text not null,
    path text not null,
    referrer text,
    device text,
    browser text,
    country text,
    created_at timestamptz not null default now()
);

create index if not exists idx_site_visits_created_at on site_visits (created_at desc);
create index if not exists idx_site_visits_visitor on site_visits (visitor_id, created_at desc);

create table if not exists site_presence (
    visitor_id text primary key,
    path text,
    device text,
    country text,
    first_seen timestamptz not null default now(),
    last_seen timestamptz not null default now()
);

create index if not exists idx_site_presence_last_seen on site_presence (last_seen desc);

create table if not exists admin_settings (
    key text primary key,
    value jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

insert into admin_settings (key, value)
values ('maintenance', '{"enabled": false, "message": "Sedang maintenance, coba lagi beberapa saat lagi."}'::jsonb)
on conflict (key) do nothing;

-- =========================================================
-- 2. track_site_visit — dipanggil backend dari beacon browser
-- =========================================================
create or replace function track_site_visit(
    p_vid text,
    p_path text,
    p_ref text,
    p_device text,
    p_browser text,
    p_country text,
    p_pageview boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into site_presence (visitor_id, path, device, country, first_seen, last_seen)
    values (p_vid, p_path, p_device, p_country, now(), now())
    on conflict (visitor_id) do update set
        path = excluded.path,
        device = excluded.device,
        country = coalesce(excluded.country, site_presence.country),
        last_seen = now();

    if p_pageview then
        insert into site_visits (visitor_id, path, referrer, device, browser, country)
        values (p_vid, p_path, p_ref, p_device, p_browser, p_country);
    end if;
end;
$$;

-- =========================================================
-- 3. kairoo_admin_overview — SEMUA angka dashboard dalam 1 panggilan
--    (hari = zona waktu Asia/Jakarta)
-- =========================================================
create or replace function kairoo_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_day_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Jakarta')) at time zone 'Asia/Jakarta';
    v_result jsonb;
begin
    select jsonb_build_object(
        'online_now',
            (select count(*) from site_presence where last_seen > now() - interval '75 seconds'),
        'visitors_today',
            (select count(distinct visitor_id) from site_visits where created_at >= v_day_start),
        'pageviews_today',
            (select count(*) from site_visits where created_at >= v_day_start),
        'visitors_7d',
            (select count(distinct visitor_id) from site_visits where created_at >= now() - interval '7 days'),
        'requests_today',
            (select count(*) from api_requests where created_at >= v_day_start),
        'rpm_now',
            (select count(*) from api_requests where created_at > now() - interval '60 seconds'),
        'rpm_avg_15m',
            (select round(count(*) / 15.0, 2) from api_requests where created_at > now() - interval '15 minutes'),
        'rpm_peak_60m',
            (select coalesce(max(c), 0) from (
                select count(*) as c from api_requests
                where created_at > now() - interval '60 minutes'
                group by date_trunc('minute', created_at)
            ) t),
        'error_rate_15m',
            (select case when count(*) = 0 then 0
                    else round(100.0 * count(*) filter (where status_code >= 400) / count(*), 2) end
             from api_requests where created_at > now() - interval '15 minutes'),
        'avg_response_15m',
            (select coalesce(round(avg(response_time)), 0) from api_requests where created_at > now() - interval '15 minutes'),

        'series_rpm',
            (select coalesce(jsonb_agg(jsonb_build_object('t', m, 'c', c) order by m), '[]'::jsonb) from (
                select gs as m,
                       (select count(*) from api_requests r
                         where r.created_at >= gs and r.created_at < gs + interval '1 minute') as c
                from generate_series(
                        date_trunc('minute', now()) - interval '59 minutes',
                        date_trunc('minute', now()),
                        interval '1 minute') gs
            ) s),

        'series_hourly',
            (select coalesce(jsonb_agg(jsonb_build_object('t', h, 'views', v, 'visitors', u) order by h), '[]'::jsonb) from (
                select gs as h,
                       (select count(*) from site_visits x
                         where x.created_at >= gs and x.created_at < gs + interval '1 hour') as v,
                       (select count(distinct x.visitor_id) from site_visits x
                         where x.created_at >= gs and x.created_at < gs + interval '1 hour') as u
                from generate_series(
                        date_trunc('hour', now()) - interval '23 hours',
                        date_trunc('hour', now()),
                        interval '1 hour') gs
            ) s),

        'top_endpoints',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select endpoint,
                       count(*) as hits,
                       count(*) filter (where status_code >= 400) as errors,
                       round(avg(response_time)) as avg_ms
                from api_requests
                where created_at > now() - interval '24 hours'
                group by endpoint order by hits desc limit 8
            ) t),

        'top_pages',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select path, count(*) as views, count(distinct visitor_id) as visitors
                from site_visits
                where created_at > now() - interval '24 hours'
                group by path order by views desc limit 8
            ) t),

        'devices',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select coalesce(device, 'unknown') as device, count(distinct visitor_id) as visitors
                from site_visits
                where created_at > now() - interval '24 hours'
                group by 1 order by visitors desc
            ) t),

        'countries',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select country, count(distinct visitor_id) as visitors
                from site_visits
                where created_at > now() - interval '24 hours' and country is not null
                group by country order by visitors desc limit 6
            ) t),

        'recent_requests',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select id, endpoint, method, status_code, response_time, created_at
                from api_requests order by id desc limit 15
            ) t),

        'recent_visits',
            (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
                select id, path, device, browser, country, referrer, created_at
                from site_visits order by id desc limit 15
            ) t)
    ) into v_result;

    return v_result;
end;
$$;

-- =========================================================
-- 4. kairoo_admin_purge — hapus log lebih tua dari N hari
-- =========================================================
create or replace function kairoo_admin_purge(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    a bigint;
    b bigint;
    c bigint;
begin
    if p_days is null or p_days < 1 then p_days := 1; end if;

    delete from api_requests where created_at < now() - make_interval(days => p_days);
    get diagnostics a = row_count;

    delete from site_visits where created_at < now() - make_interval(days => p_days);
    get diagnostics b = row_count;

    delete from site_presence where last_seen < now() - interval '2 days';
    get diagnostics c = row_count;

    return jsonb_build_object('api_requests', a, 'site_visits', b, 'site_presence', c);
end;
$$;

-- =========================================================
-- 5. KEAMANAN — fungsi hanya boleh dipanggil backend (service role)
--    Tanpa ini, siapa pun dengan anon key bisa memanggil RPC lewat REST.
-- =========================================================
revoke all on function track_site_visit(text, text, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function kairoo_admin_overview() from public, anon, authenticated;
revoke all on function kairoo_admin_purge(integer) from public, anon, authenticated;

grant execute on function track_site_visit(text, text, text, text, text, text, boolean) to service_role;
grant execute on function kairoo_admin_overview() to service_role;
grant execute on function kairoo_admin_purge(integer) to service_role;

-- =========================================================
-- 6. RLS — tabel tertutup untuk publik. Backend memakai service role
--    (otomatis bypass). Realtime dashboard memakai JWT admin dengan
--    klaim app_role = 'kairoo_admin' (dibuat server dari SUPABASE_JWT_SECRET).
-- =========================================================
alter table site_visits enable row level security;
alter table site_presence enable row level security;
alter table admin_settings enable row level security;
alter table api_requests enable row level security;

drop policy if exists "kairoo admin read" on site_visits;
create policy "kairoo admin read" on site_visits
    for select to authenticated
    using ((auth.jwt() ->> 'app_role') = 'kairoo_admin');

drop policy if exists "kairoo admin read" on site_presence;
create policy "kairoo admin read" on site_presence
    for select to authenticated
    using ((auth.jwt() ->> 'app_role') = 'kairoo_admin');

drop policy if exists "kairoo admin read" on api_requests;
create policy "kairoo admin read" on api_requests
    for select to authenticated
    using ((auth.jwt() ->> 'app_role') = 'kairoo_admin');

-- admin_settings: tanpa policy = hanya service role (backend) yang bisa akses.

-- =========================================================
-- 7. Realtime — aktifkan siaran perubahan untuk tabel log
-- =========================================================
do $$
begin
    begin
        alter publication supabase_realtime add table api_requests;
    exception when duplicate_object then null;
    end;

    begin
        alter publication supabase_realtime add table site_visits;
    exception when duplicate_object then null;
    end;
end
$$;
