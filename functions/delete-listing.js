/**
 * Cloudflare Pages Function — /delete-listing
 * حذف إعلان نهائياً من Supabase + صوره من R2
 * يتحقق أن المستخدم هو مالك الإعلان قبل الحذف
 *
 * متطلبات env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY, BUCKET (R2 binding)
 */

const R2_PUBLIC_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestDelete(context) {
  const { request, env } = context;

  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return fail(503, 'Server misconfigured');
  }

  /* التحقق من session token المستخدم */
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return fail(401, 'غير مصرّح — يجب تسجيل الدخول');

  /* التحقق من هوية المستخدم عبر Supabase Auth */
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return fail(401, 'جلسة غير صالحة — سجّل الدخول مجدداً');
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return fail(401, 'تعذر التحقق من هويتك');

  /* قراءة id الإعلان */
  let body;
  try { body = await request.json(); }
  catch { return fail(400, 'بيانات غير صالحة'); }

  const { id } = body;
  if (!id) return fail(400, 'معرّف الإعلان مطلوب');

  const sbHeaders = {
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type':  'application/json',
  };

  /* جلب بيانات الإعلان — التحقق من الملكية + الصور */
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}&select=user_id,cover_image,images`,
    { headers: sbHeaders }
  );
  let listing = null;
  try {
    const arr = await getRes.json();
    listing = arr && arr[0];
  } catch {}

  if (!listing) return fail(404, 'الإعلان غير موجود');
  if (listing.user_id !== userId) return fail(403, 'ليس لديك صلاحية حذف هذا الإعلان');

  /* حذف الصور من R2 */
  const bucket = env.BUCKET || env['BUCKET-1'];
  if (bucket) {
    const allUrls = [listing.cover_image, ...(listing.images || [])].filter(Boolean);
    for (const url of allUrls) {
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
    `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(id)}`,
    { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
  );
  if (!delRes.ok) {
    const errText = await delRes.text();
    return fail(500, 'فشل حذف الإعلان من قاعدة البيانات: ' + errText);
  }

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
