// AM Premify v4.5 - Room publik (semua pengguna saling ngobrol)
// Memakai helper global dari app.js: $, $$, esc, toast, userName, VBADGE, UI ; serta Device (device.js)
(function () {
  'use strict';

  const view = $('#room-view');
  if (!view || !window.Device) return;

  const body = $('#rm-body'), input = $('#rm-in'), sendBtn = $('#rm-send'), errBox = $('#rm-err');
  const newPill = $('#rm-new'), retoBar = $('#rm-reto'), live = $('#rm-live');
  const AVATAR = ['#ffd23f', '#ff8fab', '#7cc6fe', '#7be495', '#ff9f5a', '#c3a6ff'];
  const MAX = 300;

  const S = {
    active: false, loaded: false, lastId: 0, ids: new Set(), lastDay: '', timer: 0, fails: 0,
    busy: false, replyTo: null, offline: false, online: 0
  };

  /* ---------- util ---------- */
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
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
  const ic = (id, cls = 'ic sm') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;

  async function api(url, opts) {
    const r = await Device.api(url, opts);
    let d = {};
    try { d = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data: d };
  }
  const post = (url, b) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });

  function setLive(kind, text) {
    live.className = 'live-badge ' + kind;
    $('b', live).textContent = text;
  }
  function showError(t) { errBox.textContent = t || ''; }

  /* ---------- render ---------- */
  function emptyState() {
    if ($('.chat-empty', body) || S.ids.size) return;
    const e = mk('div', 'chat-empty');
    e.innerHTML = '<span class="ce-ic"><svg class="ic"><use href="#i-users"/></svg></span><b>Room masih sepi</b><span>Sapa yang pertama! Perkenalkan dirimu dan mulai ngobrol dengan pengguna lain.</span>';
    body.appendChild(e);
  }

  function messageEl(m, temp) {
    const name = m.name || 'Pengguna';
    const ch = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    const el = mk('div', 'rm' + (m.mine ? ' me' : '') + (temp ? ' pending' : ''));
    if (m.id) el.dataset.id = m.id;
    const quote = m.reply_name ? `<div class="rm-q"><b>${esc(m.reply_name)}</b><span>${esc(m.reply_body || '')}</span></div>` : '';
    const acts = temp ? '' : `<div class="rm-act"><button type="button" data-rm-reply="${esc(m.id)}" data-name="${esc(name)}" data-text="${esc(m.body)}">${ic('reply')}Balas</button>${m.can_del ? `<button type="button" class="del" data-rm-del="${esc(m.id)}">${ic('trash')}Hapus</button>` : ''}</div>`;
    el.innerHTML = `<span class="rm-av" style="--c:${AVATAR[hash(name) % AVATAR.length]}" aria-hidden="true">${esc(ch)}</span>
      <div class="rm-bub">
        <div class="rm-top"><b class="rm-name">${esc(name)}${m.verified ? ' ' + VBADGE : ''}</b><time class="rm-t">${temp ? 'Mengirim…' : esc(clock(m.created_at))}</time></div>
        ${quote}
        <div class="rm-b"></div>
        ${acts}
      </div>`;
    $('.rm-b', el).textContent = m.body; // textContent: aman dari XSS
    return el;
  }

  function addMessage(m) {
    if (S.ids.has(m.id)) return null;
    const empty = $('.chat-empty', body);
    if (empty) empty.remove();
    const day = dayLabel(m.created_at);
    if (day !== S.lastDay) { body.appendChild(mk('div', 'chat-day', day)); S.lastDay = day; }
    const el = messageEl(m, false);
    body.appendChild(el);
    S.ids.add(m.id);
    if (m.id > S.lastId) S.lastId = m.id;
    return el;
  }

  function apply(list, deleted) {
    (deleted || []).forEach((id) => {
      const el = $(`.rm[data-id="${id}"]`, body);
      if (el) { el.remove(); S.ids.delete(id); }
    });
    if (!list || !list.length) return;
    const stick = nearBottom();
    let added = 0, others = 0;
    list.forEach((m) => { if (addMessage(m)) { added++; if (!m.mine) others++; } });
    if (added) {
      if (stick || !S.loaded) toBottom(S.loaded);
      else if (others) newPill.classList.remove('hidden');
    }
  }

  /* ---------- jaringan ---------- */
  async function pull() {
    const r = await api('/api/room?after=' + S.lastId);
    if (!r.ok) {
      if (r.status === 503) { S.offline = true; setLive('off', 'BELUM AKTIF'); showError(r.data.error || 'Room butuh Supabase + supabase.sql v4.5.'); return; }
      throw new Error('pull ' + r.status);
    }
    S.offline = false;
    apply(r.data.messages, r.data.deleted);
    if (!S.loaded) { S.loaded = true; emptyState(); }
    S.online = Math.max(1, r.data.online || 0);
    $('#rm-online').textContent = S.online;
    setLive('on', 'LIVE');
  }

  function schedule(ms) { clearTimeout(S.timer); S.timer = setTimeout(tick, ms); }
  async function tick() {
    if (!S.active) return;
    if (document.hidden) return schedule(8000);
    try { await pull(); S.fails = 0; }
    catch { S.fails = Math.min(S.fails + 1, 6); setLive('wait', 'MENYAMBUNG'); }
    if (S.offline) return schedule(60000);
    schedule(2500 * (1 + S.fails));
  }
  function start() {
    if (S.active) return;
    S.active = true;
    setLive('wait', 'MENYAMBUNG');
    schedule(10);
  }
  function stop() { S.active = false; clearTimeout(S.timer); }

  /* ---------- kirim ---------- */
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 116) + 'px'; }
  function sync() { sendBtn.disabled = !input.value.trim() || S.busy; }
  function paintReto() {
    retoBar.classList.toggle('hidden', !S.replyTo);
    if (S.replyTo) $('span', retoBar).textContent = `Membalas ${S.replyTo.name}: ${S.replyTo.text}`;
  }

  async function send() {
    const text = input.value.trim();
    if (!text || S.busy) return;
    const name = userName();
    if (!name) { toast('Isi namamu dulu lewat menu profil', 'err'); return; }
    showError('');
    S.busy = true; sendBtn.disabled = true;
    const r = await post('/api/room/send', { body: text, name, reply_id: S.replyTo ? S.replyTo.id : '' });
    S.busy = false;
    if (!r.ok) {
      showError(r.status === 503 ? 'Room butuh Supabase + supabase.sql v4.5.' : (r.data.error || 'Gagal mengirim pesan.'));
      sync();
      return;
    }
    input.value = ''; grow();
    S.replyTo = null; paintReto();
    const el = addMessage(r.data.message);
    toBottom(true);
    if (el) el.classList.add('fresh');
    sync();
  }

  async function del(id) {
    const ok = await UI.confirm({
      tone: 'danger', icon: 'trash', title: 'Hapus pesan ini?',
      message: 'Pesan akan hilang dari room untuk semua orang.',
      confirmText: 'Ya, hapus', cancelText: 'Batal', busyText: 'Menghapus…',
      onConfirm: async () => {
        const r = await post('/api/room/delete', { id });
        if (!r.ok) throw new Error(r.data.error || 'Gagal menghapus pesan.');
      }
    });
    if (!ok) return;
    const el = $(`.rm[data-id="${id}"]`, body);
    if (el) el.remove();
    S.ids.delete(Number(id));
    toast('Pesan dihapus');
  }

  /* ---------- event ---------- */
  $('#rm-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  input.addEventListener('input', () => { grow(); sync(); });
  input.addEventListener('keydown', (e) => {
    // Desktop: Enter kirim, Shift+Enter baris baru. HP: Enter = baris baru, kirim lewat tombol.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); send(); }
  });
  $('#rm-reto-x').addEventListener('click', () => { S.replyTo = null; paintReto(); });
  newPill.addEventListener('click', () => toBottom(true));
  body.addEventListener('scroll', () => { if (nearBottom()) newPill.classList.add('hidden'); }, { passive: true });
  body.addEventListener('click', (e) => {
    const rp = e.target.closest('[data-rm-reply]');
    if (rp) {
      S.replyTo = { id: rp.dataset.rmReply, name: rp.dataset.name, text: String(rp.dataset.text || '').replace(/\s+/g, ' ').slice(0, 50) };
      paintReto();
      input.focus();
      return;
    }
    const dl = e.target.closest('[data-rm-del]');
    if (dl) del(dl.dataset.rmDel);
  });

  window.addEventListener('am:view', (e) => {
    const on = !!(e.detail && e.detail.view === 'room');
    if (on) { start(); if (S.loaded) toBottom(false); } else stop();
  });
  document.addEventListener('visibilitychange', () => { if (S.active && !document.hidden) schedule(200); });

  sync();
  if (location.pathname === '/room') start(); // dibuka langsung lewat alamat /room
})();
