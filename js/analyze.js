// The thinking part: best/worst video, where viewers drop off, and when to post.
import { median, fmtDur, DAYS_LONG, fmtHour, fmtNum } from './util.js';

const DAY = 86400000;

/** Score each post against that platform's usual post. Adds post.index and post.metric. */
export function scorePosts(posts) {
  const byPlat = {};
  for (const p of posts) (byPlat[p.platform] ||= []).push(p);
  for (const list of Object.values(byPlat)) {
    const useViews = list.filter(p => p.views != null).length >= list.length * 0.6;
    for (const p of list) {
      p.metric = useViews ? (p.views ?? 0) : (p.likes || 0) + 2 * (p.comments || 0) + 3 * (p.shares || 0);
      p.metricName = useViews ? 'views' : 'engagements';
      p.tooNew = Date.now() - new Date(p.publishedAt) < 2 * DAY;
    }
    const base = median(list.filter(p => !p.tooNew).map(p => p.metric)) || median(list.map(p => p.metric)) || 1;
    for (const p of list) p.index = p.metric / Math.max(1, base);
  }
  return posts;
}

/** Best and worst among posts at least 2 days old (so brand-new uploads aren't "worst"). */
export function bestWorst(posts) {
  const pool = posts.filter(p => !p.tooNew && p.index != null);
  if (pool.length < 2) return { best: pool[0] || null, worst: null };
  const sorted = [...pool].sort((a, b) => b.index - a.index);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}

export function explainIndex(p) {
  if (p.index == null) return '';
  if (p.index >= 1.15) return `${p.index.toFixed(1)}× your usual ${p.metricName}`;
  if (p.index <= 0.87) return `${Math.round((1 - p.index) * 100)}% below your usual ${p.metricName}`;
  return `About your usual ${p.metricName}`;
}

/** What makes the best one different from the worst one — plain-language reasons. */
export function compareBestWorst(best, worst) {
  if (!best || !worst) return [];
  const out = [];
  if (best.avgViewPct != null && worst.avgViewPct != null && best.avgViewPct - worst.avgViewPct > 0.08)
    out.push(`People watched ${Math.round(best.avgViewPct * 100)}% of your best video vs ${Math.round(worst.avgViewPct * 100)}% of your worst. Holding attention is what got it pushed.`);
  if (best.durationSec && worst.durationSec) {
    const r = best.durationSec / worst.durationSec;
    if (r < 0.7) out.push(`Your best video is shorter (${fmtDur(best.durationSec)} vs ${fmtDur(worst.durationSec)}).`);
    if (r > 1.4) out.push(`Your best video is longer (${fmtDur(best.durationSec)} vs ${fmtDur(worst.durationSec)}), so your audience will sit through length when it's good.`);
  }
  const hb = new Date(best.publishedAt), hw = new Date(worst.publishedAt);
  if (Math.abs(hb.getHours() - hw.getHours()) >= 4 || hb.getDay() !== hw.getDay())
    out.push(`Best went up ${DAYS_LONG[hb.getDay()]} ${fmtHour(hb.getHours())}; worst went up ${DAYS_LONG[hw.getDay()]} ${fmtHour(hw.getHours())}.`);
  const er = p => ((p.likes || 0) + (p.comments || 0)) / Math.max(1, p.views || p.metric);
  if (best.views && worst.views && er(best) > er(worst) * 1.5)
    out.push(`It also got ${(er(best) / Math.max(er(worst), 1e-6)).toFixed(1)}× more likes and comments per view.`);
  return out;
}

// ---------- retention / drop-off ----------

function smooth(curve) {
  return curve.map((p, i) => {
    const a = curve[Math.max(0, i - 1)].y, b = p.y, c = curve[Math.min(curve.length - 1, i + 1)].y;
    return { t: p.t, y: (a + b + c) / 3 };
  });
}
function at(curve, t) {
  return curve.reduce((a, p) => (Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a)).y;
}

/**
 * curve: [{t:0..1, y: share of viewers still watching}], durationSec.
 * Returns marks for the chart and plain-language findings.
 */
