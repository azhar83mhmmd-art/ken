import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Daftar Qori/Reciter Murotal (mp3quran.net API v3)
 * Live dari provider, bukan snapshot statis, supaya selalu up to date.
 */

export default async function murotalreciterHandler(req: Request, res: Response) {
    const language = String(req.query.language || 'eng').trim();
    const search = String(req.query.q || req.query.search || '').trim().toLowerCase();

    const { data } = await axios.get('https://www.mp3quran.net/api/v3/reciters', {
        params: { language },
        timeout: 20000,
        headers: { accept: 'application/json' }
    });

    let reciters = Array.isArray(data?.reciters) ? data.reciters : [];

    if (search) {
        reciters = reciters.filter((r: any) => String(r.name || '').toLowerCase().includes(search));
    }

    const result = reciters.map((r: any) => ({
        id: r.id,
        name: r.name,
        letter: r.letter,
        moshaf: (r.moshaf || []).map((m: any) => ({
            id: m.id,
            name: m.name,
            rewaya_id: m.rewaya_id,
            server: m.server,
            surah_total: m.surah_total,
            surah_list: String(m.surah_list || '')
                .split(',')
                .filter(Boolean)
                .map((n: string) => Number(n))
        }))
    }));

    return res.json({
        status: true,
        language,
        total: result.length,
        result
    });
}
