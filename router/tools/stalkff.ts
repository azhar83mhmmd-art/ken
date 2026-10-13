import { Request, Response } from 'express';
import axios from 'axios';

/*
 * Free Fire Account Stalker
 * Provider: 00cc.eu.cc
 */

export default async function stalkffHandler(req: Request, res: Response) {
    const uid = String(req.query.uid || '').trim();

    if (!uid) {
        return res.status(400).json({ status: false, message: "Parameter 'uid' diperlukan." });
    }

    if (!/^\d+$/.test(uid)) {
        return res.status(400).json({ status: false, message: "Parameter 'uid' harus berupa angka." });
    }

    let raw: any;

    try {
        const response = await axios.get('https://www.00cc.eu.cc/freefire-stalk', {
            params: { uid },
            timeout: 15000,
            headers: {
                'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
                accept: 'application/json'
            }
        });
        raw = response.data;
    } catch (error: any) {
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ status: false, message: 'Provider tidak merespons (timeout).' });
        }

        /*
         * Provider ini membalas HTTP non-2xx (400/404/500) untuk kasus
         * seperti UID tidak ditemukan / UID tidak valid / provider
         * sedang bermasalah, bukan cuma untuk error jaringan. Axios
         * default melempar exception untuk status non-2xx, jadi harus
         * ditangkap di sini (sebelumnya TIDAK ditangkap sama sekali,
         * membuat handler ini crash ke error handler generik dan
         * membalas 500 mentah berisi stack trace axios).
         */
        const upstreamData = error.response?.data;
        const upstreamStatus = error.response?.status;

        if (upstreamStatus === 400 || upstreamStatus === 404) {
            return res.status(404).json({
                status: false,
                message: 'UID tidak ditemukan atau tidak valid.'
            });
        }

        return res.status(502).json({
            status: false,
            message:
                upstreamData?.details ||
                upstreamData?.message ||
                error.message ||
                'Gagal mengambil data dari provider Free Fire stalk.'
        });
    }

    if (!raw?.success) {
        return res.status(404).json({ status: false, message: 'UID tidak ditemukan.' });
    }

    const r = raw.result;

    if (!r || !r.account_basic_info) {
        return res.status(502).json({
            status: false,
            message: 'Data dari provider tidak lengkap/berubah format.'
        });
    }

    try {
        return res.json({
            status: true,
            result: buildStalkffResult(r)
        });
    } catch (error: any) {
        return res.status(502).json({
            status: false,
            message: 'Gagal memproses data dari provider (format berubah).'
        });
    }
}

function buildStalkffResult(r: any) {
    return {
            basic: {
                uid: r.account_basic_info.uid,
                name: r.account_basic_info.name,
                level: r.account_basic_info.level,
                exp: r.account_basic_info.exp,
                region: r.account_basic_info.region,
                likes: r.account_basic_info.likes,
                honor_score: r.account_basic_info.honor_score,
                title: r.account_basic_info.title_name,
                bio: r.account_basic_info.bio,
                has_elite_pass: r.account_basic_info.has_elite_pass
            },
            activity: {
                created_at: r.account_activity.created_at,
                last_login: r.account_activity.last_login,
                latest_ob: r.account_activity.most_recent_ob,
                season_id: r.account_activity.season_id,
                bp_badges: r.account_activity.current_bp_badges,
                br_rank: r.account_activity.br_rank,
                br_rank_id: r.account_activity.br_rank_id,
                br_max_rank: r.account_activity.br_max_rank,
                cs_rank: r.account_activity.cs_rank,
                cs_rank_id: r.account_activity.cs_rank_id,
                cs_max_rank: r.account_activity.cs_max_rank
            },
            social: {
                gender: String(r.social_info.gender || '').replace('Gender_', ''),
                language: String(r.social_info.language || '').replace('Language_', ''),
                rank_show: String(r.social_info.rank_show || '').replace('RankShow_', ''),
                mode_prefer: r.social_info.mode_prefer,
                signature: r.social_info.signature
            },
            overview: {
                avatar: r.account_overview.avatar_name,
                banner: r.account_overview.banner_name,
                head_pic: r.account_overview.head_pic_name,
                title: r.account_overview.title_name,
                weapon_skin_shows: (r.account_overview.weapon_skin_shows || []).map((w: any) => w.name),
                equipped_skills: (r.account_overview.equipped_skills || []).map((s: any) => s.name)
            },
            equip: {
                profile: (r.equip_items.profile || []).map((i: any) => ({ name: i.name, type: i.type, rare: i.rare })),
                character: (r.equip_items.character || []).map((i: any) => ({ name: i.name, type: i.type, rare: i.rare })),
                outfit: (r.equip_items.outfit || []).map((i: any) => ({ name: i.name, type: i.type, rare: i.rare })),
                weapon: (r.equip_items.weapon || []).map((i: any) => ({ name: i.name, type: i.type, rare: i.rare })),
                pet: (r.equip_items.pet || []).map((i: any) => ({ name: i.name, type: i.type, rare: i.rare }))
            },
            pet: {
                name: r.pet_details?.pet_name,
                item_name: r.pet_details?.pet_item_name,
                level: r.pet_details?.pet_level,
                exp: r.pet_details?.pet_exp,
                skin: r.pet_details?.skin_name,
                skill: r.pet_details?.selected_skill_name,
                equipped: r.pet_details?.equipped
            },
            guild: r.guild_info ? {
                name: r.guild_info.guild_name,
                id: r.guild_info.guild_id,
                level: r.guild_info.guild_level,
                members: r.guild_info.live_members,
                capacity: r.guild_info.capacity,
                leader: {
                    name: r.guild_info.leader?.leader_name,
                    uid: r.guild_info.leader?.leader_uid,
                    level: r.guild_info.leader?.leader_level,
                    br_rank_id: r.guild_info.leader?.leader_br_rank_id,
                    cs_rank_id: r.guild_info.leader?.leader_cs_rank_id,
                    last_login: r.guild_info.leader?.leader_last_login
                }
            } : null,
            misc: {
                diamond_cost: r.diamond_cost?.diamond_cost,
                profile_image: r.profile_image
            }
    };
}
