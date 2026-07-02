/**
 * Cloudflare Pages Function — /admin/listing-settings
 * GET   → إعدادات الحذف التلقائي الحالية (feature: نظام الحذف التلقائي)
 * PATCH → تحديث المدد (reject_retention_days / expired_retention_days / orphan_image_grace_hours)
 * جدول عادي بسيط — لا داعي لـ RPC، القراءة/الكتابة عبر service key مباشرة.
 */
import { requireAdmin, json } from './_shared.js';

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

  const updates = {};
  for (const k of ['reject_retention_days', 'expired_retention_days', 'orphan_image_grace_hours']) {
    if (body[k] != null) updates[k] = Number(body[k]);
  }
  if (!Object.keys(updates).length) return json({ error: 'No valid fields to update' }, 400);
  updates.updated_at = new Date().toISOString();

  const res = await fetch(`${ctx.SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1`, {
    method: 'PATCH',
    headers: { ...ctx.sbHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  });
  const text = await res.text();
  if (!res.ok) return json({ error: text }, res.status);
  return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
}
