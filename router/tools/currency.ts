import { Request, Response } from 'express';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

/*
 * Currency Converter (Wise)
 * Diadaptasi dari referensi wise-currency-converter.js.
 * Data kurs diambil dari halaman publik wise.com/currency-converter
 * (tidak butuh login, sama seperti yang bisa diakses siapa saja lewat
 * browser) - lalu grafik historis dirender lewat quickchart.io (layanan
 * publik render chart, tanpa API key), pola yang sama dipakai provider
 * "microlink" di router/tools/screenshot.ts & router/maker/carbon.ts.
 *
 * Beda dari referensi asli:
 * - Referensi asli menulis PNG chart ke file lokal. Endpoint ini
 *   mengembalikan chart sebagai base64 inline di response JSON
 *   (konsisten dengan pola audioBase64 di /api/tools/tts), bukan path
 *   filesystem yang tidak berguna buat pemanggil API.
 * - Mode "currencies" (daftar semua mata uang) & mode "convert" digabung
 *   jadi satu endpoint dengan parameter `mode`, bukan dua script
 *   terpisah.
 */

const BASE_URL = 'https://wise.com';
const LOCALE = 'id';
const UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36';

function makeClients() {
    const jar = new CookieJar();

    const client = wrapper(axios.create({
        jar,
        withCredentials: true,
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'user-agent': UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    }));

    const api = wrapper(axios.create({
        jar,
        withCredentials: true,
        timeout: 30000,
        validateStatus: () => true,
        headers: {
            'user-agent': UA,
            accept: 'application/json,text/plain,*/*',
            'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
        }
    }));

    return { client, api };
}

function decodeHtml(value: string): string {
    return String(value)
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function pickNextData(html: string): any {
    const match = String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) return null;
    try {
        return JSON.parse(decodeHtml(match[1]));
    } catch {
        return null;
    }
}

function normalizeCode(code: string): string {
    return String(code || '').trim().toUpperCase();
}

function numberValue(value: any): number | null {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function formatDateLabel(value: any): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toISOString().slice(0, 10);
}

function normalizeHistory(data: any): { Date: string; Rate: number }[] {
    const raw = Array.isArray(data)
        ? data
        : Array.isArray(data?.data) ? data.data
        : Array.isArray(data?.rates) ? data.rates
        : Array.isArray(data?.history) ? data.history
        : [];

    const points = raw
        .map((item: any) => {
            const date = item.time || item.date || item.timestamp || item.createdTime || item.providerTimestamp;
            const rate = numberValue(item.rate ?? item.value ?? item.mid ?? item.close);
            return { date: formatDateLabel(date), rate };
        })
        .filter((item: any) => item.rate != null);

    const map = new Map<string, number>();
    for (const item of points) map.set(item.date, item.rate);

    return [...map.entries()]
        .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())
        .map(([Date_, Rate]) => ({ Date: Date_, Rate }));
}

async function fetchPage(client: ReturnType<typeof makeClients>['client'], from: string, to: string, amount: number) {
    const slug = `${from.toLowerCase()}-to-${to.toLowerCase()}-rate`;
    const url = `${BASE_URL}/${LOCALE}/currency-converter/${slug}?amount=${encodeURIComponent(amount)}`;
    const res = await client.get(url);

    return { status: res.status, html: typeof res.data === 'string' ? res.data : String(res.data || '') };
}

async function fetchHomeCurrencies(client: ReturnType<typeof makeClients>['client']) {
    const url = `${BASE_URL}/${LOCALE}/currency-converter/`;
    const res = await client.get(url);
    const data = pickNextData(typeof res.data === 'string' ? res.data : String(res.data || ''));
    const model = data?.props?.pageProps?.model || {};

    return { status: res.status, currencies: Array.isArray(model.currencies) ? model.currencies : [] };
}

