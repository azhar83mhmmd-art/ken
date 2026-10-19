// AM Premify - Premium Panel
// Jalankan: node server.js  (butuh Node.js 18+, tanpa npm install)
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Muat file .env (tanpa dotenv)
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch {}

const PORT = process.env.PORT || 8112;
const UPSTREAM = process.env.UPSTREAM || 'https://am.noxxyrorr.biz.id';
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
// Cloudflare Turnstile (kunci uji Cloudflare dipakai jika belum diisi: selalu lolos, hanya untuk development)
// Email di feed publik disamarkan: 5 huruf pertama terlihat, sisanya ***, domain utuh (kenzo***@gmail.com).
// Set MASK_EMAIL=false di .env hanya jika ingin menampilkan email penuh.
const MASK_EMAIL = String(process.env.MASK_EMAIL || 'true').toLowerCase() !== 'false';
// ---- v4.3: admin, chat & blokir perangkat ----
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SB_READY = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
// Rahasia penanda tangan token. Isi APP_SECRET di .env (acak, panjang). Jika kosong diturunkan dari kunci lain.
const APP_SECRET = process.env.APP_SECRET ||
  ((SUPABASE_SERVICE_KEY || ADMIN_PASSWORD) ? sha('amp|' + SUPABASE_SERVICE_KEY + '|' + ADMIN_PASSWORD) : crypto.randomBytes(32).toString('hex'));
// Blokir ketat: sidik jari perangkat yang sama tetap diblokir walau data browser dihapus & jaringan berganti.
// Set BLOCK_FP_STRICT=false jika khawatir HP dengan tipe yang sama ikut terblokir (sidik jari + IP tetap dicocokkan).
const BLOCK_FP_STRICT = String(process.env.BLOCK_FP_STRICT || 'true').toLowerCase() !== 'false';
// Opsional: blokir juga berdasarkan IP saja (bisa mengenai satu jaringan yang sama). Default mati.
const BLOCK_IP = String(process.env.BLOCK_IP || 'false').toLowerCase() === 'true';
// Batas permintaan aktivasi (kirim link + verifikasi) per perangkat / per IP dalam 10 menit
const ACT_LIMIT = Number(process.env.ACT_LIMIT || 20);
const TURNSTILE_SITE_KEY = process.env.TURNSTILE_SITE_KEY || '1x00000000000000000000AA';
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';

// Pakai folder public/ jika ada, kalau tidak pakai folder yang sama dengan server.js
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : __dirname;
const BLOCKED = ['server.js', 'package.json', 'package-lock.json', 'vercel.json', 'supabase.sql'];

// URL bersih (tanpa .html) -> semuanya dilayani oleh index.html
const PAGES = new Set(['/', '/index', '/premium', '/panduan', '/rating', '/ulasan', '/bukti', '/biodata', '/room']);
const ADMIN_PAGE = '/admin';
// v4.8: halaman Bypass Link (/bypass -> bypass.html) + proxy API
const BYPASS_PAGE = '/bypass';
const BYPASS_UPSTREAM = process.env.BYPASS_UPSTREAM || 'https://apiii-xrina.my.id/tools/bypassv2';
// Batas permintaan bypass per IP dalam 5 menit
const BYPASS_LIMIT = Number(process.env.BYPASS_LIMIT || 20);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}

function redirect(res, code, location) {
  res.writeHead(code, { Location: location });
  res.end();
}

// Batasi ukuran body supaya tidak bisa dipakai membanjiri memori server
function readBody(req, max = 64 * 1024) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0, dead = false;
    req.on('data', (c) => {
      if (dead) return;
      size += c.length;
      if (size > max) { dead = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(dead ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}

async function readJson(req, max = 16 * 1024) {
  const buf = await readBody(req, max);
  if (!buf) return null;
  try {
    const o = JSON.parse(buf.toString('utf8') || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

/* ---------- v4.3: token, cookie, identitas perangkat ---------- */
const hmac = (data) => crypto.createHmac('sha256', APP_SECRET).update(data).digest('base64url');
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function sign(obj) {
  const p = Buffer.from(JSON.stringify(obj)).toString('base64url');
  return p + '.' + hmac(p);
}
function unsign(tok) {
  if (typeof tok !== 'string' || tok.length > 600) return null;
  const i = tok.lastIndexOf('.');
  if (i < 1 || !safeEq(tok.slice(i + 1), hmac(tok.slice(0, i)))) return null;
  try { return JSON.parse(Buffer.from(tok.slice(0, i), 'base64url').toString('utf8')); } catch { return null; }
}
const deviceToken = (id) => id + '.' + hmac('d:' + id).slice(0, 32);
function verifyDeviceToken(tok) {
  if (typeof tok !== 'string' || tok.length > 80) return '';
  const [id, mac] = tok.split('.');
  return /^[0-9a-f]{32}$/.test(id || '') && mac && safeEq(mac, hmac('d:' + id).slice(0, 32)) ? id : '';
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 1) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch {}
  });
  return out;
}
function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || !!req.socket.encrypted;
}
function cookieStr(req, name, value, maxAge, sameSite) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=${sameSite}` + (isHttps(req) ? '; Secure' : '');
}

// Permintaan POST dari situs lain ditolak (perlindungan CSRF)
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host || ''); } catch { return false; }
}

const SIG_RE = /^[0-9a-f]{8,64}$/;
const ipKey = (ip) => (net.isIPv6(ip) ? ip.split(':').slice(0, 4).join(':') : ip);

// Identitas perangkat dari: cookie bertanda tangan (HttpOnly) -> header cadangan (localStorage/IndexedDB) -> baru.
// Ditambah sinyal sidik jari (fp, hw) dan jaringan (IP) yang dipakai untuk mengenali perangkat yang sama
// walau pengguna keluar akun, ganti nama, atau menghapus data browser.
function identify(req) {
  const ck = parseCookies(req);
  let id = verifyDeviceToken(ck.amp_did) || verifyDeviceToken(req.headers['x-device']);
  const fresh = !id;
  if (!id) id = crypto.randomBytes(16).toString('hex');
  const pick = (v) => { const s = String(v || '').trim().toLowerCase(); return SIG_RE.test(s) ? s : ''; };
  const fp = pick(req.headers['x-fp']);
  const hw = pick(req.headers['x-hw']);
  const ip = clientIp(req);
  return {
    id, fresh, fp, hw, ip, admin: isAdmin(req),
    ua: String(req.headers['user-agent'] || '').slice(0, 300),
    h: fp || hw ? sha(`${fp}|${hw}|${ipKey(ip)}`).slice(0, 32) : '',
    i: ip ? sha('ip|' + ipKey(ip)).slice(0, 32) : '',
    token: deviceToken(id)
  };
}
function setIdentHeaders(req, res, ident) {
  res.setHeader('Set-Cookie', cookieStr(req, 'amp_did', ident.token, 63072000, 'Lax'));
  res.setHeader('X-Device-Token', ident.token);
}

// Pembatas laju sederhana (di memori)
const buckets = new Map();
function rl(key, max, windowMs) {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 20000) buckets.clear();
  return list.length > max;
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- v4.3: akses Supabase (service role, hanya dari server) ---------- */
async function sb(method, pathq, body, extra) {
  const r = await fetch(SUPABASE_URL + pathq, {
    method,
    headers: Object.assign({
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json'
    }, extra || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) console.warn(`[AM Premify] Supabase ${method} ${pathq.split('?')[0]} -> ${r.status}`, typeof data === 'string' ? data : JSON.stringify(data));
  return { ok: r.ok, status: r.status, data, headers: r.headers };
}
const rest = (p) => '/rest/v1/' + p;
const MIN = { Prefer: 'return=minimal' };

async function sbCount(table, filter) {
  const r = await sb('GET', rest(`${table}?${filter ? filter + '&' : ''}select=id&limit=1`), undefined, { Prefer: 'count=exact' });
  const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
  return r.ok && m ? Number(m[1]) : 0;
}

const PROXY_BLOCKED_HINT = 'Hubungi admin lewat Chat jika ini keliru.';
function blockedText(reason) {
  return 'Fitur premium dinonaktifkan oleh admin untuk perangkat ini.' + (reason ? ' Alasan: ' + reason + '.' : '') + ' ' + PROXY_BLOCKED_HINT;
}

function cleanName(v) {
  return String(v || '').replace(/[<>&"`\\\/{}\[\]|^~$%]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}
const goodName = (n) => n.length >= 2 && /[\p{L}\p{N}]/u.test(n);

