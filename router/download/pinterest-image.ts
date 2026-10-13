import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Pinterest Image Downloader
 * Pin image Pinterest sudah berupa direct CDN URL (i.pinimg.com),
 * jadi endpoint ini cukup memvalidasi URL & mengembalikan metadatanya
 * tanpa perlu buffer file ke disk (tidak cocok untuk serverless).
 */

export default async function pinterestImageHandler(req: Request, res: Response) {
    const url = String(req.query.url || req.body?.url || '').trim();

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' diperlukan (link gambar i.pinimg.com)."
        });
    }

    try {
        const head = await axios.head(url, {
            timeout: 15000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        const filename = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image.jpg');
        const size = Number(head.headers['content-length'] || 0);

        return res.json({
            status: true,
            input: url,
            filename,
            content_type: head.headers['content-type'] || null,
            size_bytes: size || null,
            size_formatted: size ? `${(size / 1024).toFixed(2)} KB` : null,
            download: url
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memvalidasi URL gambar Pinterest.'
        });
    }
}