export function analyzeRetention(curve, durationSec) {
  if (!curve?.length) return { marks: [], findings: [] };
  const sc = smooth(curve);
  const start = sc[0].y;
  const ts = t => fmtDur(t * durationSec);
  const findings = [], marks = [];

  // Hook: first 30 seconds (or 15% of a short)
  const hookT = Math.min(0.15, 30 / Math.max(durationSec, 1));
  const hook = at(sc, hookT) / Math.max(start, 1e-6);
  findings.push({
    kind: hook >= 0.7 ? 'good' : hook >= 0.5 ? 'warn' : 'bad',
    title: `${Math.round(hook * 100)}% made it past ${ts(hookT)}`,
    text: hook >= 0.7 ? 'Strong opening. Your first seconds are doing their job.'
      : 'A lot of people leave in the opening. Show the payoff or the most interesting moment sooner, and cut slow intros or logos.',
  });

  // Biggest drop: the short window that loses the most viewers compared with the video's normal
  // rate of decline, ignoring the opening (everyone loses people there) and the end screen.
  const w = Math.max(0.02, 6 / Math.max(durationSec, 1));
  const from = Math.max(0.06, hookT * 1.5), to = 0.92 - w;
  const windows = sc.filter(p => p.t >= from && p.t <= to).map(p => {
    const lost = p.y - at(sc, p.t + w);
    return { t: p.t, lost, rel: lost / Math.max(p.y, 1e-6) };
  });
  const normal = median(windows.map(x => x.rel)) || 0;
  let drop = { t: 0, lost: 0, excess: 0 };
  for (const x of windows) if (x.rel - normal > drop.excess) drop = { ...x, excess: x.rel - normal };
  if (drop.lost > 0.01 && drop.rel > normal * 1.8) {
    marks.push({ t: drop.t, kind: 'drop', short: `Drop ${ts(drop.t)}` });
    findings.push({
      kind: 'bad', t: drop.t,
      title: `Biggest drop-off at ${ts(drop.t)}`,
      text: `${Math.round(drop.rel * 100)}% of the people still watching left within a few seconds of ${ts(drop.t)}. Watch that moment back: is it a slow part, a topic change, or an ad read?`,
    });
  }

  // Rewatched moment
  let spike = { t: 0, gain: 0 };
  for (const p of sc) {
    if (p.t < 0.05 || p.t > 0.95 - w) continue;
    const gain = at(sc, p.t + w) - p.y;
    if (gain > spike.gain) spike = { t: p.t + w / 2, gain };
  }
  if (spike.gain > 0.01) {
    marks.push({ t: spike.t, kind: 'spike', short: `Rewatched ${ts(spike.t)}` });
    findings.push({ kind: 'good', t: spike.t, title: `People rewound to ${ts(spike.t)}`, text: 'Viewers went back to watch this part again. Do more of whatever happens here, and think about using it in your thumbnail or opening.' });
  }

  // Halfway point
  const half = sc.find(p => p.y <= start * 0.5);
  if (half) {
    marks.push({ t: half.t, kind: 'half', short: 'Half gone' });
    findings.push({ kind: 'warn', t: half.t, title: `Half your viewers were gone by ${ts(half.t)}`, text: `That's ${Math.round(half.t * 100)}% of the way through.` });
  } else {
    findings.push({ kind: 'good', title: 'Most viewers stayed past the halfway point', text: 'More than half the audience was still there at the end. That is rare.' });
  }

  const end = at(sc, 0.95);
  findings.push({ kind: 'info', title: `${Math.round(end * 100)}% were still watching at the end`, text: end > 0.3 ? 'Good place for a subscribe ask or the next video.' : 'Move your call-to-action earlier so more people see it.' });
  return { marks, findings };
}

export function averageCurve(curves) {
  const valid = curves.filter(c => c?.length);
  if (valid.length < 2) return null;
  return Array.from({ length: 50 }, (_, i) => {
    const t = (i + 1) / 50;
    return { t, y: valid.reduce((s, c) => s + at(c, t), 0) / valid.length };
  });
}

// ---------- when to post ----------

const KERNEL = [[0, 1], [1, 0.6], [-1, 0.6], [2, 0.25], [-2, 0.25]];

function spread(acc, wts, dow, hour, value, weight = 1) {
  for (const [dh, k] of KERNEL) {
    const h = (hour + dh + 24) % 24;
    const d = (dow + (hour + dh < 0 ? -1 : hour + dh > 23 ? 1 : 0) + 7) % 7;
    acc[d][h] += value * k * weight; wts[d][h] += k * weight;
    // same hour on neighbouring days counts a little — habits repeat across the week
    for (const dd of [-1, 1]) { const d2 = (d + dd + 7) % 7; acc[d2][h] += value * k * 0.25 * weight; wts[d2][h] += k * 0.25 * weight; }
  }
}
const blank = () => Array.from({ length: 7 }, () => new Array(24).fill(0));

function toUnit(acc, wts, minConf = 0.3) {
  // average, then min-max to 0..1; cells with little evidence pull toward neutral 0.5
  const avg = blank(); let lo = Infinity, hi = -Infinity;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    if (wts[d][h] < minConf) { avg[d][h] = null; continue; }
    avg[d][h] = acc[d][h] / wts[d][h];
    lo = Math.min(lo, avg[d][h]); hi = Math.max(hi, avg[d][h]);
  }
  const out = blank();
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const v = avg[d][h];
    if (v == null) { out[d][h] = 0.5; continue; }
    const u = hi > lo ? (v - lo) / (hi - lo) : 0.5;
    const conf = Math.min(1, wts[d][h] / 2);
    out[d][h] = 0.5 + (u - 0.5) * conf;
  }
  return out;
}

function rankPct(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return v => (sorted.length < 2 ? 0.5 : sorted.findIndex(x => x >= v) / (sorted.length - 1));
}

/**
 * own: your posts (scored). niche: [{publishedAt, views, subs}] from other creators.
 * audience: optional 24-length array (when your followers are online, local hours).
 */
