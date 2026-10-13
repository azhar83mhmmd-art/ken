import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';

/*
 * Short Link (provider kua.lat)
 * Diadaptasi dari referensi shortlink.js.
 *
 * Endpoint ini TERPISAH dari /api/tools/shorturl (provider tinyurl.com)
 * yang sudah ada sebelumnya - bukan pengganti, tapi provider alternatif,
 * karena keduanya punya karakteristik beda (tinyurl tidak butuh apapun
 * selain GET request, kua.lat butuh multipart POST). Kalau salah satu
 * provider down, orang masih punya pilihan yang lain.
 *
 * Beda dari referensi asli: pakai axios + form-data (konsisten dengan
 * pola HTTP client project ini) alih-alih modul 'node:https' mentah.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0';

export default async function shortlinkHandler(req: Request, res: Response) {
    const url = String(req.query.url || req.body?.url || '').trim();

    if (!url) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ status: false, message: "Parameter 'url' harus diawali http:// atau https://." });
    }

    try {
        const form = new FormData();
        form.append('url', url);

        const response = await axios.post('https://kua.lat/shorten', form, {
            timeout: 20000,
            validateStatus: () => true,
            headers: {
                ...form.getHeaders(),
                'x-requested-with': 'XMLHttpRequest',
                accept: 'application/json, text/javascript, */*; q=0.01',
                'user-agent': UA,
                origin: 'https://kua.lat',
                referer: 'https://kua.lat/'
            }
        });

        const shortUrl = response.data?.data?.shorturl || null;

        if (response.status < 200 || response.status >= 300 || !shortUrl) {
            return res.status(502).json({
                status: false,
                message: 'Gagal memendekkan URL lewat provider kua.lat.'
            });
        }

        return res.json({ status: true, input: url, result: shortUrl });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memendekkan URL.'
        });
    }
}
