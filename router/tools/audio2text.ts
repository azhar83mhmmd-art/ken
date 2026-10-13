import { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import https from 'https';
import os from 'os';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fetchSourceBuffer, getSourceUrl } from '../upload/_shared';

/*
 * Audio to Text (transcribe)
 * Diadaptasi dari referensi audio2txt.js.
 * Provider: audioconvert.ai (akun tamu/guest, tanpa perlu API key).
 *
 * Beda dari referensi asli:
 * - Referensi asli baca audio dari path lokal lewat fs.createReadStream
 *   dan menghitung durasi lewat `ffprobe` (binary command-line eksternal).
 *   Endpoint API di sini menerima parameter `url` (audio diambil dulu
 *   lewat fetchSourceBuffer, sama seperti fitur upload/upscale lain),
 *   dan tetap MENCOBA ffprobe untuk estimasi durasi (dibutuhkan provider
 *   untuk cek kuota tamu) - tapi kalau ffprobe tidak terpasang di server
 *   (banyak VPS/Termux minimal tidak punya ffmpeg), otomatis fallback ke
 *   estimasi 1 menit, PERSIS seperti perilaku catch{} di referensi asli.
 *   Jadi endpoint ini tetap bisa jalan walau ffmpeg tidak ada, hanya saja
 *   estimasi kuota kurang akurat untuk audio yang lebih dari 1 menit.
 */

const BASE = 'https://audioconvert.ai';
const PAGE_URL = `${BASE}/id`;
const JWT_SECRET = 'auc995cx6se';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

const execFileAsync = promisify(execFile);

