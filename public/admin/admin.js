/*
 * Kairoo Admin Dashboard
 *  - Login password -> token (sessionStorage, berlaku 12 jam)
 *  - Angka & grafik dari 1 endpoint: GET /api/admin/overview
 *  - Realtime langsung dari Supabase (postgres_changes) bila SUPABASE_JWT_SECRET
 *    & SUPABASE_ANON_KEY diset; kalau tidak, otomatis polling.
 */
(function () {
    'use strict';

    var TOKEN_KEY = 'kb_admin_token';
    var EXP_KEY = 'kb_admin_exp';
    var INT_KEY = 'kb_admin_interval';
    var SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';

    var $ = function (id) { return document.getElementById(id); };
    var st = {
        token: null, rt: null, client: null, channel: null,
        pollTimer: null, debounce: null, interval: 5000,
        filter: 'all', feed: [], seen: {}, firstRender: true,
        refreshing: false, mtLocal: false, tickTimer: null
    };

    /* ---------------- util ---------------- */
    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function fmt(n) { return Number(n || 0).toLocaleString('id-ID'); }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function clock(d) { d = d || new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
    function store(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} }
    function load(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

    var toastTimer = null;
    function toast(msg, bad) {
        var t = $('adm-toast');
        t.textContent = msg;
        t.className = 'adm-toast show' + (bad ? ' bad' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { t.className = 'adm-toast' + (bad ? ' bad' : ''); }, 2800);
    }

    function ago(ts) {
        var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (s < 5) return 'baru saja';
        if (s < 60) return s + 'd';
        if (s < 3600) return Math.floor(s / 60) + 'm';
        return Math.floor(s / 3600) + 'j';
    }

    function api(path, opt) {
        opt = opt || {};
        var headers = { 'Content-Type': 'application/json' };
        if (st.token) headers.Authorization = 'Bearer ' + st.token;
        return fetch(path, {
            method: opt.method || 'GET',
            headers: headers,
            body: opt.body ? JSON.stringify(opt.body) : undefined,
            cache: 'no-store'
        }).then(function (r) {
            return r.json().catch(function () { return {}; }).then(function (j) {
                j.__status = r.status;
                if (r.status === 401 && st.token) logout(true);
                return j;
            });
        });
    }

    /* ---------------- tampilan ---------------- */
    function showLogin() {
        $('adm-dash').hidden = true;
        $('adm-login').hidden = false;
        setTimeout(function () { var p = $('adm-pass'); if (p) p.focus(); }, 50);
    }
    function showDash() {
        $('adm-login').hidden = true;
        $('adm-dash').hidden = false;
        window.scrollTo(0, 0);
    }

    function setPill(mode, text) {
        var p = $('adm-rt-pill');
        p.className = 'adm-pill' + (mode === 'live' ? ' adm-pill-live' : mode === 'poll' ? ' adm-pill-poll' : mode === 'off' ? ' adm-pill-off' : '');
        $('adm-rt-text').textContent = text;
    }

    function banner(html, isErr) {
        var b = $('adm-banner');
        if (!html) { b.hidden = true; b.innerHTML = ''; return; }
        b.className = 'adm-banner' + (isErr ? ' err' : '');
        b.innerHTML = html;
        b.hidden = false;
    }

    /* ---------------- angka dengan animasi ---------------- */
    var cur = {};
    function setNum(id, val, f) {
        var el = $(id);
        if (!el) return;
        f = f || fmt;
        var to = Number(val) || 0;
        var from = cur[id] === undefined ? 0 : cur[id];
        if (cur[id] === to) return;
        cur[id] = to;
        var t0 = performance.now(), dur = 700;
        (function step(now) {
            var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
            el.textContent = f(from + (to - from) * e);
            if (k < 1) requestAnimationFrame(step); else el.textContent = f(to);
        })(t0);
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
    }
    function bumpNum(id, by) { setNum(id, (cur[id] || 0) + by); }
    function int(n) { return fmt(Math.round(n)); }

    /* ---------------- grafik ---------------- */
    function chart(el, svg, empty) {
        el.innerHTML = svg + (empty ? '<div class="adm-empty-chart">Belum ada data</div>' : '');
    }

    function drawRpm(series) {
        var W = 600, H = 170, base = 164, top = 14, n = series.length || 60;
        var max = 5, any = false;
        series.forEach(function (p) { if (p.c > max) max = p.c; if (p.c > 0) any = true; });
        var bw = W / n, out = '';
        series.forEach(function (p, i) {
            var h = p.c > 0 ? Math.max(3, (p.c / max) * (base - top)) : 2;
            var d = new Date(p.t);
            var last = i === n - 1;
            out += '<rect x="' + (i * bw + bw * .16).toFixed(1) + '" y="' + (base - h).toFixed(1) + '" width="' + (bw * .68).toFixed(1) + '" height="' + h.toFixed(1) +
                '" fill="' + (last ? '#FF6B9D' : p.c > 0 ? '#16A34A' : 'rgba(10,10,10,.15)') + '" stroke="#0A0A0A" stroke-width="' + (p.c > 0 ? 1.5 : 0) + '"><title>' +
                pad(d.getHours()) + ':' + pad(d.getMinutes()) + ' — ' + p.c + ' request</title></rect>';
        });
        out += '<text x="6" y="12" font-family="Space Mono,monospace" font-size="11" font-weight="700" fill="#5C5C5C">maks ' + max + '</text>';
        chart($('chart-rpm'), '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + out + '</svg>', !any);
    }

    function drawHourly(series) {
        var W = 600, H = 170, base = 164, top = 14, n = series.length || 24;
        var max = 5, any = false;
        series.forEach(function (p) { if (p.views > max) max = p.views; if (p.views > 0) any = true; });
        var bw = W / n, out = '';
        series.forEach(function (p, i) {
            var d = new Date(p.t);
            var hv = p.views > 0 ? Math.max(3, (p.views / max) * (base - top)) : 2;
            var hu = p.visitors > 0 ? Math.max(3, (p.visitors / max) * (base - top)) : 0;
            out += '<rect x="' + (i * bw + bw * .1).toFixed(1) + '" y="' + (base - hv).toFixed(1) + '" width="' + (bw * .8).toFixed(1) + '" height="' + hv.toFixed(1) +
                '" fill="' + (p.views > 0 ? '#60A5FA' : 'rgba(10,10,10,.15)') + '" stroke="#0A0A0A" stroke-width="' + (p.views > 0 ? 1.5 : 0) + '"><title>' +
                pad(d.getHours()) + ':00 — ' + p.views + ' views, ' + p.visitors + ' pengunjung</title></rect>';
            if (hu) {
                out += '<rect x="' + (i * bw + bw * .3).toFixed(1) + '" y="' + (base - hu).toFixed(1) + '" width="' + (bw * .4).toFixed(1) + '" height="' + hu.toFixed(1) +
                    '" fill="#FF6B9D" stroke="#0A0A0A" stroke-width="1.2"/>';
            }
        });
        out += '<text x="6" y="12" font-family="Space Mono,monospace" font-size="11" font-weight="700" fill="#5C5C5C">maks ' + max + '</text>';
        chart($('chart-hourly'), '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + out + '</svg>', !any);
    }

    /* ---------------- daftar ---------------- */
    function rank(el, rows, nameKey, valKey, subFn, color) {
        if (!rows || !rows.length) { el.innerHTML = '<li style="text-align:center;font-weight:700;color:var(--muted);border-style:dashed">Belum ada data</li>'; return; }
        var max = 1;
        rows.forEach(function (r) { if (Number(r[valKey]) > max) max = Number(r[valKey]); });
        el.innerHTML = rows.map(function (r) {
            var w = Math.max(6, (Number(r[valKey]) / max) * 100);
            var sub = subFn ? subFn(r) : '';
            return '<li style="--w:' + w.toFixed(0) + '%' + (color ? ';--bar:' + color : '') + '"><div class="r"><span class="n" title="' + esc(r[nameKey]) + '">' + esc(r[nameKey]) +
                '</span><span class="v">' + fmt(r[valKey]) + '</span></div>' + (sub ? '<small>' + sub + '</small>' : '') + '</li>';
        }).join('');
    }

    var DEV_COLORS = { mobile: '#F9A8D4', desktop: '#93C5FD', tablet: '#FDE047', unknown: '#E5E5E5' };
    var DEV_LABEL = { mobile: 'HP', desktop: 'Desktop', tablet: 'Tablet', unknown: 'Lainnya' };

    function drawDevices(rows) {
        var box = $('devices');
        var total = 0;
        (rows || []).forEach(function (r) { total += Number(r.visitors); });
        var legend = $('devices-legend');
        if (!legend) {
            legend = document.createElement('div');
            legend.id = 'devices-legend';
            legend.className = 'adm-split-legend';
            box.insertAdjacentElement('afterend', legend);
        }
        if (!total) { box.innerHTML = '<span style="flex:1;color:var(--muted)">Belum ada data</span>'; legend.innerHTML = ''; return; }
        box.innerHTML = rows.map(function (r) {
            var p = (Number(r.visitors) / total) * 100;
            var key = DEV_COLORS[r.device] ? r.device : 'unknown';
            return '<span style="flex:' + p.toFixed(1) + ' 1 0;background:' + DEV_COLORS[key] + '">' + (p >= 14 ? Math.round(p) + '%' : '') + '</span>';
        }).join('');
        legend.innerHTML = rows.map(function (r) {
            var key = DEV_COLORS[r.device] ? r.device : 'unknown';
            return '<span><i style="background:' + DEV_COLORS[key] + '"></i>' + DEV_LABEL[key] + ' ' + fmt(r.visitors) + '</span>';
        }).join('');
    }

    var regionNames = null;
    function countryName(cc) {
        try { regionNames = regionNames || new Intl.DisplayNames(['id'], { type: 'region' }); return regionNames.of(cc) || cc; } catch (e) { return cc; }
    }
    function flag(cc) {
        try { return String.fromCodePoint.apply(null, cc.toUpperCase().split('').map(function (c) { return 127397 + c.charCodeAt(0); })); } catch (e) { return ''; }
    }

    /* ---------------- feed ---------------- */
    var MAX_FEED = 60;
    var feedRaf = 0;
    var freshKeys = {};

    function addFeed(item, fresh) {
        if (st.seen[item.key]) return;
        st.seen[item.key] = 1;
        if (fresh) freshKeys[item.key] = 1;
        st.feed.push(item);
        st.feed.sort(function (a, b) { return b.ts - a.ts; });
        if (st.feed.length > MAX_FEED) {
            var drop = st.feed.splice(MAX_FEED);
            drop.forEach(function (d) { delete st.seen[d.key]; });
        }
        scheduleFeed();
    }

    function scheduleFeed() {
        if (feedRaf) return;
        feedRaf = requestAnimationFrame(function () { feedRaf = 0; renderFeed(); });
    }

    function renderFeed() {
        var f = st.filter;
        var rows = st.feed.filter(function (x) {
            if (f === 'req') return x.type === 'req';
            if (f === 'visit') return x.type === 'visit';
            if (f === 'err') return x.type === 'req' && x.status >= 400;
            return true;
        }).slice(0, 40);

        var ul = $('feed');
        if (!rows.length) { ul.innerHTML = '<li class="adm-empty">Menunggu aktivitas...</li>'; return; }

        ul.innerHTML = rows.map(function (x) {
            var isNew = freshKeys[x.key] ? ' new' : '';
            if (x.type === 'visit') {
                var where = [x.country ? flag(x.country) + ' ' + esc(x.country) : '', x.device ? esc(x.device) : '', x.browser ? esc(x.browser) : ''].filter(Boolean).join(' · ');
                return '<li class="' + isNew.trim() + '"><span class="k visit">VISIT</span><span class="t"><b>' + esc(x.path) + '</b><small>' + where +
                    (x.ref ? ' · dari ' + esc(x.ref) : '') + '</small></span><span class="w">' + ago(x.ts) + '</span></li>';
            }
            var m = String(x.method || 'GET').toUpperCase();
            var cls = m === 'GET' ? 'get' : m === 'POST' ? 'post' : 'other';
            return '<li class="' + isNew.trim() + '"><span class="k ' + cls + '">' + esc(m) + '</span><span class="t"><b>' + esc(x.endpoint) + '</b><small>' +
                (x.ms != null ? x.ms + ' ms' : '') + '</small></span><span class="s' + (x.status >= 400 ? ' bad' : '') + '">' + x.status + '</span><span class="w">' + ago(x.ts) + '</span></li>';
        }).join('');
        freshKeys = {};
    }

    function reqItem(r) {
        return { key: 'r' + r.id, type: 'req', ts: new Date(r.created_at).getTime(), method: r.method, endpoint: r.endpoint, status: Number(r.status_code), ms: r.response_time };
    }
    function visitItem(v) {
        return { key: 'v' + v.id, type: 'visit', ts: new Date(v.created_at).getTime(), path: v.path, device: v.device, browser: v.browser, country: v.country, ref: v.referrer };
    }

    /* ---------------- render dashboard ---------------- */
    function render(j) {
        $('adm-updated').textContent = 'Diperbarui ' + clock() + ' · hari = zona waktu WIB';
        renderServer(j.server);

        if (!j.supabase) {
            banner('<b>Supabase belum dikonfigurasi.</b> Isi <code>SUPABASE_URL</code> dan <code>SUPABASE_SERVICE_ROLE_KEY</code> di Environment Variables lalu redeploy supaya data pengunjung &amp; request tampil.', false);
            return;
        }
        banner('');

        var d = j.data || {};
        setNum('kpi-online', d.online_now);
        setNum('kpi-rpm', d.rpm_now);
        $('kpi-rpm-sub').textContent = 'rata-rata ' + String(d.rpm_avg_15m || 0).replace('.', ',') + ' (15 mnt)';
        setNum('kpi-visitors', d.visitors_today);
        $('kpi-visitors-sub').textContent = '7 hari: ' + fmt(d.visitors_7d);
        setNum('kpi-views', d.pageviews_today);
        setNum('kpi-req', d.requests_today);
        $('kpi-req-sub').textContent = 'puncak ' + fmt(d.rpm_peak_60m) + '/menit (1 jam)';
        setNum('kpi-err', d.error_rate_15m, function (v) { return v.toFixed(1).replace('.', ',') + '%'; });
        $('kpi-lat-sub').textContent = 'latency rata-rata ' + fmt(d.avg_response_15m) + ' ms';
        $('kpi-err-card').classList.toggle('bad', Number(d.error_rate_15m) >= 25);

        drawRpm(d.series_rpm || []);
        drawHourly(d.series_hourly || []);

        rank($('top-endpoints'), d.top_endpoints, 'endpoint', 'hits', function (r) {
            return fmt(r.errors) + ' error · ' + fmt(r.avg_ms) + ' ms rata-rata';
        });
        rank($('top-pages'), d.top_pages, 'path', 'views', function (r) { return fmt(r.visitors) + ' pengunjung'; }, '#BFDBFE');
        drawDevices(d.devices);
        rank($('countries'), (d.countries || []).map(function (c) {
            return { name: flag(c.country) + ' ' + countryName(c.country), visitors: c.visitors };
        }), 'name', 'visitors', null, '#FDE68A');

        // maintenance (jangan menimpa input yang sedang diedit)
        if (j.maintenance && !st.mtLocal) {
            setSwitch(j.maintenance.enabled);
            var mi = $('mt-msg');
            if (document.activeElement !== mi) mi.value = j.maintenance.message || '';
        }

        // feed: seed awal & tambahan dari polling
        var first = st.firstRender;
        (d.recent_requests || []).slice().reverse().forEach(function (r) { addFeed(reqItem(r), !first); });
        (d.recent_visits || []).slice().reverse().forEach(function (v) { addFeed(visitItem(v), !first); });
        st.firstRender = false;
    }

    function renderServer(s) {
        if (!s) return;
        var up = s.uptimeSec || 0;
        var upTxt = up >= 3600 ? Math.floor(up / 3600) + 'j ' + Math.floor((up % 3600) / 60) + 'm' : Math.floor(up / 60) + 'm ' + (up % 60) + 'd';
        $('server-info').innerHTML =
            '<div><small>Uptime proses</small><b>' + esc(upTxt) + '</b></div>' +
            '<div><small>Memori (RSS)</small><b>' + esc(s.rssMb) + ' MB</b></div>' +
            '<div><small>Platform</small><b>' + esc(s.platform) + (s.region ? ' · ' + esc(s.region) : '') + '</b></div>' +
            '<div><small>Node.js</small><b>' + esc(s.node) + '</b></div>';
    }

    /* ---------------- refresh & polling ---------------- */
    function refresh(manual) {
        if (st.refreshing || !st.token) return Promise.resolve();
        st.refreshing = true;
        var btn = $('adm-refresh');
        if (manual) btn.disabled = true;

        return api('/api/admin/overview').then(function (j) {
            if (j.__status === 401) return;
            if (!j.status) {
                banner('<b>' + esc(j.message || 'Gagal memuat data.') + '</b>' + (j.hint ? '<br>' + esc(j.hint) : ''), true);
                if (j.code === 'RPC_ERROR') banner('<b>Fungsi database belum ada.</b> Jalankan <code>supabase/admin_schema.sql</code> di Supabase SQL Editor lalu muat ulang. <br><small>' + esc(j.message || '') + '</small>', true);
                return;
            }
            render(j);
            if (manual) toast('Data diperbarui');
        }).catch(function () {
            setPill('off', 'Offline');
            banner('<b>Tidak bisa menghubungi server.</b> Mencoba lagi otomatis...', true);
        }).then(function () {
            st.refreshing = false;
            btn.disabled = false;
        });
    }

    function startPolling() {
        stopPolling();
        st.pollTimer = setInterval(function () { if (!document.hidden) refresh(); }, st.interval);
        st.tickTimer = setInterval(scheduleFeed, 15000);
    }
    function stopPolling() {
        clearInterval(st.pollTimer); clearInterval(st.tickTimer);
        st.pollTimer = st.tickTimer = null;
    }
    function scheduleRefresh() {
        clearTimeout(st.debounce);
        st.debounce = setTimeout(refresh, 1800);
    }

    /* ---------------- realtime Supabase ---------------- */
    function loadScript(src) {
        return new Promise(function (res, rej) {
            if (window.supabase && window.supabase.createClient) return res();
            var s = document.createElement('script');
            s.src = src; s.async = true; s.onload = res; s.onerror = rej;
            document.head.appendChild(s);
        });
    }

    function connectRealtime() {
        if (!st.rt) { setPill('poll', 'Polling'); return; }
        setPill('wait', 'Menghubungkan');

        loadScript(SUPABASE_CDN).then(function () {
            var c = window.supabase.createClient(st.rt.url, st.rt.anonKey, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
                realtime: { params: { eventsPerSecond: 10 } },
                global: { headers: { Authorization: 'Bearer ' + st.rt.jwt } }
            });
            c.realtime.setAuth(st.rt.jwt);

            var ch = c.channel('kairoo-admin')
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'api_requests' }, function (p) {
                    if (!p || !p.new) return;
                    addFeed(reqItem(p.new), true);
                    bumpNum('kpi-req', 1);
                    bumpNum('kpi-rpm', 1);
                    scheduleRefresh();
                })
                .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_visits' }, function (p) {
                    if (!p || !p.new) return;
                    addFeed(visitItem(p.new), true);
                    bumpNum('kpi-views', 1);
                    scheduleRefresh();
                })
                .subscribe(function (status) {
                    if (status === 'SUBSCRIBED') setPill('live', 'Realtime');
                    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setPill('poll', 'Polling');
                });

            st.client = c; st.channel = ch;
        }).catch(function () { setPill('poll', 'Polling'); });
    }

    function disconnectRealtime() {
        try { if (st.client && st.channel) st.client.removeChannel(st.channel); if (st.client) st.client.realtime.disconnect(); } catch (e) {}
        st.client = st.channel = null;
    }

    /* ---------------- kontrol ---------------- */
    function setSwitch(on) {
        $('mt-switch').setAttribute('aria-checked', on ? 'true' : 'false');
        $('mt-state').textContent = on ? 'AKTIF — endpoint API membalas 503.' : 'Nonaktif. API berjalan normal.';
    }

    function bindControls() {
        $('mt-switch').addEventListener('click', function () {
            var on = this.getAttribute('aria-checked') !== 'true';
            st.mtLocal = true;
            setSwitch(on);
        });

        $('mt-save').addEventListener('click', function () {
            var on = $('mt-switch').getAttribute('aria-checked') === 'true';
            if (on && !window.confirm('Aktifkan mode maintenance? Semua endpoint API akan membalas 503 sampai dimatikan.')) return;
            var btn = this; btn.disabled = true;
            api('/api/admin/maintenance', { method: 'POST', body: { enabled: on, message: $('mt-msg').value } }).then(function (j) {
                btn.disabled = false;
                if (j.status) { st.mtLocal = false; toast(on ? 'Maintenance DIAKTIFKAN' : 'Maintenance dimatikan'); }
                else toast(j.message || 'Gagal menyimpan', true);
            }).catch(function () { btn.disabled = false; toast('Gagal menghubungi server', true); });
        });

        $('purge-btn').addEventListener('click', function () {
            var days = $('purge-days').value;
            if (!window.confirm('Hapus semua log request & kunjungan yang lebih tua dari ' + days + ' hari? Tindakan ini tidak bisa dibatalkan.')) return;
            var btn = this; btn.disabled = true;
            api('/api/admin/purge', { method: 'POST', body: { days: Number(days) } }).then(function (j) {
                btn.disabled = false;
                if (j.status) {
                    var d = j.deleted || {};
                    toast('Dihapus: ' + fmt(d.api_requests) + ' request, ' + fmt(d.site_visits) + ' kunjungan');
                    refresh();
                } else toast(j.message || 'Gagal menghapus', true);
            }).catch(function () { btn.disabled = false; toast('Gagal menghubungi server', true); });
        });

        $('adm-interval').addEventListener('change', function () {
            st.interval = Number(this.value) || 5000;
            try { localStorage.setItem(INT_KEY, String(st.interval)); } catch (e) {}
            startPolling();
            toast('Interval: ' + (st.interval / 1000) + ' detik');
        });

        $('adm-refresh').addEventListener('click', function () { refresh(true); });
        $('adm-logout').addEventListener('click', function () { logout(false); });

        $('feed-filters').addEventListener('click', function (e) {
            var b = e.target.closest('.adm-f');
            if (!b) return;
            st.filter = b.getAttribute('data-f');
            Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('active', x === b); });
            renderFeed();
        });

        document.addEventListener('visibilitychange', function () { if (!document.hidden && st.token) refresh(); });
    }

    /* ---------------- sesi ---------------- */
    function begin(token, realtime) {
        st.token = token;
        st.rt = realtime || null;
        st.firstRender = true; st.feed = []; st.seen = {}; cur = {};
        showDash();
        try { var v = Number(localStorage.getItem(INT_KEY)); if (v) { st.interval = v; $('adm-interval').value = String(v); } } catch (e) {}
        refresh().then(function () { startPolling(); connectRealtime(); });
    }

    function logout(expired) {
        stopPolling();
        clearTimeout(st.debounce);
        disconnectRealtime();
        store(TOKEN_KEY, null); store(EXP_KEY, null);
        st.token = null; st.rt = null;
        showLogin();
        var m = $('adm-login-msg');
        if (expired) { m.textContent = 'Sesi berakhir. Silakan login lagi.'; m.hidden = false; } else { m.hidden = true; }
    }

    /* ---------------- login ---------------- */
    function initLogin() {
        var form = $('adm-login-form'), pass = $('adm-pass'), msg = $('adm-login-msg'), btn = $('adm-login-btn'), txt = $('adm-login-btn-text');

        $('adm-eye').addEventListener('click', function () {
            var show = pass.type === 'password';
            pass.type = show ? 'text' : 'password';
            this.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
            pass.focus();
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            var v = pass.value;
            if (!v) { fail('Masukkan password terlebih dahulu.'); return; }
            btn.disabled = true; txt.textContent = 'Memeriksa...'; msg.hidden = true;

            api('/api/admin/login', { method: 'POST', body: { password: v } }).then(function (j) {
                btn.disabled = false; txt.textContent = 'Masuk';
                if (j.status && j.token) {
                    pass.value = '';
                    store(TOKEN_KEY, j.token); store(EXP_KEY, String(j.expiresAt || ''));
                    begin(j.token, j.realtime);
                } else {
                    fail(j.message || 'Login gagal.');
                }
            }).catch(function () {
                btn.disabled = false; txt.textContent = 'Masuk';
                fail('Tidak bisa menghubungi server.');
            });
        });

        function fail(m) {
            msg.textContent = m; msg.hidden = false;
            form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
            pass.select();
        }

        api('/api/admin/status').then(function (j) {
            var hint = $('adm-setup-hint');
            if (!j || j.__status !== 200) return;
            if (!j.configured) {
                hint.innerHTML = 'Admin belum aktif. Tambahkan <b>ADMIN_PASSWORD</b> di Environment Variables Vercel, lalu redeploy.';
                hint.hidden = false;
            } else if (!j.supabase) {
                hint.innerHTML = 'Supabase belum dikonfigurasi, jadi data pengunjung &amp; request belum bisa ditampilkan.';
                hint.hidden = false;
            }
        }).catch(function () {});
    }

    /* ---------------- init ---------------- */
    function init() {
        initLogin();
        bindControls();

        var token = load(TOKEN_KEY), exp = Number(load(EXP_KEY) || 0);
        if (token && (!exp || exp > Date.now())) {
            st.token = token;
            api('/api/admin/session').then(function (j) {
                if (j && j.status) begin(token, j.realtime); else showLogin();
            }).catch(showLogin);
        } else {
            showLogin();
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
