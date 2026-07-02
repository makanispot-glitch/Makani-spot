/**
 * Cloudflare Pages Function — GET /admin/listing-detail?user_id=<uuid>
 * بروفايل ناشر إعلان + كل إحصائياته (feature: بيانات صاحب الإعلان)
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const userId = new URL(context.request.url).searchParams.get('user_id');
  if (!userId) return json({ error: 'Missing user_id' }, 400);

  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_listing_seller_detail', { p_user_id: userId });
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
