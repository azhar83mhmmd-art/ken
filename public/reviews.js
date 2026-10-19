// AM Premify v4.5 - Rating, Ulasan & Bukti Sukses (+ balasan & like lewat social.js) (Supabase, real-time)
// Memakai helper global dari app.js: $, $$, esc, store, toast, fmt, userName, FX, live, show
(function () {
  'use strict';

  const client = (typeof live !== 'undefined' && live.client) || null;
  const BUCKET = 'proofs';
  const COLS = 'id,user_id,name,rating,comment,proof_path,created_at';
  const PAGE_SIZE = { ulasan: 12, bukti: 12 };
  const LABELS = ['', 'Sangat buruk', 'Kurang bagus', 'Cukup baik', 'Bagus', 'Luar biasa!'];
  const SUBS = { rating: '/rating', ulasan: '/ulasan', bukti: '/bukti' };
  const SUB_BY_PATH = { '/rating': 'rating', '/ulasan': 'ulasan', '/bukti': 'bukti' };
  const SUB_TITLE = { rating: 'Rating', ulasan: 'Ulasan', bukti: 'Bukti Sukses' };
  const AVATAR = ['#ffd23f', '#ff8fab', '#7cc6fe', '#7be495', '#ff9f5a', '#c3a6ff'];
  const POLY = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';

  const feedState = () => ({ from: 0, done: false, loading: false, loaded: false, ids: new Set() });
  const S = {
    uid: null, mine: null, stats: null, err: '', sub: 'rating', filter: 0,
    feed: { ulasan: feedState(), bukti: feedState() },
    rows: new Map()
  };
  const R = { mode: 'menu', rating: 0, hover: 0, blob: null, prevUrl: '', busy: false, open: false };

  /* ---------------- util ---------------- */
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  let gid = 0;
  function starsHtml(v, size = 18) {
    let out = '';
    for (let i = 1; i <= 5; i++) {
      const f = Math.max(0, Math.min(1, v - (i - 1)));
      let defs = '', fill;
      if (f >= 0.995) fill = '#ffb703';
      else if (f <= 0.005) fill = '#ffffff';
      else {
        const id = 'sg' + (++gid), pct = (f * 100).toFixed(1) + '%';
        defs = `<defs><linearGradient id="${id}"><stop offset="${pct}" stop-color="#ffb703"/><stop offset="${pct}" stop-color="#ffffff"/></linearGradient></defs>`;
        fill = `url(#${id})`;
      }
      out += `<svg class="sv" viewBox="0 0 24 24" style="--s:${size}px" aria-hidden="true">${defs}<polygon points="${POLY}" fill="${fill}"/></svg>`;
    }
    const label = (Math.round(v * 10) / 10).toString().replace('.', ',');
    return `<span class="stars" role="img" aria-label="${label} dari 5 bintang">${out}</span>`;
  }
  function avgText(avg, count) {
    if (!count) return '\u2013';
    let v = Math.round(avg * 10) / 10;
    if (avg < 5 && v >= 5) v = 4.9; // jangan pernah menampilkan 5,0 jika belum semua memberi 5
    return v.toFixed(1).replace('.', ',');
  }
  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' hari lalu';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
  const pubUrl = (path) => client.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const bump = (el) => { if (!el) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
  const ic = (id, cls = 'ic') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

  function mapErr(err) {
    const m = String((err && err.message) || err || '');
    if (err && err.code === '23505') return 'Kamu sudah memberi rating. Hapus ulasanmu dulu jika ingin menulis ulang.';
    if (err && (err.code === '42P01' || err.code === 'PGRST205' || /schema cache|does not exist/i.test(m))) return 'Tabel ulasan belum dibuat. Jalankan supabase.sql di SQL Editor Supabase.';
    if (/row-level security|permission denied/i.test(m)) return 'Akses ditolak. Pastikan supabase.sql versi terbaru sudah dijalankan.';
    return m || 'Terjadi kesalahan, coba lagi.';
  }

  function unlockIfIdle() {
    const open = !$('#rate-pop').classList.contains('hidden') || !$('#pf-view').classList.contains('hidden')
      || $('#welcome').classList.contains('open') || !$('#warn-modal').classList.contains('hidden')
      || !$('#ch-pop').classList.contains('hidden') || !$('#sheet').classList.contains('hidden') || !$('#cmd').classList.contains('hidden');
    if (!open) document.body.classList.remove('no-scroll');
  }

  /* ---------------- sesi anonim (identitas per perangkat) ---------------- */
  async function loadSession() {
    if (!client) return;
    try { const { data } = await client.auth.getSession(); S.uid = data.session ? data.session.user.id : null; } catch {}
  }
  async function ensureUser() {
    if (!client) throw new Error('Supabase belum dikonfigurasi. Isi file .env lalu restart server.');
    if (S.uid) { await linkDev(); return S.uid; }
    const { data: sd } = await client.auth.getSession();
    if (sd && sd.session) { S.uid = sd.session.user.id; await linkDev(); return S.uid; }
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data || !data.user) {
      console.warn('[Rating] signInAnonymously gagal:', error && error.message);
      throw new Error('Rating belum aktif: nyalakan "Allow anonymous sign-ins" di Supabase (Authentication > Sign In / Providers).');
    }
    S.uid = data.user.id;
    await linkDev();
    return S.uid;
  }

  // Developer: tautkan identitas anonim ke server agar database mengizinkan ulasan bernama "kenz"
  async function linkDev() {
    if (!client || !window.Device || !Device.state.dev) return;
    try {
      const { data } = await client.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (token) await Device.api('/api/dev/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
    } catch {}
  }

  /* ---------------- statistik ---------------- */
  async function loadStats() {
    if (!client) return;
    const { data, error } = await client.rpc('get_rating_stats');
    if (error) { S.err = mapErr(error); renderStats(); return; }
    S.err = ''; S.stats = data; renderStats();
  }
  const loadStatsSoon = debounce(loadStats, 250);

  function buildDist() {
    $('#rv-dist').innerHTML = [5, 4, 3, 2, 1].map((k) =>
      `<button type="button" class="rv-row" data-star="${k}" aria-label="Lihat ulasan ${k} bintang">
        <span class="k">${k}<svg class="sv" viewBox="0 0 24 24" style="--s:14px" aria-hidden="true"><polygon points="${POLY}" fill="#ffb703"/></svg></span>
        <span class="rv-bar"><i style="width:0%"></i></span><span class="rv-n">0</span></button>`).join('');
  }

  function renderStats() {
    const st = S.stats, n = st ? Number(st.count) : 0, avg = st ? Number(st.avg) : 0;
    const txt = avgText(avg, n);
    const el = $('#rv-avg'), mini = $('#rm-avg');
    if (el.textContent !== txt) { el.textContent = txt; bump(el); }
    if (mini.textContent !== txt) { mini.textContent = txt; bump(mini); }
    $('#rv-avg-stars').innerHTML = n ? starsHtml(avg, 30) : starsHtml(0, 30);
    $('#rm-stars').innerHTML = n ? starsHtml(avg, 15) : '';
    const proofs = st ? Number(st.proofs) : 0;
    let count;
    if (S.err) count = S.err;
    else if (!client) count = 'Supabase belum dikonfigurasi';
    else if (!st) count = 'Memuat data...';
    else count = n ? `dari ${fmt(n)} ulasan pengguna` : 'Belum ada rating. Jadilah yang pertama!';
    $('#rv-count').textContent = count;
    $('#rm-sub').textContent = S.err ? 'Rating belum tersedia' : !st ? 'Memuat rating...' : n ? `${fmt(n)} ulasan \u00b7 ${fmt(proofs)} bukti sukses` : 'Belum ada rating, jadilah yang pertama';
    [5, 4, 3, 2, 1].forEach((k) => {
      const c = st ? Number(st['s' + k] || 0) : 0, row = $(`.rv-row[data-star="${k}"]`);
      if (!row) return;
      $('i', row).style.width = (n ? (c / n) * 100 : 0).toFixed(1) + '%';
      $('.rv-n', row).textContent = fmt(c);
    });
    $('#rvt-ulasan-n').textContent = fmt(n);
    $('#rvt-bukti-n').textContent = fmt(proofs);
  }

  /* ---------------- ulasan milik sendiri ---------------- */
  async function loadMine() {
    if (!client || !S.uid) { S.mine = null; renderMine(); return; }
    const { data, error } = await client.from('reviews').select(COLS).eq('user_id', S.uid).maybeSingle();
    if (!error) {
      S.mine = data || null;
      if (data) { S.rows.set(data.id, data); if (!store.get('am_rate_prompted', 0)) store.set('am_rate_prompted', Date.now()); }
    }
    renderMine();
  }

  function renderMine() {
    const box = $('#rv-mine');
    if (!box) return;
    if (!client) { box.className = 'card rv-mine'; box.innerHTML = '<div class="empty">Supabase belum dikonfigurasi. Isi file .env lalu restart server.</div>'; return; }
    const m = S.mine;
    if (!m) {
      box.className = 'card rv-mine cta';
      box.innerHTML = `<div class="rvm-stars">${starsHtml(5, 24)}</div>
        <div><span class="kicker">RATING KAMU</span><h3>Belum memberi rating</h3>
        <p>Ceritakan pengalamanmu memakai AM Premify. Cukup satu kali, dan bisa kamu hapus kapan saja.</p></div>
        <button class="btn btn-dark" type="button" data-act="rate">${ic('star')}<span>Beri Rating</span></button>`;
      return;
    }
    box.className = 'card rv-mine';
    box.innerHTML = `<div class="rvm-top"><span class="kicker">ULASANMU</span><span class="rc-time">${esc(ago(m.created_at))}</span></div>
      <div class="rvm-row">${starsHtml(m.rating, 26)}<b class="rvm-r">${m.rating}/5</b></div>
      ${m.comment ? `<p class="rc-txt">${esc(m.comment)}</p>` : '<p class="rc-txt muted">Tanpa ulasan tertulis.</p>'}
      ${m.proof_path ? `<button type="button" class="rc-proof" data-view-proof="${esc(m.id)}" aria-label="Lihat buktimu"><img src="${esc(pubUrl(m.proof_path))}" alt="" loading="lazy" decoding="async"><span>BUKTI SUKSES</span></button>` : ''}
      <div class="rvm-act"><button class="btn rv-danger" type="button" data-act="delete">${ic('trash')}<span>Hapus Ulasan</span></button></div>
      <p class="hint">Setelah dihapus, kamu bisa menulis ulasan baru. Namamu ikut berubah otomatis jika kamu mengganti nama di menu.</p>`;
  }

  /* ---------------- daftar ulasan & galeri bukti ---------------- */
  function cardHtml(r, isNew) {
    const mine = S.uid && r.user_id === S.uid;
    const name = r.name || 'Pengguna';
    const ch = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    const proof = r.proof_path
      ? `<button type="button" class="rc-proof" data-view-proof="${esc(r.id)}" aria-label="Lihat bukti sukses ${esc(name)}"><img src="${esc(pubUrl(r.proof_path))}" alt="" loading="lazy" decoding="async"><span>BUKTI SUKSES</span></button>` : '';
    return `<article class="rc${mine ? ' mine' : ''}${isNew ? ' new' : ''}" data-id="${esc(r.id)}">
      <span class="rc-av" style="--c:${AVATAR[hash(name) % AVATAR.length]}" aria-hidden="true">${esc(ch)}</span>
      <div class="rc-main">
        <div class="rc-top"><b class="rc-name">${nameHtml(name)}</b>${mine ? '<span class="rc-me">KAMU</span>' : ''}<time class="rc-time" datetime="${esc(r.created_at)}">${esc(ago(r.created_at))}</time></div>
        <div class="rc-meta">${starsHtml(r.rating, 16)}</div>
        ${r.comment ? `<p class="rc-txt">${esc(r.comment)}</p>` : ''}
        ${proof}
        <div class="rc-soc" data-soc="${esc(r.id)}"></div>
      </div>
      ${mine ? `<button type="button" class="mini rc-del" data-del-review="${esc(r.id)}" aria-label="Hapus ulasanmu" title="Hapus ulasanmu">${ic('trash')}</button>` : ''}
    </article>`;
  }
  function tileHtml(r, isNew) {
    return `<button type="button" class="pf-tile${isNew ? ' new' : ''}" data-id="${esc(r.id)}" data-view-proof="${esc(r.id)}" aria-label="Lihat bukti sukses dari ${esc(r.name)}">
      <span class="pf-img"><img src="${esc(pubUrl(r.proof_path))}" alt="" loading="lazy" decoding="async"></span>
      <span class="pf-ok">${ic('check')}BUKTI SUKSES</span>
      <span class="pf-meta"><b>${nameHtml(r.name)}</b>${starsHtml(r.rating, 13)}<small>${esc(ago(r.created_at))}</small></span>
    </button>`;
  }
  const boxOf = (kind) => (kind === 'bukti' ? $('#pf-grid') : $('#rv-list'));
  const htmlOf = (kind, r, isNew) => (kind === 'bukti' ? tileHtml(r, isNew) : cardHtml(r, isNew));
  const matches = (kind, r) => (kind === 'bukti' ? !!r.proof_path : !S.filter || r.rating === S.filter);

  function syncEmpty(kind) {
    const F = S.feed[kind], box = boxOf(kind);
    const has = !!$('[data-id]', box);
    let empty = $('.rv-empty', box);
    if (has && empty) empty.remove();
    if (!has && F.loaded && !F.loading && !empty) {
      const msg = kind === 'bukti'
        ? 'Belum ada bukti sukses. Unggah screenshot akunmu lewat menu Rating.'
        : (S.filter ? `Belum ada ulasan ${S.filter} bintang.` : 'Belum ada ulasan. Jadilah yang pertama memberi rating!');
      box.insertAdjacentHTML('beforeend', `<div class="empty rv-empty wide">${esc(msg)}</div>`);
    }
    const more = kind === 'bukti' ? $('#pf-more') : $('#rv-more');
    more.classList.toggle('hidden', F.done || !F.loaded);
  }

  async function loadFeed(kind, mode) {
    const F = S.feed[kind], box = boxOf(kind);
    if (!client || F.loading) return;
    if (mode === 'more' && F.done) return;
    F.loading = true;
    if (mode === 'reset') {
      F.from = 0; F.done = false; F.loaded = false; F.ids.clear();
      box.innerHTML = Array.from({ length: kind === 'bukti' ? 4 : 3 }, () => '<div class="rv-skel"></div>').join('');
      (kind === 'bukti' ? $('#pf-more') : $('#rv-more')).classList.add('hidden');
    }
    const from = mode === 'more' ? F.from : 0, size = PAGE_SIZE[kind];
    let q = client.from('reviews').select(COLS).order('created_at', { ascending: false });
    if (kind === 'bukti') q = q.not('proof_path', 'is', null);
    else if (S.filter) q = q.eq('rating', S.filter);
    const { data, error } = await q.range(from, from + size - 1);
    F.loading = false;
    if (error) {
      box.innerHTML = `<div class="empty rv-empty wide">Gagal memuat: ${esc(mapErr(error))}</div>`;
      return;
    }
    if (mode !== 'more') { box.innerHTML = ''; F.ids.clear(); }
    data.forEach((r) => {
      S.rows.set(r.id, r);
      if (F.ids.has(r.id)) return;
      F.ids.add(r.id);
      box.insertAdjacentHTML('beforeend', htmlOf(kind, r, false));
    });
    F.from = from + data.length;
    F.done = data.length < size;
    F.loaded = true;
    syncEmpty(kind);
  }

  function addRow(r, isNew) {
    if (!r || r.hidden) return;
    S.rows.set(r.id, r);
    ['ulasan', 'bukti'].forEach((kind) => {
      const F = S.feed[kind];
      if (!F.loaded || F.ids.has(r.id) || !matches(kind, r)) return;
      F.ids.add(r.id);
      const box = boxOf(kind);
      const empty = $('.rv-empty', box);
      if (empty) empty.remove();
      box.insertAdjacentHTML('afterbegin', htmlOf(kind, r, isNew));
    });
  }
  function updateRow(r) {
    if (!r) return;
    const old = S.rows.get(r.id) || {};
    r = Object.assign({}, old, r);
    S.rows.set(r.id, r);
    ['ulasan', 'bukti'].forEach((kind) => {
      const el = $(`[data-id="${CSS.escape(r.id)}"]`, boxOf(kind));
      if (el && matches(kind, r)) {
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlOf(kind, r, false).trim();
        const fresh = tmp.firstElementChild;
        fresh.style.animation = 'none';
        el.replaceWith(fresh);
      }
    });
    if (S.mine && S.mine.id === r.id) { S.mine = r; renderMine(); }
  }
  function removeRow(id) {
    if (!id) return;
    S.rows.delete(id);
    ['ulasan', 'bukti'].forEach((kind) => {
      const F = S.feed[kind];
      F.ids.delete(id);
      $$(`[data-id="${CSS.escape(id)}"]`, boxOf(kind)).forEach((el) => el.remove());
      syncEmpty(kind);
    });
    if (S.mine && S.mine.id === id) { S.mine = null; renderMine(); }
    if (!$('#pf-view').classList.contains('hidden') && $('#pf-view').dataset.id === id) closeProof();
  }
  function refreshCards() {
    ['ulasan', 'bukti'].forEach((kind) => {
      $$('[data-id]', boxOf(kind)).forEach((el) => {
        const r = S.rows.get(el.dataset.id);
        if (!r) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = htmlOf(kind, r, false).trim();
        tmp.firstElementChild.style.animation = 'none';
        el.replaceWith(tmp.firstElementChild);
      });
    });
  }

  /* ---------------- hapus ulasan sendiri ---------------- */
  async function del(id) {
    const r = S.rows.get(id);
    if (!client || !r || !S.uid || r.user_id !== S.uid) return toast('Hanya pemilik yang bisa menghapus ulasan ini', 'err');

    const gone = ['Rating ' + r.rating + ' dari 5 bintang'];
    if (r.comment) gone.push('Teks ulasan yang kamu tulis');
    if (r.proof_path) gone.push('Bukti akun premium yang kamu unggah');
    const ok = await UI.confirm({
      tone: 'danger',
      icon: 'trash',
      title: 'Hapus ulasanmu?',
      message: 'Ulasan ini akan hilang dari halaman Rating, Ulasan, dan Bukti Sukses untuk semua pengunjung.',
      preview: { head: `${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}  ·  ${r.name}`, text: r.comment || '' },
      itemsTitle: 'Yang ikut terhapus',
      items: gone,
      note: 'Tindakan ini tidak dapat dibatalkan. Kamu bisa menulis ulasan baru setelahnya.',
      confirmText: 'Ya, hapus ulasan',
      cancelText: 'Batal',
      busyText: 'Menghapus…',
      onConfirm: async () => {
        const { data, error } = await client.from('reviews').delete().eq('id', id).select('id');
        if (error || !data || !data.length) throw new Error('Gagal menghapus ulasan. Periksa koneksi lalu coba lagi.');
        if (r.proof_path) client.storage.from(BUCKET).remove([r.proof_path]);
      }
    });
    if (!ok) return;
    removeRow(id);
    S.mine = null;
    renderMine();
    loadStats();
    toast('Ulasan dihapus');
  }

  /* ---------------- pembesar bukti ---------------- */
  function openProof(id) {
    const r = S.rows.get(id);
    if (!r || !r.proof_path) return;
    const v = $('#pf-view');
    v.dataset.id = id;
    $('#pv-img').src = pubUrl(r.proof_path);
    $('#pv-cap').innerHTML = `<b>${nameHtml(r.name)}</b>${starsHtml(r.rating, 18)}${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<small>${esc(ago(r.created_at))}</small>`;
    v.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }
  function closeProof() {
    const v = $('#pf-view');
    if (v.classList.contains('hidden')) return;
    v.classList.add('hidden');
    $('#pv-img').removeAttribute('src');
    unlockIfIdle();
  }

  /* ---------------- tab Rating / Ulasan / Bukti ---------------- */
  function applySub(sub) {
    if (!SUBS[sub]) sub = 'rating';
    S.sub = sub;
    $$('.rv-tab').forEach((t) => { const on = t.dataset.sub === sub; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
    $$('.rv-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== sub));
    if (!$('#rv-view').classList.contains('hidden')) document.title = `AM Premify - ${SUB_TITLE[sub]}`;
    if (sub !== 'rating') { const F = S.feed[sub]; if (!F.loaded && !F.loading) loadFeed(sub, 'reset'); }
  }
  function syncFromPath() { applySub(SUB_BY_PATH[location.pathname] || 'rating'); }
  function setSub(sub) {
    const path = SUBS[sub] || '/rating';
    if (location.pathname !== path) history.pushState({ view: 'reviews' }, '', path);
    applySub(sub);
  }
  function go(sub) {
    const path = SUBS[sub] || '/rating';
    if (location.pathname !== path) history.pushState({ view: 'reviews' }, '', path);
    show('reviews', false);
  }
  function setFilter(n) {
    S.filter = n;
    $$('.rv-chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.f) === n));
    S.feed.ulasan.loaded = false;
    if (S.sub === 'ulasan') loadFeed('ulasan', 'reset');
  }

  /* ---------------- popup rating ---------------- */
  const starSvg = `<svg class="sv" viewBox="0 0 24 24" aria-hidden="true"><polygon points="${POLY}"/></svg>`;
  function paintStars() {
    $$('.rt-star').forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', v <= R.rating);
      b.classList.toggle('hov', R.hover > 0 && v <= R.hover);
      b.setAttribute('aria-checked', String(v === R.rating));
      b.tabIndex = v === (R.rating || 1) ? 0 : -1;
    });
    const shown = R.hover || R.rating;
    const lab = $('#rt-label');
    lab.dataset.r = String(shown);
    lab.textContent = shown ? LABELS[shown] : 'Ketuk bintang untuk menilai';
    $('#rt-send').disabled = !R.rating || R.busy;
  }
  function setRating(v, focus) {
    R.rating = v;
    paintStars();
    const b = $(`.rt-star[data-v="${v}"]`);
    if (b) {
      b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      if (focus) b.focus();
      if (v >= 4 && typeof FX !== 'undefined') { const r = b.getBoundingClientRect(); FX.burstAt(r.left + r.width / 2, r.top + r.height / 2, v === 5 ? 26 : 16, Math.PI * 2, 0, 6); }
    }
    setErr('');
  }
  function setErr(msg) { $('#rt-err').textContent = msg || ''; }
  function clearFile() {
    if (R.prevUrl) URL.revokeObjectURL(R.prevUrl);
    R.blob = null; R.prevUrl = '';
    $('#rt-file').value = '';
    $('#rt-prev').classList.add('hidden');
    $('#rt-prev').removeAttribute('src');
    $('#rt-drop').classList.remove('has');
    $('#rt-rm').classList.add('hidden');
  }

  function viaImg(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); };
      im.src = u;
    });
  }
  async function compress(file) {
    const src = window.createImageBitmap ? await createImageBitmap(file).catch(() => viaImg(file)) : await viaImg(file);
    const k = Math.min(1, 1280 / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
    c.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    let q = 0.86, blob = null;
    for (let i = 0; i < 4; i++) {
      blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= 1.6 * 1024 * 1024) break;
      q -= 0.15;
    }
    if (!blob || blob.size > 1.9 * 1024 * 1024) throw new Error('size');
    return blob;
  }
  async function pickFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return setErr('File harus berupa gambar (JPG, PNG, atau WEBP).');
    if (file.size > 15 * 1024 * 1024) return setErr('Ukuran gambar terlalu besar (maksimal 15 MB).');
    setErr('');
    try {
      const blob = await compress(file);
      clearFile();
      R.blob = blob;
      R.prevUrl = URL.createObjectURL(blob);
      const p = $('#rt-prev');
      p.src = R.prevUrl; p.classList.remove('hidden');
      $('#rt-drop').classList.add('has');
      $('#rt-drop b').textContent = 'Bukti siap diunggah';
      $('#rt-drop small').textContent = Math.round(blob.size / 1024) + ' KB \u00b7 ketuk untuk mengganti';
      $('#rt-rm').classList.remove('hidden');
    } catch {
      setErr('Gambar tidak bisa dibaca. Coba format JPG atau PNG.');
    }
  }

  function openRate(mode) {
    if (!client) return toast('Supabase belum dikonfigurasi', 'err');
    if (S.mine) { toast('Kamu sudah memberi rating. Hapus ulasanmu dulu jika ingin menulis ulang.'); go('rating'); return; }
    if (R.open) return;
    R.mode = mode === 'success' ? 'success' : 'menu';
    R.open = true; R.busy = false; R.rating = 0; R.hover = 0;
    clearFile();
    $('#rt-text').value = ''; $('#rt-cnt').textContent = '0/400';
    $('#rt-drop b').textContent = 'Unggah screenshot akun premium';
    $('#rt-drop small').textContent = 'JPG / PNG / WEBP, otomatis dikompres';
    setErr('');
    const ok = R.mode === 'success';
    $('#rt-k').textContent = ok ? 'AKUN BERHASIL JADI VIP' : 'BERI RATING';
    $('#rt-title').textContent = ok ? 'Bagaimana pengalamanmu?' : 'Nilai AM Premify';
    $('#rt-sub').textContent = ok
      ? 'Akunmu sudah premium! Beri rating dan tunjukkan buktinya supaya pengguna lain makin yakin. Popup ini hanya muncul sekali.'
      : 'Rating dan ulasanmu langsung tampil real-time untuk semua pengguna.';
    $('#rt-name').textContent = (typeof userName === 'function' && userName()) || 'Teman';
    $('#rt-form').classList.remove('hidden');
    $('#rt-done').classList.add('hidden');
    $('#rt-send span').textContent = 'Kirim Rating';
    paintStars();
    const pop = $('#rate-pop');
    pop.classList.remove('hidden', 'out');
    document.body.classList.add('no-scroll');
    if (ok) store.set('am_rate_prompted', Date.now());
    if (typeof FX !== 'undefined' && ok) FX.burstAt(innerWidth / 2, innerHeight * .3, 24, Math.PI * 2, 0, 8);
    setTimeout(() => { const f = $('.rt-star[tabindex="0"]'); if (f) f.focus({ preventScroll: true }); }, 60);
  }
  function closeRate(force) {
    const pop = $('#rate-pop');
    if (pop.classList.contains('hidden') || pop.classList.contains('out')) return;
    if (R.busy && !force) return;
    pop.classList.add('out');
    setTimeout(() => {
      pop.classList.add('hidden'); pop.classList.remove('out');
      R.open = false;
      clearFile();
      unlockIfIdle();
    }, (typeof REDUCED !== 'undefined' && REDUCED) ? 0 : 280);
  }

  async function submit() {
    if (R.busy) return;
    if (!R.rating) return setErr('Pilih rating bintang dulu.');
    R.busy = true; setErr('');
    const send = $('#rt-send');
    send.disabled = true; $('span', send).textContent = 'Mengirim...';
    let path = null;
    try {
      const uid = await ensureUser();
      await loadMine();
      if (S.mine) throw new Error('Kamu sudah memberi rating. Hapus ulasanmu dulu jika ingin menulis ulang.');
      if (R.blob) {
        const p = `${uid}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await client.storage.from(BUCKET).upload(p, R.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
        if (up.error) throw new Error('Gagal mengunggah gambar: ' + mapErr(up.error));
        path = p;
      }
      const name = (typeof userName === 'function' && userName()) || 'Teman';
      const comment = $('#rt-text').value.trim().slice(0, 400);
      const { data, error } = await client.from('reviews')
        .insert({ name, rating: R.rating, comment: comment || null, proof_path: path })
        .select(COLS).single();
      if (error) { if (path) client.storage.from(BUCKET).remove([path]); throw new Error(mapErr(error)); }
      S.mine = data; S.rows.set(data.id, data);
      store.set('am_rate_prompted', store.get('am_rate_prompted', 0) || Date.now());
      addRow(data, true);
      refreshCards();
      renderMine();
      loadStatsSoon();
      showDone(data);
    } catch (err) {
      setErr(err.message || 'Gagal mengirim, coba lagi.');
      R.busy = false;
      $('span', send).textContent = 'Kirim Rating';
      paintStars();
    }
  }
  function showDone(r) {
    R.busy = false;
    $('#rt-done-name').textContent = r.name;
    $('#rt-done-stars').innerHTML = starsHtml(r.rating, 28);
    $('#rt-form').classList.add('hidden');
    $('#rt-done').classList.remove('hidden');
    $('#rt-card').scrollTop = 0;
    if (typeof FX !== 'undefined') FX.confetti();
  }

  /* gating popup setelah sukses create (hanya sekali per perangkat) */
  function overlayBlocked() {
    return $('#welcome').classList.contains('open') || !$('#warn-modal').classList.contains('hidden')
      || !$('#sheet').classList.contains('hidden') || !$('#ch-pop').classList.contains('hidden') || !$('#cmd').classList.contains('hidden');
  }
  function openWhenFree(tries = 0) {
    if (S.mine || R.open) return;
    if (overlayBlocked() && tries < 20) return setTimeout(() => openWhenFree(tries + 1), 800);
    openRate('success');
  }
  let pending = false;
  window.addEventListener('am:activated', async () => {
    if (!client || pending || store.get('am_rate_prompted', 0)) return;
    pending = true;
    try {
      await loadSession();
      if (S.uid && !S.mine) await loadMine();
      if (S.mine || store.get('am_rate_prompted', 0)) return;
      setTimeout(() => openWhenFree(), 1800);
    } finally { setTimeout(() => (pending = false), 4000); }
  });

  /* nama ikut berubah jika diganti lewat menu */
  window.addEventListener('am:namechange', async () => {
    const name = (typeof userName === 'function' && userName()) || '';
    if (R.open) $('#rt-name').textContent = name || 'Teman';
    if (!client || !S.mine || !S.uid || !name || S.mine.name === name) return;
    const { data, error } = await client.from('reviews').update({ name }).eq('id', S.mine.id).select(COLS).maybeSingle();
    if (!error && data) { updateRow(data); toast('Nama di ulasanmu ikut diperbarui'); }
  });

  /* ---------------- real-time ---------------- */
  function setLive(kind, text) {
    const b = $('#rv-live');
    b.className = 'live-badge ' + kind;
    $('b', b).textContent = text;
  }
  function subscribe() {
    client.channel('reviews-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, (p) => {
        if (p.eventType === 'INSERT') addRow(p.new, true);
        else if (p.eventType === 'UPDATE') updateRow(p.new);
        else if (p.eventType === 'DELETE') removeRow(p.old && p.old.id);
        loadStatsSoon();
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLive('on', 'LIVE');
        else if (status === 'CONNECTING' || status === 'JOINING') setLive('wait', 'MENYAMBUNG');
        else setLive('off', 'TERPUTUS');
      });
  }

  /* ---------------- event ---------------- */
  function bind() {
    $$('.rv-tab').forEach((t) => t.addEventListener('click', () => setSub(t.dataset.sub)));
    $('#rv-chips').addEventListener('click', (e) => { const c = e.target.closest('.rv-chip'); if (c) setFilter(Number(c.dataset.f)); });
    $('#rv-dist').addEventListener('click', (e) => {
      const r = e.target.closest('.rv-row');
      if (!r) return;
      setFilter(Number(r.dataset.star));
      setSub('ulasan');
    });
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!t.closest) return;
      const proof = t.closest('[data-view-proof]');
      if (proof) return openProof(proof.dataset.viewProof);
      const d = t.closest('[data-del-review]');
      if (d) return del(d.dataset.delReview);
      const act = t.closest('#rv-mine [data-act]');
      if (act) return act.dataset.act === 'rate' ? openRate('menu') : S.mine && del(S.mine.id);
      const more = t.closest('[data-more]');
      if (more) return loadFeed(more.dataset.more, 'more');
    });

    // popup
    $$('.rt-star').forEach((b) => (b.innerHTML = starSvg));
    const grp = $('#rt-stars');
    grp.addEventListener('click', (e) => { const b = e.target.closest('.rt-star'); if (b) setRating(Number(b.dataset.v)); });
    grp.addEventListener('pointerover', (e) => { const b = e.target.closest('.rt-star'); if (b && e.pointerType === 'mouse') { R.hover = Number(b.dataset.v); paintStars(); } });
    grp.addEventListener('pointerleave', () => { if (R.hover) { R.hover = 0; paintStars(); } });
    grp.addEventListener('keydown', (e) => {
      const up = e.key === 'ArrowRight' || e.key === 'ArrowUp', down = e.key === 'ArrowLeft' || e.key === 'ArrowDown';
      if (!up && !down) return;
      e.preventDefault();
      setRating(Math.max(1, Math.min(5, (R.rating || (up ? 0 : 2)) + (up ? 1 : -1))), true);
    });
    $('#rt-text').addEventListener('input', (e) => ($('#rt-cnt').textContent = `${e.target.value.length}/400`));
    $('#rt-drop').addEventListener('click', () => $('#rt-file').click());
    $('#rt-file').addEventListener('change', (e) => pickFile(e.target.files && e.target.files[0]));
    $('#rt-rm').addEventListener('click', () => {
      clearFile();
      $('#rt-drop b').textContent = 'Unggah screenshot akun premium';
      $('#rt-drop small').textContent = 'JPG / PNG / WEBP, otomatis dikompres';
    });
    $('#rt-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
    $$('[data-rt-close]').forEach((b) => b.addEventListener('click', () => closeRate()));
    $('#rt-see').addEventListener('click', () => { closeRate(true); setTimeout(() => go('ulasan'), 300); });
    $$('[data-pv-close]').forEach((b) => b.addEventListener('click', closeProof));
    $('#pv-img').addEventListener('error', () => { if ($('#pv-img').getAttribute('src')) toast('Gambar bukti gagal dimuat', 'err'); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#pf-view').classList.contains('hidden')) closeProof();
      else if (!$('#rate-pop').classList.contains('hidden')) closeRate();
    });

    window.addEventListener('am:view', (e) => {
      if (!e.detail || e.detail.view !== 'reviews') return;
      syncFromPath();
      loadStats();
      if (S.sub === 'rating') loadMine();
      else { const F = S.feed[S.sub]; if (F.loaded && !F.loading) loadFeed(S.sub, 'silent'); }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadStats(); });
    setInterval(loadStats, 60000);
  }

  /* ---------------- init ---------------- */
  async function init() {
    buildDist();
    bind();
    renderStats();
    renderMine();
    syncFromPath();
    if (!client) { setLive('off', 'OFFLINE'); return; }
    client.auth.onAuthStateChange((_e, session) => { S.uid = session ? session.user.id : null; });
    await loadSession();
    await Promise.all([loadStats(), loadMine()]);
    refreshCards();
    subscribe();
  }

  window.Reviews = { go, openRate: () => openRate('menu') };
  init();
})();
