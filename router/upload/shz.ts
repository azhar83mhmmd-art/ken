import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl, guessMime, UA } from './_shared';

const BASE = 'https://shz.al';

function parseExpireToSeconds(expire = '7d'): number {
    const text = String(expire).trim().toLowerCase();
    const match = text.match(/^(\d+(?:\.\d+)?)(s|m|h|d)?$/);

    if (!match) return 7 * 86400;

    const value = Number(match[1]);
    const unit = match[2] || 's';

    const seconds = { s: value, m: value * 60, h: value * 3600, d: value * 86400 }[unit] as number;

    return Math.min(Math.floor(seconds), 90 * 86400);
}

function secondsToExpire(seconds: number): string {
    if (seconds % 86400 === 0) return `${seconds / 86400}d`;
    if (seconds % 3600 === 0) return `${seconds / 3600}h`;
    if (seconds % 60 === 0) return `${seconds / 60}m`;
    return `${seconds}s`;
}

function getNameFromUrl(url: string): string {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, '');
}

function getNormalUrl(url: string): string {
    const name = getNameFromUrl(url);
    return `${BASE}/d/${name}`;
}

export default async function shzHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const expireParam = String(req.query.expire || '1d');

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);

    const expireSeconds = parseExpireToSeconds(expireParam);
    const finalExpire = secondsToExpire(expireSeconds);

    const form = new FormData();
    form.append('c', buffer, { filename, contentType: guessMime(filename) || contentType });
    form.append('e', finalExpire);

    const response = await axios.post(BASE, form, {
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'User-Agent': UA,
            Accept: '*/*',
            Origin: BASE,
            Referer: `${BASE}/`
        }
    });

    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const rawUrl = data?.url || null;

    if (!rawUrl) {
        return res.status(502).json({ status: false, message: 'Upload ke shz.al gagal.', raw: data });
    }

    return res.json({
        status: true,
        input: sourceUrl,
        expire: finalExpire,
        result_url: getNormalUrl(rawUrl),
        raw_url: rawUrl,
        manage_url: data?.manageUrl || null,
        expire_at: data?.expireAt || null
    });
}
