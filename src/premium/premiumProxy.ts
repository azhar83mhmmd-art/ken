/*
 * Kairoo API | Kairoo Premium — Developer Tools
 *
 * Premium Endpoint = alias/proxy ke endpoint Kairoo yang SUDAH ADA di
 * routerRegistry (src/registry.ts). BUKAN server baru, BUKAN handler
 * baru per user (poin 4 spesifikasi).
 *
 * Route: /premium/:endpointName/:category/:filename
 * Contoh: /premium/myapp/download/aio?url=...
 *   -> :endpointName = "myapp"  (custom endpoint name milik user)
 *   -> :category      = "download"
 *   -> :filename       = "aio"
 *   -> diteruskan ke routerRegistry.download.aio (fungsi yang SAMA
 *      dengan yang dipanggil /api/download/aio)
 *
 * Alur validasi (poin 4 & 16):
 * requireApiKey (401/429) -> cek endpointName milik Premium aktif (403) ->
 * cari handler asli -> jalankan -> recordUsage mencatat hasil nyatanya.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { routerRegistry } from '../registry';
import { requireApiKey, recordUsage } from './apiKeyMiddleware';

export const premiumRouter = Router();

premiumRouter.use(requireApiKey);
premiumRouter.use(recordUsage);

premiumRouter.all('/:endpointName/:category/:filename', async (req: Request, res: Response, next: NextFunction) => {
    const { endpointName, category, filename } = req.params;
    const auth = req.premiumAuth;

    // requireApiKey menjamin req.premiumAuth ada di titik ini, tapi tetap
    // dicek eksplisit supaya TypeScript & pembaca kode tidak perlu asumsi.
    if (!auth) {
        return res.status(401).json({ status: false, message: 'API Key Required' });
    }

    // 8. Kalau ini Premium Endpoint, apakah akun ini Premium?
    if (auth.tier !== 'premium') {
        return res.status(403).json({ status: false, message: 'Premium Required' });
    }

    // Premium Endpoint di URL harus cocok dengan endpoint_name milik akun
    // ini sendiri — mencegah akun Premium A memakai
    // /premium/<nama-milik-B>/... walau API Key A valid.
    if (!auth.endpointName || auth.endpointName !== endpointName) {
        return res.status(403).json({ status: false, message: 'Premium Required' });
    }

    const handler = routerRegistry[category]?.[filename];

    if (typeof handler !== 'function') {
        return res.status(404).json({ status: false, message: 'Endpoint not found' });
    }

    try {
        await handler(req, res, next);
    } catch (error) {
        next(error);
    }
});
