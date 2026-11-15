// Creator Hub — screens and state.
import { PLATFORMS, icon, platTag, $, $$, esc, fmtNum, fmtFull, fmtPct, fmtDur, ago, fmtDate, fmtHour, DAYS_LONG, store, toast } from './util.js';
import { lineChart, sparkline, retentionChart, heatmap } from './charts.js';
import { scorePosts, bestWorst, explainIndex, compareBestWorst, analyzeRetention, averageCurve, bestTimes, describeSlot, nicheSummary } from './analyze.js';
import { demoLoad, demoRetention, demoNiche } from './demo.js';
import { youtube } from './youtube.js';
import { facebook, instagram, meta } from './meta.js';
import { tiktok } from './tiktok.js';
import { thumbnailEditor } from './thumbs.js';
import { takeOAuthReturn, redirectUri } from './helper.js';

const PROVIDERS = { youtube, instagram, facebook, tiktok };
const DIRECT = ['youtube', 'instagram', 'facebook', 'tiktok'];
const SHARE_ONLY = ['x'];
const NICHE_TTL = 12 * 3600000;

const state = {
  tab: store.get('tab', 'overview'),
  range: store.get('range', 28),
  data: {},          // platform -> loaded data | { error }
  loading: false,
  demo: false,
  niche: store.get('niche', null), // { list, at, demo }
  curves: {},        // postId -> retention curve
  videoPlat: 'all', videoSort: 'newest', video: null,
  commentPlat: 'all', commentFilter: 'needs',
  timingPlat: 'all',
};

const settings = () => store.get('settings', {});
const saveSettings = patch => store.set('settings', { ...settings(), ...patch });

function applyTheme() {
  const t = settings().theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

// ---------------- data ----------------
function activePlatforms() {
  return DIRECT.filter(p => PROVIDERS[p].isConnected());
}

async function loadAll() {
  if (state.loading) return;
  state.loading = true; $('#refresh').classList.add('spin');
  const live = activePlatforms();
  state.demo = !live.length || !!settings().forceDemo;
  $('#demo-pill').hidden = !state.demo;
  state.data = {};
  render(); // show skeletons
  try {
    if (state.demo) {
      for (const p of DIRECT) state.data[p] = demoLoad(p, state.range);
    } else {
      await Promise.all(live.map(async p => {
        try { state.data[p] = await PROVIDERS[p].load(state.range); }
        catch (e) { console.error(p, e); state.data[p] = { error: e.message }; }
      }));
    }
    scorePosts(allPosts());
    await refreshNiche(false);
  } finally {
    state.loading = false; $('#refresh').classList.remove('spin');
    render();
  }
}

async function refreshNiche(force) {
  const s = settings();
  if (state.demo) {
    if (!state.niche?.demo || force) state.niche = { list: demoNiche(), at: Date.now(), demo: true };
    return;
  }
  if (state.niche?.demo) state.niche = null;
  if (!youtube.isConnected()) return;
  const keywords = (s.keywords || '').split(',').map(k => k.trim()).filter(Boolean);
  const competitors = (s.competitors || '').split(/[,\n]/).map(k => k.trim()).filter(Boolean);
  if (!keywords.length && !competitors.length) return;
  const stale = !state.niche || Date.now() - state.niche.at > NICHE_TTL || state.niche.key !== keywords.join() + competitors.join();
  if (!stale && !force) return;
  try {
    const list = await youtube.niche({ keywords, competitors });
    state.niche = { list, at: Date.now(), key: keywords.join() + competitors.join() };
    store.set('niche', state.niche);
  } catch (e) { console.warn('niche', e); toast('Could not update niche data: ' + e.message); }
}

const loaded = () => DIRECT.filter(p => state.data[p] && !state.data[p].error);
const allPosts = () => loaded().flatMap(p => state.data[p].posts || []);
const allComments = () => loaded().flatMap(p => state.data[p].comments || []).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

function timing(plat = 'all') {
  const own = allPosts().filter(p => plat === 'all' || p.platform === plat);
  const audience = (plat === 'all' || plat === 'instagram') ? state.data.instagram?.audienceHours : null;
  return bestTimes({ own, niche: state.niche?.list || [], audience });
}

// ---------------- shell ----------------
function render() {
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const on = $('#tabs button.on'), bar = $('#tabs');
  if (on && (on.offsetLeft < bar.scrollLeft || on.offsetLeft + on.offsetWidth > bar.scrollLeft + bar.clientWidth)) bar.scrollLeft = on.offsetLeft - 16;
  const main = $('#main');
  const view = { overview: viewOverview, post: viewPost, videos: viewVideos, comments: viewComments, timing: viewTiming, settings: viewSettings }[state.tab];
  view(main);
}

function go(tab) {
  state.tab = tab; store.set('tab', tab);
  if (tab !== 'videos') state.video = null;
  render(); scrollTo({ top: 0 });
}

function skeleton(h = 120) { return `<div class="skeleton" style="height:${h}px"></div>`; }
function rangeSeg() {
  return `<div class="seg" role="group" aria-label="Date range">${[7, 28, 90].map(d => `<button data-range="${d}" class="${state.range === d ? 'on' : ''}">${d} days</button>`).join('')}</div>`;
}
function bindRange(root) {
  $$('[data-range]', root).forEach(b => b.onclick = () => { state.range = +b.dataset.range; store.set('range', state.range); loadAll(); });
}
function errors() {
  return DIRECT.filter(p => state.data[p]?.error).map(p => `<div class="note" style="margin-bottom:12px">${icon(p)} <b>${PLATFORMS[p].label}:</b> ${esc(state.data[p].error)} <button class="btn small" data-reconnect="${p}">Reconnect</button></div>`).join('');
}
function bindReconnect(root) {
  $$('[data-reconnect]', root).forEach(b => b.onclick = async () => {
    try { await PROVIDERS[b.dataset.reconnect].connect(); loadAll(); } catch (e) { toast(e.message); }
  });
}
function demoBanner() {
  return state.demo ? `<div class="note" style="margin-bottom:14px"><b>You're looking at sample data.</b> Everything here works the same with your real accounts. <a href="#" data-go="settings">Connect your accounts →</a></div>` : '';
}
function bindGo(root) { $$('[data-go]', root).forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.go); }); }

function thumb(p, style = '') {
  return `<div class="thumb" style="${style}background-image:url('${esc(p.thumb || '')}')">${p.durationSec ? `<span class="dur">${fmtDur(p.durationSec)}</span>` : ''}</div>`;
}