// Nama dicadangkan untuk developer ("kenz"): huruf besar/kecil, spasi, simbol, angka mirip huruf (k3nz) dan
// huruf kembar Cyrillic diabaikan. Aturan yang sama ada di SQL (am_reserved_name).
const RESERVED = new Set(['kenz', 'kenzdev', 'kenzdeveloper', 'developerkenz', 'kenzadmin', 'adminkenz', 'kenzofficial', 'officialkenz', 'kenzchillz']);
function normName(n) {
  const a = '013457@$', b = 'oieastas', c = '\u0435\u043a\u043e\u0430\u0455\u0456\u0440\u0441\u0445\u0443', d = 'ekoasipcxy';
  return String(n || '').toLowerCase().replace(/./gu, (ch) => {
    let i = a.indexOf(ch); if (i >= 0) return b[i];
    i = c.indexOf(ch); return i >= 0 ? d[i] : ch;
  }).replace(/[^a-z]/g, '');
}
const isReserved = (n) => RESERVED.has(normName(n));
const RESERVED_MSG = 'Nama ini dicadangkan untuk developer dan tidak bisa dipakai. Pilih nama lain.';

async function getDevice(id) {
  const r = await sb('GET', rest(`am_devices?id=eq.${id}&select=*`));
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

// Catat / perbarui perangkat. Nama baru ikut disimpan ke riwayat nama.
// Hanya SATU perangkat yang boleh memakai nama dicadangkan. Hak itu diberikan ke perangkat yang sedang
// login di /admin (kata sandi admin) dan tersimpan permanen di perangkat tsb (is_dev).
async function claimDev(id) {
  await sb('PATCH', rest('am_devices?is_dev=eq.true'), { is_dev: false }, MIN);
  await sb('PATCH', rest(`am_devices?id=eq.${id}`), { is_dev: true, blocked: false, blocked_at: null, blocked_reason: null, blocked_via: null, block_group: null, allow: true }, MIN);
}

// Catat / perbarui perangkat. Nama baru ikut disimpan ke riwayat nama.
async function touchDevice(ident, nameRaw) {
  let nm = cleanName(nameRaw);
  let named = goodName(nm);
  let rejected = false;
  let dev = await getDevice(ident.id);
  if (named && isReserved(nm)) {
    if (dev && dev.is_dev) { /* developer sah */ }
    else if (ident.admin) { if (!dev) dev = await createDevice(ident, ''); if (dev) { await claimDev(ident.id); dev.is_dev = true; dev.blocked = false; } }
    else { named = false; rejected = true; }
  }
  if (!dev) {
    dev = await createDevice(ident, named ? nm : '');
    if (dev) dev._nameRejected = rejected;
    return dev;
  }
  const patch = {};
  if (ident.fp && ident.fp !== dev.fp) patch.fp = ident.fp;
  if (ident.hw && ident.hw !== dev.hw) patch.hw = ident.hw;
  if (ident.h && ident.h !== dev.hwip) patch.hwip = ident.h;
  if (ident.ip && ident.ip !== dev.ip) patch.ip = ident.ip;
  if (ident.ua && ident.ua !== dev.ua) patch.ua = ident.ua;
  if (named && nm !== dev.name) {
    patch.name = nm;
    patch.names = [nm].concat((dev.names || []).filter((x) => x !== nm)).slice(0, 10);
  }
  // Nama dicadangkan yang pernah tersimpan di perangkat non-developer dibersihkan
  if (!dev.is_dev && dev.name && isReserved(dev.name)) { patch.name = null; rejected = true; }
  const stale = Date.now() - Date.parse(dev.last_seen) > 60000;
  if (Object.keys(patch).length || stale) {
    patch.last_seen = new Date().toISOString();
    await sb('PATCH', rest(`am_devices?id=eq.${ident.id}`), patch, MIN);
    Object.assign(dev, patch);
  }
  dev._nameRejected = rejected;
  return dev;
}

async function createDevice(ident, nm) {
  const row = { id: ident.id, fp: ident.fp || null, hw: ident.hw || null, hwip: ident.h || null, ip: ident.ip || null, ua: ident.ua || null };
  if (nm) { row.name = nm; row.names = [nm]; }
  const r = await sb('POST', rest('am_devices'), row, { Prefer: 'return=representation,resolution=ignore-duplicates' });
  if (r.ok && Array.isArray(r.data) && r.data[0]) return r.data[0];
  return getDevice(ident.id);
}

function signalsOf(d) { // d: { id, fp, h, ip } -> baris untuk am_blocks
  const out = [['d', d.id]];
  if (d.fp) out.push(['f', d.fp]);
  if (d.h) out.push(['h', d.h]);
  if (BLOCK_IP && d.i) out.push(['i', d.i]);
  return out;
}
async function addBlockRows(group, deviceId, d) {
  const rows = signalsOf(d).map(([kind, value]) => ({ kind, value, group_id: group, device_id: deviceId }));
  await sb('POST', rest('am_blocks?on_conflict=kind,value,group_id'), rows, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
}

async function findBlockHit(ident) {
  const c = [];
  if (ident.h) c.push(`and(kind.eq.h,value.eq.${ident.h})`);
  if (BLOCK_FP_STRICT && ident.fp) c.push(`and(kind.eq.f,value.eq.${ident.fp})`);
  if (BLOCK_IP && ident.i) c.push(`and(kind.eq.i,value.eq.${ident.i})`);
  if (!c.length) return null;
  const r = await sb('GET', rest(`am_blocks?or=${encodeURIComponent('(' + c.join(',') + ')')}&select=kind,group_id&limit=1`));
  return r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

// Perangkat baru yang cocok dengan sinyal perangkat terblokir ikut diblokir (mis. setelah hapus data browser)
async function propagateBlock(dev, ident, hit) {
  const orig = await sb('GET', rest(`am_devices?block_group=eq.${hit.group_id}&blocked_via=eq.admin&select=blocked_reason&limit=1`));
  const reason = (orig.ok && orig.data && orig.data[0] && orig.data[0].blocked_reason) || null;
  const patch = {
    blocked: true, blocked_at: new Date().toISOString(), blocked_reason: reason,
    blocked_via: hit.kind === 'f' ? 'fp' : hit.kind === 'h' ? 'jaringan' : 'ip',
    block_group: hit.group_id, allow: false
  };
  await sb('PATCH', rest(`am_devices?id=eq.${dev.id}`), patch, MIN);
  await addBlockRows(hit.group_id, dev.id, ident);
  return Object.assign({}, dev, patch);
}

// Satu pintu pemeriksaan: catat perangkat lalu cek apakah fitur premium dinonaktifkan
async function guard(ident, name) {
  if (!SB_READY) return { dev: null, blocked: false };
  try {
    let dev = await touchDevice(ident, name);
    if (!dev) return { dev: null, blocked: false };
    if (dev.is_dev) return { dev, blocked: false };
    if (dev.blocked) return { dev, blocked: true, reason: dev.blocked_reason || '' };
    if (!dev.allow) {
      const hit = await findBlockHit(ident);
      if (hit) {
        dev = await propagateBlock(dev, ident, hit);
        return { dev, blocked: true, reason: dev.blocked_reason || '' };
      }
    }
    return { dev, blocked: false };
  } catch (err) {
    console.warn('[AM Premify] guard gagal:', err.message);
    return { dev: null, blocked: false };
  }
}

/* ---------- Supabase: catat aktivasi sukses (hanya server yang boleh insert) ---------- */
function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e)) return '';
  if (!MASK_EMAIL) return e;
  const [u, d] = e.split('@');
  // 5 huruf pertama tetap terlihat, sisanya disensor; domain (@gmail.com dll) tetap utuh
  return u.length > 5 ? u.slice(0, 5) + '***@' + d : e;
}

function fullEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(e) ? e : '';
}

async function insertActivation(row) {
  return fetch(`${SUPABASE_URL}/rest/v1/activations`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
}

// Catat aktivasi sukses beserta nama pengguna; pemilik (perangkat) disimpan di tabel privat
async function recordActivation(email, dev, ident) {
  if (!SB_READY) return false;
  try {
    const safe = cleanEmail(email);
    const name = dev && dev.name ? dev.name : '';
    const attempts = [];
    const base = { source: 'verify' };
    if (safe) base.email = safe;
    if (name) attempts.push(Object.assign({ name }, base));
    attempts.push(base);                       // kolom name belum ada (supabase.sql belum dijalankan)?
    if (safe) attempts.push({ source: 'verify' }); // kolom email belum ada?
    let r = null, created = null;
    for (const row of attempts) {
      r = await insertActivation(row);
      if (r.ok) { try { created = (await r.json())[0]; } catch {} break; }
      console.warn('[AM Premify] Insert aktivasi gagal (' + r.status + '), coba bentuk lain. Jalankan supabase.sql.');
    }
    if (!r || !r.ok) { console.warn('[AM Premify] Supabase insert gagal:', r && r.status); return false; }
    if (created && created.id && dev) {
      const owner = { activation_id: created.id, device_id: dev.id, ip: ident ? ident.ip || null : null };
      const full = fullEmail(email);
      // v4.5: email lengkap disimpan di tabel privat (hanya admin yang bisa melihat). Jika kolom belum ada, simpan tanpa email.
      const o = await sb('POST', rest('am_act_owner'), full ? Object.assign({ email: full }, owner) : owner, MIN);
      if (!o.ok && full) await sb('POST', rest('am_act_owner'), owner, MIN);
    }
    return true;
  } catch (err) {
    console.warn('[AM Premify] Supabase tidak terjangkau:', err.message);
    return false;
  }
}

/* ---------- Cloudflare Turnstile: validasi token di server ---------- */
async function verifyTurnstile(token, ip) {
  if (!token || typeof token !== 'string' || token.length > 2048) return false;
  try {
    const params = new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token });
    if (ip && net.isIP(ip)) params.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: params, signal: AbortSignal.timeout(8000)
    });
    const d = await r.json();
    return d.success === true;
  } catch (err) {
    console.warn('[AM Premify] Turnstile tidak terjangkau:', err.message);
    return false;
  }
}

