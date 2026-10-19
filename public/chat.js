// AM Premify v4.3 - Chat pengguna <-> admin
// Memakai helper global dari app.js: $, $$, toast, userName, show ; serta Device (device.js)
(function () {
  'use strict';

  const root = $('#chat');
  if (!root) return;
  const panel = $('.chat-panel', root);
  const body = $('#chat-body');
  const input = $('#chat-in');
  const sendBtn = $('#chat-send');
  const errBox = $('#chat-err');
  const dot = $('#chat-dot');
  const openBtn = $('#chat-open');
  const status = $('#chat-status');
  const banner = $('#chat-ban');
  const newPill = $('#chat-new');
  const cnt = $('#chat-cnt');

  const S = {
    open: false, lastId: 0, loaded: false, unread: 0, blocked: false, reason: '',
    ids: new Set(), lastDay: '', pending: 0, fails: 0, timer: 0, busy: false, offline: false, prevUnread: -1
  };
  const MAX = 600;

  /* ---------- util ---------- */
  const clock = (iso) => new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(':', '.');
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date();
    const key = (x) => x.getFullYear() * 400 + x.getMonth() * 31 + x.getDate();
    if (key(d) === key(t)) return 'Hari ini';
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (key(d) === key(y)) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
  }
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const nearBottom = () => body.scrollHeight - body.scrollTop - body.clientHeight < 90;
  const toBottom = (smooth) => { body.style.scrollBehavior = smooth ? 'smooth' : 'auto'; body.scrollTop = body.scrollHeight; newPill.classList.add('hidden'); };

  /* ---------- badge merah ---------- */
  function setUnread(n) {
    n = Math.max(0, Number(n) || 0);
    S.unread = n;
    dot.textContent = n > 9 ? '9+' : String(n);
    dot.classList.toggle('hidden', n === 0);
    openBtn.setAttribute('aria-label', n ? `Chat admin, ${n} pesan baru` : 'Chat admin');
    if (S.prevUnread >= 0 && n > S.prevUnread && !S.open) {
      openBtn.classList.remove('ring'); void openBtn.offsetWidth; openBtn.classList.add('ring');
      toast('Admin membalas chat kamu');
    }
    S.prevUnread = n;
  }

  function setBlocked(b, reason) {
    S.blocked = !!b; S.reason = reason || '';
    banner.classList.toggle('hidden', !S.blocked);
    $('#chat-ban-txt').textContent = S.reason ? `Alasan: ${S.reason}. Jelaskan situasimu di sini agar admin bisa membantu.` : 'Kamu masih bisa chat admin di sini untuk menanyakan atau meminta pengaktifan kembali.';
    if (window.Device) Device.setBlocked(S.blocked, S.reason);
  }

  function setStatus(on, text) {
    status.classList.toggle('on', on);
    $('span', status).textContent = text;
  }

  /* ---------- render pesan ---------- */
  function emptyState() {
    if ($('.chat-empty', body) || S.ids.size) return;
    const e = mk('div', 'chat-empty');
    e.innerHTML = '<span class="ce-ic"><svg class="ic"><use href="#i-msg"/></svg></span><b>Belum ada pesan</b><span>Tanyakan kendala aktivasi atau hal lain ke admin. Balasan akan muncul di sini dan di tombol chat bertanda merah.</span>';
    body.appendChild(e);
  }

  function addMessage(m, opts) {
    opts = opts || {};
    if (!opts.temp && S.ids.has(m.id)) return null;
    const empty = $('.chat-empty', body);
    if (empty) empty.remove();
    const day = dayLabel(m.created_at);
    if (day !== S.lastDay) { body.appendChild(mk('div', 'chat-day', day)); S.lastDay = day; }
    const me = m.sender === 'user';
    const el = mk('div', 'cm ' + (me ? 'me' : 'ad') + (opts.temp ? ' pending' : ''));
    if (!me) { const t = mk('span', 'cm-tag'); t.innerHTML = '<svg class="ic"><use href="#i-check"/></svg>ADMIN'; el.appendChild(t); }
    el.appendChild(mk('div', 'cm-b', m.body)); // textContent: aman dari XSS
    el.appendChild(mk('span', 'cm-t', clock(m.created_at)));
    if (!opts.temp) { el.dataset.id = m.id; S.ids.add(m.id); if (m.id > S.lastId) S.lastId = m.id; }
    body.appendChild(el);
    return el;
  }

  function applyMessages(list) {
    if (!list || !list.length) return 0;
    const stick = nearBottom();
    let added = 0, fromAdmin = 0;
    list.forEach((m) => { if (addMessage(m)) { added++; if (m.sender === 'admin') fromAdmin++; } });
    if (added) {
      if (stick || !S.loaded) toBottom(S.loaded);
      else if (fromAdmin) newPill.classList.remove('hidden');
    }
    return fromAdmin;
  }

  /* ---------- jaringan ---------- */
  async function getJson(url, opts) {
    const r = await Device.api(url, opts);
    let d = {};
    try { d = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data: d };
  }

  async function markRead() {
    if (!S.unread) return;
    const r = await getJson('/api/chat/read', { method: 'POST' }).catch(() => null);
    if (r && r.ok) { S.prevUnread = 0; setUnread(0); }
  }

  async function pull() {
    const r = await getJson('/api/chat?after=' + S.lastId);
    if (!r.ok) {
      if (r.status === 503) { S.offline = true; setStatus(false, 'Belum aktif'); showError(r.data.error || 'Chat belum aktif di server.'); return; }
      throw new Error('pull ' + r.status);
    }
    S.offline = false;
    const d = r.data;
    setBlocked(d.blocked, d.reason);
    const fromAdmin = applyMessages(d.messages);
    if (!S.loaded) { S.loaded = true; emptyState(); }
    setStatus(true, 'Terhubung');
    if (S.open && (d.unread || fromAdmin)) { S.prevUnread = d.unread; setUnread(d.unread); markRead(); }
    else setUnread(d.unread);
  }

  async function peek() {
    const r = await getJson('/api/chat/unread');
    if (!r.ok) { if (r.status === 503) S.offline = true; return; }
    S.offline = false;
    setUnread(r.data.unread);
    setBlocked(r.data.blocked, r.data.reason);
  }

  function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(tick, ms); }
  async function tick() {
    if (document.hidden) return schedule(S.open ? 4000 : 12000);
    try {
      if (S.open) await pull(); else await peek();
      S.fails = 0;
    } catch { S.fails = Math.min(S.fails + 1, 6); if (S.open) setStatus(false, 'Menyambung ulang…'); }
    if (S.offline) return schedule(60000);
    schedule((S.open ? 2500 : 9000) * (1 + S.fails));
  }

  /* ---------- kirim ---------- */
  function showError(t) { errBox.textContent = t || ''; }

  async function send(retryEl) {
    const text = retryEl ? retryEl._text : input.value.trim();
    if (!text || S.busy) return;
    showError('');
    if (!retryEl) { input.value = ''; grow(); updateCounter(); }
    const tmp = retryEl || addMessage({ sender: 'user', body: text, created_at: new Date().toISOString() }, { temp: true });
    tmp._text = text;
    tmp.classList.remove('fail'); tmp.classList.add('pending');
    const meta = $('.cm-t', tmp);
    meta.textContent = 'Mengirim…';
    toBottom(true);
    S.busy = true; sendBtn.disabled = true;
    try {
      const r = await getJson('/api/chat/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text, name: userName() }) });
      if (!r.ok) throw new Error(r.data.error || 'Gagal mengirim pesan.');
      const m = r.data.message;
      if (S.ids.has(m.id)) tmp.remove(); // sudah terambil oleh polling
      else { tmp.classList.remove('pending'); tmp.dataset.id = m.id; S.ids.add(m.id); if (m.id > S.lastId) S.lastId = m.id; meta.textContent = clock(m.created_at); }
      delete tmp._text;
      pull().catch(() => {});
    } catch (e) {
      tmp.classList.remove('pending'); tmp.classList.add('fail');
      meta.textContent = '';
      meta.append(document.createTextNode('Gagal terkirim · '));
      const b = mk('button', 'cm-retry', 'Coba lagi'); b.type = 'button';
      b.addEventListener('click', () => send(tmp));
      meta.appendChild(b);
      showError(e.message === 'Failed to fetch' ? 'Tidak ada koneksi ke server.' : e.message);
    } finally { S.busy = false; updateCounter(); }
  }

  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 116) + 'px'; }
  function updateCounter() {
    const n = input.value.length;
    cnt.textContent = `${n}/${MAX}`;
    cnt.classList.toggle('hidden', n < MAX - 120);
    sendBtn.disabled = !input.value.trim() || S.busy;
  }

  /* ---------- buka / tutup ---------- */
  let lastFocus = null;
  async function open() {
    if (S.open) return;
    S.open = true;
    lastFocus = document.activeElement;
    root.classList.remove('hidden');
    void root.offsetWidth;
    root.classList.add('open');
    document.body.classList.add('no-scroll');
    openBtn.setAttribute('aria-expanded', 'true');
    if (!S.loaded) setStatus(false, 'Memuat…');
    try { await pull(); } catch { setStatus(false, 'Menyambung ulang…'); }
    toBottom(false);
    markRead();
    schedule(2500);
    if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
  }
  function close() {
    if (!S.open) return;
    S.open = false;
    root.classList.remove('open');
    document.body.classList.remove('no-scroll');
    openBtn.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!S.open) root.classList.add('hidden'); }, 360);
    try { if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); } catch {}
    schedule(9000);
  }

  openBtn.addEventListener('click', () => (S.open ? close() : open()));
  $$('[data-chat-close]', root).forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open && !document.querySelector('.uic')) close(); });
  newPill.addEventListener('click', () => toBottom(true));
  body.addEventListener('scroll', () => { if (nearBottom()) newPill.classList.add('hidden'); }, { passive: true });

  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('input', () => { grow(); updateCounter(); });
  input.addEventListener('keydown', (e) => {
    // Desktop: Enter kirim, Shift+Enter baris baru. HP: Enter = baris baru, kirim lewat tombol.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); }
  });

  // Papan ketik HP: tinggi panel mengikuti area yang terlihat
  if (window.visualViewport) {
    const fit = () => { panel.style.setProperty('--vvh', visualViewport.height + 'px'); if (S.open && nearBottom()) toBottom(false); };
    visualViewport.addEventListener('resize', fit);
    visualViewport.addEventListener('scroll', fit);
  }

  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
  window.addEventListener('am:open-chat', open);
  window.addEventListener('am:blocked', (e) => { if (e.detail && e.detail.blocked !== S.blocked) setBlocked(e.detail.blocked, e.detail.reason); });

  window.Chat = { open, close, isOpen: () => S.open };

  /* ---------- mulai ---------- */
  updateCounter();
  (async () => {
    // Daftarkan perangkat lebih dulu (cookie + token), lalu mulai memantau pesan admin
    if (window.Device) { await Device.ready; const d = await Device.sync(userName()); if (d) { setBlocked(d.blocked, d.reason); S.prevUnread = d.unread || 0; setUnread(d.unread || 0); } }
    schedule(S.open ? 300 : 6000);
  })();
  window.addEventListener('am:namechange', () => { if (window.Device) Device.sync(userName()); });
})();
