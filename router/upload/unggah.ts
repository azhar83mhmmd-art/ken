import { Request, Response } from 'express';
import axios from 'axios';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

export default async function unggahHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomPart = '';
    for (let i = 0; i < 16; i++) {
        randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const boundary = `WebKitFormBoundary${randomPart}`;

    const head = Buffer.from(
        `------${boundary}\r\n` +
            `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
            `Content-Type: image/png\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n------${boundary}--\r\n`);
    const body = Buffer.concat([head, buffer, tail]);

    const response = await axios.post('https://unggah.web.id/api/unggah', body, {
        timeout: 60000,
        maxBodyLength: Infinity,
        validateStatus: () => true,
        headers: {
            'content-type': `multipart/form-data; boundary=----${boundary}`,
            accept: '*/*',
            origin: 'https://unggah.web.id',
            referer: 'https://unggah.web.id/pengunggah',
            'user-agent': UA
        }
    });

    if (response.status !== 201) {
        return res.status(502).json({ status: false, message: `Upload gagal: HTTP ${response.status}` });
    }

    const result = response.data;

    return res.json({
        status: true,
        input: sourceUrl,
        result_url: result?.url || null
    });
}
