import { Request, Response } from 'express';
import axios from 'axios';
import FormData from 'form-data';
import { fetchSourceBuffer, getSourceUrl, UA } from '../upload/_shared';

/*
 * AI Vocal Remover / Music Separator
 * Provider: x-minus.pro (mmd.uvronline.app)
 *
 * Berbeda dari skrip aslinya, endpoint ini TIDAK menulis file apa pun
 * ke disk lokal (tidak relevan/tidak aman di lingkungan serverless).
 * File sumber diambil dari `url`, diteruskan langsung ke provider via
 * multipart in-memory, lalu hasilnya dikembalikan sebagai URL siap unduh.
 */

const XM_ORIGIN = 'https://x-minus.pro';
const XM_AI_URL = 'https://x-minus.pro/ai';
const MMD_HOST = 'https://mmd.uvronline.app';

function extractAuthKey(html: string): string {
    const m = html.match(/auth_key['"]?\s*[:=]\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
    const m2 = html.match(/g\d+-[a-f0-9]+-\d+/);
    if (m2) return m2[0];
    throw new Error('auth_key tidak ditemukan di halaman x-minus.pro/ai.');
}

async function getSession() {
    const res = await axios.get(XM_AI_URL, {
        timeout: 20000,
        headers: {
            'user-agent': UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            referer: XM_AI_URL
        }
    });
    return extractAuthKey(res.data);
}

async function uploadJob(buffer: Buffer, filename: string, authKey: string, format: string, model: string) {
    const form = new FormData();
    form.append('auth_key', authKey);
    form.append('locale', 'en_US');
    form.append('separation', 'inst_vocal');
    form.append('separation_type', 'vocals_music');
    form.append('format', format);
    form.append('version', '3-4-0');
    form.append('model', model);
    form.append('aggressiveness', '2');
    form.append('lvpanning', 'center');
    form.append('uvrbve_ct', 'auto');
    form.append('pre_rate', '100');
    form.append('bve_preproc', 'auto');
    form.append('show_setting_format', '0');
    form.append('hostname', 'x-minus.pro');
    form.append('client_fp', '-');
    form.append('myfile', buffer, { filename, contentType: 'audio/mpeg' });

    const res = await axios.post(`${MMD_HOST}/upload/vocalCutAi?catch-file`, form, {
        timeout: 30000,
        headers: {
            ...form.getHeaders(),
            'user-agent': UA,
            origin: XM_ORIGIN,
            referer: `${XM_ORIGIN}/`,
            accept: '*/*'
        }
    });

    return res.data;
}

async function checkJobStatus(jobId: string, authKey: string) {
    const form = new FormData();
    form.append('job_id', jobId);
    form.append('auth_key', authKey);
    form.append('locale', 'en_US');

    const res = await axios.post(`${MMD_HOST}/upload/vocalCutAi?check-job-status`, form, {
        timeout: 20000,
        headers: {
            ...form.getHeaders(),
            'user-agent': UA,
            origin: XM_ORIGIN,
            referer: `${XM_ORIGIN}/`,
            accept: '*/*'
        }
    });

    return res.data;
}

async function waitForJob(jobId: string, authKey: string, intervalMs = 3000, timeoutMs = 90000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await checkJobStatus(jobId, authKey);
        if (status?.status === 'done' || status?.status === 'error') {
            return status;
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error('Timeout menunggu proses pemisahan audio selesai.');
}

function buildDownloadUrl(jobId: string, stem: 'vocal' | 'inst', fmt: string) {
    return `${MMD_HOST}/dl/vocalCutAi?job-id=${jobId}&stem=${stem}&fmt=${fmt}&cdn=0`;
}

async function resolveDownloadUrl(url: string) {
    const res = await axios.get(url, {
        maxRedirects: 0,
        timeout: 20000,
        validateStatus: () => true,
        headers: {
            'user-agent': UA,
            referer: `${XM_ORIGIN}/`,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    });

    if (res.status >= 300 && res.status < 400 && res.headers.location) {
        return res.headers.location as string;
    }
    return url;
}

export default async function vocalremoverHandler(req: Request, res: Response) {
    const sourceUrl = getSourceUrl(req);
    const format = String(req.query.format || 'mp3').toLowerCase();
    const model = String(req.query.model || 'mdx_v2_vocft');

    if (!sourceUrl) {
        return res.status(400).json({ status: false, message: "Parameter 'url' (link audio) diperlukan." });
    }

    if (!/^https?:\/\//i.test(sourceUrl)) {
        return res.status(400).json({ status: false, message: "Parameter 'url' harus diawali http:// atau https://." });
    }

    try {
        const source = await fetchSourceBuffer(sourceUrl);
        const authKey = await getSession();

        const uploadResult = await uploadJob(source.buffer, source.filename, authKey, format, model);

        if (uploadResult?.status !== 'accepted') {
            return res.status(502).json({
                status: false,
                message: 'Provider menolak file audio yang diunggah.',
                detail: uploadResult
            });
        }

        const jobId = uploadResult.job_id;
        const finalStatus = await waitForJob(jobId, authKey);

        if (finalStatus.status !== 'done') {
            return res.status(502).json({
                status: false,
                message: 'Proses pemisahan audio gagal.',
                detail: finalStatus
            });
        }

        const [vocalUrl, instUrl] = await Promise.all([
            resolveDownloadUrl(buildDownloadUrl(jobId, 'vocal', format)),
            resolveDownloadUrl(buildDownloadUrl(jobId, 'inst', format))
        ]);

        return res.json({
            status: true,
            result: {
                format,
                model,
                vocal_url: vocalUrl,
                instrumental_url: instUrl
            }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal memproses pemisahan vokal.'
        });
    }
}