async function fetchHistory(api: ReturnType<typeof makeClients>['api'], from: string, to: string, days: number) {
    const source = normalizeCode(from);
    const target = normalizeCode(to);

    const endpoints = [
        `${BASE_URL}/rates/history+live?source=${source}&target=${target}&length=${days}&resolution=daily&unit=day`,
        `${BASE_URL}/rates/history?source=${source}&target=${target}&length=${days}&resolution=daily&unit=day`,
        `${BASE_URL}/gateway/v1/rates/history+live?source=${source}&target=${target}&length=${days}&resolution=daily&unit=day`,
        `${BASE_URL}/gateway/v1/rates/history?source=${source}&target=${target}&length=${days}&resolution=daily&unit=day`
    ];

    for (const url of endpoints) {
        try {
            const res = await api.get(url);
            const contentType = String(res.headers['content-type'] || '');
            const isJson = contentType.includes('application/json') || typeof res.data === 'object';
            const points = isJson ? normalizeHistory(res.data) : [];

            if (res.status >= 200 && res.status < 300 && points.length) {
                return points;
            }
        } catch {
            // coba endpoint berikutnya
        }
    }

    return [];
}

async function renderChartBase64(opts: {
    from: string; to: string; amount: number; converted: number; rate: number;
    points: { Date: string; Rate: number }[];
}): Promise<string | null> {
    const chart = {
        type: 'line',
        data: {
            labels: opts.points.map((p) => p.Date),
            datasets: [{
                label: `${opts.from}/${opts.to}`,
                data: opts.points.map((p) => p.Rate),
                fill: false,
                borderWidth: 3,
                pointRadius: 2,
                tension: 0.25
            }]
        },
        options: {
            plugins: {
                title: { display: true, text: `${opts.amount} ${opts.from} = ${opts.converted} ${opts.to}` },
                subtitle: { display: true, text: `Live rate: 1 ${opts.from} = ${opts.rate} ${opts.to}` },
                legend: { display: true }
            },
            scales: {
                x: { ticks: { maxRotation: 45, minRotation: 45 } },
                y: { beginAtZero: false }
            }
        }
    };

    try {
        const res = await axios.get('https://quickchart.io/chart', {
            timeout: 20000,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            params: { width: 1000, height: 520, format: 'png', backgroundColor: 'white', c: JSON.stringify(chart) }
        });

        if (res.status < 200 || res.status >= 300) return null;

        return `data:image/png;base64,${Buffer.from(res.data).toString('base64')}`;
    } catch {
        return null;
    }
}

export default async function currencyHandler(req: Request, res: Response) {
    const mode = String(req.query.mode || 'convert');
    const { client, api } = makeClients();

    try {
        if (mode === 'currencies') {
            const home = await fetchHomeCurrencies(client);

            return res.json({
                status: true,
                result: home.currencies.map((item: any) => ({ code: item.code, slug: item.slug, symbol: item.symbol }))
            });
        }

        const from = normalizeCode(String(req.query.from || 'USD'));
        const to = normalizeCode(String(req.query.to || 'IDR'));
        const amount = numberValue(req.query.amount) ?? 1;
        const days = Math.min(Math.max(Number(req.query.days) || 30, 2), 90);
        const withChart = String(req.query.chart || 'true') !== 'false';

        if (!from || !to) {
            return res.status(400).json({ status: false, message: "Parameter 'from' dan 'to' harus kode mata uang, contoh: USD, IDR." });
        }

        const page = await fetchPage(client, from, to, amount);

        if (page.status < 200 || page.status >= 300) {
            return res.status(502).json({ status: false, message: `Gagal membuka halaman Wise (HTTP ${page.status}).` });
        }

        const data = pickNextData(page.html);

        if (!data) {
            return res.status(502).json({
                status: false,
                message: 'Data kurs tidak ditemukan di halaman. Kemungkinan Wise mengubah struktur halaman, atau kode mata uang tidak valid.'
            });
        }

        const model = data?.props?.pageProps?.model || {};
        const rate = numberValue(model.rate?.value);

        if (rate == null) {
            return res.status(502).json({ status: false, message: 'Rate tidak ditemukan di response Wise.' });
        }

        const converted = amount * rate;
        const points = await fetchHistory(api, from, to, days);

        let chartBase64: string | null = null;
        if (withChart && points.length >= 2) {
            chartBase64 = await renderChartBase64({ from, to, amount, converted, rate, points });
        }

        return res.json({
            status: true,
            input: { from, to, amount },
            result: {
                rate,
                converted,
                history: points,
                chart: chartBase64
            }
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: error.message || 'Gagal mengambil data kurs mata uang.'
        });
    }
}
