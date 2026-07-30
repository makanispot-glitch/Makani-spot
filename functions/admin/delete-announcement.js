/**
 * Cloudflare Pages Function — DELETE /admin/delete-announcement
 * حذف إعلان رسمي من Supabase + صوره من R2
 * مصادقة: جلسة Supabase Auth الحقيقية للأدمن، تُتحقّق عبر is_admin() —
 * نفس الآلية المستخدمة في كل admin RPCs الأخرى بصفحة spaces-hub (sbRpc/sbHeaders).
 * (لم يعد هناك سرّ ثابت مُخزَّن في الكود — الفحص يتم فعلياً على هوية المستخدم.)
 */

const R2_PUBLIC_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return fail(503, 'Server misconfigured');

  const accessToken = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return fail(401, 'غير مصرّح');

  /* تحقّق الصلاحية عبر is_admin() بجلسة المستخدم نفسه — يطابق منطق كل RPCs الأدمن الأخرى */
  const adminCheck = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method:  'POST',
    headers: {
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type':  'application/json',
    },
    body: '{}',
  });
  let isAdmin = false;
  try { isAdmin = (await adminCheck.json()) === true; } catch {}
  if (!adminCheck.ok || !isAdmin) return fail(401, 'غير مصرّح');

  let body;
  try { body = await request.json(); }
  catch { return fail(400, 'Invalid JSON'); }

  const { id } = body;
  if (!id) return fail(400, 'id مطلوب');

  const sbHeaders = {
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };

  /* جلب بيانات الإعلان (image_url + image_urls) */
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/official_announcements?id=eq.${encodeURIComponent(id)}&select=image_url,image_urls`,
    { headers: sbHeaders }
  );
  let ann = null;
  try { const arr = await getRes.json(); ann = arr?.[0]; } catch {}
  if (!ann) return fail(404, 'الإعلان غير موجود');

  /* حذف الصور من R2 */
  const bucket = env.BUCKET || env['BUCKET-1'];
  if (bucket) {
    const urls = [
      ann.image_url,
      ...(Array.isArray(ann.image_urls) ? ann.image_urls : []),
    ].filter(Boolean);

    const unique = [...new Set(urls)];
    for (const url of unique) {
      if (typeof url === 'string' && url.startsWith(R2_PUBLIC_BASE)) {
        const path = url.slice(R2_PUBLIC_BASE.length);
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
    `${SUPABASE_URL}/rest/v1/official_announcements?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
  );
  if (!delRes.ok) return fail(500, 'فشل حذف الإعلان من قاعدة البيانات');

  return ok({ ok: true });
}

function ok(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function fail(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
