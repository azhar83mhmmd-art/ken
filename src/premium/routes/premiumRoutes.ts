/*
 * Kairoo API | Kairoo Premium — Developer Tools
 * Dashboard: klaim Premium via DigitalPedia (poin 14 spesifikasi).
 *
 * Alur:
 * POST /api/premium/upgrade/create
 *   -> buat deposit Rp15.000 di DigitalPedia (akun Kairoo), simpan baris
 *      premium_transactions status "pending" (cooldown status di provider
 *      30 detik, jadi frontend polling GET /status setiap >=30 detik)
 * GET  /api/premium/upgrade/status/:depositId
 *   -> cek status ke DigitalPedia; kalau "success" DAN transaksi ini milik
 *      user yang login DAN belum pernah diklaim -> aktifkan Premium 30 hari
 *      (tier=premium, premium_status=active, premium_expires_at=+30 hari)
 * POST /api/premium/upgrade/cancel/:depositId
 *   -> batalkan deposit pending
 */
import { Router, Request, Response } from 'express';
import { requireDashboardAuth } from '../authUser';
import { supabaseAdmin } from '../supabaseAdmin';
import { createDeposit, checkDepositStatus, hasDigitalPedia } from '../digitalpedia';

export const premiumRoutes = Router();
premiumRoutes.use(requireDashboardAuth);

const PREMIUM_PRICE = 15000;
const PREMIUM_DAYS = 30;

premiumRoutes.post('/upgrade/create', async (req: Request, res: Response) => {
    if (!hasDigitalPedia) {
        return res.status(503).json({ status: false, message: 'Pembayaran belum dikonfigurasi di server ini.' });
    }

    const userId = req.dashboardUser!.id;

    try {
        const deposit = await createDeposit(PREMIUM_PRICE);

        const { error } = await supabaseAdmin!
            .from('premium_transactions')
            .insert({
                user_id: userId,
                deposit_id: deposit.id,
                amount: deposit.amount,
                status: 'pending',
                premium_days_granted: PREMIUM_DAYS
            });

        if (error) {
            return res.status(500).json({ status: false, message: 'Gagal menyimpan transaksi.' });
        }

        return res.status(201).json({
            status: true,
            deposit: {
                id: deposit.id,
                amount: deposit.amount,
                fee: deposit.fee,
                total_payment: deposit.total_payment,
                qr_image: deposit.qr_image,
                expired_at: deposit.expired_at
            }
        });
    } catch (error: any) {
        return res.status(502).json({ status: false, message: error.message || 'Gagal membuat invoice.' });
    }
});

premiumRoutes.get('/upgrade/status/:depositId', async (req: Request, res: Response) => {
    if (!hasDigitalPedia) {
        return res.status(503).json({ status: false, message: 'Pembayaran belum dikonfigurasi di server ini.' });
    }

    const userId = req.dashboardUser!.id;
    const depositId = req.params.depositId;

    const { data: tx, error: txError } = await supabaseAdmin!
        .from('premium_transactions')
        .select('id, user_id, status, premium_days_granted')
        .eq('deposit_id', depositId)
        .maybeSingle();

    if (txError || !tx || tx.user_id !== userId) {
        return res.status(404).json({ status: false, message: 'Transaksi tidak ditemukan.' });
    }

    // Sudah pernah sukses & diklaim sebelumnya - jangan panggil provider lagi.
    if (tx.status === 'success') {
        return res.json({ status: true, deposit_status: 'success', message: 'Deposit berhasil! Premium sudah aktif.' });
    }

    try {
        const result = await checkDepositStatus(depositId);

        if (result.status === 'success' && tx.status !== 'success') {
            const expiresAt = new Date(Date.now() + (tx.premium_days_granted || PREMIUM_DAYS) * 24 * 60 * 60 * 1000);

            await supabaseAdmin!
                .from('premium_transactions')
                .update({ status: 'success' })
                .eq('id', tx.id);

            await supabaseAdmin!
                .from('profiles')
                .update({
                    tier: 'premium',
                    premium_status: 'active',
                    premium_started_at: new Date().toISOString(),
                    premium_expires_at: expiresAt.toISOString()
                })
                .eq('id', userId);
        } else if (result.status !== tx.status) {
            await supabaseAdmin!
                .from('premium_transactions')
                .update({ status: result.status })
                .eq('id', tx.id);
        }

        return res.json({ status: true, deposit_status: result.status, message: result.message });
    } catch (error: any) {
        return res.status(502).json({ status: false, message: error.message || 'Gagal cek status deposit.' });
    }
});

premiumRoutes.post('/upgrade/cancel/:depositId', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;
    const depositId = req.params.depositId;

    const { data: tx } = await supabaseAdmin!
        .from('premium_transactions')
        .select('id, user_id, status')
        .eq('deposit_id', depositId)
        .maybeSingle();

    if (!tx || tx.user_id !== userId) {
        return res.status(404).json({ status: false, message: 'Transaksi tidak ditemukan.' });
    }
    if (tx.status !== 'pending') {
        return res.status(400).json({ status: false, message: 'Hanya deposit pending yang bisa dibatalkan.' });
    }

    await supabaseAdmin!.from('premium_transactions').update({ status: 'canceled' }).eq('id', tx.id);

    return res.json({ status: true, message: 'Deposit berhasil dibatalkan.' });
});

// GET /api/premium/me — profil + status premium ringkas untuk dashboard
premiumRoutes.get('/me', async (req: Request, res: Response) => {
    const userId = req.dashboardUser!.id;

    const { data: profile } = await supabaseAdmin!
        .from('profiles')
        .select('id, email, name, avatar_url, tier, premium_status, premium_started_at, premium_expires_at')
        .eq('id', userId)
        .maybeSingle();

    return res.json({ status: true, profile: profile || null });
});
