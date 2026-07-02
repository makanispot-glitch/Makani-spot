/**
 * Cloudflare Pages Function — POST /admin/listing-suspend
 * { user_id, suspend: boolean, reason?, duration_days? }
 * تعليق/استعادة صلاحية نشر وتعديل الإعلانات لناشر معيّن (feature: تعليق الحسابات)
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestPost(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { user_id, suspend, reason, duration_days } = body;
  if (!user_id || typeof suspend !== 'boolean') return json({ error: 'Missing user_id or suspend(boolean)' }, 400);

  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_suspend_listing_user', {
      p_user_id: user_id,
      p_suspend: suspend,
      p_reason: reason || null,
      p_duration_days: duration_days || null,
    });
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