/* ---------- Proxy ke upstream ---------- */
async function proxyUpstream(req, res, pathname) {
  try {
    if (!sameOrigin(req)) return sendJson(res, 403, { success: false, error: 'Permintaan ditolak.' });
    const payload = await readJson(req, 64 * 1024);
    if (!payload) return sendJson(res, 413, { success: false, error: 'Permintaan terlalu besar.' });

    // Identitas perangkat + batas laju + pemeriksaan blokir (dicek di server, tidak bisa dilewati dari browser)
    const ident = identify(req);
    setIdentHeaders(req, res, ident);
    if (rl('act:' + ident.id, ACT_LIMIT, 10 * 60000) || rl('actip:' + ident.ip, ACT_LIMIT * 3, 10 * 60000)) {
      return sendJson(res, 429, { success: false, error: 'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.' });
    }
    const name = payload.name;
    delete payload.name;
    const g = await guard(ident, name);
    if (g.blocked) return sendJson(res, 403, { success: false, blocked: true, error: blockedText(g.reason) });

    // Verifikasi VIP wajib lolos Cloudflare Turnstile (dicek di server, bukan hanya di browser)
    let activationEmail = '';
    if (pathname === '/api/verify-link') {
      const okHuman = await verifyTurnstile(payload.cfToken, ident.ip);
      if (!okHuman) return sendJson(res, 403, { success: false, error: 'Verifikasi manusia (Cloudflare) gagal atau kedaluwarsa. Ulangi verifikasi.' });
      activationEmail = payload.email;
      delete payload.cfToken;
    }

    const r = await fetch(UPSTREAM + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    let text = await r.text();

    if (pathname === '/api/verify-link') {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const ok = r.ok && data.success !== false && !data.error;
          if (ok) {
            data.recorded = await recordActivation(activationEmail, g.dev, ident);
            text = JSON.stringify(data);
          }
        }
      } catch {}
    }

    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8' });
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { success: false, error: err.message });
  }
}

/* ---------- Info pengunjung (IP asli + lokasi + ISP) ---------- */
const geoCache = new Map();   // ip -> { at, data }
const rate = new Map();       // ip -> [timestamps]

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const real = String(req.headers['x-real-ip'] || '').trim();
  const raw = xff || real || req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/i, '');
}

function isPrivateIp(ip) {
  return !ip || !net.isIP(ip) || ip === '::1' ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|fc|fd|fe80)/i.test(ip);
}

function limited(key) {
  const now = Date.now();
  const list = (rate.get(key) || []).filter((t) => now - t < 60000);
  list.push(now);
  rate.set(key, list);
  if (rate.size > 5000) rate.clear();
  return list.length > 20; // maks 20 permintaan / menit
}

const UA = { 'User-Agent': 'AM-Premify/3.0' };

async function fetchText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(4500), headers: UA });
  if (!r.ok) throw new Error('status ' + r.status);
  return (await r.text()).trim();
}

// IPv4 publik perangkat ini (dipakai saat panel diakses lewat localhost / jaringan lokal).
// Beberapa layanan dicoba bersamaan, yang tercepat dipakai.
const IP_SERVICES = [ // semua layanan ini hanya mengembalikan IPv4
  'https://api.ipify.org',
  'https://ipv4.icanhazip.com',
  'https://v4.ident.me',
  'https://checkip.amazonaws.com'
];
let selfIpCache = { at: 0, ip: '' };

async function selfPublicIp() {
  if (selfIpCache.ip && Date.now() - selfIpCache.at < 5 * 60 * 1000) return selfIpCache.ip;
  try {
    const ip = await Promise.any(IP_SERVICES.map(async (u) => {
      const t = await fetchText(u);
      if (!net.isIPv4(t)) throw new Error('bukan IPv4');
      return t;
    }));
    selfIpCache = { at: Date.now(), ip };
    return ip;
  } catch {
    return '';
  }
}

// Lokasi + ISP untuk sebuah IP (opsional; kalau gagal IP tetap ditampilkan)
async function geoLookup(ip) {
  const attempts = [
    async () => {
      const d = JSON.parse(await fetchText(`https://ipwho.is/${ip}`));
      if (!d.success) throw new Error('ipwho');
      return { ip: d.ip, city: d.city, country: d.country, isp: (d.connection && (d.connection.org || d.connection.isp)) || '' };
    },
    async () => {
      const d = JSON.parse(await fetchText(`https://ipapi.co/${ip ? ip + '/' : ''}json/`));
      if (d.error) throw new Error('ipapi');
      return { ip: d.ip, city: d.city, country: d.country_name, isp: d.org || '' };
    },
    async () => {
      const d = JSON.parse(await fetchText(`https://ipinfo.io/${ip ? ip + '/' : ''}json`));
      if (!d.ip) throw new Error('ipinfo');
      return { ip: d.ip, city: d.city, country: d.country, isp: d.org || '' };
    }
  ];
  for (const attempt of attempts) {
    try { return await attempt(); } catch {}
  }
  return null;
}

async function handleVisitor(req, res) {
  if (limited(req.socket.remoteAddress || 'x')) return sendJson(res, 429, { error: 'Terlalu banyak permintaan, coba lagi sebentar.' });

  const raw = clientIp(req);
  const hint = new URL(req.url, 'http://localhost').searchParams.get('ip') || '';
  const useHint = net.isIPv4(hint) && !isPrivateIp(hint); // IPv4 yang sudah dideteksi browser
  let ip = useHint ? hint : (isPrivateIp(raw) ? await selfPublicIp() : raw);

  // Langkah 1: pastikan IP terdeteksi (tidak bergantung pada layanan lokasi)
  let geo = null;
  if (!ip) {
    geo = await geoLookup('');
    ip = geo && geo.ip;
  }
  if (!ip) return sendJson(res, 502, { error: 'Server tidak dapat menjangkau layanan deteksi IP' });

  // Langkah 2: lokasi + ISP (opsional, di-cache 10 menit)
  const hit = geoCache.get(ip);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) geo = hit.data;
  else if (!geo || !geo.city) {
    geo = (await geoLookup(ip)) || geo;
    if (geo) geoCache.set(ip, { at: Date.now(), data: geo });
  }

  const g = geo || {};
  const place = g.city && g.country && g.city !== g.country ? `${g.city}, ${g.country}` : (g.country || g.city || '');
  sendJson(res, 200, { ip, location: place, isp: g.isp || '' });
}

/* =====================================================================
   v4.3 - CHAT PENGGUNA <-> ADMIN
   Pengguna dikenali dari token perangkat bertanda tangan (bukan dari nama),
   jadi tidak ada yang bisa membaca chat perangkat lain.
   ===================================================================== */
function cleanMsg(v) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
}

async function loadMessages(deviceId, after) {
  const cols = 'id,sender,body,created_at';
  if (after > 0) {
    const r = await sb('GET', rest(`am_chat?device_id=eq.${deviceId}&id=gt.${after}&select=${cols}&order=id.asc&limit=100`));
    return r.ok && Array.isArray(r.data) ? r.data : [];
  }
  const r = await sb('GET', rest(`am_chat?device_id=eq.${deviceId}&select=${cols}&order=id.desc&limit=100`));
  return r.ok && Array.isArray(r.data) ? r.data.reverse() : [];
}

