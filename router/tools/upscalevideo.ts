import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { randomUUID, randomInt } from 'crypto';
import { fetchSourceBuffer, getSourceUrl } from '../upload/_shared';

/*
 * Video Upscaler / Enhancer
 * Diadaptasi dari referensi upscale-video.js.
 * Provider: unwatermark.ai / unblurimage.ai (web API publik yang dipakai
 * situs mereka sendiri, tidak butuh API key).
 *
 * Beda dari referensi asli:
 * - Referensi asli baca video dari path lokal (fs.createReadStream) yang
 *   hardcode ke satu file (/home/container/assets/tt_9256.mp4). Endpoint
 *   API tidak punya akses ke filesystem pemanggil, jadi diganti jadi
 *   parameter `url` — video diambil dari URL itu dulu (reuse
 *   fetchSourceBuffer yang sama dipakai kategori /api/upload/*, batas
 *   40MB), baru buffer-nya di-PUT ke signed upload URL milik provider.
 * - Proses provider ini panjang (create upload url -> PUT file -> create
 *   job -> polling sampai selesai), jadi endpoint ini bisa perlu waktu
 *   lama (menit) tergantung durasi video & antrian provider. Kalau
 *   dijalankan di Vercel Serverless, kemungkinan besar bakal kena
 *   timeout function sebelum job selesai - fitur ini paling cocok
 *   dijalankan di VPS/Termux (app.listen(), tidak ada batas waktu keras).
 */

const API = 'https://api.unwatermark.ai';
const WEB = 'https://unblurimage.ai';
const PRODUCT_CODE = '067003';

const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomProductSerial(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += chars[randomInt(chars.length)];
    return out;
}

function videoMime(filename: string, fallback: string): string {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const map: Record<string, string> = {
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm',
        mkv: 'video/x-matroska'
    };
    return map[ext] || fallback || 'application/octet-stream';
}

function baseHeaders(productSerial: string, requestId: string, extra: Record<string, string> = {}) {
    return {
        accept: '*/*',
        origin: WEB,
        referer: `${WEB}/`,
        'user-agent': UA,
        'product-code': PRODUCT_CODE,
        'product-serial': productSerial,
        'x-request-id': requestId,
        ...extra
    };
}

async function postForm(endpoint: string, fields: Record<string, string>, productSerial: string, requestId: string) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    const res = await axios.post(`${API}${endpoint}`, form, {
        timeout: 30000,
        headers: baseHeaders(productSerial, requestId, form.getHeaders()),
        validateStatus: () => true
    });

    return { status: res.status, data: res.data };
}

async function getJson(endpoint: string, productSerial: string, requestId: string) {
    const res = await axios.get(`${API}${endpoint}`, {
        timeout: 20000,
        headers: baseHeaders(productSerial, requestId, { 'content-type': 'application/json; charset=UTF-8' }),
        validateStatus: () => true
    });

    return { status: res.status, data: res.data };
}

async function putBufferToSignedUrl(uploadUrl: string, buffer: Buffer, mime: string) {
    const res = await axios.put(uploadUrl, buffer, {
        timeout: 120000,
        headers: { 'content-type': mime, 'content-length': String(buffer.length) },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    });

    return { status: res.status, data: res.data };
}

function cleanPublicUrl(url: string): string {
    return String(url || '').split('?')[0];
}

async function createUploadUrl(filename: string, productSerial: string, requestId: string) {
    const result = await postForm('/api/web/common/upload/video', { video_file_name: filename }, productSerial, requestId);

    if (result.status >= 400 || result.data?.code !== 100000) {
        throw new Error(`Gagal ambil upload url dari provider: ${JSON.stringify(result.data)}`);
    }

    return result.data.result as { url: string };
}

async function createJob(originalVideoUrl: string, resolution: string, productSerial: string, requestId: string) {
    const result = await postForm(
        '/api/web/unblurimage/v1/video-enhancer/create-job',
        { original_video_url: originalVideoUrl, resolution, is_preview: 'false' },
        productSerial,
        requestId
    );

    if (result.status >= 400 || !result.data?.result?.job_id) {
        throw new Error(`Gagal membuat job di provider: ${JSON.stringify(result.data)}`);
    }

    return result.data.result as { job_id: string };
}

async function waitJob(jobId: string, productSerial: string, requestId: string, maxTry = 80, delayMs = 5000) {
    let last: any = null;

    for (let i = 1; i <= maxTry; i++) {
        const result = await getJson(`/api/web/unblurimage/v1/video-enhancer/get-job/${jobId}`, productSerial, requestId);
        last = result.data;

        const outputUrl = result.data?.result?.output_url;
        const status = result.data?.result?.status;

        if (Array.isArray(outputUrl) && outputUrl.length > 0) return result.data;
        if (status === 1) return result.data;

        await sleep(delayMs);
    }

    throw new Error(`Job belum selesai setelah menunggu (timeout): ${JSON.stringify(last)}`);
}

export default async function upscaleVideoHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const resolution = String(req.query.resolution || '2k');

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' (link video) diperlukan." });
    }

    if (!['2k', '4k', 'hd'].includes(resolution)) {
        return res.status(400).json({ status: false, message: "Parameter 'resolution' harus salah satu dari: hd, 2k, 4k." });
    }

    const productSerial = randomProductSerial();
    const requestId = randomUUID();

    try {
        const { buffer, filename, contentType } = await fetchSourceBuffer(sourceUrl);
        const mime = videoMime(filename, contentType);

        const upload = await createUploadUrl(filename, productSerial, requestId);
        const publicUrl = cleanPublicUrl(upload.url);

        const put = await putBufferToSignedUrl(upload.url, buffer, mime);
        if (put.status >= 400) {
            throw new Error(`Upload video ke provider gagal HTTP ${put.status}.`);
        }

        const job = await createJob(publicUrl, resolution, productSerial, requestId);
        const done = await waitJob(job.job_id, productSerial, requestId);

        const resultUrl = done?.result?.output_url?.[0] || null;

        if (!resultUrl) {
            return res.status(502).json({ status: false, message: 'Provider tidak mengembalikan video hasil.' });
        }

        return res.json({
            status: true,
            input: sourceUrl,
            resolution,
            result: { url: resultUrl }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memproses upscale video.'
        });
    }
}
