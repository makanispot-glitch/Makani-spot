/**
 * وحدة الصيانة المشتركة — منطق التنظيف كاملًا في مكان واحد.
 *
 * كان هذا المنطق يعيش داخل cron-cleanup.js وحده، بينما زر «تنظيف الآن» في لوحة
 * الأدمن يحمل نسخة ثانية أضعف: ٧ أيام مثبَّتة في الكود تتجاهل الإعدادات التي
 * يضبطها الأدمن في نفس الصفحة، وتتجاهل علم protected، ولا ترى إلا الصفوف
 * المحمَّلة في الجدول وقتها. الآن المسار واحد والزر والـcron ينادِيانه معًا،
 * فيستحيل أن يفترقا.
 *
 * المهام:
 *  1) حذف نهائي للإعلانات rejected/expired/deleted (كل حالة بمدة احتفاظ مستقلة
 *     قابلة للتعديل من admin/index.html → إعدادات الحذف التلقائي) + صورها من R2
 *  2) استهلاك طابور pending_media_deletions — الملفات التي فقدت مرجعها
 *  3) كنس ملفات R2 اليتيمة عبر كل المنظومات
 *  4) قياس استهلاك R2 وكتابة لقطته لتقرأها لوحة الصيانة
 *
 * ── السلامة (لم تتغيّر) ──
 * • مجموعة المراجع تُبنى مُرقَّمة من كل أعمدة الصور، وأي نقص يُجهض الكنس كليًا.
 * • كل بادئة لها علم تفعيل مستقل؛ ما دام مطفأً يُحصى اليتامى دون حذف.
 * • مصدر sweepable:false لا يُحذف منه شيء مهما كان علمه — مراجعه خارج القاعدة.
 * • مفتاح مجهول البادئة لا يُحذف أبدًا.
 * • كل بند داخل try مستقل: فشل واحد لا يوقف البقية.
 */

import {
  MEDIA_SOURCES, urlToKey, baseOf, sourceOfKey, isSweepable,
  buildReferenceIndex, deleteMediaByKey, deleteMediaByUrls,
} from './_media.js';

/* قيم احتياطية فقط لو تعذّر جلب الإعدادات لأي سبب */
export const FALLBACK_SETTINGS = {
  reject_retention_days:    5,
  expired_retention_days:   7,
  deleted_retention_days:   7,
  orphan_image_grace_hours: 24,
};

/* الحالات التي تُحذف نهائيًا، وكل واحدة ومفتاح مدّتها.
   'deleted' يوسمها العميل عند فشل /delete-listing بخطأ 5xx — وكانت الحالة
   الوحيدة بلا سياسة: لا الـWorker يحذفها ولا كنس اليتامى يمسّها (الصف باقٍ
   فصوره «مرجوعة» رسميًا) فتبقى هي وصورها للأبد. */
const PURGE_STATUSES = [
  ['rejected', 'reject_retention_days'],
  ['expired',  'expired_retention_days'],
  ['deleted',  'deleted_retention_days'],
];

/**
 * @param {object}  ctx
 * @param {string}  ctx.SUPABASE_URL
 * @param {object}  ctx.sbHeaders   — ترويسات service key
 * @param {object}  ctx.bucket      — R2 binding (قد يكون undefined)
 * @param {string}  ctx.trigger     — 'worker' | 'manual' | 'cron' (للتسجيل فقط)
 */
