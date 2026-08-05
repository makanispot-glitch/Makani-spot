/**
 * Cloudflare Pages Function — /admin/listing-exemptions
 * إدارة الإيميلات المستثناة من قيود نشر الإعلانات (feature: استثناءات النشر)
 *
 *   GET    ?search=…              → قائمة الاستثناءات
 *   POST   { email, note }        → إضافة بريد
 *   PATCH  { email, new_email?, note?, is_active? } → تعديل صفّ قائم
 *   DELETE { email }              → حذف بريد
 *
 * الجدول public.listing_rate_limit_exempt مقفول بـ RLS بلا أي policy — لا anon
 * ولا authenticated يصله. المنفذ الوحيد للكتابة هو هذا الملف عبر service key،
 * والمنفذ الوحيد للقراءة داخل القاعدة هو is_listing_rate_limit_exempt().
 *
 * مهم: عضوية القائمة تُقرأ حصريًا داخل enforce_listing_rate_limit — تُلغي حد
 * الإعلانات النشطة وفترة الانتظار فقط، ولا تمنح أي صلاحية إدارية أخرى.
 */
import { requireAdmin, callRpc, json } from './_shared.js';

const TABLE = 'listing_rate_limit_exempt';

/* البريد يُخزَّن دائمًا بصيغة معيارية (حروف صغيرة، بلا فراغات) حتى تعمل
   المطابقة التامة في PostgREST وتتطابق مع فهرس lower(trim(email)) في القاعدة. */
function normEmail(v) {
  return String(v ?? '').trim().toLowerCase();
}

/* الفاصلة والنقطتان الرأسيتان تكسران صيغة فلاتر PostgREST — والمحارف دي مش
   جزء من أي بريد حقيقي أصلًا، فالرفض هنا تحقّق ومنع حقن في آن واحد. */
function isValidEmail(v) {
  const seg = '[^\\s@,.()<>:;"\\\\[\\]]+';
  return new RegExp(`^${seg}(\\.${seg})*@${seg}(\\.${seg})+$`).test(v) && v.length <= 254;
}

function eqFilter(email) {
  return `email=eq.${encodeURIComponent(email)}`;
}

async function readJson(request) {
  try { return { body: await request.json() }; }
  catch { return { error: json({ error: 'Invalid JSON body' }, 400) }; }
}

/* ── GET: القائمة + أرقام القيود السارية ──
   الأرقام تأتي من listing_limit_config() في القاعدة — نفس المصدر الذي يقرأ منه
   الـ trigger — حتى لا تُكتب «3» و«12 ساعة» مرة ثانية في واجهة الأدمن. */
export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const search = (new URL(context.request.url).searchParams.get('search') || '').trim();
  let url = `${ctx.SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=created_at.desc`;

  if (search) {
    /* % و_ محارف بدل في LIKE — تُهرَّب حتى يبقى البحث حرفيًا */
    const safe = search.replace(/[%_]/g, m => '\\' + m).replace(/[,()]/g, '');
    url += `&or=(email.ilike.*${encodeURIComponent(safe)}*,note.ilike.*${encodeURIComponent(safe)}*)`;
  }

  const [listRes, cfg] = await Promise.all([
    fetch(url, { headers: ctx.sbHeaders }),
    /* فشل قراءة الأرقام لا يمنع عرض القائمة — الواجهة تخفي سطر الأرقام فقط */
    callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'listing_limit_config').catch(() => null),
  ]);

  const text = await listRes.text();
  if (!listRes.ok) return json({ error: text }, listRes.status);

  let rows;
  try { rows = JSON.parse(text); } catch { rows = []; }
  const limits = Array.isArray(cfg) ? cfg[0] : cfg;

  return json({
    rows,
    max_active:     limits?.max_active     ?? null,
    cooldown_hours: limits?.cooldown_hours ?? null,
  }, 200);
}

/* ── POST: إضافة بريد جديد ── */
export async function onRequestPost(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const { body, error } = await readJson(context.request);
  if (error) return error;

  const email = normEmail(body.email);
  if (!email)               return json({ error: 'البريد الإلكتروني مطلوب' }, 400);
  if (!isValidEmail(email)) return json({ error: 'صيغة البريد الإلكتروني غير صحيحة' }, 400);

  const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/${TABLE}`, {
    method:  'POST',
    headers: { ...ctx.sbHeaders, Prefer: 'return=representation' },
    body:    JSON.stringify({
      email,
      note:      String(body.note ?? '').trim() || null,
      is_active: body.is_active === false ? false : true,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 409) return json({ error: 'هذا البريد مضاف بالفعل إلى قائمة الاستثناءات' }, 409);
    return json({ error: text }, res.status);
  }
  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/* ── PATCH: تعديل بريد / ملاحظة / تفعيل ── */
export async function onRequestPatch(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const { body, error } = await readJson(context.request);
  if (error) return error;

  const email = normEmail(body.email);
  if (!email) return json({ error: 'البريد الحالي مطلوب لتحديد الصف' }, 400);

  const updates = { updated_at: new Date().toISOString() };

  if (body.new_email != null) {
    const next = normEmail(body.new_email);
    if (!isValidEmail(next)) return json({ error: 'صيغة البريد الإلكتروني الجديد غير صحيحة' }, 400);
    updates.email = next;
  }
  if (body.note      != null) updates.note      = String(body.note).trim() || null;
  if (body.is_active != null) updates.is_active = !!body.is_active;

  if (Object.keys(updates).length === 1) return json({ error: 'لا يوجد حقل للتعديل' }, 400);

  const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/${TABLE}?${eqFilter(email)}`, {
    method:  'PATCH',
    headers: { ...ctx.sbHeaders, Prefer: 'return=representation' },
    body:    JSON.stringify(updates),
  });

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 409) return json({ error: 'البريد الجديد مضاف بالفعل إلى القائمة' }, 409);
    return json({ error: text }, res.status);
  }

  /* PostgREST يرجّع [] لو لم يطابق أي صف — نحوّلها لخطأ صريح بدل نجاح كاذب */
  let rows;
  try { rows = JSON.parse(text); } catch { rows = null; }
  if (Array.isArray(rows) && rows.length === 0) return json({ error: 'البريد غير موجود في القائمة' }, 404);

  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/* ── DELETE: حذف بريد من القائمة ── */
export async function onRequestDelete(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const { body, error } = await readJson(context.request);
  if (error) return error;

  const email = normEmail(body.email);
  if (!email) return json({ error: 'البريد الإلكتروني مطلوب' }, 400);

  const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/${TABLE}?${eqFilter(email)}`, {
    method:  'DELETE',
    headers: { ...ctx.sbHeaders, Prefer: 'return=representation' },
  });

  const text = await res.text();
  if (!res.ok) return json({ error: text }, res.status);

  let rows;
  try { rows = JSON.parse(text); } catch { rows = null; }
  if (Array.isArray(rows) && rows.length === 0) return json({ error: 'البريد غير موجود في القائمة' }, 404);

  return json({ ok: true }, 200);
}
