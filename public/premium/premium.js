/*
 * Kairoo Premium — Developer Tools
 * Logic dashboard: switch login/dashboard, tab auth, semua panel
 * (Overview, API Key, Premium/upgrade, Usage, History, Support).
 */
import {
    getSupabaseClient, getSession, signInWithPassword, signUpWithPassword,
    signInWithGoogle, signOut, apiFetch, onAuthChange
} from '/premium-assets/premium-auth.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const viewLoading = $('#view-loading');
const viewDisabled = $('#view-disabled');
const viewLogin = $('#view-login');
const viewDashboard = $('#view-dashboard');

function showView(view) {
    [viewLoading, viewDisabled, viewLogin, viewDashboard].forEach((v) => v.classList.add('hidden'));
    view.classList.remove('hidden');
}

let historyPage = 1;
let currentDepositId = null;
let payPollTimer = null;

async function init() {
    try {
        await getSupabaseClient();
    } catch (err) {
        showView(viewDisabled);
        return;
    }

    onAuthChange((session) => {
        if (session) enterDashboard();
        else showView(viewLogin);
    });

    const session = await getSession();
    if (session) {
        enterDashboard();
    } else {
        showView(viewLogin);
    }
}

/* ---------------- Auth view ---------------- */

$$('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
        $$('.auth-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        $('#form-signin').classList.toggle('hidden', target !== 'signin');
        $('#form-signup').classList.toggle('hidden', target !== 'signup');
        $('#auth-error').classList.add('hidden');
    });
});

function showAuthError(message) {
    const el = $('#auth-error');
    el.textContent = message;
    el.classList.remove('hidden');
}

$('#form-signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
        await signInWithPassword(fd.get('email'), fd.get('password'));
    } catch (err) {
        showAuthError(err.message);
    }
});

$('#form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
        await signUpWithPassword(fd.get('email'), fd.get('password'));
        showAuthError('Akun dibuat! Cek email untuk verifikasi, lalu masuk.');
    } catch (err) {
        showAuthError(err.message);
    }
});

$('#btn-google').addEventListener('click', async () => {
    try {
        await signInWithGoogle();
    } catch (err) {
        showAuthError(err.message);
    }
});

$('#btn-logout').addEventListener('click', async () => {
    await signOut();
    showView(viewLogin);
});

/* ---------------- Dashboard shell ---------------- */

function enterDashboard() {
    showView(viewDashboard);
    loadOverview();
    loadApiKey();
    loadPremium();
}

$$('.dash-menu-item').forEach((btn) => {
    btn.addEventListener('click', () => {
        $$('.dash-menu-item').forEach((b) => b.classList.remove('active'));
        $$('.dash-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $('#' + btn.dataset.panel).classList.add('active');

        if (btn.dataset.panel === 'panel-history') loadHistory(1);
        if (btn.dataset.panel === 'panel-usage') loadOverview();
    });
});

/* ---------------- Overview / Analytics ---------------- */

function fmt(n) {
    return Number(n || 0).toLocaleString('id-ID');
}

async function loadOverview() {
    try {
        const data = await apiFetch('/api/premium/analytics');

        $('#stat-today').textContent = fmt(data.today.requests);
        $('#stat-success').textContent = fmt(data.today.success);
        $('#stat-failed').textContent = fmt(data.today.failed);
        $('#stat-usage').textContent = `${fmt(data.usage.used)} / ${fmt(data.usage.limit)}`;
        $('#usage-detail-text').textContent = `${fmt(data.usage.used)} / ${fmt(data.usage.limit)} requests hari ini`;

        const pct = Math.min(100, (data.usage.used / data.usage.limit) * 100);
        $('#usage-bar-fill').style.width = pct + '%';
        $('#usage-bar-fill-2').style.width = pct + '%';

        const list = $('#top-endpoints-list');
        list.innerHTML = '';
        data.top_endpoints.forEach((item) => {
            const li = document.createElement('li');
            li.innerHTML = `<code>${escapeHtml(item.endpoint)}</code><span class="count-badge">${fmt(item.count)}</span>`;
            list.appendChild(li);
        });

        drawUsageBar(data.today.success, data.today.failed);
    } catch (err) {
        // Diam-diam gagal (mis. belum ada API Key sama sekali) - panel tetap
        // menampilkan angka nol, tidak perlu alert mengganggu.
    }
}

function drawUsageBar(success, failed) {
    const canvas = $('#usage-chart');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const total = success + failed || 1;
    const barW = 80;
    const gap = 40;
    const maxH = h - 40;
    const scale = Math.max(success, failed, 1);

    const bars = [
        { label: 'Success', value: success, color: '#22C55E' },
        { label: 'Failed', value: failed, color: '#F87171' }
    ];

    bars.forEach((bar, i) => {
        const barH = Math.max(4, (bar.value / scale) * maxH);
        const x = w / 2 - barW - gap / 2 + i * (barW + gap);
        const y = h - 24 - barH;

        ctx.fillStyle = bar.color;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, 6);
        ctx.fill();

        ctx.fillStyle = '#0A0A0A';
        ctx.font = '700 12px "Space Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${bar.label} (${bar.value})`, x + barW / 2, h - 6);
    });
}

