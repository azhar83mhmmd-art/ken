const POLL_INTERVAL_MS = 12000;
const STATS_POLL_INTERVAL_MS = 5000;
const FETCH_TIMEOUT_MS = 8000;

const STATUS_LABEL = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
    unavailable: 'Unavailable'
};

const OVERALL_ICON_CLASS = {
    operational: 'live',
    degraded: 'warn',
    down: 'offline',
    unavailable: 'warn'
};

const OVERALL_ICON_PATH = {
    operational: 'M20 6L9 17l-5-5',
    degraded: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
    down: 'M18 6L6 18M6 6l12 12',
    unavailable: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'
};

let lastHealth = null;
let lastStats = null;
let lastCheckedAt = null;      // Date terakhir health check (dari server)
let uptimeBase = null;         // { seconds, at } — dasar hitung uptime berjalan

/* ---------- util ---------- */

// fetch JSON tanpa cache + timeout, supaya data tidak "nyangkut" di cache
// browser/CDN dan request yang menggantung tidak menahan UI.
async function getJSON(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const sep = url.indexOf('?') === -1 ? '?' : '&';
        const res = await fetch(url + sep + '_=' + Date.now(), {
            cache: 'no-store',
            headers: { accept: 'application/json' },
            signal: ctrl.signal
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

function parseUptime(str) {
    const m = /(\d+)d\s+(\d+)h\s+(\d+)m\s+(\d+)s/.exec(str || '');
    if (!m) return null;
    return (+m[1]) * 86400 + (+m[2]) * 3600 + (+m[3]) * 60 + (+m[4]);
}

function formatUptime(total) {
    total = Math.max(0, Math.floor(total));
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
}

function agoText(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 5) return 'baru saja';
    if (s < 60) return s + ' detik lalu';
    return Math.floor(s / 60) + ' menit lalu';
}

function currentUptimeSeconds() {
    if (!uptimeBase) return null;
    return uptimeBase.seconds + (Date.now() - uptimeBase.at) / 1000;
}

function setLiveBadge(ok) {
    const badge = document.getElementById('live-badge');
    const text = document.getElementById('live-badge-text');
    badge.className = 'k-badge ' + (ok ? 'live' : 'offline');
    text.textContent = ok ? 'LIVE' : 'OFFLINE';
}

/* ---------- render ---------- */

function renderOverall(data) {
    const iconTile = document.getElementById('overall-icon');
    const title = document.getElementById('overall-title');
    const status = data.status;

    iconTile.className = 'k-component-icon-tile ' + (OVERALL_ICON_CLASS[status] || 'offline');
    iconTile.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="' +
        (OVERALL_ICON_PATH[status] || OVERALL_ICON_PATH.down) + '"/></svg>';
    title.textContent = 'System ' + (STATUS_LABEL[status] || 'Unknown');

    lastCheckedAt = new Date(data.checkedAt);
    renderCheckedAt();
}

function renderCheckedAt() {
    if (!lastCheckedAt) return;
    const sub = document.getElementById('overall-sub');
    sub.textContent = 'Terakhir diperiksa: ' + lastCheckedAt.toLocaleTimeString('id-ID') +
        ' · ' + agoText(Date.now() - lastCheckedAt.getTime());
}

function renderEndpointSystem(comp) {
    const badgeClass = comp.status === 'operational' ? 'live' : (comp.status === 'unavailable' ? 'warn' : 'offline');
    document.getElementById('endpoint-icon').className = 'k-component-icon-tile ' + badgeClass;
    document.getElementById('endpoint-value').className = 'k-component-value ' + badgeClass;
    document.getElementById('endpoint-value').textContent = STATUS_LABEL[comp.status] || comp.status;
    document.getElementById('endpoint-msg').textContent = comp.message || '';
}

function renderTerminal() {
    if (!lastHealth) return;
    const health = lastHealth;
    const lines = ['api          ' + health.components.api.status];
    lines.push('endpoints    ' + health.components.endpointSystem.status + ' (' + health.components.endpointSystem.totalEndpoints + ')');
    if (lastStats && lastStats.status) {
        const up = currentUptimeSeconds();
        lines.push('uptime       ' + (up === null ? lastStats.server.uptime : formatUptime(up)));
        lines.push('memory       ' + lastStats.server.memory.used + ' / ' + lastStats.server.memory.total + ' (' + lastStats.server.memory.percent + '%)');
    }
    lines.push('checked      ' + health.checkedAt);
    document.getElementById('terminal-log').textContent = lines.join('\n');
}

/* Jam berjalan: dipanggil tiap 1 detik, tidak bergantung pada polling. */
function tickClock() {
    const up = currentUptimeSeconds();
    if (up !== null) {
        document.getElementById('stat-uptime').textContent = formatUptime(up);
    }
    renderCheckedAt();
    renderTerminal();
}

function barClassFromPercent(pct) {
    if (pct > 90) return 'offline';
    if (pct > 70) return 'warn';
    return 'live';
}

/* ---------- loaders ---------- */

let healthBusy = false;
async function loadHealth() {
    if (healthBusy) return;
    healthBusy = true;
    try {
        const data = await getJSON('/api/status/health');
        setLiveBadge(true);
        renderOverall(data);
        renderEndpointSystem(data.components.endpointSystem);
        lastHealth = data;
        renderTerminal();
    } catch (e) {
        setLiveBadge(false);
        document.getElementById('overall-title').textContent = 'Unable to load data';
        document.getElementById('overall-sub').textContent = 'Tidak dapat memeriksa status server saat ini.';
        document.getElementById('overall-icon').className = 'k-component-icon-tile offline';
        lastCheckedAt = null;
    } finally {
        healthBusy = false;
    }
}

let statsBusy = false;
async function loadResources() {
    if (statsBusy) return;
    statsBusy = true;
    try {
        const data = await getJSON('/stats/data');
        if (!data.status) throw new Error('Data tidak valid');
        const s = data.server;

        // dasar uptime: pakai angka detik mentah dari server; kalau belum
        // ada (backend lama), parse dari teks "Xd Xh Xm Xs".
        const secs = typeof s.uptimeSeconds === 'number' ? s.uptimeSeconds : parseUptime(s.uptime);
        if (secs !== null) uptimeBase = { seconds: secs, at: Date.now() };
        document.getElementById('stat-uptime').textContent = secs !== null ? formatUptime(secs) : s.uptime;

        document.getElementById('stat-platform').textContent = s.hostname || s.platform;
        document.getElementById('stat-arch').textContent = s.arch;
        document.getElementById('stat-node').textContent = s.node_version;

        const cpuPercent = (parseFloat(s.cpu.load) * 10).toFixed(1);
        document.getElementById('stat-cpu-load').textContent = cpuPercent + '%';
        document.getElementById('stat-cpu-model').textContent = s.cpu.model + ' (' + s.cpu.cores + ' Cores)';

        document.getElementById('mem-used').textContent = s.memory.used;
        document.getElementById('mem-total').textContent = s.memory.total;
        document.getElementById('mem-free').textContent = s.memory.free;

        const memBar = document.getElementById('mem-bar');
        memBar.className = 'k-component-bar-fill ' + barClassFromPercent(s.memory.percent);
        memBar.style.width = s.memory.percent + '%';
        document.getElementById('mem-percent').textContent = s.memory.percent + '%';

        lastStats = data;
        renderTerminal();
    } catch (e) {
        uptimeBase = null;
        document.getElementById('stat-uptime').textContent = 'N/A';
        document.getElementById('stat-platform').textContent = 'N/A';
        document.getElementById('stat-cpu-load').textContent = 'N/A';
        document.getElementById('stat-cpu-model').textContent = 'Tidak dapat memuat data resource.';
    } finally {
        statsBusy = false;
    }
}

function refreshAll() {
    loadHealth();
    loadResources();
}

refreshAll();
setInterval(loadHealth, POLL_INTERVAL_MS);
setInterval(loadResources, STATS_POLL_INTERVAL_MS);
setInterval(tickClock, 1000);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { tickClock(); refreshAll(); }
});
window.addEventListener('pageshow', refreshAll);
window.addEventListener('online', refreshAll);
