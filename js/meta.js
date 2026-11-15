// Facebook Page + Instagram (professional account linked to that Page), through one Facebook login.
import { loadScript, store, pool, xhrSend } from './util.js';
import { helper, helperConfig, redirectUri, startOAuth, directOrRelay, uploadDirectOrRelay } from './helper.js';

const V = 'v23.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const IGRAPH = `https://graph.instagram.com/${V}`;
const DAY = 86400000;
const SCOPES = [
  'pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_posts', 'pages_manage_engagement',
  'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights',
].join(',');

let sdkReady = null;
function sdk() {
  const appId = store.get('settings', {}).metaAppId?.trim();
  if (!appId) throw new Error('Add your Meta App ID first (Accounts tab, step 2).');
  if (!sdkReady) {
    sdkReady = (async () => {
      await loadScript('https://connect.facebook.net/en_US/sdk.js');
      FB.init({ appId, version: V, cookie: false, xfbml: false });
    })();
  }
  return sdkReady;
}

const session = () => store.get('meta-session'); // { userToken, exp, pages:[{id,name,token,ig}] }
function page() {
  const s = session(); if (!s?.pages?.length) return null;
  const chosen = store.get('settings', {}).metaPageId;
  return s.pages.find(p => p.id === chosen) || s.pages[0];
}
const live = () => { const s = session(); return !!(s && (!s.exp || s.exp > Date.now())); };

export const meta = {
  isConnected: () => live() && !!page(),
  pages: () => session()?.pages || [],

  async connect() {
    await sdk();
    const res = await new Promise(resolve => FB.login(resolve, { scope: SCOPES, return_scopes: true }));
    if (!res.authResponse) throw new Error('Facebook login was cancelled.');
    const userToken = res.authResponse.accessToken;
    const exp = res.authResponse.data_access_expiration_time ? res.authResponse.data_access_expiration_time * 1000 : Date.now() + 60 * DAY;
    const accounts = await graph('/me/accounts', {
      access_token: userToken,
      fields: 'id,name,access_token,picture{url},followers_count,fan_count,instagram_business_account{id,username,profile_picture_url,followers_count}',
      limit: 50,
    });
    const pages = (accounts.data || []).map(p => ({ id: p.id, name: p.name, token: p.access_token, picture: p.picture?.data?.url, ig: p.instagram_business_account || null }));
    if (!pages.length) throw new Error('No Facebook Pages found. Instagram posting needs a Facebook Page linked to an Instagram professional account.');
    store.set('meta-session', { userToken, exp, pages });
  },

  disconnect() {
    store.del('meta-session');
    if (window.FB) try { FB.logout(() => {}); } catch { /* not logged in */ }
  },
};

