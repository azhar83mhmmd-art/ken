import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { fetchSourceBuffer, getSourceUrl, decodeHtmlEntities, UA } from './_shared';

const BASE = 'https://www.upload.ee';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/svg+xml', 'image/avif']);

function toDirectImageUrl(url: string | null): string | null {
    if (!url) return null;

    let result = decodeHtmlEntities(url);
    result = result.replace('/files/', '/image/');

    if (result.endsWith('.html')) {
        result = result.slice(0, -5);
    }

    return result;
}

export default async function uploadeeHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);
    const isImage = IMAGE_MIME.has(contentType.split(';')[0].trim());
    const category = isImage ? 'cat_picture' : 'cat_file';

    const jar = new CookieJar();
    const client = wrapper(
        axios.create({
            jar,
            withCredentials: true,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: () => true
        })
    );

    await client.get(`${BASE}/?`, {
        headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            Referer: BASE
        }
    });

    const rnd = Date.now();
    const idRes = await client.get(`${BASE}/ubr_link_upload.php?rnd_id=${rnd}`, {
        headers: { 'User-Agent': UA, Accept: '*/*', Referer: `${BASE}/?` }
    });

    const idMatch = String(idRes.data || '').match(/startUpload\("([^"]+)"/);
    if (!idMatch) {
        return res.status(502).json({ status: false, message: 'Upload ID tidak ditemukan di upload.ee.' });
    }
    const uploadId = idMatch[1];

    const form = new FormData();
    form.append('upfile_0', buffer, { filename, contentType });
    form.append('link', '');
    form.append('email', '');
    form.append('category', category);
    form.append('big_resize', 'none');
    form.append('small_resize', '120x90');

    const uploadUrl = `${BASE}/cgi-bin/ubr_upload.pl?X-Progress-ID=${uploadId}&upload_id=${uploadId}`;

    await client.post(uploadUrl, form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            Origin: BASE,
            Referer: `${BASE}/?`
        }
    });

    const finishedUrl = `${BASE}/?page=finished&upload_id=${uploadId}`;
    const finishedRes = await client.get(finishedUrl, {
        headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            Referer: uploadUrl
        }
    });

    const finishedHtml = String(finishedRes.data || '');
    const fileSrcMatch = finishedHtml.match(/id=["']file_src["'][^>]*value=["']([^"']+)["']/i);
    const viewMatch = finishedHtml.match(/View file:\s*<br\s*\/?>\s*<a href=["']?([^"'>\s]+)["']?/i);

    const rawUrl = fileSrcMatch?.[1] || viewMatch?.[1] || null;
    const viewUrl = rawUrl ? decodeHtmlEntities(rawUrl) : null;

    if (!viewUrl) {
        return res.status(502).json({ status: false, message: 'View file URL tidak ditemukan di upload.ee.' });
    }

    let resultUrl: string | null;

    if (isImage) {
        resultUrl = toDirectImageUrl(viewUrl);
    } else {
        const filePageRes = await client.get(viewUrl, {
            headers: {
                'User-Agent': UA,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                Referer: finishedUrl
            }
        });

        const fileHtml = String(filePageRes.data || '');
        const downloadMatch = fileHtml.match(/<a[^>]+id=["']d_l["'][^>]+href=["']([^"']+)["']/i);
        resultUrl = downloadMatch ? decodeHtmlEntities(downloadMatch[1]) : null;
    }

    if (!resultUrl) {
        return res.status(502).json({ status: false, message: 'Link hasil upload.ee tidak ditemukan.' });
    }

    return res.json({
        status: true,
        input: sourceUrl,
        type: isImage ? 'image' : 'file',
        result_url: resultUrl
    });
}
