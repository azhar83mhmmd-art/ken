import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import * as cheerio from 'cheerio';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

async function getSourceUrlFromView(viewUrl: string): Promise<string | null> {
    const response = await axios.get(viewUrl, {
        timeout: 60000,
        validateStatus: () => true,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', referer: 'https://krakenfiles.com/' }
    });

    const $ = cheerio.load(response.data || '');

    return (
        $('#link1').attr('value')?.trim() ||
        $('meta[property="og:image"]').attr('content')?.trim() ||
        $('.image-preview a[href]').attr('href')?.trim() ||
        null
    );
}

export default async function krakenfilesHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType: 'application/octet-stream' });

    const response = await axios.post('https://hs9.krakencloud.net/_uploader/gallery/upload', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            accept: 'application/json, text/javascript, */*; q=0.01',
            origin: 'https://krakenfiles.com',
            referer: 'https://krakenfiles.com/',
            'user-agent': UA,
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });

    const viewUrl = response.data?.files?.[0]?.url || null;
    const error = response.data?.files?.[0]?.error || '';

    if (!viewUrl || error) {
        return res.status(502).json({ status: false, message: 'Upload ke krakenfiles gagal.', raw: response.data });
    }

    const resolvedUrl = (await getSourceUrlFromView(viewUrl)) || viewUrl;

    return res.json({ status: true, input: sourceUrl, result_url: resolvedUrl });
}
