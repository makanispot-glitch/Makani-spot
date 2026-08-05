/**
 * Cloudflare Pages Function — POST /admin/cron-cleanup
 * تُستدعى تلقائياً من Supabase pg_cron (وليس من لوحة الإدمن أو المتصفح)
 * مصادقة: X-Cron-Secret header يطابق CRON_SECRET (متغيّر بيئة مستقل عن ADM_SECRET)
 *
 * المنطق كله في _cleanup.js — يشاركه زر «تنظيف الآن» عبر /admin/run-cleanup،
 * فما يفعله الـcron ليلًا هو حرفيًا ما يفعله الزر نهارًا. المهام والسلامة
 * موثّقة هناك في مكان واحد بدل نسختين تتباعدان.
 */

import { runCleanup, json } from './_cleanup.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const CRON_SECRET  = env.CRON_SECRET;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;

  if (!CRON_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Server misconfigured: missing CRON_SECRET / SUPABASE_URL / SUPABASE_SERVICE_KEY' }, 500);
  }
  if ((request.headers.get('X-Cron-Secret') || '') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const result = await runCleanup({
    SUPABASE_URL,
    sbHeaders: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey':        SERVICE_KEY,
    },
    bucket:  env.BUCKET || env['BUCKET-1'],
    trigger: 'worker',
  });

  return json(result, 200);
}
