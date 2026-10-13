/*
 * Kairoo API | sylvatica.my.id
 * © Dandy
 *
 * Helper bersama untuk seluruh handler di kategori "upload".
 * Semua uploader butuh perilaku yang sama: ambil file dari sebuah URL
 * (parameter query `url`) lalu teruskan ke provider hosting pihak
 * ketiga. Logic pengambilan file + deteksi nama file/mime disatukan di
 * sini supaya tidak diulang di 15 file berbeda.
 *
 * File ini SENGAJA diawali underscore (mengikuti konvensi
 * router/maker/_canvas.ts & router/maker/_emoji.ts) supaya tidak
 * dianggap route endpoint oleh registry.
 */

import { Request } from 'express';
import axios from 'axios';
import path from 'path';

export const UA =
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

export interface FetchedSource {
    buffer: Buffer;
    filename: string;
    contentType: string;
}

/**
 * Ambil parameter `url` dari query atau body request.
 */
export function getSourceUrl(req: Request): string {
    return String(req.query.url || (req.body && req.body.url) || '').trim();
}

/**
 * Download file dari URL sumber lalu kembalikan sebagai Buffer,
 * lengkap dengan nama file & content-type hasil deteksi.
 */
export async function fetchSourceBuffer(sourceUrl: string): Promise<FetchedSource> {
    const response = await axios.get(sourceUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5,
        maxContentLength: 40 * 1024 * 1024, // 40MB
        maxBodyLength: 40 * 1024 * 1024,
        validateStatus: () => true,
        headers: {
            'user-agent': UA,
            accept: '*/*'
        }
    });

    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Gagal mengambil file sumber: HTTP ${response.status}`);
    }

    const contentType = String(response.headers['content-type'] || 'application/octet-stream');

    let filename = 'file';
    try {
        const parsed = new URL(sourceUrl);
        const base = path.basename(parsed.pathname);
        if (base) filename = decodeURIComponent(base);
    } catch {
        // biarkan default "file" kalau URL tidak bisa diparse
    }

    const disposition = String(response.headers['content-disposition'] || '');
    const match = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
    if (match?.[1]) {
        try {
            filename = decodeURIComponent(match[1]);
        } catch {
            filename = match[1];
        }
    }

    if (!path.extname(filename)) {
        const extFromMime: Record<string, string> = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
            'image/gif': '.gif'
        };
        filename += extFromMime[contentType.split(';')[0].trim()] || '';
    }

    return { buffer: Buffer.from(response.data), filename, contentType };
}

export function guessMime(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.avif': 'image/avif',
        '.txt': 'text/plain',
        '.json': 'application/json',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.rar': 'application/vnd.rar',
        '.7z': 'application/x-7z-compressed',
        '.mp4': 'video/mp4',
        '.mp3': 'audio/mpeg'
    };
    return map[ext] || 'application/octet-stream';
}

export function decodeHtmlEntities(text = ''): string {
    return text
        .replaceAll('&amp;', '&')
        .replaceAll('&quot;', '"')
        .replaceAll('&#039;', "'")
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>');
}
