import { Request, Response } from 'express';
import QRCode from 'qrcode';
import { fetchSourceBuffer, getSourceUrl, UA } from '../upload/_shared';
import axios from 'axios';
import FormData from 'form-data';

/*
 * QR Code Generator
 * Diadaptasi dari referensi qrcode-text.js & qrcode-file.js.
 *
 * Beda dari referensi aslinya:
 * - Referensi qrcode-file.js hardcode path file lokal
 *   (/home/container/assets/...) dan hanya bisa dipakai sebagai script CLI.
 *   Di endpoint API ini, orang lain tidak punya akses ke filesystem server
 *   kita, jadi diganti jadi parameter `url` — kalau diisi, file di URL itu
 *   diambil lalu diupload ulang ke uguu.se (reuse helper yang sama dipakai
 *   /api/upload/uguu) untuk dapat link publik, baru link itu di-QR-kan.
 *   Kalau `url` kosong, endpoint ini berfungsi sama seperti qrcode-text.js:
 *   nge-QR teks apa adanya (URL, nomor telepon, WiFi, vCard, dll — semua
 *   format QR text biasa tetap didukung tanpa perubahan).
 * - Warna & ukuran tetap bisa diatur via parameter (fg/bg/size), default
 *   sama seperti referensi (hitam di atas putih, 1024px).
 */

async function uploadToUguu(sourceUrl: string): Promise<string> {
    const { buffer, filename } = await fetchSourceBuffer(sourceUrl);

    const form = new FormData();
    form.append('files[]', buffer, { filename, contentType: 'application/octet-stream' });

    const response = await axios.post('https://uguu.se/upload.php', form, {
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true,
        headers: {
            ...form.getHeaders(),
            accept: '*/*',
            origin: 'https://uguu.se',
            referer: 'https://uguu.se/',
            'user-agent': UA,
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    });

    const resultUrl = response.data?.files?.[0]?.url || null;

    if (!(response.status === 200 && response.data?.success === true && resultUrl)) {
        throw new Error('Upload file ke uguu.se gagal.');
    }

    return resultUrl;
}

function hex(color: string): string {
    return color.startsWith('#') ? color : `#${color}`;
}

export default async function qrcodeHandler(req: Request, res: Response) {
    const text = String(req.query.text || req.query.q || '').trim();
    const sourceUrl = getSourceUrl(req);
    const size = Math.min(Math.max(Number(req.query.size) || 1024, 64), 2048);
    const fg = String(req.query.fg || '000000');
    const bg = String(req.query.bg || 'FFFFFF');

    if (!text && !sourceUrl) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'text' (isi QR) atau 'url' (file yang mau di-QR-kan linknya) diperlukan."
        });
    }

    let content = text;
    let uploadedUrl: string | null = null;

    try {
        if (!content && sourceUrl) {
            uploadedUrl = await uploadToUguu(sourceUrl);
            content = uploadedUrl;
        }

        const buffer = await QRCode.toBuffer(content, {
            type: 'png',
            errorCorrectionLevel: 'H',
            margin: 4,
            width: size,
            color: {
                dark: hex(fg),
                light: hex(bg)
            }
        });

        if (uploadedUrl) {
            res.set('X-Qr-Content', uploadedUrl);
        }

        res.set('Content-Type', 'image/png');
        return res.send(buffer);
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal membuat QR code.'
        });
    }
}
