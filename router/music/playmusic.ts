import { Request, Response } from 'express';
// @ts-ignore - tidak menyediakan tipe TypeScript resmi
import yt from '@vreden/youtube_scraper';

/*
 * Play Music (YouTube -> MP3)
 * Search: @vreden/youtube_scraper
 * Convert: app.ytdown.to
 */

const BASE = 'https://app.ytdown.to';
const API = `${BASE}/proxy.php`;
const PAGE = `${BASE}/en27/`;

const UA =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

const MAX_POLL = 20;
const POLL_DELAY = 1500;

// Timeout per-request untuk setiap panggilan fetch() individual. Sebelumnya
// fetch() di file ini TIDAK punya timeout sama sekali (beda dengan axios di
// tempat lain yang selalu diberi timeout eksplisit) - kalau provider
// ytdown.to lambat/hang, request bisa menggantung sangat lama sebelum
// akhirnya gagal, inilah sumber utama keluhan "nunggu lumayan lama".
const FETCH_TIMEOUT = 15000;
const SEARCH_TIMEOUT = 15000;

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error: any) {
        if (error?.name === 'AbortError') {
            throw new Error(`Request timeout setelah ${timeoutMs / 1000}s.`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${timeoutMs / 1000}s.`)), timeoutMs);

        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

function parseSetCookie(headers: Headers): string {
    const setCookie = headers.get('set-cookie');
    if (!setCookie) return '';

    return setCookie
        .split(/,(?=\s*[^;,]+=)/g)
        .map((v) => v.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}

function randomGa() {
    const a = Math.floor(Math.random() * 1e10);
    const b = Math.floor(Date.now() / 1000);
    return `GA1.1.${a}.${b}`;
}

function buildCookie(cookieJar: string) {
    const now = Math.floor(Date.now() / 1000);
    const ga = `_ga=${randomGa()}`;
    const ga2 = `_ga_2K69M9RN1B=GS2.1.s${now}$o1$g1$t${now}$j49$l0$h0`;
    return [cookieJar, ga, ga2].filter(Boolean).join('; ');
}

async function warmup(): Promise<string> {
    const res = await fetchWithTimeout(PAGE, {
        method: 'GET',
        headers: {
            'user-agent': UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });
    await res.text().catch(() => '');
    return parseSetCookie(res.headers);
}

async function searchVideo(query: string) {
    const search = await yt.search(query);
    const video = search?.results?.find((v: any) => v.type === 'video') || search?.results?.[0];

    if (!video) throw new Error('Video tidak ditemukan.');
    if (!video.url) throw new Error('URL video tidak ditemukan.');

    return video;
}

async function requestDownload(videoUrl: string, cookieJar: string) {
    const body = new URLSearchParams({ url: videoUrl });

    const res = await fetchWithTimeout(API, {
        method: 'POST',
        headers: {
            'user-agent': UA,
            accept: '*/*',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            origin: BASE,
            referer: PAGE,
            'x-requested-with': 'XMLHttpRequest',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            cookie: buildCookie(cookieJar)
        },
        body
    });

    const text = await res.text();

    let json: any;
    try {
        json = JSON.parse(text);
    } catch {
        throw new Error(`Response bukan JSON: ${text.slice(0, 300)}`);
    }

    if (!res.ok) {
        throw new Error(`Download gagal HTTP ${res.status}`);
    }

    return json;
}

function pickMp3(downloadJson: any) {
    const items = downloadJson?.api?.mediaItems || [];

    const mp3 =
        items.find((x: any) => x.type === 'Audio' && x.mediaExtension === 'MP3') ||
        items.find((x: any) => x.type === 'Audio' && x.mediaQuality === '128K') ||
        items.find((x: any) => x.type === 'Audio');

    if (!mp3) return null;

    return {
        quality: mp3.mediaQuality,
        extension: mp3.mediaExtension,
        size: mp3.mediaFileSize,
        duration: mp3.mediaDuration,
        url: mp3.mediaUrl
    };
}

function isFinalUrl(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith('http') && value !== 'Waiting...' && value !== 'In Processing...';
}

async function resolveAudioUrl(mediaUrl: string) {
    for (let i = 1; i <= MAX_POLL; i++) {
        const res = await fetchWithTimeout(mediaUrl, {
            method: 'GET',
            headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*', referer: PAGE }
        });

        const text = await res.text();

        let json: any;
        try {
            json = JSON.parse(text);
        } catch {
            if (mediaUrl.startsWith('http')) return mediaUrl;
            throw new Error('Response polling bukan JSON.');
        }

        const fileUrl = json?.fileUrl || json?.url || json?.downloadUrl;
        if (isFinalUrl(fileUrl)) return fileUrl;

        if (json?.status === 'error' || json?.status === 'failed') {
            throw new Error('Render audio gagal di provider.');
        }

        await sleep(POLL_DELAY);
    }

    throw new Error('Audio belum selesai diproses (timeout).');
}

export default async function playmusicHandler(req: Request, res: Response) {
    const query = String(req.query.q || req.query.query || '').trim();

    if (!query) {
        return res.status(400).json({ status: false, message: "Parameter 'q' diperlukan." });
    }

    try {
        /*
         * searchVideo (yt.search, library eksternal) dan warmup (fetch
         * halaman ytdown.to untuk cookie) tidak saling bergantung, jadi
         * dijalankan paralel lewat Promise.all alih-alih berurutan -
         * memotong waktu tunggu tahap ini jadi hampir setengahnya.
         * searchVideo dibungkus withTimeout karena yt.search() tidak
         * punya opsi timeout bawaan dan sebelumnya bisa menggantung
         * tanpa batas kalau library/YouTube lambat merespons.
         */
        const [video, cookieJar] = await Promise.all([
            withTimeout(searchVideo(query), SEARCH_TIMEOUT, 'Pencarian video'),
            warmup()
        ]);

        const download = await requestDownload(video.url, cookieJar);
        const audio = pickMp3(download);

        if (!audio?.url) {
            return res.status(502).json({ status: false, message: 'URL audio tidak ditemukan.' });
        }

        audio.url = await resolveAudioUrl(audio.url);

        return res.json({
            status: true,
            query,
            result: {
                title: video.title,
                videoId: video.videoId,
                url: video.url,
                thumbnail: video.thumbnail,
                description: video.description,
                seconds: video.seconds,
                duration: video.duration,
                views: video.views,
                author: video.author,
                audio,
                downloader: {
                    title: download?.api?.title || null,
                    url: download?.api?.permanentLink || null
                }
            }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            query,
            message: error.message || 'Gagal memproses pencarian musik.'
        });
    }
}
