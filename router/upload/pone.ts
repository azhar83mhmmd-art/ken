import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl, guessMime, UA } from './_shared';

export default async function poneHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType: guessMime(filename) || contentType });

    const response = await axios.post('https://pone.rs/upload.php', form, {
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'user-agent': UA,
            accept: '*/*',
            origin: 'https://pone.rs',
            referer: 'https://pone.rs/'
        }
    });

    const data = response.data;
    const url = data?.files?.[0]?.url?.replaceAll('\\/', '/') || null;

    if (!(data?.success && url)) {
        return res.status(502).json({ status: false, message: 'Upload ke pone.rs gagal.', raw: data });
    }

    return res.json({ status: true, input: sourceUrl, result_url: url });
}
