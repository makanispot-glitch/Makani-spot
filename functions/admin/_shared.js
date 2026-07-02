/**
 * Shared helpers for functions/admin/*.js — NOT a route itself (Cloudflare Pages
 * ignores files/dirs starting with "_" for routing, but they can still be imported).
 *
 * Auth model: the Bearer token is an HMAC issued by /admin/auth after checking
 * ADM_PASSWORD (env var, never in source). Every admin endpoint validates it here,
 * then talks to Supabase with the SERVICE_ROLE key — which never reaches the client.
 */

export async function sign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function validateToken(token, secret) {
  try {
    const dot     = token.lastIndexOf('.');
    if (dot < 0) return false;
    const payload = token.slice(0, dot);
    const hmac    = token.slice(dot + 1);
    const { exp } = JSON.parse(atob(payload));
    if (!exp || Date.now() > exp) return false;
    const expected = await sign(payload, secret);
    return hmac === expected;
  } catch { return false; }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Validates the request's Bearer token and returns everything a handler needs
 * to talk to Supabase with the service key. Returns { error: Response } instead
 * of throwing so call sites can `const ctx = await requireAdmin(context); if (ctx.error) return ctx.error;`
 */
export async function requireAdmin(context) {
  const ADM_SECRET   = context.env.ADM_SECRET;
  const SUPABASE_URL = context.env.SUPABASE_URL;
  const SERVICE_KEY  = context.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !ADM_SECRET) {
    return { error: json({ error: 'Server misconfigured: missing env vars' }, 500) };
  }

  const auth  = context.request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!await validateToken(token, ADM_SECRET)) {
    return { error: json({ error: 'Unauthorized' }, 401) };
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey':        SERVICE_KEY,
  };

  return { SUPABASE_URL, SERVICE_KEY, sbHeaders, bucket: context.env.BUCKET || context.env['BUCKET-1'] };
}

/** POST to a Postgres RPC using the service key (bypasses RLS; no p_secret needed). */
export async function callRpc(SUPABASE_URL, sbHeaders, fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: { ...sbHeaders, 'Prefer': 'return=representation' },
    body:    JSON.stringify(params),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.hint)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}
