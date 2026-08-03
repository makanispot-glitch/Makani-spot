/**
 * Cloudflare Pages Function — POST /admin/cron-cleanup
 * تُستدعى تلقائياً من Supabase pg_cron (وليس من لوحة الإدمن أو المتصفح)
 * مصادقة: X-Cron-Secret header يطابق CRON_SECRET (متغيّر بيئة مستقل عن ADM_SECRET)
 *
 * المهام:
 *  1) حذف نهائي للإعلانات rejected/expired (كل حالة بمدة احتفاظ مستقلة، قابلة للتعديل
 *     من admin/index.html → إعدادات الحذف التلقائي) + صورها من R2
 *  2) استهلاك طابور pending_media_deletions — الملفات التي فقدت مرجعها في القاعدة
 *     (حذف مساحة/بازار، استبدال أفاتار، تفريغ سلة محذوفات…)
 *  3) كنس ملفات R2 اليتيمة عبر **كل** المنظومات، لا المشاريع وحدها
 *  4) قياس استهلاك R2 وكتابة لقطته في admin_metrics ليقرأها مركز الصيانة
 *
 * ── السلامة ──
 * • مجموعة المراجع تُبنى مُرقَّمة من كل أعمدة الصور في المنصة، وأي نقص يُجهض
 *   الكنس كليًا. سابقًا كان الجلب بلا ترقيم: فوق سقف صفوف PostgREST كانت صور
 *   الإعلانات الحيّة تُعتبر يتيمة وتُحذف.
 * • كل بادئة لها علم تفعيل مستقل، وكلها معطَّلة عدا مسار المشاريع. ما دام
 *   العلم مطفأً يُحصى اليتامى ويُبلَّغ عنهم **دون حذف** (dry-run فعلي).
 * • مفتاح مجهول البادئة لا يُحذف أبدًا — يُعدّ ويُعرض للمراجعة اليدوية.
 * • كل بند داخل try مستقل: فشل واحد لا يوقف البقية (نمط errors[] الأصلي).
 */

import {
  MEDIA_SOURCES, urlToKey, baseOf, sourceOfKey,
  buildReferenceIndex, deleteMediaByKey, deleteMediaByUrls,
} from './_media.js';

