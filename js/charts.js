// Hand-drawn SVG charts: line (with crosshair tooltip), sparkline, retention, heatmap.
import { $, esc, fmtNum, DAYS, fmtHour } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const observers = new WeakMap();

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || step0;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(10));
  return ticks;
}

function autoRender(el, draw) {
  draw();
  if (observers.has(el)) observers.get(el).disconnect();
  let w = el.clientWidth;
  const ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 4) { w = el.clientWidth; draw(); } });
  ro.observe(el);
  observers.set(el, ro);
}

export function showTip(html, clientX, clientY) {
  const tip = $('#tip');
  tip.innerHTML = html; tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let x = clientX + 14, y = clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = clientX - r.width - 14;
  if (x < 8) x = 8;
  if (y < 8) y = clientY + 16;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
export const hideTip = () => { $('#tip').hidden = true; };

/**
 * Multi-series line chart, one y-axis.
 * opts: { series:[{name,color,points:[{x:Date,y}]}], height, yFmt, xFmt, tipTitle, directLabels }
 */
export function lineChart(el, opts) {
  el.classList.add('chart');
  autoRender(el, () => drawLine(el, opts));
}

function drawLine(el, { series, height = 220, yFmt = fmtNum, xFmt, tipTitle, directLabels = true, area = false }) {
  const W = Math.max(280, el.clientWidth);
  const labelRoom = directLabels && series.length > 1 ? 74 : 12;
  const m = { t: 10, r: labelRoom, b: 26, l: 44 };
  const H = height, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = series.flatMap(s => s.points);
  if (!all.length) { el.innerHTML = '<div class="empty small">No data yet for this range.</div>'; return; }
  const xs = all.map(p => +p.x), ys = all.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const ticks = niceTicks(Math.min(0, ...ys), Math.max(...ys), 4);
  const y0 = ticks[0], y1 = ticks[ticks.length - 1];
  const X = v => m.l + (x1 === x0 ? iw / 2 : ((+v - x0) / (x1 - x0)) * iw);
  const Y = v => m.t + ih - ((v - y0) / (y1 - y0 || 1)) * ih;
  xFmt = xFmt || (v => new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(series.map(s => s.name).join(', '))} chart">`;
  for (const t of ticks) svg += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
  const nx = Math.max(2, Math.min(6, Math.floor(iw / 90)));
  for (let i = 0; i < nx; i++) {
    const v = x0 + ((x1 - x0) * i) / (nx - 1);
    svg += `<text x="${X(v)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === nx - 1 ? 'end' : 'middle'}">${esc(xFmt(v))}</text>`;
  }
  const labels = [];
  for (const s of series) {
    const pts = [...s.points].sort((a, b) => a.x - b.x);
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    if (area && series.length === 1) svg += `<path d="${d}L${X(pts[pts.length - 1].x)},${Y(y0)}L${X(pts[0].x)},${Y(y0)}Z" fill="${s.color}" opacity=".12"/>`;
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    labels.push({ y: Y(last.y), x: X(last.x), name: s.name, color: s.color });
  }
  if (directLabels && series.length > 1) {
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
    for (const l of labels) svg += `<circle cx="${l.x}" cy="${l.y}" r="0" /><text class="lbl" x="${l.x + 8}" y="${l.y + 4}">${esc(l.name)}</text>`;
  }
  svg += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink-3)" stroke-width="1" visibility="hidden"/>`;
  svg += `<g class="dots"></g><rect x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" class="hit"/></svg>`;
  el.innerHTML = svg;

  // crosshair: snap to nearest x among all series
  const uniq = [...new Set(xs)].sort((a, b) => a - b);
  const svgEl = el.querySelector('svg'), xh = svgEl.querySelector('.xh'), dots = svgEl.querySelector('.dots');
  const move = e => {
    const pt = e.touches ? e.touches[0] : e;
    const r = svgEl.getBoundingClientRect();
    const px = ((pt.clientX - r.left) / r.width) * W;
    const xv = x0 + ((px - m.l) / iw) * (x1 - x0);
    let best = uniq[0];
    for (const u of uniq) if (Math.abs(u - xv) < Math.abs(best - xv)) best = u;
    xh.setAttribute('x1', X(best)); xh.setAttribute('x2', X(best)); xh.setAttribute('visibility', 'visible');
    let rows = '', dd = '';
    for (const s of series) {
      const p = s.points.find(q => +q.x === best);
      if (!p) continue;
      dd += `<circle cx="${X(best)}" cy="${Y(p.y)}" r="4.5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`;
      rows += `<div class="tr"><span><i class="dot" style="background:${s.color}"></i> ${esc(s.name)}</span><b>${esc(yFmt(p.y, true))}</b></div>`;
    }
    dots.innerHTML = dd;
    showTip(`<div class="tt">${esc(tipTitle ? tipTitle(best) : xFmt(best))}</div>${rows}`, pt.clientX, pt.clientY);
  };
  const leave = () => { xh.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; hideTip(); };
  const hit = svgEl.querySelector('.hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  hit.addEventListener('touchend', () => setTimeout(leave, 1500));
}

export function sparkline(el, points, color) {
  if (!points || points.length < 2) { el.innerHTML = ''; return; }
  autoRender(el, () => {
    const W = Math.max(100, el.clientWidth), H = el.clientHeight || 36;
    const ys = points.map(p => p.y);
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const X = i => 2 + (i / (points.length - 1)) * (W - 4);
    const Y = v => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  });
}

/**
 * Audience retention: x = position in video (0..1), y = share still watching.
 * marks: [{t, label, kind:'drop'|'spike'|'half'}]
 */
export function retentionChart(el, { curve, durationSec, marks = [], color = 'var(--accent)', compare }) {
  el.classList.add('chart');
  autoRender(el, () => {
    const W = Math.max(280, el.clientWidth), H = 256;
    const m = { t: 38, r: 14, b: 26, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const yMax = Math.max(1, ...curve.map(p => p.y)) ;
    const ticks = niceTicks(0, yMax, 4);
    const top = ticks[ticks.length - 1];
    const X = t => m.l + t * iw, Y = v => m.t + ih - (v / top) * ih;
    const tfmt = t => { const s = Math.round(t * durationSec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
    let s = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Audience retention chart">`;
    for (const t of ticks) s += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${Math.round(t * 100)}%</text>`;
    for (let i = 0; i <= 4; i++) s += `<text x="${X(i / 4)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${tfmt(i / 4)}</text>`;
    const d = curve.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    s += `<path d="${d}L${X(curve[curve.length - 1].t)},${Y(0)}L${X(curve[0].t)},${Y(0)}Z" fill="${color}" opacity=".12"/>`;
    if (compare) {
      const dc = compare.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      s += `<path d="${dc}" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="4 4"/>`;
    }
    s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    // labels sit in up to two rows above the plot so close marks don't collide
    const rowsEnd = [-Infinity, -Infinity];
    [...marks].sort((a, b) => a.t - b.t).forEach(mk => {
      const x = X(mk.t), col = mk.kind === 'drop' ? 'var(--bad)' : mk.kind === 'spike' ? 'var(--good)' : 'var(--ink-2)';
      const yv = curve.reduce((a, p) => (Math.abs(p.t - mk.t) < Math.abs(a.t - mk.t) ? p : a)).y;
      const wLbl = (mk.short || '').length * 6.4 + 8;
      const lx = Math.min(Math.max(x, m.l + wLbl / 2), W - m.r - wLbl / 2);
      const row = lx - wLbl / 2 > rowsEnd[0] ? 0 : 1;
      rowsEnd[row] = lx + wLbl / 2;
      const ly = row === 0 ? 12 : 26;
      s += `<line x1="${x}" x2="${x}" y1="${ly + 4}" y2="${m.t + ih}" stroke="${col}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      s += `<circle cx="${x}" cy="${Y(yv)}" r="5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`;
      s += `<text class="lbl" x="${lx}" y="${ly}" text-anchor="middle" style="fill:${col}">${esc(mk.short || '')}</text>`;
    });
    s += `<line class="xh" y1="${m.t}" y2="${m.t + ih}" stroke="var(--ink-3)" visibility="hidden"/><circle class="xd" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>`;
    s += `<rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
    el.innerHTML = s;
    const svgEl = el.querySelector('svg'), xh = svgEl.querySelector('.xh'), xd = svgEl.querySelector('.xd');
    const move = e => {
      const r = svgEl.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (((e.clientX - r.left) / r.width) * W - m.l) / iw));
      const p = curve.reduce((a, q) => (Math.abs(q.t - t) < Math.abs(a.t - t) ? q : a));
      xh.setAttribute('x1', X(p.t)); xh.setAttribute('x2', X(p.t)); xh.setAttribute('visibility', 'visible');
      xd.setAttribute('cx', X(p.t)); xd.setAttribute('cy', Y(p.y)); xd.setAttribute('visibility', 'visible');
      const c = compare && compare.reduce((a, q) => (Math.abs(q.t - t) < Math.abs(a.t - t) ? q : a));
      showTip(`<div class="tt">At ${tfmt(p.t)}</div><div class="tr"><span>Still watching</span><b>${Math.round(p.y * 100)}%</b></div>${c ? `<div class="tr"><span>Your typical video</span><b>${Math.round(c.y * 100)}%</b></div>` : ''}`, e.clientX, e.clientY);
    };
    const hit = svgEl.querySelector('.hit');
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { xh.setAttribute('visibility', 'hidden'); xd.setAttribute('visibility', 'hidden'); hideTip(); });
  });
}

/** 7×24 heatmap. grid[dow][hour] = 0..1 or null. tops = [{dow,hour}] outlined. */
export function heatmap(el, grid, { tops = [], tipFor } = {}) {
  const steps = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)'];
  const topSet = new Set(tops.map(t => `${t.dow}-${t.hour}`));
  let h = '<div class="heat" role="grid" aria-label="Best time to post by day and hour"><div></div>';
  for (let hr = 0; hr < 24; hr++) h += `<div class="hl">${hr % 6 === 0 ? fmtHour(hr).replace(/\s/g, '') : ''}</div>`;
  for (let d = 0; d < 7; d++) {
    h += `<div class="rl">${DAYS[d]}</div>`;
    for (let hr = 0; hr < 24; hr++) {
      const v = grid[d][hr];
      const bg = v == null ? 'var(--surface-2)' : steps[Math.min(5, Math.floor(v * 6))];
      h += `<div class="c${topSet.has(`${d}-${hr}`) ? ' pick' : ''}" data-d="${d}" data-h="${hr}" style="background:${bg}"></div>`;
    }
  }
  h += '</div><div class="scale">Worse ' + steps.map(c => `<i style="background:${c}"></i>`).join('') + ' Better · outlined = top picks</div>';
  el.innerHTML = h;
  el.querySelectorAll('.c').forEach(c => {
    const show = e => tipFor && showTip(tipFor(+c.dataset.d, +c.dataset.h), e.clientX, e.clientY);
    c.addEventListener('pointerenter', show);
    c.addEventListener('pointerdown', show);
    c.addEventListener('pointerleave', hideTip);
  });
}
