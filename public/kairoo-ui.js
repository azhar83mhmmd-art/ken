/*
 * Kairoo API — UI shared (dipasang di SEMUA halaman)
 *  1. Popup ajakan ikut Saluran WhatsApp (neo brutalism, animasi pegas)
 *  2. Animasi muncul saat scroll (stagger) untuk kartu/tabel/panel
 *  3. Transisi halus saat pindah halaman
 *
 * CATATAN: popup hanya AJAKAN. WhatsApp tidak punya API publik untuk mengecek
 * apakah seseorang sudah follow, jadi tidak ada klaim verifikasi apa pun.
 *
 * Mau popup muncul di SETIAP halaman yang dibuka (bukan sekali per kunjungan)?
 * Ubah SHOW_EVERY_PAGE menjadi true.
 */
(function () {
    'use strict';

    var CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb99yLaK0IBgYkp9KR2q';
    var SHOW_EVERY_PAGE = false;
    var SESSION_KEY = 'kairoo_wa_popup_shown';
    var SHOW_DELAY = 900;

    /* ---------- storage aman ---------- */
    function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
    function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* abaikan */ } }

    /* ---------- CSS (di-inject supaya halaman tanpa theme.css tetap benar) ---------- */
    var css = '' +
    '.kb-pre{opacity:0}' +
    '.kb-in{animation:kb-pop .65s cubic-bezier(.22,1,.36,1) backwards;animation-delay:var(--kb-d,0ms)}' +
    '@keyframes kb-pop{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}' +
    'body.kb-leave{opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease}' +

    '.kb-wa-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:18px;' +
        'background:rgba(10,10,10,.62);backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity .3s ease;' +
        'font-family:"Space Grotesk","Inter",sans-serif}' +
    '.kb-wa-overlay.show{opacity:1;pointer-events:auto}' +

    '.kb-wa-modal{position:relative;width:100%;max-width:430px;background:#FFFBEB;border:3px solid #0A0A0A;border-radius:14px;' +
        'box-shadow:10px 10px 0 #0A0A0A;overflow:hidden;transform:translateY(60px) rotate(-4deg) scale(.82);opacity:0;' +
        'transition:transform .6s cubic-bezier(.34,1.56,.64,1),opacity .3s ease}' +
    '.kb-wa-overlay.show .kb-wa-modal{transform:none;opacity:1}' +
    '.kb-wa-overlay.hide .kb-wa-modal{transform:translateY(30px) rotate(3deg) scale(.9);opacity:0;transition:transform .25s ease,opacity .2s ease}' +

    '.kb-wa-bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:#FACC15;border-bottom:3px solid #0A0A0A}' +
    '.kb-wa-dot{width:12px;height:12px;border-radius:50%;border:2px solid #0A0A0A}' +
    '.kb-wa-dot:nth-child(1){background:#FF6B6B}.kb-wa-dot:nth-child(2){background:#fff}.kb-wa-dot:nth-child(3){background:#4ADE80}' +
    '.kb-wa-bar-title{margin-left:6px;font-family:"Space Mono",monospace;font-size:11.5px;font-weight:700;color:#0A0A0A;letter-spacing:.04em;text-transform:uppercase}' +
    '.kb-wa-close{margin-left:auto;width:30px;height:30px;display:flex;align-items:center;justify-content:center;background:#fff;border:3px solid #0A0A0A;' +
        'border-radius:6px;cursor:pointer;box-shadow:2px 2px 0 #0A0A0A;transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s,background .15s;padding:0}' +
    '.kb-wa-close:hover{background:#FF6B6B;transform:translate(-1px,-1px) rotate(90deg);box-shadow:3px 3px 0 #0A0A0A}' +
    '.kb-wa-close:active{transform:translate(2px,2px);box-shadow:0 0 0 #0A0A0A}' +

    '.kb-wa-body{position:relative;padding:26px 24px 24px;text-align:center;background-image:radial-gradient(rgba(10,10,10,.14) 1.2px,transparent 1.2px);background-size:18px 18px}' +
    '.kb-wa-body>*{opacity:0;transform:translateY(16px);transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .5s cubic-bezier(.22,1,.36,1)}' +
    '.kb-wa-overlay.show .kb-wa-body>*{opacity:1;transform:none}' +
    '.kb-wa-overlay.show .kb-wa-body>*:nth-child(1){transition-delay:.18s}' +
    '.kb-wa-overlay.show .kb-wa-body>*:nth-child(2){transition-delay:.26s}' +
    '.kb-wa-overlay.show .kb-wa-body>*:nth-child(3){transition-delay:.34s}' +
    '.kb-wa-overlay.show .kb-wa-body>*:nth-child(4){transition-delay:.42s}' +
    '.kb-wa-overlay.show .kb-wa-body>*:nth-child(5){transition-delay:.5s}' +

    '.kb-wa-badge{width:84px;height:84px;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;background:#4ADE80;' +
        'border:3px solid #0A0A0A;border-radius:18px;box-shadow:5px 5px 0 #0A0A0A;color:#0A0A0A;animation:kb-wobble 3.2s ease-in-out infinite}' +
    '@keyframes kb-wobble{0%,100%{transform:rotate(-5deg) translateY(0)}50%{transform:rotate(5deg) translateY(-6px)}}' +
    '.kb-wa-badge svg{width:46px;height:46px}' +

    '.kb-wa-tag{display:inline-block;background:#0A0A0A;color:#FACC15;font-family:"Space Mono",monospace;font-size:11px;font-weight:700;letter-spacing:.08em;' +
        'text-transform:uppercase;padding:4px 10px;transform:rotate(-1.5deg);margin-bottom:12px}' +
    '.kb-wa-title{margin:0 0 10px;font-size:25px;line-height:1.1;font-weight:700;letter-spacing:-.02em;color:#0A0A0A;text-transform:uppercase;text-shadow:2px 2px 0 #FACC15}' +
    '.kb-wa-desc{margin:0 0 22px;font-size:14.5px;line-height:1.6;font-weight:500;color:#2B2B2B}' +

    '.kb-wa-actions{display:flex;flex-direction:column;gap:12px}' +
    '.kb-wa-btn{display:flex;align-items:center;justify-content:center;gap:9px;padding:13px 18px;border:3px solid #0A0A0A;border-radius:8px;cursor:pointer;' +
        'font-family:inherit;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;text-decoration:none;box-shadow:5px 5px 0 #0A0A0A;' +
        'transition:transform .18s cubic-bezier(.34,1.56,.64,1),box-shadow .18s cubic-bezier(.22,1,.36,1),background .15s}' +
    '.kb-wa-btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 #0A0A0A}' +
    '.kb-wa-btn:active{transform:translate(5px,5px);box-shadow:0 0 0 #0A0A0A}' +
    '.kb-wa-btn svg{width:18px;height:18px;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}' +
    '.kb-wa-btn:hover svg{transform:translateX(4px)}' +
    '.kb-wa-primary{background:#16A34A;color:#fff;text-shadow:1px 1px 0 #0A0A0A}' +
    '.kb-wa-primary:hover{background:#22C55E}' +
    '.kb-wa-secondary{background:#fff;color:#0A0A0A;box-shadow:3px 3px 0 #0A0A0A}' +
    '.kb-wa-secondary:hover{background:#FEF9C3;box-shadow:5px 5px 0 #0A0A0A}' +

    '.kb-wa-shape{position:absolute;border:3px solid #0A0A0A;pointer-events:none;z-index:-1}' +
    '.kb-wa-shape.s1{width:34px;height:34px;left:14px;top:18px;background:#FF6B9D;border-radius:50%;animation:kb-float 5s ease-in-out infinite}' +
    '.kb-wa-shape.s2{width:26px;height:26px;right:18px;top:62px;background:#60A5FA;animation:kb-float 6s ease-in-out -2s infinite reverse}' +
    '.kb-wa-shape.s3{width:20px;height:20px;left:30px;bottom:96px;background:#FACC15;transform:rotate(20deg);animation:kb-float 7s ease-in-out -3s infinite}' +
    '@keyframes kb-float{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-12px) rotate(14deg)}}' +

    '@media (max-width:420px){.kb-wa-title{font-size:21px}.kb-wa-body{padding:22px 18px 20px}.kb-wa-modal{box-shadow:7px 7px 0 #0A0A0A}}' +
    '@media (prefers-reduced-motion:reduce){.kb-wa-badge,.kb-wa-shape{animation:none}.kb-in{animation:none}.kb-pre{opacity:1}}';

    function injectCss() {
        var s = document.createElement('style');
        s.id = 'kb-ui-style';
        s.appendChild(document.createTextNode(css));
        document.head.appendChild(s);
    }

    /* =====================================================
     * 1. POPUP WHATSAPP
     * ===================================================== */
    var ICON_WA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
        '<path transform="translate(6.2 6.2) scale(.52)" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
    var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    var ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0A0A0A" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

    function initPopup() {
        if (document.getElementById('kb-wa-overlay')) return;
        if (!SHOW_EVERY_PAGE && ssGet(SESSION_KEY) === '1') return;

        var overlay = document.createElement('div');
        overlay.id = 'kb-wa-overlay';
        overlay.className = 'kb-wa-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'kb-wa-title');
        overlay.innerHTML =
            '<div class="kb-wa-modal">' +
                '<div class="kb-wa-bar">' +
                    '<span class="kb-wa-dot"></span><span class="kb-wa-dot"></span><span class="kb-wa-dot"></span>' +
                    '<span class="kb-wa-bar-title">whatsapp.channel</span>' +
                    '<button type="button" class="kb-wa-close" id="kb-wa-close" aria-label="Tutup">' + ICON_X + '</button>' +
                '</div>' +
                '<div class="kb-wa-body">' +
                    '<span class="kb-wa-shape s1"></span><span class="kb-wa-shape s2"></span><span class="kb-wa-shape s3"></span>' +
                    '<div class="kb-wa-badge">' + ICON_WA + '</div>' +
                    '<div><span class="kb-wa-tag">Saluran Resmi &bull; kenzchillz</span></div>' +
                    '<h2 class="kb-wa-title" id="kb-wa-title">Ikuti Saluran WhatsApp Kami!</h2>' +
                    '<p class="kb-wa-desc">Dapatkan info update, fitur baru, dan pengumuman terbaru langsung di WhatsApp kamu.</p>' +
                    '<div class="kb-wa-actions">' +
                        '<a class="kb-wa-btn kb-wa-primary" id="kb-wa-follow" href="' + CHANNEL_URL + '" target="_blank" rel="noopener noreferrer">Ikuti Saluran ' + ICON_ARROW + '</a>' +
                        '<button type="button" class="kb-wa-btn kb-wa-secondary" id="kb-wa-later">Nanti Saja</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var lastFocus = null;
        var followBtn = overlay.querySelector('#kb-wa-follow');
        var laterBtn = overlay.querySelector('#kb-wa-later');
        var closeBtn = overlay.querySelector('#kb-wa-close');

        function open() {
            lastFocus = document.activeElement;
            ssSet(SESSION_KEY, '1');
            document.body.style.overflow = 'hidden';
            // dua frame supaya transisi awal terbaca browser
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    overlay.classList.add('show');
                    setTimeout(function () { followBtn.focus({ preventScroll: true }); }, 450);
                });
            });
        }

        function close() {
            overlay.classList.add('hide');
            overlay.classList.remove('show');
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
            }, 320);
        }

        function onKey(e) {
            if (e.key === 'Escape') { close(); return; }
            if (e.key !== 'Tab') return;
            var items = [closeBtn, followBtn, laterBtn];
            var first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

        followBtn.addEventListener('click', function () { setTimeout(close, 150); });
        laterBtn.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey);

        open();
    }

    /* =====================================================
     * 2. REVEAL SAAT SCROLL
     * ===================================================== */
    var REVEAL_SEL = '.k-card,.k-table-wrap,.k-terminal,.stat-card,.stat-card-sm,.panel,.rps-card,.resource-item,' +
        '.clay-card,.ep-card,.resp-card,.k-h2,.dash-content,.dash-sidebar,.auth-card,.premium-card,.support-card,.k-footer-inner,.history-table-wrap';

    function initReveal() {
        if (!('IntersectionObserver' in window)) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        var io = new IntersectionObserver(function (entries) {
            var batch = 0;
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                var el = entry.target;
                io.unobserve(el);
                el.style.setProperty('--kb-d', Math.min(batch, 6) * 70 + 'ms');
                batch++;
                el.classList.remove('kb-pre');
                el.classList.add('kb-in');
                el.addEventListener('animationend', function done(ev) {
                    if (ev.target !== el) return;
                    el.classList.remove('kb-in');
                    el.style.removeProperty('--kb-d');
                    el.removeEventListener('animationend', done);
                });
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

        function watch(el) {
            if (el.nodeType !== 1) return;
            if (el.closest && el.closest('.kb-wa-overlay')) return;
            // elemen yang sudah punya sistem reveal sendiri dilewati
            if (el.classList.contains('reveal') || el.classList.contains('k-reveal') || el.dataset.kb) return;
            el.dataset.kb = '1';
            el.classList.add('kb-pre');
            io.observe(el);
        }

        function scan(root) {
            if (root.matches && root.matches(REVEAL_SEL)) watch(root);
            if (root.querySelectorAll) root.querySelectorAll(REVEAL_SEL).forEach(watch);
        }

        scan(document.body);

        new MutationObserver(function (list) {
            list.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) scan(n); }); });
        }).observe(document.body, { childList: true, subtree: true });

        // jaring pengaman: jangan ada elemen yang tertinggal transparan
        setTimeout(function () {
            document.querySelectorAll('.kb-pre').forEach(function (el) {
                var r = el.getBoundingClientRect();
                if (r.top < window.innerHeight && r.bottom > 0 && getComputedStyle(el).display !== 'none') {
                    io.unobserve(el);
                    el.classList.remove('kb-pre');
                }
            });
        }, 4000);
    }

    /* =====================================================
     * 3. TRANSISI KELUAR HALAMAN
     * ===================================================== */
    function initLeave() {
        document.addEventListener('click', function (e) {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            var a = e.target.closest && e.target.closest('a[href]');
            if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
            var href = a.getAttribute('href');
            if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
            var url;
            try { url = new URL(a.href, location.href); } catch (err) { return; }
            if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
            e.preventDefault();
            document.body.classList.add('kb-leave');
            setTimeout(function () { location.href = url.href; }, 180);
        });
        // tombol back/forward (bfcache): pastikan halaman tidak tertinggal transparan
        window.addEventListener('pageshow', function (ev) { if (ev.persisted) document.body.classList.remove('kb-leave'); });
    }

    function init() {
        injectCss();
        initReveal();
        initLeave();
        setTimeout(initPopup, SHOW_DELAY);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
