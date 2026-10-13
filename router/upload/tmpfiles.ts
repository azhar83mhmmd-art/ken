import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl } from './_shared';

const MIN_EXPIRE = 60;
const MAX_EXPIRE = 172800;
const DEFAULT_EXPIRE = 21600;

export default async function tmpfilesHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const expireRaw = Number(req.query.expire);
    const expire = Number.isFinite(expireRaw) ? Math.min(Math.max(expireRaw, MIN_EXPIRE), MAX_EXPIRE) : DEFAULT_EXPIRE;

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: 'application/octet-stream' });
    form.append('expire', String(expire));

    const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: { ...form.getHeaders(), accept: 'application/json', 'user-agent': 'Mozilla/5.0' }
    });

    const url = response.data?.data?.url || null;

    if (!(response.status === 200 && response.data?.status === 'success' && url)) {
        return res.status(502).json({ status: false, message: 'Upload ke tmpfiles gagal.', raw: response.data });
    }

    return res.json({ status: true, input: sourceUrl, expire_seconds: expire, result_url: url });
}
