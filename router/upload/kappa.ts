import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl, guessMime, UA } from './_shared';

export default async function kappaHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: guessMime(filename) || contentType });

    const response = await axios.post('https://kappa.lol/api/upload', form, {
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'User-Agent': UA,
            Accept: '*/*',
            Origin: 'https://kappa.lol',
            Referer: 'https://kappa.lol/'
        }
    });

    const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    const link = data?.link || null;

    if (!link) {
        return res.status(502).json({ status: false, message: 'Upload ke kappa.lol gagal.', raw: data });
    }

    return res.json({ status: true, input: sourceUrl, result_url: link });
}
