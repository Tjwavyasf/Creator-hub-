// Daily snapshots kept on this device, for platforms that only report totals (TikTok).
// Each time the app loads it saves today's numbers; over days this becomes a growth line.
import { store, isoDay } from './util.js';

const KEEP_DAYS = 400;

export const snapshots = {
  record(platform, values) {
    const all = store.get('snap:' + platform, {});
    all[isoDay(Date.now())] = { ...(all[isoDay(Date.now())] || {}), ...values };
    const days = Object.keys(all).sort();
    for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete all[d];
    store.set('snap:' + platform, all);
  },
  series(platform, key) {
    const all = store.get('snap:' + platform, {});
    return Object.keys(all).sort().filter(d => all[d][key] != null).map(d => ({ x: new Date(d + 'T00:00:00'), y: all[d][key] }));
  },
  /** Day-to-day change of a running total (e.g. total views → views per day). */
  dailyDiff(platform, key) {
    const s = snapshots.series(platform, key);
    const out = [];
    for (let i = 1; i < s.length; i++) {
      const gapDays = Math.max(1, Math.round((s[i].x - s[i - 1].x) / 86400000));
      out.push({ x: s[i].x, y: Math.max(0, Math.round((s[i].y - s[i - 1].y) / gapDays)) });
    }
    return out;
  },
};
