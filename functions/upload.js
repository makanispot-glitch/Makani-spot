/**
 * Cloudflare Pages Function — /upload
 * استقبال الصور من المتصفح، رفعها لـ R2، إرجاع الـ URL العام
 *
 * متطلبات في Cloudflare Pages Dashboard:
 *   Settings → Functions → R2 Bucket Bindings
 *   Variable name: BUCKET   |   R2 bucket: makani-listings-images
 *   Environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY
 *
 * ── لماذا تشدَّد التحقق هنا ──
 * كان الشرط الوحيد `Bearer` بطول ≥20 محرفًا وأي مسار مقبول. والـanon key منشور
 * في العميل، فكانت هذه فعليًا نقطة كتابة مفتوحة على باكيت عام. والأخطر أن مفتاحًا
 * بادئته غير معروفة **لا يُحذف أبدًا** بالكنس («المجهول لا يُحذف» — قاعدة سلامة
 * صحيحة في _media.js) ⇒ تراكم بلا سقف على الخطة المجانية.
 *
 * القاعدة الحاكمة الآن: **لا يُكتب ملف تحت بادئة لا يعرفها الكانس.**
 *   • جلسة مستخدم حقيقية  → مسارات يملكها هو وحده (تحمل uuid الخاص به)
 *   • جلسة يعيدها is_admin() بـtrue → إضافةً لذلك البادئات الإدارية
 *   • anon key وحده → مرفوض
 */

import { sourceOfKey } from './admin/_media.js';

const R2_PUBLIC_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

/* بادئات اسمية يملكها المستخدم إن كان الجزء التالي هو uuid الخاص به.
   نفس البادئات في _media.js — أي بادئة جديدة تُضاف هنا وهناك معًا. */
const OWNED_PREFIXES = ['owner-spaces', 'bazaars', 'avatars', 'covers', 'id-cards'];

/* بادئات لا يملكها مستخدم بعينه — محتوى تحريري/إداري */
const ADMIN_PREFIXES = ['articles/', 'admin-spaces/', 'official-listings/'];

/* ── Preflight ── */
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

/* ── Upload ── */
export async function onRequestPost(context) {
  const { request, env } = context;

  /* 1. تأكد أن الـ R2 binding والبيئة مضبوطان */
  const bucket = env.BUCKET || env['BUCKET-1'];
  if (!bucket) {
    return fail(503, 'R2 bucket غير مضبوط — أضف BUCKET binding في Pages Dashboard باسم BUCKET أو BUCKET-1');
  }
  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return fail(503, 'Server misconfigured: missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  }

  /* 2. جلسة مستخدم حقيقية — الـanon key يُرفض هنا لأنه ليس توكن مستخدم */
  const auth  = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return fail(401, 'غير مصرّح — يجب تسجيل الدخول');

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${token}` },
  });
  if (!userRes.ok) return fail(401, 'جلسة غير صالحة — سجّل الدخول مجدداً');

  let uid = null;
  try { uid = (await userRes.json())?.id || null; } catch {}
  if (!uid) return fail(401, 'تعذر التحقق من هويتك');

  /* 3. اقرأ الـ FormData */
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return fail(400, 'بيانات غير صالحة');
  }

  const file = formData.get('file');   // Blob
  const path = formData.get('path');   // user_id/timestamp_index.webp

  if (!file || !path) {
    return fail(400, 'الحقول file و path مطلوبة');
  }

  /* 4. حماية من Path Traversal */
  if (typeof path !== 'string' || path.includes('..') || path.startsWith('/') ||
      !/^[\w\-/]+\.(jpe?g|webp)$/.test(path)) {
    return fail(400, 'مسار غير مسموح به');
  }

  /* 5. الملكية: المسار يجب أن يخصّ صاحب الجلسة، أو يكون إداريًا وهو أدمن */
  const scope = pathScope(path, uid);
  if (scope === 'denied') {
    return fail(403, 'مسار غير مسموح به — لا يتبع أي منظومة معروفة');
  }
  if (scope === 'admin') {
    if (!await isAdmin(SUPABASE_URL, SERVICE_KEY, token)) {
      return fail(403, 'هذا المسار مخصص للإدارة');
    }
  }

  /* 6. لا يُكتب ملف تحت بادئة لا يعرفها الكانس — وإلا بقي في R2 للأبد */
  if (!sourceOfKey(path)) {
    return fail(400, 'مسار غير مسجَّل في منظومات الوسائط');
  }

  /* 7. حد أقصى للحجم بعد الضغط (5MB — حماية من تجاوز الـ R2 free tier) */
  if (file.size > 5 * 1024 * 1024) {
    return fail(413, 'حجم الصورة بعد الضغط كبير جداً — الحد الأقصى 5 MB');
  }

  /* 8. ارفع لـ R2 */
  try {
    const buffer      = await file.arrayBuffer();
    const contentType = (file.type && file.type.startsWith('image/')) ? file.type : 'image/jpeg';
    await bucket.put(path, buffer, {
      httpMetadata: { contentType },
    });
    const url = `${R2_PUBLIC_BASE}/${path}`;
    return ok({ url });
  } catch (e) {
    return fail(500, e.message || 'فشل رفع الصورة');
  }
}

/**
 * 'own'    — المسار يحمل uuid صاحب الجلسة
 * 'admin'  — مسار إداري أو مجلد مستخدم آخر: يلزم is_admin()
 * 'denied' — لا يتبع أي منظومة معروفة
 *
 * مُصدَّرة ليمكن اختبار مصفوفة المسارات كاملة — Pages لا تستدعي إلا onRequest*.
 */
export function pathScope(path, uid) {
  /* المشاريع: مجلد بـuuid المستخدم مباشرة على الجذر */
  if (path.startsWith(`${uid}/`)) return 'own';

  for (const p of OWNED_PREFIXES) {
    if (path.startsWith(`${p}/`)) {
      /* bazaars/<uid>/… يملكه المنظّم، وbazaars/<ts>_x.webp يرفعه الأدمن */
      return path.startsWith(`${p}/${uid}/`) ? 'own' : 'admin';
    }
  }

  if (ADMIN_PREFIXES.some(p => path.startsWith(p))) return 'admin';

  return 'denied';
}

/* نفس آلية delete-announcement.js: is_admin() تُقيَّم بجلسة المستخدم نفسه */
async function isAdmin(SUPABASE_URL, SERVICE_KEY, accessToken) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method:  'POST',
      headers: {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: '{}',
    });
    return res.ok && (await res.json()) === true;
  } catch {
    return false;
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