async function handleMe(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  if (rl('me:' + clientIp(req), 40, 60000)) return sendJson(res, 429, { error: 'Terlalu banyak permintaan.' });
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 413, { error: 'Permintaan terlalu besar.' });
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) return sendJson(res, 200, { ok: true, configured: false, blocked: false, unread: 0, dev: false, nameRejected: isReserved(body.name) && !ident.admin });
  const g = await guard(ident, body.name);
  const unread = g.dev ? await sbCount('am_chat', `device_id=eq.${ident.id}&sender=eq.admin&read_at=is.null`) : 0;
  sendJson(res, 200, { ok: true, configured: true, blocked: !!g.blocked, reason: g.reason || '', unread, token: ident.token, dev: !!(g.dev && g.dev.is_dev), nameRejected: !!(g.dev && g.dev._nameRejected) });
}

// Dicek saat pengguna memilih nama (layar sambutan). Nama dicadangkan hanya lolos untuk developer.
// v4.5: developer cukup mengetik nama "kenz" + kata sandi admin di layar yang sama (tanpa harus login /admin dulu).
const devPassFails = new Map(); // ip -> { n, until }
function devPassWait(ip) { const f = devPassFails.get(ip); return f && f.until > Date.now() ? f.until - Date.now() : 0; }
function devPassFail(ip) {
  const f = devPassFails.get(ip) || { n: 0, until: 0 };
  if (f.until && f.until <= Date.now()) { f.n = 0; f.until = 0; }
  if (++f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; }
  devPassFails.set(ip, f);
  if (devPassFails.size > 5000) devPassFails.clear();
}
async function handleName(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  if (rl('name:' + clientIp(req), 30, 60000)) return sendJson(res, 429, { error: 'Terlalu banyak percobaan. Tunggu sebentar.' });
  const body = await readJson(req, 2048);
  if (!body) return sendJson(res, 413, { error: 'Permintaan terlalu besar.' });
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  const nm = cleanName(body.name);
  if (!isReserved(nm)) return sendJson(res, 200, { ok: true, dev: false });
  if (SB_READY) {
    const dev = await getDevice(ident.id);
    if (dev && dev.is_dev) return sendJson(res, 200, { ok: true, dev: true });
  }
  if (ident.admin) {
    if (SB_READY) { const d = await touchDevice(ident, nm); if (!d || !d.is_dev) return sendJson(res, 502, { error: 'Gagal menyimpan status developer.' }); }
    return sendJson(res, 200, { ok: true, dev: true });
  }
  const pass = typeof body.pass === 'string' ? body.pass : '';
  if (!ADMIN_PASSWORD) return sendJson(res, 409, { error: RESERVED_MSG + ' (Pemilik: isi ADMIN_PASSWORD di .env agar developer bisa membuktikan diri.)', reserved: true });
  if (!pass) return sendJson(res, 409, { error: 'Nama ini khusus developer. Masukkan kata sandi developer (sama dengan kata sandi /admin) untuk memakainya.', reserved: true, needPass: true });
  const wait = devPassWait(ident.ip);
  if (wait > 0) return sendJson(res, 429, { error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil(wait / 60000)} menit lagi.`, reserved: true, needPass: true });
  if (!safeEq(sha(pass), sha(ADMIN_PASSWORD))) {
    devPassFail(ident.ip);
    console.warn('[AM Premify] Kata sandi developer SALAH dari ' + ident.ip);
    await sleepMs(500 + Math.floor(Math.random() * 400));
    return sendJson(res, 401, { error: 'Kata sandi developer salah.', reserved: true, needPass: true });
  }
  devPassFails.delete(ident.ip);
  if (SB_READY) {
    const d = await touchDevice(Object.assign({}, ident, { admin: true }), nm);
    if (!d || !d.is_dev) return sendJson(res, 502, { error: 'Gagal menyimpan status developer.' });
  }
  console.log('[AM Premify] Perangkat developer diverifikasi lewat kata sandi dari ' + ident.ip);
  return sendJson(res, 200, { ok: true, dev: true });
}

// Developer menautkan identitas anonim Supabase-nya supaya ulasan bernama "kenz" diizinkan oleh database
async function handleDevLink(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY || !SUPABASE_ANON_KEY) return sendJson(res, 503, { error: 'Supabase belum dikonfigurasi.' });
  if (rl('devlink:' + ident.id, 10, 60000)) return sendJson(res, 429, { error: 'Terlalu sering.' });
  const dev = await getDevice(ident.id);
  if (!dev || !dev.is_dev) return sendJson(res, 403, { error: 'Bukan perangkat developer.' });
  const body = await readJson(req, 4096);
  const token = body && typeof body.token === 'string' ? body.token : '';
  if (!token || token.length > 4000) return sendJson(res, 400, { error: 'Token tidak valid.' });
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
    const u = await r.json();
    if (!r.ok || !u || !/^[0-9a-f-]{36}$/.test(u.id || '')) return sendJson(res, 401, { error: 'Sesi tidak valid.' });
    await sb('POST', rest('am_devs?on_conflict=uid'), { uid: u.id, device_id: ident.id }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    return sendJson(res, 200, { ok: true });
  } catch (err) { return sendJson(res, 502, { error: 'Gagal memverifikasi sesi.' }); }
}

async function handleChatGet(req, res, url) {
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) return sendJson(res, 503, { error: 'Chat butuh Supabase. Isi .env dan jalankan supabase.sql.' });
  if (rl('chatget:' + ident.id, 60, 60000) || rl('chatgetip:' + ident.ip, 240, 60000)) return sendJson(res, 429, { error: 'Terlalu sering memuat.' });
  const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
  const [messages, unread, dev] = await Promise.all([
    loadMessages(ident.id, after),
    sbCount('am_chat', `device_id=eq.${ident.id}&sender=eq.admin&read_at=is.null`),
    getDevice(ident.id)
  ]);
  sendJson(res, 200, { messages, unread, blocked: !!(dev && dev.blocked), reason: (dev && dev.blocked_reason) || '' });
}

async function handleChatUnread(req, res) {
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) return sendJson(res, 200, { unread: 0, blocked: false });
  if (rl('chatun:' + ident.id, 30, 60000) || rl('chatunip:' + ident.ip, 120, 60000)) return sendJson(res, 429, { error: 'Terlalu sering memuat.' });
  const [unread, dev] = await Promise.all([
    sbCount('am_chat', `device_id=eq.${ident.id}&sender=eq.admin&read_at=is.null`),
    getDevice(ident.id)
  ]);
  sendJson(res, 200, { unread, blocked: !!(dev && dev.blocked), reason: (dev && dev.blocked_reason) || '' });
}

async function handleChatSend(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) return sendJson(res, 503, { error: 'Chat butuh Supabase.' });
  if (rl('chatsend:' + ident.id, 8, 30000) || rl('chatsendip:' + ident.ip, 40, 60000)) {
    return sendJson(res, 429, { error: 'Pesan terlalu cepat. Tunggu sebentar.' });
  }
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 413, { error: 'Pesan terlalu besar.' });
  const text = cleanMsg(body.body);
  if (!text) return sendJson(res, 400, { error: 'Pesan kosong.' });
  const dev = await touchDevice(ident, body.name); // chat tetap bisa dipakai walau premium dinonaktifkan
  if (!dev) return sendJson(res, 502, { error: 'Gagal menyimpan pesan.' });
  const r = await sb('POST', rest('am_chat'), { device_id: ident.id, sender: 'user', body: text }, { Prefer: 'return=representation' });
  if (!r.ok || !r.data || !r.data[0]) return sendJson(res, 502, { error: 'Gagal mengirim pesan.' });
  const m = r.data[0];
  sendJson(res, 200, { ok: true, message: { id: m.id, sender: m.sender, body: m.body, created_at: m.created_at } });
}

async function handleChatRead(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) return sendJson(res, 200, { ok: true });
  if (rl('chatread:' + ident.id, 30, 60000)) return sendJson(res, 429, { error: 'Terlalu sering.' });
  await sb('PATCH', rest(`am_chat?device_id=eq.${ident.id}&sender=eq.admin&read_at=is.null`), { read_at: new Date().toISOString() }, MIN);
  sendJson(res, 200, { ok: true });
}

/* =====================================================================
   v4.3 - MENU ADMIN (/admin)
   Login dengan ADMIN_PASSWORD di .env -> cookie HttpOnly + SameSite=Strict
   bertanda tangan, kedaluwarsa 12 jam. Semua aksi lewat server.
   ===================================================================== */
const adminFails = new Map(); // ip -> { n, until }
let adminGlobal = { n: 0, until: 0, first: 0 };
const ADMIN_TTL = 12 * 3600 * 1000;
const pwv = () => sha(ADMIN_PASSWORD).slice(0, 10);

function isAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const t = unsign(parseCookies(req).amp_adm);
  return !!(t && t.r === 'admin' && t.exp > Date.now() && t.pv === pwv());
}

// Aksi tulis wajib: asal sama + header khusus (tidak bisa dikirim lintas situs tanpa izin CORS)
function adminGuard(req, res, write) {
  if (!ADMIN_PASSWORD) { sendJson(res, 503, { error: 'ADMIN_PASSWORD belum diisi di .env' }); return false; }
  if (!isAdmin(req)) { sendJson(res, 401, { error: 'Sesi admin berakhir. Masuk lagi.' }); return false; }
  if (write && (!sameOrigin(req) || req.headers['x-requested-with'] !== 'am-admin')) {
    sendJson(res, 403, { error: 'Permintaan ditolak.' }); return false;
  }
  if (rl('adm:' + clientIp(req), 300, 60000)) { sendJson(res, 429, { error: 'Terlalu banyak permintaan.' }); return false; }
  if (!SB_READY) { sendJson(res, 503, { error: 'Supabase belum dikonfigurasi (.env).' }); return false; }
  res.setHeader('Cache-Control', 'no-store');
  return true;
}

async function adminLogin(req, res) {
  if (!ADMIN_PASSWORD) return sendJson(res, 503, { error: 'ADMIN_PASSWORD belum diisi di file .env' });
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Permintaan ditolak.' });
  const ip = clientIp(req), now = Date.now();
  const f = adminFails.get(ip);
  const wait = Math.max(f && f.until > now ? f.until - now : 0, adminGlobal.until > now ? adminGlobal.until - now : 0);
  if (wait > 0) return sendJson(res, 429, { error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil(wait / 60000)} menit lagi.` });
  const body = await readJson(req, 2048);
  const ok = !!body && typeof body.password === 'string' && safeEq(sha(body.password), sha(ADMIN_PASSWORD));
  if (!ok) {
    const cur = f && !(f.until && f.until <= now) ? f : { n: 0, until: 0 };
    cur.n++;
    if (cur.n >= 5) { cur.until = now + 15 * 60000; cur.n = 0; }
    adminFails.set(ip, cur);
    if (adminFails.size > 5000) adminFails.clear();
    if (now - adminGlobal.first > 15 * 60000) adminGlobal = { n: 0, until: 0, first: now };
    if (++adminGlobal.n >= 40) adminGlobal.until = now + 15 * 60000;
    console.warn('[AM Premify] Login admin GAGAL dari ' + ip);
    await sleepMs(600 + Math.floor(Math.random() * 400));
    return sendJson(res, 401, { error: 'Kata sandi salah.' });
  }
  adminFails.delete(ip);
  const token = sign({ r: 'admin', exp: now + ADMIN_TTL, pv: pwv() });
  res.setHeader('Set-Cookie', cookieStr(req, 'amp_adm', token, ADMIN_TTL / 1000, 'Strict'));
  sendJson(res, 200, { ok: true });
}

