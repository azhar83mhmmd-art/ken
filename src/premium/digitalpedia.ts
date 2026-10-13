/*
 * Kairoo API | Kairoo Premium — Developer Tools
 * Client untuk pay.digitalpedia.web.id. API Key ini milik akun DigitalPedia
 * KAIROO SENDIRI (bukan per-user) — deposit masuk ke saldo Kairoo, lalu
 * dipakai sebagai bukti bayar untuk menandai akun user sebagai Premium.
 *
 * PENTING: ini API deposit SALDO, bukan subscription native. Auto-renew
 * bulanan TIDAK didukung provider ini — user membayar ulang tiap periode,
 * dan expiry Premium dicek lewat premium_expires_at (lihat premiumRoutes.ts).
 */
import axios from 'axios';

const BASE_URL = 'https://pay.digitalpedia.web.id';

const apiKey = process.env.DIGITALPEDIA_API_KEY || '';
export const hasDigitalPedia = Boolean(apiKey) && !apiKey.toLowerCase().includes('xxxx');

if (!hasDigitalPedia) {
    console.warn('[!] DIGITALPEDIA_API_KEY belum diisi — klaim Kairoo Premium (pembayaran) nonaktif.');
}

const client = axios.create({
    baseURL: BASE_URL,
    timeout: 20000,
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey }
});

export type DepositCreateResult = {
    id: string;
    amount: number;
    fee: number;
    total_payment: number;
    qr_image: string;
    status: string;
    expired_at: number;
};

export async function createDeposit(amount: number): Promise<DepositCreateResult> {
    const { data } = await client.post('/api/deposit/create', { amount });
    if (!data?.success || !data?.deposit) {
        throw new Error(data?.message || 'Gagal membuat invoice deposit.');
    }
    return data.deposit;
}

export async function checkDepositStatus(depositId: string): Promise<{ status: 'pending' | 'success' | 'expired' | 'canceled'; message: string }> {
    const { data } = await client.post('/api/deposit/status', { deposit_id: depositId });
    if (!data?.success) {
        throw new Error(data?.message || 'Gagal cek status deposit.');
    }
    return { status: data.status, message: data.message };
}
