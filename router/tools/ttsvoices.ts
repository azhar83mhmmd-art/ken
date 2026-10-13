import { Request, Response } from 'express';
// @ts-ignore - JSON statis daftar voice Microsoft Edge TTS
import voicesData from '../../src/data/voices.json';

interface EdgeVoice {
    ShortName: string;
    Gender: string;
    Locale: string;
    FriendlyName: string;
}

const VOICES = voicesData as EdgeVoice[];

export default async function ttsvoicesHandler(req: Request, res: Response) {
    const locale = String(req.query.locale || '').trim().toLowerCase();
    const search = String(req.query.q || req.query.search || '').trim().toLowerCase();

    let filtered = VOICES;

    if (locale) {
        filtered = filtered.filter((v) => v.Locale.toLowerCase() === locale || v.Locale.toLowerCase().startsWith(`${locale}-`));
    }

    if (search) {
        filtered = filtered.filter(
            (v) => v.FriendlyName.toLowerCase().includes(search) || v.ShortName.toLowerCase().includes(search)
        );
    }

    return res.json({
        status: true,
        total: filtered.length,
        result: filtered.map((v) => ({
            shortName: v.ShortName,
            friendlyName: v.FriendlyName,
            locale: v.Locale,
            gender: v.Gender
        }))
    });
}
