import { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';

/*
 * TikTok Downloader
 * Primary provider : ikdownloader.io (ajaxSearch, HTML response yang di-parse)
 * Fallback provider: tikwm.com (JSON API publik, sudah dipakai di AIO downloader)
 */

async function viaIkdownloader(url: string) {
    const { data, status } = await axios.post(
        'https://ikdownloader.io/api/ajaxSearch',
        new URLSearchParams({ q: url, lang: 'id' }).toString(),
        {
            timeout: 20000,
            validateStatus: () => true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:151.0) Gecko/20100101 Firefox/151.0',
                Accept: '*/*',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
                Origin: 'https://ikdownloader.io',
                Referer: 'https://ikdownloader.io/id'
            }
        }
    );

    if (status !== 200 || typeof data !== 'object' || data.status !== 'ok') {
        throw new Error(data?.message || 'Provider utama gagal merespons.');
    }

    const $ = cheerio.load(String(data.data || ''));
    const title = $('.content h3').first().text().trim() || null;
    const thumbnail = $('.thumbnail img').first().attr('src') || null;

    const downloads: { type: string; url: string }[] = [];
    $('.dl-action a').each((_, el) => {
        const label = $(el).text().replace(/\s+/g, ' ').trim();
        const href = $(el).attr('href');
        if (href) downloads.push({ type: label || 'download', url: href.replace(/&amp;/g, '&') });
    });

    if (downloads.length === 0) throw new Error('Tidak ada link unduhan yang ditemukan.');

    return { source: 'ikdownloader', title, thumbnail, downloads };
}

async function viaTikwm(url: string) {
    const { data } = await axios.get('https://www.tikwm.com/api/', {
        params: { url, hd: 1 },
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    if (!data || data.code !== 0 || !data.data) {
        throw new Error(data?.msg || 'Provider cadangan gagal merespons.');
    }

    const d = data.data;
    const downloads: { type: string; url: string }[] = [];
    if (d.hdplay || d.play) downloads.push({ type: 'video_no_watermark', url: d.hdplay || d.play });
    if (d.wmplay) downloads.push({ type: 'video_watermark', url: d.wmplay });
    if (d.music) downloads.push({ type: 'audio', url: d.music });

    return {
        source: 'tikwm',
        title: d.title || null,
        thumbnail: d.cover || null,
        duration: d.duration ?? null,
        downloads
    };
}

export default async function tiktokHandler(req: Request, res: Response) {
    const url = String(req.query.url || req.body?.url || '').trim();

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' diperlukan."
        });
    }

    const attempts: any[] = [];

    for (const provider of [viaIkdownloader, viaTikwm]) {
        try {
            const result = await provider(url);
            return res.json({ status: true, input: url, ...result });
        } catch (error: any) {
            attempts.push(error.message);
        }
    }

    return res.status(502).json({
        status: false,
        message: 'Semua provider gagal memproses URL TikTok ini.',
        errors: attempts
    });
}
