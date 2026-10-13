import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Instagram Downloader
 * Provider: saveig.in (visolix API) — tanpa browser/puppeteer,
 * murni HTTP request supaya ringan dijalankan di serverless.
 */

export default async function instagramHandler(req: Request, res: Response) {
    const url = String(req.query.url || req.body?.url || '').trim();

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' diperlukan."
        });
    }

    try {
        const { data } = await axios.post(
            'https://saveig.in/wp-json/visolix/api/download',
            { url, format: '', captcha_response: null },
            {
                timeout: 20000,
                headers: {
                    accept: '*/*',
                    'content-type': 'application/json',
                    origin: 'https://saveig.in',
                    referer: 'https://saveig.in/',
                    'x-visolix-nonce': '66b14bdf91'
                }
            }
        );

        if (!data?.status) {
            return res.status(502).json({
                status: false,
                message: 'Gagal mengambil media dari Instagram. Post mungkin private atau URL tidak valid.'
            });
        }

        const html = String(data.data || '');
        const result = [...html.matchAll(/href="([^"]*dl\.php\?id=[^"]+)"/g)]
            .map((m) => m[1].replace(/&amp;/g, '&'));

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: 'Tidak ada media yang ditemukan pada URL tersebut.'
            });
        }

        return res.json({
            status: true,
            input: url,
            total: result.length,
            result
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memproses URL Instagram.'
        });
    }
}
