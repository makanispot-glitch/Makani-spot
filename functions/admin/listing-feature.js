/**
 * Cloudflare Pages Function — POST /admin/listing-feature
 * { listing_id, featured: boolean, featured_until? } (feature: الإعلانات المميزة)
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestPost(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  const { listing_id, featured, featured_until } = body;
  if (!listing_id || typeof featured !== 'boolean') return json({ error: 'Missing listing_id or featured(boolean)' }, 400);

  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_set_listing_featured', {
      p_listing_id: listing_id,
      p_featured: featured,
      p_featured_until: featured_until || null,
    });
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
