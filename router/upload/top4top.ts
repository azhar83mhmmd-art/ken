import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import { fetchSourceBuffer, getSourceUrl, UA } from './_shared';

const API = 'https://top4top.io';

function parseDirectImage(html: string): string | null {
    const $ = cheerio.load(html);
    let direct: string | null = null;

    $('.inputbody').each((_, el) => {
        const title = $(el).find('.btitle').text().trim();
        const value = $(el).find('input').attr('value')?.trim();

        if (title.includes('رابط الصورة المباشر') && value) {
            direct = value;
        }
    });

    return (
        direct ||
        $('input[value^="https://"][value*="/p_"]').attr('value')?.trim() ||
        $('a[href*="/p_"]').attr('href')?.trim() ||
        null
    );
}

export default async function top4topHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' diperlukan." });
    }

    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const jar = new CookieJar();
    const client = wrapper(
        axios.create({
            baseURL: API,
            jar,
            withCredentials: true,
            timeout: 120000,
            validateStatus: () => true,
            headers: { 'user-agent': UA, 'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7' }
        })
    );

    function getCookieSid(): string {
        const cookies = jar.getCookiesSync(API);
        return cookies.find((c) => c.key === 'sid')?.value || '';
    }

    const homeRes = await client.get('/', {
        headers: { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', referer: `${API}/` }
    });
    const $home = cheerio.load(homeRes.data || '');
    const sid = $home('input[name="sid"]').attr('value') || getCookieSid();

    const form = new FormData();
    if (sid) form.append('sid', sid);
    form.append('file_0_', buffer, { filename, contentType: 'application/octet-stream' });
    for (let i = 1; i <= 9; i++) form.append(`file_${i}_`, '');
    form.append('submitr', '[ رفع الملفات ]');
    for (let i = 0; i <= 9; i++) form.append(`file_${i}_`, '');

    const response = await client.post('/index.php', form, {
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        headers: {
            ...form.getHeaders(),
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            origin: API,
            referer: `${API}/`,
            'upgrade-insecure-requests': '1'
        }
    });

    const resultUrl = parseDirectImage(response.data || '');

    if (!resultUrl) {
        return res.status(502).json({ status: false, message: 'Direct image link tidak ditemukan di top4top.' });
    }

    return res.json({ status: true, input: sourceUrl, result_url: resultUrl });
}
