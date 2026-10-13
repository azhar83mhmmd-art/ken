import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Mobile Legends Nickname Stalker
 * Provider: api.isan.eu.org
 */

const REGION_MAP: Record<string, string> = {
    '1': 'Indonesia', '2': 'Indonesia', '3': 'Indonesia', '4': 'Indonesia',
    '5': 'Indonesia', '6': 'Indonesia', '7': 'Indonesia', '8': 'Indonesia', '9': 'Indonesia',
    '10': 'Malaysia / SG / BN', '11': 'Philippines', '12': 'Thailand',
    '13': 'Vietnam', '14': 'Cambodia', '15': 'Myanmar', '16': 'Laos',
    '17': 'Timor-Leste', '19': 'Middle East', '20': 'North America',
    '21': 'Europe', '22': 'South America'
};

function getRegion(sid: string): string {
    const s = String(sid);
    return REGION_MAP[s.slice(0, 2)] ?? REGION_MAP[s.slice(0, 1)] ?? 'Unknown';
}

export default async function stalkmlHandler(req: Request, res: Response) {
    const userId = String(req.query.id || '').trim();
    const serverId = String(req.query.server || req.query.zone || '').trim();

    if (!userId || !serverId) {
        return res.status(400).json({ status: false, message: "Parameter 'id' dan 'server' diperlukan." });
    }

    const { data: json } = await axios.get('https://api.isan.eu.org/nickname/ml', {
        params: { id: userId, server: serverId },
        timeout: 15000,
        headers: { 'user-agent': 'StalkML/1.0', accept: 'application/json' }
    });

    if (!json?.success) {
        return res.status(404).json({
            status: false,
            message: 'Nickname tidak ditemukan.',
            result: {
                id: userId,
                server: serverId,
                username: 'Not Found',
                region: getRegion(serverId)
            }
        });
    }

    return res.json({
        status: true,
        result: {
            id: userId,
            server: serverId,
            username: json.name,
            region: getRegion(serverId)
        }
    });
}
