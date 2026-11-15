// Creator Hub helper — a free Cloudflare Worker.
//
// TikTok and Instagram (with Instagram login) need an app *secret* to sign you in, and a secret
// can't live in a web page. This tiny worker keeps it, swaps the sign-in code for a token, and
// relays TikTok/Instagram requests that browsers would otherwise block.
//
// Settings → Variables and Secrets (add whichever platforms you use):
//   ALLOWED_ORIGIN        https://tjwavyasf.github.io       (where Creator Hub is hosted)
//   TIKTOK_CLIENT_KEY     from developers.tiktok.com
//   TIKTOK_CLIENT_SECRET  from developers.tiktok.com        (type: Secret)
//   IG_APP_ID             Instagram app ID from developers.facebook.com
//   IG_APP_SECRET         Instagram app secret              (type: Secret)

const RELAY_HOSTS = new Set([
  'open.tiktokapis.com',
  'open-upload.tiktokapis.com',
  'graph.instagram.com',
  'rupload.facebook.com',
]);
const PASS_HEADERS = ['authorization', 'content-type', 'content-range', 'content-length', 'offset', 'file_size'];

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : allowed[0] || 'null',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Content-Range, Offset, File_Size, X-Upstream',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return json({ error: { message: `This helper only answers ${allowed.join(', ') || '(ALLOWED_ORIGIN not set)'}` } }, 403, cors);

    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case '/config':
          return json({ tiktokClientKey: env.TIKTOK_CLIENT_KEY || null, igAppId: env.IG_APP_ID || null }, 200, cors);

        case '/tiktok/token': {
          need(env, 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET');
          const b = await req.json();
          const form = new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET });
          if (b.refresh_token) { form.set('grant_type', 'refresh_token'); form.set('refresh_token', b.refresh_token); }
          else { form.set('grant_type', 'authorization_code'); form.set('code', b.code); form.set('redirect_uri', b.redirect_uri); }
          const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
          return json(await r.json(), r.status, cors);
        }

        case '/instagram/token': {
          need(env, 'IG_APP_ID', 'IG_APP_SECRET');
          const b = await req.json();
          const form = new URLSearchParams({ client_id: env.IG_APP_ID, client_secret: env.IG_APP_SECRET, grant_type: 'authorization_code', redirect_uri: b.redirect_uri, code: String(b.code).replace(/#_$/, '') });
          const r = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
          const short = await r.json();
          if (!r.ok || !short.access_token) return json({ error: { message: short.error_message || short.error?.message || 'Instagram sign-in failed' } }, 400, cors);
          // swap the 1-hour token for a 60-day one
          const lr = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env.IG_APP_SECRET)}&access_token=${encodeURIComponent(short.access_token)}`);
          const long = await lr.json();
          return json({ access_token: long.access_token || short.access_token, expires_in: long.expires_in || 3600, user_id: String(short.user_id) }, 200, cors);
        }

        case '/relay': {
          const target = new URL(url.searchParams.get('url') || '');
          if (target.protocol !== 'https:' || !RELAY_HOSTS.has(target.hostname)) return json({ error: { message: 'Host not allowed' } }, 400, cors);
          const headers = new Headers();
          for (const h of PASS_HEADERS) { const v = req.headers.get(h); if (v) headers.set(h, v); }
          const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : req.body });
          const out = new Headers(cors);
          out.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
          return new Response(r.body, { status: r.status, headers: out });
        }

        default:
          return json({ ok: true, name: 'Creator Hub helper' }, 200, cors);
      }
    } catch (e) {
      return json({ error: { message: e.message } }, 500, cors);
    }
  },
};

function need(env, ...keys) {
  const missing = keys.filter(k => !env[k]);
  if (missing.length) throw new Error(`Add ${missing.join(' and ')} in the worker's Variables and Secrets`);
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
