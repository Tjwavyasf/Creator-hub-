// Sample data so the whole dashboard works before any account is connected.
// Shapes match what the real YouTube and Meta loaders return.

const DAY = 86400000;
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const TITLES = [
  'I tried the hardest challenge in the game', 'Ranking every boss from worst to best', 'This build broke the meta',
  'Day 100: what I learned', 'Speedrun attempt gone wrong', 'Reacting to your worst clips', 'The secret room nobody found',
  'Beginner to pro in 7 days', 'Why everyone quit this game', 'Building a city with no tools', 'Can I win with only starter gear?',
  '24 hours locked in a warehouse', 'Testing viral hacks so you don\'t have to', 'My setup tour (finally)', 'The update ruined everything?',
  'Surviving the zombie wave on hardcore', 'Duo vs squad: who wins?', 'I asked AI to plan my run', 'Top 10 hidden tricks',
  'Rebuilding my first base', 'The comeback nobody expected', 'Answering your questions', 'New season first impressions',
  'Trying every weapon once', 'One life challenge', 'Worst purchase I ever made', 'Behind the scenes of my last video',
  'I copied a pro\'s routine', 'Ranking your setups', 'Final boss, no damage',
];
const NAMES = ['maya.plays', 'JTgamer', 'kenji_r', 'Sofia M', 'the_real_dre', 'Lena K', 'pixelpete', 'Amir', 'chloe.v', 'Big Mike', 'noah_builds', 'Ari', 'zara', 'Tomas', 'quinn.exe'];
const COMMENTS = [
  'This is the best one yet 🔥', 'How did you get that ending??', 'Part 2 please!!', 'The edit at 3:20 was crazy',
  'I tried this and it actually worked', 'Can you do a tutorial on the build?', 'You deserve way more subs', 'First time watching, instant sub',
  'The intro was a bit long ngl', 'What mic do you use?', 'Bro said "trust me" and then 💀', 'Been here since 1k subs!',
  'Do a collab with someone in the comments', 'Wait what song is this?', 'This made my day honestly',
];

// Hour-of-day effect the demo bakes in, so "When to post" finds something real-looking
const HOUR_BOOST = h => 0.55 + 0.75 * Math.exp(-((h - 18) ** 2) / 10) + 0.35 * Math.exp(-((h - 12) ** 2) / 6);
const DOW_BOOST = d => [1.15, 0.85, 0.9, 0.95, 1.05, 1.1, 1.25][d];

function makePosts(platform, r, count, base, { video = true, spacing = 2.3 } = {}) {
  const posts = [];
  let t = Date.now() - 6 * 3600000;
  for (let i = 0; i < count; i++) {
    t -= (spacing * (0.6 + r() * 0.9)) * DAY;
    const d = new Date(t);
    const hour = [9, 12, 15, 17, 18, 19, 20, 21, 7, 23][Math.floor(r() * 10)];
    d.setHours(hour, Math.floor(r() * 60), 0, 0);
    const ageDays = (Date.now() - d) / DAY;
    const quality = Math.exp((r() - 0.5) * 1.6) * (i === 4 ? 4.2 : 1) * (i === 9 ? 0.22 : 1);
    const growth = Math.min(1, 0.35 + Math.log10(1 + ageDays) / 1.4);
    const views = Math.round(base * quality * HOUR_BOOST(hour) * DOW_BOOST(d.getDay()) * growth);
    const dur = platform === 'youtube' ? Math.round(240 + r() * 720) : Math.round(12 + r() * 50);
    const avgViewPct = Math.min(0.92, 0.28 + 0.12 * Math.log10(quality * 3 + 1) + r() * 0.1) * (platform === 'youtube' ? 1 : 1.35);
    posts.push({
      platform,
      id: `${platform}-${i}`,
      title: TITLES[(i * 7 + platform.length) % TITLES.length],
      thumb: thumbFor(platform, i),
      url: '#',
      publishedAt: d.toISOString(),
      isVideo: video,
      durationSec: video ? dur : null,
      views: platform === 'facebook' && !video ? null : views,
      likes: Math.round(views * (0.035 + r() * 0.03)),
      comments: Math.round(views * (0.003 + r() * 0.004)),
      shares: Math.round(views * (0.002 + r() * 0.006)),
      watchMinutes: video ? Math.round(views * dur * Math.min(avgViewPct, 1) / 60) : null,
      avgViewPct: video ? Math.min(avgViewPct, 0.95) : null,
      subsGained: Math.round(views * (0.002 + r() * 0.004)),
      _quality: quality,
    });
    // Instagram/Facebook don't report watch %, watch time or subs gained per post; keep the sample honest
    if (platform !== 'youtube') {
      const p = posts[posts.length - 1];
      if (platform === 'instagram' && video) p.avgWatchSec = dur * Math.min(avgViewPct, 0.95);
      p.watchMinutes = p.avgViewPct = p.subsGained = null;
      if (platform === 'instagram') p.durationSec = null;
      p._dur = dur;
    }
  }
  return posts;
}

function thumbFor(platform, i) {
  const hues = { youtube: 18, instagram: 160, facebook: 214, tiktok: 45 };
  const h = (hues[platform] + i * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,45%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},60%,22%)"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="${40 + (i * 23) % 80}" cy="${30 + (i * 13) % 30}" r="${14 + (i % 4) * 5}" fill="rgba(255,255,255,.18)"/><text x="10" y="80" font-family="sans-serif" font-weight="800" font-size="14" fill="rgba(255,255,255,.85)">#${i + 1}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function daily(r, days, base, posts) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const x = new Date(Date.now() - i * DAY); x.setHours(0, 0, 0, 0);
    let v = base * (0.85 + r() * 0.3) * DOW_BOOST(x.getDay());
    for (const p of posts) {
      const age = (x - new Date(p.publishedAt)) / DAY;
      if (age >= 0 && age < 10) v += (p.views || p.likes * 25) * 0.35 * Math.exp(-age / 1.8) / 1.8;
    }
    out.push({ x, y: Math.round(v) });
  }
  return out;
}

