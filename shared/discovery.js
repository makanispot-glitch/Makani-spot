/**
 * ════════════════════════════════════════════════════════════════════
 * 🧭 طبقة الاكتشاف المشتركة — Smart Discovery
 * ════════════════════════════════════════════════════════════════════
 *
 * المنصة فيها عائلتان من الفرص، ولكل واحدة صفحتها ونموذج بياناتها:
 *
 *   • مساحة صغيرة **ثابتة**  → /spaces/   (spaces + RPC search_public_spaces)
 *   • مساحة صغيرة **مؤقتة**  → /bazaars/  (bazaars + bazaar_slots)
 *
 * الملف ده هو المفردات المشتركة بينهم: مخطّط بارامترات واحد، جسر أنشطة
 * واحد، جسر مناطق واحد، وتعاقد بحث واحد الشكل للعائلتين.
 *
 * ── المبادئ الحاكمة ──────────────────────────────────────────────
 *  ١) **URL = Shareable Discovery State.** أي حالة اكتشاف تنتج نتائج
 *     لازم تكون في الرابط. حد يفتح /spaces/?region=…&act=… يلاقي نفس
 *     الاكتشاف. ده أساس مشاركة واتساب وروابط الحملات وصفحات الهبوط.
 *  ٢) النشاط في بحث البازارات يطابق الوصف المنشور، وليس قائمة قبول
 *     معتمدة من المنظّم. الواجهة توضح ذلك؛ لا نفترض أن النشاط مقبول.
 *  ٣) **مصدر البيانات مخفي عن الواجهة.** الـUI بتنادي getDiscoveryBazaars()
 *     ولا تعرف إن البيانات جاية من مصفوفة في الذاكرة — عشان استبدالها
 *     بـRPC لاحقًا ما يستلزمش أي تعديل واجهة (شوف getDiscoveryBazaars).
 *
 * ── قيد تحميل ──────────────────────────────────────────────────────
 * الملف ده بيتحمّل على /bazaars/ كمان، واللي **مش** بيحمّل space-model.js.
 * فممنوع أي اعتماد عليه — ولذلك _discToLatinDigits مكرّرة هنا عمدًا
 * (٦ أسطر) بدل استيراد _toLatinDigits. وكل الأسماء هنا مبدوءة بـ
 * disc/DISCOVERY لتفادي تصادم const على مستوى الـglobal scope.
 *
 * حمّلها بـ <script src="/shared/discovery.js" defer></script>.
 */

/* ════════════════════════════════════════════════════════════════
   ١) تطبيع النص العربي — أساس كل مطابقة في الملف
   ════════════════════════════════════════════════════════════════ */

/** أرقام عربية/فارسية → لاتينية. مكرّرة عمدًا (شوف قيد التحميل فوق). */
function _discToLatinDigits(str) {
  if (!str) return '';
  const arabic = '٠١٢٣٤٥٦٧٨٩';
  const persian = '۰۱۲۳۴۵۶۷۸۹';
  return String(str).replace(/[٠-٩۰-۹]/g, d => {
    const ai = arabic.indexOf(d);
    return ai > -1 ? String(ai) : String(persian.indexOf(d));
  });
}

/**
 * يطبّع نصًّا عربيًا للمطابقة: تشكيل، همزات، تاء مربوطة، ألف مقصورة، أرقام.
 * من غيرها «الملابس» ما بتطابقش «ملابس» و«٦ أكتوبر» ما بتطابقش «6 اكتوبر».
 */
