import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Carbon Code Screenshot
 * Diadaptasi dari referensi carbon-code.js.
 *
 * PENTING: referensi asli pakai package '@microlink/mql'. Package itu
 * SUDAH SENGAJA DIHAPUS TOTAL dari project ini (lihat catatan panjang di
 * router/tools/screenshot.ts) karena ESM-only dan bikin SEMUA route
 * crash ERR_REQUIRE_ESM di runtime @vercel/node, apapun cara importnya.
 * Endpoint ini karena itu TIDAK memakai '@microlink/mql' sama sekali —
 * dipanggil langsung lewat REST API publik https://api.microlink.io
 * (endpoint HTTP biasa, bukan package Node), persis pola yang sudah
 * dipakai provider "microlink" di router/tools/screenshot.ts.
 */

const THEMES = [
    'dracula-pro',
    'monokai',
    'nord',
    'solarized-dark',
    'solarized-light',
    'one-dark',
    'material',
    'panda-syntax',
    'night-owl',
    'cobalt2'
];

const FONTS = [
    'Fira Code',
    'JetBrains Mono',
    'Hack',
    'Source Code Pro',
    'Inconsolata',
    'Droid Sans Mono',
    'Anonymous Pro'
];

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function buildCarbonUrl(opts: {
    code: string;
    language: string;
    theme: string;
    font: string;
    fontSize: string;
    background: string;
    lineNumbers: boolean;
}) {
    const theme = THEMES.includes(opts.theme) ? opts.theme : 'dracula-pro';
    const font = FONTS.includes(opts.font) ? opts.font : 'Fira Code';

    const params = new URLSearchParams({
        bg: opts.background,
        t: theme,
        wt: 'none',
        l: opts.language || 'auto',
        ds: 'false',
        dsyoff: '20px',
        dsblur: '68px',
        wc: 'true',
        wa: 'true',
        pv: '56px',
        ph: '56px',
        ln: opts.lineNumbers ? 'true' : 'false',
        fl: '1',
        fm: font,
        fs: opts.fontSize || '14px',
        lh: '152%',
        si: 'false',
        es: '2x',
        wm: 'false'
    });

    params.append('code', opts.code);

    return `https://carbon.now.sh/?${params.toString()}`;
}

export default async function carbonHandler(req: Request, res: Response) {
    const code = String(req.query.code || req.body?.code || '').trim();

    if (!code) {
        return res.status(400).json({ status: false, message: "Parameter 'code' diperlukan." });
    }

    if (code.length > 4000) {
        return res.status(400).json({ status: false, message: "Parameter 'code' maksimal 4000 karakter." });
    }

    const language = String(req.query.language || req.body?.language || 'auto');
    const theme = String(req.query.theme || req.body?.theme || 'dracula-pro');
    const font = String(req.query.font || req.body?.font || 'Fira Code');
    const fontSize = String(req.query.fontSize || req.body?.fontSize || '14px');
    const background = String(req.query.background || req.body?.background || 'rgba(226,233,239,1)');
    const lineNumbers = String(req.query.lineNumbers ?? req.body?.lineNumbers ?? 'true') !== 'false';

    const carbonUrl = buildCarbonUrl({ code, language, theme, font, fontSize, background, lineNumbers });

    try {
        const response = await axios.get('https://api.microlink.io', {
            timeout: 30000,
            validateStatus: () => true,
            params: {
                url: carbonUrl,
                screenshot: 'true',
                meta: 'false',
                element: '.export-container',
                'viewport.width': 1024,
                'viewport.height': 768,
                waitFor: 3000
            },
            headers: { accept: 'application/json', 'user-agent': UA }
        });

        const imageUrl = response.data?.data?.screenshot?.url;

        if (response.status < 200 || response.status >= 300 || response.data?.status !== 'success' || !imageUrl) {
            return res.status(502).json({
                status: false,
                message: response.data?.message || 'Gagal membuat screenshot code (microlink).'
            });
        }

        return res.json({
            status: true,
            input: code,
            options: { language, theme, font, fontSize, background, lineNumbers },
            result: { image_url: imageUrl }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal membuat screenshot code.'
        });
    }
}
