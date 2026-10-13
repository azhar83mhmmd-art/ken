import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Shinigami Manga Detail + Chapter List
 * Provider: api.shngm.io
 */

const BASE_URL = 'https://api.shngm.io';
const WEB_URL = 'https://g.shinigami.asia';

function getUuid(input: string): string | null {
    const text = String(input || '').trim();
    const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return uuid ? uuid[0] : null;
}

function pickTaxonomy(taxonomy: any, key: string) {
    if (!taxonomy || !Array.isArray(taxonomy[key])) return [];
    return taxonomy[key].map((v: any) => v.name).filter(Boolean);
}

function makeSeriesUrl(mangaId: string | null) {
    return mangaId ? `${WEB_URL}/series/${mangaId}` : null;
}

function makeChapterUrl(chapterId: string | null) {
    return chapterId ? `${WEB_URL}/chapter/${chapterId}` : null;
}

function makeChapterName(item: any) {
    const number = item.chapter_number ?? null;
    const title = String(item.chapter_title || '').trim();

    if (number && title) return `Chapter ${number} - ${title}`;
    if (number) return `Chapter ${number}`;
    if (title) return title;
    return null;
}

function formatDetail(item: any) {
    return {
        title: item.title || null,
        url: makeSeriesUrl(item.manga_id),
        manga_id: item.manga_id || null,
        alternative_title: item.alternative_title || null,
        description: item.description || null,
        release_year: item.release_year || null,
        country: item.country_id || null,
        status: item.status ?? null,
        rating: item.user_rate ?? null,
        view_count: item.view_count ?? null,
        bookmark_count: item.bookmark_count ?? null,
        cover: item.cover_image_url || null,
        cover_portrait: item.cover_portrait_url || null,
        author: pickTaxonomy(item.taxonomy, 'Author'),
        artist: pickTaxonomy(item.taxonomy, 'Artist'),
        format: pickTaxonomy(item.taxonomy, 'Format'),
        genre: pickTaxonomy(item.taxonomy, 'Genre'),
        type: pickTaxonomy(item.taxonomy, 'Type'),
        latest_chapter: {
            number: item.latest_chapter_number ?? null,
            id: item.latest_chapter_id || null,
            url: makeChapterUrl(item.latest_chapter_id),
            time: item.latest_chapter_time || null
        },
        updated_at: item.updated_at || null
    };
}

function formatChapter(item: any) {
    return {
        title: makeChapterName(item),
        chapter_number: item.chapter_number ?? null,
        chapter_title: item.chapter_title || null,
        chapter_id: item.chapter_id || null,
        url: makeChapterUrl(item.chapter_id),
        thumbnail: item.thumbnail_image_url || null,
        view_count: item.view_count ?? null,
        release_date: item.release_date || null
    };
}

export default async function shinigamidetailHandler(req: Request, res: Response) {
    const input = String(req.query.url || req.query.id || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const pageSize = Math.min(Number(req.query.page_size) || 24, 50);
    const sortOrder = req.query.sort === 'asc' ? 'asc' : 'desc';

    const mangaId = getUuid(input);

    if (!mangaId) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'id' (berisi manga_id/UUID) diperlukan."
        });
    }

    const client = axios.create({
        baseURL: BASE_URL,
        timeout: 20000,
        headers: {
            accept: 'application/json',
            referer: `${WEB_URL}/`,
            origin: WEB_URL
        },
        validateStatus: () => true
    });

    const detail = await client.get(`/v1/manga/detail/${mangaId}`);

    if (detail.status < 200 || detail.status >= 300 || !detail.data) {
        return res.status(502).json({
            status: false,
            message: 'Manga tidak ditemukan atau provider gagal merespons.'
        });
    }

    const chapters = await client.get(`/v1/chapter/${mangaId}/list`, {
        params: { page, page_size: pageSize, sort_by: 'chapter_number', sort_order: sortOrder }
    });

    const chapterList = Array.isArray(chapters.data?.data) ? chapters.data.data.map(formatChapter) : [];

    return res.json({
        status: detail.data.retcode === 0,
        manga_id: mangaId,
        result: detail.data.data ? formatDetail(detail.data.data) : null,
        chapters: {
            page: chapters.data?.meta?.page ?? page,
            page_size: chapters.data?.meta?.page_size ?? pageSize,
            total_page: chapters.data?.meta?.total_page ?? null,
            total_record: chapters.data?.meta?.total_record ?? null,
            sort_order: sortOrder,
            total: chapterList.length,
            result: chapterList
        }
    });
}
