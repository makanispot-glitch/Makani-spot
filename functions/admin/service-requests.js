/**
 * Cloudflare Pages Function — /admin/service-requests
 *
 * طلبات خدمات شراء المشاريع (معاينة + نقل).
 *
 * GET   ?scope=active|archived|all&status=&search=  → القائمة + إحصائيات أسباب الإغلاق
 * PATCH { id, status?, inspection_status?, transport_status?, cancel_reason?,
 *         note?, note_public?, inspection_report?, transport_quote?, archive? }
 *
 * كل قواعد سير العمل مفروضة في admin_update_service_request داخل القاعدة —
 * مش هنا. الطبقة دي بتصادق على التوكن وتمرّر، عشان القواعد تفضل مصدر حقيقة
 * واحد سواء اتنادت من اللوحة أو من أي أداة تانية مستقبلاً.
 */
import { requireAdmin, callRpc, json } from './_shared.js';

export async function onRequestGet(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const url = new URL(context.request.url);
  const params = {
    p_scope:  url.searchParams.get('scope')  || 'active',
    p_status: url.searchParams.get('status') || null,
    p_search: url.searchParams.get('search') || null,
    p_limit:  parseInt(url.searchParams.get('limit') || '100', 10),
    p_offset: parseInt(url.searchParams.get('offset') || '0', 10),
  };

  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_get_service_requests', params);
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}

export async function onRequestPatch(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  let body;
  try { body = await context.request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (!body?.id) return json({ error: 'Missing id' }, 400);

  try {
    const data = await callRpc(ctx.SUPABASE_URL, ctx.sbHeaders, 'admin_update_service_request', {
      p_id:                body.id,
      p_status:            body.status            ?? null,
      p_inspection_status: body.inspection_status ?? null,
      p_transport_status:  body.transport_status  ?? null,
      p_cancel_reason:     body.cancel_reason     ?? null,
      p_note:              body.note              ?? null,
      p_note_public:       body.note_public === true,
      p_inspection_report: body.inspection_report ?? null,
      p_transport_quote:   body.transport_quote   ?? null,
      p_archive:           typeof body.archive === 'boolean' ? body.archive : null,
    });

    /* الدالة بترجّع {ok:false,error:'…'} للقواعد المكسورة — نحوّلها 422
       عشان الواجهة تفرّق بين «ممنوع» و«الخادم وقع» */
    if (data && data.ok === false) return json(data, 422);
    return json(data, 200);
  } catch (e) {
    return json({ error: e.message }, e.status || 500);
  }
}
