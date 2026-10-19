// AM Premify v4.5 - Identitas perangkat
// - Token perangkat bertanda tangan dari server disimpan di 3 tempat: cookie HttpOnly (server), localStorage, IndexedDB.
//   Keluar akun / ganti nama / hapus salah satu penyimpanan TIDAK mengganti identitas perangkat.
// - Sidik jari (fp) & perangkat keras (hw) dikirim sebagai hash lewat header; server memakainya untuk mengenali
//   perangkat yang sudah dinonaktifkan premiumnya walau data browser dihapus.
(function () {
  'use strict';

  const LS_KEY = 'am_did';
  // Petunjuk tampilan saja: perangkat ini pernah diverifikasi server sebagai developer (agar centang biru tidak berkedip).
  // Keputusan sebenarnya tetap di server; jika server menjawab bukan developer, petunjuk ini dihapus.
  let devHint = false;
  try { devHint = localStorage.getItem('am_isdev') === '1'; } catch {}
  const state = { token: '', fp: '', hw: '', blocked: false, reason: '', unread: 0, configured: true, dev: devHint };

  /* ---------- penyimpanan cadangan ---------- */
  const idbOpen = () => new Promise((res) => {
    try {
      const rq = indexedDB.open('am_dev', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  async function idbGet(k) {
    const db = await idbOpen();
    if (!db) return '';
    return new Promise((res) => {
      try { const rq = db.transaction('kv').objectStore('kv').get(k); rq.onsuccess = () => res(rq.result || ''); rq.onerror = () => res(''); } catch { res(''); }
    });
  }
  async function idbSet(k, v) {
    const db = await idbOpen();
    if (!db) return;
    try { db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch {}
  }
  function remember(token) {
    if (!token || token === state.token) return;
    state.token = token;
    try { localStorage.setItem(LS_KEY, token); } catch {}
    idbSet(LS_KEY, token);
  }

  /* ---------- sidik jari ---------- */
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  const hash = (s) => cyrb53(s, 11).toString(16).padStart(14, '0') + cyrb53(s, 29).toString(16).padStart(14, '0');

  function canvasSig() {
    try {
      const c = document.createElement('canvas');
      c.width = 240; c.height = 60;
      const x = c.getContext('2d');
      x.textBaseline = 'top';
      x.font = "16px 'Arial'";
      x.fillStyle = '#f60'; x.fillRect(100, 1, 62, 20);
      x.fillStyle = '#069'; x.fillText('AM Premify \u{1F680} 0123', 2, 15);
      x.fillStyle = 'rgba(102,204,0,.7)'; x.fillText('AM Premify \u{1F680} 0123', 4, 17);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = 'rgb(255,0,255)'; x.beginPath(); x.arc(50, 50, 50, 0, Math.PI * 2, true); x.closePath(); x.fill();
      return hash(c.toDataURL());
    } catch { return 'nc'; }
  }
  function gpuSig() {
    try {
      const gl = document.createElement('canvas').getContext('webgl') || document.createElement('canvas').getContext('experimental-webgl');
      if (!gl) return 'nogl';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const v = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) + '|' + gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.VENDOR) + '|' + gl.getParameter(gl.RENDERER);
      return v + '|' + gl.getParameter(gl.MAX_TEXTURE_SIZE);
    } catch { return 'nogl'; }
  }
  async function uaModel() {
    try {
      const d = navigator.userAgentData;
      if (!d || !d.getHighEntropyValues) return '';
      const v = await Promise.race([d.getHighEntropyValues(['model', 'platformVersion']), new Promise((r) => setTimeout(() => r({}), 400))]);
      return (v.model || '') + '|' + (v.platformVersion || '');
    } catch { return ''; }
  }

  async function compute() {
    const n = navigator, s = window.screen || {};
    let tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
    const w = Math.max(s.width || 0, s.height || 0), h = Math.min(s.width || 0, s.height || 0); // tahan rotasi layar
    const hwStr = [n.platform || '', n.hardwareConcurrency || '', n.deviceMemory || '', w + 'x' + h, s.colorDepth || '', tz, gpuSig(), n.maxTouchPoints || 0].join('|');
    const fpStr = [hwStr, canvasSig(), (n.languages || [n.language || '']).join(','), await uaModel()].join('||');
    state.hw = hash(hwStr);
    state.fp = hash(fpStr);
  }

  /* ---------- siap pakai ---------- */
  state.ready = (async () => {
    let t = '';
    try { t = localStorage.getItem(LS_KEY) || ''; } catch {}
    if (!t) t = await idbGet(LS_KEY);
    if (t) remember(t); // sinkronkan localStorage & IndexedDB; jika keduanya kosong, server mengenali lewat cookie
    try { await compute(); } catch { state.fp = state.fp || 'e0e0e0e0e0e0'; state.hw = state.hw || 'e0e0e0e0e0e0'; }
  })();

  /* ---------- API ---------- */
  async function api(url, opts) {
    await state.ready;
    opts = Object.assign({}, opts);
    const h = new Headers(opts.headers || {});
    if (state.token) h.set('X-Device', state.token);
    h.set('X-FP', state.fp);
    h.set('X-HW', state.hw);
    opts.headers = h;
    opts.credentials = 'same-origin';
    const r = await fetch(url, opts);
    const t = r.headers.get('X-Device-Token');
    if (t) remember(t);
    return r;
  }

  function setBlocked(blocked, reason) {
    blocked = !!blocked;
    reason = reason || '';
    if (blocked === state.blocked && reason === state.reason) return;
    state.blocked = blocked;
    state.reason = reason;
    window.dispatchEvent(new CustomEvent('am:blocked', { detail: { blocked, reason } }));
  }

  function setDev(v) {
    v = !!v;
    if (v === state.dev) return;
    state.dev = v;
    try { localStorage.setItem('am_isdev', v ? '1' : '0'); } catch {}
    document.documentElement.classList.toggle('is-dev', v);
    window.dispatchEvent(new CustomEvent('am:dev', { detail: { dev: v } }));
  }

  // Cek nama ke server. Nama "kenz" (developer) hanya lolos untuk perangkat developer.
  // Perangkat baru bisa membuktikan diri dengan kata sandi developer (sama dengan kata sandi /admin).
  async function checkName(name, pass) {
    try {
      const body = { name };
      if (pass) body.pass = pass;
      const r = await api('/api/name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 || r.status === 401) return { ok: false, error: d.error || 'Nama ini tidak bisa dipakai.', needPass: !!d.needPass };
      if (r.ok) { if (d.dev) setDev(true); return { ok: true, dev: !!d.dev }; }
      if (r.status === 429) return { ok: false, error: d.error || 'Terlalu banyak percobaan.', needPass: !!d.needPass };
      return { ok: true }; // server bermasalah: jangan halangi pengguna biasa (nama dicadangkan tetap dicek ulang di server saat sinkron)
    } catch { return { ok: true }; }
  }

  let syncing = null;
  async function sync(name) {
    if (syncing) { await syncing; }
    syncing = (async () => {
      try {
        const r = await api('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || '' }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return null;
        state.configured = d.configured !== false;
        state.unread = d.unread || 0;
        setDev(d.dev);
        setBlocked(d.blocked, d.reason);
        window.dispatchEvent(new CustomEvent('am:device', { detail: d }));
        return d;
      } catch { return null; } finally { syncing = null; }
    })();
    return syncing;
  }

  window.Device = { state, api, sync, setBlocked, checkName, ready: state.ready };
})();