function followerHistory(r, days, now, perDay) {
  const out = []; let v = now;
  for (let i = 0; i < days; i++) {
    const x = new Date(Date.now() - i * DAY); x.setHours(0, 0, 0, 0);
    out.unshift({ x, y: Math.round(v) });
    v -= perDay * (0.4 + r() * 1.2);
  }
  return out;
}

function makeComments(r, posts, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = posts[Math.floor(r() * Math.min(8, posts.length))];
    const at = new Date(Math.max(new Date(p.publishedAt).getTime(), Date.now() - r() * 5 * DAY));
    const author = NAMES[Math.floor(r() * NAMES.length)];
    out.push({
      platform: p.platform, id: `${p.id}-c${i}`, postId: p.id, postTitle: p.title,
      author, avatar: null, text: COMMENTS[Math.floor(r() * COMMENTS.length)],
      publishedAt: at.toISOString(), likes: Math.floor(r() * 40), replied: r() < 0.25, canReply: true,
      isQuestion: false,
    });
  }
  return out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

const cache = {};
export function demoLoad(platform, days) {
  const key = platform + days;
  if (cache[key]) return structuredClone(cache[key]);
  const seed = { youtube: 11, instagram: 23, facebook: 37, tiktok: 51 }[platform];
  const r = rng(seed);
  let data;
  if (platform === 'youtube') {
    const posts = makePosts('youtube', r, 40, 14000);
    data = {
      account: { platform, id: 'demo-yt', name: 'Your Channel', handle: '@yourchannel', avatar: null, followers: 48200, url: '#' },
      posts, dailyLabel: 'views',
    };
    data.account.followerHistory = followerHistory(r, days, 48200, 95);
    data.daily = daily(r, days, 2600, posts);
    data.comments = makeComments(r, posts, 26);
  } else if (platform === 'instagram') {
    const posts = makePosts('instagram', r, 36, 9000, { spacing: 2 });
    data = {
      account: { platform, id: 'demo-ig', name: 'yourchannel', handle: '@yourchannel', avatar: null, followers: 21300, url: '#' },
      posts, dailyLabel: 'reach',
      audienceHours: Array.from({ length: 24 }, (_, h) => Math.round(400 + 1800 * HOUR_BOOST(h) * (h >= 1 && h <= 6 ? 0.25 : 1))),
    };
    data.account.followerHistory = followerHistory(r, days, 21300, 60);
    data.daily = daily(r, days, 1900, posts);
    data.comments = makeComments(r, posts, 18);
  } else if (platform === 'tiktok') {
    const posts = makePosts('tiktok', r, 45, 22000, { spacing: 1.4 });
    data = {
      account: { platform, id: 'demo-tt', name: 'yourchannel', handle: '@yourchannel', avatar: null, followers: 35200, url: '#' },
      posts, dailyLabel: 'views', comments: [], commentsUnsupported: true,
    };
    data.account.followerHistory = followerHistory(r, days, 35200, 140);
    data.daily = daily(r, days, 4200, posts);
  } else {
    const posts = makePosts('facebook', r, 24, 3200, { spacing: 3 });
    data = {
      account: { platform, id: 'demo-fb', name: 'Your Page', handle: 'Your Page', avatar: null, followers: 7400, url: '#' },
      posts, dailyLabel: 'views',
    };
    data.account.followerHistory = followerHistory(r, days, 7400, 12);
    data.daily = daily(r, days, 700, posts);
    data.comments = makeComments(r, posts, 9);
  }
  cache[key] = data;
  return structuredClone(data);
}

export function demoRetention(post) {
  const r = rng(post.id.length * 97 + post.title.length);
  const q = post._quality || 1;
  const dropAt = 0.25 + r() * 0.45, spikeAt = 0.15 + r() * 0.7;
  const out = [];
  let y = 1.0;
  for (let i = 1; i <= 100; i++) {
    const t = i / 100;
    let loss = (t < 0.05 ? 0.05 : 0.0055) / Math.min(1.5, Math.max(0.6, Math.sqrt(q)));
    if (Math.abs(t - dropAt) < 0.025) loss += 0.02;
    if (t > 0.94) loss += 0.025;
    y = Math.max(0.03, y - loss + (Math.abs(t - spikeAt) < 0.015 ? 0.03 : 0) + (r() - 0.5) * 0.004);
    out.push({ t, y });
  }
  return out;
}

export function demoNiche() {
  const r = rng(99);
  const out = [];
  for (let i = 0; i < 150; i++) {
    const d = new Date(Date.now() - (2 + r() * 28) * DAY);
    const hour = Math.floor(r() * 24);
    d.setHours(hour, Math.floor(r() * 60));
    const subs = Math.round(10 ** (3 + r() * 3));
    const views = Math.round(subs * (0.05 + r() * 0.4) * HOUR_BOOST((hour + 1) % 24) * DOW_BOOST(d.getDay()) ** 1.5);
    out.push({ publishedAt: d.toISOString(), views, subs, title: TITLES[i % TITLES.length], channel: 'Creator ' + (i % 30) });
  }
  return out;
}
