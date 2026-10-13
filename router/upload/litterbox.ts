import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl } from './_shared';

const ALLOWED_EXPIRE = new Set(['1h', '12h', '24h', '72h']);

export default async function litterboxHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const expire = String(req.query.expire || '1h');

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    if (!ALLOWED_EXPIRE.has(expire)) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'expire' harus salah satu dari: 1h, 12h, 24h, 72h."
        });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', expire);
    form.append('fileToUpload', buffer, { filename, contentType: 'application/octet-stream' });

    const response = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: { ...form.getHeaders(), accept: '*/*', 'user-agent': 'Mozilla/5.0' }
    });

    const url =
        typeof response.data === 'string' && response.data.trim().startsWith('https://')
            ? response.data.trim()
            : null;

    if (!url) {
        return res.status(502).json({ status: false, message: 'Upload ke litterbox gagal.', raw: response.data });
    }

    return res.json({ status: true, input: sourceUrl, expire, result_url: url });
}
