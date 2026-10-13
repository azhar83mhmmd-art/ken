import { Request, Response } from 'express';
import axios from 'axios';

/*
 * GitHub Repo Downloader
 * Mengembalikan link zipball resmi dari api.github.com langsung
 * (bukan buffer file ke disk — tidak cocok untuk serverless).
 * Opsional: set env GITHUB_TOKEN untuk rate limit lebih lega.
 */

function parseRepoUrl(url: string) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
}

export default async function githubDownloadHandler(req: Request, res: Response) {
    const url = String(req.query.url || req.body?.url || '').trim();

    if (!url) {
        return res.status(400).json({
            status: false,
            message: "Parameter 'url' diperlukan (link repo GitHub)."
        });
    }

    const parsed = parseRepoUrl(url);
    if (!parsed) {
        return res.status(400).json({
            status: false,
            message: 'URL repo GitHub tidak valid.'
        });
    }

    const { owner, repo } = parsed;
    const headers: Record<string, string> = {
        accept: 'application/vnd.github+json',
        'user-agent': 'kairoo-api'
    };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    try {
        const info = await axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers, timeout: 15000 });

        return res.json({
            status: true,
            input: url,
            owner,
            repo,
            default_branch: info.data.default_branch,
            size_kb: info.data.size,
            stars: info.data.stargazers_count,
            private: info.data.private,
            download: `https://api.github.com/repos/${owner}/${repo}/zipball`
        });
    } catch (error: any) {
        const status = error.response?.status;
        return res.status(status === 404 ? 404 : 502).json({
            status: false,
            message: status === 404 ? 'Repo tidak ditemukan atau bersifat private.' : (error.message || 'Gagal mengambil data repo.')
        });
    }
}
