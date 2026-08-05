/**
 * Cloudflare Pages Function — POST /admin/run-cleanup
 * تشغيل فوري لنفس صيانة الـcron من زر «🧹 تنظيف الآن» في لوحة الأدمن.
 *
 * سبب وجودها: الزر كان يحمل نسخة ثانية من المنطق في المتصفح — ٧ أيام مثبَّتة
 * تتجاهل الإعدادات المضبوطة في نفس الصفحة، وتتجاهل علم protected، ولا ترى إلا
 * الصفوف المحمَّلة في الجدول وقتها. الآن الزر ينادي _cleanup.js نفسه الذي
 * يناديه الـcron، فمن المستحيل أن يفترق سلوكهما.
 *
 * المصادقة بتوكن الأدمن (ADM_SECRET) لا بسرّ الـcron — الزر يعمل من المتصفح
 * ولا يجوز أن يحمل CRON_SECRET.
 */

import { requireAdmin } from './_shared.js';
import { runCleanup, json } from './_cleanup.js';

export async function onRequestPost(context) {
  const ctx = await requireAdmin(context);
  if (ctx.error) return ctx.error;

  const result = await runCleanup({
    SUPABASE_URL: ctx.SUPABASE_URL,
    sbHeaders:    ctx.sbHeaders,
    bucket:       ctx.bucket,
    trigger:      'manual',
  });

  return json(result, 200);
}