function base64url(input: string): string {
    return Buffer.from(input).toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createGuestBearer() {
    const userId = crypto.randomUUID();
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = { userId };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const data = `${encodedHeader}.${encodedPayload}`;

    const signature = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(data)
        .digest('base64')
        .replace(/=+$/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${data}.${signature}`;
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanUploadUrl(uploadUrl: string): string {
    return uploadUrl.split('?')[0];
}

async function getDurationMinutesFromBuffer(buffer: Buffer): Promise<number> {
    // ffprobe butuh path file, bukan buffer, jadi tulis ke file sementara dulu.
    const tmpFile = path.join(os.tmpdir(), `kairoo-audio2text-${Date.now()}.tmp`);

    try {
        await fs.writeFile(tmpFile, buffer);

        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            tmpFile
        ]);

        const seconds = Number(stdout.trim());

        if (!Number.isFinite(seconds) || seconds <= 0) return 1;

        return Math.max(1, Math.ceil(seconds / 60));
    } catch {
        // ffprobe tidak ada / gagal - fallback konservatif, sama seperti referensi asli.
        return 1;
    } finally {
        await fs.unlink(tmpFile).catch(() => {});
    }
}

function makeClient() {
    return axios.create({ timeout: 30000, validateStatus: () => true });
}

function headersBase(token: string) {
    return {
        'user-agent': UA,
        authorization: `Bearer ${token}`,
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        referer: PAGE_URL
    };
}

async function warmup(client: ReturnType<typeof makeClient>) {
    await client.get(PAGE_URL, {
        headers: {
            'user-agent': UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            referer: BASE
        }
    });
}

async function presign(client: ReturnType<typeof makeClient>, token: string, filename: string): Promise<string> {
    const url = `${BASE}/api/resource/upload/presign?filename=${encodeURIComponent(filename)}`;
    const { data, status } = await client.get(url, { headers: { ...headersBase(token), accept: '*/*' } });

    if (status < 200 || status >= 300 || data?.code !== 100000 || !data?.data?.upload_url) {
        throw new Error(`Gagal mengambil upload URL dari provider (HTTP ${status}).`);
    }

    return data.data.upload_url;
}

function uploadToOss(uploadUrl: string, buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(uploadUrl);

        const req = https.request(
            parsed,
            { method: 'PUT', headers: { 'Content-Length': buffer.length } },
            (res) => {
                let body = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => (body += chunk));
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(cleanUploadUrl(uploadUrl));
                    } else {
                        reject(new Error(`Upload audio ke provider gagal (HTTP ${res.statusCode}).`));
                    }
                });
            }
        );

        req.on('error', reject);
        req.end(buffer);
    });
}

async function checkGuestQuota(client: ReturnType<typeof makeClient>, token: string, durationMinutes: number) {
    const { data, status } = await client.post(
        `${BASE}/api/transcribe/check-guest-quota`,
        { duration_minutes: durationMinutes },
        { headers: { ...headersBase(token), accept: 'application/json', 'content-type': 'application/json', origin: BASE } }
    );

    if (status < 200 || status >= 300 || data?.code !== 100000 || !data?.data?.allowed) {
        throw new Error('Kuota transkripsi tamu tidak mencukupi atau ditolak provider.');
    }
}

async function createTranscribe(client: ReturnType<typeof makeClient>, token: string, audioUrl: string, fileName: string) {
    const payload = { audio_url: audioUrl, language_code: '', file_name: fileName, scenario: 'auto' };

    const { data, status } = await client.post(`${BASE}/api/transcribe/`, payload, {
        headers: { ...headersBase(token), accept: 'application/json', 'content-type': 'application/json', origin: BASE }
    });

    if (status < 200 || status >= 300 || data?.code !== 100000 || !data?.data?.id) {
        throw new Error(`Gagal mengirim tugas transkripsi ke provider (HTTP ${status}).`);
    }

    return data.data.id as string;
}

function extractText(data: any): string | null {
    const d = data?.data ?? data;
    if (!d) return null;
    if (typeof d === 'string') return d;

    const value =
        d.text ?? d.transcript ?? d.result ?? d.content ?? d.transcription ??
        (Array.isArray(d.segments) ? d.segments.map((x: any) => x.text).filter(Boolean).join(' ') : null) ??
        null;

    if (typeof value === 'string') return value;

    if (value && typeof value === 'object') {
        return value.text ?? value.transcript ?? value.result ?? value.content ?? value.transcription ?? null;
    }

    return null;
}

async function pollResult(client: ReturnType<typeof makeClient>, token: string, taskId: string) {
    for (let i = 0; i < 40; i++) {
        const { status, data } = await client.get(`${BASE}/api/transcribe/${taskId}`, {
            headers: { ...headersBase(token), accept: '*/*' }
        });

        if (data?.code === 100001 || data?.message === 'Need Login') {
            return { done: false, needLogin: true, text: null as string | null };
        }

        if (status >= 200 && status < 300 && data?.code === 100000) {
            const task = data.data;
            const text = extractText(data);

            if (['succeeded', 'success', 'completed'].includes(task?.status) || text) {
                return { done: true, needLogin: false, text };
            }

            if (task?.status === 'failed' || task?.status === 'error') {
                throw new Error(task?.error ?? data?.message ?? 'Transkripsi gagal di sisi provider.');
            }
        }

        await sleep(3000);
    }

    return { done: false, needLogin: false, text: null as string | null };
}

export default async function audio2textHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' (link audio) diperlukan." });
    }

    try {
        const { buffer, filename } = await fetchSourceBuffer(sourceUrl);
        const token = createGuestBearer();
        const client = makeClient();

        await warmup(client);

        const durationMinutes = await getDurationMinutesFromBuffer(buffer);

        const uploadUrl = await presign(client, token, filename);
        const audioUrl = await uploadToOss(uploadUrl, buffer);

        await checkGuestQuota(client, token, durationMinutes);

        const taskId = await createTranscribe(client, token, audioUrl, filename);
        const poll = await pollResult(client, token, taskId);

        if (poll.needLogin) {
            return res.status(401).json({
                status: false,
                message: 'Provider meminta login (kemungkinan kuota tamu habis atau audio terlalu panjang).'
            });
        }

        if (!poll.done || !poll.text) {
            return res.status(504).json({
                status: false,
                message: 'Transkripsi belum selesai setelah menunggu (timeout). Coba lagi dengan audio yang lebih pendek.'
            });
        }

        return res.json({
            status: true,
            input: sourceUrl,
            result: { text: poll.text }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal melakukan transkripsi audio.'
        });
    }
}