const HEX32 = /^[0-9a-f]{32}$/;

async function adminApi(req, res, url, pathname) {
  const method = req.method;

  if (pathname === '/api/admin/status' && method === 'GET') {
    return sendJson(res, 200, { configured: !!ADMIN_PASSWORD, supabase: SB_READY, authed: isAdmin(req), strict: BLOCK_FP_STRICT });
  }
  if (pathname === '/api/admin/login' && method === 'POST') return adminLogin(req, res);
  if (pathname === '/api/admin/logout' && method === 'POST') {
    res.setHeader('Set-Cookie', cookieStr(req, 'amp_adm', '', 0, 'Strict'));
    return sendJson(res, 200, { ok: true });
  }

  const write = method !== 'GET';
  if (!adminGuard(req, res, write)) return;

  if (pathname === '/api/admin/overview' && method === 'GET') {
    const [unread, devices, blocked] = await Promise.all([
      sbCount('am_chat', 'sender=eq.user&read_at=is.null'),
      sbCount('am_devices', ''),
      sbCount('am_devices', 'blocked=eq.true')
    ]);
    return sendJson(res, 200, { unread, devices, blocked });
  }

  if (pathname === '/api/admin/activations' && method === 'GET') {
    const before = parseInt(url.searchParams.get('before'), 10) || null;
    const r = await sb('POST', rest('rpc/am_activations_admin'), { lim: 40, before_id: before });
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat aktivasi. Sudah menjalankan supabase.sql v4.3?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/threads' && method === 'GET') {
    const r = await sb('POST', rest('rpc/am_chat_threads'), { lim: 60 });
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat chat. Sudah menjalankan supabase.sql v4.3?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/devices' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').slice(0, 40).replace(/[%_\\]/g, '');
    const r = await sb('POST', rest('rpc/am_devices_overview'), { q, lim: 80 });
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat perangkat. Sudah menjalankan supabase.sql v4.3?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/chat' && method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!HEX32.test(id)) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
    const first = after === 0;
    const [messages, dev] = await Promise.all([loadMessages(id, after), first ? getDevice(id) : null]);
    if (url.searchParams.get('mark') === '1') {
      await sb('PATCH', rest(`am_chat?device_id=eq.${id}&sender=eq.user&read_at=is.null`), { read_at: new Date().toISOString() }, MIN);
    }
    const out = { messages };
    if (first) {
      if (!dev) return sendJson(res, 404, { error: 'Perangkat tidak ditemukan.' });
      const own = await sb('GET', rest(`am_act_owner?device_id=eq.${id}&select=activation_id,ip&order=activation_id.desc&limit=6`));
      let acts = [];
      if (own.ok && own.data && own.data.length) {
        const ids = own.data.map((o) => o.activation_id).join(',');
        const a = await sb('GET', rest(`activations?id=in.(${ids})&select=id,created_at,email&order=id.desc`));
        acts = a.ok && Array.isArray(a.data) ? a.data : [];
      }
      out.device = {
        id: dev.id, name: dev.name, names: dev.names || [], ip: dev.ip, ua: dev.ua,
        first_seen: dev.first_seen, last_seen: dev.last_seen,
        blocked: dev.blocked, blocked_reason: dev.blocked_reason, blocked_via: dev.blocked_via, allow: dev.allow
      };
      out.activations = acts;
      out.acts_total = await sbCount('am_act_owner', `device_id=eq.${id}`);
    }
    return sendJson(res, 200, out);
  }

  if (pathname === '/api/admin/chat' && method === 'POST') {
    const body = await readJson(req, 4096);
    if (!body || !HEX32.test(String(body.id || ''))) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const text = cleanMsg(body.body);
    if (!text) return sendJson(res, 400, { error: 'Pesan kosong.' });
    if (!(await getDevice(body.id))) return sendJson(res, 404, { error: 'Perangkat tidak ditemukan.' });
    const r = await sb('POST', rest('am_chat'), { device_id: body.id, sender: 'admin', body: text }, { Prefer: 'return=representation' });
    if (!r.ok || !r.data || !r.data[0]) return sendJson(res, 502, { error: 'Gagal mengirim pesan.' });
    const m = r.data[0];
    return sendJson(res, 200, { ok: true, message: { id: m.id, sender: m.sender, body: m.body, created_at: m.created_at } });
  }

  if (pathname === '/api/admin/block' && method === 'POST') {
    const body = await readJson(req, 2048);
    if (!body || !HEX32.test(String(body.id || ''))) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const dev = await getDevice(body.id);
    if (!dev) return sendJson(res, 404, { error: 'Perangkat tidak ditemukan.' });
    if (dev.is_dev) return sendJson(res, 400, { error: 'Perangkat developer tidak bisa diblokir.' });
    const reason = cleanMsg(body.reason).replace(/\n+/g, ' ').slice(0, 120) || null;
    const group = crypto.randomUUID();
    const now = new Date().toISOString();
    const sig = { id: dev.id, fp: dev.fp || '', h: dev.hwip || '', i: dev.ip ? sha('ip|' + ipKey(dev.ip)).slice(0, 32) : '' };
    await sb('PATCH', rest(`am_devices?id=eq.${dev.id}`),
      { blocked: true, blocked_at: now, blocked_reason: reason, blocked_via: 'admin', block_group: group, allow: false }, MIN);
    await addBlockRows(group, dev.id, sig);
    // Identitas lain yang jelas perangkat yang sama (sidik jari + jaringan sama) langsung ikut diblokir
    const rel = [];
    if (dev.hwip) rel.push(`hwip.eq.${dev.hwip}`);
    if (BLOCK_FP_STRICT && dev.fp) rel.push(`fp.eq.${dev.fp}`);
    let related = 0;
    if (rel.length) {
      const r = await sb('GET', rest(`am_devices?or=${encodeURIComponent('(' + rel.join(',') + ')')}&id=neq.${dev.id}&blocked=eq.false&allow=eq.false&select=id,fp,hwip,ip&limit=50`));
      for (const o of (r.ok && Array.isArray(r.data) ? r.data : [])) {
        await sb('PATCH', rest(`am_devices?id=eq.${o.id}`),
          { blocked: true, blocked_at: now, blocked_reason: reason, blocked_via: o.hwip === dev.hwip ? 'jaringan' : 'fp', block_group: group }, MIN);
        await addBlockRows(group, o.id, { id: o.id, fp: o.fp || '', h: o.hwip || '', i: '' });
        related++;
      }
    }
    return sendJson(res, 200, { ok: true, related });
  }

  if (pathname === '/api/admin/unblock' && method === 'POST') {
    const body = await readJson(req, 2048);
    if (!body || !HEX32.test(String(body.id || ''))) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const dev = await getDevice(body.id);
    if (!dev) return sendJson(res, 404, { error: 'Perangkat tidak ditemukan.' });
    const clear = { blocked: false, blocked_at: null, blocked_reason: null, blocked_via: null, block_group: null };
    if (dev.blocked && dev.blocked_via === 'admin' && dev.block_group) {
      // Perangkat yang diblokir langsung oleh admin: seluruh kelompok blokirnya dilepas
      await sb('PATCH', rest(`am_devices?block_group=eq.${dev.block_group}`), clear, MIN);
      await sb('DELETE', rest(`am_blocks?group_id=eq.${dev.block_group}`), undefined, MIN);
    } else {
      // Terblokir otomatis (kemungkinan salah deteksi): hanya perangkat ini yang dilepas dan dikecualikan
      await sb('PATCH', rest(`am_devices?id=eq.${dev.id}`), Object.assign({ allow: true }, clear), MIN);
      if (dev.block_group) await sb('DELETE', rest(`am_blocks?group_id=eq.${dev.block_group}&device_id=eq.${dev.id}`), undefined, MIN);
    }
    return sendJson(res, 200, { ok: true });
  }


  /* ---------- v4.5: pengguna, moderasi room & balasan ---------- */
  if (pathname === '/api/admin/users' && method === 'GET') {
    const q = String(url.searchParams.get('q') || '').slice(0, 40).replace(/[%_\\]/g, '');
    const only = url.searchParams.get('only') !== '0';
    const sort = url.searchParams.get('sort') === 'recent' ? 'recent' : 'acts';
    const r = await sb('POST', rest('rpc/am_users_admin'), { q, only_acts: only, sort, lim: 120 });
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat pengguna. Sudah menjalankan supabase.sql v4.5?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/user-acts' && method === 'GET') {
    const id = String(url.searchParams.get('id') || '');
    if (!HEX32.test(id)) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const r = await sb('POST', rest('rpc/am_user_acts'), { dev: id, lim: 200 });
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat email. Sudah menjalankan supabase.sql v4.5?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/room' && method === 'GET') {
    const r = await sb('GET', rest('am_room?select=id,device_id,name,verified,body,created_at&order=id.desc&limit=80'));
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat room. Sudah menjalankan supabase.sql v4.5?' });
    return sendJson(res, 200, { rows: r.data || [], online: roomOnline() });
  }

  if (pathname === '/api/admin/room/delete' && method === 'POST') {
    const body = await readJson(req, 512);
    const id = String((body && body.id) || '');
    if (!/^\d{1,18}$/.test(id)) return sendJson(res, 400, { error: 'ID tidak valid.' });
    await sb('DELETE', rest(`am_room?id=eq.${id}`), undefined, MIN);
    noteRoomDeleted(id);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/replies' && method === 'GET') {
    const r = await sb('GET', rest('am_review_replies?select=id,review_id,device_id,name,verified,body,created_at&order=id.desc&limit=80'));
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat balasan. Sudah menjalankan supabase.sql v4.5?' });
    return sendJson(res, 200, { rows: r.data || [] });
  }

  if (pathname === '/api/admin/reply/delete' && method === 'POST') {
    const body = await readJson(req, 512);
    const id = String((body && body.id) || '');
    if (!/^\d{1,18}$/.test(id)) return sendJson(res, 400, { error: 'ID tidak valid.' });
    await sb('DELETE', rest(`am_review_replies?id=eq.${id}`), undefined, MIN);
    await sb('DELETE', rest(`am_likes?kind=eq.p&target=eq.${id}`), undefined, MIN);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/mute' && method === 'POST') {
    const body = await readJson(req, 512);
    if (!body || !HEX32.test(String(body.id || ''))) return sendJson(res, 400, { error: 'ID perangkat tidak valid.' });
    const dev = await getDevice(body.id);
    if (!dev) return sendJson(res, 404, { error: 'Perangkat tidak ditemukan.' });
    if (dev.is_dev) return sendJson(res, 400, { error: 'Developer tidak bisa dibisukan.' });
    const minutes = Math.max(0, Math.min(60 * 24 * 30, Math.floor(Number(body.minutes) || 0)));
    const until = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    const r = await sb('PATCH', rest(`am_devices?id=eq.${dev.id}`), { muted_until: until }, MIN);
    if (!r.ok) return sendJson(res, 502, { error: 'Gagal menyimpan. Sudah menjalankan supabase.sql v4.5?' });
    return sendJson(res, 200, { ok: true, muted_until: until });
  }

  return sendJson(res, 404, { error: 'Not Found' });
}

