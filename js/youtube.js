// YouTube: sign in with Google in the browser, read channel + analytics, reply to comments,
// upload videos, and scan other creators' recent uploads for the "When to post" model.
import { loadScript, store, xhrSend, isoDay } from './util.js';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.force-ssl',     // read channel, comments, reply
  'https://www.googleapis.com/auth/youtube.upload',        // post videos
  'https://www.googleapis.com/auth/yt-analytics.readonly', // views, watch time, retention
].join(' ');
const API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
const DAY = 86400000;

let tokenClient = null;
let pending = null;

function token() {
  const t = store.get('yt-token');
  return t && t.exp > Date.now() + 60000 ? t.value : null;
}

export const youtube = {
  id: 'youtube',
  isConnected: () => !!token(),
  wasConnected: () => !!store.get('yt-token'),

  async connect({ silent = false } = {}) {
    const clientId = store.get('settings', {}).googleClientId?.trim();
    if (!clientId) throw new Error('Add your Google Client ID first (Accounts tab, step 1).');
    await loadScript('https://accounts.google.com/gsi/client');
    if (!tokenClient || tokenClient._cid !== clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: SCOPES,
        callback: r => {
          if (r.error) return pending?.reject(new Error(r.error_description || r.error));
          if (!google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES.split(' ')))
            store.set('yt-partial', true);
          store.set('yt-token', { value: r.access_token, exp: Date.now() + (r.expires_in - 30) * 1000 });
          pending?.resolve();
        },
        error_callback: e => pending?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : e.message || 'Google sign-in failed.')),
      });
      tokenClient._cid = clientId;
    }
    await new Promise((resolve, reject) => {
      pending = { resolve, reject };
      tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
    });
  },

  disconnect() {
    const t = store.get('yt-token');
    if (t && window.google?.accounts) google.accounts.oauth2.revoke(t.value, () => {});
    store.del('yt-token'); store.del('yt-channel');
  },

  async load(days) {
    const ch = (await get(`${API}/channels`, { part: 'snippet,statistics,contentDetails', mine: true })).items?.[0];
    if (!ch) throw new Error('This Google account has no YouTube channel.');
    store.set('yt-channel', ch.id);
    const uploads = ch.contentDetails.relatedPlaylists.uploads;

    // Last ~100 uploads
    let ids = [], pageToken;
    for (let i = 0; i < 2; i++) {
      const pl = await get(`${API}/playlistItems`, { part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken });
      ids.push(...pl.items.map(x => x.contentDetails.videoId));
      pageToken = pl.nextPageToken; if (!pageToken) break;
    }
    const vids = [];
    for (let i = 0; i < ids.length; i += 50) {
      const r = await get(`${API}/videos`, { part: 'snippet,statistics,contentDetails', id: ids.slice(i, i + 50).join(',') });
      vids.push(...r.items);
    }

    // Per-video analytics (lifetime) — watch %, minutes, subs gained
    const end = isoDay(Date.now());
    const perVideo = {};
    try {
      const rep = await analytics({
        startDate: '2006-01-01', endDate: end, dimensions: 'video',
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares',
        sort: '-views', maxResults: 200,
      });
      for (const row of rep.rows || []) perVideo[row[0]] = row;
    } catch (e) { console.warn('per-video analytics', e); }

    const posts = vids.map(v => {
      const a = perVideo[v.id];
      return {
        platform: 'youtube', id: v.id, title: v.snippet.title,
        thumb: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url,
        url: `https://youtu.be/${v.id}`, publishedAt: v.snippet.publishedAt, isVideo: true,
        durationSec: isoDuration(v.contentDetails.duration),
        views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0,
        shares: a ? a[6] : null, watchMinutes: a ? a[2] : null, avgViewPct: a ? a[4] / 100 : null, subsGained: a ? a[5] : null,
        isShort: isoDuration(v.contentDetails.duration) <= 180,
      };
    });

    // Daily views + subscriber changes for the range
    let daily = [], followerHistory = [];
    const followers = ch.statistics.hiddenSubscriberCount ? null : +ch.statistics.subscriberCount;
    try {
      const rep = await analytics({
        startDate: isoDay(Date.now() - days * DAY), endDate: end, dimensions: 'day',
        metrics: 'views,subscribersGained,subscribersLost', sort: 'day',
      });
      const rows = rep.rows || [];
      daily = rows.map(r => ({ x: new Date(r[0] + 'T00:00:00'), y: r[1] }));
      // walk backwards from today's count to rebuild the subscriber line
      let v = followers ?? 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        followerHistory.unshift({ x: new Date(rows[i][0] + 'T00:00:00'), y: v });
        v -= rows[i][2] - rows[i][3];
      }
    } catch (e) { console.warn('daily analytics', e); }

    // Latest comments across the channel
    let comments = [];
    try {
      const ct = await get(`${API}/commentThreads`, { part: 'snippet,replies', allThreadsRelatedToChannelId: ch.id, maxResults: 50, order: 'time' });
      const titles = Object.fromEntries(posts.map(p => [p.id, p.title]));
      comments = ct.items.map(th => {
        const top = th.snippet.topLevelComment.snippet;
        return {
          platform: 'youtube', id: th.snippet.topLevelComment.id, postId: th.snippet.videoId, postTitle: titles[th.snippet.videoId] || 'Video',
          postUrl: `https://youtu.be/${th.snippet.videoId}`,
          author: top.authorDisplayName, avatar: top.authorProfileImageUrl, text: top.textOriginal,
          publishedAt: top.publishedAt, likes: top.likeCount,
          replied: (th.replies?.comments || []).some(c => c.snippet.authorChannelId?.value === ch.id),
          canReply: th.snippet.canReply !== false,
        };
      });
    } catch (e) { console.warn('comments', e); }

    return {
      account: {
        platform: 'youtube', id: ch.id, name: ch.snippet.title, handle: ch.snippet.customUrl || '',
        avatar: ch.snippet.thumbnails?.default?.url, followers, followerHistory,
        url: `https://youtube.com/channel/${ch.id}`, totalViews: +ch.statistics.viewCount,
      },
      posts, daily, dailyLabel: 'views', comments,
    };
  },

  async retention(post) {
    const rep = await analytics({
      startDate: '2006-01-01', endDate: isoDay(Date.now()),
      dimensions: 'elapsedVideoTimeRatio', metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      filters: `video==${post.id}`,
    });
    const rows = rep.rows || [];
    if (!rows.length) return null;
    return rows.map(r => ({ t: r[0], y: r[1], rel: r[2] }));
  },

  async reply(comment, text) {
    await send('POST', `${API}/comments?part=snippet`, { snippet: { parentId: comment.id, textOriginal: text } });
  },

  /** job: { file, title, description, tags[], privacy, madeForKids, publishAt(Date|null) } */
  async publish(job, onProgress) {
    if (!job.file || !job.file.type.startsWith('video/')) throw new Error('YouTube needs a video file.');
    const status = { privacyStatus: job.publishAt ? 'private' : job.privacy, selfDeclaredMadeForKids: !!job.madeForKids };
    if (job.publishAt) status.publishAt = job.publishAt.toISOString();
    const meta = {
      snippet: { title: job.title.slice(0, 100) || 'Untitled', description: job.description || '', tags: job.tags || [], categoryId: '22' },
      status,
    };
    const start = await authed(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': job.file.size, 'X-Upload-Content-Type': job.file.type },
      body: JSON.stringify(meta),
    });
    const uploadUrl = start.headers.get('Location');
    if (!uploadUrl) throw new Error('YouTube did not return an upload address.');
    const res = await xhrSend({ method: 'PUT', url: uploadUrl, headers: { 'Content-Type': job.file.type }, body: job.file, onProgress: f => onProgress?.(f * (job.thumbnail ? 0.95 : 1)) });
    let note = '';
    if (job.thumbnail) {
      try { await youtube.setThumbnail(res.id, job.thumbnail); note = 'with your thumbnail'; }
      catch (e) { note = `but the thumbnail didn't go up: ${e.message}`; }
    }
    onProgress?.(1);
    return { url: `https://youtu.be/${res.id}`, id: res.id, note };
  },

  /** Custom thumbnail: JPG/PNG up to 2 MB. The channel must be phone-verified on YouTube. */
  async setThumbnail(videoId, image) {
    if (image.size > 2 * 1024 * 1024) throw new Error('Thumbnail must be under 2 MB.');
    try {
      const r = await authed(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`, {
        method: 'POST', headers: { 'Content-Type': image.type || 'image/jpeg' }, body: image,
      });
      const j = await r.json();
      return j.items?.[0]?.maxres?.url || j.items?.[0]?.high?.url || j.items?.[0]?.medium?.url || null;
    } catch (e) {
      if (/permission|forbidden|not.*allowed|verify/i.test(e.message))
        throw new Error('YouTube only allows custom thumbnails on verified channels. Verify yours at youtube.com/verify (takes a minute with your phone number), then try again.');
      throw e;
    }
  },

  /**
   * Recent uploads by others in your niche: search your keywords and any channels you follow,
   * keep 2–30 day old videos, attach each channel's subscriber count.
   */
  async niche({ keywords = [], competitors = [] }) {
    const after = new Date(Date.now() - 30 * DAY).toISOString(), before = new Date(Date.now() - 2 * DAY).toISOString();
    const ids = new Set();
    const mine = store.get('yt-channel');
    for (const q of keywords.slice(0, 3)) {
      const r = await get(`${API}/search`, { part: 'snippet', q, type: 'video', maxResults: 50, publishedAfter: after, publishedBefore: before, order: 'relevance', relevanceLanguage: (navigator.language || 'en').slice(0, 2) });
      for (const it of r.items) if (it.snippet.channelId !== mine) ids.add(it.id.videoId);
    }
    for (const raw of competitors.slice(0, 15)) {
      try {
        const handle = raw.trim().replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/^@?/, '@');
        const ch = (await get(`${API}/channels`, { part: 'contentDetails', forHandle: handle })).items?.[0];
        if (!ch) continue;
        const pl = await get(`${API}/playlistItems`, { part: 'contentDetails', playlistId: ch.contentDetails.relatedPlaylists.uploads, maxResults: 25 });
        for (const it of pl.items) {
          const t = new Date(it.contentDetails.videoPublishedAt);
          if (t > new Date(after) && t < new Date(before)) ids.add(it.contentDetails.videoId);
        }
      } catch (e) { console.warn('competitor', raw, e); }
    }
    const list = [...ids];
    const vids = [];
    for (let i = 0; i < list.length; i += 50) {
      const r = await get(`${API}/videos`, { part: 'snippet,statistics', id: list.slice(i, i + 50).join(',') });
      vids.push(...r.items);
    }
    const chIds = [...new Set(vids.map(v => v.snippet.channelId))];
    const subs = {};
    for (let i = 0; i < chIds.length; i += 50) {
      const r = await get(`${API}/channels`, { part: 'statistics', id: chIds.slice(i, i + 50).join(',') });
      for (const c of r.items) subs[c.id] = +c.statistics.subscriberCount || 0;
    }
    return vids.map(v => ({
      publishedAt: v.snippet.publishedAt, views: +v.statistics.viewCount || 0, subs: subs[v.snippet.channelId] || 0,
      title: v.snippet.title, channel: v.snippet.channelTitle,
    }));
  },
};

// ---- HTTP ----
async function authed(url, init = {}) {
  let t = token();
  if (!t) { await youtube.connect({ silent: true }); t = token(); }
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  if (res.status === 401) { store.del('yt-token'); throw new Error('YouTube sign-in expired. Tap Connect again.'); }
  if (!res.ok) {
    let msg = `YouTube error ${res.status}`;
    try { const j = await res.json(); msg = j.error?.message || msg; if (j.error?.errors?.[0]?.reason === 'quotaExceeded') msg = 'YouTube daily quota used up. It resets at midnight Pacific time.'; } catch { /* keep default */ }
    throw new Error(msg.replace(/<[^>]+>/g, ''));
  }
  return res;
}
async function get(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  return (await authed(u)).json();
}
async function send(method, url, body) {
  return (await authed(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
}
function analytics(params) { return get(ANALYTICS, { ids: 'channel==MINE', ...params }); }

function isoDuration(s) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

