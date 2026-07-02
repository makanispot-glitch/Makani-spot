/**
 * Cloudflare Pages Function — GET /admin/listing-insights?type=top_users|stats|suspicious
 * ثلاث ميزات قراءة فقط: الحسابات الأكثر نشاطًا، تحليلات السوق، الحسابات المشبوهة
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const type = new URL(context.request.url).searchParams.get('type');

  try {
    if (type === 'top_users') {
      const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_top_active_listing_users', { p_limit: 100 });
      return json(data, 200);
    }
    if (type === 'stats') {
      const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_listings_marketplace_stats', {});
      return json(data, 200);
    }
    if (type === 'suspicious') {
      const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_suspicious_listing_users', {});
      return json(data, 200);
    }
    return json({ error: 'Unknown type — use top_users | stats | suspicious' }, 400);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