export function bestTimes({ own = [], niche = [], audience = null }) {
  const sources = [];

  if (own.length >= 3) {
    const acc = blank(), wts = blank();
    for (const p of own) {
      if (p.tooNew || !p.index) continue;
      const dt = new Date(p.publishedAt);
      spread(acc, wts, dt.getDay(), dt.getHours(), Math.max(-2, Math.min(2, Math.log2(p.index))));
    }
    sources.push({ key: 'own', weight: 0.35, grid: toUnit(acc, wts), n: own.length });
  }

  if (niche.length >= 10) {
    const perf = niche.map(v => Math.log10((v.views + 1) / ((v.subs || 0) + 1000)));
    const pct = rankPct(perf);
    const acc = blank(), wts = blank(), cAcc = blank(), cW = blank();
    niche.forEach((v, i) => {
      const dt = new Date(v.publishedAt);
      spread(acc, wts, dt.getDay(), dt.getHours(), pct(perf[i]) - 0.5);
      spread(cAcc, cW, dt.getDay(), dt.getHours(), 1);
    });
    sources.push({ key: 'niche', weight: 0.4, grid: toUnit(acc, wts), n: niche.length });
    // competition: how crowded each slot is (more uploads = harder to stand out)
    let cmax = 0; for (const r of cW) for (const v of r) cmax = Math.max(cmax, v);
    sources.push({ key: 'crowd', weight: -0.12, grid: cW.map(r => r.map(v => (cmax ? v / cmax : 0))), n: niche.length });
  }

  if (audience?.some(v => v > 0)) {
    const max = Math.max(...audience), min = Math.min(...audience);
    const g = Array.from({ length: 7 }, () => audience.map(v => (max > min ? (v - min) / (max - min) : 0.5)));
    sources.push({ key: 'audience', weight: 0.25, grid: g });
  }

  if (!sources.some(s => s.weight > 0)) return null;

  const pos = sources.filter(s => s.weight > 0), wsum = pos.reduce((a, s) => a + s.weight, 0);
  const raw = blank(); let lo = Infinity, hi = -Infinity;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    let v = pos.reduce((a, s) => a + s.weight * s.grid[d][h], 0) / wsum;
    for (const s of sources.filter(x => x.weight < 0)) v += s.weight * (s.grid[d][h] - 0.5);
    // nobody watches at 3am, whatever the data says: soft night penalty
    if (h >= 1 && h <= 5) v -= 0.15;
    raw[d][h] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const grid = raw.map(r => r.map(v => (hi > lo ? (v - lo) / (hi - lo) : 0.5)));

  const cells = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) cells.push({ dow: d, hour: h, score: grid[d][h] });
  cells.sort((a, b) => b.score - a.score);
  const tops = [];
  for (const c of cells) {
    if (tops.some(t => t.dow === c.dow && Math.abs(t.hour - c.hour) < 3)) continue;
    tops.push(c); if (tops.length === 5) break;
  }

  const next = nextSlot(grid, tops);
  const get = k => sources.find(s => s.key === k);
  const why = (d, h) => {
    const parts = [];
    const o = get('own'), n = get('niche'), a = get('audience'), c = get('crowd');
    if (n) parts.push(n.grid[d][h] > 0.6 ? 'others in your niche do well posting now' : n.grid[d][h] < 0.4 ? 'niche videos posted now tend to underperform' : 'niche results are average now');
    if (o) parts.push(o.grid[d][h] > 0.6 ? 'your own posts at this time beat your average' : o.grid[d][h] < 0.4 ? 'your posts at this time usually do worse' : null);
    if (a) parts.push(a.grid[d][h] > 0.6 ? 'lots of your followers are online' : null);
    if (c) parts.push(c.grid[d][h] > 0.7 ? 'it is a crowded slot (lots of uploads)' : c.grid[d][h] < 0.25 ? 'few others upload now' : null);
    return parts.filter(Boolean);
  };
  return { grid, tops: tops.slice(0, 3), next, why, sources: Object.fromEntries(sources.map(s => [s.key, s.n ?? true])) };
}

/** The soonest upcoming time that is one of the strongest slots of the week. */
export function nextSlot(grid, tops) {
  const threshold = Math.min(...tops.map(t => t.score)) - 0.05;
  const now = new Date();
  const t = new Date(now); t.setMinutes(0, 0, 0); t.setHours(t.getHours() + 1);
  for (let i = 0; i < 24 * 8; i++) {
    const d = t.getDay(), h = t.getHours();
    if (grid[d][h] >= threshold) return { date: new Date(t), score: grid[d][h], dow: d, hour: h };
    t.setHours(t.getHours() + 1);
  }
  return null;
}

export function describeSlot(s) {
  return `${DAYS_LONG[s.dow]} at ${fmtHour(s.hour)}`;
}

export function nicheSummary(niche) {
  if (!niche?.length) return '';
  const views = niche.map(v => v.views);
  return `${niche.length} recent videos from others in your niche · typical ${fmtNum(median(views))} views`;
}
