import { Request, Response } from 'express';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';
/*
 * PENTING (bug FUNCTION_INVOCATION_FAILED / ERR_REQUIRE_ESM di SEMUA
 * route, bukan cuma /api/tools/screenshot):
 * Package '@microlink/mql' (lewat dependency 'ky') di-publish sebagai
 * ESM-only. Baik require() statis, import() dinamis biasa, maupun
 * import() dinamis yang dibungkus new Function() tetap membuat Node
 * memuat file internal '@microlink/mql' yang mem-require 'ky' secara
 * CJS, sehingga crash ERR_REQUIRE_ESM tetap terjadi di runtime
 * @vercel/node ini apa pun cara importnya.
 *
 * Fix final & permanen: HAPUS TOTAL dependency '@microlink/mql'.
 * Microlink juga menyediakan REST API publik biasa di
 * https://api.microlink.io — dipanggil pakai axios (sama seperti
 * provider 1 & 2 di file ini), sehingga tidak ada package ESM-only
 * yang perlu dimuat sama sekali. Ini menghilangkan akar masalahnya,
 * bukan cuma menghindarinya.
 */
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function makeClient() {
    const jar = new CookieJar();
    return wrapper(
        axios.create({
            jar,
            withCredentials: true,
            timeout: 60000,
            validateStatus: () => true,
            headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' }
        })
    );
}

// Provider 1: pikwy.com
async function tryPikwy(url: string): Promise<string | null> {
    const client = makeClient();

    await client.get('https://pikwy.com', {
        headers: { accept: 'text/html', referer: 'https://www.google.com/' }
    });

    const res = await client.get('https://api.pikwy.com/', {
        params: {
            tkn: '125',
            d: '3000',
            u: encodeURIComponent(url),
            fs: '0',
            w: '1920',
            h: '1080',
            s: '100',
            z: '100',
            f: 'png',
            rt: 'jweb'
        },
        headers: { accept: '*/*', origin: 'https://pikwy.com', referer: 'https://pikwy.com/' }
    });

    if (res.status >= 200 && res.status < 300 && typeof res.data === 'object' && res.data.iurl) {
        return res.data.iurl as string;
    }

    return null;
}

// Provider 2: id.vivoldi.com
async function tryVivoldi(url: string): Promise<string | null> {
    const BASE = 'https://id.vivoldi.com';
    const PAGE = `${BASE}/tools/website-screen-capturer`;
    const client = makeClient();

    await client.get(PAGE, { headers: { accept: 'text/html', referer: 'https://www.google.com/' } });

    const res = await client.post(
        PAGE,
        {
            urls: url,
            client: 'chromium',
            height: 'auto',
            quality: 'auto',
            agent: '1',
            export: 'png',
            delay: '2',
            querySelector: ''
        },
        {
            headers: { 'api-post': 'Y', accept: 'application/json', 'content-type': 'application/json', origin: BASE, referer: PAGE }
        }
    );

    if (res.status >= 200 && res.status < 300 && res.data?.code === 0 && res.data?.result?.downloadUrl) {
        return res.data.result.downloadUrl as string;
    }

    return null;
}

// Provider 3: microlink.io (REST API langsung, tanpa package @microlink/mql)
async function tryMicrolink(url: string): Promise<string | null> {
    const client = makeClient();

    const res = await client.get('https://api.microlink.io', {
        params: {
            url,
            screenshot: 'true',
            'meta': 'false',
            'viewport.width': '1920',
            'viewport.height': '1080',
            waitFor: '3000'
        },
        headers: { accept: 'application/json' }
    });

    if (res.status >= 200 && res.status < 300 && res.data?.status === 'success' && res.data?.data?.screenshot?.url) {
        return res.data.data.screenshot.url as string;
    }

    return null;
}

export default async function screenshotHandler(req: Request, res: Response) {
    const url = String(req.query.url || '').trim();

    if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ status: false, message: "Parameter 'url' harus diawali http:// atau https://." });
    }

    const providers: { name: string; fn: (u: string) => Promise<string | null> }[] = [
        { name: 'pikwy', fn: tryPikwy },
        { name: 'vivoldi', fn: tryVivoldi },
        { name: 'microlink', fn: tryMicrolink }
    ];

    for (const provider of providers) {
        try {
            const resultUrl = await provider.fn(url);
            if (resultUrl) {
                return res.json({ status: true, input: url, provider: provider.name, resultUrl });
            }
        } catch {
            // lanjut ke provider berikutnya
            continue;
        }
    }

    return res.status(502).json({ status: false, message: 'Semua provider screenshot gagal, coba lagi nanti.' });
}
