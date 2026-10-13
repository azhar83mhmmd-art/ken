import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Shinigami Manga Chapter Reader
 * Provider: api.shngm.io
 * Berbeda dari /api/info/shinigamidetail (detail seri + daftar chapter),
 * endpoint ini mengembalikan gambar halaman dari SATU chapter tertentu
 * (atau chapter terbaru kalau input berupa URL seri).
 */

const BASE_URL = 'https://api.shngm.io';
const WEB_URL = 'https://g.shinigami.asia';

const client = axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    headers: { accept: 'application/json', referer: `${WEB_URL}/`, origin: WEB_URL },
    validateStatus: () => true
});

function getUuid(input: string): string | null {
    const text = String(input || '').trim();
    const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid ? uuid[0] : null;
}

function makeChapterUrl(chapterId: string | null) {
    return chapterId ? `${WEB_URL}/chapter/${chapterId}` : null;
}

function makeChapterTitle(data: any) {
    const number = data.chapter_number ?? null;
    const title = String(data.chapter_title || '').trim();
    if (number && title) return `Chapter ${number} - ${title}`;
    if (number) return `Chapter ${number}`;
    return title || null;
}

function makeImages(data: any) {
    const base = data.base_url || data.base_url_low || null;
    const chapter = data.chapter || {};
    const path = chapter.path || '';
    const files: string[] = Array.isArray(chapter.data) ? chapter.data : [];
    if (!base || !path || !files.length) return [];
    return files.map((file, index) => ({ page: index + 1, url: `${base}${path}${file}` }));
}

export default async function shinigamiReadHandler(req: Request, res: Response) {
    const input = String(req.query.url || req.query.id || '').trim();

    if (!input) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' (link chapter/seri g.shinigami.asia) atau 'id' (chapter_id UUID) diperlukan."
        });
    }

    const isSeriesUrl = input.includes('/series/');
    const inputId = getUuid(input);

    if (!inputId) {
        return res.status(400).json({
            status: false,
            message: 'UUID tidak ditemukan dari input.'
        });
    }

    let chapterId = inputId;
    let mangaTitle: string | null = null;

    try {
        if (isSeriesUrl) {
            const detail = await client.get(`/v1/manga/detail/${inputId}`);
            if (detail.status < 200 || detail.status >= 300 || detail.data?.retcode !== 0 || !detail.data?.data) {
                return res.status(502).json({ status: false, message: 'Gagal mengambil detail manga.' });
            }
            mangaTitle = detail.data.data.title || null;
            chapterId = detail.data.data.latest_chapter_id;
            if (!chapterId) {
                return res.status(404).json({ status: false, message: 'Chapter terbaru tidak ditemukan pada seri ini.' });
            }
        }

        const chapterRes = await client.get(`/v1/chapter/detail/${chapterId}`);
        const json = chapterRes.data;

        if (chapterRes.status < 200 || chapterRes.status >= 300 || !json || json.retcode !== 0 || !json.data) {
            return res.status(502).json({ status: false, message: 'Chapter tidak ditemukan atau provider gagal merespons.' });
        }

        const data = json.data;
        const images = makeImages(data);

        return res.json({
            status: true,
            input,
            manga_title: mangaTitle,
            chapter_id: data.chapter_id || chapterId,
            chapter_number: data.chapter_number ?? null,
            title: makeChapterTitle(data),
            url: makeChapterUrl(data.chapter_id || chapterId),
            prev_chapter_id: data.prev_chapter_id || null,
            next_chapter_id: data.next_chapter_id || null,
            total_pages: images.length,
            images
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal membaca chapter.'
        });
    }
}