/* =====================================================================
   v4.5 - BALASAN & LIKE ULASAN, ROOM PUBLIK
   Identitas = token perangkat bertanda tangan (bukan nama). Nama & centang developer
   ditentukan SERVER dari data perangkat, jadi tidak bisa dipalsukan dari browser.
   ===================================================================== */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const roomPresence = new Map(); // deviceId -> waktu terakhir terlihat di room
const roomDeleted = [];         // { id, at } pesan room yang baru dihapus (agar klien lain ikut menghapus)
const lastPost = new Map();     // deviceId -> { body, at } cegah kirim ulang isi yang sama berturut-turut

function cleanText(v, max) {
  return cleanMsg(v).replace(/\n{2,}/g, '\n').slice(0, max);
}
const isMuted = (dev) => !!(dev && dev.muted_until && Date.parse(dev.muted_until) > Date.now());
const mutedText = (dev) => 'Kamu dibisukan admin sampai ' + new Date(dev.muted_until).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(':', '.') + ' WIB.';
function isDup(id, body) {
  const l = lastPost.get(id), now = Date.now();
  if (l && l.body === body && now - l.at < 30000) return true;
  lastPost.set(id, { body, at: now });
  if (lastPost.size > 5000) lastPost.clear();
  return false;
}

// Siapkan pelaku: perangkat tercatat, nama dari server, status bisu. Mengirim respons error sendiri jika gagal.
async function actor(req, res, nameRaw, write) {
  if (write && !sameOrigin(req)) { sendJson(res, 403, { error: 'Permintaan ditolak.' }); return null; }
  const ident = identify(req);
  setIdentHeaders(req, res, ident);
  if (!SB_READY) { sendJson(res, 503, { error: 'Fitur ini butuh Supabase. Isi .env dan jalankan supabase.sql.' }); return null; }
  const dev = await touchDevice(ident, nameRaw);
  if (!dev) { sendJson(res, 502, { error: 'Gagal mengenali perangkat. Coba lagi.' }); return null; }
  return { ident, dev, admin: !!ident.admin };
}
function postingName(res, a) {
  const nm = a.dev.name;
  if (!nm || !goodName(nm)) { sendJson(res, 400, { error: 'Isi namamu dulu (menu profil) sebelum ikut berkomentar.' }); return null; }
  if (isMuted(a.dev)) { sendJson(res, 403, { error: mutedText(a.dev), muted: true }); return null; }
  return nm;
}
const isVerified = (dev) => !!(dev && dev.is_dev && dev.name && isReserved(dev.name));

async function handleSocialStats(req, res, url) {
  const a = await actor(req, res, '', false); if (!a) return;
  if (rl('sst:' + a.ident.id, 40, 60000) || rl('sstip:' + a.ident.ip, 240, 60000)) return sendJson(res, 429, { error: 'Terlalu sering memuat.' });
  const ids = String(url.searchParams.get('ids') || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => UUID_RE.test(x)).slice(0, 40);
  if (!ids.length) return sendJson(res, 200, { stats: {} });
  const r = await sb('POST', rest('rpc/am_review_social'), { ids, me: a.ident.id });
  if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat balasan. Sudah menjalankan supabase.sql v4.5?' });
  const stats = {};
  (Array.isArray(r.data) ? r.data : []).forEach((x) => { stats[x.review_id] = { replies: Number(x.replies) || 0, likes: Number(x.likes) || 0, liked: !!x.liked }; });
  sendJson(res, 200, { stats });
}

