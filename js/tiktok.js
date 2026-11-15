// TikTok: Login Kit + Display API (profile, videos, stats) + Content Posting API.
// All calls go through your helper because TikTok doesn't allow browser apps to call it directly.
import { store } from './util.js';
import { helper, helperConfig, relayFetch, redirectUri, startOAuth, uploadDirectOrRelay } from './helper.js';
import { snapshots } from './snapshots.js';

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = 'user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload';
const MB = 1024 * 1024;

const sess = () => store.get('tt-session'); // { access, exp, refresh, refreshExp, openId }

async function token() {
  const s = sess();
  if (!s) throw new Error('TikTok is not connected.');
  if (s.exp > Date.now() + 60000) return s.access;
  if (!s.refresh || s.refreshExp < Date.now()) { store.del('tt-session'); throw new Error('TikTok sign-in expired. Tap Connect again.'); }
  saveToken(await helper('/tiktok/token', { refresh_token: s.refresh }));
  return sess().access;
}
function saveToken(t) {
  if (!t.access_token) throw new Error(t.error_description || t.message || 'TikTok sign-in failed');
  store.set('tt-session', {
    access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000,
    refresh: t.refresh_token, refreshExp: Date.now() + (t.refresh_expires_in || 0) * 1000, openId: t.open_id, scope: t.scope,
  });
}

