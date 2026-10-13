import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

const BASE = 'https://leopard.hosting.pecon.us';
const UPLOAD_PAGE = `${BASE}/upload.php`;

export default async function leopardHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true }));

    await client.get(UPLOAD_PAGE, {
        headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            Referer: BASE
        },
        validateStatus: () => true
    });

    const form = new FormData();
    form.append('uploadContent', buffer, { filename });
    form.append('password', '');
    form.append('showname', 'yes');

    const response = await client.post(UPLOAD_PAGE, form, {
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            Origin: BASE,
            Referer: UPLOAD_PAGE
        }
    });

    const html = String(response.data || '');
    const match = html.match(/Download link:\s*<a href=([^>\s]+)>/i);
    const url = match?.[1] || null;

    if (!url) {
        return res.status(502).json({ status: false, message: 'Link hasil upload tidak ditemukan di leopard.' });
    }

    return res.json({ status: true, input: sourceUrl, result_url: url });
}
