import { Request, Response } from 'express';

/*
 * PENTING (bug FUNCTION_INVOCATION_FAILED / ERR_REQUIRE_ESM di SEMUA route):
 * '@file-kiwi/node' di-publish sebagai ESM-only. Di runtime Vercel ini,
 * require() statis maupun import() dinamis (biasa atau dibungkus
 * new Function()) tetap berujung ke require() dan Node crash dengan
 * ERR_REQUIRE_ESM saat server start, sehingga SEMUA endpoint ikut 500.
 *
 * Fix: dependency '@file-kiwi/node' dihapus total dari package.json dan
 * endpoint ini dijadikan stub yang membalas 503. Route tetap terdaftar
 * (registry.ts & endpoints/upload.json tidak perlu diubah), tapi tidak
 * ada lagi package ESM-only yang dimuat.
 *
 * Untuk uploader lain, pakai /api/upload/catbox, /uguu, /tmpfiles, dst.
 */
export default async function filekiwiHandler(_req: Request, res: Response) {
    return res.status(503).json({
        status: false,
        message:
            'Endpoint filekiwi tidak tersedia di deployment Vercel (paket resmi File-Kiwi ESM-only dan tidak kompatibel dengan runtime). Gunakan uploader lain, misalnya /api/upload/catbox.'
    });
}
