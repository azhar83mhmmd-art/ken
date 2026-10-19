// AM Premify - Premium Panel (frontend)
const CONFIG = {
  waNumber: '6282357961890' // 082357961890 dalam format internasional
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

/* Toast */
let toastTimer;
function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
}

/* Navigasi (URL bersih tanpa .html: /index, /premium, /panduan) */
const ROUTES = { home: '/index', premium: '/premium', guide: '/panduan', reviews: '/rating', room: '/room', bio: '/biodata' };
const TITLES = { home: 'Dashboard', premium: 'Premiumkan Akun', guide: 'Panduan', reviews: 'Rating & Ulasan', room: 'Room Publik', bio: 'Biodata Developer' };
const VIEW_BY_PATH = { '/': 'home', '/index': 'home', '/premium': 'premium', '/panduan': 'guide', '/rating': 'reviews', '/ulasan': 'reviews', '/bukti': 'reviews', '/room': 'room', '/biodata': 'bio' };

function show(view, push = true) {
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== view));
  $$('.tab, .dock-i[data-tab]').forEach((t) => t.classList.toggle('active', t.dataset.tab === view));
  document.body.classList.toggle('bio-mode', view === 'bio');
  document.title = `AM Premify - ${TITLES[view]}`;
  if (push && location.pathname !== ROUTES[view]) history.pushState({ view }, '', ROUTES[view]);
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (view === 'home') renderHome();
  window.dispatchEvent(new CustomEvent('am:view', { detail: { view } }));
}
$$('.tab, .dock-i[data-tab]').forEach((t) => t.addEventListener('click', (e) => {
  if (!t.dataset.tab) return; // tab halaman lain (mis. /bypass): navigasi biasa
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // buka di tab baru tetap normal
  e.preventDefault();
  if (navigator.vibrate && t.classList.contains('dock-i')) navigator.vibrate(8);
  show(t.dataset.tab);
}));
$$('[data-goto]').forEach((b) => b.addEventListener('click', () => show(b.dataset.goto)));
window.addEventListener('popstate', () => show(VIEW_BY_PATH[location.pathname] || 'home', false));

/* Menu (bottom sheet) + Biodata Developer */
const menu = {
  el: $('#sheet'),
  open() { this.el.classList.remove('hidden'); requestAnimationFrame(() => this.el.classList.add('open')); document.body.classList.add('no-scroll'); $('#menu-open').setAttribute('aria-expanded', 'true'); },
  close() {
    if (this.el.classList.contains('hidden')) return;
    this.el.classList.remove('open');
    document.body.classList.remove('no-scroll');
    $('#menu-open').setAttribute('aria-expanded', 'false');
    setTimeout(() => this.el.classList.add('hidden'), 220);
  }
};
$('#menu-open').addEventListener('click', () => menu.open());
$('#dock-menu').addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(8); menu.open(); });
$$('[data-close]', menu.el).forEach((el) => el.addEventListener('click', () => menu.close()));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.close(); });
$$('[data-goto-link]').forEach((a) => a.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  menu.close();
  show(a.dataset.gotoLink);
}));
$('#bio-back').addEventListener('click', () => show('home'));

