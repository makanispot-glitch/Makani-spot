export async function onRequest(context) {
  const ADM_SECRET    = context.env.ADM_SECRET;
  const SUPABASE_URL  = context.env.SUPABASE_URL;
  const SERVICE_KEY   = context.env.SUPABASE_SERVICE_KEY;

  const auth  = context.request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!await validateToken(token, ADM_SECRET)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey':        SERVICE_KEY,
    'Prefer':        'return=minimal',
  };

  const method = context.request.method;

  if (method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?status=neq.deleted&order=created_at.desc&select=*`,
      { headers: sbHeaders }
    );
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (method === 'PATCH') {
    const { id, ...updates } = await context.request.json();
    if (!id) return json({ error: 'Missing id' }, 400);

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
      { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(updates) }
    );
    const data = await res.text();
    return new Response(data || '{}', {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
}

async function validateToken(token, secret) {
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const payload = token.slice(0, dot);
    const hmac    = token.slice(dot + 1);
    const { exp } = JSON.parse(atob(payload));
    if (!exp || Date.now() > exp) return false;
    const expected = await sign(payload, secret);
    return hmac === expected;
  } catch {
    return false;
  }
}

async function sign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