function _discNormAr(str) {
  if (!str) return '';
  return _discToLatinDigits(str)
    .replace(/[ً-ْـ]/g, '')   // تشكيل + تطويل
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** يشيل الإيموجي من تسمية الكتالوج («🍰 حلويات ومخبوزات» → «حلويات ومخبوزات»). */
function _discStripEmoji(str) {
  if (!str) return '';
  return String(str).replace(/[\p{Extended_Pictographic}️‍]/gu, '').trim();
}

/** تاريخ اليوم بتوقيت القاهرة بصيغة YYYY-MM-DD — نفس منطق _cairoTodayStr في bazaars/app.js. */
function discoveryTodayCairo() {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}


/* ════════════════════════════════════════════════════════════════
   ٢) جسر الأنشطة — space_activities.id ← → مفردات البازارات
   ════════════════════════════════════════════════════════════════
   المساحات بتخزّن ids من جدول space_activities. البازارات مالهاش عمود
   أنشطة إطلاقًا — عندها `category` نص حر يكتبه المنظّم، و`name`/`description`.
   وقائمة الأنشطة في استمارة حجز البازار (bazaars/index.html) قيم عربية خام
   مختلفة الصياغة تمامًا.

   الخريطة دي بتغطّي **الفروق في الصياغة فقط**. الاسم العربي للنشاط نفسه
   بيتضاف تلقائيًا ككلمة مطابقة في bazaarActivityKeywords()، فنشاط جديد
   يضيفه الأدمن (وspaces-hub بتسمح بذلك بـslugify لأي نص) بيفضل بيطابق
   على اسمه من غير ما حد يعدّل الملف ده. الخريطة بتفضل صغيرة وما بتتقادمش.

   سابقة النمط في المستودع: EQ_CATEGORY_ALIASES / eqNormCat في market/app.js. */
const DISCOVERY_ACT_ALIASES = Object.freeze({
  coffee:  ['قهوه', 'مشروبات', 'كافيه', 'كافيتريا', 'اكل ومشروبات', 'مشروب', 'coffee'],
  food:    ['اكل', 'سندوتشات', 'ساندويتش', 'مطعم', 'فاست فود', 'وجبات', 'اكل ومشروبات', 'food'],
  sweets:  ['حلويات', 'مخبوزات', 'حلواني', 'تورت', 'كيك', 'بيكري', 'دسرت'],
  juice:   ['عصائر', 'عصير', 'ايس كريم', 'ايسكريم', 'مثلجات', 'اكل ومشروبات'],
  popcorn: ['فشار', 'سناكس', 'سناك', 'مقرمشات', 'بوب كورن'],
  fashion: ['ملابس', 'ازياء', 'موضه', 'بوتيك', 'فاشون', 'لبس'],
  access:  ['اكسسوارات', 'اكسسوار', 'مجوهرات', 'فضه', 'فضيات', 'دهب'],
  watches: ['ساعات', 'نظارات', 'ساعه', 'نضارات'],
  kids:    ['اطفال', 'العاب اطفال', 'العاب', 'بيبي', 'مستلزمات اطفال', 'ملابس اطفال'],
  beauty:  ['عنايه شخصيه', 'عنايه', 'جمال', 'عطور', 'مكياج', 'تجميل', 'بيوتي', 'سكين كير'],
  tech:    ['الكترونيات', 'تقنيه', 'موبايلات', 'اجهزه', 'تك'],
  books:   ['كتب', 'قرطاسيه', 'مكتبه', 'ادوات مكتبيه'],
  sports:  ['رياضه', 'لياقه', 'جيم', 'رياضي', 'سبورت'],
  flowers: ['ورود', 'هدايا', 'زهور', 'بوكيه', 'ديكور', 'مستلزمات منزليه'],
  vending: ['vending', 'ماكينه', 'ماكينات', 'فيندنج'],
  // «أخرى» تطابق فقط إعلانًا يصف نفسه بأخرى أو متنوع.
  other:   ['اخرى', 'متنوع', 'other'],
});

/**
 * كلمات المطابقة لنشاط معيّن على جانب البازارات.
 * @param {string} actId        — id من space_activities
 * @param {string} catalogLabel — تسمية الكتالوج الحيّة («🍰 حلويات ومخبوزات») إن وُجدت
 * @returns {string[]} كلمات مطبَّعة (فاضية = لا فلترة بالنشاط)
 */
function bazaarActivityKeywords(actId, catalogLabel) {
  if (!actId) return [];
  const base = DISCOVERY_ACT_ALIASES[actId] || [];
  const extra = catalogLabel ? [_discStripEmoji(catalogLabel)] : [];
  const seen = Object.create(null);
  return base.concat(extra)
    .map(_discNormAr)
    .filter(k => k && k.length > 2 && !seen[k] && (seen[k] = 1));
}

/** هل البازار ده يطابق كلمات النشاط؟ (على category + name + description). */
function bazaarMatchesActivity(b, keywords) {
  if (!keywords || !keywords.length) return false;
  const hay = _discNormAr([b.category, b.name, b.description].filter(Boolean).join(' '));
  if (!hay) return false;
  return keywords.some(k => hay.indexOf(k) > -1);
}

/**
 * ترتيب ناعم بالنشاط — **لا يحذف أي صفّ**. المطابق يتقدّم فقط.
 * فرز مستقر: Array.prototype.sort مستقر في كل المتصفحات الحديثة.
 */
function rankBazaarsByActivity(rows, keywords) {
  if (!keywords || !keywords.length) return rows;
  return rows.slice().sort((a, b) =>
    (bazaarMatchesActivity(a, keywords) ? 0 : 1) - (bazaarMatchesActivity(b, keywords) ? 0 : 1)
  );
}


/* ════════════════════════════════════════════════════════════════
   ٣) جسر المناطق — space_areas مقابل نص region الحر في البازارات
   ════════════════════════════════════════════════════════════════
   المساحات بتفلتر بمطابقة تامّة على space_areas.name (داخل search_public_spaces).
   البازارات بتفلتر بسلسلة فرعية على region/location — والمنظّم بيكتب المنطقة
   بإيده، فالإملاء بيتفاوت. الخريطة دي بتغطّي التفاوت الشائع. */
const DISCOVERY_REGION_ALIASES = Object.freeze({
  '6 أكتوبر':      ['6 اكتوبر', 'اكتوبر', 'السادس من اكتوبر', 'مدينه 6 اكتوبر'],
  'التجمع الخامس': ['التجمع', 'القاهره الجديده', 'التجمع الخامس'],
  'مصر الجديدة':   ['مصر الجديده', 'هليوبوليس', 'heliopolis'],
  'الشيخ زايد':    ['الشيخ زايد', 'زايد'],
  'مدينة نصر':     ['مدينه نصر', 'نصر سيتي'],
  'المهندسين':     ['المهندسين'],
  'الزمالك':       ['الزمالك'],
});

/** كل الصيغ المقبولة لمنطقة (المُدخل نفسه + مرادفاته)، مطبَّعة. */
function _discRegionCandidates(region) {
  const norm = _discNormAr(region);
  if (!norm) return [];
  const out = [norm];
  Object.keys(DISCOVERY_REGION_ALIASES).forEach(key => {
    const keyNorm = _discNormAr(key);
    const aliases = DISCOVERY_REGION_ALIASES[key].map(_discNormAr);
    /* المُدخل ممكن يكون المفتاح نفسه أو أي مرادف — الاتنين يفتحوا نفس المجموعة */
    if (keyNorm === norm || aliases.indexOf(norm) > -1) {
      out.push(keyNorm);
      aliases.forEach(a => out.push(a));
    }
  });
  return out.filter((v, i) => v && out.indexOf(v) === i);
}

/** هل البازار في المنطقة دي؟ مطابقة سلسلة فرعية على region/location/venue_address. */
function bazaarMatchesRegion(b, region) {
  const cands = _discRegionCandidates(region);
  if (!cands.length) return true;
  const hay = _discNormAr([b.region, b.location, b.venue_address].filter(Boolean).join(' '));
  if (!hay) return false;
  return cands.some(c => hay.indexOf(c) > -1);
}

/** كتالوج المناطق المشترك — نفس مصدر #f-region و#mp-region-areas-group. */
async function fetchAreasCatalog(sbClient) {
  if (!sbClient) return [];
  const { data, error } = await sbClient
    .from('space_areas')
    .select('name')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return (data || []).map(a => a.name).filter(Boolean);
}


/* ════════════════════════════════════════════════════════════════
   ٤) الترشيح — «مش متأكد» بسؤال واحد لا استبيان
   ════════════════════════════════════════════════════════════════ */

/**
 * سؤال واحد بس: بتجرّب ولا بتثبّت؟ — لأنه المحور اللي بيفصل العائلتين فعلًا.
 * سؤال المدة اتشال عمدًا: النية نفسها بترمّز المدة (ثابت = شهور، بازار = أيام)،
 * وسؤال زيادة بيحوّل الاكتشاف لاستبيان.
 * @returns {'bazaar'|'fixed'|null} — null = ما جاوبش، تُعرض العائلتان.
 */
function recommendFamily(answers) {
  const c = answers && answers.helpChoice;
  if (c === 'test') return 'bazaar';
  if (c === 'fixed') return 'fixed';
  return null;
}


/* ════════════════════════════════════════════════════════════════
   ٥) مخطّط بارامترات الرابط — المصدر الموحّد (المبدأ ١)
   ════════════════════════════════════════════════════════════════ */

const DISCOVERY_PARAM_KEYS = Object.freeze(
  ['intent', 'region', 'act', 'type', 'max', 'from', 'to', 'q', 'sort']
);

/** البارامترات اللي كل هدف بيفهمها فعلًا — الباقي بيتساقط بدل ما يوهم. */
const DISCOVERY_TARGET_FIELDS = Object.freeze({
  home:    ['intent', 'region', 'act', 'type', 'max'],
  spaces:  ['intent', 'region', 'act', 'type', 'max', 'sort'],
  bazaars: ['intent', 'region', 'act', 'max', 'from', 'to', 'q', 'sort'],
});

/** أي عائلة بيخدمها كل هدف — يحدّد إسقاط max عند التبديل. */
const DISCOVERY_TARGET_FAMILY = Object.freeze({
  spaces: 'fixed', bazaars: 'bazaar', home: null,
});

const DISCOVERY_INTENTS = Object.freeze(['fixed', 'bazaar', 'help']);

/** يقرأ بارامترات الاكتشاف من querystring (الحالي افتراضيًا). */
function readDiscoveryParams(search) {
  const p = new URLSearchParams(
    search != null ? search : (typeof window !== 'undefined' ? window.location.search : '')
  );
  const out = {};
  DISCOVERY_PARAM_KEYS.forEach(k => {
    const v = (p.get(k) || '').trim();
    if (v) out[k] = v;
  });
  if (out.intent && DISCOVERY_INTENTS.indexOf(out.intent) === -1) delete out.intent;
  if (out.max != null) {
    const n = parseInt(_discToLatinDigits(out.max), 10);
    if (isFinite(n) && n > 0) out.max = String(n); else delete out.max;
  }
  return out;
}

/** هل في أي بارامتر اكتشاف فعلي؟ (intent وحدها لا تُعتبر فلترة) */
function hasAnyDiscoveryParam(p) {
  if (!p) return false;
  return Object.keys(p).some(k => k !== 'intent' && p[k]);
}

/**
 * يبني رابطًا عميقًا لهدف معيّن مع حمل الفلاتر المفهومة له فقط.
 *
 * ⚠️ `max` بيتساقط عند تبديل العائلة عمدًا: ٨٠٠٠ج/شهر لركن ثابت و٨٠٠٠ج/مكان
 * في بازار مش نفس الرقم. نقله بصمت بينتج نتائج غلط بثقة.
 *
 * @param {'home'|'spaces'|'bazaars'} target
 * @param {object} state — {family, intent, region, act, type, max, from, to, q, sort}
 */
function buildDiscoveryUrl(target, state) {
  const base = target === 'spaces' ? '/spaces/' : target === 'bazaars' ? '/bazaars/' : '/';
  const allowed = DISCOVERY_TARGET_FIELDS[target] || [];
  const targetFamily = DISCOVERY_TARGET_FAMILY[target];
  const st = state || {};
  const qs = new URLSearchParams();

  allowed.forEach(k => {
    let v = st[k];
    if (v == null || v === '') return;
    if (k === 'max' && targetFamily && st.family && st.family !== targetFamily) return;
    qs.set(k, String(v));
  });
  if (targetFamily) qs.set('intent', targetFamily);

  const s = qs.toString();
  return s ? base + '?' + s : base;
}

/** يبني querystring الرئيسية للحالة الحالية (المبدأ ١ — replaceState). */
function buildHomeDiscoveryQuery(state) {
  const url = buildDiscoveryUrl('home', state);
  const i = url.indexOf('?');
  return i > -1 ? url.slice(i) : '';
}


/* ════════════════════════════════════════════════════════════════
   ٦) تعبئة الفلاتر من البارامترات — كل صفحة وعناصرها
   ════════════════════════════════════════════════════════════════ */

function _discSetSelect(id, value) {
  const el = document.getElementById(id);
  if (!el || !value) return false;
  const has = Array.prototype.some.call(el.options, o => o.value === value);
  if (!has) return false;
  el.value = value;
  return true;
}

/**
 * يعبّي فلاتر /spaces/ من بارامترات الاكتشاف.
 * ⚠️ لازم تتنادى **بعد** بناء خيارات المناطق والأنشطة، وإلا ضبط .value بيفشل بصمت.
 * @returns {{applied:string[], dropped:string[]}}
 */
function applyDiscoveryParamsToSpaces(p) {
  const applied = [], dropped = [];
  if (!p) return { applied, dropped };

  /* المنطقة: مطابقة تامّة في search_public_spaces(p_region) — فمنطقة بلا خيار
     مطابق **تُسقَط ولا تُحقن**، وإلا المستخدم بياخد صفرًا محيّرًا. */
  if (p.region) (_discSetSelect('mp-region', p.region) ? applied : dropped).push('region');
  if (p.act)    (_discSetSelect('mp-act-sel', p.act) ? applied : dropped).push('act');
  if (p.type)   (_discSetSelect('mp-place-sel', p.type) ? applied : dropped).push('type');
  if (p.sort)   (_discSetSelect('mp-sort', p.sort) ? applied : dropped).push('sort');

  if (p.max) {
    const sl = document.getElementById('mp-slider-max');
    if (sl) {
      const cap = parseInt(sl.max, 10) || 50000;
      sl.value = String(Math.min(parseInt(p.max, 10), cap));
      applied.push('max');
    } else dropped.push('max');
  }
  return { applied, dropped };
}

/**
 * يعبّي فلاتر /bazaars/ من بارامترات الاكتشاف.
 *
 * لا يكتب act في البحث الحر: النشاط يبقى فلترًا مستقلًا قابلًا للمسح.
 *
 * المنطقة تُحقن لو مالهاش خيار؛ applyBzFilters يستخدم التطبيع العربي
 * والمرادفات نفسها المستخدمة في معاينة الرئيسية.
 *
 * @returns {{applied:string[], dropped:string[], actId:string|null}}
 */
function applyDiscoveryParamsToBazaars(p) {
  const applied = [], dropped = [];
  if (!p) return { applied, dropped, actId: null };

  if (p.region) {
    const el = document.getElementById('bz-region');
    if (el) {
      if (!Array.prototype.some.call(el.options, o => o.value === p.region)) {
        const opt = document.createElement('option');
        opt.value = p.region; opt.textContent = p.region;
        el.appendChild(opt);
      }
      el.value = p.region;
      applied.push('region');
    } else dropped.push('region');
  }

  ['from:bz-date-from', 'to:bz-date-to', 'q:bz-search'].forEach(pair => {
    const [key, id] = pair.split(':');
    if (!p[key]) return;
    const el = document.getElementById(id);
    if (el) { el.value = p[key]; applied.push(key); } else dropped.push(key);
  });

  if (p.sort) (_discSetSelect('bz-sort', p.sort) ? applied : dropped).push('sort');

  if (p.max) {
    const sl = document.getElementById('bz-slider-max');
    if (sl) {
      const cap = parseInt(sl.max, 10) || 10000;
      sl.value = String(Math.min(parseInt(p.max, 10), cap));
      applied.push('max');
    } else dropped.push('max');
  }

  return { applied, dropped, actId: p.act || null };
}

/** يقرأ حالة الاكتشاف الحالية من DOM صفحة /spaces/ — لزر «بدّل العائلة». */
function discoveryStateFromSpacesDom() {
  const g = id => (document.getElementById(id)?.value || '');
  const sl = document.getElementById('mp-slider-max');
  const max = sl ? parseInt(sl.value, 10) : NaN;
  const cap = sl ? (parseInt(sl.max, 10) || 50000) : 50000;
  return {
    family: 'fixed',
    intent: 'fixed',
    region: g('mp-region'),
    act:    g('mp-act-sel'),
    type:   g('mp-place-sel'),
    max:    (isFinite(max) && max < cap) ? String(max) : '',
  };
}

/** يقرأ حالة الاكتشاف الحالية من DOM صفحة /bazaars/ — لزر «بدّل العائلة». */
function discoveryStateFromBazaarsDom(actId) {
  const g = id => (document.getElementById(id)?.value || '');
  const sl = document.getElementById('bz-slider-max');
  const max = sl ? parseInt(sl.value, 10) : NaN;
  const cap = sl ? (parseInt(sl.max, 10) || 10000) : 10000;
  return {
    family: 'bazaar',
    intent: 'bazaar',
    region: g('bz-region'),
    act:    actId || '',
    max:    (isFinite(max) && max < cap) ? String(max) : '',
    from:   g('bz-date-from'),
    to:     g('bz-date-to'),
  };
}


/* ════════════════════════════════════════════════════════════════
   ٧) تعاقد البحث في البازارات — تجريد مصدر البيانات (المبدأ ٣)
   ════════════════════════════════════════════════════════════════ */

/** مزوّد الصفوف — V1 فقط. تسجّله الصفحة مرة واحدة. */
let _discBazaarSource = null;

/**
 * يسجّل مصدر صفوف البازارات.
 * الرئيسية:  setDiscoveryBazaarSource(() => _bazaarsPromise.then(() => BAZAARS));
 * /bazaars/: setDiscoveryBazaarSource(async () => BAZAARS);
 *
 * موجودة عشان الواجهة **ما تعرفش** من فين البيانات جاية. عند الانتقال لـRPC
 * الدالة دي بتبقى بلا أثر ولا سطر واجهة واحد بيتغيّر.
 */
function setDiscoveryBazaarSource(fn) { _discBazaarSource = fn; }

/**
 * البحث الموحّد في البازارات — نفس شكل تعاقد searchPublicSpaces().
 *
 * @param {object} filters
 *   region?        منطقة (مطابقة مرادفات + سلسلة فرعية)
 *   activityKeywords? string[] — مطابقة التصنيف/العنوان/الوصف المنشور
 *   maxPrice?      حد أقصى لسعر المكان
 *   availableOnly? بها أماكن متاحة فقط
 *   excludeId?     استبعاد بازار (البازار المميّز في التيزر مثلًا)
 *   limit?         عدد المعروض (الافتراضي ٣)
 *
 * @returns {Promise<{items:Array, totalCount:number, poolCount:number}>}
 *   totalCount — الإجمالي المطابق **قبل** الـlimit، عشان العدّاد و«عرض الكل» يبقوا صادقين
 *   poolCount  — البازارات الحيّة/القادمة **قبل** أي فلتر مستخدم، عشان نفرّق
 *                «مفيش نتائج بالفلتر» عن «مفيش بازارات أصلًا» (المبدأ ٥ في الخطة)
 *
 * ── V2 (بلا أي تعديل واجهة) ──────────────────────────────────────
 * لو عدد البازارات كبر، استبدل جسم الدالة بـ:
 *   const { data, error } = await sbClient.rpc('get_discovery_bazaars', {
 *     p_region, p_activities, p_max_price, p_from, p_to,
 *     p_available_only, p_limit, p_offset });
 * على أن ترجّع الصفوف + total_count + pool_count — نفس نمط search_public_spaces.
 * كل المستدعين هنا بيقروا {items,totalCount,poolCount} وبس.
 */
async function getDiscoveryBazaars(filters) {
  const f = filters || {};
  const rows = _discBazaarSource ? (await _discBazaarSource()) : [];
  return _discFilterRankBazaars(Array.isArray(rows) ? rows : [], f);
}

/* حالات لا تُعتبر «بازارًا قابلًا للحجز» مهما كانت تواريخه.
   بينفصلوا عن فحص التاريخ عمدًا: بازار متعلَّم completed وتاريخ نهايته في
   المستقبل (تأجيل/إغلاق مبكر) كان هيتحسب بيانات حيّة لو الفحص بالتاريخ وحده،
   فتظهر «مفيش نتائج بالفلتر» بدل «مفيش بازارات متاحة» — وده يوجّه المستخدم غلط. */
const DISCOVERY_DEAD_STATUSES = Object.freeze(
  ['completed', 'cancelled', 'draft', 'pending_review', 'rejected']
);

/**
 * هل البازار قابل للعرض/الحجز اليوم؟ شرطان لازمان معًا:
 *   ١) حالته ليست من الحالات الميتة أعلاه
 *   ٢) لم ينتهِ تاريخه (بازار بلا تواريخ يُعتبر مفتوحًا)
 */
function isBookableBazaar(b, today) {
  if (!b) return false;
  const t = today || discoveryTodayCairo();
  if (b.status && DISCOVERY_DEAD_STATUSES.indexOf(String(b.status)) > -1) return false;
  const end = b.date_end || b.date_start || '';
  return !end || end >= t;
}

/** الفلترة/الترتيب النقيّة — تُستبدل كليًا في V2 بمنطق القاعدة. */
function _discFilterRankBazaars(rows, f) {
  const today = discoveryTodayCairo();

  /* المجموعة الأساسية = البازارات القابلة للحجز فعليًا. poolCount المحسوب منها
     هو اللي بيفرّق «مفيش بازارات متاحة حاليًا» عن «مفيش نتائج تطابق اختياراتك». */
  let pool = rows.filter(b => isBookableBazaar(b, today));
  if (f.excludeId) pool = pool.filter(b => String(b.id) !== String(f.excludeId));

  const poolCount = pool.length;

  let data = pool;
  if (f.region) data = data.filter(b => bazaarMatchesRegion(b, f.region));
  if (f.activityKeywords?.length) data = data.filter(b => bazaarMatchesActivity(b, f.activityKeywords));
  if (f.availableOnly) {
    data = data.filter(b => {
      const avail = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
      return avail > 0 || !b.total_slots;
    });
  }
  if (f.maxPrice != null) {
    data = data.filter(b => (Number(b.price_per_slot) || 0) <= f.maxPrice);
  }

  const totalCount = data.length;

  /* بعد الفلترة: الجاري الآن أولًا ثم الأقرب موعدًا، ثم درجة مطابقة النشاط. */
  const timeRank = b => {
    const start = b.date_start || '';
    return (start && start <= today) ? 0 : 1;
  };
  data = data.slice().sort((a, b) =>
    (timeRank(a) - timeRank(b)) ||
    String(a.date_start || '').localeCompare(String(b.date_start || ''))
  );
  data = rankBazaarsByActivity(data, f.activityKeywords);

  const limit = f.limit != null ? f.limit : 3;
  return { items: limit > 0 ? data.slice(0, limit) : data, totalCount, poolCount };
}
