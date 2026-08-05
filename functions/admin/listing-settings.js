/**
 * Cloudflare Pages Function — /admin/listing-settings
 * GET   → إعدادات الحذف التلقائي الحالية (feature: نظام الحذف التلقائي)
 * PATCH → تحديث المدد (reject / expired / deleted / orphan_grace)
 * القراءة/الكتابة عبر service key مباشرة — لا داعي لـ RPC.
 *
 * ── لماذا مساران للكتابة ──
 * الحقول الثلاثة القديمة تُكتب عبر view ‏listing_cleanup_settings الذي يحمل
 * محفّز INSTEAD OF UPDATE يترجمها إلى retention_policies. ذلك المحفّز **لم
 * يُمَس عمدًا**: فحص القاعدة أثبت أن حالتها الحيّة انحرفت عن ملفات المستودع
 * مرة بالفعل، فإعادة بناء جسم دالة قائمة من ملف خطر لا داعي له.
 * ولأن المحفّز يجهل الحقل الرابع، يُكتب deleted_retention_days مباشرةً على
 * retention_policies — أصغر تغيير ممكن، وبلا لمس أي شيء يعمل.
 */
import { requireAdmin, json } from './_shared.js';

/* الحقول التي يترجمها محفّز الـview */
const VIEW_FIELDS = ['reject_retention_days', 'expired_retention_days', 'orphan_image_grace_hours'];

/* الحقول المكتوبة مباشرةً: اسم الحقل → مفتاح السياسة */
const DIRECT_FIELDS = { deleted_retention_days: 'listings_deleted' };

export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1&select=*`, { headers: ctx.sbHeaders });
  const arr = await res.json().catch(() => []);
  return json(arr?.[0] || {}, res.status);
}

export async function onRequestPatch(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const now = new Date().toISOString();
  let touched = 0;

  /* ── المسار القائم: عبر الـview ── */
  const updates = {};
  for (const k of VIEW_FIELDS) {
    if (body[k] != null) updates[k] = clampDays(body[k]);
  }
  if (Object.keys(updates).length) {
    updates.updated_at = now;
    const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1`, {
      method:  'PATCH',
      headers: { ...ctx.sbHeaders, Prefer: 'return=minimal' },
      body:    JSON.stringify(updates),
    });
    if (!res.ok) return json({ error: await res.text() }, res.status);
    touched += Object.keys(updates).length - 1;
  }

  /* ── المسار المباشر: مفاتيح لا يعرفها محفّز الـview ── */
  for (const [field, key] of Object.entries(DIRECT_FIELDS)) {
    if (body[field] == null) continue;
    const res = await fetch(
      `${ctx.SUPABASE_URL}/rest/v1/retention_policies?key=eq.${encodeURIComponent(key)}`,
      {
        method:  'PATCH',
        headers: { ...ctx.sbHeaders, Prefer: 'return=representation' },
        body:    JSON.stringify({ amount: clampDays(body[field]), updated_at: now }),
      }
    );
    const text = await res.text();
    if (!res.ok) return json({ error: text }, res.status);

    /* [] يعني أن صفّ السياسة غير موجود — الترحيل لم يُطبَّق بعد.
       نُبلِّغ صراحةً بدل نجاح كاذب يُخفي أن الإعداد لم يُحفظ. */
    let rows; try { rows = JSON.parse(text); } catch { rows = null; }
    if (Array.isArray(rows) && rows.length === 0) {
      return json({ error: `سياسة الاحتفاظ "${key}" غير موجودة — طبّق supabase_listing_media_lifecycle.sql أولاً` }, 409);
    }
    touched++;
  }

  if (!touched) return json({ error: 'No valid fields to update' }, 400);

  /* الحالة بعد الحفظ تُقرأ من مصدر واحد — الـview */
  const after = await fetch(`${ctx.SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1&select=*`, { headers: ctx.sbHeaders });
  const arr   = await after.json().catch(() => []);
  return json(arr?.[0] || { ok: true }, 200);
}

/* نفس ما يفعله محفّز الـview: GREATEST(1, x) — الصفر يعني حذفًا فوريًا */
function clampDays(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}