// ---------------- Overview ----------------
function viewOverview(main) {
  const plats = loaded();
  if (state.loading && !plats.length) {
    main.innerHTML = `<h2>Overview</h2><div class="grid g3">${skeleton(130).repeat(3)}</div><div style="height:14px"></div>${skeleton(260)}`;
    return;
  }
  const posts = allPosts();
  const { best, worst } = bestWorst(posts);
  const tm = timing();
  const total = plats.reduce((a, p) => a + (state.data[p].account.followers || 0), 0);
  const needs = allComments().filter(c => !c.replied).length;

  let h = `${demoBanner()}${errors()}
  <div class="filters" style="justify-content:space-between"><h2 style="margin:0">Overview</h2>${rangeSeg()}</div>
  <div class="grid g4">
    <div class="card kpi"><div class="label">All followers</div><div class="value">${fmtNum(total)}</div><div class="muted small">across ${plats.length} account${plats.length === 1 ? '' : 's'}</div></div>
    ${plats.map(p => kpiCard(p)).join('')}
  </div>
  <div style="height:14px"></div>
  <div class="grid g2">
    <div class="card">
      <div class="card-head"><h3>Views per day</h3><span class="muted small">Instagram counts reach</span></div>
      <div id="views-chart"></div>
      ${viewsTable(plats)}
    </div>
    <div class="card">
      <div class="card-head"><h3>Next best time to post</h3><a href="#" data-go="timing" class="small">Details</a></div>
      ${tm?.next ? `<div class="countdown" id="countdown"></div>
        <div style="font-weight:700;margin-top:2px">${describeSlot(tm.next)} · ${tm.next.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
        <p class="muted small" style="margin:6px 0 12px">${esc(tm.why(tm.next.dow, tm.next.hour).join(' · ') || 'Based on your posting history.')}</p>
        <div class="btn-row"><button class="btn primary small" data-go="post">Make a post</button></div>
        <p class="muted small" style="margin:12px 0 0">Top slots this week: ${tm.tops.map(t => `<b>${describeSlot(t)}</b>`).join(', ')}</p>`
        : `<p class="muted">Post a few times, or add niche keywords in Accounts, and this fills in.</p>`}
    </div>
  </div>
  <div style="height:14px"></div>
  <div class="grid g2">
    ${heroVideo(best, 'best')}
    ${heroVideo(worst, 'worst')}
  </div>
  ${best && worst ? `<div class="card" style="margin-top:14px"><h3>What your best video did differently</h3>${compareBestWorst(best, worst).map(t => `<p style="margin:6px 0">${esc(t)}</p>`).join('') || '<p class="muted">Not enough detail to compare yet.</p>'}</div>` : ''}
  <div style="height:14px"></div>
  <div class="card pad0">
    <div class="card-head" style="padding:16px 16px 0"><h3>Latest comments</h3><a href="#" data-go="comments" class="small">${needs} need a reply →</a></div>
    <div>${allComments().slice(0, 4).map(c => commentRow(c, false)).join('') || '<div class="empty">No comments yet.</div>'}</div>
  </div>`;
  main.innerHTML = h;

  lineChart($('#views-chart', main), {
    series: plats.map(p => ({ name: PLATFORMS[p].label, color: PLATFORMS[p].color, points: state.data[p].daily || [] })),
    height: 230, tipTitle: x => new Date(x).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    yFmt: (v, full) => (full ? fmtFull(v) : fmtNum(v)),
  });
  plats.forEach(p => { const el = $(`#spark-${p}`, main); if (el) sparkline(el, state.data[p].account.followerHistory, PLATFORMS[p].color); });
  if (tm?.next) tickCountdown(tm.next.date);
  $$('[data-video]', main).forEach(b => b.onclick = () => { state.video = b.dataset.video; go('videos'); });
  bindRange(main); bindGo(main); bindReconnect(main);
}

function kpiCard(p) {
  const a = state.data[p].account, hist = a.followerHistory || [];
  const change = hist.length > 1 ? hist[hist.length - 1].y - hist[0].y : null;
  const cls = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
  return `<div class="card kpi">
    <div class="label">${icon(p)} ${PLATFORMS[p].label} ${PLATFORMS[p].follower}</div>
    <div class="value">${a.followers == null ? 'Hidden' : fmtNum(a.followers)}</div>
    ${change != null ? `<span class="delta ${cls}">${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${fmtNum(Math.abs(change))} <span class="muted" style="font-weight:600">in ${state.range}d</span></span>` : '<span class="muted small">No history yet</span>'}
    <div class="spark" id="spark-${p}"></div>
  </div>`;
}

function viewsTable(plats) {
  const rows = plats.map(p => {
    const d = state.data[p].daily || [];
    const sum = d.reduce((a, x) => a + x.y, 0);
    return `<tr><td>${platTag(p)}</td><td class="n">${fmtFull(sum)}</td><td class="n">${fmtFull(d.length ? sum / d.length : 0)}</td></tr>`;
  }).join('');
  return `<details><summary>Show as table</summary><table class="data"><thead><tr><th>Platform</th><th class="n">Total</th><th class="n">Per day</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function heroVideo(p, kind) {
  const title = kind === 'best' ? 'Best video' : 'Worst video';
  if (!p) return `<div class="card"><h3>${title}</h3><p class="muted">Needs at least two posts older than 2 days.</p></div>`;
  return `<div class="card">
    <div class="card-head"><h3>${title}</h3><span class="badge ${kind === 'best' ? 'good' : 'bad'}">${esc(explainIndex(p))}</span></div>
    <button class="hero-video" data-video="${esc(p.id)}" style="all:unset;cursor:pointer;display:grid;grid-template-columns:min(40%,160px) 1fr;gap:14px">
      ${thumb(p)}
      <div><div style="font-weight:800">${esc(p.title)}</div>
        <div class="muted small" style="margin-top:4px">${platTag(p.platform)} · ${ago(p.publishedAt)}</div>
        <div class="stats-row">
          ${p.views != null ? `<span><b>${fmtNum(p.views)}</b> views</span>` : ''}
          <span><b>${fmtNum(p.likes)}</b> likes</span><span><b>${fmtNum(p.comments)}</b> comments</span>
          ${p.avgViewPct != null ? `<span><b>${fmtPct(p.avgViewPct)}</b> watched</span>` : ''}
        </div>
        <div class="small" style="margin-top:8px;color:var(--accent);font-weight:700">${p.platform === 'youtube' ? 'See where viewers dropped off →' : 'See details →'}</div>
      </div>
    </button>
  </div>`;
}

let cdTimer;
function tickCountdown(date) {
  clearInterval(cdTimer);
  const tick = () => {
    const el = $('#countdown'); if (!el) return clearInterval(cdTimer);
    const s = Math.max(0, (date - Date.now()) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    el.textContent = s < 60 ? 'Now' : d ? `in ${d}d ${h}h` : `in ${h}h ${String(m).padStart(2, '0')}m`;
  };
  tick(); cdTimer = setInterval(tick, 30000);
}

// ---------------- Videos ----------------
function viewVideos(main) {
  if (state.video) return viewVideoDetail(main);
  const plats = loaded();
  if (state.loading && !plats.length) { main.innerHTML = `<h2>Videos & posts</h2>${skeleton(400)}`; return; }
  let posts = allPosts().filter(p => state.videoPlat === 'all' || p.platform === state.videoPlat);
  const sorters = {
    newest: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    best: (a, b) => (b.tooNew - a.tooNew) || b.index - a.index,
    worst: (a, b) => (a.tooNew - b.tooNew) || a.index - b.index,
    views: (a, b) => (b.metric || 0) - (a.metric || 0),
  };
  posts = [...posts].sort(sorters[state.videoSort]);
  if (state.videoSort === 'best' || state.videoSort === 'worst') posts = posts.filter(p => !p.tooNew);

  main.innerHTML = `${demoBanner()}${errors()}
    <h2>Videos & posts</h2>
    <p class="sub">Scored against your usual post on the same platform. Tap one to see where people stopped watching.</p>
    <div class="filters">
      <div class="seg">${['all', ...plats].map(p => `<button data-vp="${p}" class="${state.videoPlat === p ? 'on' : ''}">${p === 'all' ? 'All' : PLATFORMS[p].label}</button>`).join('')}</div>
      <div class="seg">${[['newest', 'Newest'], ['best', 'Best'], ['worst', 'Worst'], ['views', 'Most views']].map(([k, l]) => `<button data-vs="${k}" class="${state.videoSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div class="card pad0"><div class="vlist">${posts.map(videoRow).join('') || '<div class="empty">Nothing here yet.</div>'}</div></div>`;
  $$('[data-vp]', main).forEach(b => b.onclick = () => { state.videoPlat = b.dataset.vp; render(); });
  $$('[data-vs]', main).forEach(b => b.onclick = () => { state.videoSort = b.dataset.vs; render(); });
  $$('[data-video]', main).forEach(b => b.onclick = () => { state.video = b.dataset.video; render(); scrollTo({ top: 0 }); });
  bindGo(main); bindReconnect(main);
}

function videoRow(p) {
  const badge = p.tooNew ? '<span class="badge warn">New</span>' : p.index >= 1.5 ? `<span class="badge good">${p.index.toFixed(1)}×</span>` : p.index <= 0.6 ? `<span class="badge bad">${p.index.toFixed(1)}×</span>` : `<span class="muted small">${p.index.toFixed(1)}×</span>`;
  return `<button class="vrow" data-video="${esc(p.id)}">
    ${thumb(p)}
    <div style="min-width:0"><div class="t">${esc(p.title)}</div><div class="m">${platTag(p.platform)} · ${ago(p.publishedAt)}${p.avgViewPct != null ? ` · ${fmtPct(p.avgViewPct)} watched` : ''}</div></div>
    <div class="stat">${fmtNum(p.metric)}<small>${p.metricName}</small>${badge}</div>
  </button>`;
}

async function viewVideoDetail(main) {
  const p = allPosts().find(x => x.id === state.video);
  if (!p) { state.video = null; return viewVideos(main); }
  const plat = state.data[p.platform];
  const comments = (plat.comments || []).filter(c => c.postId === p.id);
  const canRetention = p.platform === 'youtube';
  main.innerHTML = `
    <button class="back" id="back">← All videos</button>
    <div class="grid g2" style="align-items:start">
      <div class="card">
        ${thumb(p, 'width:100%;')}
        <h2 style="margin:12px 0 4px">${esc(p.title)}</h2>
        <div class="muted small">${platTag(p.platform)} · posted ${new Date(p.publishedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
        <div style="margin:10px 0"><span class="badge ${p.tooNew ? 'warn' : p.index >= 1 ? 'good' : 'bad'}">${p.tooNew ? 'Too new to judge' : esc(explainIndex(p))}</span></div>
        <div class="grid g3" style="gap:10px;grid-template-columns:repeat(auto-fit,minmax(100px,1fr))">
          ${stat('Views', p.views)}${stat('Likes', p.likes)}${stat('Comments', p.comments)}${stat('Shares', p.shares)}
          ${p.watchMinutes != null ? stat('Watch hours', p.watchMinutes / 60) : ''}
          ${p.avgViewPct != null ? stat('Avg watched', null, fmtPct(p.avgViewPct)) : ''}
          ${p.subsGained != null ? stat('Subs gained', p.subsGained) : ''}
          ${p.avgWatchSec ? stat('Avg watch', null, fmtDur(p.avgWatchSec)) : ''}
          ${p.saves ? stat('Saves', p.saves) : ''}
        </div>
        ${p.url && p.url !== '#' ? `<p><a href="${esc(p.url)}" target="_blank" rel="noopener">Open on ${PLATFORMS[p.platform].label} ↗</a></p>` : ''}
        ${p.platform === 'youtube' ? `<details id="thumb-change"><summary>Change thumbnail</summary>
          <div id="detail-thumb" style="margin-top:10px"></div>
          <button class="btn small primary" id="thumb-upload" style="margin-top:10px" disabled>Upload to YouTube</button>
          <div class="how" style="margin-top:6px">Your channel must be verified at youtube.com/verify to use custom thumbnails.</div>
        </details>` : ''}
      </div>
      <div class="card">
        <div class="card-head"><h3>Where viewers drop off</h3></div>
        <div id="ret">${canRetention ? skeleton(240) : `<p class="muted">${p.avgWatchSec ? `People watched this Reel for <b>${fmtDur(p.avgWatchSec)}</b> on average. ` : ''}${PLATFORMS[p.platform].label} doesn't share a second-by-second retention graph with apps, so the exact drop-off moment is only available for YouTube videos.</p>`}</div>
        <div id="findings"></div>
      </div>
    </div>
    <div class="card pad0" style="margin-top:14px">
      <div class="card-head" style="padding:16px 16px 0"><h3>Comments on this ${p.isVideo ? 'video' : 'post'}</h3></div>
      <div id="vcomments">${comments.map(c => commentRow(c, true)).join('') || `<div class="empty">${plat.commentsUnsupported ? "TikTok doesn't let apps read comments. Check them in the TikTok app." : 'No comments loaded for this one.'}</div>`}</div>
    </div>`;
  $('#back').onclick = () => { state.video = null; render(); };
  bindReplies(main);
  const dt = $('#detail-thumb', main);
  if (dt) {
    let picked = null;
    const up = $('#thumb-upload', main);
    thumbnailEditor(dt, { title: p.title, onChange: f => { picked = f; up.disabled = !f; } });
    up.onclick = async () => {
      up.disabled = true; up.textContent = 'Uploading…';
      try {
        let url = null;
        if (!state.demo) url = await youtube.setThumbnail(p.id, picked);
        p.thumb = url ? `${url}?v=${Date.now()}` : URL.createObjectURL(picked);
        $$('.thumb', main)[0].style.backgroundImage = `url('${p.thumb}')`;
        toast(state.demo ? 'Sample mode: thumbnail not actually uploaded' : 'Thumbnail updated on YouTube');
        up.textContent = 'Uploaded ✓';
      } catch (e) { toast(e.message, 7000); up.disabled = false; up.textContent = 'Upload to YouTube'; }
    };
  }
  if (!canRetention) return;

  try {
    let curve = state.curves[p.id];
    if (!curve) {
      curve = state.demo ? demoRetention(p) : await youtube.retention(p);
      state.curves[p.id] = curve;
    }
    if (state.video !== p.id) return;
    if (!curve) { $('#ret').innerHTML = '<p class="muted">YouTube has no retention data for this video yet (it needs a few hundred views).</p>'; return; }
    // "Your typical video" line: average of the other curves already opened (demo: a few generated)
    let others = Object.entries(state.curves).filter(([id]) => id !== p.id).map(([, c]) => c);
    if (state.demo && others.length < 3) others = allPosts().filter(x => x.platform === 'youtube' && x.id !== p.id).slice(0, 8).map(demoRetention);
    const typical = averageCurve(others);
    const a = analyzeRetention(curve, p.durationSec || 60);
    $('#ret').innerHTML = `<div class="legend"><span><i class="dot" style="background:var(--youtube)"></i>This video</span>${typical ? '<span><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 3"/></svg>Your typical video</span>' : ''}</div><div id="retc"></div>`;
    retentionChart($('#retc'), { curve, durationSec: p.durationSec || 60, marks: a.marks, color: 'var(--youtube)', compare: typical });
    $('#findings').innerHTML = a.findings.map(f => `<div class="slot"><span class="badge ${f.kind === 'info' ? 'warn' : f.kind}" style="min-width:12px;height:12px;padding:0;border-radius:50%;background:${f.kind === 'good' ? 'var(--good)' : f.kind === 'bad' ? 'var(--bad)' : f.kind === 'warn' ? 'var(--warn)' : 'var(--ink-3)'}"></span><div><div style="font-weight:800">${esc(f.title)}</div><div class="muted small">${esc(f.text)}</div>${f.t != null && p.url && p.url !== '#' && p.platform === 'youtube' ? `<a class="small" target="_blank" rel="noopener" href="${esc(p.url)}?t=${Math.max(0, Math.round(f.t * p.durationSec) - 3)}">Watch this moment ↗</a>` : ''}</div></div>`).join('');
  } catch (e) {
    $('#ret').innerHTML = `<p class="muted">Couldn't load retention: ${esc(e.message)}</p>`;
  }
}
function stat(label, n, text) {
  return `<div style="background:var(--surface-2);border-radius:10px;padding:10px"><div class="muted small" style="font-weight:600">${label}</div><div style="font-weight:800;font-size:18px" class="num">${text ?? fmtNum(n)}</div></div>`;
}

// ---------------- Comments ----------------
const QUESTION = /\?|\b(how|what|where|when|why|which|can you|do you|is there)\b/i;

function viewComments(main) {
  const plats = loaded();
  if (state.loading && !plats.length) { main.innerHTML = `<h2>Comments</h2>${skeleton(400)}`; return; }
  const all = allComments().filter(c => state.commentPlat === 'all' || c.platform === state.commentPlat);
  const lists = { needs: all.filter(c => !c.replied), questions: all.filter(c => !c.replied && QUESTION.test(c.text)), all };
  const shown = lists[state.commentFilter];
  main.innerHTML = `${demoBanner()}${errors()}
    <h2>Comments</h2>
    <p class="sub">Every account's comments in one inbox. Reply right here.${loaded().some(p => state.data[p].commentsUnsupported) ? " TikTok doesn't let apps read comments, so check those in the TikTok app." : ''}</p>
    <div class="filters">
      <div class="seg">${[['needs', `Needs reply (${lists.needs.length})`], ['questions', `Questions (${lists.questions.length})`], ['all', 'All']].map(([k, l]) => `<button data-cf="${k}" class="${state.commentFilter === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg">${['all', ...plats].map(p => `<button data-cp="${p}" class="${state.commentPlat === p ? 'on' : ''}">${p === 'all' ? 'All' : PLATFORMS[p].label}</button>`).join('')}</div>
    </div>
    <div class="card pad0">${shown.map(c => commentRow(c, true)).join('') || '<div class="empty"><h3>All caught up</h3>No comments waiting.</div>'}</div>`;
  $$('[data-cf]', main).forEach(b => b.onclick = () => { state.commentFilter = b.dataset.cf; render(); });
  $$('[data-cp]', main).forEach(b => b.onclick = () => { state.commentPlat = b.dataset.cp; render(); });
  bindReplies(main); bindGo(main); bindReconnect(main);
}

function commentRow(c, withReply) {
  const initial = esc((c.author || '?').replace(/^@/, '')[0]?.toUpperCase() || '?');
  return `<div class="comment" data-cid="${esc(c.id)}">
    <div class="avatar" ${c.avatar ? `style="background-image:url('${esc(c.avatar)}')"` : ''}>${c.avatar ? '' : initial}</div>
    <div style="min-width:0">
      <div class="who"><b>${esc(c.author)}</b>${platTag(c.platform)}<span class="muted">${ago(c.publishedAt)}</span>${c.likes ? `<span class="muted">♥ ${fmtNum(c.likes)}</span>` : ''}${c.replied ? '<span class="badge good">Replied</span>' : ''}</div>
      <div class="text">${esc(c.text)}</div>
      <div class="on-post">on “${esc(c.postTitle)}”</div>
      ${withReply && c.canReply && !c.replied ? `<form class="reply-box" data-reply="${esc(c.id)}"><input type="text" placeholder="Reply…" aria-label="Reply to ${esc(c.author)}" required><button class="btn small primary">Send</button></form>` : ''}
    </div>
  </div>`;
}

function bindReplies(root) {
  $$('[data-reply]', root).forEach(f => f.onsubmit = async e => {
    e.preventDefault();
    const c = allComments().find(x => x.id === f.dataset.reply);
    const input = $('input', f), btn = $('button', f), text = input.value.trim();
    if (!c || !text) return;
    btn.disabled = true; btn.textContent = '…';
    try {
      if (!state.demo) await PROVIDERS[c.platform].reply(c, text);
      c.replied = true;
      toast(state.demo ? 'Sample mode: reply not actually sent' : `Replied on ${PLATFORMS[c.platform].label}`);
      render();
    } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Send'; }
  });
}

// ---------------- When to post ----------------
function viewTiming(main) {
  const plats = loaded();
  if (state.loading && !plats.length) { main.innerHTML = `<h2>When to post</h2>${skeleton(400)}`; return; }
  const tm = timing(state.timingPlat);
  const niche = state.niche?.list || [];
  const s = settings();
  const needsKeywords = !state.demo && youtube.isConnected() && !(s.keywords || s.competitors);

  // Recent standouts in the niche: biggest views relative to channel size
  const standouts = [...niche].map(v => ({ ...v, ratio: v.views / Math.max(1000, v.subs) })).sort((a, b) => b.ratio - a.ratio).slice(0, 5);

  main.innerHTML = `${demoBanner()}
    <h2>When to post</h2>
    <p class="sub">Mixes three things: when <b>your</b> posts did best, when <b>other creators in your niche</b> got the most views for their size (and how crowded each hour is), and when your followers are online. Times are in your time zone (${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}).</p>
    <div class="filters"><div class="seg">${['all', ...plats].map(p => `<button data-tp="${p}" class="${state.timingPlat === p ? 'on' : ''}">${p === 'all' ? 'All platforms' : PLATFORMS[p].label}</button>`).join('')}</div></div>
    ${needsKeywords ? `<div class="note" style="margin-bottom:14px"><b>Add your niche</b> so this can learn from other creators. <a href="#" data-go="settings">Add keywords or channels →</a></div>` : ''}
    ${!tm ? '<div class="card empty"><h3>Not enough to go on yet</h3>Post at least 3 times or add niche keywords in Accounts.</div>' : `
    <div class="grid g2" style="align-items:start">
      <div class="card">
        <h3>Next best time</h3>
        ${tm.next ? `<div class="countdown" id="countdown"></div><div style="font-weight:800;font-size:17px">${describeSlot(tm.next)}, ${tm.next.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
        <p class="muted small">Upload about 30 minutes early so it's processed and showing up when people arrive.</p>` : ''}
        <h3 style="margin-top:16px">Top 3 slots every week</h3>
        ${tm.tops.map((t, i) => `<div class="slot"><span class="rank">${i + 1}</span><div><div class="when">${describeSlot(t)}</div><div class="muted small">${esc(tm.why(t.dow, t.hour).join(' · ') || 'Strong overall')}</div></div></div>`).join('')}
      </div>
      <div class="card">
        <h3>Every hour of the week</h3>
        <div id="heat"></div>
        <details><summary>What this is based on</summary>
          <ul class="steps">
            <li>${tm.sources.own ? `<b>${tm.sources.own}</b> of your posts` : 'Your posts: not enough yet (need 3+)'}</li>
            <li>${tm.sources.niche ? `<b>${tm.sources.niche}</b> videos from other creators in the last 30 days` : 'Other creators: add keywords or channels in Accounts (needs YouTube connected)'}</li>
            <li>${tm.sources.audience ? 'When your Instagram followers are online' : 'Follower online times: comes from Instagram'}</li>
          </ul>
        </details>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h3>What's working for others right now</h3>
        <span class="muted small">${state.niche ? `Updated ${ago(state.niche.at)}` : ''} <button class="btn small" id="niche-refresh">Update now</button></span></div>
      <p class="muted small" style="margin-top:0">${esc(nicheSummary(niche)) || 'No niche data yet'}. Refreshes on its own every 12 hours when you open the app.</p>
      ${standouts.map(v => `<div class="slot"><div style="min-width:0;flex:1"><div style="font-weight:700">${esc(v.title)}</div><div class="muted small">${esc(v.channel)} · ${fmtNum(v.subs)} subs · posted ${DAYS_LONG[new Date(v.publishedAt).getDay()]} ${fmtHour(new Date(v.publishedAt).getHours())}</div></div><div class="stat" style="text-align:right;font-weight:800">${fmtNum(v.views)}<div class="muted small">${v.ratio >= 1 ? `${v.ratio.toFixed(1)}× their subs` : fmtPct(v.ratio) + ' of subs'}</div></div></div>`).join('')}
    </div>`}`;

  if (tm) {
    heatmap($('#heat', main), tm.grid, {
      tops: tm.tops,
      tipFor: (d, h) => `<div class="tt">${DAYS_LONG[d]} ${fmtHour(h)}</div><div>Score <b>${Math.round(tm.grid[d][h] * 100)}</b>/100</div><div class="muted small">${esc(tm.why(d, h).join(' · '))}</div>`,
    });
    if (tm.next) tickCountdown(tm.next.date);
    const btn = $('#niche-refresh', main);
    if (btn) btn.onclick = async () => {
      btn.disabled = true; btn.textContent = 'Updating…';
      await refreshNiche(true); render();
    };
  }
  $$('[data-tp]', main).forEach(b => b.onclick = () => { state.timingPlat = b.dataset.tp; render(); });
  bindGo(main);
}

// ---------------- Post ----------------
let draftFile = null;
let thumbFile = null, thumbFrameSec = null;

// direct = posts through the platform's API; share = phone share sheet; off = needs connecting
function postMode(p) {
  if (SHARE_ONLY.includes(p)) return 'share';
  if (state.demo || PROVIDERS[p].isConnected()) return 'direct';
  return p === 'tiktok' || p === 'instagram' ? 'share' : 'off';
}

function viewPost(main) {
  const d = store.get('draft', {});
  const tm = timing();
  const targets = { youtube: true, instagram: true, facebook: true, tiktok: true, x: true, ...store.get('targets', {}) };
  const how = {
    youtube: { direct: 'Uploads directly, with your thumbnail', off: 'Connect YouTube to post here' },
    facebook: { direct: 'Posts directly to your Page', off: 'Connect Facebook to post here' },
    instagram: { direct: 'Posts directly as a Reel (photos use the share sheet)', share: "Opens your phone's share sheet with the video, caption copied · connect Instagram to post directly" },
    tiktok: { direct: 'Uploads directly to TikTok', share: "Opens your phone's share sheet with the video, caption copied · connect TikTok to post directly" },
    x: { share: "Opens your phone's share sheet with the video, caption copied" },
  };
  const isVideo = draftFile?.type.startsWith('video/');
  main.innerHTML = `${demoBanner()}
    <h2>Post everywhere</h2>
    <p class="sub">One video, one caption, every account.</p>
    <div class="grid g2" style="align-items:start">
      <div class="grid" style="gap:12px">
        <label class="drop ${draftFile ? 'has' : ''}" id="drop">
          <input type="file" id="file" accept="video/*,image/*" hidden>
          ${draftFile ? preview(draftFile) : '<div style="font-weight:800;font-size:16px">Choose a video or photo</div><div class="muted small">Tap to pick from your camera roll</div>'}
        </label>
        ${draftFile ? `<div class="muted small">${esc(draftFile.name)} · ${(draftFile.size / 1048576).toFixed(1)} MB <button class="btn small" id="clear-file">Remove</button></div>` : ''}
        <label class="field">Title (YouTube)<input type="text" id="title" maxlength="100" value="${esc(d.title || '')}" placeholder="What's it about?"></label>
        <label class="field">Caption / description<textarea id="caption" placeholder="Write once. Used on every platform.">${esc(d.caption || '')}</textarea></label>
        <label class="field">Tags / hashtags (comma separated)<input type="text" id="tags" value="${esc(d.tags || '')}" placeholder="gaming, challenge, shorts"></label>
        <label class="check"><input type="checkbox" id="add-hashtags" ${d.addHashtags !== false ? 'checked' : ''}> Add tags as #hashtags to the caption on Instagram, TikTok and X</label>
        <div class="card" style="padding:12px">
          <h3>When</h3>
          <div class="seg" id="when-seg"><button data-when="now" class="on">Now</button><button data-when="later">Schedule</button></div>
          <div id="when-later" hidden style="margin-top:10px">
            <input type="datetime-local" id="when-at">
            ${tm?.next ? `<button class="btn small" id="use-best" style="margin-top:8px">Use next best time: ${describeSlot(tm.next)}</button>` : ''}
            <p class="how" style="margin:8px 0 0">YouTube and Facebook schedule for you. Instagram, TikTok and X can't be scheduled by apps, so you'll get a calendar reminder for those.</p>
          </div>
        </div>
      </div>
      <div class="grid" style="gap:10px">
        ${[...DIRECT, ...SHARE_ONLY].map(p => {
          const m = postMode(p);
          return `
          <div class="target ${targets[p] && m !== 'off' ? '' : 'off'}" data-target="${p}">
            <label class="check"><input type="checkbox" data-tcheck="${p}" data-mode="${m}" ${targets[p] && m !== 'off' ? 'checked' : ''} ${m === 'off' ? 'disabled' : ''}> ${icon(p, 20)} ${PLATFORMS[p].label}
              ${m !== 'direct' && !SHARE_ONLY.includes(p) ? '<a href="#" data-go="settings" class="small" style="margin-left:auto">Connect</a>' : ''}</label>
            <div class="how">${how[p][m] || ''}</div>
            ${p === 'youtube' && m === 'direct' ? `<div class="extra">
              <label class="field">Visibility<select id="yt-privacy"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
              <label class="check"><input type="checkbox" id="yt-kids"> Made for kids</label>
              <div><div style="font-weight:700;font-size:13px;color:var(--ink-2);margin-bottom:6px">Thumbnail</div><div id="yt-thumb"></div>
              <div class="how" style="margin-top:6px">Custom thumbnails need a verified YouTube channel (youtube.com/verify).</div></div>
            </div>` : ''}
            ${p === 'tiktok' && m === 'direct' ? `<div class="extra" id="tt-extra">${tiktokOptionsHtml()}</div>` : ''}
          </div>`;
        }).join('')}
        <button class="btn primary" id="go" style="padding:14px">Post</button>
        <div class="card" id="results" hidden></div>
      </div>
    </div>`;

  const file = $('#file', main);
  file.onchange = () => { draftFile = file.files[0] || null; thumbFile = null; thumbFrameSec = null; saveDraft(); viewPost(main); };
  const clear = $('#clear-file', main); if (clear) clear.onclick = e => { e.preventDefault(); draftFile = null; thumbFile = null; thumbFrameSec = null; viewPost(main); };
  ['title', 'caption', 'tags'].forEach(id => $('#' + id, main).oninput = saveDraft);
  $('#add-hashtags', main).onchange = saveDraft;
  $$('[data-tcheck]', main).forEach(c => c.onchange = () => {
    const t = store.get('targets', {}); t[c.dataset.tcheck] = c.checked; store.set('targets', t);
    c.closest('.target').classList.toggle('off', !c.checked);
  });
  let when = 'now';
  $$('[data-when]', main).forEach(b => b.onclick = () => {
    when = b.dataset.when;
    $$('[data-when]', main).forEach(x => x.classList.toggle('on', x === b));
    $('#when-later', main).hidden = when !== 'later';
  });
  const best = $('#use-best', main);
  if (best) best.onclick = () => { $('#when-at', main).value = localInput(new Date(tm.next.date.getTime() - 30 * 60000)); };

  const thumbRoot = $('#yt-thumb', main);
  if (thumbRoot) {
    thumbnailEditor(thumbRoot, {
      videoFile: isVideo ? draftFile : null, title: d.title,
      onChange: (f, info) => { thumbFile = f; thumbFrameSec = info.frameSec ?? null; const n = $('#tt-cover-note', main); if (n) n.hidden = thumbFrameSec == null; },
    });
  }
  if ($('#tt-extra', main)) { if (state.demo) bindTikTokOptions(main); else loadTikTokCreator(main); }
  $('#go', main).onclick = () => publishAll(main, when === 'later' ? $('#when-at', main).value : null);
  bindGo(main);
}

// TikTok requires apps to show who is posting, let the creator pick privacy (no default),
// leave interactions off until switched on, and show the music usage notice.
function tiktokOptionsHtml(info) {
  const privacyNames = { PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' };
  const opts = info?.privacy_level_options || (state.demo ? Object.keys(privacyNames) : []);
  return `
    <div class="small" id="tt-who">${info ? `Posting as <b>${esc(info.creator_nickname || info.creator_username)}</b>` : state.demo ? 'Posting as <b>yourchannel</b>' : 'Checking your TikTok account…'}</div>
    <label class="field">How<select id="tt-mode"><option value="draft">Send to my TikTok drafts (add sounds, then post in the app)</option><option value="direct">Post straight to my profile</option></select></label>
    <div id="tt-direct-opts" hidden style="display:grid;gap:10px">
      <label class="field">Who can watch<select id="tt-privacy"><option value="">Choose…</option>${opts.map(o => `<option value="${o}">${privacyNames[o] || o}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="tt-comments" ${info?.comment_disabled ? 'disabled' : ''}> Allow comments</label>
      <label class="check"><input type="checkbox" id="tt-duet" ${info?.duet_disabled ? 'disabled' : ''}> Allow Duet</label>
      <label class="check"><input type="checkbox" id="tt-stitch" ${info?.stitch_disabled ? 'disabled' : ''}> Allow Stitch</label>
      <div class="how" id="tt-cover-note" ${thumbFrameSec == null ? 'hidden' : ''}>Cover uses the frame you picked for the YouTube thumbnail.</div>
      <div class="consent">By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noopener">Music Usage Confirmation</a>.</div>
    </div>
    ${info?.max_video_post_duration_sec ? `<div class="how">Longest video allowed: ${fmtDur(info.max_video_post_duration_sec)}</div>` : ''}`;
}
function bindTikTokOptions(main) {
  const mode = $('#tt-mode', main); if (!mode) return;
  const sync = () => { $('#tt-direct-opts', main).hidden = mode.value !== 'direct'; store.set('tt-mode', mode.value); };
  mode.value = store.get('tt-mode', 'draft');
  mode.onchange = sync; sync();
}
async function loadTikTokCreator(main) {
  bindTikTokOptions(main);
  try {
    const info = await tiktok.creatorInfo();
    const box = $('#tt-extra', main); if (!box) return;
    box.innerHTML = tiktokOptionsHtml(info); bindTikTokOptions(main);
  } catch (e) {
    const who = $('#tt-who', main); if (who) who.textContent = `Couldn't reach TikTok: ${e.message}`;
  }
}
function preview(f) {
  const url = URL.createObjectURL(f);
  return f.type.startsWith('video/') ? `<video src="${url}" controls playsinline muted></video>` : `<img src="${url}" alt="Selected photo">`;
}
function saveDraft() {
  const v = id => $('#' + id)?.value ?? '';
  store.set('draft', { title: v('title'), caption: v('caption'), tags: v('tags'), addHashtags: $('#add-hashtags')?.checked });
}
const localInput = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

async function publishAll(main, whenStr) {
  const d = store.get('draft', {});
  const checked = $$('[data-tcheck]', main).filter(c => c.checked && !c.disabled);
  const targets = checked.map(c => c.dataset.tcheck);
  const modeOf = Object.fromEntries(checked.map(c => [c.dataset.tcheck, c.dataset.mode]));
  if (!targets.length) return toast('Pick at least one account.');
  if (!draftFile && targets.some(t => t !== 'facebook' && t !== 'x')) return toast('Choose a video or photo first.');
  const publishAt = whenStr ? new Date(whenStr) : null;
  if (publishAt && publishAt < Date.now() + 10 * 60000) return toast('Schedule at least 10 minutes from now.');
  const ttMode = $('#tt-mode', main)?.value || 'draft';
  if (modeOf.tiktok === 'direct' && ttMode === 'direct' && !$('#tt-privacy', main)?.value) return toast('Choose who can watch on TikTok.');
  const tags = (d.tags || '').split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);
  const hashCaption = d.addHashtags !== false && tags.length ? `${d.caption}\n\n${tags.map(t => '#' + t.replace(/\s+/g, '')).join(' ')}` : d.caption;
  const isVideo = draftFile?.type.startsWith('video/');
  const job = {
    file: draftFile, title: d.title || (d.caption || '').split('\n')[0].slice(0, 100), description: d.caption || '', tags,
    privacy: $('#yt-privacy', main)?.value || 'public', madeForKids: $('#yt-kids', main)?.checked, publishAt,
    thumbnail: thumbFile,
    tiktok: {
      mode: ttMode, privacy: $('#tt-privacy', main)?.value, allowComments: $('#tt-comments', main)?.checked,
      allowDuet: $('#tt-duet', main)?.checked, allowStitch: $('#tt-stitch', main)?.checked,
      coverMs: thumbFrameSec != null ? Math.round(thumbFrameSec * 1000) : 0,
    },
  };

  const res = $('#results', main); res.hidden = false;
  res.innerHTML = `<h3>${publishAt ? 'Scheduling' : 'Posting'}…</h3>` + targets.map(t => `<div class="status-row" id="st-${t}">${icon(t, 20)}<div><div style="font-weight:700">${PLATFORMS[t].label} <span class="muted small" data-msg>Waiting…</span></div><div class="prog"><i></i></div></div></div>`).join('');
  $('#go', main).disabled = true;
  const set = (t, msg, frac, html) => {
    const row = $(`#st-${t}`, main); if (!row) return;
    if (msg != null) $('[data-msg]', row).innerHTML = msg;
    if (frac != null) $('.prog i', row).style.width = `${Math.round(frac * 100)}%`;
    if (html != null) { const extra = row.querySelector('.after') || Object.assign(document.createElement('div'), { className: 'after' }); extra.innerHTML = html; row.lastElementChild.appendChild(extra); }
  };

  // Which go through the share sheet / a reminder instead of the API
  const viaShare = t => modeOf[t] === 'share'
    || (t === 'instagram' && (publishAt || !isVideo))
    || (t === 'tiktok' && (publishAt || !isVideo));
  const direct = targets.filter(t => modeOf[t] === 'direct' && !viaShare(t));
  await Promise.all(direct.map(async t => {
    const tjob = { ...job, description: t === 'youtube' ? job.description : hashCaption };
    try {
      set(t, 'Uploading…', 0.02);
      let out;
      if (state.demo) {
        for (let i = 1; i <= 10; i++) { await new Promise(r => setTimeout(r, 160 + Math.random() * 120)); set(t, null, i / 10); }
        out = { url: '#', note: t === 'youtube' && thumbFile ? 'with your thumbnail' : t === 'tiktok' && ttMode === 'draft' ? 'sent to your TikTok drafts' : '' };
      } else out = await PROVIDERS[t].publish(tjob, f => set(t, `Uploading… ${Math.round(f * 100)}%`, f));
      const note = out.note ? ` · ${esc(out.note)}` : '';
      set(t, state.demo ? `✓ Done (sample mode, nothing was posted)${note}` : `✓ ${publishAt ? 'Scheduled' : 'Posted'}${note} · <a href="${esc(out.url)}" target="_blank" rel="noopener">open</a>`, 1);
    } catch (e) {
      set(t, `✗ ${esc(e.message)}`, 0);
      if (t === 'instagram' || t === 'tiktok') set(t, null, null, `<button class="btn small" data-share="${t}">Share to ${PLATFORMS[t].label} instead</button>`);
    }
  }));

  for (const t of targets.filter(viaShare)) {
    const why = modeOf[t] === 'direct' && publishAt ? `${PLATFORMS[t].label} can't be scheduled by apps. ` : modeOf[t] === 'direct' && !isVideo ? 'Photos go through the share sheet. ' : '';
    if (publishAt) set(t, `${why}Reminder for ${publishAt.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`, 1, `<button class="btn small" data-ics="${t}">Add reminder to calendar</button> <button class="btn small" data-share="${t}">Share now instead</button>`);
    else set(t, `${why}Ready. Tap to open the app`, 1, `<button class="btn small primary" data-share="${t}">Share to ${PLATFORMS[t].label}</button>`);
  }
  $$('[data-share]', res).forEach(b => b.onclick = () => shareTo(b.dataset.share, hashCaption));
  $$('[data-ics]', res).forEach(b => b.onclick = () => calendarReminder(b.dataset.ics, publishAt, hashCaption));
  $('#go', main).disabled = false;
  res.querySelector('h3').textContent = 'Results';
}

async function shareTo(platform, caption) {
  try { await navigator.clipboard.writeText(caption || ''); toast('Caption copied. Paste it in ' + PLATFORMS[platform].label); } catch { /* clipboard blocked */ }
  if (draftFile && navigator.canShare?.({ files: [draftFile] })) {
    try { await navigator.share({ files: [draftFile], text: caption, title: PLATFORMS[platform].label }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  // Desktop fallback: open the site's upload page (and download the file so it's easy to pick)
  const urls = { tiktok: 'https://www.tiktok.com/upload', x: `https://x.com/intent/post?text=${encodeURIComponent(caption || '')}`, instagram: 'https://www.instagram.com/' };
  if (draftFile) { const a = document.createElement('a'); a.href = URL.createObjectURL(draftFile); a.download = draftFile.name; a.click(); }
  window.open(urls[platform], '_blank', 'noopener');
}

function calendarReminder(platform, at, caption) {
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Creator Hub//EN', 'BEGIN:VEVENT',
    `UID:${Date.now()}-${platform}@creator-hub`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(at)}`, `DTEND:${stamp(new Date(at.getTime() + 15 * 60000))}`,
    `SUMMARY:Post on ${PLATFORMS[platform].label}`, `DESCRIPTION:${(caption || '').replace(/\n/g, '\\n').slice(0, 900)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT5M', 'ACTION:DISPLAY', `DESCRIPTION:Post on ${PLATFORMS[platform].label}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `post-on-${platform}.ics`; a.click();
}

// ---------------- Accounts / settings ----------------
function viewSettings(main) {
  const s = settings();
  const origin = location.origin;
  const row = (p, status, extra = '') => `<div class="status-row">${icon(p, 22)}<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap">
      <div><b>${PLATFORMS[p].label}</b> <span class="muted small">${status}</span></div><div class="btn-row">${extra}</div></div></div>`;
  const who = p => { const a = state.data[p]?.account; return a && !state.demo ? `Connected as ${esc(a.name)}` : 'Connected'; };
  const btnConn = (p, label = 'Connect') => `<button class="btn small primary" data-conn="${p}">${label}</button>`;
  const btnDisc = p => `<button class="btn small" data-disc="${p}">Disconnect</button>`;
  const igVia = instagram.via();
  const pages = meta.pages();
  const step = (n, title, open, body) => `<div class="card"><details ${open ? 'open' : ''}><summary style="font-size:15px;color:var(--ink)">Step ${n} · ${title}</summary>${body}</details></div>`;

  main.innerHTML = `
    <h2>Accounts</h2>
    <p class="sub">Your logins stay on this device. TikTok and Instagram sign-in go through your own free helper (step 3), so nobody else ever sees them.</p>
    <div class="grid g2" style="align-items:start">
      <div class="grid" style="gap:14px">
        <div class="card">
          <h3>Connected accounts</h3>
          ${row('youtube', youtube.isConnected() ? who('youtube') : 'Not connected', youtube.isConnected() ? btnDisc('youtube') : btnConn('youtube'))}
          ${row('tiktok', tiktok.isConnected() ? who('tiktok') : 'Not connected', tiktok.isConnected() ? btnDisc('tiktok') : btnConn('tiktok'))}
          ${row('instagram',
            igVia === 'instagram' ? `${who('instagram')} (Instagram login)` : igVia === 'facebook' ? `${who('instagram')} (through Facebook)` : meta.isConnected() ? 'No Instagram linked to your Facebook Page' : 'Not connected',
            igVia === 'instagram' ? btnDisc('instagram') : btnConn('instagram', igVia === 'facebook' ? 'Use Instagram login' : 'Connect'))}
          ${row('facebook', meta.isConnected() ? who('facebook') : 'Not connected', meta.isConnected() ? btnDisc('facebook') : btnConn('facebook'))}
          ${pages.length > 1 ? `<label class="field" style="margin-top:10px">Facebook Page to use<select id="page-pick">${pages.map(p => `<option value="${esc(p.id)}" ${s.metaPageId === p.id ? 'selected' : ''}>${esc(p.name)}${p.ig ? ` (+ @${esc(p.ig.username)})` : ''}</option>`).join('')}</select></label>` : ''}
          ${row('x', 'Share button', '')}
          <p class="muted small">Instagram works two ways: <b>Instagram login</b> (no Facebook Page needed) or through the Facebook Page it's linked to. X only lets paid apps with their own server post, so it gets a one-tap share with your video and caption ready.</p>
        </div>

        <div class="card">
          <h3>Your niche</h3>
          <p class="muted small" style="margin-top:0">Used by "When to post" to watch what's working for other creators. Needs YouTube connected.</p>
          <label class="field">Keywords people search for your kind of video (up to 3, comma separated)<input type="text" id="keywords" value="${esc(s.keywords || '')}" placeholder="minecraft survival, horror games, speedrun"></label>
          <label class="field" style="margin-top:10px">Creators like you (YouTube handles, comma separated)<textarea id="competitors" style="min-height:70px" placeholder="@creatorone, @creatortwo">${esc(s.competitors || '')}</textarea></label>
          <button class="btn small primary" id="save-niche" style="margin-top:10px">Save & update</button>
        </div>

        <div class="card">
          <h3>Display</h3>
          <label class="field">Theme<select id="theme"><option value="auto">Match my phone</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label class="check" style="margin-top:12px"><input type="checkbox" id="force-demo" ${s.forceDemo ? 'checked' : ''}> Show sample data even when accounts are connected</label>
        </div>
      </div>

      <div class="grid" style="gap:14px">
        <div class="card">
          <h3>Your keys</h3>
          <label class="field">Google Client ID (step 1)<input type="text" id="gid" value="${esc(s.googleClientId || '')}" placeholder="1234-abc.apps.googleusercontent.com"></label>
          <label class="field" style="margin-top:10px">Meta App ID (step 2, for Facebook)<input type="text" id="mid" value="${esc(s.metaAppId || '')}" placeholder="123456789012345"></label>
          <label class="field" style="margin-top:10px">Helper address (step 3, for TikTok and Instagram login)<input type="url" id="hurl" value="${esc(s.helperUrl || '')}" placeholder="https://creator-hub-helper.yourname.workers.dev"></label>
          <div class="btn-row" style="margin-top:12px"><button class="btn primary" id="save-keys">Save</button><button class="btn" id="test-helper">Test helper</button></div>
          <p class="muted small" style="margin-bottom:0">Sign-in return address for TikTok and Instagram: <code>${esc(redirectUri())}</code></p>
        </div>

        ${step(1, 'YouTube (free, about 10 minutes)', !s.googleClientId, `
          <ol class="steps">
            <li>Go to <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com</a> and create a project (any name).</li>
            <li>In <b>APIs &amp; Services → Library</b>, turn on <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>.</li>
            <li>In <b>Google Auth Platform</b> (OAuth consent screen): choose <b>External</b>, fill in the app name and your email. Under <b>Audience → Test users</b>, add the Google account that owns your channel.</li>
            <li>In <b>Clients</b> → <b>Create client</b> → type <b>Web application</b>. Under <b>Authorized JavaScript origins</b> add <code>${esc(origin)}</code>.</li>
            <li>Copy the <b>Client ID</b> into "Your keys" and tap Connect on YouTube.</li>
          </ol>
          <p class="muted small">Google will warn the app "hasn't been verified". That's normal for your own personal app: tap Continue. For custom thumbnails, verify your channel once at <a href="https://www.youtube.com/verify" target="_blank" rel="noopener">youtube.com/verify</a>.</p>`)}

        ${step(2, 'Facebook (free, about 15 minutes)', !s.metaAppId, `
          <ol class="steps">
            <li>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → <b>Create app</b> → pick <b>Other</b> → type <b>Business</b>.</li>
            <li>Add the product <b>Facebook Login for Business</b>.</li>
            <li>In <b>App settings → Basic</b>, add platform <b>Website</b> with site URL <code>${esc(redirectUri())}</code>, and put <code>${esc(location.hostname)}</code> in <b>App domains</b>.</li>
            <li>In <b>Facebook Login → Settings</b>, turn on <b>Login with the JavaScript SDK</b> and add <code>${esc(origin)}</code> to <b>Allowed domains for the JavaScript SDK</b>.</li>
            <li>Copy the <b>App ID</b> into "Your keys" and tap Connect on Facebook. Allow every permission.</li>
          </ol>
          <p class="muted small">Leave the app in Development mode. As the owner you can use it on your own accounts without Meta's review. If your Instagram is linked to this Page, it connects at the same time.</p>`)}

        ${step(3, 'Your helper (free Cloudflare Worker, about 10 minutes)', !s.helperUrl, `
          <p class="muted small">TikTok and Instagram login need a secret key that can't live in a web page. This tiny helper keeps it for you. It's free and you own it.</p>
          <ol class="steps">
            <li>Make a free account at <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">dash.cloudflare.com</a>.</li>
            <li>Go to <b>Workers &amp; Pages → Create → Create Worker</b> ("Start with Hello World"), name it <code>creator-hub-helper</code>, tap <b>Deploy</b>.</li>
            <li>Tap <b>Edit code</b>, delete everything, paste the helper code, and tap <b>Deploy</b>. <button class="btn small" id="copy-worker">Copy helper code</button></li>
            <li>Open the worker's <b>Settings → Variables and Secrets</b> and add <code>ALLOWED_ORIGIN</code> = <code>${esc(origin)}</code>. You'll add the TikTok and Instagram keys in step 4.</li>
            <li>Copy the worker's address (it ends in <code>.workers.dev</code>) into "Your keys" and tap <b>Test helper</b>.</li>
          </ol>`)}

        ${step(4, 'TikTok and Instagram login apps', !!s.helperUrl && !tiktok.isConnected(), `
          <h3 style="margin-top:10px">TikTok</h3>
          <ol class="steps">
            <li>At <a href="https://developers.tiktok.com/apps" target="_blank" rel="noopener">developers.tiktok.com</a>, sign in and <b>Connect an app</b>. Fill in the name, icon and category. For the links, use Terms <code>${esc(redirectUri())}terms.html</code> and Privacy <code>${esc(redirectUri())}privacy.html</code>. Pick platform <b>Web</b>, with website <code>${esc(redirectUri())}</code>.</li>
            <li>Add products <b>Login Kit</b> (redirect URI: <code>${esc(redirectUri())}</code>) and <b>Content Posting API</b> (turn on <b>Direct Post</b>).</li>
            <li>Add scopes: <code>user.info.basic</code>, <code>user.info.profile</code>, <code>user.info.stats</code>, <code>video.list</code>, <code>video.upload</code>, <code>video.publish</code>.</li>
            <li>Switch to <b>Sandbox</b> at the top, create one, and add your TikTok account under <b>Target users</b>. That lets you use it right away without TikTok's review.</li>
            <li>Copy the <b>Client key</b> and <b>Client secret</b> into the worker's Variables and Secrets as <code>TIKTOK_CLIENT_KEY</code> and <code>TIKTOK_CLIENT_SECRET</code> (make the secret type <b>Secret</b>). Then tap Connect on TikTok.</li>
          </ol>
          <p class="muted small">Until TikTok reviews your app, direct posts can only be "Only me". "Send to my TikTok drafts" works fully: the video lands in your TikTok inbox and you add sounds and post from the app. If TikTok asks you to verify the website, send me the file it gives you and I'll add it.</p>
          <h3 style="margin-top:14px">Instagram login</h3>
          <ol class="steps">
            <li>Your Instagram must be a <b>Professional</b> account (Creator or Business). Instagram app → Settings → Account type and tools.</li>
            <li>In your Meta app (the same one as step 2 is fine), add the <b>Instagram</b> product and open <b>API setup with Instagram login</b>.</li>
            <li>Under <b>Set up Instagram business login → Business login settings</b>, add the redirect URL <code>${esc(redirectUri())}</code>.</li>
            <li>In <b>App roles → Roles</b>, add your Instagram account as an <b>Instagram Tester</b>, then accept the invite in Instagram (Settings → Website permissions → Apps and websites).</li>
            <li>Copy the <b>Instagram app ID</b> and <b>Instagram app secret</b> into the worker as <code>IG_APP_ID</code> and <code>IG_APP_SECRET</code> (secret type <b>Secret</b>). Then tap Connect on Instagram.</li>
          </ol>`)}
      </div>
    </div>`;

  const keys = () => ({ googleClientId: $('#gid').value.trim(), metaAppId: $('#mid').value.trim(), helperUrl: $('#hurl').value.trim() });
  $('#theme', main).value = s.theme || 'auto';
  $('#theme', main).onchange = e => { saveSettings({ theme: e.target.value }); applyTheme(); };
  $('#force-demo', main).onchange = e => { saveSettings({ forceDemo: e.target.checked }); loadAll(); };
  $('#save-keys', main).onclick = () => { saveSettings(keys()); toast('Saved'); };
  $('#test-helper', main).onclick = async () => {
    saveSettings(keys());
    try {
      const r = await fetch(keys().helperUrl.replace(/\/+$/, '') + '/config');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `Error ${r.status}`);
      const has = [j.tiktokClientKey && 'TikTok', j.igAppId && 'Instagram'].filter(Boolean);
      toast(`Helper works. ${has.length ? 'Ready for ' + has.join(' and ') : 'No TikTok or Instagram keys yet (step 4)'}.`, 6000);
    } catch (e) { toast(`Helper didn't answer: ${e.message === 'Failed to fetch' ? `check the address, and that ALLOWED_ORIGIN is ${origin}` : e.message}`, 7000); }
  };
  $('#copy-worker', main).onclick = async () => {
    try { const code = await (await fetch('worker/worker.js')).text(); await navigator.clipboard.writeText(code); toast('Helper code copied. Paste it in Cloudflare.'); }
    catch { window.open('worker/worker.js', '_blank'); }
  };
  $('#save-niche', main).onclick = async () => {
    saveSettings({ keywords: $('#keywords').value, competitors: $('#competitors').value });
    toast('Saved. Updating niche data…');
    await refreshNiche(true); toast(state.niche && !state.demo ? `Found ${state.niche.list.length} videos from others` : 'Saved');
  };
  const pp = $('#page-pick', main); if (pp) pp.onchange = () => { saveSettings({ metaPageId: pp.value }); loadAll(); };
  $$('[data-conn]', main).forEach(b => b.onclick = async () => {
    saveSettings(keys());
    b.disabled = true; b.textContent = 'Connecting…';
    try { await PROVIDERS[b.dataset.conn].connect(); toast(`${PLATFORMS[b.dataset.conn].label} connected`); await loadAll(); }
    catch (e) { toast(e.message, 7000); }
    if (state.tab === 'settings') render();
  });
  $$('[data-disc]', main).forEach(b => b.onclick = () => { PROVIDERS[b.dataset.disc].disconnect(); toast('Disconnected'); loadAll(); });
}

// TikTok / Instagram send you back here with ?code=… after signing in
async function finishOAuthReturn() {
  const r = takeOAuthReturn();
  if (!r) return;
  state.tab = 'settings'; store.set('tab', 'settings');
  if (r.error) { toast(r.error, 7000); return; }
  const p = r.kind === 'tt' ? tiktok : r.kind === 'ig' ? instagram : null;
  if (!p) return;
  try { await p.finishConnect(r.code); toast(`${p === tiktok ? 'TikTok' : 'Instagram'} connected`); }
  catch (e) { toast(e.message, 8000); }
}

// ---------------- boot ----------------
applyTheme();
$$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
$('#refresh').onclick = () => loadAll();
document.addEventListener('visibilitychange', () => {
  // coming back to the app after a while: refresh so counts and the niche model stay current
  if (document.visibilityState === 'visible' && Date.now() - (loadAll._last || 0) > 10 * 60000) { loadAll._last = Date.now(); loadAll(); }
});
loadAll._last = Date.now();
finishOAuthReturn().finally(() => loadAll());