/* قيم احتياطية فقط لو تعذّر جلب الإعدادات لأي سبب */
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
  if ((request.headers.get('X-Cron-Secret') || '') !== CRON_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const sbHeaders = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey':        SERVICE_KEY,
  };
  const rpc = (fn, params = {}) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbHeaders, body: JSON.stringify(params),
  });

  const result = {
    stale_deleted: 0, queue_deleted: 0, queue_skipped: 0,
    orphans_found: 0, orphans_deleted: 0, unknown_prefix: 0, errors: [],
  };

  /* ── 0) الإعدادات ── */
  let settings = FALLBACK_SETTINGS;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1&select=*`, { headers: sbHeaders });
    const rows = await r.json().catch(() => []);
    if (rows?.[0]) settings = rows[0];
  } catch (e) {
    result.errors.push('settings-fetch (using fallback defaults): ' + (e.message || String(e)));
  }

  let sweepCfg = {};
  try {
    const r = await rpc('get_media_sweep_config');
    sweepCfg = (await r.json().catch(() => ({}))) || {};
  } catch (e) {
    result.errors.push('sweep-config-fetch: ' + (e.message || String(e)));
  }

  /* ── 1) حذف الإعلانات المرفوضة/المنتهية + صورها ── */
  for (const [status, days] of [
    ['rejected', settings.reject_retention_days],
    ['expired',  settings.expired_retention_days],
  ]) {
    try {
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?status=eq.${status}&protected=is.false&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,cover_image,images`,
        { headers: sbHeaders }
      );
      const stale = await res.json().catch(() => []);

      for (const l of Array.isArray(stale) ? stale : []) {
        await deleteMediaByUrls(bucket, [l.cover_image, ...(l.images || [])], 3);
        const delRes = await fetch(
          `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(l.id)}`,
          { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
        );
        if (delRes.ok) result.stale_deleted++;
        else result.errors.push(`delete listing ${l.id} failed (${delRes.status})`);
      }
    } catch (e) {
      result.errors.push(`stale-cleanup (${status}): ` + (e.message || String(e)));
    }
  }

  /* ── مجموعة المراجع: تُبنى مرة واحدة ويعتمد عليها كل ما بعدها ──
     أي فشل هنا ⇒ لا طابور ولا كنس. الإجهاض هو السلوك الصحيح، لأن مجموعة
     ناقصة تعني حذف ملفات حيّة. */
  let refIndex = null;
  try {
    refIndex = await buildReferenceIndex(SUPABASE_URL, sbHeaders);
  } catch (e) {
    result.errors.push('reference-index ABORTED (no deletion performed): ' + (e.message || String(e)));
    await logRun(rpc, 'r2_maintenance', result.stale_deleted, false, result);
    return json({ ...result, aborted: true }, 200);
  }
  const isReferenced = key => refIndex.refs.has(baseOf(key));

  /* ── 2) طابور الحذف: ملفات فقدت مرجعها في القاعدة ──
     الطابور اقتراح لا أمر: يُتحقَّق أن الرابط غير مرجوع من أي سجلّ آخر
     (نفس الملف قد يكون مستخدمًا في سجلّ ثانٍ — بازار منسوخ مثلًا). */
  if (bucket) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/pending_media_deletions?state=eq.pending&select=id,url&limit=500`,
        { headers: sbHeaders }
      );
      const queue = await res.json().catch(() => []);
      const done = [], skipped = [];

      for (const row of Array.isArray(queue) ? queue : []) {
        const key = urlToKey(row.url);
        if (!key)              { skipped.push(row.id); continue; }
        if (isReferenced(key)) { skipped.push(row.id); continue; }   // ما زال مستخدمًا
        const src = sourceOfKey(key);
        if (!src)              { skipped.push(row.id); result.unknown_prefix++; continue; }
        await deleteMediaByKey(bucket, key, src.variants);
        done.push(row.id);
      }

      if (done.length)    await rpc('mark_media_deletions', { p_ids: done, p_state: 'done' });
      if (skipped.length) await rpc('mark_media_deletions', { p_ids: skipped, p_state: 'skipped',
                                      p_error: 'ما زال مرجوعًا من سجلّ، أو مفتاح غير معروف' });
      result.queue_deleted = done.length;
      result.queue_skipped = skipped.length;
    } catch (e) {
      result.errors.push('media-queue: ' + (e.message || String(e)));
    }
  }

  /* ── 3) كنس اليتامى عبر كل المنظومات + 4) قياس الاستهلاك ── */
  if (bucket) {
    try {
      const stats = new Map();   // sweepKey → { objects, bytes, orphans, orphanBytes }
      let unknownBytes = 0, unknownObjects = 0, totalBytes = 0, totalObjects = 0;

      const graceOf = k => (sweepCfg?.[k]?.grace_hours ?? settings.orphan_image_grace_hours ?? 24) * 3600000;
      const now = Date.now();
      let cursor;

      do {
        const page = await bucket.list({ cursor, limit: 1000 });
        for (const obj of page.objects) {
          totalObjects++; totalBytes += obj.size || 0;

          const src = sourceOfKey(obj.key);
          if (!src) {                       // المجهول لا يُحذف أبدًا
            unknownObjects++; unknownBytes += obj.size || 0;
            result.unknown_prefix++;
            continue;
          }

          const s = stats.get(src.key) || { objects: 0, bytes: 0, orphans: 0, orphanBytes: 0 };
          s.objects++; s.bytes += obj.size || 0;

          const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
          const fresh    = uploaded > now - graceOf(src.key);   // رُفعت للتوّ — قد يكون النشر جاريًا

          if (!fresh && !isReferenced(obj.key)) {
            s.orphans++; s.orphanBytes += obj.size || 0;
            result.orphans_found++;
            if (sweepCfg?.[src.key]?.enabled) {
              try { await bucket.delete(obj.key); result.orphans_deleted++; } catch { /* تجاهل */ }
            }
          }
          stats.set(src.key, s);
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);

      const snapshot = {
        total_bytes: totalBytes,
        objects: totalObjects,
        plan_limit_bytes: 10737418240,               // 10 GB — الحصة المجانية لـR2
        measured_at: new Date().toISOString(),
        refs_scanned: refIndex.scanned,
        unknown_prefix: unknownObjects,
        unknown_bytes: unknownBytes,
        by_prefix: MEDIA_SOURCES.map(s => {
          const st = stats.get(s.key) || { objects: 0, bytes: 0 };
          return { prefix: s.prefix || '<uuid>/', label: s.label, objects: st.objects, bytes: st.bytes };
        }),
        orphans: MEDIA_SOURCES.map(s => {
          const st = stats.get(s.key) || { orphans: 0, orphanBytes: 0 };
          return { prefix: s.prefix || '<uuid>/', label: s.label, key: s.key,
                   count: st.orphans, bytes: st.orphanBytes,
                   enabled: !!sweepCfg?.[s.key]?.enabled };
        }),
      };
      await rpc('record_storage_snapshot', { p_snapshot: snapshot });
    } catch (e) {
      result.errors.push('orphan-sweep: ' + (e.message || String(e)));
    }
  }

  await logRun(rpc, 'r2_maintenance',
               result.stale_deleted + result.queue_deleted + result.orphans_deleted,
               result.errors.length === 0, result);

  return json(result, 200);
}

/* كل تشغيل يُسجَّل في maintenance_runs — سابقًا كانت النتيجة تضيع في ردّ
   net.http_post المهمَل فلا يعرف أحد ما جرى. */
async function logRun(rpc, key, rows, ok, details) {
  try {
    await rpc('log_maintenance_run', {
      p_key: key, p_mode: 'run', p_trigger: 'worker', p_rows: rows,
      p_bytes: 0, p_ok: ok,
      p_error: details.errors.length ? details.errors.slice(0, 3).join(' | ') : null,
      p_duration_ms: null, p_details: details,
    });
  } catch { /* التسجيل لا يُفشِل الصيانة */ }
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