// ---------------- Facebook Page ----------------
export const facebook = {
  id: 'facebook',
  isConnected: () => meta.isConnected(),
  wasConnected: () => !!session(),
  connect: () => meta.connect(),
  disconnect: () => meta.disconnect(),

  async load(days) {
    const p = page(); const tk = p.token;
    const info = await graph(`/${p.id}`, { access_token: tk, fields: 'name,link,picture{url},followers_count,fan_count' });
    const postsRes = await graph(`/${p.id}/posts`, {
      access_token: tk, limit: 50,
      fields: 'id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),attachments{media_type,media{source}}',
    });
    const raw = postsRes.data || [];
    const posts = raw.map(x => ({
      platform: 'facebook', id: x.id, title: firstLine(x.message) || 'Post', thumb: x.full_picture, url: x.permalink_url,
      publishedAt: x.created_time, isVideo: /video/.test(x.attachments?.data?.[0]?.media_type || x.status_type || ''),
      views: null, likes: x.reactions?.summary?.total_count || 0, comments: x.comments?.summary?.total_count || 0, shares: x.shares?.count || 0,
    }));
    // Views per post where the Page has insights access (metric names change often; failures are skipped)
    await pool(posts.slice(0, 30), 5, async post => {
      const r = await graph(`/${post.id}/insights`, { access_token: tk, metric: 'post_media_view' });
      const v = r.data?.[0]?.values?.[0]?.value; if (typeof v === 'number') post.views = v;
    });

    let daily = [], followerHistory = [];
    const followers = info.followers_count ?? info.fan_count ?? null;
    try {
      const r = await graph(`/${p.id}/insights`, { access_token: tk, metric: 'page_media_view', period: 'day', since: unix(Date.now() - days * DAY), until: unix(Date.now()) });
      daily = (r.data?.[0]?.values || []).map(v => ({ x: new Date(v.end_time), y: typeof v.value === 'number' ? v.value : 0 }));
    } catch (e) { console.warn('fb daily', e); }
    try {
      const r = await graph(`/${p.id}/insights`, { access_token: tk, metric: 'page_daily_follows_unique,page_daily_unfollows_unique', period: 'day', since: unix(Date.now() - days * DAY), until: unix(Date.now()) });
      const f = r.data?.find(m => m.name === 'page_daily_follows_unique')?.values || [];
      const u = r.data?.find(m => m.name === 'page_daily_unfollows_unique')?.values || [];
      let v = followers ?? 0;
      for (let i = f.length - 1; i >= 0; i--) { followerHistory.unshift({ x: new Date(f[i].end_time), y: v }); v -= (f[i].value || 0) - (u[i]?.value || 0); }
    } catch (e) { console.warn('fb follows', e); }

    const comments = [];
    await pool(raw.slice(0, 12), 4, async x => {
      const r = await graph(`/${x.id}/comments`, { access_token: tk, fields: 'id,message,from{id,name,picture},created_time,like_count,comments.limit(5){from{id}}', order: 'reverse_chronological', limit: 15 });
      for (const c of r.data || []) comments.push({
        platform: 'facebook', id: c.id, postId: x.id, postTitle: firstLine(x.message) || 'Post', postUrl: x.permalink_url,
        author: c.from?.name || 'Facebook user', avatar: c.from?.picture?.data?.url, text: c.message,
        publishedAt: c.created_time, likes: c.like_count || 0, canReply: true,
        replied: (c.comments?.data || []).some(r2 => r2.from?.id === p.id),
      });
    });

    return {
      account: { platform: 'facebook', id: p.id, name: info.name, handle: info.name, avatar: info.picture?.data?.url, followers, followerHistory, url: info.link },
      posts, daily, dailyLabel: 'views', comments,
    };
  },

  async reply(comment, text) {
    await graphPost(`/${comment.id}/comments`, { message: text, access_token: page().token });
  },

  async publish(job, onProgress) {
    const p = page(); const tk = p.token;
    const sched = job.publishAt ? { published: 'false', scheduled_publish_time: String(unix(job.publishAt)) } : {};
    if (job.file?.type.startsWith('video/')) {
      const fd = form({ access_token: tk, description: job.description, title: job.title, ...sched });
      fd.append('source', job.file, job.file.name);
      const r = await xhrSend({ method: 'POST', url: `https://graph-video.facebook.com/${V}/${p.id}/videos`, body: fd, onProgress });
      return { id: r.id, url: `https://facebook.com/${r.id}` };
    }
    if (job.file?.type.startsWith('image/')) {
      const fd = form({ access_token: tk, caption: job.description, ...sched });
      fd.append('source', job.file, job.file.name);
      const r = await xhrSend({ method: 'POST', url: `${GRAPH}/${p.id}/photos`, body: fd, onProgress });
      return { id: r.post_id || r.id, url: `https://facebook.com/${r.post_id || r.id}` };
    }
    const r = await graphPost(`/${p.id}/feed`, { access_token: tk, message: job.description, ...sched });
    onProgress?.(1);
    return { id: r.id, url: `https://facebook.com/${r.id}` };
  },
};

// ---------------- Instagram ----------------
// Two ways in: (a) Instagram login (no Facebook Page needed; via your helper), or
// (b) through the Facebook Page the Instagram account is linked to.
const igSession = () => store.get('ig-session'); // { token, exp, userId, username }
const igLoginLive = () => { const s = igSession(); return !!s && s.exp > Date.now(); };

function igCtx() {
  if (igLoginLive()) {
    const s = igSession();
    return {
      tk: s.token, igId: s.userId, via: 'instagram',
      get: (path, params) => graph(path, params, IGRAPH, directOrRelay),
      post: (path, params) => graphPost(path, params, IGRAPH, directOrRelay),
    };
  }
  const p = page();
  if (!p?.ig?.id) throw new Error(p ? `The Page "${p.name}" has no linked Instagram professional account.` : 'Instagram is not connected.');
  return { tk: p.token, igId: p.ig.id, via: 'facebook', get: (a, b) => graph(a, b), post: (a, b) => graphPost(a, b) };
}

