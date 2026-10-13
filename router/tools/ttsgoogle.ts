import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Google Translate Text-to-Speech
 * Diadaptasi dari referensi google-tts.js.
 *
 * Beda dari referensi asli:
 * - Referensi asli pakai package 'google-tts-api' dan menulis hasil ke
 *   file lokal. Di sini dipanggil LANGSUNG ke endpoint publik
 *   translate.google.com/translate_tts lewat axios (yang sebenarnya
 *   dipakai juga oleh 'google-tts-api' di balik layar) supaya tidak
 *   menambah dependency baru yang belum diverifikasi kompatibel dengan
 *   build project ini (project ini punya riwayat masalah serius dengan
 *   package pihak ketiga yang bermasalah saat di-bundle, lihat catatan
 *   di router/tools/screenshot.ts soal '@microlink/mql').
 * - Endpoint Google TTS punya batas ~200 karakter per request, jadi teks
 *   panjang dipecah per kalimat/tanda baca lalu digabung jadi satu file
 *   audio, persis seperti perilaku 'splitPunct' di referensi asli.
 * - Hasil dikembalikan sebagai JSON base64, konsisten dengan
 *   /api/tools/tts (Edge TTS) yang sudah ada, bukan sebagai file di
 *   disk.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_CHUNK_LEN = 200;
const SPLIT_PUNCT = /([,.?!，、。]+)/;

function splitText(text: string): string[] {
    const rawParts = text.split(SPLIT_PUNCT).reduce<string[]>((acc, part, i, arr) => {
        if (i % 2 === 0) {
            const punct = arr[i + 1] || '';
            const combined = (part + punct).trim();
            if (combined) acc.push(combined);
        }
        return acc;
    }, []);

    const parts = rawParts.length ? rawParts : [text];
    const chunks: string[] = [];

    for (const part of parts) {
        if (part.length <= MAX_CHUNK_LEN) {
            chunks.push(part);
            continue;
        }

        // Kalimat/klausa masih terlalu panjang, potong per kata supaya
        // tetap di bawah batas endpoint Google TTS.
        let current = '';
        for (const word of part.split(' ')) {
            const candidate = current ? `${current} ${word}` : word;
            if (candidate.length > MAX_CHUNK_LEN) {
                if (current) chunks.push(current);
                current = word;
            } else {
                current = candidate;
            }
        }
        if (current) chunks.push(current);
    }

    return chunks;
}

async function fetchChunkAudio(text: string, lang: string, slow: boolean): Promise<Buffer> {
    const response = await axios.get('https://translate.google.com/translate_tts', {
        responseType: 'arraybuffer',
        timeout: 20000,
        params: {
            ie: 'UTF-8',
            q: text,
            tl: lang,
            client: 'tw-ob',
            ttsspeed: slow ? '0.24' : '1'
        },
        headers: {
            'user-agent': UA,
            referer: 'https://translate.google.com/'
        }
    });

    return Buffer.from(response.data);
}

export default async function ttsGoogleHandler(req: Request, res: Response) {
    const text = String(req.query.text || req.query.q || '').trim();
    const lang = String(req.query.lang || 'id').trim();
    const slow = String(req.query.slow || 'false') === 'true';

    if (!text) {
        return res.status(400).json({ status: false, message: "Parameter 'text' diperlukan." });
    }

    if (text.length > 2000) {
        return res.status(400).json({ status: false, message: "Parameter 'text' maksimal 2000 karakter." });
    }

    const chunks = splitText(text);

    try {
        const buffers: Buffer[] = [];
        for (const chunk of chunks) {
            buffers.push(await fetchChunkAudio(chunk, lang, slow));
        }

        const finalBuffer = Buffer.concat(buffers);

        return res.json({
            status: true,
            text,
            lang,
            slow,
            chunks: chunks.length,
            format: 'mp3',
            audioBase64: `data:audio/mpeg;base64,${finalBuffer.toString('base64')}`
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal melakukan sintesis suara (Google TTS).'
        });
    }
}
