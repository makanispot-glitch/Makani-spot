/**
 * Cloudflare Pages Function — /upload
 * استقبال الصور من المتصفح، رفعها لـ R2، إرجاع الـ URL العام
 *
 * متطلبات في Cloudflare Pages Dashboard:
 *   Settings → Functions → R2 Bucket Bindings
 *   Variable name: BUCKET   |   R2 bucket: makani-listings-images
 */

const R2_PUBLIC_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/* ── Preflight ── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/* ── Upload ── */
export async function onRequestPost(context) {
  const { request, env } = context;

  /* 1. تأكد أن الـ R2 binding موجود */
  const bucket = env.BUCKET || env['BUCKET-1'];
  if (!bucket) {
    return fail(503, 'R2 bucket غير مضبوط — أضف BUCKET binding في Pages Dashboard باسم BUCKET أو BUCKET-1');
  }

  /* 2. تحقق من وجود Authorization header (Supabase session token) */
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return fail(401, 'غير مصرّح — يجب تسجيل الدخول أولاً');
  }

  /* 3. اقرأ الـ FormData */
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return fail(400, 'بيانات غير صالحة');
  }

  const file = formData.get('file');   // Blob
  const path = formData.get('path');   // user_id/timestamp_index.jpg

  if (!file || !path) {
    return fail(400, 'الحقول file و path مطلوبة');
  }

  /* 4. حماية من Path Traversal */
  if (path.includes('..') || path.startsWith('/') || !/^[\w\-/]+\.jpg$/.test(path)) {
    return fail(400, 'مسار غير مسموح به');
  }

  /* 5. ارفع لـ R2 */
  try {
    const buffer = await file.arrayBuffer();
    await bucket.put(path, buffer, {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    const url = `${R2_PUBLIC_BASE}/${path}`;
    return ok({ url });
  } catch (e) {
    return fail(500, e.message || 'فشل رفع الصورة');
  }
}

/* ── Helpers ── */
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
