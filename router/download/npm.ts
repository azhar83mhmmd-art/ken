import { Request, Response } from 'express';
import axios from 'axios';

/*
 * NPM Package Downloader
 * Mengembalikan metadata & link tarball resmi dari registry.npmjs.org
 * langsung (bukan buffer file ke disk — tidak cocok untuk serverless).
 */

export default async function npmDownloadHandler(req: Request, res: Response) {
    const input = String(req.query.url || req.query.package || req.body?.url || '').trim();

    if (!input) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' atau 'package' diperlukan (nama paket atau URL npmjs.com)."
        });
    }

    let pkg = input;
    let version: string | null = null;

    try {
        const url = new URL(input);
        pkg = url.pathname.split('/package/')[1] || input;
        if (pkg.includes('/v/')) {
            const parts = pkg.split('/v/');
            pkg = parts[0];
            version = parts[1];
        }
    } catch {
        // bukan URL, anggap sudah nama paket
    }

    const endpoint = version
        ? `https://registry.npmjs.org/${encodeURIComponent(pkg)}/${version}`
        : `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;

    try {
        const { data: meta } = await axios.get(endpoint, { timeout: 15000 });

        return res.json({
            status: true,
            input,
            name: meta.name,
            version: meta.version,
            description: meta.description || null,
            license: meta.license || null,
            homepage: meta.homepage || null,
            download: meta.dist?.tarball || null,
            unpacked_size: meta.dist?.unpackedSize || null
        });
    } catch (error: any) {
        const status = error.response?.status;
        return res.status(status === 404 ? 404 : 502).json({
            status: false,
            message: status === 404 ? `Paket "${pkg}" tidak ditemukan.` : (error.message || 'Gagal mengambil data paket.')
        });
    }
}
