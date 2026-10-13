import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

export default async function uguuHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType: 'application/octet-stream' });

    const response = await axios.post('https://uguu.se/upload.php', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            accept: '*/*',
            origin: 'https://uguu.se',
            referer: 'https://uguu.se/',
            'user-agent': UA,
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });

    const resultUrl = response.data?.files?.[0]?.url || null;

    if (!(response.status === 200 && response.data?.success === true && resultUrl)) {
        return res.status(502).json({ status: false, message: 'Upload ke uguu.se gagal.', raw: response.data });
    }

    return res.json({ status: true, input: sourceUrl, result_url: resultUrl });
}