async function call(path, { method = 'GET', body, params } = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const res = await relayFetch(u.toString(), {
    method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (j.error && j.error.code && j.error.code !== 'ok') {
    if (j.error.code === 'access_token_invalid') store.del('tt-session');
    const friendly = {
      scope_not_authorized: 'TikTok permission missing. Reconnect TikTok and allow everything it asks for.',
      spam_risk_too_many_posts: 'TikTok says you have posted too many times today. Try again tomorrow.',
      unaudited_client_can_only_post_to_private_accounts: 'Your TikTok app is not approved yet, so it can only post as "Only me". Use "Send to TikTok drafts" instead, or set privacy to Only me.',
      url_ownership_unverified: 'TikTok needs the domain verified for this upload type.',
      privacy_level_option_mismatch: 'That privacy choice is not available on your account.',
    }[j.error.code];
    throw new Error(friendly || j.error.message || j.error.code);
  }
  if (!res.ok) throw new Error(`TikTok error ${res.status}`);
  return j.data;
}

export const tiktok = {
  id: 'tiktok',
  isConnected: () => { const s = sess(); return !!s && (s.exp > Date.now() || s.refreshExp > Date.now()); },
  wasConnected: () => !!sess(),

  async connect() {
    const { tiktokClientKey } = await helperConfig();
    if (!tiktokClientKey) throw new Error('Your helper has no TIKTOK_CLIENT_KEY yet. Add it in Cloudflare (see Accounts, step 4).');
    startOAuth('tt', state => {
      const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
      u.search = new URLSearchParams({ client_key: tiktokClientKey, scope: SCOPES, response_type: 'code', redirect_uri: redirectUri(), state }).toString();
      return u.toString();
    });
    return new Promise(() => {}); // page navigates away
  },
  async finishConnect(code) {
    saveToken(await helper('/tiktok/token', { code, redirect_uri: redirectUri() }));
  },
  disconnect() { store.del('tt-session'); store.del('tt-creator'); },

  async load() {
    const u = (await call('/user/info/', { params: { fields: 'open_id,avatar_url,display_name,username,follower_count,following_count,likes_count,video_count,profile_deep_link' } })).user;
    const vids = [];
    let cursor;
    for (let i = 0; i < 3; i++) {
      const d = await call('/video/list/', {
        method: 'POST',
        params: { fields: 'id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count' },
        body: { max_count: 20, ...(cursor ? { cursor } : {}) },
      });
      vids.push(...(d.videos || []));
      if (!d.has_more) break;
      cursor = d.cursor;
    }
    const posts = vids.map(v => ({
      platform: 'tiktok', id: v.id, title: (v.title || v.video_description || 'TikTok').split('\n')[0].slice(0, 120),
      thumb: v.cover_image_url, url: v.share_url, publishedAt: new Date(v.create_time * 1000).toISOString(), isVideo: true,
      durationSec: v.duration, views: v.view_count ?? null, likes: v.like_count || 0, comments: v.comment_count || 0, shares: v.share_count || 0,
    }));
    // TikTok gives totals only, so the app keeps a daily snapshot to draw follower and view lines over time
    const totalViews = posts.reduce((a, p) => a + (p.views || 0), 0);
    snapshots.record('tiktok', { followers: u.follower_count, views: totalViews });
    return {
      account: {
        platform: 'tiktok', id: u.open_id, name: u.display_name, handle: u.username ? '@' + u.username : '', avatar: u.avatar_url,
        followers: u.follower_count ?? null, followerHistory: snapshots.series('tiktok', 'followers'), url: u.profile_deep_link,
        likes: u.likes_count,
      },
      posts, daily: snapshots.dailyDiff('tiktok', 'views'), dailyLabel: 'views', comments: [], commentsUnsupported: true,
    };
  },

  /** Who is posting + what TikTok allows for them (must be shown before posting, per TikTok's rules). */
  async creatorInfo() {
    const d = await call('/post/publish/creator_info/query/', { method: 'POST', body: {} });
    store.set('tt-creator', d);
    return d;
  },

  /**
   * job.tiktok: { mode: 'draft'|'direct', privacy, allowComments, allowDuet, allowStitch, coverMs }
   */
  async publish(job, onProgress) {
    if (!job.file?.type.startsWith('video/')) throw new Error('TikTok needs a video file.');
    const t = job.tiktok || {};
    const size = job.file.size;
    const chunk = size <= 64 * MB ? size : 32 * MB;
    const count = size <= 64 * MB ? 1 : Math.floor(size / chunk);
    const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count };
    const direct = t.mode === 'direct';
    const init = direct
      ? await call('/post/publish/video/init/', {
        method: 'POST',
        body: {
          post_info: {
            title: (job.description || '').slice(0, 2200), privacy_level: t.privacy || 'SELF_ONLY',
            disable_comment: !t.allowComments, disable_duet: !t.allowDuet, disable_stitch: !t.allowStitch,
            video_cover_timestamp_ms: t.coverMs || 0,
          },
          source_info,
        },
      })
      : await call('/post/publish/inbox/video/init/', { method: 'POST', body: { source_info } });

    for (let i = 0; i < count; i++) {
      const start = i * chunk, end = i === count - 1 ? size : start + chunk;
      await uploadDirectOrRelay({
        method: 'PUT', url: init.upload_url, body: job.file.slice(start, end),
        headers: { 'Content-Type': job.file.type || 'video/mp4', 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        onProgress: f => onProgress?.(((start + f * (end - start)) / size) * 0.9), responseType: 'text',
      });
    }
    // Wait for TikTok to take it
    for (let i = 0; i < 40; i++) {
      const s = await call('/post/publish/status/fetch/', { method: 'POST', body: { publish_id: init.publish_id } });
      if (s.status === 'FAILED') throw new Error(`TikTok rejected the video: ${s.fail_reason || 'unknown reason'}`);
      if (s.status === 'PUBLISH_COMPLETE' || s.status === 'SEND_TO_USER_INBOX') {
        onProgress?.(1);
        return { id: init.publish_id, url: 'https://www.tiktok.com/', note: s.status === 'SEND_TO_USER_INBOX' ? 'In your TikTok inbox: open TikTok to add sounds and post' : 'Posted' };
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    onProgress?.(1);
    return { id: init.publish_id, url: 'https://www.tiktok.com/', note: 'Uploaded. TikTok is still processing it' };
  },
};