/* WhatsApp: pesan otomatis (menyertakan email jika sudah diisi) */
function waLink() {
  const email = ($('#email') && $('#email').value.trim()) || '';
  const name = (typeof userName === 'function' && userName()) || '';
  const lines = [
    name ? `Halo kak, saya ${name}, butuh bantuan terkait AM Premify.` : 'Halo kak, saya butuh bantuan terkait AM Premify.',
    '',
    email ? `Email akun: ${email}` : 'Email akun: -',
    'Kendala: '
  ];
  return `https://wa.me/${CONFIG.waNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
}
$$('.js-wa').forEach((a) => {
  a.href = waLink();
  ['pointerdown', 'focus', 'click'].forEach((ev) => a.addEventListener(ev, () => (a.href = waLink())));
});

/* Stepper: 1 email, 2 link, 3 VIP, 4 selesai */
function setStep(n) {
  $$('.stp').forEach((el) => {
    const i = Number(el.dataset.step);
    el.classList.toggle('done', i < n);
    el.classList.toggle('active', i === n);
  });
}

/* Dashboard */
function renderHome() {
  if (typeof renderMini === 'function') renderMini();
  const list = store.get('am_accounts', []);
  const box = $('#recent');
  if (!list.length) { box.innerHTML = '<div class="empty">Belum ada akun premium.</div>'; return; }
  box.innerHTML = list.slice(0, 5).map((u, i) => `
    <div class="item">
      <div class="meta"><b>${esc(u.email)}</b><span>${new Date(u.at).toLocaleString('id-ID')}</span></div>
      <span class="badge">VIP</span>
      <button class="mini" data-del="${i}" aria-label="Hapus"><svg class="ic"><use href="#i-trash"/></svg></button>
    </div>`).join('');
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', () => {
    const l = store.get('am_accounts', []);
    l.splice(Number(b.dataset.del), 1);
    store.set('am_accounts', l);
    renderHome();
  }));
}

$('#clear-all').addEventListener('click', async () => {
  const n = store.get('am_accounts', []).length;
  if (!n) return toast('Belum ada data');
  const ok = await UI.confirm({
    tone: 'danger', icon: 'trash',
    title: 'Hapus semua riwayat?',
    message: `${n} akun premium di daftar riwayat perangkat ini akan dihapus dari tampilan.`,
    items: ['Daftar akun di Dashboard (hanya di perangkat ini)'],
    itemsTitle: 'Yang ikut terhapus',
    note: 'Akun yang sudah aktif VIP tidak terpengaruh. Tindakan ini tidak dapat dibatalkan.',
    confirmText: 'Ya, hapus semua', cancelText: 'Batal'
  });
  if (!ok) return;
  store.set('am_accounts', []);
  renderHome();
  toast('Riwayat dihapus');
});

/* Terminal */
const term = {
  box: $('#term'),
  body: $('#term-body'),
  cursor: null,
  init() {
    this.cursor = document.createElement('div');
    this.cursor.className = 'cursor-ln';
    this.body.appendChild(this.cursor);
  },
  time() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `[${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}]`;
  },
  // type: sys | ready | info | ok | tip | warn | err | raw
  log(type, text, opts = {}) {
    const ln = document.createElement('div');
    ln.className = 'ln ' + type;
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = opts.label || this.time();
    const msg = document.createElement('span');
    msg.className = 'msg';
    const icon = { ok: 'i-ok', tip: 'i-info', err: 'i-fail', warn: 'i-info' }[type];
    if (icon) msg.innerHTML = `<svg class="ic"><use href="#${icon}"/></svg>`;
    msg.appendChild(document.createTextNode(text));
    ln.append(ts, msg);
    this.body.insertBefore(ln, this.cursor);
    this.body.scrollTop = this.body.scrollHeight;
  },
  welcome() {
    this.log('sys', 'Sistem Verifikasi Alight Motion (AM Premify core) siap digunakan.', { label: '[SYSTEM]' });
    this.log('ready', 'Silakan masukkan alamat email akun Alight Motion lalu klik "Kirim Magic Link".', { label: '[READY]' });
  },
  clear() {
    $$('.ln', this.body).forEach((l) => l.remove());
    this.welcome();
    this.log('info', 'Riwayat verifikasi dibersihkan.');
  },
  text() { return $$('.ln', this.body).map((l) => l.textContent.replace(/\s+/g, ' ').trim()).join('\n'); }
};
term.init();
term.welcome();

$('#term-clear').addEventListener('click', () => { term.clear(); setStep(1); });
$('#term-toggle').addEventListener('click', () => term.box.classList.toggle('collapsed'));
$('#term-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(term.text()); toast('Log disalin'); }
  catch { toast('Gagal menyalin', 'err'); }
});

/* Premiumkan Akun */
async function postJson(url, payload) {
  // Nama pengguna ikut dikirim supaya aktivasi sukses tercatat atas namanya; perangkat dikenali lewat Device
  const res = await Device.api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ name: userName() }, payload))
  });
  let data;
  try { data = await res.json(); } catch { data = { success: false, error: 'Respon tidak valid dari server' }; }
  if (res.status === 403 && data && data.blocked) Device.setBlocked(true, '');
  const ok = res.ok && data.success !== false && !data.error;
  return { ok, data, status: res.status };
}

function errText(r) {
  const d = r.data || {};
  const m = d.error || d.message || (d.data && d.data.message) || 'Status ' + r.status;
  return typeof m === 'string' ? m : JSON.stringify(m);
}

function logRaw(data) {
  let t = '';
  try { t = JSON.stringify(data); } catch {}
  if (t.length > 280) t = t.slice(0, 280) + '...';
  if (t) term.log('raw', 'Respon server: ' + t);
}

function setBtn(btn, busy, text) {
  btn.disabled = busy;
  $('span', btn).textContent = text;
}

/* Cloudflare Turnstile: tombol VIP terkunci sampai verifikasi manusia selesai */
const cf = {
  token: '', id: null,
  card: $('#cf-card'), state: $('#cf-state'), btn: $('#verify-btn'),
  set(st, label) { this.card.classList.remove('ok', 'err'); if (st) this.card.classList.add(st); this.state.textContent = label; },
  lock() { this.token = ''; this.btn.disabled = true; },
  ready(token) { this.token = token; this.btn.disabled = !!(window.Device && Device.state.blocked); this.set('ok', 'TERVERIFIKASI'); term.log('ok', 'Verifikasi manusia (Cloudflare) berhasil.'); },
  reset() { this.lock(); this.set('', 'BELUM'); try { if (window.turnstile && this.id !== null) window.turnstile.reset(this.id); } catch {} },
  mount() {
    const key = (window.APP_CONFIG && window.APP_CONFIG.turnstileSiteKey) || '';
    if (!key) { this.set('err', 'ERROR'); $('#cf-loading').textContent = 'Site key Turnstile belum diisi'; return; }
    if (!window.turnstile) { return setTimeout(() => this.mount(), 250); }
    $('#cf-box').innerHTML = '';
    this.id = window.turnstile.render('#cf-box', {
      sitekey: key, theme: 'light', language: 'id',
      callback: (t) => this.ready(t),
      'expired-callback': () => { this.lock(); this.set('', 'KEDALUWARSA'); },
      'timeout-callback': () => { this.lock(); this.set('', 'KEDALUWARSA'); },
      'error-callback': () => { this.lock(); this.set('err', 'GAGAL'); term.log('err', 'Verifikasi Cloudflare gagal dimuat, muat ulang halaman.'); }
    });
  }
};
cf.mount();

$('#email').addEventListener('input', () => setStep(1));

$('#send-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const btn = $('#send-btn');
  setBtn(btn, true, 'Mengirim...');
  term.log('info', `[*] Menghubungi server verifikasi untuk ${email}...`);
  try {
    const r = await postJson('/api/send-link', { email });
    logRaw(r.data);
    if (r.ok) {
      term.log('ok', `Link verifikasi berhasil dikirim ke: ${email}`);
      term.log('tip', 'Buka email masuk lalu tempelkan link verifikasi di Langkah 2');
      setStep(2);
      toast('Magic link terkirim, cek email target');
    } else {
      term.log('err', 'Gagal mengirim link: ' + errText(r));
      toast('Gagal mengirim magic link', 'err');
    }
  } catch (err) {
    term.log('err', 'Gagal terhubung ke server: ' + err.message);
    toast('Gagal terhubung ke server', 'err');
  } finally { setBtn(btn, false, 'Kirim Magic Link'); }
});

$('#verify-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  const magicLink = $('#magic').value.trim();
  if (!email) {
    term.log('warn', 'Email target belum diisi. Isi email di Langkah 1 terlebih dahulu.');
    return toast('Isi email target dulu di langkah 1', 'err');
  }
  if (!cf.token) {
    term.log('warn', 'Selesaikan verifikasi manusia (Cloudflare) terlebih dahulu.');
    return toast('Selesaikan verifikasi manusia dulu', 'err');
  }
  const btn = $('#verify-btn');
  setBtn(btn, true, 'Memverifikasi...');
  setStep(3);
  term.log('info', `[*] Memverifikasi link untuk ${email}...`);
  try {
    const r = await postJson('/api/verify-link', { email, magicLink, cfToken: cf.token });
    logRaw(r.data);
    if (r.ok) {
      const list = store.get('am_accounts', []);
      list.unshift({ email, at: Date.now() });
      store.set('am_accounts', list);
      $('#magic').value = '';
      term.log('ok', `Akun berhasil diaktifkan VIP: ${email}`);
      if (r.data && r.data.recorded === true) term.log('info', 'Aktivitas tercatat ke Supabase (statistik real-time diperbarui).');
      else if (r.data && r.data.recorded === false) term.log('warn', 'Aktivitas belum tercatat ke Supabase. Cek isi .env dan jalankan supabase.sql.');
      setStep(4);
      FX.confetti();
      renderMini();
      window.dispatchEvent(new CustomEvent('am:activated', { detail: { email } }));
      toast(`Mantap ${userName() || ''}! Akun berhasil jadi VIP`.replace(' !', '!'));
    } else {
      term.log('err', 'Verifikasi gagal: ' + errText(r));
      setStep(2);
      toast('Verifikasi gagal, cek log', 'err');
    }
  } catch (err) {
    term.log('err', 'Gagal terhubung ke server: ' + err.message);
    setStep(2);
    toast('Gagal terhubung ke server', 'err');
  } finally { setBtn(btn, false, 'Verifikasi & Aktifkan VIP'); cf.reset(); }
});


/* Peringatan keras: sisipkan ke semua slot + modal sekali tampil */
$$('[data-warn]').forEach((slot) => slot.appendChild($('#warn-tpl').content.cloneNode(true)));
function showWarnIfNeeded() {
  if (!store.get('am_warn_ok', false)) $('#warn-modal').classList.remove('hidden');
}
$('#warn-ok').addEventListener('click', () => {
  store.set('am_warn_ok', Date.now());
  $('#warn-modal').classList.add('hidden');
  if (typeof FX !== 'undefined') FX.burstAt(innerWidth / 2, innerHeight / 2, 40);
  channelPop.request(500);
});

/* Statistik real-time (Supabase) */
const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
const clock = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
};

function animateNum(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 600;
  (function step(now) {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  })(t0);
  if (to > from) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
}

const live = {
  client: null,
  setBadge(kind, text) {
    const b = $('#live-badge');
    b.className = 'live-badge ' + kind;
    $('b', b).textContent = text;
  },
  hint(msg) {
    const h = $('#live-hint');
    h.textContent = msg || '';
    h.classList.toggle('hidden', !msg);
  },
  renderBars(daily) {
    const box = $('#bars');
    if (!Array.isArray(daily) || !daily.length) return;
    const max = Math.max(1, ...daily.map((d) => Number(d.count)));
    const todayKey = daily[daily.length - 1].day;
    box.innerHTML = daily.map((d) => {
      const c = Number(d.count);
      const label = new Date(d.day + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'short' });
      return `<div class="bar${d.day === todayKey ? ' today' : ''}">
        <b>${fmt(c)}</b>
        <div class="bar-track"><div class="bar-fill" style="height:${c ? Math.max(6, (c / max) * 100) : 0}%"></div></div>
        <span>${esc(label)}</span>
      </div>`;
    }).join('');
  },
  async refresh() {
    const { data, error } = await this.client.rpc('get_activation_stats');
    if (error) {
      this.setBadge('off', 'ERROR');
      this.hint('Gagal memuat statistik: ' + error.message + ' (jalankan supabase.sql di SQL Editor Supabase)');
      return false;
    }
    this.hint('');
    animateNum($('#stat-total'), Number(data.total));
    animateNum($('#stat-today'), Number(data.today));
    this.renderBars(data.daily);
    return true;
  },
  feedItem(row, isNew) {
    const el = document.createElement('div');
    el.className = 'feed-item' + (isNew ? ' new' : '');
    const mail = row.email ? `<small class="feed-mail">${esc(row.email)}</small>` : '';
    const who = row.name ? nameHtml(row.name) : 'Aktivasi sukses';
    el.innerHTML = `<span class="dot"></span><div class="feed-txt"><b>${who}</b>${mail}</div><time>${clock(row.created_at)}</time>`;
    return el;
  },
  async loadFeed() {
    const q = (cols) => this.client.from('activations').select(cols).order('created_at', { ascending: false }).limit(8);
    let { data, error } = await q('id,created_at,email,name');
    if (error) ({ data, error } = await q('id,created_at,email')); // kolom name belum ada (supabase.sql v4.3 belum dijalankan)
    if (error) ({ data } = await q('id,created_at')); // kolom email belum ada: tetap tampilkan feed lama
    if (!data || !data.length) return;
    const feed = $('#feed');
    feed.innerHTML = '';
    data.forEach((row) => feed.appendChild(this.feedItem(row, false)));
  },
  pushFeed(row) {
    const feed = $('#feed');
    if (!$('.feed-item', feed)) feed.innerHTML = '';
    feed.prepend(this.feedItem(row, true));
    const r = feed.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) FX.burstAt(r.left + 40, Math.max(r.top, 60) + 20, 26);
    while (feed.children.length > 8) feed.lastChild.remove();
    setTimeout(() => feed.firstChild && feed.firstChild.classList.remove('new'), 4000);
  },
  async init() {
    const cfg = window.APP_CONFIG || {};
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
      this.setBadge('off', 'OFFLINE');
      this.hint(!window.supabase
        ? 'Library Supabase gagal dimuat. Pastikan HP terhubung internet.'
        : 'Supabase belum dikonfigurasi. Isi file .env lalu restart server.');
      return;
    }
    this.client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    if (await this.refresh()) this.loadFeed();

    this.client
      .channel('activations-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activations' }, (payload) => {
        this.pushFeed(payload.new);
        this.refresh();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.setBadge('on', 'LIVE');
        else if (status === 'CONNECTING' || status === 'JOINING') this.setBadge('wait', 'MENYAMBUNG');
        else this.setBadge('off', 'TERPUTUS');
      });

    // Penyegaran berkala: menjaga akurasi saat pergantian hari / koneksi sempat putus
    setInterval(() => this.refresh(), 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.refresh(); });
  }
};
live.init();


/* Info Pengunjung: IP asli (via server) + baterai perangkat (Battery Status API) */
const visitor = {
  place(city, country) {
    return city && country && city !== country ? `${city}, ${country}` : (country || city || '');
  },
  timeout(ms) {
    return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  },
  // 1) Lewat server panel
  async fromServer() {
    const r = await fetch('/api/visitor', { cache: 'no-store', signal: this.timeout(12000) });
    if (!(r.headers.get('content-type') || '').includes('json')) throw new Error('endpoint /api/visitor tidak ada');
    const d = await r.json();
    if (!r.ok || !d.ip) throw new Error(d.error || 'status ' + r.status);
    return d;
  },
  // 2) Langsung dari browser (cadangan, juga jalan di hosting statis)
  async fromBrowser() {
    const get = async (url) => (await fetch(url, { cache: 'no-store', signal: this.timeout(6000) })).json();
    try {
      const d = await get('https://ipwho.is/');
      if (d.success && d.ip) return { ip: d.ip, location: this.place(d.city, d.country), isp: (d.connection && (d.connection.org || d.connection.isp)) || '' };
    } catch {}
    try {
      const d = await get('https://ipapi.co/json/');
      if (d.ip && !d.error) return { ip: d.ip, location: this.place(d.city, d.country_name), isp: d.org || '' };
    } catch {}
    try {
      const d = await get('https://ipinfo.io/json');
      if (d.ip) return { ip: d.ip, location: this.place(d.city, d.country), isp: d.org || '' };
    } catch {}
    try {
      const d = await get('https://api64.ipify.org?format=json');
      if (d.ip) return { ip: d.ip, location: '', isp: '' };
    } catch {}
    throw new Error('semua layanan IP gagal dari browser');
  },
  isV4(s) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(s || ''); },
  async getText(url) { return (await (await fetch(url, { cache: 'no-store', signal: this.timeout(6000) })).text()).trim(); },
  // IPv4 langsung dari browser (layanan khusus IPv4, jadi hasilnya tanpa tanda ":")
  async browserV4() {
    const sources = [
      async () => JSON.parse(await this.getText('https://api.ipify.org?format=json')).ip,
      async () => this.getText('https://ipv4.icanhazip.com'),
      async () => this.getText('https://v4.ident.me')
    ];
    for (const src of sources) {
      try { const ip = await src(); if (this.isV4(ip)) return ip; } catch {}
    }
    return '';
  },
  // Lokasi + ISP untuk IPv4 tertentu (server dulu, lalu browser). IP tetap ditampilkan walau lokasi gagal.
  async geoFor(ip) {
    try {
      const r = await fetch('/api/visitor?ip=' + encodeURIComponent(ip), { cache: 'no-store', signal: this.timeout(12000) });
      if ((r.headers.get('content-type') || '').includes('json')) {
        const d = await r.json();
        if (r.ok && d.ip) return d;
      }
    } catch {}
    try {
      const d = JSON.parse(await this.getText(`https://ipwho.is/${ip}`));
      if (d.success) return { ip, location: this.place(d.city, d.country), isp: (d.connection && (d.connection.org || d.connection.isp)) || '' };
    } catch {}
    return { ip, location: '', isp: '' };
  },
  async loadIp(retry = true) {
    const ip = $('#v-ip'), loc = $('#v-loc');
    ip.textContent = 'Memuat...';
    loc.textContent = 'Mendeteksi lokasi...';
    let d = null;
    const errs = [];

    // 1) Utamakan IPv4 (format 13.250.114.33, tanpa titik dua)
    const v4 = await this.browserV4();
    if (v4) d = await this.geoFor(v4);
    else errs.push('ipv4: tidak tersedia');

    // 2) Cadangan: lewat server panel, lalu langsung dari browser (bisa berupa IPv6)
    if (!d) { try { d = await this.fromServer(); } catch (e) { errs.push('server: ' + e.message); } }
    if (!d) { try { d = await this.fromBrowser(); } catch (e) { errs.push('browser: ' + e.message); } }

    if (d) {
      ip.textContent = d.ip;
      const parts = [d.location, d.isp].filter(Boolean);
      if (d.ip.includes(':')) parts.push('jaringanmu hanya IPv6');
      loc.textContent = parts.join(' \u00b7 ') || 'Lokasi tidak tersedia';
      return;
    }
    console.warn('[Info Pengunjung] gagal mendeteksi IP ->', errs.join(' | '));
    ip.textContent = 'Tidak terdeteksi';
    loc.textContent = 'Cek internet, matikan VPN / pemblokir iklan, lalu tekan "Muat ulang info".';
    if (retry) setTimeout(() => { if ($('#v-ip').textContent === 'Tidak terdeteksi') this.loadIp(false); }, 4000);
  },
  battery: null,
  renderBattery() {
    const b = this.battery;
    if (!b) return;
    const pct = Math.round(b.level * 100);
    const bar = $('#v-bat-bar');
    $('#v-bat').textContent = pct + '%';
    bar.style.width = pct + '%';
    bar.className = (pct <= 20 ? 'low' : pct <= 50 ? 'mid' : '') + (b.charging ? ' chg' : '');
    let sub = b.charging ? 'Sedang mengisi' : 'Tidak sedang mengisi';
    if (b.charging && isFinite(b.chargingTime) && b.chargingTime > 0) sub += ` \u00b7 penuh \u00b1${Math.ceil(b.chargingTime / 60)} mnt`;
    if (!b.charging && isFinite(b.dischargingTime) && b.dischargingTime > 0) {
      const m = Math.round(b.dischargingTime / 60);
      sub += ` \u00b7 sisa \u00b1${Math.floor(m / 60)} j ${m % 60} mnt`;
    }
    $('#v-bat-sub').textContent = sub;
  },
  async initBattery() {
    if (!navigator.getBattery) {
      $('#v-bat').textContent = 'Tidak didukung';
      $('#v-bat-sub').textContent = 'Browser ini tidak mengizinkan akses baterai (coba Chrome di Android).';
      return;
    }
    try {
      this.battery = await navigator.getBattery();
      ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']
        .forEach((ev) => this.battery.addEventListener(ev, () => this.renderBattery()));
      this.renderBattery();
    } catch {
      $('#v-bat').textContent = 'Tidak tersedia';
      $('#v-bat-sub').textContent = 'Akses baterai diblokir oleh browser.';
    }
  },
  init() {
    this.loadIp();
    this.initBattery();
    $('#v-refresh').addEventListener('click', () => { this.loadIp(); this.renderBattery(); toast('Info diperbarui'); });
    $('#v-copy').addEventListener('click', async () => {
      const v = $('#v-ip').textContent;
      if (!/\d/.test(v)) return toast('IP belum tersedia', 'err');
      try { await navigator.clipboard.writeText(v); toast('IP disalin'); } catch { toast('Gagal menyalin', 'err'); }
    });
  }
};
visitor.init();

