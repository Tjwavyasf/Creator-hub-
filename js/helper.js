// Talks to your Creator Hub helper (a free Cloudflare Worker, see creator-hub-worker/).
// It keeps the TikTok / Instagram app secrets and relays requests browsers can't make directly.
import { store, xhrSend } from './util.js';

export const helperUrl = () => (store.get('settings', {}).helperUrl || '').trim().replace(/\/+$/, '');
export const redirectUri = () => location.origin + location.pathname;

export async function helper(path, body) {
  const base = helperUrl();
  if (!base) throw new Error('Add your helper address first (Accounts tab, step 3).');
  let res;
  try {
    res = await fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  } catch {
    throw new Error("Couldn't reach your helper. Check the address, and that ALLOWED_ORIGIN is set to " + location.origin);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message || j.error_description || j.message || `Helper error ${res.status}`);
  return j;
}

let configCache = null;
export async function helperConfig() {
  if (!configCache) configCache = await helper('/config');
  return configCache;
}

const relayed = url => `${helperUrl()}/relay?url=${encodeURIComponent(url)}`;

/** fetch through the helper (TikTok has no browser access at all). */
export function relayFetch(url, init = {}) {
  if (!helperUrl()) throw new Error('Add your helper address first (Accounts tab, step 3).');
  return fetch(relayed(url), init);
}

/** Try the platform directly; if the browser blocks it, go through the helper. */
export async function directOrRelay(url, init = {}) {
  try { return await fetch(url, init); }
  catch (e) { if (!helperUrl()) throw e; return fetch(relayed(url), init); }
}

/** Upload with progress, directly first, then through the helper if the browser blocks it. */
export async function uploadDirectOrRelay(opts) {
  try { return await xhrSend(opts); }
  catch (e) {
    if (!/Network error/.test(e.message) || !helperUrl()) throw e;
    return xhrSend({ ...opts, url: relayed(opts.url) });
  }
}

// ---- sign-in round trip (TikTok / Instagram send you back to this page with ?code=) ----
export function startOAuth(kind, authUrl) {
  const state = `${kind}:${crypto.getRandomValues(new Uint32Array(2)).join('')}`;
  store.set('oauth-state', state);
  location.href = authUrl(state);
}
/** Returns { kind, code } if this page load is a sign-in return, after checking state. */
export function takeOAuthReturn() {
  const q = new URLSearchParams(location.search);
  const code = q.get('code'), state = q.get('state'), err = q.get('error_description') || q.get('error');
  if (!code && !err) return null;
  const expected = store.get('oauth-state');
  store.del('oauth-state');
  history.replaceState(null, '', location.pathname);
  if (err) return { error: err };
  if (!state || state !== expected) return { error: 'Sign-in check failed. Please try connecting again.' };
  return { kind: state.split(':')[0], code };
}
