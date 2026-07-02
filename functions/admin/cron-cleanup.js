/**
 * Cloudflare Pages Function — POST /admin/cron-cleanup
 * تُستدعى تلقائياً من Supabase pg_cron (وليس من لوحة الإدمن أو المتصفح)
 * مصادقة: X-Cron-Secret header يطابق CRON_SECRET (متغيّر بيئة مستقل عن ADM_SECRET)
 *
 * المهام:
 *  1) حذف نهائي للإعلانات rejected/expired (كل حالة بمدة احتفاظ مستقلة، قابلة للتعديل
 *     من admin/index.html → إعدادات الحذف التلقائي → جدول listing_cleanup_settings) + صورها من R2
 *  2) تنظيف صور R2 يتيمة — رُفعت أثناء معالج نشر إعلان ثم لم يُكمل المستخدم النشر
 */

const R2_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/';
/* مسار صور المشاريع للبيع فقط: <user_id uuid>/<ts>_<i>_<rand>_<c|d|f>.webp — بدون بادئة اسمية،
   على عكس بازارات/مساحات/أفاتار اللي بتستخدم بادئات صريحة (bazaars/ covers/ avatars/ ...) */
const LISTING_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/\d+_\d+_[a-z0-9]{4}_[cdf]\.webp$/;
/* قيم احتياطية فقط لو تعذّر جلب جدول الإعدادات لأي سبب */
const FALLBACK_SETTINGS = { reject_retention_days: 5, expired_retention_days: 7, orphan_image_grace_hours: 24 };

export async function onRequestPost(context) {
  const { request, env } = context;

  const CRON_SECRET  = env.CRON_SECRET;
  const SUPABASE_URL = env.SUPABASE_URL;
  const SERVICE_KEY  = env.SUPABASE_SERVICE_KEY;
  const bucket       = env.BUCKET || env['BUCKET-1'];

  if (!CRON_SECRET || !SUPABASE_URL || !SERVICE_KEY) {
    return json({ error: 'Server misconfigured: missing CRON_SECRET / SUPABASE_URL / SUPABASE_SERVICE_KEY' }, 500);
  }

  const secret = request.headers.get('X-Cron-Secret') || '';
  if (secret !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey':        SERVICE_KEY,
    'Prefer':        'return=minimal',
  };

  const result = { stale_deleted: 0, orphans_deleted: 0, errors: [] };

  /* ── 0) إعدادات الاحتفاظ — من الجدول، مع قيم احتياطية لو فشل الجلب ── */
  let settings = FALLBACK_SETTINGS;
  try {
    const sres = await fetch(`${SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1&select=*`, { headers: sbHeaders });
    const srows = await sres.json().catch(() => []);
    if (srows?.[0]) settings = srows[0];
  } catch (e) {
    result.errors.push('settings-fetch (using fallback defaults): ' + (e.message || String(e)));
  }

  /* ── 1) حذف نهائي للإعلانات المرفوضة/المنتهية — كل حالة بمدتها الخاصة ── */
  for (const [status, days] of [
    ['rejected', settings.reject_retention_days],
    ['expired',  settings.expired_retention_days],
  ]) {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?status=eq.${status}&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,cover_image,images`,
        { headers: sbHeaders }
      );
      const stale = await res.json().catch(() => []);

      for (const l of Array.isArray(stale) ? stale : []) {
        if (bucket) {
          const urls = [l.cover_image, ...(l.images || [])].filter(Boolean);
          for (const url of new Set(urls)) {
            if (typeof url === 'string' && url.startsWith(R2_BASE)) {
              const path = url.slice(R2_BASE.length);
              try { await bucket.delete(path); } catch {}
              if (path.endsWith('_f.webp')) {
                try { await bucket.delete(path.replace('_f.webp', '_c.webp')); } catch {}
                try { await bucket.delete(path.replace('_f.webp', '_d.webp')); } catch {}
              }
            }
          }
        }

        const delRes = await fetch(
          `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(l.id)}`,
          { method: 'DELETE', headers: sbHeaders }
        );
        if (delRes.ok) result.stale_deleted++;
        else result.errors.push(`delete listing ${l.id} failed (${delRes.status})`);
      }
    } catch (e) {
      result.errors.push(`stale-cleanup (${status}): ` + (e.message || String(e)));
    }
  }

  /* ── 2) تنظيف صور R2 يتيمة (رُفعت ولم يُنشر إعلان بيها) ── */
  if (bucket) {
    try {
      const refRes = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?status=neq.deleted&select=cover_image,images`,
        { headers: sbHeaders }
      );
      const rows = await refRes.json().catch(() => []);
      const referencedBases = new Set();
      for (const l of Array.isArray(rows) ? rows : []) {
        const urls = [l.cover_image, ...(l.images || [])].filter(Boolean);
        for (const url of urls) {
          if (typeof url === 'string' && url.startsWith(R2_BASE) && url.endsWith('_f.webp')) {
            referencedBases.add(url.slice(R2_BASE.length, -'_f.webp'.length));
          }
        }
      }

      let cursor;
      const graceCutoff = Date.now() - settings.orphan_image_grace_hours * 3600000;
      do {
        const page = await bucket.list({ cursor, limit: 1000 });
        for (const obj of page.objects) {
          if (!LISTING_KEY_RE.test(obj.key)) continue;
          const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
          if (uploaded > graceCutoff) continue; // لسه جديدة — اديها فرصة تكمل النشر

          const base = obj.key.replace(/_[cdf]\.webp$/, '');
          if (!referencedBases.has(base)) {
            try { await bucket.delete(obj.key); result.orphans_deleted++; } catch {}
          }
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch (e) {
      result.errors.push('orphan-sweep: ' + (e.message || String(e)));
    }
  }

  return json(result, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