export async function runCleanup({ SUPABASE_URL, sbHeaders, bucket, trigger = 'worker' }) {
  const startedAt = Date.now();

  const rpc = (fn, params = {}) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: sbHeaders, body: JSON.stringify(params),
  });

  const result = {
    stale_deleted: 0, stale_by_status: {},
    queue_deleted: 0, queue_skipped: 0,
    orphans_found: 0, orphans_deleted: 0, orphan_bytes_deleted: 0,
    unknown_prefix: 0, not_sweepable: 0,
    errors: [],
  };

  /* ── 0) الإعدادات ── */
  let settings = FALLBACK_SETTINGS;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/listing_cleanup_settings?id=eq.1&select=*`, { headers: sbHeaders });
    const rows = await r.json().catch(() => []);
    if (rows?.[0]) settings = { ...FALLBACK_SETTINGS, ...rows[0] };
  } catch (e) {
    result.errors.push('settings-fetch (using fallback defaults): ' + msg(e));
  }

  let sweepCfg = {};
  try {
    const r = await rpc('get_media_sweep_config');
    sweepCfg = (await r.json().catch(() => ({}))) || {};
    if (!r.ok) {
      result.errors.push('sweep-config unavailable — no prefix will be swept this run');
      sweepCfg = {};
    }
  } catch (e) {
    result.errors.push('sweep-config-fetch: ' + msg(e));
  }

  /* ── 1) حذف الإعلانات المنتهية صلاحيتها في كل حالة + صورها ── */
  for (const [status, settingKey] of PURGE_STATUSES) {
    try {
      const days   = Number(settings[settingKey] ?? FALLBACK_SETTINGS[settingKey]);
      if (!Number.isFinite(days) || days < 1) {
        result.errors.push(`stale-cleanup (${status}): retention "${settingKey}" غير صالح — تُخطّى`);
        continue;
      }
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/listings?status=eq.${status}&protected=is.false`
        + `&updated_at=lt.${encodeURIComponent(cutoff)}&select=id,cover_image,images`,
        { headers: sbHeaders }
      );

      /* PostgREST يردّ بكائن خطأ لا مصفوفة عند عمود مفقود — كان يُبتلع بصمت
         فيبدو كأن لا شيء لِيُحذف. الآن يُسجَّل صراحةً. */
      const stale = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(stale)) {
        result.errors.push(`stale-cleanup (${status}) query failed: `
          + (stale?.message || stale?.hint || `HTTP ${res.status}`));
        continue;
      }

      let n = 0;
      for (const l of stale) {
        await deleteMediaByUrls(bucket, [l.cover_image, ...(l.images || [])], 3);
        const delRes = await fetch(
          `${SUPABASE_URL}/rest/v1/listings?id=eq.${encodeURIComponent(l.id)}`,
          { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
        );
        if (delRes.ok) { n++; result.stale_deleted++; }
        else result.errors.push(`delete listing ${l.id} failed (${delRes.status})`);
      }
      result.stale_by_status[status] = n;
    } catch (e) {
      result.errors.push(`stale-cleanup (${status}): ` + msg(e));
    }
  }

  /* ── مجموعة المراجع: تُبنى مرة واحدة ويعتمد عليها كل ما بعدها ──
     أي فشل هنا ⇒ لا طابور ولا كنس. الإجهاض هو السلوك الصحيح، لأن مجموعة
     ناقصة تعني حذف ملفات حيّة. */
  let refIndex = null;
  try {
    refIndex = await buildReferenceIndex(SUPABASE_URL, sbHeaders);
  } catch (e) {
    result.errors.push('reference-index ABORTED (no deletion performed): ' + msg(e));
    await logRun(rpc, result, false, startedAt, trigger);
    return { ...result, aborted: true };
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
        if (!isSweepable(src)) { skipped.push(row.id); result.not_sweepable++;  continue; }
        await deleteMediaByKey(bucket, key, src.variants);
        done.push(row.id);
      }

      /* بدون ترقيم النتيجة يبقى الصف pending فيُعاد استهلاكه كل تشغيلة،
         والفهرس الفريد الجزئي يمنع إعادة إدراج نفس الرابط لاحقًا. */
      if (done.length) {
        const r = await rpc('mark_media_deletions', { p_ids: done, p_state: 'done' });
        if (!r.ok) result.errors.push('mark_media_deletions(done) failed — queue will re-run');
      }
      if (skipped.length) {
        const r = await rpc('mark_media_deletions', { p_ids: skipped, p_state: 'skipped',
                              p_error: 'ما زال مرجوعًا من سجلّ، أو مصدر غير قابل للكنس' });
        if (!r.ok) result.errors.push('mark_media_deletions(skipped) failed — queue will re-run');
      }
      result.queue_deleted = done.length;
      result.queue_skipped = skipped.length;
    } catch (e) {
      result.errors.push('media-queue: ' + msg(e));
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
            /* sweepable:false يسبق العلم: مراجع هذا المصدر خارج القاعدة أصلًا
               فـ«يتيم» هنا لا تعني «غير مستخدم». */
            if (!isSweepable(src)) {
              result.not_sweepable++;
            } else if (sweepCfg?.[src.key]?.enabled) {
              try {
                await bucket.delete(obj.key);
                result.orphans_deleted++;
                result.orphan_bytes_deleted += obj.size || 0;
              } catch { /* تجاهل */ }
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
                   enabled: isSweepable(s) && !!sweepCfg?.[s.key]?.enabled,
                   sweepable: isSweepable(s), note: s.sweepNote || null };
        }),
      };
      const snapRes = await rpc('record_storage_snapshot', { p_snapshot: snapshot });
      if (!snapRes.ok) result.errors.push('record_storage_snapshot failed — لوحة الصيانة ستبقى بلا لقطة');
    } catch (e) {
      result.errors.push('orphan-sweep: ' + msg(e));
    }
  }

  await logRun(rpc, result, result.errors.length === 0, startedAt, trigger);
  return result;
}

/* كل تشغيل يُسجَّل في maintenance_runs — سابقًا كانت النتيجة تضيع في ردّ
   net.http_post المهمَل فلا يعرف أحد ما جرى. */
async function logRun(rpc, details, ok, startedAt, trigger) {
  try {
    await rpc('log_maintenance_run', {
      p_key:   'r2_maintenance',
      p_mode:  'run',
      p_trigger: trigger === 'manual' ? 'manual' : 'worker',
      p_rows:  details.stale_deleted + details.queue_deleted + details.orphans_deleted,
      p_bytes: details.orphan_bytes_deleted || 0,
      p_ok:    ok,
      p_error: details.errors.length ? details.errors.slice(0, 3).join(' | ') : null,
      p_duration_ms: Date.now() - startedAt,
      p_details: details,
    });
  } catch { /* التسجيل لا يُفشِل الصيانة */ }
}

function msg(e) {
  return e?.message || String(e);
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  });
}