/* ---------------- API Key panel ---------------- */

async function loadApiKey() {
    try {
        const data = await apiFetch('/api/premium/keys');

        if (!data.has_key) {
            $('#apikey-empty').classList.remove('hidden');
            $('#apikey-exists').classList.add('hidden');
            return;
        }

        $('#apikey-empty').classList.add('hidden');
        $('#apikey-exists').classList.remove('hidden');
        $('#apikey-masked').textContent = data.key.masked_key;

        if (data.key.endpoint_name) {
            $('#apikey-endpoint-row').classList.remove('hidden');
            $('#apikey-endpoint').classList.remove('hidden');
            $('#apikey-endpoint').textContent = `${location.origin}/premium/${data.key.endpoint_name}`;
        }
    } catch (err) {
        // butuh API Key panel tetap kosong, tidak fatal
    }
}

function showRawKey(rawKey) {
    $('#apikey-raw-box').classList.remove('hidden');
    $('#apikey-raw').textContent = rawKey;
}

$('#btn-create-key').addEventListener('click', async () => {
    const name = $('#input-project-name').value.trim();
    try {
        const data = await apiFetch('/api/premium/keys', {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        showRawKey(data.raw_key);
        await loadApiKey();
    } catch (err) {
        alert(err.message);
    }
});

$('#btn-regenerate-key').addEventListener('click', async () => {
    if (!confirm('API Key lama akan langsung tidak valid. Lanjutkan?')) return;
    try {
        const data = await apiFetch('/api/premium/keys/regenerate', { method: 'POST' });
        showRawKey(data.raw_key);
        await loadApiKey();
    } catch (err) {
        alert(err.message);
    }
});

$('#btn-revoke-key').addEventListener('click', async () => {
    if (!confirm('Revoke API Key ini? Semua request memakai key ini akan ditolak.')) return;
    try {
        await apiFetch('/api/premium/keys/revoke', { method: 'POST' });
        await loadApiKey();
        $('#apikey-raw-box').classList.add('hidden');
    } catch (err) {
        alert(err.message);
    }
});

$('#btn-copy-key').addEventListener('click', () => {
    navigator.clipboard.writeText($('#apikey-masked').textContent);
});

/* ---------------- Premium panel ---------------- */

async function loadPremium() {
    try {
        const data = await apiFetch('/api/premium/me');
        const profile = data.profile;

        const now = Date.now();
        const expiresAt = profile?.premium_expires_at ? new Date(profile.premium_expires_at).getTime() : 0;
        const isActive = profile?.tier === 'premium' && profile?.premium_status === 'active' && expiresAt > now;

        $('#premium-card-free').classList.toggle('hidden', isActive);
        $('#premium-card-active').classList.toggle('hidden', !isActive);

        if (isActive) {
            $('#premium-expires').textContent = new Date(profile.premium_expires_at)
                .toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

            const keyData = await apiFetch('/api/premium/keys');
            $('#premium-endpoint-display').textContent = keyData?.key?.endpoint_name
                ? `/premium/${keyData.key.endpoint_name}`
                : '-';

            const analytics = await apiFetch('/api/premium/analytics');
            $('#premium-usage-display').textContent = `${fmt(analytics.usage.used)} / ${fmt(analytics.usage.limit)}`;
        }
    } catch (err) {
        // biarkan card Free tampil sebagai default
    }
}

$('#btn-upgrade').addEventListener('click', async () => {
    try {
        const data = await apiFetch('/api/premium/upgrade/create', { method: 'POST' });
        currentDepositId = data.deposit.id;

        $('#pay-box').classList.remove('hidden');
        $('#pay-qr').src = data.deposit.qr_image;
        $('#pay-amount').textContent = `Total bayar: Rp${fmt(data.deposit.total_payment)}`;
        $('#pay-status').textContent = 'Menunggu pembayaran...';

        pollPaymentStatus();
    } catch (err) {
        alert(err.message);
    }
});

function pollPaymentStatus() {
    clearTimeout(payPollTimer);

    const check = async () => {
        if (!currentDepositId) return;
        try {
            const data = await apiFetch(`/api/premium/upgrade/status/${currentDepositId}`);
            $('#pay-status').textContent = data.message;

            if (data.deposit_status === 'success') {
                $('#pay-box').classList.add('hidden');
                currentDepositId = null;
                await loadPremium();
                await loadOverview();
                return;
            }
            if (data.deposit_status === 'expired' || data.deposit_status === 'canceled') {
                $('#pay-box').classList.add('hidden');
                currentDepositId = null;
                return;
            }
        } catch (err) {
            $('#pay-status').textContent = err.message;
        }

        // Cooldown provider 30 detik antar cek status untuk deposit_id yang sama.
        payPollTimer = setTimeout(check, 30000);
    };

    check();
}

$('#btn-cancel-pay').addEventListener('click', async () => {
    if (!currentDepositId) return;
    try {
        await apiFetch(`/api/premium/upgrade/cancel/${currentDepositId}`, { method: 'POST' });
    } catch (err) {
        // biarpun gagal dibatalkan di server, tetap tutup UI-nya
    }
    clearTimeout(payPollTimer);
    currentDepositId = null;
    $('#pay-box').classList.add('hidden');
});

/* ---------------- History panel ---------------- */

function statusClass(code) {
    if (code >= 500) return 'status-5xx';
    if (code >= 400) return 'status-4xx';
    return 'status-2xx';
}

async function loadHistory(page) {
    historyPage = page;
    try {
        const data = await apiFetch(`/api/premium/history?page=${page}&page_size=20`);
        const tbody = $('#history-tbody');
        tbody.innerHTML = '';

        data.history.forEach((row) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="status-pill ${statusClass(row.status_code)}">${row.status_code}</span></td>
                <td><code>${escapeHtml(row.endpoint)}</code></td>
                <td>${escapeHtml(row.method)}</td>
                <td>${row.response_time != null ? row.response_time + 'ms' : '-'}</td>
                <td>${new Date(row.created_at).toLocaleString('id-ID')}</td>
            `;
            tbody.appendChild(tr);
        });

        const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));
        $('#history-page-label').textContent = `Halaman ${data.page} / ${totalPages}`;
        $('#btn-prev-page').disabled = data.page <= 1;
        $('#btn-next-page').disabled = data.page >= totalPages;
    } catch (err) {
        // history kosong kalau belum pernah request
    }
}

$('#btn-prev-page').addEventListener('click', () => loadHistory(Math.max(1, historyPage - 1)));
$('#btn-next-page').addEventListener('click', () => loadHistory(historyPage + 1));

/* ---------------- Utils ---------------- */

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

init();
