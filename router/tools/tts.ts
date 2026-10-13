import { Request, Response } from 'express';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
// @ts-ignore - JSON statis daftar voice Microsoft Edge TTS
import voicesData from '../../src/data/voices.json';

/*
 * Microsoft Edge Neural Text-to-Speech
 * Sumber daftar voice: voices.json (322 voice, 142 locale) — di-bundle statis
 * agar endpoint list tidak bergantung pada request live ke Microsoft.
 * Sintesis audio tetap live lewat WebSocket edge-tts (trial endpoint publik).
 */

interface EdgeVoice {
    Name: string;
    ShortName: string;
    Gender: string;
    Locale: string;
    FriendlyName: string;
}

const VOICES = voicesData as EdgeVoice[];
const DEFAULT_VOICE = 'id-ID-GadisNeural';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;

function escapeSsml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function buildSsml(text: string, voice: string, rate: string, pitch: string): string {
    return (
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
        `<voice name='${voice}'>` +
        `<prosody rate='${rate}' pitch='${pitch}'>${escapeSsml(text)}</prosody>` +
        `</voice></speak>`
    );
}

function synthesize(text: string, voice: string, rate: string, pitch: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WSS_URL, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
                Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
            }
        });

        const chunks: Buffer[] = [];
        const requestId = randomUUID().replace(/-/g, '');
        const timeout = setTimeout(() => {
            ws.terminate();
            reject(new Error('Timeout saat sintesis suara.'));
        }, 20000);

        ws.on('open', () => {
            const configMsg =
                `X-Timestamp:${new Date().toISOString()}\r\n` +
                `Content-Type:application/json; charset=utf-8\r\n` +
                `Path:speech.config\r\n\r\n` +
                JSON.stringify({
                    context: {
                        synthesis: {
                            audio: {
                                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: false },
                                outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
                            }
                        }
                    }
                });
            ws.send(configMsg);

            const ssml = buildSsml(text, voice, rate, pitch);
            const ssmlMsg =
                `X-RequestId:${requestId}\r\n` +
                `Content-Type:application/ssml+xml\r\n` +
                `X-Timestamp:${new Date().toISOString()}\r\n` +
                `Path:ssml\r\n\r\n${ssml}`;
            ws.send(ssmlMsg);
        });

        ws.on('message', (data: Buffer, isBinary: boolean) => {
            if (!isBinary) {
                const text = data.toString();
                if (text.includes('Path:turn.end')) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(Buffer.concat(chunks));
                }
                return;
            }

            // Frame biner: 2 byte panjang header, lalu header teks, lalu audio mp3
            const headerLength = data.readUInt16BE(0);
            const audioChunk = data.subarray(headerLength + 2);
            if (audioChunk.length > 0) chunks.push(audioChunk);
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

export default async function ttsHandler(req: Request, res: Response) {
    const text = String(req.query.text || req.query.q || '').trim();
    const voiceParam = String(req.query.voice || DEFAULT_VOICE).trim();
    const rate = String(req.query.rate || '+0%');
    const pitch = String(req.query.pitch || '+0Hz');

    if (!text) {
        return res.status(400).json({ status: false, message: "Parameter 'text' diperlukan." });
    }

    if (text.length > 2000) {
        return res.status(400).json({ status: false, message: "Parameter 'text' maksimal 2000 karakter." });
    }

    const voice = VOICES.find(
        (v) => v.ShortName.toLowerCase() === voiceParam.toLowerCase()
    );

    if (!voice) {
        return res.status(400).json({
            status: false,
            message: `Voice '${voiceParam}' tidak ditemukan. Gunakan /api/tools/ttsvoices untuk melihat daftar voice yang tersedia.`
        });
    }

    try {
        const audio = await synthesize(text, voice.ShortName, rate, pitch);

        return res.json({
            status: true,
            text,
            voice: voice.ShortName,
            locale: voice.Locale,
            gender: voice.Gender,
            format: 'mp3',
            audioBase64: `data:audio/mpeg;base64,${audio.toString('base64')}`
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal melakukan sintesis suara.'
        });
    }
}
