import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl } from './_shared';

export default async function catboxHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const userHash = String(req.query.userhash || '').trim();

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('reqtype', 'fileupload');
    if (userHash) form.append('userhash', userHash);
    form.append('fileToUpload', buffer, { filename, contentType: 'application/octet-stream' });

    const response = await axios.post('https://catbox.moe/user/api.php', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: { ...form.getHeaders(), accept: '*/*', 'user-agent': 'Mozilla/5.0' }
    });

    const resultUrl =
        typeof response.data === 'string' && response.data.startsWith('https://') ? response.data.trim() : null;

    if (!resultUrl) {
        return res.status(502).json({ status: false, message: 'Upload ke catbox gagal.', raw: response.data });
    }

    return res.json({ status: true, input: sourceUrl, result_url: resultUrl });
}
