/**
 * Cloudflare Pages Function — /admin/listing-reports
 * GET   ?status=<listing status>   → قائمة البلاغات (مع بيانات الإعلان والمبلِّغ)
 * PATCH { listing_id, action }     → action: 'hide' (paused) | 'review' (pending)
 * (الحذف النهائي يُعاد استخدام /admin/listings الموجودة أصلاً — لا داعي لتكرار منطق R2)
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const status = new URL(context.request.url).searchParams.get('status') || null;
  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_listing_reports', { p_listing_status: status });
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}

const ACTION_STATUS = { hide: 'paused', review: 'pending' };

export async function onRequestPatch(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { listing_id, action } = body;
  const newStatus = ACTION_STATUS[action];
  if (!listing_id || !newStatus) return json({ error: 'Missing listing_id or invalid action (hide|review)' }, 400);

  const res = await fetch(
    `${ctx.SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(listing_id)}`,
    { method: 'PATCH', headers: { ...ctx.sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify({ status: newStatus }) }
  );
  if (!res.ok) {
    const errText = await res.text();
    return json({ error: errText }, res.status);
  }
  return json({ ok: true, status: newStatus }, 200);
}
