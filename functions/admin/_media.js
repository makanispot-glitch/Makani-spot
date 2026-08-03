/**
 * وحدة الوسائط المشتركة — المصدر الوحيد لكل ما يتعلق بملفات R2.
 *
 * قبل هذه الوحدة كان في المنصة **تسع نقاط رفع ومسارا حذف اثنان فقط**، ومكنسة
 * اليتامى تفحص مسار المشاريع وحده وتتخطّى البقية بـ`continue`. النتيجة أن ستّ
 * منظومات كانت تُسرِّب ملفاتها 100%: حذف السجل من القاعدة لا يمسّ الملف إطلاقًا.
 *
 * ── قواعد السلامة الحاكمة (بترتيب الأهمية) ──
 * 1. **لا حذف على مجموعة مراجع ناقصة، أبدًا.** بناء المراجع مُرقَّم صراحةً ويُقارَن
 *    بالعدد المُعلَن من PostgREST؛ أي نقص أو فشل ⇒ إجهاض كامل بلا حذف. بدون هذا
 *    كان سقف صفوف PostgREST يعني حذف صور إعلانات حيّة فور تجاوز الحدّ.
 * 2. **المجهول لا يُحذف.** مفتاح لا تطابق بادئته أي مصدر معروف يُبلَّغ عنه
 *    كـunknown_prefix ويُترك للمراجعة اليدوية.
 * 3. **مجموعة مراجع عامة واحدة** من كل أعمدة الصور في كل الجداول — لا مجموعة
 *    لكل بادئة. الملف يتيم فقط إن لم يشر إليه أي سجلّ في المنصة كلها، فلا يُحذف
 *    ملف مشترك (أفاتار منظّم منسوخ في بازار مثلًا) لأن أحد مصادره حُذف.
 * 4. **التفعيل تدريجي** — كل بادئة لها علم enabled مستقل في retention_policies،
 *    وكلها تبدأ معطَّلة عدا مسار المشاريع المُكتَسَح تاريخيًا.
 */

export const R2_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev/';

/**
 * سجل مصادر الوسائط — خريطة مفاتيح R2 كما تُنتجها نقاط الرفع فعليًا.
 * `variants: 3` ⇒ media-handler.uploadImages() تكتب _c/_d/_f وتحفظ _f وحده.
 * `variants: 1` ⇒ uploadSingleImageToR2() تكتب ملفًا واحدًا بلا لواحق.
 */
export const MEDIA_SOURCES = [
  { key: 'r2_sweep_official',     prefix: 'official-listings/', label: 'الإعلانات الرسمية',      variants: 3 },
  { key: 'r2_sweep_owner_spaces', prefix: 'owner-spaces/',      label: 'المساحات ووحداتها',      variants: 3 },
  { key: 'r2_sweep_admin_spaces', prefix: 'admin-spaces/',      label: 'وحدات المساحات (أدمن)',  variants: 1 },
  { key: 'r2_sweep_bazaars',      prefix: 'bazaars/',           label: 'البازارات',              variants: 1 },
  { key: 'r2_sweep_avatars',      prefix: 'avatars/',           label: 'صور الحسابات',           variants: 1 },
  { key: 'r2_sweep_covers',       prefix: 'covers/',            label: 'أغلفة الحسابات',         variants: 1 },
  /* المشاريع: بلا بادئة اسمية — مجلد بـuuid المستخدم مباشرة على الجذر */
  { key: 'r2_sweep_listings',     prefix: null, match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//,
    label: 'المشاريع الجاهزة', variants: 3 },
];

/**
 * مصادر المراجع تُقرأ من `media_registry` في القاعدة، لا من مصفوفة هنا —
 * مصدر واحد للحقيقة يستخدمه: هذا الـWorker، ومحفّزات طابور الحذف، ومدقّق
 * التغطية الذي يُبلّغ عن أي عمود صور جديد غير مسجَّل. إغفال عمود يعني حذف
 * ملفات حيّة، فالاعتماد على تذكُّر المطوّر تحديثَ مصفوفة هنا كان خطرًا بذاته.
 *
 * `organizer_avatar_url` يبقى ضمن المراجع رغم استثنائه من طابور الحذف:
 * البازار ينسخ أفاتار المنظّم، فيجب أن يمنع حذفه — لكن لا يملكه فلا يُدرجه.
 */