async function handleSocialReplies(req, res, url) {
  const a = await actor(req, res, '', false); if (!a) return;
  if (rl('srp:' + a.ident.id, 60, 60000) || rl('srpip:' + a.ident.ip, 300, 60000)) return sendJson(res, 429, { error: 'Terlalu sering memuat.' });
  const rid = String(url.searchParams.get('review') || '').toLowerCase();
  if (!UUID_RE.test(rid)) return sendJson(res, 400, { error: 'ID ulasan tidak valid.' });
  const r = await sb('POST', rest('rpc/am_replies_list'), { rid, me: a.ident.id, lim: 200 });
  if (!r.ok) return sendJson(res, 502, { error: 'Gagal memuat balasan. Sudah menjalankan supabase.sql v4.5?' });
  const replies = (Array.isArray(r.data) ? r.data : []).map((x) => ({
    id: x.id, name: x.name, verified: !!x.verified, to_name: x.to_name || '', body: x.body, created_at: x.created_at,
    likes: Number(x.likes) || 0, liked: !!x.liked, mine: !!x.mine, can_del: !!x.mine || a.admin
  }));
  sendJson(res, 200, { replies });
}

async function handleSocialReply(req, res) {
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 413, { error: 'Balasan terlalu besar.' });
  const a = await actor(req, res, body.name, true); if (!a) return;
  if (rl('srsend:' + a.ident.id, 6, 30000) || rl('srsendip:' + a.ident.ip, 40, 60000)) return sendJson(res, 429, { error: 'Terlalu cepat. Tunggu sebentar.' });
  const nm = postingName(res, a); if (!nm) return;
  const review = String(body.review || '').toLowerCase();
  if (!UUID_RE.test(review)) return sendJson(res, 400, { error: 'ID ulasan tidak valid.' });
  const text = cleanText(body.body, 400);
  if (!text) return sendJson(res, 400, { error: 'Balasan kosong.' });
  if (isDup(a.ident.id, 'r|' + review + '|' + text)) return sendJson(res, 429, { error: 'Balasan yang sama baru saja terkirim.' });
  const exists = await sb('GET', rest(`reviews?id=eq.${review}&hidden=eq.false&select=id&limit=1`));
  if (!exists.ok || !Array.isArray(exists.data) || !exists.data.length) return sendJson(res, 404, { error: 'Ulasan tidak ditemukan atau sudah dihapus.' });
  const to = cleanName(body.to_name) || null;
  const r = await sb('POST', rest('am_review_replies'), { review_id: review, device_id: a.ident.id, name: nm, verified: isVerified(a.dev), to_name: to, body: text }, { Prefer: 'return=representation' });
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return sendJson(res, 502, { error: 'Gagal mengirim balasan. Sudah menjalankan supabase.sql v4.5?' });
  const x = r.data[0];
  sendJson(res, 200, { ok: true, reply: { id: x.id, name: x.name, verified: !!x.verified, to_name: x.to_name || '', body: x.body, created_at: x.created_at, likes: 0, liked: false, mine: true, can_del: true } });
}

async function handleSocialLike(req, res) {
  const body = await readJson(req, 1024);
  if (!body) return sendJson(res, 413, { error: 'Permintaan terlalu besar.' });
  const a = await actor(req, res, '', true); if (!a) return;
  if (rl('slk:' + a.ident.id, 40, 30000) || rl('slkip:' + a.ident.ip, 200, 60000)) return sendJson(res, 429, { error: 'Terlalu cepat.' });
  const kind = body.kind === 'p' ? 'p' : body.kind === 'r' ? 'r' : '';
  const target = String(body.id == null ? '' : body.id).toLowerCase();
  if (!kind || (kind === 'r' && !UUID_RE.test(target)) || (kind === 'p' && !/^\d{1,18}$/.test(target))) return sendJson(res, 400, { error: 'Target tidak valid.' });
  const ex = await sb('GET', rest(kind === 'r' ? `reviews?id=eq.${target}&select=id&limit=1` : `am_review_replies?id=eq.${target}&select=id&limit=1`));
  if (!ex.ok || !Array.isArray(ex.data) || !ex.data.length) return sendJson(res, 404, { error: 'Komentar sudah tidak ada.' });
  const q = `am_likes?kind=eq.${kind}&target=eq.${target}&device_id=eq.${a.ident.id}`;
  const had = await sb('GET', rest(q + '&select=kind&limit=1'));
  const liked = !(had.ok && Array.isArray(had.data) && had.data.length);
  if (liked) await sb('POST', rest('am_likes?on_conflict=kind,target,device_id'), { kind, target, device_id: a.ident.id }, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
  else await sb('DELETE', rest(q), undefined, MIN);
  const count = await sbCount('am_likes', `kind=eq.${kind}&target=eq.${target}`);
  sendJson(res, 200, { ok: true, liked, count });
}

async function handleSocialDelete(req, res) {
  const body = await readJson(req, 1024);
  if (!body) return sendJson(res, 413, { error: 'Permintaan terlalu besar.' });
  const a = await actor(req, res, '', true); if (!a) return;
  if (rl('sdl:' + a.ident.id, 20, 60000)) return sendJson(res, 429, { error: 'Terlalu cepat.' });
  const id = String(body.id || '');
  if (!/^\d{1,18}$/.test(id)) return sendJson(res, 400, { error: 'ID tidak valid.' });
  const r = await sb('GET', rest(`am_review_replies?id=eq.${id}&select=id,device_id&limit=1`));
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return sendJson(res, 404, { error: 'Balasan tidak ditemukan.' });
  if (row.device_id !== a.ident.id && !a.admin) return sendJson(res, 403, { error: 'Hanya pemilik balasan yang bisa menghapusnya.' });
  await sb('DELETE', rest(`am_review_replies?id=eq.${id}`), undefined, MIN);
  await sb('DELETE', rest(`am_likes?kind=eq.p&target=eq.${id}`), undefined, MIN);
  sendJson(res, 200, { ok: true });
}

/* ---------- Room publik ---------- */
function roomOnline() {
  const now = Date.now();
  let n = 0;
  for (const [k, t] of roomPresence) { if (now - t < 25000) n++; else roomPresence.delete(k); }
  return n;
}
const ROOM_COLS = 'id,device_id,name,verified,body,reply_id,reply_name,reply_body,created_at';
const roomOut = (m, a) => ({
  id: m.id, name: m.name, verified: !!m.verified, body: m.body, reply_id: m.reply_id || null,
  reply_name: m.reply_name || '', reply_body: m.reply_body || '', created_at: m.created_at,
  mine: m.device_id === a.ident.id, can_del: m.device_id === a.ident.id || a.admin
});
function noteRoomDeleted(id) {
  roomDeleted.push({ id: Number(id), at: Date.now() });
  while (roomDeleted.length && Date.now() - roomDeleted[0].at > 10 * 60000) roomDeleted.shift();
  if (roomDeleted.length > 500) roomDeleted.splice(0, roomDeleted.length - 500);
}

async function handleRoomGet(req, res, url) {
  const a = await actor(req, res, '', false); if (!a) return;
  if (rl('rmg:' + a.ident.id, 60, 60000) || rl('rmgip:' + a.ident.ip, 360, 60000)) return sendJson(res, 429, { error: 'Terlalu sering memuat.' });
  roomPresence.set(a.ident.id, Date.now());
  const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
  let rows;
  if (after > 0) {
    const r = await sb('GET', rest(`am_room?id=gt.${after}&select=${ROOM_COLS}&order=id.asc&limit=100`));
    rows = r.ok && Array.isArray(r.data) ? r.data : [];
  } else {
    const r = await sb('GET', rest(`am_room?select=${ROOM_COLS}&order=id.desc&limit=60`));
    rows = r.ok && Array.isArray(r.data) ? r.data.reverse() : [];
  }
  const deleted = after > 0 ? roomDeleted.map((d) => d.id) : [];
  sendJson(res, 200, { messages: rows.map((m) => roomOut(m, a)), deleted, online: roomOnline(), muted: isMuted(a.dev), me: !!a.dev.name });
}

async function handleRoomSend(req, res) {
  const body = await readJson(req, 4096);
  if (!body) return sendJson(res, 413, { error: 'Pesan terlalu besar.' });
  const a = await actor(req, res, body.name, true); if (!a) return;
  if (rl('rms:' + a.ident.id, 6, 20000) || rl('rmsip:' + a.ident.ip, 40, 60000)) return sendJson(res, 429, { error: 'Pesan terlalu cepat. Tunggu sebentar.' });
  const nm = postingName(res, a); if (!nm) return;
  const text = cleanText(body.body, 300);
  if (!text) return sendJson(res, 400, { error: 'Pesan kosong.' });
  if (isDup(a.ident.id, 'room|' + text)) return sendJson(res, 429, { error: 'Pesan yang sama baru saja terkirim.' });
  const row = { device_id: a.ident.id, name: nm, verified: isVerified(a.dev), body: text };
  const rid = String(body.reply_id || '');
  if (/^\d{1,18}$/.test(rid)) {
    const q = await sb('GET', rest(`am_room?id=eq.${rid}&select=id,name,body&limit=1`));
    const t = q.ok && Array.isArray(q.data) ? q.data[0] : null;
    if (t) { row.reply_id = t.id; row.reply_name = t.name; row.reply_body = String(t.body).replace(/\s+/g, ' ').slice(0, 80); }
  }
  roomPresence.set(a.ident.id, Date.now());
  const r = await sb('POST', rest('am_room'), row, { Prefer: 'return=representation' });
  if (!r.ok || !Array.isArray(r.data) || !r.data[0]) return sendJson(res, 502, { error: 'Gagal mengirim pesan. Sudah menjalankan supabase.sql v4.5?' });
  sendJson(res, 200, { ok: true, message: roomOut(r.data[0], a) });
}

async function handleRoomDelete(req, res) {
  const body = await readJson(req, 1024);
  if (!body) return sendJson(res, 413, { error: 'Permintaan terlalu besar.' });
  const a = await actor(req, res, '', true); if (!a) return;
  if (rl('rmd:' + a.ident.id, 20, 60000)) return sendJson(res, 429, { error: 'Terlalu cepat.' });
  const id = String(body.id || '');
  if (!/^\d{1,18}$/.test(id)) return sendJson(res, 400, { error: 'ID tidak valid.' });
  const r = await sb('GET', rest(`am_room?id=eq.${id}&select=id,device_id&limit=1`));
  const row = r.ok && Array.isArray(r.data) ? r.data[0] : null;
  if (!row) return sendJson(res, 404, { error: 'Pesan tidak ditemukan.' });
  if (row.device_id !== a.ident.id && !a.admin) return sendJson(res, 403, { error: 'Hanya pengirim yang bisa menghapus pesan ini.' });
  await sb('DELETE', rest(`am_room?id=eq.${id}`), undefined, MIN);
  noteRoomDeleted(id);
  sendJson(res, 200, { ok: true });
}

/* ---------- v4.8: Bypass Link (proxy ke API bypass) ---------- */
async function handleBypass(req, res, url) {
  const H = { 'X-Bypass-Proxy': '1' };
  const out = (status, obj) => {
    res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, H));
    res.end(JSON.stringify(obj));
  };
  if (!sameOrigin(req)) return out(403, { success: false, error: 'Permintaan ditolak.' });
  const ip = clientIp(req);
  if (rl('byp:' + ipKey(ip), BYPASS_LIMIT, 5 * 60000)) return out(429, { success: false, error: 'Terlalu banyak permintaan. Tunggu beberapa menit lalu coba lagi.' });

  const target = String(url.searchParams.get('url') || '').trim();
  let parsed;
  try { parsed = new URL(target); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol) || !parsed.hostname.includes('.') || target.length > 2000) {
    return out(400, { success: false, error: 'Link tidak valid. Gunakan link http/https.' });
  }
  try {
    const r = await fetch(BYPASS_UPSTREAM + '?url=' + encodeURIComponent(parsed.href), {
      headers: { Accept: 'application/json', 'User-Agent': 'AM-Premify/4.8' },
      signal: AbortSignal.timeout(45000)
    });
    const text = (await r.text()).slice(0, 300000);
    res.writeHead(r.status, Object.assign({
      'Content-Type': r.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }, H));
    res.end(text);
  } catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    out(timeout ? 504 : 502, { success: false, error: timeout ? 'API bypass terlalu lama merespons.' : 'API bypass tidak terjangkau.' });
  }
}