export const instagram = {
  id: 'instagram',
  isConnected: () => igLoginLive() || (meta.isConnected() && !!page()?.ig),
  wasConnected: () => !!igSession() || !!session(),
  via: () => (igLoginLive() ? 'instagram' : meta.isConnected() && page()?.ig ? 'facebook' : null),

  /** Direct Instagram login (Instagram API with Instagram Login). */
  async connect() {
    const { igAppId } = await helperConfig();
    if (!igAppId) throw new Error('Your helper has no IG_APP_ID yet. Add it in Cloudflare (see Accounts, step 4), or connect Instagram through Facebook.');
    startOAuth('ig', state => {
      const u = new URL('https://www.instagram.com/oauth/authorize');
      u.search = new URLSearchParams({
        client_id: igAppId, redirect_uri: redirectUri(), response_type: 'code', state,
        scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_insights',
      }).toString();
      return u.toString();
    });
    return new Promise(() => {});
  },
  async finishConnect(code) {
    const t = await helper('/instagram/token', { code, redirect_uri: redirectUri() });
    store.set('ig-session', { token: t.access_token, exp: Date.now() + (t.expires_in - 120) * 1000, userId: t.user_id, at: Date.now() });
  },
  /** Long-lived Instagram tokens last 60 days; refresh them when they're over a day old. */
  async keepFresh() {
    const s = igSession();
    if (!s || Date.now() - (s.at || 0) < 86400000 || s.exp < Date.now()) return;
    try {
      const r = await graph('/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: s.token }, 'https://graph.instagram.com', directOrRelay);
      store.set('ig-session', { ...s, token: r.access_token, exp: Date.now() + (r.expires_in - 120) * 1000, at: Date.now() });
    } catch (e) { console.warn('ig refresh', e); }
  },
  disconnect() {
    if (igSession()) store.del('ig-session');
    else meta.disconnect();
  },
  async load(days) {
    await instagram.keepFresh();
    const c = igCtx(); const { tk, igId } = c;
    const info = await c.get(`/${igId}`, { access_token: tk, fields: 'username,name,profile_picture_url,followers_count,media_count' });
    const media = await c.get(`/${igId}/media`, { access_token: tk, limit: 50, fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,like_count,comments_count' });
    const raw = media.data || [];
    const posts = raw.map(m => ({
      platform: 'instagram', id: m.id, title: firstLine(m.caption) || (m.media_product_type === 'REELS' ? 'Reel' : 'Post'),
      thumb: m.thumbnail_url || (m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM' ? m.media_url : null),
      url: m.permalink, publishedAt: m.timestamp, isVideo: m.media_type === 'VIDEO',
      views: null, likes: m.like_count || 0, comments: m.comments_count || 0, shares: 0,
    }));
    await pool(posts.slice(0, 30), 5, async post => {
      const isReel = raw.find(m => m.id === post.id)?.media_product_type === 'REELS';
      const metric = isReel ? 'views,reach,saved,shares,ig_reels_avg_watch_time' : 'views,reach,saved,shares';
      const r = await c.get(`/${post.id}/insights`, { access_token: tk, metric });
      const val = n => r.data?.find(d => d.name === n)?.values?.[0]?.value;
      post.views = val('views') ?? null; post.shares = val('shares') ?? 0; post.saves = val('saved') ?? 0; post.reach = val('reach') ?? null;
      const avgMs = val('ig_reels_avg_watch_time'); if (avgMs) post.avgWatchSec = avgMs / 1000;
    });

    let daily = [], followerHistory = [], audienceHours = null;
    const since = unix(Date.now() - Math.min(days, 30) * DAY), until = unix(Date.now());
    try {
      const r = await c.get(`/${igId}/insights`, { access_token: tk, metric: 'reach', period: 'day', since, until });
      daily = (r.data?.[0]?.values || []).map(v => ({ x: new Date(v.end_time), y: v.value || 0 }));
    } catch (e) { console.warn('ig reach', e); }
    try {
      const r = await c.get(`/${igId}/insights`, { access_token: tk, metric: 'follower_count', period: 'day', since, until });
      const vals = r.data?.[0]?.values || [];
      let v = info.followers_count;
      for (let i = vals.length - 1; i >= 0; i--) { followerHistory.unshift({ x: new Date(vals[i].end_time), y: v }); v -= vals[i].value || 0; }
    } catch (e) { console.warn('ig followers', e); }
    try {
      // When your followers are online. Meta reports hours in Pacific time; shift to local.
      const r = await c.get(`/${igId}/insights`, { access_token: tk, metric: 'online_followers', period: 'lifetime', since: unix(Date.now() - 7 * DAY), until });
      const days7 = (r.data?.[0]?.values || []).map(v => v.value).filter(v => v && Object.keys(v).length);
      if (days7.length) {
        const shift = pacificOffsetHours();
        audienceHours = new Array(24).fill(0);
        for (const d of days7) for (const [h, n] of Object.entries(d)) audienceHours[(+h + shift + 24) % 24] += n;
      }
    } catch (e) { console.warn('ig online followers', e); }

    const comments = [];
    await pool(raw.slice(0, 12), 4, async m => {
      const r = await c.get(`/${m.id}/comments`, { access_token: tk, fields: 'id,text,username,timestamp,like_count,replies{username}', limit: 20 });
      for (const cm of r.data || []) comments.push({
        platform: 'instagram', id: cm.id, postId: m.id, postTitle: firstLine(m.caption) || 'Post', postUrl: m.permalink,
        author: cm.username, avatar: null, text: cm.text, publishedAt: cm.timestamp, likes: cm.like_count || 0, canReply: true,
        replied: (cm.replies?.data || []).some(r2 => r2.username === info.username),
      });
    });

    return {
      account: { platform: 'instagram', id: igId, name: info.username, handle: '@' + info.username, avatar: info.profile_picture_url, followers: info.followers_count, followerHistory, url: `https://instagram.com/${info.username}` },
      posts, daily, dailyLabel: 'reach', comments, audienceHours,
    };
  },

  async reply(comment, text) {
    const c = igCtx();
    await c.post(`/${comment.id}/replies`, { message: text, access_token: c.tk });
  },

  /** Reels via Meta's resumable upload. Images need a public URL, so they go through the share sheet instead. */
  async publish(job, onProgress) {
    const c = igCtx(); const { tk, igId } = c;
    if (!job.file?.type.startsWith('video/')) throw new Error('Instagram only accepts direct video (Reels) uploads from here. Use Share for photos.');
    const box = await c.post(`/${igId}/media`, { access_token: tk, media_type: 'REELS', upload_type: 'resumable', caption: job.description, share_to_feed: 'true' });
    await uploadDirectOrRelay({
      method: 'POST', url: box.uri || `https://rupload.facebook.com/ig-api-upload/${V}/${box.id}`,
      headers: { Authorization: `OAuth ${tk}`, offset: '0', file_size: String(job.file.size) },
      body: job.file, onProgress: f => onProgress?.(f * 0.9),
    });
    // wait for Instagram to process the video
    for (let i = 0; i < 60; i++) {
      const s = await c.get(`/${box.id}`, { access_token: tk, fields: 'status_code,status' });
      if (s.status_code === 'FINISHED') break;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram couldn't process the video: ${s.status || s.status_code}`);
      await new Promise(r => setTimeout(r, 5000));
    }
    const pub = await c.post(`/${igId}/media_publish`, { access_token: tk, creation_id: box.id });
    onProgress?.(1);
    const link = await c.get(`/${pub.id}`, { access_token: tk, fields: 'permalink' }).catch(() => ({}));
    return { id: pub.id, url: link.permalink || 'https://instagram.com/' };
  },
};

// ---------------- HTTP ----------------
async function graph(path, params, base = GRAPH, fetcher = fetch) {
  const u = new URL(base + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  const res = await fetcher(u.toString());
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw graphError(j, base);
  return j;
}
async function graphPost(path, params, base = GRAPH, fetcher = fetch) {
  const res = await fetcher(base + path, { method: 'POST', body: new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw graphError(j, base);
  return j;
}
function graphError(j, base) {
  const e = j.error || {};
  if (e.code === 190) {
    if (base === GRAPH) { store.del('meta-session'); return new Error('Facebook login expired. Tap Connect again.'); }
    store.del('ig-session'); return new Error('Instagram login expired. Tap Connect again.');
  }
  return new Error(e.error_user_msg || e.message || 'Facebook/Instagram request failed');
}
function form(obj) { const fd = new FormData(); for (const [k, v] of Object.entries(obj)) if (v != null) fd.append(k, v); return fd; }
const unix = d => Math.floor(new Date(d).getTime() / 1000);
const firstLine = s => (s || '').split('\n')[0].slice(0, 120);
function pacificOffsetHours() {
  const now = new Date();
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const local = new Date(now.toLocaleString('en-US'));
  return Math.round((local - pt) / 3600000);
}
