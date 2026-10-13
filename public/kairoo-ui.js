/*
 * Kairoo API — UI shared (dipasang di SEMUA halaman)
 *
 *  1. Popup Saluran WhatsApp — MUNCUL SETIAP halaman dibuka (tidak ada lagi
 *     penyimpanan "sembunyikan 3 jam / 7 hari" yang bikin popup tidak tampil).
 *  2. Pencarian cepat (Ctrl/Cmd + K atau tombol 🔍): cari endpoint & halaman.
 *  3. Dock tombol mengambang: kembali ke atas, cari, saluran WA.
 *  4. Progress bar scroll, bayangan navbar saat scroll.
 *  5. Angka statistik berhitung naik (count-up), efek ripple pada tombol,
 *     cahaya mengikuti kursor di kartu, animasi muncul saat scroll.
 *  6. Transisi halus saat pindah halaman.
 *
 * CATATAN: popup hanya AJAKAN. WhatsApp tidak punya API publik untuk mengecek
 * apakah seseorang sudah follow, jadi tidak ada klaim verifikasi apa pun.
 */
(function () {
    'use strict';

    var CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb99yLaK0IBgYkp9KR2q';
    var SHOW_DELAY = 600;

    var reduceMotion = false;
    try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function safe(fn) { try { fn(); } catch (err) { if (window.console) console.warn('[kairoo-ui]', err); } }

    /* =====================================================
     * CSS (di-inject supaya halaman tanpa theme.css tetap benar)
     * ===================================================== */
    var css = `
:root{--kb-ink:#0A0A0A;--kb-paper:#FFFBEB;--kb-green:#16A34A;--kb-lime:#4ADE80;--kb-yellow:#FACC15;--kb-pink:#FF6B9D;--kb-blue:#60A5FA;
--kb-ease:cubic-bezier(.22,1,.36,1);--kb-spring:cubic-bezier(.34,1.56,.64,1);--kb-font:"Space Grotesk","Inter",system-ui,sans-serif;--kb-mono:"Space Mono","JetBrains Mono",ui-monospace,monospace}
html.kb-lock,html.kb-lock body{overflow:hidden !important}

/* ---------- reveal / transisi ---------- */
.kb-pre{opacity:0}
.kb-in{animation:kb-pop .65s var(--kb-ease) backwards;animation-delay:var(--kb-d,0ms)}
@keyframes kb-pop{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}
body.kb-leave{opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease}

/* ---------- progress scroll ---------- */
.kb-progress{position:fixed;left:0;top:0;right:0;height:6px;z-index:9500;pointer-events:none;background:transparent}
.kb-progress i{display:block;height:100%;width:100%;background:linear-gradient(90deg,var(--kb-pink),var(--kb-yellow),var(--kb-lime));
 border-bottom:2px solid var(--kb-ink);transform-origin:left center;transform:scaleX(0);will-change:transform}

/* ---------- navbar saat scroll ---------- */
.k-navbar,.site-header{transition:box-shadow .25s var(--kb-ease)}
.k-navbar.kb-scrolled,.site-header.kb-scrolled{box-shadow:0 5px 0 var(--kb-ink)}

/* ---------- ripple ---------- */
.k-btn,.clay-btn,.back-btn,.lang-tab,.kb-wa-btn,.kb-dock-btn,.clay-icon-btn,.chip-btn{position:relative;overflow:hidden}
.kb-ripple{position:absolute;border-radius:50%;pointer-events:none;background:rgba(255,255,255,.65);transform:scale(0);animation:kb-ripple .6s ease-out forwards;mix-blend-mode:soft-light}
@keyframes kb-ripple{to{transform:scale(1);opacity:0}}

/* ---------- cahaya kartu mengikuti kursor ---------- */
.k-card,.ep-card,.clay-card,.stat-card,.panel,.doc-cat{position:relative}
@media (hover:hover) and (pointer:fine){
 .k-card::before,.ep-card::before,.clay-card::before,.doc-cat::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:0;opacity:0;
  background:radial-gradient(220px circle at var(--mx,50%) var(--my,50%),rgba(255,255,255,.7),transparent 70%);transition:opacity .25s ease}
 .k-card:hover::before,.ep-card:hover::before,.clay-card:hover::before,.doc-cat:hover::before{opacity:1}
 .k-card>*,.ep-card>*,.clay-card>*,.doc-cat>*{position:relative;z-index:1}
}
.k-card,.k-btn,.k-quick{transition:transform .22s var(--kb-spring),box-shadow .22s var(--kb-ease),background .2s}

/* ---------- dock tombol mengambang ---------- */
.kb-dock{position:fixed;right:calc(14px + env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:9000;
 display:flex;flex-direction:column;align-items:flex-end;gap:12px;font-family:var(--kb-font)}
html.kb-lock .kb-dock{opacity:0;pointer-events:none}
.kb-dock-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:46px;height:46px;padding:0;background:#fff;color:var(--kb-ink);
 border:3px solid var(--kb-ink);border-radius:12px;box-shadow:4px 4px 0 var(--kb-ink);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;
 text-transform:uppercase;letter-spacing:.03em;-webkit-tap-highlight-color:transparent;
 transition:transform .2s var(--kb-spring),box-shadow .2s var(--kb-ease),background .15s,opacity .25s}
.kb-dock-btn svg{width:20px;height:20px;flex:none}
.kb-dock-btn:hover{transform:translate(-2px,-2px);box-shadow:6px 6px 0 var(--kb-ink);background:var(--kb-yellow)}
.kb-dock-btn:active{transform:translate(3px,3px);box-shadow:0 0 0 var(--kb-ink)}
.kb-dock-btn.kb-top{opacity:0;transform:translateY(16px) scale(.8);pointer-events:none}
.kb-dock-btn.kb-top.show{opacity:1;transform:none;pointer-events:auto}
.kb-dock-btn.kb-top.show:hover{transform:translate(-2px,-2px)}
.kb-wa-fab{width:auto;padding:0 14px;height:48px;background:var(--kb-lime);animation:kb-fab-in .7s var(--kb-spring) 1.1s backwards,kb-fab-bob 3.6s ease-in-out 2s infinite}
.kb-wa-fab::after{content:"";position:absolute;right:6px;top:6px;width:9px;height:9px;border-radius:50%;background:#EF4444;border:2px solid var(--kb-ink);animation:kb-blink 1.6s ease-in-out infinite}
@keyframes kb-fab-in{from{opacity:0;transform:translateY(40px) rotate(8deg) scale(.7)}to{opacity:1;transform:none}}
@keyframes kb-fab-bob{0%,100%{translate:0 0}50%{translate:0 -5px}}
@keyframes kb-blink{50%{transform:scale(.6);opacity:.6}}
@media (max-width:520px){.kb-wa-fab span{display:none}.kb-wa-fab{width:48px;padding:0}}

/* ---------- popup whatsapp ---------- */
.kb-wa-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;
 background:rgba(10,10,10,.66);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .3s ease;
 font-family:var(--kb-font);overflow-y:auto;-webkit-overflow-scrolling:touch}
.kb-wa-overlay.show{opacity:1;pointer-events:auto}
.kb-wa-modal{position:relative;width:100%;max-width:440px;margin:auto;background:var(--kb-paper);border:3px solid var(--kb-ink);border-radius:16px;
 box-shadow:10px 10px 0 var(--kb-ink);overflow:hidden;transform:translateY(60px) rotate(-4deg) scale(.82);opacity:0;
 transition:transform .6s var(--kb-spring),opacity .3s ease}
.kb-wa-overlay.show .kb-wa-modal{transform:none;opacity:1}
.kb-wa-overlay.hide .kb-wa-modal{transform:translateY(30px) rotate(3deg) scale(.9);opacity:0;transition:transform .25s ease,opacity .2s ease}
.kb-wa-bar{display:flex;align-items:center;gap:7px;padding:10px 14px;background:var(--kb-yellow);border-bottom:3px solid var(--kb-ink)}
.kb-wa-dot{width:12px;height:12px;border-radius:50%;border:2px solid var(--kb-ink)}
.kb-wa-dot:nth-child(1){background:#FF6B6B}.kb-wa-dot:nth-child(2){background:#fff}.kb-wa-dot:nth-child(3){background:var(--kb-lime)}
.kb-wa-bar-title{margin-left:6px;font-family:var(--kb-mono);font-size:11.5px;font-weight:700;color:var(--kb-ink);letter-spacing:.04em;text-transform:uppercase;
 white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kb-wa-close{margin-left:auto;flex:none;width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:#fff;border:3px solid var(--kb-ink);
 border-radius:8px;cursor:pointer;box-shadow:2px 2px 0 var(--kb-ink);padding:0;transition:transform .18s var(--kb-spring),box-shadow .18s,background .15s}
.kb-wa-close:hover{background:#FF6B6B;transform:translate(-1px,-1px) rotate(90deg);box-shadow:3px 3px 0 var(--kb-ink)}
.kb-wa-close:active{transform:translate(2px,2px);box-shadow:0 0 0 var(--kb-ink)}

.kb-wa-ticker{overflow:hidden;background:var(--kb-ink);color:var(--kb-yellow);border-bottom:3px solid var(--kb-ink);font-family:var(--kb-mono);font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}
.kb-wa-ticker div{display:flex;gap:26px;width:max-content;padding:6px 0;white-space:nowrap;animation:kb-marq 14s linear infinite}
.kb-wa-ticker span:nth-child(even){color:var(--kb-pink)}
@keyframes kb-marq{to{transform:translateX(-50%)}}

.kb-wa-body{position:relative;padding:24px 22px 22px;text-align:center;background-image:radial-gradient(rgba(10,10,10,.14) 1.2px,transparent 1.2px);background-size:18px 18px}
.kb-wa-body>*{position:relative;z-index:1;opacity:0;transform:translateY(16px);transition:opacity .5s var(--kb-ease),transform .5s var(--kb-ease)}
.kb-wa-overlay.show .kb-wa-body>*{opacity:1;transform:none}
.kb-wa-overlay.show .kb-wa-body>*:nth-child(4){transition-delay:.16s}
.kb-wa-overlay.show .kb-wa-body>*:nth-child(5){transition-delay:.24s}
.kb-wa-overlay.show .kb-wa-body>*:nth-child(6){transition-delay:.32s}
.kb-wa-overlay.show .kb-wa-body>*:nth-child(7){transition-delay:.4s}
.kb-wa-overlay.show .kb-wa-body>*:nth-child(8){transition-delay:.48s}

.kb-wa-badge{width:84px;height:84px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;background:var(--kb-lime);
 border:3px solid var(--kb-ink);border-radius:20px;box-shadow:5px 5px 0 var(--kb-ink);color:var(--kb-ink);animation:kb-wobble 3.2s ease-in-out infinite}
@keyframes kb-wobble{0%,100%{transform:rotate(-5deg) translateY(0)}50%{transform:rotate(5deg) translateY(-6px)}}
.kb-wa-badge svg{width:46px;height:46px}
.kb-wa-tag{display:inline-block;background:var(--kb-ink);color:var(--kb-yellow);font-family:var(--kb-mono);font-size:11px;font-weight:700;letter-spacing:.08em;
 text-transform:uppercase;padding:4px 10px;transform:rotate(-1.5deg);margin-bottom:12px}
.kb-wa-title{margin:0 0 10px;font-size:25px;line-height:1.12;font-weight:700;letter-spacing:-.02em;color:var(--kb-ink);text-transform:uppercase;text-shadow:2px 2px 0 var(--kb-yellow)}
.kb-wa-desc{margin:0 0 16px;font-size:14.5px;line-height:1.6;font-weight:500;color:#2B2B2B}
.kb-wa-perks{list-style:none;margin:0 0 20px;padding:0;display:flex;flex-direction:column;gap:8px;text-align:left}
.kb-wa-perks li{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fff;border:2px solid var(--kb-ink);border-radius:8px;box-shadow:3px 3px 0 var(--kb-ink);
 font-size:13px;font-weight:700;color:var(--kb-ink)}
.kb-wa-perks li i{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:var(--kb-lime);border:2px solid var(--kb-ink);border-radius:6px}
.kb-wa-perks li i svg{width:12px;height:12px}
.kb-wa-actions{display:flex;flex-direction:column;gap:12px}
.kb-wa-btn{display:flex;align-items:center;justify-content:center;gap:9px;padding:13px 18px;border:3px solid var(--kb-ink);border-radius:10px;cursor:pointer;
 font-family:inherit;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;text-decoration:none;box-shadow:5px 5px 0 var(--kb-ink);-webkit-tap-highlight-color:transparent;
 transition:transform .18s var(--kb-spring),box-shadow .18s var(--kb-ease),background .15s}
.kb-wa-btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--kb-ink)}
.kb-wa-btn:active{transform:translate(5px,5px);box-shadow:0 0 0 var(--kb-ink)}
.kb-wa-btn svg{width:18px;height:18px;transition:transform .25s var(--kb-spring)}
.kb-wa-btn:hover svg{transform:translateX(4px)}
.kb-wa-primary{background:var(--kb-green);color:#fff;text-shadow:1px 1px 0 var(--kb-ink);animation:kb-glow 2.4s ease-in-out 1s infinite}
.kb-wa-primary:hover{background:#22C55E}
@keyframes kb-glow{0%,100%{box-shadow:5px 5px 0 var(--kb-ink),0 0 0 0 rgba(22,163,74,.55)}50%{box-shadow:5px 5px 0 var(--kb-ink),0 0 0 10px rgba(22,163,74,0)}}
.kb-wa-secondary{background:#fff;color:var(--kb-ink);box-shadow:3px 3px 0 var(--kb-ink)}
.kb-wa-secondary:hover{background:#FEF9C3;box-shadow:5px 5px 0 var(--kb-ink)}
.kb-wa-shape{position:absolute;border:3px solid var(--kb-ink);pointer-events:none;z-index:0 !important}
.kb-wa-shape.s1{width:34px;height:34px;left:14px;top:16px;background:var(--kb-pink);border-radius:50%;animation:kb-float 5s ease-in-out infinite}
.kb-wa-shape.s2{width:26px;height:26px;right:18px;top:60px;background:var(--kb-blue);animation:kb-float 6s ease-in-out -2s infinite reverse}
.kb-wa-shape.s3{width:20px;height:20px;left:26px;top:150px;background:var(--kb-yellow);transform:rotate(20deg);animation:kb-float 7s ease-in-out -3s infinite}
@keyframes kb-float{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-12px) rotate(14deg)}}
@media (max-width:420px){.kb-wa-title{font-size:21px}.kb-wa-body{padding:20px 16px 18px}.kb-wa-modal{box-shadow:7px 7px 0 var(--kb-ink)}.kb-wa-badge{width:70px;height:70px}.kb-wa-badge svg{width:38px;height:38px}}
@media (max-height:640px){.kb-wa-perks{display:none}.kb-wa-desc{margin-bottom:14px}}
.kb-confetti{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:10001}

/* ---------- pencarian cepat (command palette) ---------- */
.kb-cmd{position:fixed;inset:0;z-index:9800;display:flex;align-items:flex-start;justify-content:center;padding:max(14px,8vh) 14px 14px;background:rgba(10,10,10,.6);
 backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);opacity:0;pointer-events:none;transition:opacity .22s ease;font-family:var(--kb-font)}
.kb-cmd.show{opacity:1;pointer-events:auto}
.kb-cmd-box{width:100%;max-width:620px;max-height:min(560px,84dvh);display:flex;flex-direction:column;background:var(--kb-paper);border:3px solid var(--kb-ink);border-radius:14px;
 box-shadow:9px 9px 0 var(--kb-ink);overflow:hidden;transform:translateY(-24px) scale(.96);transition:transform .35s var(--kb-spring)}
.kb-cmd.show .kb-cmd-box{transform:none}
.kb-cmd-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:var(--kb-yellow);border-bottom:3px solid var(--kb-ink)}
.kb-cmd-head svg{width:20px;height:20px;flex:none;color:var(--kb-ink)}
.kb-cmd-input{flex:1;min-width:0;border:0;outline:0;background:transparent;font-family:inherit;font-size:16px;font-weight:700;color:var(--kb-ink)}
.kb-cmd-input::placeholder{color:rgba(10,10,10,.55);font-weight:600}
.kb-kbd{flex:none;font-family:var(--kb-mono);font-size:10.5px;font-weight:700;padding:3px 7px;background:#fff;border:2px solid var(--kb-ink);border-radius:6px;box-shadow:2px 2px 0 var(--kb-ink);color:var(--kb-ink);cursor:pointer}
.kb-cmd-list{flex:1;min-height:80px;overflow-y:auto;overscroll-behavior:contain;padding:10px;-webkit-overflow-scrolling:touch}
.kb-cmd-group{margin:8px 4px 6px;font-family:var(--kb-mono);font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5C5C5C}
.kb-cmd-item{display:flex;align-items:center;gap:10px;width:100%;padding:10px 11px;margin-bottom:6px;text-align:left;background:#fff;border:2px solid transparent;border-radius:9px;cursor:pointer;
 font-family:inherit;color:var(--kb-ink);transition:transform .15s var(--kb-spring),background .12s,border-color .12s,box-shadow .15s}
.kb-cmd-item.active{background:#FEF9C3;border-color:var(--kb-ink);box-shadow:3px 3px 0 var(--kb-ink);transform:translateX(3px)}
.kb-cmd-item .m{flex:none;min-width:46px;text-align:center;font-family:var(--kb-mono);font-size:10px;font-weight:700;padding:3px 6px;border:2px solid var(--kb-ink);border-radius:5px;background:#FDE047}
.kb-cmd-item .m.get{background:#93C5FD}.kb-cmd-item .m.post{background:#4ADE80}.kb-cmd-item .m.delete{background:#FCA5A5}.kb-cmd-item .m.page{background:#F9A8D4}
.kb-cmd-item .t{flex:1;min-width:0;display:flex;flex-direction:column}
.kb-cmd-item .t b{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kb-cmd-item .t small{font-family:var(--kb-mono);font-size:11px;font-weight:700;color:#5C5C5C;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kb-cmd-item .c{flex:none;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;border:2px solid var(--kb-ink);background:var(--kb-lime)}
.kb-cmd-empty{padding:30px 10px;text-align:center;font-weight:700;color:#2B2B2B;font-size:14px}
.kb-cmd-foot{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:9px 14px;background:#fff;border-top:3px solid var(--kb-ink);font-size:11.5px;font-weight:700;color:#2B2B2B}
.kb-cmd-foot .kb-kbd{cursor:default;box-shadow:none;margin-right:4px}
@media (max-width:520px){.kb-cmd-foot .hint-desk{display:none}}

@media (prefers-reduced-motion:reduce){
 .kb-wa-badge,.kb-wa-shape,.kb-wa-ticker div,.kb-wa-primary,.kb-wa-fab,.kb-wa-fab::after{animation:none !important}
 .kb-in{animation:none}.kb-pre{opacity:1}
}
`;

    function injectCss() {
        if (document.getElementById('kb-ui-style')) return;
        var s = document.createElement('style');
        s.id = 'kb-ui-style';
        s.appendChild(document.createTextNode(css));
        document.head.appendChild(s);
    }

    /* ---------- ikon ---------- */
    var ICON_WA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
        '<path transform="translate(6.2 6.2) scale(.52)" d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>';
    var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    var ICON_X = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#0A0A0A" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    var ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>';
    var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.9-4.9"/></svg>';

    /* =====================================================
     * 1. POPUP WHATSAPP — selalu muncul tiap halaman dibuka
     * ===================================================== */
    function confetti(x, y) {
        if (reduceMotion) return;
        var c = document.createElement('canvas');
        c.className = 'kb-confetti';
        var w = c.width = window.innerWidth, h = c.height = window.innerHeight;
        document.body.appendChild(c);
        var ctx = c.getContext('2d');
        var colors = ['#FACC15', '#FF6B9D', '#4ADE80', '#60A5FA', '#16A34A', '#FFFBEB'];
        var ps = [];
        for (var i = 0; i < 90; i++) {
            var a = -Math.PI * (0.1 + Math.random() * 0.8);
            var sp = 6 + Math.random() * 11;
            ps.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, s: 6 + Math.random() * 7, r: Math.random() * 6, vr: (Math.random() - .5) * .4,
                c: colors[(Math.random() * colors.length) | 0], sq: Math.random() > .4 });
        }
        var t0 = performance.now();
        (function frame(now) {
            var dt = now - t0;
            ctx.clearRect(0, 0, w, h);
            ps.forEach(function (p) {
                p.vy += .38; p.vx *= .985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
                ctx.save();
                ctx.translate(p.x, p.y); ctx.rotate(p.r);
                ctx.globalAlpha = Math.max(0, 1 - dt / 1600);
                ctx.fillStyle = p.c; ctx.strokeStyle = '#0A0A0A'; ctx.lineWidth = 2;
                if (p.sq) { ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s); ctx.strokeRect(-p.s / 2, -p.s / 2, p.s, p.s); }
                else { ctx.beginPath(); ctx.arc(0, 0, p.s / 2, 0, 6.3); ctx.fill(); ctx.stroke(); }
                ctx.restore();
            });
            if (dt < 1600) requestAnimationFrame(frame);
            else if (c.parentNode) c.parentNode.removeChild(c);
        })(t0);
    }

    function initPopup() {
        if (document.getElementById('kb-wa-overlay')) return;

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
                '<div class="kb-wa-ticker" aria-hidden="true"><div>' +
                    '<span>Info Update</span><span>&#10033;</span><span>Fitur Baru</span><span>&#10033;</span><span>Pengumuman</span><span>&#10033;</span>' +
                    '<span>Info Update</span><span>&#10033;</span><span>Fitur Baru</span><span>&#10033;</span><span>Pengumuman</span><span>&#10033;</span>' +
                '</div></div>' +
                '<div class="kb-wa-body">' +
                    '<span class="kb-wa-shape s1"></span><span class="kb-wa-shape s2"></span><span class="kb-wa-shape s3"></span>' +
                    '<div class="kb-wa-badge">' + ICON_WA + '</div>' +
                    '<div><span class="kb-wa-tag">Saluran Resmi &bull; kenzchillz</span></div>' +
                    '<h2 class="kb-wa-title" id="kb-wa-title">Ikuti Saluran WhatsApp Kami!</h2>' +
                    '<p class="kb-wa-desc">Biar tidak ketinggalan kabar terbaru langsung dari developer.</p>' +
                    '<ul class="kb-wa-perks">' +
                        '<li><i>' + ICON_CHECK + '</i>Info update &amp; fitur baru</li>' +
                        '<li><i>' + ICON_CHECK + '</i>Pengumuman maintenance &amp; gangguan</li>' +
                        '<li><i>' + ICON_CHECK + '</i>Tips memakai API lebih maksimal</li>' +
                    '</ul>' +
                    '<div class="kb-wa-actions">' +
                        '<a class="kb-wa-btn kb-wa-primary" id="kb-wa-follow" href="' + CHANNEL_URL + '" target="_blank" rel="noopener noreferrer">Ikuti Saluran ' + ICON_ARROW + '</a>' +
                        '<button type="button" class="kb-wa-btn kb-wa-secondary" id="kb-wa-later">Nanti Saja</button>' +
                    '</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var lastFocus = document.activeElement;
        var followBtn = overlay.querySelector('#kb-wa-follow');
        var laterBtn = overlay.querySelector('#kb-wa-later');
        var closeBtn = overlay.querySelector('#kb-wa-close');
        var closed = false;

        function close() {
            if (closed) return;
            closed = true;
            overlay.classList.add('hide');
            overlay.classList.remove('show');
            document.documentElement.classList.remove('kb-lock');
            document.removeEventListener('keydown', onKey, true);
            setTimeout(function () {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
            }, 330);
        }

        function onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
            if (e.key !== 'Tab') return;
            var items = [closeBtn, followBtn, laterBtn];
            var first = items[0], last = items[items.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }

        // "Ikuti" membuka saluran di tab baru (link asli, tidak diblokir popup blocker).
        followBtn.addEventListener('click', function (e) {
            var r = followBtn.getBoundingClientRect();
            confetti(r.left + r.width / 2, r.top + r.height / 2);
            setTimeout(close, 450);
        });
        laterBtn.addEventListener('click', close);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.addEventListener('keydown', onKey, true);

        document.documentElement.classList.add('kb-lock');
        // dua frame supaya transisi awal terbaca browser
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                overlay.classList.add('show');
                setTimeout(function () { try { followBtn.focus({ preventScroll: true }); } catch (e) {} }, 450);
            });
        });
    }

    /* =====================================================
     * 2. PENCARIAN CEPAT (Ctrl/Cmd + K)
     * ===================================================== */
    var PAGES = [
        { t: 'Beranda', u: '/', d: 'Ringkasan & statistik API' },
        { t: 'Dokumentasi API', u: '/docs', d: 'Semua endpoint + coba langsung' },
        { t: 'Live Request Logs', u: '/logs', d: 'Request yang masuk secara realtime' },
        { t: 'Status Server Realtime', u: '/status', d: 'Kesehatan server' },
        { t: 'Pusat Feedback & Laporan', u: '/feedback', d: 'Kirim saran atau laporan bug' },
        { t: 'Akun & Langganan', u: '/premium', d: 'API key & paket premium' },
        { t: 'Tentang Kami', u: '/about', d: 'Tentang Kairoo' }
    ];
    var epCache = null;
    var cmd = null, cmdInput = null, cmdList = null, cmdItems = [], cmdActive = 0;

    function loadEndpoints(done) {
        if (epCache) return done();
        fetch('/config').then(function (r) { return r.json(); }).then(function (cfg) {
            var out = [], tags = (cfg && cfg.tags) || {};
            Object.keys(tags).forEach(function (cat) {
                (tags[cat] || []).forEach(function (r, i) {
                    out.push({ cat: cat, id: (cat + '-' + i).replace(/\s+/g, '-'), method: String(r.method || 'GET').toUpperCase(), name: r.name || '', endpoint: r.endpoint || '' });
                });
            });
            epCache = out; done();
        }).catch(function () { epCache = []; done(); });
    }

    function goEndpoint(it) {
        var onDocs = typeof window.selectEndpoint === 'function' && document.getElementById('file-' + it.id);
        if (onDocs) { window.selectEndpoint(it.id); return; }
        location.href = '/docs#ep=' + encodeURIComponent(it.id);
    }

    function renderCmd() {
        var q = cmdInput.value.toLowerCase().trim();
        var tokens = q ? q.split(/\s+/) : [];
        var pages = PAGES.filter(function (p) { var h = (p.t + ' ' + p.d).toLowerCase(); return tokens.every(function (t) { return h.indexOf(t) !== -1; }); });
        var eps = (epCache || []).filter(function (e) { var h = (e.name + ' ' + e.endpoint + ' ' + e.cat + ' ' + e.method).toLowerCase(); return tokens.every(function (t) { return h.indexOf(t) !== -1; }); });
        if (q) {
            eps.sort(function (a, b) {
                var ia = a.name.toLowerCase().indexOf(tokens[0]), ib = b.name.toLowerCase().indexOf(tokens[0]);
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
            });
        }
        var epShow = eps.slice(0, q ? 40 : 8);

        cmdItems = [];
        var html = '';
        if (pages.length) {
            html += '<div class="kb-cmd-group">Halaman</div>';
            pages.forEach(function (p) {
                cmdItems.push({ type: 'page', u: p.u });
                html += '<button type="button" class="kb-cmd-item" data-i="' + (cmdItems.length - 1) + '"><span class="m page">PAGE</span><span class="t"><b>' + esc(p.t) + '</b><small>' + esc(p.d) + '</small></span></button>';
            });
        }
        if (epShow.length) {
            html += '<div class="kb-cmd-group">' + (q ? 'Endpoint (' + eps.length + ')' : 'Endpoint') + '</div>';
            epShow.forEach(function (e) {
                cmdItems.push({ type: 'ep', it: e });
                var mc = e.method === 'GET' ? 'get' : e.method === 'POST' ? 'post' : e.method === 'DELETE' ? 'delete' : '';
                html += '<button type="button" class="kb-cmd-item" data-i="' + (cmdItems.length - 1) + '"><span class="m ' + mc + '">' + esc(e.method) + '</span><span class="t"><b>' + esc(e.name || e.endpoint) + '</b><small>' + esc(e.endpoint) + '</small></span><span class="c">' + esc(e.cat) + '</span></button>';
            });
        }
        if (!cmdItems.length) html = '<div class="kb-cmd-empty">Tidak ada hasil untuk &ldquo;' + esc(cmdInput.value) + '&rdquo;</div>';
        cmdList.innerHTML = html;
        setActive(0);
    }

    function setActive(i) {
        var nodes = cmdList.querySelectorAll('.kb-cmd-item');
        if (!nodes.length) return;
        cmdActive = (i + nodes.length) % nodes.length;
        nodes.forEach(function (n, k) { n.classList.toggle('active', k === cmdActive); });
        nodes[cmdActive].scrollIntoView({ block: 'nearest' });
    }

    function runActive() {
        var it = cmdItems[cmdActive];
        if (!it) return;
        closeCmd();
        if (it.type === 'page') location.href = it.u; else goEndpoint(it.it);
    }

    function buildCmd() {
        if (cmd) return;
        cmd = document.createElement('div');
        cmd.className = 'kb-cmd';
        cmd.setAttribute('role', 'dialog');
        cmd.setAttribute('aria-modal', 'true');
        cmd.setAttribute('aria-label', 'Pencarian cepat');
        cmd.innerHTML =
            '<div class="kb-cmd-box">' +
                '<div class="kb-cmd-head">' + ICON_SEARCH +
                    '<input class="kb-cmd-input" type="text" placeholder="Cari endpoint atau halaman..." autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">' +
                    '<button type="button" class="kb-kbd" data-close>ESC</button>' +
                '</div>' +
                '<div class="kb-cmd-list" role="listbox"></div>' +
                '<div class="kb-cmd-foot"><span class="hint-desk"><span class="kb-kbd">&uarr;&darr;</span>pilih</span><span class="hint-desk"><span class="kb-kbd">Enter</span>buka</span><span><span class="kb-kbd">Ctrl K</span>kapan saja</span></div>' +
            '</div>';
        document.body.appendChild(cmd);
        cmdInput = cmd.querySelector('.kb-cmd-input');
        cmdList = cmd.querySelector('.kb-cmd-list');

        cmd.addEventListener('mousedown', function (e) { if (e.target === cmd || e.target.hasAttribute('data-close')) { e.preventDefault(); closeCmd(); } });
        cmdList.addEventListener('click', function (e) {
            var b = e.target.closest('.kb-cmd-item'); if (!b) return;
            cmdActive = parseInt(b.getAttribute('data-i'), 10) || 0; runActive();
        });
        cmdList.addEventListener('mousemove', function (e) {
            var b = e.target.closest('.kb-cmd-item'); if (!b) return;
            var nodes = Array.prototype.slice.call(cmdList.querySelectorAll('.kb-cmd-item'));
            var i = nodes.indexOf(b);
            if (i !== cmdActive) { cmdActive = i; nodes.forEach(function (n, k) { n.classList.toggle('active', k === i); }); }
        });
        cmdInput.addEventListener('input', renderCmd);
        cmdInput.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(cmdActive + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(cmdActive - 1); }
            else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
            else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
        });
    }

    function openCmd() {
        if (document.getElementById('kb-wa-overlay')) return;   // jangan menumpuk di atas popup WA
        buildCmd();
        document.documentElement.classList.add('kb-lock');
        cmdInput.value = '';
        cmdList.innerHTML = '<div class="kb-cmd-empty">Memuat...</div>';
        requestAnimationFrame(function () { cmd.classList.add('show'); setTimeout(function () { cmdInput.focus(); }, 60); });
        loadEndpoints(renderCmd);
    }
    function closeCmd() {
        if (!cmd) return;
        cmd.classList.remove('show');
        document.documentElement.classList.remove('kb-lock');
        cmdInput.blur();
    }
    function cmdOpen() { return cmd && cmd.classList.contains('show'); }

    function initShortcuts() {
        document.addEventListener('keydown', function (e) {
            var k = (e.key || '').toLowerCase();
            if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); cmdOpen() ? closeCmd() : openCmd(); return; }
            if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !cmdOpen()) {
                var t = e.target, tag = t && t.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
                e.preventDefault(); openCmd();
            }
        });
        document.addEventListener('click', function (e) {
            var t = e.target.closest && e.target.closest('[data-kb-search]');
            if (t) { e.preventDefault(); openCmd(); }
        });
        window.kbOpenSearch = openCmd;
    }

    /* =====================================================
     * 3. DOCK, PROGRESS, SCROLL
     * ===================================================== */
    function initDock() {
        if (document.getElementById('kb-dock')) return;
        var dock = document.createElement('div');
        dock.id = 'kb-dock';
        dock.className = 'kb-dock';

        var top = document.createElement('button');
        top.type = 'button'; top.className = 'kb-dock-btn kb-top';
        top.setAttribute('aria-label', 'Kembali ke atas'); top.innerHTML = ICON_UP;
        top.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); });

        var se = document.createElement('button');
        se.type = 'button'; se.className = 'kb-dock-btn';
        se.setAttribute('aria-label', 'Cari endpoint (Ctrl+K)'); se.title = 'Cari (Ctrl+K atau /)'; se.innerHTML = ICON_SEARCH;
        se.addEventListener('click', openCmd);

        var wa = document.createElement('button');
        wa.type = 'button'; wa.id = 'kb-wa-fab'; wa.className = 'kb-dock-btn kb-wa-fab';
        wa.setAttribute('aria-label', 'Ikuti Saluran WhatsApp'); wa.innerHTML = ICON_WA + '<span>Saluran WA</span>';
        wa.addEventListener('click', initPopup);

        dock.appendChild(top); dock.appendChild(se); dock.appendChild(wa);
        document.body.appendChild(dock);
        dock._top = top;
    }

    function initScroll() {
        var bar = document.createElement('div');
        bar.className = 'kb-progress'; bar.setAttribute('aria-hidden', 'true');
        bar.innerHTML = '<i></i>';
        document.body.appendChild(bar);
        var fill = bar.firstChild;
        var dock = document.getElementById('kb-dock');
        var ticking = false;

        function update() {
            ticking = false;
            var y = window.pageYOffset || document.documentElement.scrollTop || 0;
            var max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
            fill.style.transform = 'scaleX(' + Math.min(1, Math.max(0, y / max)) + ')';
            if (dock && dock._top) dock._top.classList.toggle('show', y > 420);
            var nav = document.querySelector('.k-navbar,.site-header');
            if (nav) nav.classList.toggle('kb-scrolled', y > 6);
        }
        window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
        window.addEventListener('resize', update);
        update();
    }

    /* =====================================================
     * 4. RIPPLE + CAHAYA KARTU
     * ===================================================== */
    function initRipple() {
        if (reduceMotion) return;
        document.addEventListener('pointerdown', function (e) {
            var b = e.target.closest && e.target.closest('.k-btn,.clay-btn,.back-btn,.lang-tab,.kb-wa-btn,.kb-dock-btn,.clay-icon-btn,.chip-btn');
            if (!b || b.disabled) return;
            var r = b.getBoundingClientRect();
            var size = Math.max(r.width, r.height) * 2.2;
            var s = document.createElement('span');
            s.className = 'kb-ripple';
            s.style.width = s.style.height = size + 'px';
            s.style.left = (e.clientX - r.left - size / 2) + 'px';
            s.style.top = (e.clientY - r.top - size / 2) + 'px';
            b.appendChild(s);
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 650);
        }, { passive: true });
    }

    function initSpotlight() {
        if (!window.matchMedia || !window.matchMedia('(hover:hover) and (pointer:fine)').matches) return;
        var raf = 0, lx = 0, ly = 0, target = null;
        document.addEventListener('pointermove', function (e) {
            var c = e.target.closest && e.target.closest('.k-card,.ep-card,.clay-card,.doc-cat');
            if (!c) return;
            target = c; lx = e.clientX; ly = e.clientY;
            if (raf) return;
            raf = requestAnimationFrame(function () {
                raf = 0;
                var r = target.getBoundingClientRect();
                target.style.setProperty('--mx', (lx - r.left) + 'px');
                target.style.setProperty('--my', (ly - r.top) + 'px');
            });
        }, { passive: true });
    }

    /* =====================================================
     * 5. COUNT-UP ANGKA STATISTIK
     * ===================================================== */
    function initCountUp() {
        if (reduceMotion || !('MutationObserver' in window)) return;
        var SEL = '.k-stat-value,[data-countup]';

        function parse(txt) {
            var m = /^\s*(\d[\d.,]*)\s*([A-Za-z%]{0,4})\s*$/.exec(txt);
            if (!m) return null;
            var raw = m[1], thousands = /^\d{1,3}(\.\d{3})+$/.test(raw);
            var val, dec = 0;
            if (thousands) val = parseInt(raw.replace(/\./g, ''), 10);
            else { var n = raw.replace(',', '.'); val = parseFloat(n); var p = n.split('.')[1]; dec = p ? p.length : 0; }
            if (!isFinite(val) || val <= 0) return null;
            return { val: val, dec: dec, thousands: thousands, suffix: m[2] || '' };
        }
        function fmt(p, v) {
            return (p.thousands ? Math.round(v).toLocaleString('id-ID') : v.toFixed(p.dec)) + p.suffix;
        }
        function animate(el, p, finalText) {
            el.__kbBusy = true;
            var t0 = performance.now(), dur = 1000;
            (function step(now) {
                var k = Math.min(1, (now - t0) / dur), e = k === 1 ? 1 : 1 - Math.pow(2, -10 * k);
                if (k < 1) { el.textContent = fmt(p, p.val * e); requestAnimationFrame(step); }
                else { el.__kbLast = finalText; el.textContent = finalText; el.__kbBusy = false; }
            })(t0);
        }
        function check(el) {
            if (!el || el.__kbBusy) return;
            var txt = el.textContent;
            if (txt === el.__kbLast) return;
            var p = parse(txt);
            if (!p) return;
            animate(el, p, txt);
        }
        new MutationObserver(function (list) {
            list.forEach(function (m) {
                var n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
                var el = n && n.closest && n.closest(SEL);
                if (el) check(el);
            });
        }).observe(document.body, { childList: true, characterData: true, subtree: true });
        document.querySelectorAll(SEL).forEach(check);
    }

    /* =====================================================
     * 6. REVEAL SAAT SCROLL
     * ===================================================== */
    var REVEAL_SEL = '.k-card,.k-table-wrap,.k-terminal,.stat-card,.stat-card-sm,.panel,.rps-card,.resource-item,' +
        '.clay-card,.ep-card,.resp-card,.k-h2,.dash-content,.dash-sidebar,.auth-card,.premium-card,.support-card,.k-footer-inner,.history-table-wrap,.doc-cat,.doc-hero';

    function initReveal() {
        if (!('IntersectionObserver' in window) || reduceMotion) return;

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
            if (el.closest && (el.closest('.kb-wa-overlay') || el.closest('.kb-cmd'))) return;
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
     * 7. TRANSISI KELUAR HALAMAN
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
        // tombol back/forward (bfcache): halaman jangan transparan & popup muncul lagi
        window.addEventListener('pageshow', function (ev) {
            if (ev.persisted) {
                document.body.classList.remove('kb-leave');
                setTimeout(initPopup, 300);
            }
        });
    }

    /* ===================================================== */
    function init() {
        if (!document.body) return;
        // Popup dijadwalkan PERTAMA supaya error di fitur lain tidak pernah menghalanginya.
        setTimeout(function () { safe(initPopup); }, SHOW_DELAY);

        safe(injectCss);
        safe(initDock);
        safe(initScroll);
        safe(initShortcuts);
        safe(initRipple);
        safe(initSpotlight);
        safe(initCountUp);
        safe(initReveal);
        safe(initLeave);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
