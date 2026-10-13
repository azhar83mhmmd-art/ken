import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

const API = 'https://8upload.com';

function normalizeUploadPath(data: unknown): string | null {
    if (typeof data !== 'string') return null;

    const text = data.trim();
    if (text.startsWith('/uploads/')) return text;

    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string' && parsed.startsWith('/uploads/')) return parsed;
    } catch {
        // bukan JSON, lanjut ke regex fallback
    }

    const match = text.match(/\/uploads\/[a-zA-Z0-9]+/);
    return match ? match[0] : null;
}

function parseHotlink(html: string): string | null {
    const $ = cheerio.load(String(html || ''));
    let result: string | null = null;

    $('label').each((_, el) => {
        const text = $(el).text().trim();
        if (text.includes('Hotlink') || text.includes('Direct-Link')) {
            result = $(el).next('input').attr('value')?.trim() || null;
        }
    });

    if (result) return result;

    const inputUrl = $('input[value^="https://i.8upload.com/image/"]').attr('value')?.trim();
    if (inputUrl) return inputUrl;

    const regex = String(html || '').match(/https:\/\/i\.8upload\.com\/image\/[^'"<>\s]+/);
    if (regex) return regex[0];

    const preview = $('img.istatus').attr('src')?.trim();
    if (preview) return preview.replace('/preview/', '/image/');

    return null;
}

export default async function upload8Handler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const jar = new CookieJar();
    const client = wrapper(
        axios.create({
            baseURL: API,
            jar,
            withCredentials: true,
            timeout: 120000,
            validateStatus: () => true,
            headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' }
        })
    );

    await client.get('/', {
        headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', referer: `${API}/` }
    });

    const form = new FormData();
    form.append('images[]', buffer, { filename, contentType: 'application/octet-stream' });

    const uploadRes = await client.post('/upload/mt/', form, {
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        headers: {
            ...form.getHeaders(),
            accept: 'application/json, text/javascript, */*; q=0.01',
            origin: API,
            referer: `${API}/`,
            'x-requested-with': 'XMLHttpRequest'
        }
    });

    let html = uploadRes.data || '';
    const uploadPath = normalizeUploadPath(html);

    if (uploadPath) {
        const previewRes = await client.get(uploadPath, {
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                referer: `${API}/`,
                'upgrade-insecure-requests': '1'
            }
        });
        html = previewRes.data || '';
    }

    const resultUrl = parseHotlink(html);

    if (!resultUrl) {
        return res.status(502).json({ status: false, message: 'Hotlink / Direct-Link tidak ditemukan di 8upload.' });
    }

    return res.json({ status: true, input: sourceUrl, result_url: resultUrl });
}
