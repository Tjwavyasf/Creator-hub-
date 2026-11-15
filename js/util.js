// Shared helpers: formatting, storage, platform identity, small DOM helpers.

export const PLATFORMS = {
  youtube:   { label: 'YouTube',   color: 'var(--youtube)',   follower: 'subscribers' },
  instagram: { label: 'Instagram', color: 'var(--instagram)', follower: 'followers' },
  facebook:  { label: 'Facebook',  color: 'var(--facebook)',  follower: 'followers' },
  tiktok:    { label: 'TikTok',    color: 'var(--tiktok)',     follower: 'followers' },
  x:         { label: 'X',         color: 'var(--ink-2)',     follower: 'followers' },
};

const ICONS = {
  youtube: '<rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor"/><path d="M10 9l5 3-5 3z" fill="var(--surface)"/>',
  instagram: '<rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.3" fill="currentColor"/>',
  facebook: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M13.2 19v-6h2l.3-2.4h-2.3V9.2c0-.7.2-1.2 1.2-1.2h1.2V5.9a16 16 0 0 0-1.8-.1c-1.8 0-3 1.1-3 3.1v1.7h-2V13h2v6z" fill="var(--surface)"/>',
  tiktok: '<path d="M14 3v11.5a3.5 3.5 0 1 1-3-3.46V8.1A6.5 6.5 0 1 0 17 14.5V8.8a7 7 0 0 0 4 1.2V7a4 4 0 0 1-4-4z" fill="currentColor"/>',
  x: '<path d="M4 4h4.5l4 5.6L17.3 4H20l-6.2 7.2L20.5 20H16l-4.3-6-5.2 6H4l6.6-7.6z" fill="currentColor"/>',
};

export function icon(platform, size = 18) {
  const p = PLATFORMS[platform];
  return `<svg class="plat-ico" viewBox="0 0 24 24" width="${size}" height="${size}" style="color:${p.color}" aria-hidden="true">${ICONS[platform]}</svg>`;
}
export function platTag(platform) {
  return `<span class="plat">${icon(platform, 16)}${PLATFORMS[platform].label}</span>`;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtNum(n) {
  if (n == null || Number.isNaN(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString();
}
export const fmtFull = n => (n == null ? '—' : Math.round(n).toLocaleString());
export const fmtPct = (n, d = 0) => (n == null ? '—' : `${(n * 100).toFixed(d)}%`);

export function fmtDur(sec) {
  if (sec == null) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function ago(date) {
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export const fmtDate = d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function fmtHour(h) {
  const d = new Date(2000, 0, 1, h);
  return d.toLocaleTimeString(undefined, { hour: 'numeric' });
}
export const isoDay = d => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export function median(arr) {
  const a = arr.filter(v => v != null && !Number.isNaN(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// localStorage that never throws (private windows, blocked storage)
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem('ch:' + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem('ch:' + key, JSON.stringify(value)); } catch { /* ignore */ } },
  del(key) { try { localStorage.removeItem('ch:' + key); } catch { /* ignore */ } },
};

export function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${new URL(src).host}. Check your connection or ad blocker.`));
    document.head.appendChild(s);
  });
}

// Run async jobs with a concurrency limit; failures resolve to null.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// XHR upload with progress (fetch has no upload progress)
export function xhrSend({ method, url, headers = {}, body, onProgress, responseType = 'json' }) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    x.responseType = responseType;
    if (onProgress) x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => {
      if (x.status >= 200 && x.status < 300) resolve(x.response);
      else {
        const r = x.response;
        const msg = r?.error?.message || r?.error?.error_user_msg || r?.debug_info?.message || `HTTP ${x.status}`;
        reject(new Error(msg));
      }
    };
    x.onerror = () => reject(new Error('Network error (the upload was blocked or the connection dropped)'));
    x.send(body);
  });
}
