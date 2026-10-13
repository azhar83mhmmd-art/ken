/*
 * Entry point Vercel Serverless Function (versi diagnostik).
 *
 * Perubahan dari versi sebelumnya:
 * - dist/index.js di-require saat request PERTAMA (di dalam handler), bukan saat
 *   file ini di-load, supaya kegagalan apa pun bisa dijawab dengan JSON berisi
 *   pesan error aslinya dan tercatat di Runtime Logs.
 * - Menangkap uncaughtException / unhandledRejection dan menuliskannya ke log
 *   (crash async yang tadinya hanya tampil sebagai FUNCTION_INVOCATION_FAILED).
 * - Mode diagnosa sementara:
 *     /?__diag=1       info runtime (versi Node, platform, dist/public ada atau tidak)
 *     /?__diag=canvas  mencoba memuat @napi-rs/canvas saja
 *   Hapus blok "DIAGNOSA" ini setelah masalah ketemu.
 */
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (e) => console.error('[uncaughtException]', (e && e.stack) || e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', (e && e.stack) || e));

let app = null;
let bootError = null;

function boot() {
    if (app || bootError) return;
    try {
        const mod = require('../dist/index.js');
        app = mod && (mod.default || mod);
        if (typeof app !== 'function') {
            throw new Error("dist/index.js dimuat tapi tidak meng-export Express app (cek hasil 'npm run build').");
        }
    } catch (error) {
        bootError = error;
        console.error('[FATAL] gagal memuat dist/index.js:', (error && error.stack) || error);
    }
}

function sendJson(res, code, body) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body, null, 2));
}

module.exports = (req, res) => {
    /* ===== DIAGNOSA (sementara) ===== */
    const url = req.url || '';
    if (url.indexOf('__diag=1') !== -1) {
        const root = path.join(__dirname, '..');
        const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };
        return sendJson(res, 200, {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cwd: process.cwd(),
            distIndex: exists(path.join(root, 'dist', 'index.js')),
            distPublic: exists(path.join(root, 'dist', 'public')),
            publicDir: exists(path.join(root, 'public')),
            distConfig: exists(path.join(root, 'dist', 'src', 'config.json')),
            env: {
                SUPABASE_URL: !!process.env.SUPABASE_URL,
                UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL
            }
        });
    }
    if (url.indexOf('__diag=canvas') !== -1) {
        try {
            require('@napi-rs/canvas');
            return sendJson(res, 200, { canvas: 'OK' });
        } catch (e) {
            return sendJson(res, 200, { canvas: 'GAGAL', error: String((e && e.message) || e).slice(0, 600) });
        }
    }
    /* ===== akhir DIAGNOSA ===== */

    boot();

    if (bootError) {
        return sendJson(res, 500, {
            status: false,
            message: 'Server gagal start (cold start crash).',
            error: { name: bootError.name, message: bootError.message }
        });
    }

    try {
        return app(req, res);
    } catch (error) {
        console.error('[FATAL] error saat memproses request:', (error && error.stack) || error);
        return sendJson(res, 500, {
            status: false,
            message: 'Error saat memproses request.',
            error: { name: error && error.name, message: error && error.message }
        });
    }
};