/* =====================================================================
   v4: Nama pengguna, welcome, efek, fitur tambahan
   ===================================================================== */
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#ffd23f', '#ff8fab', '#7cc6fe', '#7be495', '#ff9f5a', '#c3a6ff', '#0d0d0d'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- Nama ---- */
function cleanName(v) {
  return String(v || '').replace(/[<>&"`\\\/{}\[\]|^~$%]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
function userName() { return cleanName(store.get('am_user', '')); }

/* ---- Developer terverifikasi (centang biru) ----
   Nama "kenz" dicadangkan: server hanya mengizinkannya untuk SATU perangkat developer (login /admin),
   database juga menolak ulasan bernama kenz dari orang lain. Jadi nama ini di tampilan publik pasti developer. */
function normName(n) {
  const A = '013457@$', B = 'oieastas', C = '\u0435\u043a\u043e\u0430\u0455\u0456\u0440\u0441\u0445\u0443', D = 'ekoasipcxy';
  return String(n || '').toLowerCase().replace(/./gu, (ch) => { let i = A.indexOf(ch); if (i >= 0) return B[i]; i = C.indexOf(ch); return i >= 0 ? D[i] : ch; }).replace(/[^a-z]/g, '');
}
const RESERVED_NAMES = ['kenz', 'kenzdev', 'kenzdeveloper', 'developerkenz', 'kenzadmin', 'adminkenz', 'kenzofficial', 'officialkenz', 'kenzchillz'];
const isDevName = (n) => RESERVED_NAMES.includes(normName(n));
const VBADGE = '<svg class="vb" viewBox="0 0 24 24" role="img" aria-label="Developer terverifikasi"><title>Developer terverifikasi</title><path fill="#1d9bf0" stroke="#0d0d0d" stroke-width="1.3" d="M12 1.8l2.4 1.7 2.9-.2 1 2.8 2.5 1.6-.9 2.8.9 2.8-2.5 1.6-1 2.8-2.9-.2L12 20.2l-2.4-1.7-2.9.2-1-2.8-2.5-1.6.9-2.8-.9-2.8 2.5-1.6 1-2.8 2.9.2z"/><path d="M7.8 12.2l3 3 5.6-6" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const nameHtml = (n) => esc(n) + (isDevName(n) ? ' ' + VBADGE : '');
function validateName(v) {
  if (v.length < 2) return 'Nama minimal 2 karakter.';
  if (!/[\p{L}\p{N}]/u.test(v)) return 'Nama harus berisi huruf atau angka.';
  return '';
}
function greetWord() {
  const h = new Date().getHours();
  return h < 4 ? 'Selamat malam' : h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
}
function applyUser() {
  const n = userName();
  const dev = !!(window.Device && Device.state.dev) && isDevName(n);
  $$('[data-user]').forEach((el) => { el.textContent = n || 'Teman'; if (dev) el.insertAdjacentHTML('beforeend', ' ' + VBADGE); });
  $('#avatar').textContent = (n.match(/[\p{L}\p{N}]/u) || ['?'])[0];
  $('#pname').textContent = n;
  if (dev) $('#pname').insertAdjacentHTML('beforeend', ' ' + VBADGE);
  $('#profile-btn').setAttribute('aria-label', n ? `Ganti nama (${n})` : 'Ganti nama');
  updateClock();
}

/* ---- Jam & sapaan ---- */
function updateClock() {
  const d = new Date(), p = (x) => String(x).padStart(2, '0');
  $('#clock').textContent = `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  const date = d.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });
  $('#greet').textContent = `${greetWord()} \u2022 ${date}`.toUpperCase();
}
setInterval(updateClock, 1000);

/* ---- Typewriter ---- */
const typing = {
  token: 0,
  async type(el, text, speed = 38) {
    const my = ++this.token;
    el.textContent = '';
    if (REDUCED) { el.textContent = text; return true; }
    for (const ch of text) {
      if (my !== this.token) return false;
      el.textContent += ch;
      await sleep(speed + Math.random() * 25);
    }
    return true;
  }
};
async function heroTyper() {
  const el = $('#typer');
  const lines = [
    'Pantau aktivitas aktivasi secara real-time.',
    'Kelola akun premium dari satu tempat.',
    'Aktivasi VIP Pro 1 tahun, otomatis dan cepat.',
    'Satu langkah lagi menuju akun premium.'
  ];
  let i = 0;
  for (;;) {
    const t = ++heroTyper.tok;
    el.textContent = '';
    for (const ch of lines[i % lines.length]) {
      if (t !== heroTyper.tok) return;
      el.textContent += ch;
      await sleep(REDUCED ? 0 : 34);
    }
    await sleep(2400);
    while (el.textContent.length && !REDUCED) { el.textContent = el.textContent.slice(0, -1); await sleep(14); }
    i++;
  }
}
heroTyper.tok = 0;

/* ---- Efek partikel / konfeti (canvas) ---- */
const FX = {
  cv: $('#fx-canvas'), ctx: null, parts: [], on: false, dpr: 1, w: 0, h: 0, last: 0,
  get enabled() { return store.get('am_fx', true) && !REDUCED; },
  init() {
    this.ctx = this.cv.getContext('2d');
    const rs = () => {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = innerWidth; this.h = innerHeight;
      this.cv.width = this.w * this.dpr; this.cv.height = this.h * this.dpr;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    };
    rs(); addEventListener('resize', rs);
  },
  add(p) { if (this.parts.length < 420) this.parts.push(p); if (!this.on) { this.on = true; this.last = performance.now(); requestAnimationFrame((t) => this.loop(t)); } },
  burstAt(x, y, n = 60, spread = Math.PI * 2, angle = 0, power = 9) {
    if (!this.enabled) return;
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - .5) * spread, v = power * (.45 + Math.random() * .8);
      this.add({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, g: .28, drag: .985,
        s: 6 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - .5) * .35,
        c: COLORS[(Math.random() * COLORS.length) | 0], shape: Math.random() < .3 ? 'c' : 'r', life: 1, decay: .0045 + Math.random() * .005
      });
    }
  },
  confetti() {
    if (!this.enabled) return;
    const w = this.w, h = this.h;
    this.burstAt(w * .08, h * .95, 70, 1.1, -Math.PI / 3, 17);
    this.burstAt(w * .92, h * .95, 70, 1.1, -Math.PI * 2 / 3, 17);
    this.burstAt(w * .5, h * .55, 60, Math.PI * 2, 0, 11);
  },
  spark(x, y) {
    if (!this.enabled) return;
    this.add({
      x, y, vx: (Math.random() - .5) * 2.2, vy: (Math.random() - .5) * 2.2 - .6, g: .06, drag: .96,
      s: 4 + Math.random() * 5, r: Math.random() * 3, vr: .1, c: COLORS[(Math.random() * 6) | 0], shape: 'r', life: 1, decay: .035
    });
  },
  loop(t) {
    const dt = Math.min(2, (t - this.last) / 16.67 || 1); this.last = t;
    const c = this.ctx;
    c.clearRect(0, 0, this.w, this.h);
    this.parts = this.parts.filter((p) => p.life > 0 && p.y < this.h + 40);
    for (const p of this.parts) {
      p.vx *= p.drag; p.vy = p.vy * p.drag + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt; p.life -= p.decay * dt;
      if (p.grow) p.s += p.grow * dt;
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, p.shape === 'ring' ? p.life : p.life * 2)) * (p.a || 1);
      c.translate(p.x, p.y); c.rotate(p.r);
      c.fillStyle = p.c; c.strokeStyle = '#0d0d0d'; c.lineWidth = 2;
      if (p.shape === 'o') {
        const R = Math.max(0, (p.s / 2) * (p.life < .3 ? p.life / .3 : 1));
        c.beginPath(); c.arc(0, 0, R, 0, 7); c.fillStyle = p.c; c.fill(); c.lineWidth = 1.5; c.strokeStyle = 'rgba(13,13,13,.55)'; c.stroke();
        c.beginPath(); c.arc(-R * .32, -R * .34, R * .26, 0, 7); c.fillStyle = 'rgba(255,255,255,.7)'; c.fill();
      } else if (p.shape === 'ring') {
        c.beginPath(); c.arc(0, 0, Math.max(0, p.s / 2), 0, 7); c.lineWidth = Math.max(1, p.lw * Math.max(0, p.life)); c.strokeStyle = p.c; c.stroke();
      } else if (p.shape === 'c') { c.beginPath(); c.arc(0, 0, p.s / 2, 0, 7); c.fill(); c.stroke(); }
      else { c.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); c.strokeRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); }
      c.restore();
    }
    if (this.parts.length) requestAnimationFrame((n) => this.loop(n));
    else { this.on = false; c.clearRect(0, 0, this.w, this.h); }
  }
};
FX.init();

/* Jejak kursor (mouse saja) */
(function sparkTrail() {
  let lx = 0, ly = 0, lt = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !FX.enabled) return;
    const now = performance.now();
    if (now - lt < 45 || Math.hypot(e.clientX - lx, e.clientY - ly) < 18) return;
    lt = now; lx = e.clientX; ly = e.clientY;
    FX.spark(e.clientX, e.clientY);
  }, { passive: true });
})();

/* Efek gelembung warna-warni: klik/ketuk = gelombang + letupan lingkaran, geser/swipe = jejak pelangi */
const BUBBLE_COLORS = ['#ffe08a', '#ffb3c6', '#a8d8fb', '#a6f0bd', '#ffc999', '#d6c4ff'];
Object.assign(FX, {
  pop(x, y) {
    const pick = () => BUBBLE_COLORS[(Math.random() * BUBBLE_COLORS.length) | 0];
    this.add({ shape: 'ring', x, y, vx: 0, vy: 0, g: 0, drag: 1, s: 8, grow: 1.7, lw: 3, a: .6, c: pick(), r: 0, vr: 0, life: 1, decay: .03 });
    const n = innerWidth < 500 ? 5 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * .8, v = 1 + Math.random() * 2.2;
      this.add({ shape: 'o', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: -.006, drag: .95, a: .85, s: 6 + Math.random() * 8, r: 0, vr: 0, c: pick(), life: 1, decay: .011 + Math.random() * .006 });
    }
  },
  trail(x, y, hue) {
    this.add({ shape: 'o', x: x + (Math.random() - .5) * 8, y: y + (Math.random() - .5) * 8, vx: (Math.random() - .5) * .8, vy: (Math.random() - .5) * .8 - .3, g: -.01, drag: .975, a: .8,
      s: 5 + Math.random() * 6, r: 0, vr: 0, c: `hsl(${hue % 360} 85% 70%)`, life: 1, decay: .014 + Math.random() * .006 });
  }
});
(function bubbleFx() {
  const skip = (t) => t && t.closest && t.closest('input, textarea, select, [contenteditable]');
  let lx = 0, ly = 0, hue = Math.random() * 360;
  const move = (x, y) => {
    if (Math.hypot(x - lx, y - ly) < 24) return;
    lx = x; ly = y; hue = (hue + 14) % 360;
    FX.trail(x, y, hue);
  };
  addEventListener('pointerdown', (e) => {
    lx = e.clientX; ly = e.clientY;
    if (!FX.enabled || skip(e.target) || (e.pointerType === 'mouse' && e.button !== 0)) return;
    FX.pop(e.clientX, e.clientY);
  }, { passive: true });
  // mouse/pen: geser sambil menahan klik
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !e.buttons || !FX.enabled || skip(e.target)) return;
    move(e.clientX, e.clientY);
  }, { passive: true });
  // layar sentuh: swipe/scroll (touchmove tetap terkirim saat halaman digulir)
  addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) { lx = t.clientX; ly = t.clientY; } }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!FX.enabled) return;
    const t = e.touches[0];
    if (t) move(t.clientX, t.clientY);
  }, { passive: true });
})();

/* Ripple pada tombol */
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest && e.target.closest('.btn');
  if (!b || b.disabled) return;
  const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
  const rp = document.createElement('span');
  rp.className = 'ripple';
  rp.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
  b.appendChild(rp);
  setTimeout(() => rp.remove(), 650);
});

/* Tilt 3D untuk kartu (perangkat dengan kursor) */
(function tilt() {
  if (REDUCED || !matchMedia('(hover: hover)').matches) return;
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.stat, .ms, .g-card');
    $$('.tilt').forEach((t) => { if (t !== el) { t.classList.remove('tilt'); t.style.transform = ''; } });
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
    el.classList.add('tilt');
    el.style.transform = `perspective(700px) rotateX(${(-y * 9).toFixed(2)}deg) rotateY(${(x * 11).toFixed(2)}deg) translateY(-4px)`;
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => $$('.tilt').forEach((t) => { t.classList.remove('tilt'); t.style.transform = ''; }));
})();

/* Parallax + cahaya kursor di hero */
(function heroFx() {
  const hero = $('.hero');
  if (!hero || REDUCED) return;
  hero.addEventListener('pointermove', (e) => {
    const r = hero.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    hero.style.setProperty('--mx', (x * 100) + '%');
    hero.style.setProperty('--my', (y * 100) + '%');
    hero.style.setProperty('--px', ((x - .5) * 2).toFixed(2));
    hero.style.setProperty('--py', ((y - .5) * 2).toFixed(2));
  });
  hero.addEventListener('pointerleave', () => { hero.style.setProperty('--px', 0); hero.style.setProperty('--py', 0); });
})();

/* Progres scroll + tombol ke atas */
(function scrollUi() {
  const bar = $('#progress'), top = $('#to-top');
  let tick = false;
  const run = () => {
    tick = false;
    const max = document.documentElement.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 0;
    bar.style.setProperty('--p', p.toFixed(4));
    bar.classList.toggle('show', scrollY > 8 && max > 0);
    top.classList.toggle('hidden', scrollY < 420);
  };
  addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(run); } }, { passive: true });
  addEventListener('resize', run);
  top.addEventListener('click', () => scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }));
  run();
})();

/* ---- Tema warna + toggle efek ---- */
const ACCENT_HEX = { yellow: '#ffd23f', mint: '#6ee7a0', blue: '#7cc6fe', pink: '#ff8fab', purple: '#c3a6ff', orange: '#ff9f5a' };
function applyAccent(name, save = true) {
  if (!ACCENT_HEX[name]) name = 'yellow';
  document.documentElement.setAttribute('data-accent', name);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', ACCENT_HEX[name]);
  $$('#swatches .sw').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accent === name)));
  if (save) store.set('am_accent', name);
}
applyAccent(store.get('am_accent', 'yellow'), false);
$('#swatches').addEventListener('click', (e) => {
  const b = e.target.closest('.sw');
  if (!b) return;
  applyAccent(b.dataset.accent);
  const r = b.getBoundingClientRect();
  FX.burstAt(r.left + r.width / 2, r.top + r.height / 2, 22, Math.PI * 2, 0, 7);
  toast('Tema warna diganti');
});
$('#fx-toggle').checked = store.get('am_fx', true);
$('#fx-toggle').addEventListener('change', (e) => {
  store.set('am_fx', e.target.checked);
  toast(e.target.checked ? 'Efek partikel aktif' : 'Efek partikel dimatikan');
});

/* ---- Form: validasi email live + tombol tempel ---- */
const emailOk = (v) => /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v);
$('#email').addEventListener('input', (e) => $('#email').closest('.field').classList.toggle('valid', emailOk(e.target.value.trim())));
$('#paste-btn').addEventListener('click', async () => {
  try {
    const t = (await navigator.clipboard.readText() || '').trim();
    if (!t) return toast('Clipboard kosong', 'err');
    $('#magic').value = t;
    $('#magic').dispatchEvent(new Event('input', { bubbles: true }));
    toast(/^https?:\/\//i.test(t) ? 'Link ditempel' : 'Teks ditempel (bukan link, cek lagi)', /^https?:\/\//i.test(t) ? '' : 'err');
  } catch { toast('Izin clipboard ditolak, tempel manual', 'err'); }
});

/* ---- Statistik pribadi (streak, akun, kunjungan) ---- */
function dayKey(t = Date.now()) {
  const d = new Date(t), p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function trackVisit() {
  const st = store.get('am_streak', { last: '', count: 0, visits: 0 });
  const today = dayKey();
  if (st.last !== today) {
    st.count = st.last === dayKey(Date.now() - 864e5) ? st.count + 1 : 1;
    st.last = today;
  }
  try { if (!sessionStorage.getItem('am_sess')) { sessionStorage.setItem('am_sess', '1'); st.visits = (st.visits || 0) + 1; } } catch { st.visits = Math.max(1, st.visits || 0); }
  st.visits = Math.max(1, st.visits || 0);
  store.set('am_streak', st);
  return st;
}
function renderMini() {
  const st = store.get('am_streak', { count: 1, visits: 1 });
  animateNum($('#ms-streak'), st.count || 1);
  animateNum($('#ms-acc'), store.get('am_accounts', []).length);
  animateNum($('#ms-visit'), st.visits || 1);
}

/* ---- Welcome / input nama ---- */
const welcome = {
  el: $('#welcome'), form: $('#w-form'), input: $('#w-name'), card: $('#w-card'), hello: $('#w-hello'),
  edit: false, busy: false,
  async open(edit = false) {
    this.edit = edit; this.busy = false;
    const cur = userName();
    this.el.classList.remove('leaving');
    this.el.classList.add('open');
    this.card.classList.remove('out', 'shake');
    this.card.classList.remove('hidden'); this.hello.classList.add('hidden');
    document.body.classList.add('no-scroll');
    this.input.value = edit ? cur : '';
    $('#w-pass-box').classList.add('hidden'); $('#w-pass').value = '';
    $('#w-cancel').classList.toggle('hidden', !edit);
    $('#w-go span').textContent = edit ? 'Simpan Nama' : 'Mulai Sekarang';
    $('#w-sub').textContent = edit
      ? 'Mau dipanggil apa sekarang? Perubahan langsung terlihat di dashboard.'
      : 'Kenalan dulu yuk. Namamu dipakai untuk menyapa di dashboard dan hanya tersimpan di perangkat ini.';
    this.sync();
    typing.type($('#w-type'), edit ? 'Mau dipanggil apa?' : 'Halo! Siapa namamu?', 42).then((done) => {
      if (done && !this.busy) this.input.focus({ preventScroll: true });
    });
    if (REDUCED) this.input.focus({ preventScroll: true });
  },
  sync() {
    const v = cleanName(this.input.value);
    $('#w-count').textContent = `${this.input.value.length}/20`;
    $('#w-prev-name').textContent = v || '...';
  },
  fail(msg) {
    $('#w-err').textContent = msg;
    $('#w-field').classList.add('err');
    this.card.classList.remove('shake'); void this.card.offsetWidth; this.card.classList.add('shake');
    this.input.focus();
  },
  async submit() {
    if (this.busy) return;
    const name = cleanName(this.input.value);
    const err = validateName(name);
    if (err) return this.fail(err);
    this.busy = true;
    // Nama dicadangkan (kenz) dicek ke server: hanya perangkat developer yang lolos; perangkat baru memasukkan kata sandi developer
    const passBox = $('#w-pass-box');
    const pass = passBox.classList.contains('hidden') ? '' : $('#w-pass').value;
    const chk = await Device.checkName(name, pass);
    if (!chk.ok) {
      this.busy = false;
      if (chk.needPass) passBox.classList.remove('hidden');
      this.fail(chk.error);
      if (chk.needPass) $('#w-pass').focus();
      return;
    }
    store.set('am_user', name);
    applyUser(); renderMini();
    window.dispatchEvent(new Event('am:namechange'));
    typing.token++;
    this.card.classList.add('out');
    await sleep(380);
    this.card.classList.add('hidden');
    const nm = $('#wh-name');
    nm.innerHTML = '';
    [...name].forEach((ch, i) => {
      const sp = document.createElement('span');
      sp.style.setProperty('--i', i);
      sp.textContent = ch === ' ' ? '\u00a0' : ch;
      nm.appendChild(sp);
    });
    $('.wh-s', this.hello).textContent = this.edit ? 'Nama diperbarui...' : 'Menyiapkan dashboardmu...';
    this.hello.classList.remove('hidden');
    FX.confetti();
    await sleep(this.edit ? 1500 : 2200);
    this.el.classList.add('leaving');
    await sleep(820);
    this.el.classList.remove('open', 'leaving');
    document.documentElement.classList.remove('needs-name');
    document.body.classList.remove('no-scroll');
    this.busy = false;
    toast(`${greetWord()}, ${name}!`);
    if (!this.edit) { showWarnIfNeeded(); channelPop.request(700); }
  },
  init() {
    this.input.addEventListener('input', () => {
      this.sync(); $('#w-err').textContent = ''; $('#w-field').classList.remove('err');
      if (!isDevName(this.input.value)) $('#w-pass-box').classList.add('hidden');
    });
    this.form.addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
    $('#w-cancel').addEventListener('click', () => {
      if (this.busy) return;
      typing.token++;
      this.el.classList.remove('open');
      document.body.classList.remove('no-scroll');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.edit && this.el.classList.contains('open') && !this.busy) $('#w-cancel').click();
    });
    $('#profile-btn').addEventListener('click', () => this.open(true));
    $('#rename-btn').addEventListener('click', () => { menu.close(); setTimeout(() => this.open(true), 240); });
  }
};
welcome.init();

/* ---- Popup saluran WhatsApp (muncul setiap awal masuk) ---- */
const channelPop = {
  el: $('#ch-pop'), shown: false, timer: 0,
  blocked() {
    return $('#welcome').classList.contains('open') || !$('#warn-modal').classList.contains('hidden') || !$('#sheet').classList.contains('hidden');
  },
  request(delay = 700) {
    if (this.shown) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.shown) return;
      if (this.blocked()) return this.request(900);
      this.open();
    }, delay);
  },
  open() {
    this.shown = true;
    this.el.classList.remove('hidden', 'out');
    document.body.classList.add('no-scroll');
    if (typeof FX !== 'undefined') FX.burstAt(innerWidth / 2, innerHeight * .32, 28, Math.PI * 2, 0, 8);
    $('#ch-go').focus({ preventScroll: true });
  },
  close() {
    if (this.el.classList.contains('hidden') || this.el.classList.contains('out')) return;
    this.el.classList.add('out');
    setTimeout(() => {
      this.el.classList.add('hidden'); this.el.classList.remove('out');
      document.body.classList.remove('no-scroll');
      if (typeof donatePop !== 'undefined') donatePop.request(650);
    }, REDUCED ? 0 : 280);
  },
  init() {
    $$('[data-ch-close]', this.el).forEach((b) => b.addEventListener('click', () => this.close()));
    $('#ch-go').addEventListener('click', () => {
      if (typeof FX !== 'undefined') FX.burstAt(innerWidth / 2, innerHeight * .7, 50);
      toast('Terima kasih sudah mengikuti!', 'ok');
      setTimeout(() => this.close(), 350);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.classList.contains('hidden')) this.close();
    });
  }
};
channelPop.init();

/* ---- Popup donasi (muncul setelah popup saluran WhatsApp ditutup) ---- */
const donatePop = {
  el: $('#dn-pop'), timer: 0,
  EVERY: 4 * 60 * 1000, /* jeda muncul lagi setelah ditutup (ms) - ubah sesuai selera */
  blocked() {
    return $('#welcome').classList.contains('open') || !$('#warn-modal').classList.contains('hidden') || !$('#sheet').classList.contains('hidden') || !channelPop.el.classList.contains('hidden') || !$('#cmd').classList.contains('hidden') || document.hidden;
  },
  request(delay = 650) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.el.classList.contains('hidden')) return;
      if (this.blocked()) return this.request(1500);
      this.open();
    }, delay);
  },
  open() {
    clearTimeout(this.timer);
    this.el.classList.remove('hidden', 'out');
    document.body.classList.add('no-scroll');
    if (typeof FX !== 'undefined') FX.burstAt(innerWidth / 2, innerHeight * .32, 24, Math.PI * 2, 0, 8);
    $('#dn-go').focus({ preventScroll: true });
  },
  close() {
    if (this.el.classList.contains('hidden') || this.el.classList.contains('out')) return;
    this.el.classList.add('out');
    setTimeout(() => {
      this.el.classList.add('hidden'); this.el.classList.remove('out');
      document.body.classList.remove('no-scroll');
      this.request(this.EVERY); /* muncul lagi, tidak hanya sekali */
    }, REDUCED ? 0 : 280);
  },
  init() {
    $$('[data-dn-close]', this.el).forEach((b) => b.addEventListener('click', () => this.close()));
    $('#dn-go').addEventListener('click', () => {
      if (typeof FX !== 'undefined') FX.burstAt(innerWidth / 2, innerHeight * .7, 50);
      toast('Terima kasih atas dukunganmu!', 'ok');
      setTimeout(() => this.close(), 350);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.classList.contains('hidden')) this.close();
    });
    this.request(2500); /* setiap awal masuk, juga jika popup saluran tidak tampil */
  }
};
donatePop.init();

/* ---- v4.1: bagikan, perintah cepat (Ctrl/Cmd+K), FAQ ---- */
const SITE = { title: 'AM Premify - Premium Panel', text: 'Panel aktivasi VIP Alight Motion, otomatis dan real-time.' };
async function shareSite() {
  const url = location.origin + '/index';
  if (navigator.share) {
    try { await navigator.share({ title: SITE.title, text: SITE.text, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link website disalin'); }
  catch { toast(url); }
}
$('#share-btn').addEventListener('click', () => { menu.close(); setTimeout(shareSite, 240); });

const CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb99yLaK0IBgYkp9KR2q';
const cmd = {
  el: $('#cmd'), input: $('#cmd-input'), list: $('#cmd-list'), items: [], shown: [], idx: 0, last: null,
  build() {
    const go = (v) => () => show(v);
    const ext = (u) => () => window.open(u, '_blank', 'noopener');
    const I = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
    const list = [
      { g: 'NAVIGASI', t: 'Dashboard', d: 'Statistik & aktivitas real-time', i: 'grid', k: 'beranda home dashboard', run: go('home') },
      { g: 'NAVIGASI', t: 'Premiumkan Akun', d: 'Kirim magic link & aktifkan VIP', i: 'crown', k: 'premium vip aktivasi email', run: go('premium') },
      { g: 'NAVIGASI', t: 'Panduan', d: '3 langkah + pertanyaan umum', i: 'book', k: 'panduan bantuan faq cara', run: go('guide') },
      { g: 'NAVIGASI', t: 'Bypass Link', d: 'Buka link shortener langsung ke tujuan', i: 'link', k: 'bypass link shortener sfl skip iklan tujuan', run: () => { location.href = '/bypass'; } },
      { g: 'NAVIGASI', t: 'Biodata Developer', d: 'Kenali pembuat website ini', i: 'user', k: 'biodata developer kenz profil', run: go('bio') },
      { g: 'NAVIGASI', t: 'Rating & Ulasan', d: 'Rating keseluruhan dari pengguna', i: 'star', k: 'rating ulasan bintang review nilai', run: () => (window.Reviews ? Reviews.go('rating') : show('reviews')) },
      { g: 'NAVIGASI', t: 'Bukti Sukses', d: 'Screenshot akun premium dari pengguna', i: 'image', k: 'bukti sukses screenshot akun testimoni', run: () => (window.Reviews ? Reviews.go('bukti') : show('reviews')) },
      { g: 'NAVIGASI', t: 'Room Publik', d: 'Ngobrol & kenalan dengan pengguna lain', i: 'users', k: 'room publik chat ngobrol kenalan teman komunitas grup', run: go('room') },
      { g: 'AKSI', t: 'Beri rating', d: 'Nilai AM Premify dengan bintang 1-5', i: 'star', k: 'beri rating bintang nilai ulasan tulis', run: () => window.Reviews && Reviews.openRate() },
      { g: 'AKSI', t: 'Tempel link dari clipboard', d: 'Buka halaman Premiumkan lalu tempel', i: 'link', k: 'tempel paste link magic', run: () => { show('premium'); setTimeout(() => $('#paste-btn').click(), 350); } },
      { g: 'AKSI', t: 'Chat admin', d: 'Tanya admin langsung di website ini', i: 'msg', k: 'chat admin pesan tanya bantuan balas', run: () => window.dispatchEvent(new Event('am:open-chat')) },
      { g: 'AKSI', t: 'Chat WhatsApp admin', d: 'Pesan otomatis langsung terisi', i: 'wa', k: 'whatsapp wa hubungi admin bantuan chat', run: () => window.open(waLink(), '_blank', 'noopener') },
      { g: 'AKSI', t: 'Ikuti saluran kenzchillz', d: 'Update & info terbaru di WhatsApp', i: 'wa', k: 'saluran channel kenzchillz ikuti whatsapp', run: ext(CHANNEL_URL) },
      { g: 'AKSI', t: 'Bagikan website', d: 'Kirim link AM Premify ke orang lain', i: 'share', k: 'bagikan share salin link', run: shareSite },
      { g: 'AKSI', t: 'Dukung developer', d: 'Donasi via Sociabuzz', i: 'heart', k: 'dukung donasi sociabuzz support', run: () => setTimeout(() => donatePop.open(), 200) },
      { g: 'PENGATURAN', t: 'Ganti nama', d: 'Ubah sapaan di dashboard', i: 'edit', k: 'nama panggilan ganti rename profil', run: () => setTimeout(() => welcome.open(true), 120) },
      { g: 'PENGATURAN', t: 'Efek partikel: nyala / mati', d: 'Konfeti, gelembung & jejak kursor', i: 'sparkle', k: 'efek partikel konfeti animasi fx', run: () => { const c = $('#fx-toggle'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); } },
      { g: 'PENGATURAN', t: 'Ke atas', d: 'Gulir kembali ke paling atas', i: 'up', k: 'atas top scroll', run: () => scrollTo({ top: 0, behavior: 'smooth' }) }
    ];
    const names = { yellow: 'Kuning', mint: 'Mint', blue: 'Biru', pink: 'Pink', purple: 'Ungu', orange: 'Oranye' };
    Object.keys(ACCENT_HEX).forEach((a) => list.push({
      g: 'TEMA WARNA', t: `Tema ${names[a]}`, d: 'Ganti warna aksen website', sw: ACCENT_HEX[a], k: `tema warna aksen theme ${a} ${names[a]}`.toLowerCase(),
      run: () => { applyAccent(a); toast(`Tema ${names[a]} aktif`); }
    }));
    list.forEach((c) => { c.icon = c.sw ? `<span class="sw-dot" style="--c:${c.sw}"></span>` : I(c.i); });
    this.items = list;
  },
  render() {
    const q = this.input.value.trim().toLowerCase();
    this.shown = !q ? this.items.filter((c) => c.g !== 'TEMA WARNA')
      : this.items.filter((c) => (c.t + ' ' + c.d + ' ' + c.k).toLowerCase().includes(q));
    if (this.idx >= this.shown.length) this.idx = Math.max(0, this.shown.length - 1);
    if (!this.shown.length) { this.list.innerHTML = '<div class="cmd-empty">Tidak ada perintah yang cocok. Coba kata lain.</div>'; return; }
    let html = '', g = '';
    this.shown.forEach((c, i) => {
      if (c.g !== g) { g = c.g; html += `<div class="cmd-g">${g}</div>`; }
      html += `<button type="button" class="cmd-it${i === this.idx ? ' on' : ''}" role="option" data-i="${i}" aria-selected="${i === this.idx}"><span class="ci">${c.icon}</span><span><b>${esc(c.t)}</b><small>${esc(c.d)}</small></span></button>`;
    });
    this.list.innerHTML = html;
    const on = $('.cmd-it.on', this.list);
    if (on) on.scrollIntoView({ block: 'nearest' });
  },
  open() {
    if (!this.el.classList.contains('hidden') || $('#welcome').classList.contains('open')) return;
    if (!this.items.length) this.build();
    this.last = document.activeElement;
    menu.close();
    this.idx = 0; this.input.value = '';
    this.render();
    this.el.classList.remove('hidden', 'out');
    document.body.classList.add('no-scroll');
    setTimeout(() => this.input.focus({ preventScroll: true }), 30);
  },
  close() {
    if (this.el.classList.contains('hidden') || this.el.classList.contains('out')) return;
    this.el.classList.add('out');
    setTimeout(() => {
      this.el.classList.add('hidden'); this.el.classList.remove('out');
      if (!channelPop.el.classList.contains('hidden') || !donatePop.el.classList.contains('hidden') || !$('#sheet').classList.contains('hidden')) return;
      document.body.classList.remove('no-scroll');
    }, REDUCED ? 0 : 160);
  },
  run(i) {
    const c = this.shown[i];
    if (!c) return;
    this.close();
    setTimeout(() => c.run(), 180);
  },
  init() {
    $('#cmd-open').addEventListener('click', () => this.open());
    $('#sheet-cmd').addEventListener('click', () => { menu.close(); setTimeout(() => this.open(), 260); });
    $$('[data-cmd-close]', this.el).forEach((b) => b.addEventListener('click', () => this.close()));
    this.input.addEventListener('input', () => { this.idx = 0; this.render(); });
    this.list.addEventListener('click', (e) => { const b = e.target.closest('.cmd-it'); if (b) this.run(+b.dataset.i); });
    this.list.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.cmd-it');
      if (b && +b.dataset.i !== this.idx) { this.idx = +b.dataset.i; $$('.cmd-it', this.list).forEach((x) => { const on = +x.dataset.i === this.idx; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); }); }
    });
    document.addEventListener('keydown', (e) => {
      const isOpen = !this.el.classList.contains('hidden');
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') || (document.activeElement || {}).isContentEditable;
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); isOpen ? this.close() : this.open(); return; }
      if (!isOpen) { if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); this.open(); } return; }
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.idx = Math.min(this.shown.length - 1, this.idx + 1); this.render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.idx = Math.max(0, this.idx - 1); this.render(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.run(this.idx); }
    });
  }
};
cmd.init();

/* FAQ: native <details name="faq"> sudah accordion; fallback untuk browser lama */
$$('#faq details').forEach((d) => d.addEventListener('toggle', () => {
  if (d.open) $$('#faq details').forEach((o) => { if (o !== d) o.open = false; });
}));

/* Init */
trackVisit();
applyUser();
renderHome();
renderMini();
show(VIEW_BY_PATH[location.pathname] || 'home', false);
if (location.pathname === '/') history.replaceState(null, '', '/index');
heroTyper();
if (userName()) {
  document.documentElement.classList.remove('needs-name');
  showWarnIfNeeded();
  channelPop.request(900);
} else {
  document.documentElement.classList.add('needs-name');
  welcome.open(false);
}


/* v4.3 - Fitur premium dinonaktifkan oleh admin (perangkat terblokir) */
(function blockedUi() {
  const card = $('#blocked-card');
  const apply = (blocked, reason) => {
    card.classList.toggle('hidden', !blocked);
    $('#blocked-txt').textContent = blocked
      ? 'Admin menonaktifkan fitur premium untuk perangkat ini' + (reason ? ` (alasan: ${reason})` : '') + '. Ganti nama atau keluar akun tidak mengubahnya. Chat admin untuk meminta pengaktifan kembali.'
      : '';
    ['#send-btn', '#verify-btn'].forEach((s) => { const b = $(s); if (b && blocked) b.disabled = true; });
    if (!blocked && $('#send-btn')) $('#send-btn').disabled = false;
  };
  window.addEventListener('am:blocked', (e) => apply(e.detail.blocked, e.detail.reason));
  $('#blocked-chat').addEventListener('click', () => window.dispatchEvent(new Event('am:open-chat')));
  apply(Device.state.blocked, Device.state.reason);
})();


/* v4.4 - centang developer + penolakan nama dicadangkan */
window.addEventListener('am:dev', () => applyUser());
window.addEventListener('am:device', (e) => {
  const d = e.detail || {};
  if (d.nameRejected && !d.dev && userName() && isDevName(userName())) {
    // Nama "kenz" tersimpan di perangkat yang bukan developer: dilepas, minta pilih nama lain
    store.set('am_user', '');
    applyUser();
    document.documentElement.classList.add('needs-name');
    welcome.open(false);
    setTimeout(() => welcome.fail('Nama ini dicadangkan untuk developer dan tidak bisa dipakai. Pilih nama lain.'), 700);
  }
});
