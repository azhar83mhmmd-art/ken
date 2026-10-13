/*
 * ENTRY POINT (versi diagnostik sementara).
 *
 * Seluruh aplikasi ada di app.ts dan baru dimuat saat request pertama
 * (bukan saat file ini di-load), jadi route diagnosa di bawah tetap bisa
 * menjawab walaupun app.ts bermasalah.
 *
 * Route diagnosa (HAPUS setelah masalah ketemu):
 *   /__ping             cek fungsi hidup (tanpa memuat app)
 *   /__probe            halaman yang menguji tiap package + app.ts satu per satu
 *   /__probe/pkg?name=  uji require() satu package
 *   /__probe/app        uji memuat app.ts
 */
import express from 'express';

const PKGS: string[] = ["@napi-rs/canvas", "@supabase/supabase-js", "@upstash/redis", "@vreden/youtube_scraper", "axios", "axios-cookiejar-support", "cheerio", "cors", "crypto-js", "dotenv", "express", "file-type", "form-data", "google-translate-api-x", "jimp", "pdfkit", "qrcode", "qs", "svg-to-pdfkit", "tough-cookie", "ws"];

let realApp: any = null;
let bootError: any = null;
let tried = false;

function loadApp() {
    if (tried) return;
    tried = true;
    try {
        realApp = require('./app').default;
    } catch (error: any) {
        bootError = error;
        console.error('[FATAL] Server gagal start:', (error && error.stack) || error);
    }
}

function describe(error: any) {
    return {
        name: error && error.name,
        code: error && error.code,
        message: String((error && error.message) || error).slice(0, 1500),
        stack: String((error && error.stack) || '').split('\n').slice(0, 15)
    };
}

const entry = express();

entry.get('/__ping', (_req: any, res: any) => {
    res.json({ ok: true, node: process.version, platform: process.platform, arch: process.arch, cwd: process.cwd() });
});

entry.get('/__probe', (_req: any, res: any) => {
    const html = [
        '<!doctype html><html><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>Probe</title></head>',
        '<body style="background:#111;color:#eee;font:14px monospace;padding:12px">',
        '<h3>Probe paket (tunggu sampai SELESAI)</h3><pre id="o"></pre>',
        '<script>',
        'var list=' + JSON.stringify(PKGS) + '.concat(["__app__"]);',
        'var out=document.getElementById("o");',
        'function line(t){out.textContent+=t+"\\n";}',
        'async function run(){',
        ' for(var i=0;i<list.length;i++){var n=list[i];',
        '  try{',
        '   var u=n==="__app__"?"/__probe/app":"/__probe/pkg?name="+encodeURIComponent(n);',
        '   var r=await fetch(u);var j=null;try{j=await r.json();}catch(e){}',
        '   if(j&&j.ok){line("OK     "+n);}',
        '   else if(j){line("GAGAL  "+n+" -> "+(j.code||"")+" "+(j.message||""));}',
        '   else{line("CRASH  "+n+" (HTTP "+r.status+")");}',
        '  }catch(e){line("ERROR  "+n+" "+e);}',
        ' }',
        ' line("SELESAI");',
        '}',
        'run();',
        '</script></body></html>'
    ].join('\n');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
});

entry.get('/__probe/pkg', (req: any, res: any) => {
    const name = String(req.query.name || '');
    if (!PKGS.includes(name)) return res.status(400).json({ ok: false, message: 'nama package tidak diizinkan' });
    try {
        require(name);
        return res.json({ ok: true, pkg: name });
    } catch (error: any) {
        return res.json({ ok: false, pkg: name, ...describe(error) });
    }
});

entry.get('/__probe/app', (_req: any, res: any) => {
    loadApp();
    if (bootError) return res.json({ ok: false, ...describe(bootError) });
    return res.json({ ok: true });
});

entry.use((req: any, res: any, next: any) => {
    loadApp();
    if (bootError) {
        return res.status(500).json({
            status: false,
            message: 'Server gagal start (error saat memuat aplikasi).',
            node: process.version,
            error: describe(bootError)
        });
    }
    return realApp(req, res, next);
});

/*
 * app.listen() hanya jalan kalau file ini dieksekusi langsung
 * (`node dist/index.js` / `ts-node index.ts` di VPS/Termux).
 */
if (require.main === module) {
    const port = Number(process.env.PORT) || 3000;
    entry.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });
}

export default entry;
