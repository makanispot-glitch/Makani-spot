export async function onRequestPost(context) {
  try {
    const { password } = await context.request.json();
    const ADM_PASSWORD = context.env.ADM_PASSWORD;
    const ADM_SECRET   = context.env.ADM_SECRET;

    if (!ADM_PASSWORD || !ADM_SECRET || password !== ADM_PASSWORD) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const exp     = Date.now() + 8 * 60 * 60 * 1000; // 8 hours
    const payload = btoa(JSON.stringify({ exp }));
    const hmac    = await sign(payload, ADM_SECRET);
    const token   = `${payload}.${hmac}`;

    return json({ token }, 200);
  } catch {
    return json({ error: 'Bad request' }, 400);
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
