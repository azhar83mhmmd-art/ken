import { Request, Response } from 'express';
import axios from 'axios';
import { wrapper } from 'axios-cookiejar-support';
import { CookieJar } from 'tough-cookie';

/*
 * Instagram Story Stalker
 * Provider: insta-stories-viewer.com
 */

const baseHeaders = {
    host: 'insta-stories-viewer.com',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br, zstd',
    origin: 'https://insta-stories-viewer.com',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    te: 'trailers'
};

const t = () => `O${Date.now()}${Math.random().toString(36).substring(2, 7)}`;

async function stalkIg(username: string) {
    const jar = new CookieJar();
    const client = wrapper(axios.create({ jar, withCredentials: true, timeout: 20000 }));

    const referer = `https://insta-stories-viewer.com/${username}/`;
    const headers = { ...baseHeaders, referer };

    const resHtml = await client.get(`https://insta-stories-viewer.com/${username}/`, {
        headers: {
            ...baseHeaders,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'sec-fetch-dest': 'document',
            'sec-fetch-mode': 'navigate',
            'upgrade-insecure-requests': '1'
        }
    });
    const html = resHtml.data;

    const getMeta = (regexStr: string) => {
        const match = html.match(new RegExp(regexStr));
        return match ? match[1].trim() : null;
    };

    const metadata = {
        posts: getMeta('profile__stats-posts">([^<]+)<'),
        followers: getMeta('profile__stats-followers">([^<]+)<'),
        following: getMeta('profile__stats-follows">([^<]+)<'),
        avatar: getMeta('<img class="profile__avatar-pic" src="([^"]+)"')
    };

    const resConnect = await client.get('https://insta-stories-viewer.com/connect/', { headers });
    const token = resConnect.data.token;

    const resPoll1 = await client.get(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}`, { headers });
    const sidMatch = String(resPoll1.data).match(/"sid":"([^"]+)"/);
    if (!sidMatch) throw new Error('Gagal memulai sesi socket.');
    const sid = sidMatch[1];

    await client.post(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}&sid=${sid}`, '40', {
        headers: { ...headers, 'content-type': 'text/plain;charset=UTF-8' }
    });

    await client.get(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}&sid=${sid}`, { headers });
    await client.get(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}&sid=${sid}`, { headers });

    const date = Date.now();
    const payload = `42["search",{"username":"${username}","date":${date},"token":"${token}"}]`;
    await client.post(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}&sid=${sid}`, payload, {
        headers: { ...headers, 'content-type': 'text/plain;charset=UTF-8' }
    });

    const resPollFinal = await client.get(`https://insta-stories-viewer.com/socket.io/?EIO=4&transport=polling&t=${t()}&sid=${sid}`, { headers });
    const rawData = resPollFinal.data;

    let storiesData: unknown[] = [];
    if (typeof rawData === 'string' && rawData.startsWith('42')) {
        const parsed = JSON.parse(rawData.substring(2));
        if (Array.isArray(parsed) && parsed.length > 1) {
            storiesData = parsed[1];
        }
    }

    return { metadata, stories: storiesData };
}

export default async function stalkigHandler(req: Request, res: Response) {
    const username = String(req.query.username || req.query.user || '').trim();

    if (!username) {
        return res.status(400).json({ status: false, message: "Parameter 'username' diperlukan." });
    }

    try {
        const result = await stalkIg(username);
        return res.json({ status: true, username, result });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            username,
            message: error.message || 'Gagal mengambil data Instagram.'
        });
    }
}
