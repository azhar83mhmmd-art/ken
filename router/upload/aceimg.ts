import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import crypto from 'crypto';
import { fetchSourceBuffer, getSourceUrl, guessMime, UA } from './_shared';

export default async function aceimgHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);
    const visitorId = crypto.randomUUID();

    const form = new FormData();
    form.append('file', buffer, { filename, contentType: guessMime(filename) || contentType });

    const url = `https://api.aceimg.com/api/upload?visitorId=${visitorId}`;

    const response = await axios.post(url, form, {
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            'User-Agent': UA,
            Accept: '*/*',
            Origin: 'https://aceimg.com',
            Referer: 'https://aceimg.com/'
        }
    });

    const data = response.data;

    if (!(data?.status === true && data?.link)) {
        return res.status(502).json({ status: false, message: 'Upload ke aceimg gagal.', raw: data });
    }

    return res.json({
        status: true,
        input: sourceUrl,
        visitor_id: visitorId,
        result_url: data.link
    });
}
