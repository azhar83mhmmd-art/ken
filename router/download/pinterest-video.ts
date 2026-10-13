import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Pinterest Video Downloader
 * Pinterest menyajikan video sebagai HLS (.m3u8). Endpoint ini mem-parse
 * master playlist dan mengembalikan link stream video (kualitas terbaik)
 * serta audio terpisah. Merge ke satu file MP4 SENGAJA tidak dilakukan
 * di sini karena butuh binary ffmpeg yang tidak tersedia di serverless —
 * gabungkan di sisi client, atau jalankan endpoint ini di server yang
 * punya ffmpeg jika butuh file MP4 tunggal.
 */

export default async function pinterestVideoHandler(req: Request, res: Response) {
    const masterUrl = String(req.query.url || req.body?.url || '').trim();

    if (!masterUrl) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' diperlukan (link .m3u8 dari v1.pinimg.com)."
        });
    }

    try {
        const { data: text } = await axios.get(masterUrl, { timeout: 15000, responseType: 'text' });
        const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
        const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);

        let videoStreamUrl: string | null = null;
        let audioStreamUrl: string | null = null;
        let lastBandwidth = 0;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                const bw = parseInt(lines[i].match(/BANDWIDTH=(\d+)/)?.[1] || '0');
                if (bw > lastBandwidth) {
                    lastBandwidth = bw;
                    const u = lines[i + 1];
                    videoStreamUrl = u?.startsWith('http') ? u : baseUrl + u;
                }
            }
            if (lines[i].startsWith('#EXT-X-MEDIA') && lines[i].includes('TYPE=AUDIO')) {
                const m = lines[i].match(/URI="([^"]+)"/);
                if (m) audioStreamUrl = m[1].startsWith('http') ? m[1] : baseUrl + m[1];
            }
        }

        if (!videoStreamUrl) {
            // Bukan master playlist — kemungkinan langsung media playlist
            return res.json({
                status: true,
                input: masterUrl,
                type: 'direct_stream',
                video: masterUrl,
                audio: null,
                note: 'URL ini bukan master playlist, gunakan langsung sebagai stream HLS.'
            });
        }

        return res.json({
            status: true,
            input: masterUrl,
            type: 'hls',
            video: videoStreamUrl,
            audio: audioStreamUrl,
            note: audioStreamUrl
                ? 'Video dan audio terpisah (butuh ffmpeg untuk digabung menjadi satu file MP4).'
                : 'Stream video sudah termasuk audio.'
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memproses playlist video Pinterest.'
        });
    }
}
