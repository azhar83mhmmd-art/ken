// AM Premify v4.5 - Balasan & like di ulasan
// Setiap kartu ulasan punya penampung <div class="rc-soc" data-soc="ID-ULASAN">. Modul ini memantau
// penampung itu (MutationObserver), jadi tetap benar walau kartu digambar ulang oleh reviews.js.
// Memakai helper global dari app.js: $, $$, esc, toast, nameHtml, userName, VBADGE, UI ; serta Device (device.js)
(function () {
  'use strict';

  const list = $('#rv-list');
  if (!list || !window.Device) return;

  const S = {
    stats: new Map(),     // id ulasan -> { replies, likes, liked }
    threads: new Map(),   // id ulasan -> { items, loaded, seen:Set, replyTo, draft, sending, busy, err }
    open: new Set(),      // id ulasan yang balasannya sedang terbuka
    pending: new Set(),
    offline: false
  };
  const AVATAR = ['#ffd23f', '#ff8fab', '#7cc6fe', '#7be495', '#ff9f5a', '#c3a6ff'];
  const ic = (id, cls = 'ic') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0; return Math.abs(h); };
  const q = (id) => CSS.escape(String(id));

  function ago(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' mnt lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' hari lalu';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async function api(url, opts) {
    const r = await Device.api(url, opts);
    let d = {};
    try { d = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data: d };
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const thread = (id) => {
    let t = S.threads.get(id);
    if (!t) { t = { items: [], loaded: false, seen: new Set(), replyTo: null, draft: '', sending: false, busy: false, err: '' }; S.threads.set(id, t); }
    return t;
  };
  const phsOf = (id) => $$(`.rc-soc[data-soc="${q(id)}"]`);

  /* ---------------- bar aksi (like + balasan) ---------------- */
  function mount(ph) {
    if (ph.dataset.ready) return;
    ph.dataset.ready = '1';
    ph.innerHTML = `<div class="soc-bar">
      <button type="button" class="soc-btn soc-like" data-soc-like aria-pressed="false" aria-label="Suka ulasan ini">${ic('heart')}<b>0</b></button>
      <button type="button" class="soc-btn soc-rep" data-soc-toggle aria-expanded="false">${ic('reply')}<span>Balas</span>${ic('down', 'ic sm soc-chev')}</button>
    </div>
    <div class="soc-thread hidden"></div>`;
    paintBar(ph);
    if (S.open.has(ph.dataset.soc)) renderThread(ph);
  }

  function paintBar(ph) {
    const id = ph.dataset.soc;
    const st = S.stats.get(id) || { replies: 0, likes: 0, liked: false };
    const like = $('.soc-like', ph), rep = $('.soc-rep', ph);
    if (!like || !rep) return;
    like.classList.toggle('on', !!st.liked);
    like.setAttribute('aria-pressed', String(!!st.liked));
    $('b', like).textContent = st.likes;
    const open = S.open.has(id);
    rep.classList.toggle('open', open);
    rep.setAttribute('aria-expanded', String(open));
    $('span', rep).textContent = st.replies ? `${st.replies} balasan` : 'Balas';
  }
  const paintAll = () => $$('.rc-soc').forEach(paintBar);

  /* ---------------- statistik (jumlah like & balasan) ---------------- */
  async function fetchStats(ids) {
    if (!ids.length) return;
    const r = await api('/api/social/stats?ids=' + ids.join(','));
    if (!r.ok) { if (r.status === 503) S.offline = true; return; }
    S.offline = false;
    Object.entries(r.data.stats || {}).forEach(([id, s]) => {
      const cur = S.stats.get(id);
      // jangan menimpa hitungan balasan dari thread yang sedang terbuka dengan data yang lebih lama
      S.stats.set(id, Object.assign({}, s, cur && cur.fresh && Date.now() - cur.fresh < 3000 ? cur : {}));
    });
    paintAll();
  }
  let ft = 0;
  const scheduleFetch = () => { clearTimeout(ft); ft = setTimeout(flush, 150); };
  async function flush() {
    const ids = [...S.pending].slice(0, 40);
    ids.forEach((i) => S.pending.delete(i));
    await fetchStats(ids);
    if (S.pending.size) scheduleFetch();
  }
  function register(ph) {
    mount(ph);
    if (!S.stats.has(ph.dataset.soc)) { S.pending.add(ph.dataset.soc); scheduleFetch(); }
  }
  new MutationObserver((muts) => {
    muts.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches('.rc-soc')) register(n);
      if (n.querySelectorAll) n.querySelectorAll('.rc-soc').forEach(register);
    }));
  }).observe(list, { childList: true, subtree: true });
  $$('.rc-soc').forEach(register);

  /* ---------------- thread balasan ---------------- */
  function renderThread(ph) {
    const id = ph.dataset.soc, T = thread(id), box = $('.soc-thread', ph);
    box.classList.remove('hidden');
    if (!box.dataset.ready) {
      box.dataset.ready = '1';
      box.innerHTML = `<div class="soc-list" aria-live="polite"></div>
        <div class="soc-reto hidden"><span></span><button type="button" data-rp-cancel aria-label="Batal membalas">${ic('x', 'ic sm')}</button></div>
        <form class="soc-form" autocomplete="off">
          <textarea class="soc-in" rows="1" maxlength="400" placeholder="Tulis balasan…" aria-label="Tulis balasan"></textarea>
          <button class="soc-send" type="submit" aria-label="Kirim balasan" disabled>${ic('send')}</button>
        </form>
        <p class="soc-err" role="alert"></p>`;
      const inp = $('.soc-in', box);
      inp.value = T.draft;
      const sync = () => {
        T.draft = inp.value;
        inp.style.height = 'auto'; inp.style.height = Math.min(inp.scrollHeight, 110) + 'px';
        $('.soc-send', box).disabled = !inp.value.trim() || T.sending;
      };
      inp.addEventListener('input', sync);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) { e.preventDefault(); $('.soc-form', box).requestSubmit(); }
      });
      $('.soc-form', box).addEventListener('submit', (e) => { e.preventDefault(); sendReply(id); });
      sync();
      paintReto(ph);
    }
    fillList(ph);
  }

  function itemHtml(it, isNew) {
    const name = it.name || 'Pengguna';
    const ch = (name.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    const badge = it.verified ? ' ' + VBADGE : '';
    return `<div class="rp${it.mine ? ' mine' : ''}${isNew ? ' new' : ''}" data-rp="${esc(it.id)}">
      <span class="rp-av" style="--c:${AVATAR[hash(name) % AVATAR.length]}" aria-hidden="true">${esc(ch)}</span>
      <div class="rp-main">
        <div class="rp-top"><b class="rp-name">${esc(name)}${badge}</b>${it.mine ? '<span class="rc-me">KAMU</span>' : ''}<time datetime="${esc(it.created_at)}">${esc(ago(it.created_at))}</time></div>
        <p class="rp-txt">${it.to_name ? `<span class="rp-to">@${esc(it.to_name)}</span> ` : ''}${esc(it.body)}</p>
        <div class="rp-act">
          <button type="button" class="soc-btn sm${it.liked ? ' on' : ''}" data-rp-like="${esc(it.id)}" aria-pressed="${!!it.liked}" aria-label="Suka balasan">${ic('heart')}<b>${it.likes}</b></button>
          <button type="button" class="soc-btn sm" data-rp-reply="${esc(it.id)}" data-name="${esc(name)}">${ic('reply')}<span>Balas</span></button>
          ${it.can_del ? `<button type="button" class="soc-btn sm del" data-rp-del="${esc(it.id)}" aria-label="Hapus balasan">${ic('trash')}</button>` : ''}
        </div>
      </div>
    </div>`;
  }

  function fillList(ph) {
    const id = ph.dataset.soc, T = thread(id), box = $('.soc-list', ph);
    if (!box) return;
    if (!T.loaded) { box.innerHTML = '<div class="soc-empty">Memuat balasan…</div>'; return; }
    if (!T.items.length) { box.innerHTML = '<div class="soc-empty">Belum ada balasan. Jadilah yang pertama membalas!</div>'; return; }
    box.innerHTML = T.items.map((it) => itemHtml(it, !T.seen.has(it.id))).join('');
    T.items.forEach((it) => T.seen.add(it.id));
  }
  function paintReto(ph) {
    const T = thread(ph.dataset.soc), bar = $('.soc-reto', ph);
    if (!bar) return;
    bar.classList.toggle('hidden', !T.replyTo);
    if (T.replyTo) $('span', bar).textContent = 'Membalas ' + T.replyTo.name;
  }

  async function loadThread(id) {
    const T = thread(id);
    if (T.busy) return;
    T.busy = true;
    const r = await api('/api/social/replies?review=' + id);
    T.busy = false;
    if (!r.ok) {
      phsOf(id).forEach((ph) => { const e = $('.soc-list', ph); if (e && !T.loaded) e.innerHTML = `<div class="soc-empty">${esc(r.data.error || 'Gagal memuat balasan.')}</div>`; });
      return;
    }
    T.items = r.data.replies || [];
    T.loaded = true;
    const st = S.stats.get(id) || { replies: 0, likes: 0, liked: false };
    st.replies = T.items.length; st.fresh = Date.now();
    S.stats.set(id, st);
    phsOf(id).forEach((ph) => { paintBar(ph); if (S.open.has(id)) fillList(ph); });
  }

  function toggleThread(ph) {
    const id = ph.dataset.soc;
    if (S.open.has(id)) {
      S.open.delete(id);
      $('.soc-thread', ph).classList.add('hidden');
      paintBar(ph);
      return;
    }
    S.open.add(id);
    paintBar(ph);
    renderThread(ph);
    loadThread(id);
    const inp = $('.soc-in', ph);
    if (inp && matchMedia('(pointer: fine)').matches) setTimeout(() => inp.focus({ preventScroll: true }), 60);
  }

  async function sendReply(id) {
    const T = thread(id), ph = phsOf(id)[0];
    if (!ph) return;
    const box = $('.soc-thread', ph), inp = $('.soc-in', box), btn = $('.soc-send', box), err = $('.soc-err', box);
    const name = userName();
    if (!name) { toast('Isi namamu dulu lewat menu profil', 'err'); return; }
    const text = inp.value.trim();
    if (!text || T.sending) return;
    T.sending = true; btn.disabled = true; err.textContent = '';
    const r = await post('/api/social/reply', { review: id, body: text, to_name: T.replyTo ? T.replyTo.name : '', name });
    T.sending = false;
    if (!r.ok) {
      err.textContent = r.status === 503 ? 'Balasan butuh Supabase + supabase.sql v4.5.' : (r.data.error || 'Gagal mengirim balasan.');
      btn.disabled = !inp.value.trim();
      return;
    }
    inp.value = ''; T.draft = ''; T.replyTo = null;
    inp.style.height = 'auto';
    if (!T.items.some((x) => x.id === r.data.reply.id)) T.items.push(r.data.reply);
    const st = S.stats.get(id) || { replies: 0, likes: 0, liked: false };
    st.replies = T.items.length; st.fresh = Date.now();
    S.stats.set(id, st);
    phsOf(id).forEach((p) => { paintBar(p); paintReto(p); if (S.open.has(id)) fillList(p); });
    const last = $$('.rp', ph).pop();
    if (last) last.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ---------------- like ---------------- */
  async function likeReview(ph) {
    const id = ph.dataset.soc;
    const st = S.stats.get(id) || { replies: 0, likes: 0, liked: false };
    const prev = { liked: st.liked, likes: st.likes };
    st.liked = !st.liked; st.likes = Math.max(0, st.likes + (st.liked ? 1 : -1));
    S.stats.set(id, st); paintAll();
    const btn = $('.soc-like', ph);
    if (btn && st.liked) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    const r = await post('/api/social/like', { kind: 'r', id });
    if (!r.ok) {
      st.liked = prev.liked; st.likes = prev.likes; paintAll();
      toast(r.data.error || 'Gagal menyimpan like', 'err');
      return;
    }
    st.liked = !!r.data.liked; st.likes = r.data.count; st.fresh = Date.now();
    paintAll();
  }

  async function likeReply(rid, reviewId, btn) {
    const T = thread(reviewId);
    const it = T.items.find((x) => String(x.id) === String(rid));
    if (!it) return;
    const prev = { liked: it.liked, likes: it.likes };
    it.liked = !it.liked; it.likes = Math.max(0, it.likes + (it.liked ? 1 : -1));
    const repaint = () => phsOf(reviewId).forEach((p) => { const b = $(`[data-rp-like="${q(rid)}"]`, p); if (b) { b.classList.toggle('on', it.liked); b.setAttribute('aria-pressed', String(it.liked)); $('b', b).textContent = it.likes; } });
    repaint();
    if (it.liked && btn) { btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop'); }
    const r = await post('/api/social/like', { kind: 'p', id: rid });
    if (!r.ok) { it.liked = prev.liked; it.likes = prev.likes; repaint(); toast(r.data.error || 'Gagal menyimpan like', 'err'); return; }
    it.liked = !!r.data.liked; it.likes = r.data.count; repaint();
  }

  /* ---------------- hapus balasan ---------------- */
  async function delReply(rid, reviewId) {
    const T = thread(reviewId);
    const it = T.items.find((x) => String(x.id) === String(rid));
    if (!it) return;
    const ok = await UI.confirm({
      tone: 'danger', icon: 'trash',
      title: 'Hapus balasan ini?',
      message: 'Balasan akan hilang untuk semua pengunjung.',
      preview: { head: it.name, text: it.body },
      confirmText: 'Ya, hapus', cancelText: 'Batal', busyText: 'Menghapus…',
      onConfirm: async () => {
        const r = await post('/api/social/delete', { id: rid });
        if (!r.ok) throw new Error(r.data.error || 'Gagal menghapus balasan.');
      }
    });
    if (!ok) return;
    T.items = T.items.filter((x) => String(x.id) !== String(rid));
    if (T.replyTo && String(T.replyTo.id) === String(rid)) T.replyTo = null;
    const st = S.stats.get(reviewId) || { replies: 0, likes: 0, liked: false };
    st.replies = T.items.length; st.fresh = Date.now();
    S.stats.set(reviewId, st);
    phsOf(reviewId).forEach((p) => { paintBar(p); paintReto(p); fillList(p); });
    toast('Balasan dihapus');
  }

  /* ---------------- klik (delegasi) ---------------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t.closest) return;
    const ph = t.closest('.rc-soc');
    if (!ph) return;
    const id = ph.dataset.soc;
    if (t.closest('[data-soc-like]')) return likeReview(ph);
    if (t.closest('[data-soc-toggle]')) return toggleThread(ph);
    const lk = t.closest('[data-rp-like]');
    if (lk) return likeReply(lk.dataset.rpLike, id, lk);
    const dl = t.closest('[data-rp-del]');
    if (dl) return delReply(dl.dataset.rpDel, id);
    const rp = t.closest('[data-rp-reply]');
    if (rp) {
      const T = thread(id);
      T.replyTo = { id: rp.dataset.rpReply, name: rp.dataset.name };
      phsOf(id).forEach(paintReto);
      const inp = $('.soc-in', ph);
      if (inp) inp.focus();
      return;
    }
    if (t.closest('[data-rp-cancel]')) { thread(id).replyTo = null; phsOf(id).forEach(paintReto); }
  });

  /* ---------------- pembaruan berkala ---------------- */
  const viewOn = () => !document.hidden && !$('#rv-view').classList.contains('hidden');
  setInterval(() => {
    if (!viewOn() || S.offline) return;
    S.open.forEach((id) => { if (phsOf(id).length) loadThread(id); });
  }, 4000);
  setInterval(() => {
    if (!viewOn() || S.offline) return;
    const ids = [...new Set($$('.rc-soc').map((p) => p.dataset.soc))].slice(0, 40);
    fetchStats(ids);
  }, 9000);
  window.addEventListener('am:view', (e) => {
    if (e.detail && e.detail.view === 'reviews') { const ids = [...new Set($$('.rc-soc').map((p) => p.dataset.soc))].slice(0, 40); fetchStats(ids); }
  });

  window.Social = { refresh: () => fetchStats([...new Set($$('.rc-soc').map((p) => p.dataset.soc))].slice(0, 40)) };
})();
