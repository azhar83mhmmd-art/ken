import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Audio Surah dari Moshaf tertentu (mp3quran.net API v3)
 * server + nomor surah (3 digit) -> URL mp3 langsung.
 */

const SUWAR_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 jam
let suwarCache: { data: any[]; fetchedAt: number } | null = null;

async function getSuwar() {
    if (suwarCache && Date.now() - suwarCache.fetchedAt < SUWAR_CACHE_TTL) {
        return suwarCache.data;
    }

    const { data } = await axios.get('https://www.mp3quran.net/api/v3/suwar', {
        params: { language: 'eng' },
        timeout: 20000,
        headers: { accept: 'application/json' }
    });

    const suwar = Array.isArray(data?.suwar) ? data.suwar : [];
    suwarCache = { data: suwar, fetchedAt: Date.now() };
    return suwar;
}

export default async function murotalsurahHandler(req: Request, res: Response) {
    const server = String(req.query.server || '').trim();
    const surahNumber = Number(req.query.surah || req.query.number);

    if (!server) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'server' diperlukan (ambil dari hasil /api/tools/murotalreciter -> moshaf.server)."
        });
    }

    if (!surahNumber || surahNumber < 1 || surahNumber > 114) {
        return res.status(400).json({ status: false, message: "Parameter 'surah' harus angka 1-114." });
    }

    if (!/^https:\/\/server\d+\.mp3quran\.net\//i.test(server)) {
        return res.status(400).json({ status: false, message: "Parameter 'server' tidak valid." });
    }

    const suwar = await getSuwar();
    const surahMeta = suwar.find((s: any) => s.id === surahNumber);

    const padded = String(surahNumber).padStart(3, '0');
    const base = server.endsWith('/') ? server : `${server}/`;
    const audioUrl = `${base}${padded}.mp3`;

    return res.json({
        status: true,
        result: {
            surah_number: surahNumber,
            surah_name: surahMeta?.name?.trim() || null,
            makkia: surahMeta ? Boolean(surahMeta.makkia) : null,
            audio: audioUrl,
            download: audioUrl
        }
    });
}