export async function fetchMediaRefSources(SUPABASE_URL, sbHeaders) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_media_registry`, {
    method: 'POST', headers: sbHeaders, body: '{}',
  });
  if (!res.ok) throw new Error(`media registry fetch failed: HTTP ${res.status}`);
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || !rows.length) throw new Error('media registry empty or unreadable');

  const out = rows.map(r => ({ table: r.table_name, cols: r.cols }));
  /* عمود مرجعي لا يملكه صاحبه — يُقرأ ليُحمى، ولا يُدرَج في طابور الحذف */
  const bz = out.find(o => o.table === 'bazaars');
  if (bz && !bz.cols.includes('organizer_avatar_url')) bz.cols = [...bz.cols, 'organizer_avatar_url'];
  return out;
}

const PAGE = 1000;

/** يحوّل رابطًا كاملًا إلى مفتاح R2، أو null إن لم يكن من الباكيت. */
export function urlToKey(url) {
  if (typeof url !== 'string' || !url.startsWith(R2_BASE)) return null;
  const k = url.slice(R2_BASE.length).split('?')[0];
  return k || null;
}

/** يجرّد لاحقة الحجم (_c/_d/_f) للحصول على المفتاح الأساسي المشترك بين الأحجام. */
export function baseOf(key) {
  return key.replace(/_[cdf]\.webp$/, '');
}

/** يحدّد المصدر الذي ينتمي إليه مفتاح ما — أو null إن كان مجهول البادئة. */
export function sourceOfKey(key) {
  for (const s of MEDIA_SOURCES) {
    if (s.prefix ? key.startsWith(s.prefix) : s.match.test(key)) return s;
  }
  return null;
}

/**
 * جلب مُرقَّم صارم. **يرمي عند أي نقص** — لأن مجموعة مراجع ناقصة تعني حذف
 * ملفات حيّة، والإجهاض أرخص بما لا يُقاس من فقدان صور المستخدمين.
 */
export async function fetchAllRows(SUPABASE_URL, sbHeaders, table, cols) {
  const rows = [];
  let from = 0, expected = null;

  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(cols.join(','))}`,
      { headers: { ...sbHeaders, 'Range-Unit': 'items',
                   'Range': `${from}-${from + PAGE - 1}`, 'Prefer': 'count=exact' } }
    );
    if (!res.ok && res.status !== 206) {
      throw new Error(`reference fetch failed for ${table}: HTTP ${res.status}`);
    }

    /* Content-Range: "0-999/4210" — الرقم بعد / هو الإجمالي الحقيقي */
    const cr = res.headers.get('content-range') || '';
    const total = parseInt((cr.split('/')[1] || ''), 10);
    if (Number.isFinite(total)) expected = total;

    const page = await res.json().catch(() => null);
    if (!Array.isArray(page)) throw new Error(`reference fetch returned non-array for ${table}`);
    rows.push(...page);

    if (page.length < PAGE) break;
    from += PAGE;
    if (from > 500000) throw new Error(`reference fetch runaway for ${table}`);
  }

  if (expected != null && rows.length < expected) {
    throw new Error(`reference set incomplete for ${table}: got ${rows.length} of ${expected}`);
  }
  return rows;
}

/**
 * مجموعة المراجع العامة: كل مفتاح R2 مشار إليه من أي سجلّ في المنصة.
 * تُخزَّن بالمفتاح الأساسي (بلا لاحقة حجم) ليغطي الأحجام الثلاثة معًا.
 */
export async function buildReferenceIndex(SUPABASE_URL, sbHeaders) {
  const refs = new Set();
  let scanned = 0;

  /* السجل مصدر المراجع — فشل قراءته يرمي، فيُجهض الكنس بلا حذف */
  const sources = await fetchMediaRefSources(SUPABASE_URL, sbHeaders);

  for (const src of sources) {
    const rows = await fetchAllRows(SUPABASE_URL, sbHeaders, src.table, src.cols);
    scanned += rows.length;
    for (const row of rows) {
      for (const col of src.cols) {
        const val = row[col];
        const list = Array.isArray(val) ? val : [val];
        for (const url of list) {
          const key = urlToKey(url);
          if (key) refs.add(baseOf(key));
        }
      }
    }
  }
  return { refs, scanned };
}

/** حذف ملف بكل أحجامه. المسارات ذات الحجم الواحد لا تشتقّ لواحق. */
export async function deleteMediaByKey(bucket, key, variants = 3) {
  if (!bucket || !key) return 0;
  let n = 0;
  const targets = new Set([key]);
  if (variants === 3) {
    const base = baseOf(key);
    for (const v of ['_c.webp', '_d.webp', '_f.webp']) targets.add(base + v);
  }
  for (const t of targets) {
    try { await bucket.delete(t); n++; } catch { /* ملف غير موجود = لا مشكلة */ }
  }
  return n;
}

/** نفس الشيء انطلاقًا من روابط كاملة — يستخدمها كل مسار حذف في المنصة. */
export async function deleteMediaByUrls(bucket, urls, variantsHint = null) {
  if (!bucket) return 0;
  let n = 0;
  for (const url of new Set((urls || []).filter(Boolean))) {
    const key = urlToKey(url);
    if (!key) continue;
    const variants = variantsHint ?? (sourceOfKey(key)?.variants ?? 3);
    n += await deleteMediaByKey(bucket, key, variants);
  }
  return n;
}
