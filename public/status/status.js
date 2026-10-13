const POLL_INTERVAL_MS = 12000;
const STATS_POLL_INTERVAL_MS = 5000;
let lastUpdatedAt = null;

const STATUS_LABEL = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
    unavailable: 'Unavailable'
};

function icon(d) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="' + d + '"/></svg>';
}

function setLiveBadge(ok) {
    const badge = document.getElementById('live-badge');
    const text = document.getElementById('live-badge-text');
    if (ok) {
        badge.className = 'k-badge live';
        text.textContent = 'LIVE';
    } else {
        badge.className = 'k-badge offline';
        text.textContent = 'OFFLINE';
    }
}

const OVERALL_ICON_CLASS = {
    operational: 'live',
    degraded: 'warn',
    down: 'offline',
    unavailable: 'warn'
};

function renderOverall(data) {
    const iconTile = document.getElementById('overall-icon');
    const title = document.getElementById('overall-title');
    const sub = document.getElementById('overall-sub');

    const status = data.status;
    iconTile.className = 'k-component-icon-tile ' + (OVERALL_ICON_CLASS[status] || 'offline');
    title.textContent = 'System ' + (STATUS_LABEL[status] || 'Unknown');
    sub.textContent = 'Terakhir diperiksa: ' + new Date(data.checkedAt).toLocaleTimeString('id-ID');
}

function renderEndpointSystem(comp) {
    const badgeClass = comp.status === 'operational' ? 'live' : (comp.status === 'unavailable' ? 'warn' : 'offline');

    document.getElementById('endpoint-icon').className = 'k-component-icon-tile ' + badgeClass;
    document.getElementById('endpoint-value').className = 'k-component-value ' + badgeClass;
    document.getElementById('endpoint-value').textContent = STATUS_LABEL[comp.status] || comp.status;
    document.getElementById('endpoint-msg').textContent = comp.message || '';
}

function renderTerminal(health, stats) {
    const lines = ['api          ' + health.components.api.status];
    lines.push('endpoints    ' + health.components.endpointSystem.status + ' (' + health.components.endpointSystem.totalEndpoints + ')');
    if (stats && stats.status) {
        lines.push('uptime       ' + stats.server.uptime);
        lines.push('memory       ' + stats.server.memory.used + ' / ' + stats.server.memory.total + ' (' + stats.server.memory.percent + '%)');
    }
    lines.push('checked      ' + health.checkedAt);
    document.getElementById('terminal-log').textContent = lines.join('\n');
}

let lastHealth = null;
let lastStats = null;

async function loadHealth() {
    try {
        const res = await fetch('/api/status/health', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();

        setLiveBadge(true);
        renderOverall(data);
        renderEndpointSystem(data.components.endpointSystem);
        lastHealth = data;
        renderTerminal(lastHealth, lastStats);
        lastUpdatedAt = Date.now();
    } catch (e) {
        setLiveBadge(false);
        document.getElementById('overall-title').textContent = 'Unable to load data';
        document.getElementById('overall-sub').textContent = 'Tidak dapat memeriksa status server saat ini.';
        document.getElementById('overall-icon').className = 'k-component-icon-tile offline';
    }
}

function barClassFromPercent(pct) {
    if (pct > 90) return 'offline';
    if (pct > 70) return 'warn';
    return 'live';
}

async function loadResources() {
    try {
        const res = await fetch('/stats/data', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!data.status) throw new Error('Data tidak valid');

        const s = data.server;

        document.getElementById('stat-uptime').textContent = s.uptime;
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
        const memClass = barClassFromPercent(s.memory.percent);
        memBar.className = 'k-component-bar-fill ' + memClass;
        memBar.style.width = s.memory.percent + '%';
        document.getElementById('mem-percent').textContent = s.memory.percent + '%';

        lastStats = data;
        if (lastHealth) renderTerminal(lastHealth, lastStats);
    } catch (e) {
        document.getElementById('stat-uptime').textContent = 'N/A';
        document.getElementById('stat-platform').textContent = 'N/A';
        document.getElementById('stat-cpu-load').textContent = 'N/A';
        document.getElementById('stat-cpu-model').textContent = 'Tidak dapat memuat data resource.';
    }
}

loadHealth();
loadResources();

setInterval(loadHealth, POLL_INTERVAL_MS);
setInterval(loadResources, STATS_POLL_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        loadHealth();
        loadResources();
    }
});
