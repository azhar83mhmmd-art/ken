/* AM Premify - Bypass Link (/bypass)
   Alur: tempel link -> /api/bypass (proxy server) -> apiii-xrina.my.id/tools/bypassv2
   Jika proxy server tidak ada (hosting statis), otomatis mencoba langsung ke API. */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const API_LOCAL = '/api/bypass';
  const API_UPSTREAM = 'https://apiii-xrina.my.id/tools/bypassv2';
  const HKEY = 'am_bypass_hist';
  const HMAX = 10;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg, type) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (type || '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
  }

  /* ---------- Terminal ---------- */
  const term = {
    body: $('#term-body'),
    lines: [],
    log(type, msg) {
      const ts = new Date().toLocaleTimeString('id-ID', { hour12: false });
      const ln = document.createElement('div');
      ln.className = 'ln ' + type;
      const a = document.createElement('span'); a.className = 'ts'; a.textContent = '[' + ts + ']';
      const b = document.createElement('span'); b.className = 'msg'; b.textContent = msg;
      ln.append(a, b);
      this.body.appendChild(ln);
      this.body.scrollTop = this.body.scrollHeight;
      this.lines.push('[' + ts + '] ' + msg);
    },
    clear() { this.body.textContent = ''; this.lines = []; },
    text() { return this.lines.join('\n'); }
  };

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy'); ta.remove(); return ok;
      } catch { return false; }
    }
  }

  /* ---------- Validasi link ---------- */
  function normalizeUrl(raw) {
    let s = String(raw || '').trim();
    if (!s || s.length > 2000 || /\s/.test(s)) return '';
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      if (/^[\w-]+(\.[\w-]+)+([/?#:]|$)/.test(s)) s = 'https://' + s; else return '';
    }
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return '';
      return u.href;
    } catch { return ''; }
  }
  const hostOf = (u) => { try { return new URL(u).host; } catch { return u; } };
  const safeHttp = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };
  const short = (u, n = 64) => (u.length > n ? u.slice(0, n - 1) + '…' : u);

  /* ---------- Baca respons API (bentuk JSON bebas) ---------- */
  const PRI = ['result', 'bypass', 'bypassed', 'url', 'link', 'destination', 'target', 'direct', 'download', 'final', 'data'];
  function walk(v, path, out, d) {
    if (d > 6) return;
    if (typeof v === 'string') {
      const t = v.trim();
      if (/^https?:\/\/\S+$/i.test(t)) out.push({ path, url: t });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, path + '[' + i + ']', out, d + 1));
    } else if (v && typeof v === 'object') {
      Object.keys(v).forEach((k) => walk(v[k], path ? path + '.' + k : k, out, d + 1));
    }
  }
  const rank = (p) => {
    const last = String(p).split('.').pop().replace(/\[\d+\]$/, '').toLowerCase();
    const i = PRI.indexOf(last);
    return i < 0 ? 99 : i;
  };

  function interpret(resp, src) {
    const { ok, status, data, text } = resp;
    // Respons bukan JSON
    if (data == null) {
      const t = String(text || '').trim();
      if (ok && /^https?:\/\/\S+$/i.test(t)) return { ok: true, primary: t, others: [], raw: t };
      return { ok: false, message: ok ? 'Respons API tidak dikenali.' : 'API membalas HTTP ' + status + '.', raw: t.slice(0, 1500) };
    }
    const flag = data && typeof data === 'object' ? data : {};
    const failed = !ok || flag.status === false || flag.success === false || flag.ok === false ||
      (typeof flag.status === 'number' && flag.status >= 400) || !!flag.error;
    const found = [];
    walk(data, '', found, 0);
    const seen = new Set();
    const urls = found.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)))
      .sort((a, b) => rank(a.path) - rank(b.path));
    const fresh = urls.filter((x) => x.url !== src);
    if (!failed && fresh.length) {
      return { ok: true, primary: fresh[0].url, others: fresh.slice(1).map((x) => x.url), raw: data };
    }
    // Hasil berupa teks biasa (bukan URL)
    if (!failed) {
      const r = flag.result ?? flag.data ?? flag.message;
      if (typeof r === 'string' && r.trim()) return { ok: true, text: r.trim(), others: [], raw: data };
    }
    const m = flag.message || flag.msg || (typeof flag.error === 'string' ? flag.error : '') ||
      (typeof flag.result === 'string' ? flag.result : '') || (failed ? 'Bypass gagal. Link belum didukung atau sudah kedaluwarsa.' : 'API tidak mengembalikan link hasil.');
    return { ok: false, message: String(m).slice(0, 300), raw: data };
  }

  /* ---------- Panggil API ---------- */
  async function readResp(r) {
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, data, text };
  }
  async function callApi(url) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 50000);
    try {
      let r = null;
      try {
        r = await fetch(API_LOCAL + '?url=' + encodeURIComponent(url), { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      } catch (e) { if (e.name === 'AbortError') throw e; r = null; }
      // Proxy server menandai balasannya; kalau tidak ada tanda, berarti hosting statis -> langsung ke API
      if (r && r.headers.get('x-bypass-proxy')) return await readResp(r);
      term.log('warn', 'Proxy server tidak tersedia, mencoba langsung ke API...');
      r = await fetch(API_UPSTREAM + '?url=' + encodeURIComponent(url), { signal: ctrl.signal });
      return await readResp(r);
    } finally { clearTimeout(to); }
  }

  /* ---------- Riwayat ---------- */
  function loadHist() { const h = store.get(HKEY, []); return Array.isArray(h) ? h.filter((x) => x && x.src && x.out).slice(0, HMAX) : []; }
  function addHist(src, out) {
    const h = loadHist().filter((x) => x.src !== src);
    h.unshift({ src, out, t: Date.now() });
    store.set(HKEY, h.slice(0, HMAX));
    renderHist();
  }
  function fmtAgo(t) {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 60) return s + ' dtk lalu';
    if (s < 3600) return Math.round(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.round(s / 3600) + ' jam lalu';
    return Math.round(s / 86400) + ' hari lalu';
  }
  function iconBtn(tag, icon, title, cls) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    el.title = title; el.setAttribute('aria-label', title);
    if (tag === 'button') el.type = 'button';
    el.innerHTML = '<svg class="ic sm"><use href="#i-' + icon + '"/></svg>';
    return el;
  }
  function renderHist() {
    const ul = $('#hist'); const h = loadHist();
    ul.textContent = '';
    $('#hist-clear').classList.toggle('hidden', !h.length);
    if (!h.length) {
      const li = document.createElement('li');
      li.className = 'by-empty'; li.textContent = 'Belum ada riwayat. Hasil bypass terakhirmu tersimpan di perangkat ini.';
      ul.appendChild(li); return;
    }
    h.forEach((x, i) => {
      const li = document.createElement('li'); li.className = 'by-hi'; li.style.animationDelay = (i * 40) + 'ms';
      const tx = document.createElement('div'); tx.className = 'by-hi-tx';
      const b = document.createElement('b'); b.textContent = short(x.out, 58);
      const sm = document.createElement('small'); sm.textContent = hostOf(x.src) + ' • ' + fmtAgo(x.t);
      tx.append(b, sm);
      const acts = document.createElement('div'); acts.className = 'by-hi-acts';
      const cp = iconBtn('button', 'copy', 'Salin hasil');
      cp.addEventListener('click', async () => toast((await copyText(x.out)) ? 'Link disalin' : 'Gagal menyalin'));
      acts.appendChild(cp);
      if (safeHttp(x.out)) {
        const op = iconBtn('a', 'ext', 'Buka link');
        op.href = x.out; op.target = '_blank'; op.rel = 'noopener noreferrer nofollow';
        acts.appendChild(op);
      }
      const rm = iconBtn('button', 'trash', 'Hapus dari riwayat', 'del');
      rm.addEventListener('click', () => { store.set(HKEY, loadHist().filter((y) => y.src !== x.src)); renderHist(); });
      acts.appendChild(rm);
      li.append(tx, acts); ul.appendChild(li);
    });
  }

  /* ---------- Tampilan hasil ---------- */
  const resEl = $('#res');
  function showResult(r, src) {
    resEl.classList.remove('hidden', 'fail');
    $('#res-others').classList.add('hidden');
    $('#res-others-list').textContent = '';
    const main = $('#res-url'), open = $('#res-open'), copy = $('#res-copy');
    const raw = $('#res-raw');
    const rawTxt = typeof r.raw === 'string' ? r.raw : JSON.stringify(r.raw, null, 2);
    raw.textContent = String(rawTxt || '').slice(0, 6000);
    $('#res-raw-wrap').classList.toggle('hidden', !rawTxt);

    if (!r.ok) {
      resEl.classList.add('fail');
      $('#res-stamp-t').textContent = 'GAGAL';
      $('#res-meta').textContent = hostOf(src);
      main.className = 'by-msg'; main.textContent = r.message;
      open.classList.add('hidden'); copy.classList.add('hidden');
      return;
    }
    $('#res-stamp-t').textContent = 'BERHASIL';
    main.className = 'by-url';
    copy.classList.remove('hidden');
    if (r.text) {
      main.textContent = r.text; open.classList.add('hidden');
      $('#res-meta').textContent = hostOf(src) + ' → hasil teks';
      copy.dataset.v = r.text; return;
    }
    main.textContent = r.primary; copy.dataset.v = r.primary;
    $('#res-meta').textContent = hostOf(src) + ' → ' + hostOf(r.primary);
    if (safeHttp(r.primary)) { open.href = r.primary; open.classList.remove('hidden'); } else open.classList.add('hidden');
    if (r.others && r.others.length) {
      $('#res-others').classList.remove('hidden');
      const box = $('#res-others-list');
      r.others.slice(0, 6).forEach((u) => {
        const row = document.createElement('div'); row.className = 'by-other';
        const code = document.createElement('code'); code.textContent = u; row.appendChild(code);
        const cp = iconBtn('button', 'copy', 'Salin');
        cp.addEventListener('click', async () => toast((await copyText(u)) ? 'Link disalin' : 'Gagal menyalin'));
        row.appendChild(cp);
        if (safeHttp(u)) { const a = iconBtn('a', 'ext', 'Buka'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow'; row.appendChild(a); }
        box.appendChild(row);
      });
    }
  }

  /* ---------- Aksi utama ---------- */
  const input = $('#by-input'), field = $('#by-field'), go = $('#by-go');
  let busy = false, last = 0;

  function syncField() { field.classList.toggle('has-val', !!input.value); field.classList.remove('bad'); }

  async function run() {
    if (busy) return;
    const src = normalizeUrl(input.value);
    if (!src) {
      field.classList.remove('bad'); void field.offsetWidth; field.classList.add('bad');
      term.log('err', 'Link tidak valid. Contoh: https://sfl.gl/q3lfk94');
      toast('Masukkan link yang valid (http/https)', 'err');
      input.focus(); return;
    }
    if (Date.now() - last < 1500) return toast('Tunggu sebentar...', 'err');
    last = Date.now(); busy = true;
    input.value = src; syncField();
    go.disabled = true; go.classList.add('loading');
    $('#by-go-t').textContent = 'Memproses...';
    resEl.classList.add('hidden');
    term.log('sys', '$ bypass --url ' + hostOf(src));
    term.log('info', 'Menghubungi API bypass...');
    try {
      const resp = await callApi(src);
      term.log('info', 'Respons diterima (HTTP ' + resp.status + ').');
      const r = interpret(resp, src);
      showResult(r, src);
      if (r.ok) {
        const out = r.primary || r.text;
        term.log('ok', 'Berhasil: ' + short(out, 90));
        if (r.primary) addHist(src, r.primary);
        toast('Bypass berhasil!');
        if (r.primary && !safeHttp(r.primary)) term.log('warn', 'Hasil bukan link http/https, tombol Buka disembunyikan.');
      } else {
        term.log('err', 'Gagal: ' + r.message);
        toast('Bypass gagal', 'err');
      }
      setTimeout(() => resEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 120);
    } catch (e) {
      const msg = e && e.name === 'AbortError' ? 'Waktu habis (50 detik). Coba lagi nanti.' : 'Tidak bisa menghubungi API: ' + (e && e.message ? e.message : 'kesalahan jaringan');
      term.log('err', msg);
      showResult({ ok: false, message: msg, raw: '' }, src);
      toast('Bypass gagal', 'err');
    } finally {
      busy = false; go.disabled = false; go.classList.remove('loading');
      $('#by-go-t').textContent = 'Bypass Sekarang';
    }
  }

  /* ---------- Event ---------- */
  go.addEventListener('click', run);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
  input.addEventListener('input', syncField);
  $('#by-clear').addEventListener('click', () => { input.value = ''; syncField(); input.focus(); });
  $('#by-paste').addEventListener('click', async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return toast('Clipboard kosong', 'err');
      input.value = t; syncField(); toast('Link ditempel'); term.log('info', 'Link ditempel dari clipboard.');
    } catch { toast('Izin clipboard ditolak. Tempel manual (Ctrl+V).', 'err'); input.focus(); }
  });
  document.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => {
    input.value = b.dataset.ex; syncField(); input.focus();
  }));
  $('#res-copy').addEventListener('click', async (e) => {
    const v = e.currentTarget.dataset.v || '';
    toast((await copyText(v)) ? 'Link disalin' : 'Gagal menyalin', '');
  });
  $('#term-copy').addEventListener('click', async () => toast((await copyText(term.text())) ? 'Log disalin' : 'Gagal menyalin'));
  $('#term-clear').addEventListener('click', () => { term.clear(); term.log('sys', 'Log dibersihkan.'); });
  $('#term-toggle').addEventListener('click', () => $('#term').classList.toggle('collapsed'));
  $('#hist-clear').addEventListener('click', () => { store.set(HKEY, []); renderHist(); toast('Riwayat dihapus'); });

  /* ---------- Awal ---------- */
  try {
    const nm = JSON.parse(localStorage.getItem('am_user') || 'null');
    if (nm && typeof nm === 'string') {
      const h = $('#by-hello');
      h.querySelector('span').textContent = 'Halo, ' + nm.slice(0, 24) + '!';
      h.classList.remove('hidden');
    }
  } catch {}
  const pre = new URLSearchParams(location.search).get('url');
  if (pre) { input.value = pre.slice(0, 2000); syncField(); }
  renderHist();
  term.log('sys', 'bypass_terminal siap.');
  term.log('tip', 'Tempel link lalu tekan "Bypass Sekarang".');
})();
