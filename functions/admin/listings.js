export async function onRequest(context) {
  try {
    const ADM_SECRET   = context.env.ADM_SECRET;
    const SUPABASE_URL = context.env.SUPABASE_URL;
    const SERVICE_KEY  = context.env.SUPABASE_SERVICE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !ADM_SECRET) {
      return json({ error: 'Server misconfigured: missing env vars (SUPABASE_URL / SUPABASE_SERVICE_KEY / ADM_SECRET)' }, 500);
    }

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

    /* ── GET: load listings — enriched with seller info, optional search/filter (§11) ── */
    if (method === 'GET') {
      const qp = new URL(context.request.url).searchParams;
      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/admin_get_listings_enriched`,
        {
          method: 'POST',
          headers: { ...sbHeaders, Prefer: 'return=representation' },
          body: JSON.stringify({
            p_search:   qp.get('search')   || null,
            p_status:   qp.get('status')   || null,
            p_category: qp.get('category') || null,
            p_region:   qp.get('region')   || null,
          }),
        }
      );
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    /* ── PATCH: approve / reject ── */
    if (method === 'PATCH') {
      let body;
      try { body = await context.request.json(); }
      catch { return json({ error: 'Invalid JSON body' }, 400); }

      const { id, ...updates } = body;
      if (!id) return json({ error: 'Missing listing id' }, 400);

      const res  = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
        { method: 'PATCH', headers: sbHeaders, body: JSON.stringify(updates) }
      );
      const text = await res.text();

      if (!res.ok) {
        /* أرجع نص الخطأ من Supabase كـ JSON واضح */
        let errMsg;
        try { errMsg = JSON.parse(text); }
        catch { errMsg = { error: text }; }
        return json(errMsg, res.status);
      }

      // PostgREST returns 204 No Content here (Prefer: return=minimal) — nothing to forward,
      // and pairing a body with a 204 status violates the Response spec. Just ack success.
      return json({ ok: true }, 200);
    }

    /* ── DELETE: hard-delete listing + R2 images ── */
    if (method === 'DELETE') {
      let body;
      try { body = await context.request.json(); }
      catch { return json({ error: 'Invalid JSON body' }, 400); }

      const { id } = body;
      if (!id) return json({ error: 'Missing listing id' }, 400);

      /* جلب بيانات الصور قبل الحذف */
      const getRes = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=cover_image,images`,
        { headers: sbHeaders }
      );
      let listing = null;
      try {
        const arr = await getRes.json();
        listing = arr && arr[0];
      } catch {}

      /* حذف الصور من R2 */
      const bucket = context.env.BUCKET || context.env['BUCKET-1'];
      if (bucket && listing) {
        const R2_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/';
        const allUrls = [listing.cover_image, ...(listing.images || [])].filter(Boolean);
        for (const url of allUrls) {
          if (typeof url === 'string' && url.startsWith(R2_BASE)) {
            const path = url.slice(R2_BASE.length);
            try { await bucket.delete(path); } catch {}
            if (path.endsWith('_f.webp')) {
              try { await bucket.delete(path.replace('_f.webp', '_c.webp')); } catch {}
              try { await bucket.delete(path.replace('_f.webp', '_d.webp')); } catch {}
            }
          }
        }
      }

      /* حذف السجل من Supabase */
      const delRes = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: sbHeaders }
      );
      if (!delRes.ok) {
        const errText = await delRes.text();
        let errMsg;
        try { errMsg = JSON.parse(errText); } catch { errMsg = { error: errText }; }
        return json(errMsg, delRes.status);
      }

      return json({ ok: true }, 200);
    }

    return json({ error: 'Method not allowed' }, 405);

  } catch (e) {
    /* أي خطأ غير متوقع — يرجع JSON بدل HTML */
    return json({ error: e.message || 'Internal server error' }, 500);
  }
}

/* ── Token Validation ── */
async function validateToken(token, secret) {
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