/* ---------- File statis ---------- */
function serveFile(res, rel, onMissing, extraHeaders) {
  const file = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[\/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  const base = path.basename(full);

  if (!full.startsWith(PUBLIC_DIR) || BLOCKED.includes(base) || base.startsWith('.')) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  fs.readFile(full, (err, data) => {
    if (err) return onMissing ? onMissing() : sendJson(res, 404, { error: 'Not Found' });
    res.writeHead(200, Object.assign({
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    }, extraHeaders || {}));
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { pathname, search } = url;

  try {
    if (req.method === 'POST') {
      if (pathname === '/api/send-link' || pathname === '/api/verify-link') return await proxyUpstream(req, res, pathname);
      if (pathname === '/api/me') return await handleMe(req, res);
      if (pathname === '/api/name') return await handleName(req, res);
      if (pathname === '/api/dev/link') return await handleDevLink(req, res);
      if (pathname === '/api/chat/send') return await handleChatSend(req, res);
      if (pathname === '/api/chat/read') return await handleChatRead(req, res);
      if (pathname === '/api/social/reply') return await handleSocialReply(req, res);
      if (pathname === '/api/social/like') return await handleSocialLike(req, res);
      if (pathname === '/api/social/delete') return await handleSocialDelete(req, res);
      if (pathname === '/api/room/send') return await handleRoomSend(req, res);
      if (pathname === '/api/room/delete') return await handleRoomDelete(req, res);
      if (pathname.startsWith('/api/admin/')) return await adminApi(req, res, url, pathname);
      return sendJson(res, 404, { error: 'Not Found' });
    }
    if (req.method !== 'GET') return sendJson(res, 404, { error: 'Not Found' });

    if (pathname === '/api/visitor') return handleVisitor(req, res);
    if (pathname === '/api/bypass') return await handleBypass(req, res, url);
    if (pathname === '/api/chat') return await handleChatGet(req, res, url);
    if (pathname === '/api/chat/unread') return await handleChatUnread(req, res);
    if (pathname === '/api/social/stats') return await handleSocialStats(req, res, url);
    if (pathname === '/api/social/replies') return await handleSocialReplies(req, res, url);
    if (pathname === '/api/room') return await handleRoomGet(req, res, url);
    if (pathname.startsWith('/api/admin/')) return await adminApi(req, res, url, pathname);

    // Konfigurasi publik untuk frontend (hanya anon key, bukan service key)
    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('window.APP_CONFIG=' + JSON.stringify({ supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY, turnstileSiteKey: TURNSTILE_SITE_KEY }) + ';');
    }

    // Menu admin (halaman tidak diindeks mesin pencari, tidak boleh di-embed)
    if (pathname === ADMIN_PAGE) {
      return serveFile(res, '/admin.html', null, {
        'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer'
      });
    }

    // Halaman Bypass Link: /bypass -> bypass.html
    if (pathname === BYPASS_PAGE) return serveFile(res, '/bypass.html');

    // URL bersih: /index.html -> /index
    if (pathname.endsWith('.html')) {
      const clean = pathname.replace(/\.html$/, '');
      return redirect(res, 301, (clean === '/index' || clean === '' ? '/index' : clean) + (search || ''));
    }

    if (PAGES.has(pathname)) return serveFile(res, '/index.html');

    // Aset statis; halaman tak dikenal (tanpa ekstensi) diarahkan ke /index
    return serveFile(res, pathname, () => {
      if (!path.extname(pathname)) return redirect(res, 302, '/index');
      sendJson(res, 404, { error: 'Not Found' });
    });
  } catch (err) {
    console.warn('[AM Premify] Error:', err.message);
    if (!res.headersSent) sendJson(res, 500, { error: 'Terjadi kesalahan server.' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`[AM Premify] Panel aktif di: http://localhost:${PORT}/index`);
  console.log(`[AM Premify] Upstream: ${UPSTREAM}`);
  console.log(`[AM Premify] Bypass: http://localhost:${PORT}${BYPASS_PAGE}  (API: ${BYPASS_UPSTREAM})`);
  if (!process.env.TURNSTILE_SITE_KEY || !process.env.TURNSTILE_SECRET_KEY) {
    console.log('[AM Premify] Turnstile: pakai kunci UJI (selalu lolos). Isi TURNSTILE_SITE_KEY & TURNSTILE_SECRET_KEY di .env untuk produksi.');
  }
  if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_KEY) {
    console.log('[AM Premify] Supabase: terhubung (real-time aktif)');
  } else {
    console.log('[AM Premify] Supabase: BELUM diisi. Salin .env.example menjadi .env lalu isi kuncinya.');
  }
  if (!ADMIN_PASSWORD) console.log('[AM Premify] Menu admin NONAKTIF: isi ADMIN_PASSWORD di .env (min. 12 karakter) untuk mengaktifkan /admin.');
  else {
    console.log('[AM Premify] Menu admin aktif di: http://localhost:' + PORT + '/admin');
    if (ADMIN_PASSWORD.length < 12) console.log('[AM Premify] PERINGATAN: ADMIN_PASSWORD terlalu pendek, pakai minimal 12 karakter.');
  }
  if (!process.env.APP_SECRET) console.log('[AM Premify] Saran: isi APP_SECRET di .env (acak, panjang) untuk penanda tangan token.');
});
