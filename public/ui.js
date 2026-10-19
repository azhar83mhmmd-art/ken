// AM Premify v4.3 - Dialog konfirmasi profesional (pengganti confirm() bawaan browser)
//
//   const ok = await UI.confirm({
//     tone: 'danger' | 'warn' | 'info', icon: 'trash' | 'alert' | 'ban' | 'check' | 'info',
//     title, message, preview: { head, text }, itemsTitle, items: ['...'], itemIcon: 'x' | 'check', note,
//     field: { label, placeholder, maxlength, value },       // opsional: kolom isian
//     confirmText, cancelText, busyText,
//     onConfirm: async (value) => { ... }                    // opsional: dialog tetap terbuka + loading sampai selesai;
//   });                                                      //   jika melempar error, pesannya tampil di dialog
//   -> false (batal) | true (setuju) | { value } (setuju, jika memakai field)
(function () {
  'use strict';

  const ICONS = {
    trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6M10 11v6M14 11v6"/>',
    alert: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  const svg = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ICONS.info}</svg>`;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let current = null; // dialog yang sedang terbuka
  let uid = 0;

  function confirmDialog(opts) {
    opts = opts || {};
    if (current) current.finish(false, true);

    return new Promise((resolve) => {
      const id = 'uic' + (++uid);
      const tone = opts.tone === 'warn' || opts.tone === 'info' ? opts.tone : 'danger';
      const prevFocus = document.activeElement;
      const hadLock = document.body.classList.contains('no-scroll');
      let busy = false, closed = false;

      const root = el('div', 'uic');
      root.appendChild(el('div', 'uic-bg'));
      const card = el('div', 'uic-card uic-' + tone);
      card.setAttribute('role', 'alertdialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', id + '-t');
      card.tabIndex = -1;
      card.appendChild(el('div', 'uic-stripe'));

      const body = el('div', 'uic-body');
      const head = el('div', 'uic-head');
      const ic = el('div', 'uic-ic');
      ic.innerHTML = svg(opts.icon || (tone === 'danger' ? 'trash' : tone === 'warn' ? 'alert' : 'info'));
      const title = el('h3', 'uic-title', opts.title || 'Lanjutkan tindakan ini?');
      title.id = id + '-t';
      head.append(ic, title);
      body.appendChild(head);

      if (opts.message) {
        const m = el('p', 'uic-msg', opts.message);
        m.id = id + '-d';
        card.setAttribute('aria-describedby', m.id);
        body.appendChild(m);
      }
      if (opts.preview && (opts.preview.head || opts.preview.text)) {
        const p = el('div', 'uic-prev');
        if (opts.preview.head) p.appendChild(el('b', '', opts.preview.head));
        if (opts.preview.text) p.appendChild(el('span', '', opts.preview.text));
        body.appendChild(p);
      }
      if (opts.items && opts.items.length) {
        const box = el('div', 'uic-list');
        if (opts.itemsTitle) box.appendChild(el('span', 'uic-list-k', opts.itemsTitle));
        const ul = el('ul');
        opts.items.forEach((t) => { const li = el('li'); li.innerHTML = svg(opts.itemIcon === 'check' ? 'check' : 'x'); li.appendChild(document.createTextNode(t)); ul.appendChild(li); });
        box.appendChild(ul);
        body.appendChild(box);
      }
      let input = null;
      if (opts.field) {
        const lab = el('label', 'uic-field');
        lab.appendChild(el('span', '', opts.field.label || 'Catatan'));
        input = el('input');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.maxLength = opts.field.maxlength || 120;
        input.placeholder = opts.field.placeholder || '';
        input.value = opts.field.value || '';
        lab.appendChild(input);
        body.appendChild(lab);
      }
      if (opts.note) {
        const n = el('p', 'uic-note');
        n.innerHTML = svg('alert');
        n.appendChild(document.createTextNode(opts.note));
        body.appendChild(n);
      }
      const err = el('p', 'uic-err');
      err.setAttribute('role', 'alert');
      body.appendChild(err);
      card.appendChild(body);

      const actions = el('div', 'uic-actions');
      const cancel = el('button', 'uic-btn uic-cancel', opts.cancelText || 'Batal');
      cancel.type = 'button';
      const ok = el('button', 'uic-btn uic-ok');
      ok.type = 'button';
      const okLabel = () => { ok.innerHTML = tone === 'danger' && !opts.noIcon ? svg(opts.icon || 'trash') : ''; ok.appendChild(el('span', '', opts.confirmText || 'Ya, lanjutkan')); };
      okLabel();
      actions.append(cancel, ok);
      card.appendChild(actions);
      root.appendChild(card);

      function finish(result, instant) {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        current = null;
        const done = () => {
          root.remove();
          if (!hadLock) document.body.classList.remove('no-scroll');
          try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch {}
          resolve(result);
        };
        if (instant) return done();
        root.classList.add('out');
        setTimeout(done, 150);
      }

      async function accept() {
        if (busy) return;
        const value = input ? input.value.trim() : undefined;
        if (typeof opts.onConfirm !== 'function') return finish(input ? { value } : true);
        busy = true;
        err.textContent = '';
        card.setAttribute('aria-busy', 'true');
        cancel.disabled = ok.disabled = true;
        ok.innerHTML = '<i class="uic-spin" aria-hidden="true"></i>';
        ok.appendChild(el('span', '', opts.busyText || 'Memproses…'));
        try {
          await opts.onConfirm(value);
          finish(input ? { value } : true);
        } catch (e) {
          busy = false;
          card.removeAttribute('aria-busy');
          cancel.disabled = ok.disabled = false;
          okLabel();
          err.textContent = (e && e.message) || 'Terjadi kesalahan. Coba lagi.';
          ok.focus();
        }
      }

      function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) finish(false); return; }
        if (e.key === 'Enter' && input && e.target === input) { e.preventDefault(); accept(); return; }
        if (e.key !== 'Tab') return;
        const f = [...card.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }

      root.querySelector('.uic-bg').addEventListener('click', () => { if (!busy) finish(false); });
      cancel.addEventListener('click', () => finish(false));
      ok.addEventListener('click', accept);
      document.addEventListener('keydown', onKey, true);

      document.body.appendChild(root);
      document.body.classList.add('no-scroll');
      current = { finish };
      // Fokus awal ke tombol aman (Batal) supaya tidak terhapus tanpa sengaja karena menekan Enter
      requestAnimationFrame(() => (input || cancel).focus({ preventScroll: true }));
    });
  }

  window.UI = { confirm: confirmDialog };
})();
