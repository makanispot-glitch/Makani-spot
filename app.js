/* ================================================================
   📁 app.js — الطبقة الثالثة: السلوك والوظائف
   ================================================================
   🧠 هذا الملف مسؤول عن كل ما يتحرك في الموقع:
      - تحميل بيانات المساحات من Supabase
      - نظام تسجيل الدخول عبر Supabase
      - عرض الكروت والفلاتر
      - مودال الحجز وإرسال البيانات
      - صفحة الماركت بليس (كل المساحات)
      - صفحة تفاصيل المساحة الرئيسية + المساحات الفرعية  ← جديد
      - لوحة التحكم: تعديل البيانات، الحجوزات، التقييمات

   📌 كيف تعدّل؟
      - لتغيير إعدادات Supabase: غيّرها في shared/sb-config.js
   ================================================================ */


/* ================================================================
   ⚙️ القسم الأول: إعدادات وروابط المنصة
   (هنا كل الروابط المهمة — عدّلها من هنا فقط)
   ================================================================ */

/**
 * 🎪 رابط Google Apps Script لبيانات البازارات من Google Sheets
 * كل مرة تحدّث الشيت وترفعه، بيانات البازارات بتظهر تلقائياً على الموقع
 */
const BAZAAR_SHEET_URL = "https://script.google.com/macros/s/AKfycbwb0eB118CzrlByCAn2ESbF-6md7h1E-pTJtIph8jfYfeZTkY7GAJNM5RPSNHxbFsqOcA/exec";

/**
 * 🔐 إعدادات Supabase — قاعدة بيانات المستخدمين
 * هذه البيانات من لوحة تحكم Supabase الخاصة بك
 */
/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */

/* ══════════════════════════════════════════════════════
   📊  SPACE ANALYTICS TRACKING
   يتتبع مشاهدات البطاقات والضغطات على "تفاصيل"
   مرة واحدة لكل مساحة لكل جلسة متصفّح
   ══════════════════════════════════════════════════════ */
const _ANALYTICS_SID = (() => {
  try {
    let s = sessionStorage.getItem('ms_asid');
    if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('ms_asid', s); }
    return s;
  } catch { return 'x' + Date.now(); }
})();
const _analyticsViewed  = new Set();
const _analyticsClicked = new Set();

async function _trackSpaceEvent(spaceId, ownerId, eventType) {
  if (!spaceId || !ownerId) return;
  if (eventType === 'view'         && _analyticsViewed.has(spaceId))  return;
  if (eventType === 'detail_click' && _analyticsClicked.has(spaceId)) return;
  if (eventType === 'view')         _analyticsViewed.add(spaceId);
  if (eventType === 'detail_click') _analyticsClicked.add(spaceId);
  try {
    fetch(SUPABASE_URL + '/rest/v1/space_analytics', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_KEY, 'Authorization':'Bearer '+SUPABASE_KEY, 'Prefer':'return=minimal' },
      body: JSON.stringify({ space_id:spaceId, owner_id:ownerId, event_type:eventType, session_id:_ANALYTICS_SID })
    });
  } catch {}
}

let _cardObserver = null;
function _initCardViewTracking() {
  if (!window.IntersectionObserver) return;
  if (_cardObserver) _cardObserver.disconnect();
  _cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const card = e.target;
        _trackSpaceEvent(card.dataset.sid, card.dataset.oid, 'view');
        _cardObserver.unobserve(card);
      }
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('.space-card[data-sid]').forEach(c => _cardObserver.observe(c));
}


/* ================================================================
   🗄️ القسم الثاني: المتغيرات العامة
   (بيانات تُحفظ مؤقتاً أثناء تشغيل الصفحة)
   ================================================================ */

let heroItems = [];    // أهم 6 مساحات المعروضة حاليًا في هيرو الرئيسية
let ACTIVITIES = [];    // قائمة الأنشطة التجارية
let activeTab = '';    // التبويب النشط حالياً (مول / نادي / مدرسة)
let selectedAct = '';    // النشاط المحدد في الفلتر
let sbClient = null;  // كائن Supabase يُهيَّأ عند التحميل
let currentUser = null;  // بيانات المستخدم المسجّل حالياً
let currentProfile = null;  // بيانات الـ profile من قاعدة البيانات
let currentAvatarUrl = null; // 🪪 المصدر الموحّد: profiles.avatar_url
let _authRedirect = false; // هل وصلنا من redirect مصادقة (Google OAuth / تأكيد بريد)؟
//   يُلتقط من الـ URL عند التحميل — هو الحالة الوحيدة التي يُسمح فيها
//   بالتحويل التلقائي للداشبورد دون فعل صريح من المستخدم

// ── متغيرات خاصة بصفحة الماركت بليس ──
let mpPage = 1;      // رقم الصفحة الحالية في الماركت بليس
const MP_PER_PAGE = 12;     // عدد المساحات في كل صفحة
let mpCurrentItems = [];     // مساحات الصفحة الحالية (من الخادم مباشرة)
let mpTotalCount = 0;     // إجمالي المطابق فعليًا في القاعدة (للترقيم)
let mpActiveTypes = [];     // أنواع المكان المفلترة حالياً (mall / club / school)
let mpActiveActs = [];     // الأنشطة المفلترة حالياً

// ── متغيرات خاصة بصفحة تفاصيل المساحة ── (جديد)
let currentSpaceDetail = null;  // المساحة الرئيسية المعروضة حالياً في صفحة التفاصيل
let detailPrevPage = 'market'; // الصفحة السابقة للرجوع إليها من التفاصيل
let currentBookingSpace = null; // المساحة المختارة في مودال الحجز (لالتقاط owner_id/space_id)

// ── متغيرات خاصة بنظام البازارات ──
let BAZAARS = [];          // قائمة البازارات المحمّلة من الشيت / Supabase

// ── متغيرات نظام الـ Slider (سلايدر الصور) ──
// يُستخدم في: كروت المساحات (الهوم + الماركت) + صفحة التفاصيل
const _sliders = {};  // يحفظ حالة كل سلايدر { index, images, autoTimer }
//   المفتاح = معرّف فريد لكل سلايدر (مثل: "card-5" أو "detail-5")


/* ================================================================
   📊 القسم 2.5: Google Analytics 4 — تتبع الأحداث
   ================================================================ */

function trackEvent(eventName, params = {}) {
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
}


/* ================================================================
   🚀 القسم الثالث: نقطة البداية (تشغيل الموقع)
   ================================================================ */

/**
 * يُشغَّل هذا الكود فور انتهاء تحميل الصفحة
 * يهيّئ Supabase ويحمّل البيانات ويُشغّل مؤشر السعر
 */
document.addEventListener('DOMContentLoaded', function () {

  // تهيئة Supabase
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.warn('⚠️ Supabase غير محمّل بعد — تأكد من تضمين مكتبته قبل app.js');
  }

  // التقاط العودة من redirect مصادقة قبل أن تستهلك مكتبة Supabase بيانات الـ URL
  // (implicit flow يستخدم #access_token، و PKCE flow يستخدم ?code=)
  _authRedirect = (window.location.hash || '').includes('access_token') ||
    new URLSearchParams(window.location.search).has('code');

  // تحميل بيانات المساحات من Google Sheets
  loadData();
  subscribeSpacesRealtime();

  // تحميل البازارات من Supabase (كاش عام لأسماء/أسعار البازارات — يستخدمه قسم حجوزات المستخدم)
  loadBazaars();

  // اختيار وعرض بازار الصفحة الرئيسية — مصدر قرار مستقل تمامًا (get_homepage_featured_bazaar)
  loadHomeFeaturedBazaar();

  // تحميل المشروعات المعروضة للبيع المتميزة
  loadMarketShowcase();

  // تحقق من حالة تسجيل الدخول
  initAuth();

  // تهيئة مؤشر السعر في الصفحة الرئيسية
  initPriceSlider();

  // التنقل المباشر عبر URL parameter: /?p=market أو /?p=dashboard إلخ
  const urlPage = new URLSearchParams(window.location.search).get('p');
  if (urlPage) {
    if (['home', 'how', 'owner', 'pricing', 'login', 'signup'].includes(urlPage)) {
      showPage(urlPage);
    } else if (urlPage === 'market') {
      window.location.replace('/spaces/');
    } else if (urlPage === 'owner-profile') {
      // 🪪 صفحة البروفايل العام الموحّد: /?p=owner-profile&id=UUID
      const pid = new URLSearchParams(window.location.search).get('id');
      showPage('owner-profile');
      loadOwnerProfile(pid);
    }
    // dashboard يُعالَج في initAuth بعد التحقق من الجلسة
  }

  // تشغيل animation المسارات عند الظهور في الشاشة
  initPathAnimation();
});

/* ================================================================
   ✨ Animation: ظهور بطاقات المسارات والعناصر التفاعلية عند التمرير
   ================================================================ */
function initPathAnimation() {
  if (!window.IntersectionObserver) {
    /* fallback للمتصفحات القديمة: أظهر الكل فوراً */
    document.querySelectorAll('.path-anim').forEach(el => el.classList.add('path-in'));
    document.querySelectorAll('.reveal-on-scroll').forEach(el => el.classList.add('revealed'));
    return;
  }

  // 1. مراقبة بطاقات المسارات (Path Cards)
  const pathObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('path-in');
        pathObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.path-anim').forEach(el => pathObs.observe(el));

  // 2. مراقبة أقسام الصفحة الرئيسية (Scroll Reveal)
  const revealObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('revealed');
        revealObs.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal-on-scroll').forEach(el => revealObs.observe(el));
}


/* ================================================================
   🎚️ القسم الرابع: مؤشر السعر (Slider) — الصفحة الرئيسية
   ================================================================ */

/**
 * يُهيّئ مؤشر السعر في الصفحة الرئيسية — نقطة واحدة (الحد الأقصى)
 * الحد الأدنى ثابت دائماً عند الصفر
 */
function initPriceSlider() {
  const sliderMax = document.getElementById('slider-max');
  if (!sliderMax) return;
  sliderMax.addEventListener('input', updateMainSlider);
  updateMainSlider();
}

/**
 * يحدّث مظهر الشريط والتسمية عند تحريك المؤشر (نقطة واحدة)
 */
function updateMainSlider() {
  const sliderMax = document.getElementById('slider-max');
  if (!sliderMax) return;

  const max = parseInt(sliderMax.value);
  const range = parseInt(sliderMax.max) || 50000;
  const maxPercent = (max / range) * 100;

  const track = document.getElementById('slider-track');
  if (track) {
    // RTL: min=يمين → max=يسار، البرتقالي يملأ من اليمين حتى المؤشر
    track.style.background =
      `linear-gradient(to right, #e8e8e8 ${100 - maxPercent}%, #FF6B00 ${100 - maxPercent}%)`;
  }

  const maxLabel = document.getElementById('price-max-label');
  if (maxLabel) {
    maxLabel.textContent = max >= 50000 ? 'بلا حد' : Number(max).toLocaleString('ar-EG') + ' ج';
  }
}


/* ================================================================
   📊 القسم الخامس: تحميل البيانات من Google Sheets
   ================================================================ */

/**
 * يجيب المساحات والأنشطة من Google Sheets عبر Apps Script
 * يُعرض مؤشر تحميل أثناء الانتظار
 * بعد التحميل يعرض أول 6 مساحات في الهوم فقط
 *
 * 📌 بنية البيانات المتوقعة من الشيت (المحدّثة):
 *   json.spaces[i] = {
 *     id, name, loc, type, price, sizes[], acts[], allActs,
 *     badge, badgeClass, season, insight, image, icon, thumbClass,
 *
 *     // حقول جديدة للمساحات الرئيسية:
 *     extraImages: ["url1","url2",...],   // صور إضافية للمساحة الرئيسية
 *     description: "نص وصف مفصّل",
 *     amenities:   ["واي فاي","كهرباء",...], // المرافق المتاحة
 *     subSpaces: [                         // المساحات الفرعية داخل هذا المكان
 *       {
 *         unitId:      "A1",               // رقم/كود الوحدة
 *         name:        "وحدة A1",
 *         location:    "قريب من المدخل",   // وصف موقعها الدقيق
 *         size:        "٢×٢ م",
 *         price:       2500,
 *         status:      "available" | "rented" | "reserved",
 *         image:       "url أو فاضي",
 *         floor:       "الدور الأرضي",
 *         notes:       "بجانب المصعد",
 *       }, ...
 *     ]
 *   }
 */
async function loadData() {
  showLoadingState('spaces-grid');
  try {
    // تحميل الأنشطة من Supabase
    const { data: activitiesData, error: actErr } = await sbClient
      .from('space_activities')
      .select('id, emoji, name_ar')
      .eq('is_active', true)
      .order('sort_order');
    if (actErr) throw actErr;
    ACTIVITIES = (activitiesData || []).map(a => ({
      id: a.id,
      label: `${a.emoji || ''} ${a.name_ar}`.trim(),
    }));

    buildActivityFilters();
    buildModalActivityPicker();
    buildMpActivityFilters();

    // المساحات المنشورة تُجلب من الخادم مباشرة (بحث/فلترة/ترتيب/ترقيم خادمي —
    // shared/space-model.js) — الهيرو (أهم 6) والشبكة الكاملة مستقلان ومتوازيان
    await Promise.all([filterAndRender(), loadMarketplacePage()]);
    setTimeout(() => csInitAll(), 120);

  } catch (err) {
    showErrorState(err.message || 'خطأ في تحميل البيانات', 'spaces-grid');
  }
}

async function silentRefreshSpaces() {
  if (document.hidden || !sbClient) return;
  try {
    await filterAndRender();
    const isMarketplaceActive = document.getElementById('pg-market')?.classList.contains('active');
    if (isMarketplaceActive) await loadMarketplacePage();
  } catch (_) {
    /* silent refresh intentionally keeps the current UI if the network blips */
  }
}

function subscribeSpacesRealtime() {
  if (!sbClient) return;
  let debounce = null;
  const refresh = () => {
    clearTimeout(debounce);
    debounce = setTimeout(silentRefreshSpaces, 1500);
  };
  sbClient.channel('spaces-home-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'space_units' }, refresh)
    .subscribe();
  setInterval(silentRefreshSpaces, 300000);
}

/**
 * يعرض شاشة التحميل داخل أي grid
 */
function showLoadingState(gridId) {
  const grid = document.getElementById(gridId || 'spaces-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px;display:inline-block;animation:spin 1.2s linear infinite">⏳</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:6px">جاري تحميل البيانات…</div>
      <div style="font-size:13px;color:var(--ink3)">لحظة صغيرة…</div>
    </div>`;
}

/**
 * يعرض شاشة الخطأ مع زرار "حاول تاني"
 */
function showErrorState(msg, gridId) {
  const grid = document.getElementById(gridId || 'spaces-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px">⚠️</div>
      <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:8px">في مشكلة في تحميل البيانات</div>
      <div style="font-size:13px;color:var(--ink2);margin-bottom:22px;max-width:400px;margin-inline:auto">${msg}</div>
      <button class="btn btn-primary" onclick="loadData()">🔄 حاول تاني</button>
    </div>`;
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = 'خطأ في التحميل';
}


/* ================================================================
   🏷️ القسم السادس: بناء فلاتر الأنشطة
   ================================================================ */

function buildActivityFilters() {
  const sel = document.getElementById('f-act');
  if (!sel) return;
  sel.innerHTML = '<option value="">— كل الأنشطة —</option>' +
    ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
}

function onActDropdown(id) {
  selectedAct = id;
  filterAndRender();
  showSearchChips();
}

function buildModalActivityPicker() {
  const picker = document.getElementById('modal-act-picker');
  if (!picker) return;
  picker.innerHTML = ACTIVITIES.map(a =>
    `<button class="act-pick-btn" data-id="${a.id}" onclick="toggleModalAct('${a.id}',this)">${a.label}</button>`
  ).join('');
}

function toggleModalAct(id, el) {
  document.querySelectorAll('.act-pick-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const wrap = document.getElementById('other-act-wrap');
  if (wrap) wrap.style.display = (id === 'other') ? 'block' : 'none';
}

function buildMpActivityFilters() {
  const cont = document.getElementById('mp-act-filters');
  if (!cont) return;
  cont.innerHTML = ACTIVITIES.map(a =>
    `<button class="mp-act-btn" data-id="${a.id}" onclick="toggleMpAct('${a.id}',this)">${a.label}</button>`
  ).join('');
}


/* ================================================================
   🃏 القسم السابع: بناء وعرض كروت المساحات
   ================================================================ */

/**
 * يبني HTML لكارد مساحة واحدة
 * (دالة مشتركة بين الهوم والماركت بليس)
 *
 * ✨ تعديل: أُضيف زرار "المزيد من التفاصيل" بجانب "احجز دلوقتي"
 *           لو المساحة عندها subSpaces أو extraImages
 * @param {Object} s — بيانات المساحة
 * @param {string} fromPage — من أين يُستدعى الكارد (home / market) — يُحفظ للرجوع منه
 * @returns {string} — HTML الكارد
 */
/* ── نظام الباقات والبادجيات ── */
/* ترتيب المساحات حسب الباقة (Pro / Growth / البقية) صار جزءًا من ORDER BY
   داخل search_public_spaces (RPC) — لا حاجة لترتيب محلي بعد الآن */

/** يحلّ قيمة النشاط (مُعرّف أو اسم عربي) إلى تسمية للعرض */
function _resolveActLabel(val) {
  if (!val) return '';
  const a = (ACTIVITIES || []).find(x =>
    x.id === val ||
    x.label === val ||
    x.label.replace(/^[^؀-ۿ]+/, '').trim() === String(val).trim()
  );
  return a ? a.label : val;
}

/** يبني HTML لـ badge الثقة بناءً على planTier */
function _planTrustBadgeHtml(s) {
  if (s.isBroker) return `<span class="card-trust-badge trust-makani">🏠 مكاني Spot</span>`;
  const tier = (s.planTier || 'starter').toLowerCase();
  if (tier === 'broker')  return `<span class="card-trust-badge trust-broker">🏛️ بروكر</span>`;
  if (tier === 'pro')     return `<span class="card-trust-badge trust-partner">🏆 شريك معتمد</span>`;
  if (tier === 'growth')  return `<span class="card-trust-badge trust-verified">✓ موثّق</span>`;
  return '';
}

/** يضيف class خاص بالكارت Pro */
function _planCardClass(s) {
  return (s.planTier || 'starter') === 'pro' ? ' space-card--pro' : '';
}

function buildCardHtml(s, fromPage) {
  fromPage = fromPage || 'market';

  // 1. منطق السلايدر (الذي أرسلته أنت - حافظنا عليه)
  const rawExtra = s.extraImages || [];
  const extraList = Array.isArray(rawExtra) ? rawExtra : String(rawExtra).split('|').map(u => u.trim()).filter(Boolean);
  const allImgs = [];
  if (s.image) allImgs.push(s.image);
  extraList.forEach(u => { if (u && u !== s.image) allImgs.push(u); });
  const sliderId = `card-${s.id}`;

  let thumbHtml;
  if (allImgs.length > 1) {
    const slidesHtml = allImgs.map((url, i) => `
      <div class="cs-slide${i === 0 ? ' cs-active' : ''}" data-index="${i}">
        <img src="${url}" alt="${s.name}" loading="${i === 0 ? 'eager' : 'lazy'}" onerror="this.parentElement.style.display='none'">
      </div>`).join('');
    const dotsHtml = allImgs.map((_, i) => `<span class="cs-dot${i === 0 ? ' cs-dot-on' : ''}" onclick="event.stopPropagation();csGoTo('${sliderId}',${i})"></span>`).join('');
    thumbHtml = `<div class="card-slider" id="${sliderId}" data-slider="${sliderId}"><div class="cs-track">${slidesHtml}</div><div class="cs-dots">${dotsHtml}</div></div>`;
  } else {
    thumbHtml = `<img src="${s.image || ''}" alt="${s.name}" onerror="this.parentElement.innerHTML='<div class=\\'card-thumb-placeholder\\'>🏪</div>'">`;
  }

  // 2. منطق الأنشطة والأسعار (الذي أرسلته أنت)
  const actsHtml = s.allActs ? '<span class="act-tag act-tag-all">✓ كل الأنشطة</span>' : (s.acts || []).slice(0, 3).map(id => `<span class="act-tag">${_resolveActLabel(id)}</span>`).join('');
  const sizePrices = {};
  const sizesClean = [];
  (s.sizes || []).forEach(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    sizePrices[label] = price;
    sizesClean.push(label);
  });
  const defaultPrice = sizePrices[sizesClean[0]] || s.price;

  const sizesHtml = sizesClean.map((sz, i) =>
    `<span class="size-chip${i === 0 ? ' on' : ''}" data-price="${sizePrices[sz]}" onclick="event.stopPropagation(); var c=this.closest('.space-card'); c.querySelectorAll('.size-chip').forEach(x=>x.classList.remove('on')); this.classList.add('on'); c.querySelector('.price-main').innerHTML=Number(this.dataset.price).toLocaleString('ar-EG')+' ج <span>/شهر</span>';">${sz}</span>`
  ).join('');

  // 3. زرار التفاصيل + بادج الوحدات المتاحة
  const hasDetails = (s.subSpaces && s.subSpaces.length > 0) ||
    (s.extraImages && s.extraImages.length > 0) ||
    s.description;

  // التفاصيل والحجز يتمّان في صفحة المساحات الرسمية (/spaces/) لتوحيد التجربة
  const detailsBtnHtml = `<button class="btn btn-details" style="font-size:12px;padding:7px 14px"
              onclick="event.stopPropagation();_trackSpaceEvent('${s.id}','${s.ownerId||''}','detail_click');window.location.href='/spaces/?space=${s.id}'">
         تفاصيل ←
       </button>`;

  const availableUnits = (s.subSpaces || []).filter(u => u.status === 'available' || !u.status).length;
  const unitsBadgeHtml = s.subSpaces && s.subSpaces.length > 0
    ? `<span class="units-badge">${availableUnits} وحدة متاحة</span>`
    : '';

  // 4. البناء النهائي
  const _spaceNameSafe = (s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const _shareSpaceBtn = `<button class="share-btn" onclick="event.stopPropagation();shareCard('space','${s.id}','${_spaceNameSafe}')" title="مشاركة المساحة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;
  const _trustBadge = _planTrustBadgeHtml(s);
  const _cardClass = _planCardClass(s);

  return `
  <div class="space-card${_cardClass}" data-sid="${s.id}" data-oid="${s.ownerId||''}">
    <div class="card-thumb">
      ${thumbHtml}
      <span class="card-badge ${s.badgeClass || 'badge-avail'}">${s.badge || 'متاح'}</span>
      ${_trustBadge}
      ${unitsBadgeHtml}
      ${_shareSpaceBtn}
    </div>
    <div class="card-body">
      <div class="card-name">${s.name}</div>
      <div class="card-loc">📍 ${s.loc}</div>
      <div class="card-acts">${actsHtml}</div>
      <div class="card-sizes">${sizesHtml}</div>
      <div class="card-footer">
        <div class="price-main">${Number(defaultPrice).toLocaleString('ar-EG')} ج <span>/ شهر</span></div>
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
          ${detailsBtnHtml}
          <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                  onclick="event.stopPropagation();window.location.href='/spaces/?space=${s.id}&book=1'">احجز دلوقتي ←</button>
        </div>
      </div>
      ${(s.season || s.insight) ? `
      <div class="card-tip">
        <div class="tip-dot"></div>
        <div>${s.season ? `<strong>موسم البيع:</strong> ${s.season}` : ''}${s.insight ? `<br>${s.insight}` : ''}</div>
      </div>` : ''}
    </div>
  </div>`;
}

/**
 * يرسم كروت المساحات في أي grid
 * @param {Array}   data        — قائمة المساحات المراد عرضها
 * @param {string}  gridId      — id العنصر المراد الرسم فيه
 * @param {boolean} showViewAll — هل يُظهر زرار "عرض الكل"؟
 * @param {string}  fromPage    — الصفحة المصدر (home / market)
 */
function renderCards(data, gridId, totalCount, fromPage) {
  const grid = document.getElementById(gridId || 'spaces-grid');
  if (!grid) return;
  fromPage = fromPage || (gridId === 'spaces-grid' ? 'home' : 'market');

  if (!data.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:70px 20px;color:var(--ink2)">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">مش لاقيين مساحات بالمعايير دي</div>
        <div style="font-size:14px">جرب تغيير النشاط أو المنطقة أو السعر</div>
      </div>`;
    return;
  }

  const viewAllHtml = totalCount > data.length ? `
    <div style="grid-column:1/-1;text-align:center;padding:14px 0 4px">
      <a class="btn-view-all" href="/spaces/">
        <span>عرض جميع المساحات المتاحة (${totalCount})</span>
        <span class="view-all-arrow">←</span>
      </a>
    </div>` : '';

  grid.innerHTML = data.map(s => buildCardHtml(s, fromPage)).join('') + viewAllHtml;
  requestAnimationFrame(_initCardViewTracking);
}


/* ================================================================
   🏢 القسم السابع-ب: صفحة تفاصيل المساحة الرئيسية  ← جديد كلياً
   ================================================================ */

/**
 * يفتح صفحة التفاصيل لمساحة رئيسية معينة
 * يعرض: صور إضافية + وصف + قائمة المساحات الفرعية
 *
 * @param {number} spaceId  — id المساحة الرئيسية
 * @param {string} fromPage — الصفحة التي جاء منها المستخدم (للرجوع)
 */
function _showSpaceLoginGate(s, fromPage) {
  currentSpaceDetail = s;
  detailPrevPage = fromPage || 'market';

  const headerEl = document.getElementById('sd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeSpaceDetail()">→ العودة</button>
          <div class="sd-breadcrumb">
            <span onclick="showPage('home')" style="cursor:pointer">الرئيسية</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="window.location.href='/spaces/'" style="cursor:pointer">المساحات</span>
            <span class="sd-bc-sep">·</span>
            <span style="color:var(--orange)">${s.name}</span>
          </div>
        </div>
        <div class="sd-title-row">
          <div>
            <h1 class="sd-name">${s.name}</h1>
            <div class="sd-meta">
              <span>📍 ${s.loc}</span>
              <span class="sd-meta-sep">·</span>
              <span class="sd-type-badge sd-type-${s.type}">${_typeLabel(s.type)}</span>
            </div>
          </div>
        </div>
      </div>`;
  }

  const galleryEl = document.getElementById('sd-gallery');
  if (galleryEl) galleryEl.innerHTML = '';

  const infoEl = document.getElementById('sd-info');
  if (infoEl) {
    infoEl.innerHTML = `
      <div style="text-align:center;padding:64px 24px;max-width:460px;margin:0 auto">
        <div style="font-size:64px;margin-bottom:20px">🔒</div>
        <h2 style="font-size:22px;font-weight:900;color:var(--dark);margin-bottom:10px;font-family:'Cairo',sans-serif">
          سجّل دخولك لعرض التفاصيل
        </h2>
        <p style="font-size:14px;color:var(--ink3);line-height:1.9;margin-bottom:28px;font-family:'IBM Plex Sans Arabic',sans-serif">
          سجّل دخولك لمعرفة المزيد من تفاصيل المساحة والحجز
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:13px 32px;font-size:15px"
                  onclick="showPage('login')">
            تسجيل الدخول ←
          </button>
          <button class="btn" style="padding:13px 22px;font-size:14px"
                  onclick="closeSpaceDetail()">
            العودة للمساحات
          </button>
        </div>
      </div>`;
  }

  const subEl = document.getElementById('sd-subspaces');
  if (subEl) subEl.innerHTML = '';

  showPage('space-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* يبحث عن مساحة فيما هو معروض حاليًا (هيرو/شبكة)، وإلا يجلبها مباشرة بالمعرّف —
   مصدر واحد لكل أزرار الإجراء السريع (تفاصيل/حجز/معاينة) بدل تكرار المنطق في كل واحد */
async function findOrFetchSpace(spaceId) {
  return heroItems.find(x => x.id === spaceId)
      || mpCurrentItems.find(x => x.id === spaceId)
      || await fetchSpaceById(sbClient, spaceId);
}

async function openSpaceDetail(spaceId, fromPage) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return;

  if (!currentUser) {
    _showSpaceLoginGate(s, fromPage);
    return;
  }

  currentSpaceDetail = s;
  detailPrevPage = fromPage || 'market';

  // ── بناء رأس الصفحة ──
  const headerEl = document.getElementById('sd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeSpaceDetail()">
            → العودة
          </button>
          <div class="sd-breadcrumb">
            <span onclick="showPage('home')" style="cursor:pointer">الرئيسية</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="window.location.href='/spaces/'" style="cursor:pointer">المساحات</span>
            <span class="sd-bc-sep">·</span>
            <span style="color:var(--orange)">${s.name}</span>
          </div>
        </div>
        <div class="sd-title-row">
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px">
              <h1 class="sd-name" style="margin:0">${s.name}</h1>
              ${_planTrustBadgeHtml(s) ? `<span class="sd-trust-badge trust-${(s.planTier || 'starter') === 'pro' ? 'partner' : 'verified'}">${(s.planTier || 'starter') === 'pro' ? '🏆 شريك معتمد' : '✓ موثّق'}</span>` : ''}
            </div>
            <div class="sd-meta">
              <span>📍 ${s.loc}</span>
              <span class="sd-meta-sep">·</span>
              <span class="sd-type-badge sd-type-${s.type}">${_typeLabel(s.type)}</span>
              ${s.subSpaces && s.subSpaces.length > 0
        ? `<span class="sd-meta-sep">·</span>
                   <span style="color:var(--orange);font-weight:700">${s.subSpaces.length} وحدة</span>`
        : ''}
            </div>
          </div>
          <div class="sd-price-box">
            <div class="sd-price-val">${Number(s.price).toLocaleString('ar-EG')} ج</div>
            <div class="sd-price-lbl">/ شهر (ابتداءً من)</div>
            <div style="display:flex;gap:8px;margin-top:10px">
              <button class="btn btn-primary" style="width:100%;justify-content:center;font-size:13px;padding:9px 10px"
                      onclick="openBooking('${s.id}')">احجز دلوقتي ←</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ── معرض الصور ──
  _renderDetailGallery(s);

  // ── الوصف والمرافق ──
  _renderDetailInfo(s);

  // ── المساحات الفرعية ──
  _renderSubSpaces(s);

  // ── الانتقال للصفحة ──
  showPage('space-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/**
 * يغلق صفحة التفاصيل ويرجع للصفحة السابقة
 */
function closeSpaceDetail() {
  // تنظيف Slider التفاصيل لمنع تراكم timers
  if (currentSpaceDetail) {
    _sdCleanup(`detail-${currentSpaceDetail.id}`);
  }
  const prevPage = detailPrevPage || 'market';
  currentSpaceDetail = null;
  detailPrevPage = 'market';
  showPage(prevPage);
}

/**
 * يبني معرض الصور التفاعلي في صفحة التفاصيل
 * — Slider كامل مع أسهم + dots + swipe + auto-play
 * @param {Object} s — بيانات المساحة
 */
function _renderDetailGallery(s) {
  const galleryEl = document.getElementById('sd-gallery');
  if (!galleryEl) return;

  // ── جمع الصور: الرئيسية + الإضافية ──
  const rawExtra = s.extraImages || [];
  const extraList = Array.isArray(rawExtra)
    ? rawExtra
    : String(rawExtra).split('|').map(u => u.trim()).filter(Boolean);

  const allImages = [];
  if (s.image) allImages.push({ url: s.image, caption: s.name });
  extraList.forEach((url, i) => {
    if (url && url !== s.image)
      allImages.push({ url, caption: `${s.name} — صورة ${i + 2}` });
  });

  // ── لا توجد صور ──
  if (!allImages.length) {
    galleryEl.innerHTML = `
      <div class="sd-gallery-placeholder">
        <div style="font-size:64px;opacity:0.25">${s.icon || '🏪'}</div>
        <div style="font-size:13px;color:var(--ink3);margin-top:10px">لا توجد صور متاحة</div>
      </div>`;
    return;
  }

  // ── صورة واحدة فقط — عرض بسيط بدون Slider ──
  if (allImages.length === 1) {
    galleryEl.innerHTML = `
      <div class="sd-gallery-wrap">
        <div class="sd-main-img-wrap">
          <img src="${allImages[0].url}" alt="${allImages[0].caption}"
               style="width:100%;height:100%;object-fit:cover"
               onerror="this.parentElement.innerHTML='<div class=sd-gallery-placeholder><div style=font-size:64px;opacity:.25>${s.icon || '🏪'}</div></div>'">
        </div>
      </div>`;
    return;
  }

  // ── أكثر من صورة — Slider كامل ──
  const detailSliderId = `detail-${s.id}`;

  const slidesHtml = allImages.map((img, i) => `
    <div class="sd-slide${i === 0 ? ' sd-slide-active' : ''}" data-index="${i}">
      <img src="${img.url}" alt="${img.caption}"
           loading="${i === 0 ? 'eager' : 'lazy'}"
           onerror="this.parentElement.style.display='none'">
    </div>`).join('');

  const dotsHtml = allImages.map((_, i) =>
    `<span class="sd-dot${i === 0 ? ' sd-dot-on' : ''}"
           onclick="event.stopPropagation();sdGoTo('${detailSliderId}',${i})"></span>`
  ).join('');

  // صف الـ thumbnails أسفل الـ Slider
  const thumbsHtml = allImages.map((img, i) => `
    <div class="sd-thumb-item${i === 0 ? ' sd-thumb-on' : ''}"
         data-thumb-index="${i}"
         onclick="sdGoTo('${detailSliderId}',${i})">
      <img src="${img.url}" alt="${img.caption}" loading="lazy"
           onerror="this.parentElement.style.display='none'">
    </div>`).join('');

  galleryEl.innerHTML = `
    <div class="sd-gallery-wrap">

      <!-- الـ Slider الرئيسي -->
      <div class="sd-slider" id="${detailSliderId}"
           onmouseenter="sdPause('${detailSliderId}')"
           onmouseleave="sdResume('${detailSliderId}')">

        <!-- الشرائح -->
        <div class="sd-slides-track">${slidesHtml}</div>

        <!-- أسهم التنقل -->
        <button class="sd-arrow sd-arrow-next"
                onclick="event.stopPropagation();sdNext('${detailSliderId}')"
                title="الصورة التالية">&#8250;</button>
        <button class="sd-arrow sd-arrow-prev"
                onclick="event.stopPropagation();sdPrev('${detailSliderId}')"
                title="الصورة السابقة">&#8249;</button>

        <!-- عداد الصور -->
        <div class="sd-counter" id="${detailSliderId}-counter">1 / ${allImages.length}</div>

        <!-- نقاط التنقل (dots) -->
        <div class="sd-dots" id="${detailSliderId}-dots">${dotsHtml}</div>

      </div>

      <!-- صف الـ thumbnails -->
      <div class="sd-thumbs-row" id="${detailSliderId}-thumbs">
        ${thumbsHtml}
      </div>

    </div>`;

  // تهيئة الـ Slider + Swipe + Auto-play
  _sdInit(detailSliderId, allImages.length);
}

/* ================================================================
   🎠 القسم السابع-د: نظام الـ Slider للصور — يعمل في الكروت والتفاصيل
   ================================================================ */

/**
 * ══════════════════════════════════════════════════════
 *  نظام الـ Slider — مشترك بين الكروت وصفحة التفاصيل
 *
 *  كيف يشتغل:
 *  - كل Slider له معرّف فريد يُحفظ في _sliders{}
 *  - يدعم: أسهم + dots + thumbnails + Swipe + Auto-play
 *  - Auto-play يتوقف عند hover ويعود بعده
 *  - csInitAll() تُشغَّل بعد رسم الكروت لتهيئة كل Sliders الكروت
 *  - _sdInit() تُشغَّل لتهيئة Slider صفحة التفاصيل
 * ══════════════════════════════════════════════════════
 */

// ── ثوابت الـ Slider ──
const CS_AUTO_DELAY = 3800;  // مدة Auto-play بالمللي ثانية (3.8 ثانية)
const SD_AUTO_DELAY = 4500;  // مدة Auto-play في صفحة التفاصيل

/* ─────────────────────────────────────────────────────
   الجزء الأول: Slider الكروت (cs = card slider)
───────────────────────────────────────────────────── */

/**
 * تهيئة جميع Sliders الكروت الموجودة في الصفحة حالياً
 * تُستدعى بعد renderCards و renderMarketplace
 */
function csInitAll() {
  document.querySelectorAll('.card-slider').forEach(el => {
    const id = el.dataset.slider;
    if (!id || _sliders[id]) return;  // تجنب التهيئة المزدوجة
    const slides = el.querySelectorAll('.cs-slide');
    if (!slides.length) return;
    _sliders[id] = { index: 0, total: slides.length, autoTimer: null, paused: false };
    _csStartAuto(id);
    _csInitSwipe(el, id);
  });
}

/**
 * الانتقال لشريحة محددة في Slider الكارد
 * @param {string} id  — معرّف الـ Slider
 * @param {number} idx — رقم الشريحة (يبدأ من 0)
 */
function csGoTo(id, idx) {
  const el = document.getElementById(id);
  if (!el || !_sliders[id]) return;
  const state = _sliders[id];
  state.index = (idx + state.total) % state.total;

  // تحديث الشرائح
  el.querySelectorAll('.cs-slide').forEach((s, i) =>
    s.classList.toggle('cs-active', i === state.index));

  // تحديث الـ dots
  el.querySelectorAll('.cs-dot').forEach((d, i) =>
    d.classList.toggle('cs-dot-on', i === state.index));
}

/** الشريحة التالية */
function csNext(id) { csGoTo(id, (_sliders[id]?.index ?? 0) + 1); }
/** الشريحة السابقة */
function csPrev(id) { csGoTo(id, (_sliders[id]?.index ?? 0) - 1); }

/** إيقاف Auto-play مؤقتاً (عند hover) */
function csPause(id) {
  if (_sliders[id]) {
    _sliders[id].paused = true;
    clearInterval(_sliders[id].autoTimer);
  }
}

/** استئناف Auto-play (بعد مغادرة hover) */
function csResume(id) {
  if (_sliders[id] && !_sliders[id].paused) return;
  if (_sliders[id]) {
    _sliders[id].paused = false;
    _csStartAuto(id);
  }
}

/** تشغيل Auto-play للـ Slider */
function _csStartAuto(id) {
  if (!_sliders[id]) return;
  clearInterval(_sliders[id].autoTimer);
  _sliders[id].autoTimer = setInterval(() => {
    if (!_sliders[id]?.paused) csNext(id);
  }, CS_AUTO_DELAY);
}

/**
 * إضافة Swipe (للموبايل) لعنصر Slider معين
 * @param {Element} el — عنصر الـ Slider
 * @param {string}  id — معرّف الـ Slider
 */
function _csInitSwipe(el, id) {
  let startX = 0, startY = 0;
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (Math.abs(dx) > 40 && dy < 60) {  // swipe أفقي واضح
      dx < 0 ? csNext(id) : csPrev(id);
      csPause(id);
      setTimeout(() => csResume(id), 3000);
    }
  }, { passive: true });
}


/* ─────────────────────────────────────────────────────
   الجزء الثاني: Slider صفحة التفاصيل (sd = space detail)
   نفس المنطق لكن مع thumbnails أسفل الـ Slider
───────────────────────────────────────────────────── */

/**
 * تهيئة Slider صفحة التفاصيل
 * @param {string} id    — معرّف الـ Slider
 * @param {number} total — إجمالي عدد الصور
 */
function _sdInit(id, total) {
  _sliders[id] = { index: 0, total, autoTimer: null, paused: false };
  const el = document.getElementById(id);
  if (!el) return;
  _sdStartAuto(id);
  _sdInitSwipe(el, id);
}

/**
 * الانتقال لشريحة محددة في Slider التفاصيل
 * @param {string} id  — معرّف الـ Slider
 * @param {number} idx — رقم الشريحة
 */
function sdGoTo(id, idx) {
  const el = document.getElementById(id);
  if (!el || !_sliders[id]) return;
  const state = _sliders[id];
  state.index = (idx + state.total) % state.total;

  // تحديث الشرائح
  el.querySelectorAll('.sd-slide').forEach((s, i) =>
    s.classList.toggle('sd-slide-active', i === state.index));

  // تحديث الـ dots
  const dotsEl = document.getElementById(`${id}-dots`);
  if (dotsEl) {
    dotsEl.querySelectorAll('.sd-dot').forEach((d, i) =>
      d.classList.toggle('sd-dot-on', i === state.index));
  }

  // تحديث الـ thumbnails
  const thumbsEl = document.getElementById(`${id}-thumbs`);
  if (thumbsEl) {
    thumbsEl.querySelectorAll('.sd-thumb-item').forEach((t, i) =>
      t.classList.toggle('sd-thumb-on', i === state.index));
    // scroll للـ thumbnail النشط
    const activeThumb = thumbsEl.querySelector('.sd-thumb-on');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  // تحديث العداد (1/5)
  const counterEl = document.getElementById(`${id}-counter`);
  if (counterEl) counterEl.textContent = `${state.index + 1} / ${state.total}`;
}

/** الصورة التالية في التفاصيل */
function sdNext(id) { sdGoTo(id, (_sliders[id]?.index ?? 0) + 1); }
/** الصورة السابقة في التفاصيل */
function sdPrev(id) { sdGoTo(id, (_sliders[id]?.index ?? 0) - 1); }

/** إيقاف Auto-play مؤقتاً */
function sdPause(id) {
  if (_sliders[id]) {
    _sliders[id].paused = true;
    clearInterval(_sliders[id].autoTimer);
  }
}

/** استئناف Auto-play */
function sdResume(id) {
  if (_sliders[id] && _sliders[id].paused) {
    _sliders[id].paused = false;
    _sdStartAuto(id);
  }
}

function _sdStartAuto(id) {
  if (!_sliders[id]) return;
  clearInterval(_sliders[id].autoTimer);
  _sliders[id].autoTimer = setInterval(() => {
    if (!_sliders[id]?.paused) sdNext(id);
  }, SD_AUTO_DELAY);
}

function _sdInitSwipe(el, id) {
  let startX = 0, startY = 0;
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (Math.abs(dx) > 40 && dy < 60) {
      dx < 0 ? sdNext(id) : sdPrev(id);
      sdPause(id);
      setTimeout(() => sdResume(id), 3000);
    }
  }, { passive: true });
}

/**
 * تنظيف Slider عند إغلاق صفحة التفاصيل
 * يُستدعى من closeSpaceDetail لمنع تراكم الـ timers
 */
function _sdCleanup(id) {
  if (_sliders[id]) {
    clearInterval(_sliders[id].autoTimer);
    delete _sliders[id];
  }
}


/**
 * يبني قسم الوصف والمرافق في صفحة التفاصيل
 * @param {Object} s — بيانات المساحة
 */
function _renderDetailInfo(s) {
  const infoEl = document.getElementById('sd-info');
  if (!infoEl) return;

  // ── الأنشطة المناسبة ──
  const actsHtml = s.allActs
    ? '<span class="act-tag act-tag-all">✓ يصلح لجميع الأنشطة</span>'
    : (s.acts || []).map(id => {
      const a = ACTIVITIES.find(x => x.id === id);
      return a ? `<span class="act-tag">${a.label}</span>` : '';
    }).join('');

  // ── الأحجام والأسعار ──
  const sizesHtml = (s.sizes || []).map(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    return `
      <div class="sd-size-row">
        <span class="sd-size-label">${label}</span>
        <span class="sd-size-price">${Number(price).toLocaleString('ar-EG')} ج / شهر</span>
      </div>`;
  }).join('');

  // ── المرافق ──
  const amenitiesHtml = (s.amenities || []).map(a =>
    `<span class="sd-amenity">✓ ${a}</span>`
  ).join('');

  infoEl.innerHTML = `
    <div class="sd-info-grid">

      ${s.description ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">📝 عن هذا المكان</div>
        <p class="sd-description">${s.description}</p>
      </div>` : ''}

      <div class="sd-info-card">
        <div class="sd-info-title">🏷️ الأنشطة المناسبة</div>
        <div class="card-acts" style="margin-top:8px">${actsHtml || '—'}</div>
      </div>

      ${sizesHtml ? `
      <div class="sd-info-card">
        <div class="sd-info-title">📐 الأحجام والأسعار</div>
        <div class="sd-sizes-list" style="margin-top:10px">${sizesHtml}</div>
      </div>` : ''}

      ${amenitiesHtml ? `
      <div class="sd-info-card">
        <div class="sd-info-title">⚡ المرافق المتاحة</div>
        <div class="sd-amenities-wrap" style="margin-top:10px">${amenitiesHtml}</div>
      </div>` : ''}

      ${s.season ? `
      <div class="sd-info-card">
        <div class="sd-info-title">📅 معلومات إضافية</div>
        <div style="margin-top:8px">
          <div class="sd-extra-row"><span>موسم البيع:</span><span>${s.season}</span></div>
          ${s.insight ? `<div style="font-size:13px;color:var(--ink2);margin-top:6px;line-height:1.7">${s.insight}</div>` : ''}
        </div>
      </div>` : ''}

    </div>`;
}

/**
 * يبني قائمة المساحات الفرعية في صفحة التفاصيل
 * يعرض كل وحدة بكارد منفصل يحتوي على صورة + رقم الوحدة + الوصف + السعر + زرار حجز
 * @param {Object} s — بيانات المساحة الرئيسية
 */
function _renderSubSpaces(s) {
  const subEl = document.getElementById('sd-subspaces');
  if (!subEl) return;

  const units = s.subSpaces || [];

  if (!units.length) {
    subEl.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--ink3)">
        <div style="font-size:36px;margin-bottom:10px">🏪</div>
        <div style="font-size:14px">لا توجد وحدات مفصّلة لهذا المكان بعد</div>
        <div style="font-size:12px;margin-top:6px">يمكنك الحجز مباشرة وسيتواصل معك فريقنا</div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="openBooking('${s.id}')">
          احجز دلوقتي ←
        </button>
      </div>`;
    return;
  }

  // ── عداد الوحدات المتاحة ──
  const availCount = units.filter(u => u.status === 'available' || !u.status).length;
  const rentedCount = units.filter(u => u.status === 'rented').length;

  const statusMap = {
    available: { label: 'متاحة', cls: 'sub-status-available' },
    rented: { label: 'مؤجّرة', cls: 'sub-status-rented' },
    reserved: { label: 'محجوزة', cls: 'sub-status-reserved' },
  };

  const unitsHtml = units.map(unit => {
    const st = statusMap[unit.status] || statusMap.available;
    const isBlocked = unit.status === 'rented' || unit.status === 'reserved';

    // صورة الوحدة أو placeholder
    const imgHtml = unit.image
      ? `<div class="sub-thumb">
           <img src="${unit.image}" alt="${unit.unitId}" loading="lazy"
                onerror="this.parentElement.innerHTML='<div class=\\'sub-thumb-placeholder\\'>${unit.unitId || '📦'}</div>'">
         </div>`
      : `<div class="sub-thumb sub-thumb-placeholder">${unit.unitId || '📦'}</div>`;

    return `
    <div class="sub-card ${isBlocked ? 'sub-card-blocked' : ''}">
      ${imgHtml}
      <div class="sub-body">
        <div class="sub-header-row">
          <div class="sub-unit-id">${unit.unitId || '—'}</div>
          <span class="sub-status ${st.cls}">${st.label}</span>
        </div>
        ${unit.name ? `<div class="sub-name">${unit.name}</div>` : ''}
        ${unit.floor ? `<div class="sub-meta">🏢 ${unit.floor}</div>` : ''}
        ${unit.location ? `<div class="sub-location">📌 ${unit.location}</div>` : ''}
        ${unit.notes ? `<div class="sub-notes">${unit.notes}</div>` : ''}
        <div class="sub-footer">
          <div class="sub-specs">
            ${unit.size ? `<span class="sub-spec">📐 ${unit.size}</span>` : ''}
            ${unit.price ? `<span class="sub-spec sub-price">${Number(unit.price).toLocaleString('ar-EG')} ج/شهر</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${!isBlocked
        ? `<button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                         onclick="openBookingForUnit('${s.id}','${unit.unitId}')">
                   احجز ←
                 </button>`
        : `<span style="font-size:12px;color:var(--ink3);padding:7px 0">غير متاح حالياً</span>`
      }
            <button class="share-btn-inline" onclick="event.stopPropagation();shareCard('unit','${s.id}:${(unit.unitId || '').replace(/'/g, "\\'")}','${(unit.name || unit.unitId || '').replace(/'/g, "\\'")}');" title="مشاركة الوحدة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  subEl.innerHTML = `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">🏪 الوحدات المتاحة (${units.length})</h2>
      <div class="sd-units-summary">
        <span class="sd-units-avail">${availCount} متاحة</span>
        ${rentedCount > 0 ? `<span class="sd-units-rented">${rentedCount} مؤجّرة</span>` : ''}
      </div>
    </div>
    <div class="sub-grid">${unitsHtml}</div>`;
}

/**
 * مساعد: يحوّل كود نوع المكان لنص عربي
 * @param {string} type — mall / club / school
 * @returns {string}
 */
function _typeLabel(type) {
  return { mall: '🏬 مول تجاري', club: '⚽ نادي رياضي', school: '🏫 مدرسة' }[type] || type;
}


/* ================================================================
   📋 القسم السابع-ج: فتح مودال الحجز لوحدة فرعية محددة  ← جديد
   ================================================================ */

/**
 * يفتح مودال الحجز مع تحديد الوحدة الفرعية مسبقاً
 * @param {number} spaceId — id المساحة الرئيسية
 * @param {string} unitId  — رقم/كود الوحدة الفرعية
 */
async function openBookingForUnit(spaceId, unitId) {
  // افتح مودال الحجز الاعتيادي أولاً
  const opened = await openBooking(spaceId);
  if (!opened) return;

  // ثم حدّد الوحدة في حقل الحجم/الملاحظات
  setTimeout(() => {
    const notesEl = document.getElementById('bk-notes');
    if (notesEl && unitId) {
      notesEl.value = `الوحدة المطلوبة: ${unitId}`;
    }
    // تحديث عنوان المودال ليشير للوحدة
    const metaEl = document.getElementById('msi-meta');
    if (metaEl) {
      metaEl.insertAdjacentHTML('beforeend',
        ` · <strong style="color:var(--orange)">وحدة ${unitId}</strong>`);
    }
  }, 50);
}


/* ================================================================
   🛍️ القسم الثامن: صفحة الماركت بليس (كل المساحات)
   ================================================================ */

/**
 * يوجّه المستخدم لصفحة المساحات المستقلة
 */
function goToMarketplace() {
  trackEvent('marketplace_opened');
  window.location.href = '/spaces/';
}

function toggleMpType(type, el) {
  el.classList.toggle('on');
  mpActiveTypes = el.classList.contains('on')
    ? [...mpActiveTypes, type]
    : mpActiveTypes.filter(t => t !== type);
  mpPage = 1;
  loadMarketplacePage();
  updateMpChips();
}

function toggleMpAct(id, el) {
  el.classList.toggle('on');
  mpActiveActs = el.classList.contains('on')
    ? [...mpActiveActs, id]
    : mpActiveActs.filter(a => a !== id);
  mpPage = 1;
  loadMarketplacePage();
  updateMpChips();
}

function applyMpFilters() {
  mpPage = 1;
  loadMarketplacePage();
  updateMpChips();
}

/* الشبكة الكاملة — نفس مصدر البحث الموحّد search_public_spaces، صفحة واحدة في كل نداء */
async function loadMarketplacePage() {
  const region = document.getElementById('mp-region')?.value || '';
  const maxVal = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
  const sort   = document.getElementById('mp-sort')?.value || 'default';
  const sliderMax = parseInt(document.getElementById('mp-slider-max')?.max || 50000);

  try {
    const { items, totalCount } = await searchPublicSpaces(sbClient, {
      region:     region || null,
      types:      mpActiveTypes,
      activities: mpActiveActs,
      maxPrice:   maxVal < sliderMax ? maxVal : null,
      sort,
      limit:      MP_PER_PAGE,
      offset:     (mpPage - 1) * MP_PER_PAGE,
    });
    mpCurrentItems = items;
    mpTotalCount = totalCount;
    renderMarketplace();
  } catch (err) {
    showErrorState(err.message || 'خطأ في تحميل المساحات', 'mp-grid');
  }
}

function clearMpFilters() {
  mpActiveTypes = [];
  mpActiveActs = [];
  document.querySelectorAll('.mp-type-btn').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.mp-act-btn').forEach(b => b.classList.remove('on'));

  const s2 = document.getElementById('mp-slider-max');
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMpSlider();

  const mpRegion = document.getElementById('mp-region');
  if (mpRegion) mpRegion.value = '';
  const mpSort = document.getElementById('mp-sort');
  if (mpSort) mpSort.value = 'default';

  mpPage = 1;
  loadMarketplacePage();
  updateMpChips();
}

function updateMpChips() {
  const cont = document.getElementById('mp-active-chips');
  if (!cont) return;
  const chips = [];
  const typeMap = { mall: 'مولات', club: 'نوادي', school: 'مدارس' };

  mpActiveTypes.forEach(t => {
    chips.push(`<span class="mp-chip" onclick="clearMpFilters()">${typeMap[t] || t} ×</span>`);
  });
  mpActiveActs.forEach(id => {
    const a = ACTIVITIES.find(x => x.id === id);
    if (a) chips.push(`<span class="mp-chip" onclick="clearMpFilters()">${a.label} ×</span>`);
  });

  cont.innerHTML = chips.join('');
}

function renderMarketplace() {
  const grid = document.getElementById('mp-grid');
  const countEl = document.getElementById('mp-count');
  if (!grid) return;

  if (countEl) countEl.textContent = mpTotalCount + ' مساحة';

  if (!mpCurrentItems.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:14px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">مش لاقيين مساحات</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:18px">جرب تغيير الفلاتر</div>
        <button class="btn btn-primary" onclick="clearMpFilters()">مسح الفلاتر</button>
      </div>`;
    renderMpPagination();
    return;
  }

  grid.innerHTML = mpCurrentItems.map(s => buildCardHtml(s, 'market')).join('');
  // تهيئة الـ sliders في الماركت بعد الرسم
  setTimeout(() => csInitAll(), 120);
  renderMpPagination();
}

function renderMpPagination() {
  const cont = document.getElementById('mp-pagination');
  if (!cont) return;

  const totalPages = Math.max(1, Math.ceil(mpTotalCount / MP_PER_PAGE));
  if (totalPages <= 1) { cont.innerHTML = ''; return; }

  let html = '';
  if (mpPage > 1) html += `<button class="pg-btn" onclick="mpGoPage(${mpPage - 1})">السابق</button>`;

  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - mpPage) <= 2) {
      html += `<button class="pg-btn${i === mpPage ? ' on' : ''}" onclick="mpGoPage(${i})">${i}</button>`;
    } else if (Math.abs(i - mpPage) === 3) {
      html += `<span class="pg-dots">…</span>`;
    }
  }

  if (mpPage < totalPages) html += `<button class="pg-btn" onclick="mpGoPage(${mpPage + 1})">التالي</button>`;
  cont.innerHTML = html;
}

function mpGoPage(n) {
  mpPage = n;
  loadMarketplacePage();
  document.getElementById('mp-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── مؤشر سعر الماركت بليس ── */

/* مؤشر سعر الماركت بليس — نقطة واحدة (الحد الأقصى) */
function initMpSlider() {
  const s2 = document.getElementById('mp-slider-max');
  if (!s2 || s2._mpListenerAdded) return;
  s2._mpListenerAdded = true;
  s2.addEventListener('input', updateMpSlider);
  updateMpSlider();
}

function updateMpSlider() {
  const s2 = document.getElementById('mp-slider-max');
  if (!s2) return;

  const maxVal = parseInt(s2.value);
  const RANGE_MAX = parseInt(s2.max) || 50000;
  const pMax = (maxVal / RANGE_MAX) * 100;

  const track = document.getElementById('mp-slider-track');
  if (track) {
    // RTL: البرتقالي من اليمين، track فاتح على الخلفية الداكنة للـ sidebar
    track.style.background =
      `linear-gradient(to right, rgba(255,255,255,0.14) ${100 - pMax}%, #FF6B00 ${100 - pMax}%)`;
  }

  const lMax = document.getElementById('mp-price-max-label');
  if (lMax) lMax.textContent = maxVal >= RANGE_MAX ? 'بلا حد' : Number(maxVal).toLocaleString('ar-EG') + ' ج';
}

function toggleMpSidebar() {
  document.getElementById('mp-sidebar')?.classList.toggle('open');
  document.getElementById('mp-sidebar-overlay')?.classList.toggle('open');
}


/* ================================================================
   🔍 القسم التاسع: الفلترة والبحث — الصفحة الرئيسية
   ================================================================ */

function setTab(el, type) {
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  activeTab = type;
  filterAndRender();
}

function doSearch() {
  const region = document.getElementById('f-region')?.value || '';
  const activity = selectedAct || '';
  trackEvent('search', { region, activity });
  filterAndRender();
  showSearchChips();
}

/* أهم 6 مساحات (هيرو) — نفس مصدر البحث الموحّد search_public_spaces بحد limit=6 */
async function filterAndRender() {
  const reg  = document.getElementById('f-region')?.value || '';
  const type = document.getElementById('f-type')?.value || activeTab;
  const maxPrice = parseInt(document.getElementById('slider-max')?.value) || 50000;

  try {
    const { items, totalCount } = await searchPublicSpaces(sbClient, {
      region:     reg || null,
      types:      type ? [type] : null,
      activities: selectedAct ? [selectedAct] : null,
      maxPrice:   maxPrice < 50000 ? maxPrice : null,
      limit:      6,
    });
    heroItems = items;

    const counter = document.getElementById('res-count');
    if (counter) counter.textContent = totalCount + ' مساحة';

    renderCards(items, 'spaces-grid', totalCount, 'home');
  } catch (err) {
    showErrorState(err.message || 'خطأ في تحميل البيانات', 'spaces-grid');
  }
}

function showSearchChips() {
  const chips = [];
  const r = document.getElementById('f-region')?.value;
  const maxPrice = parseInt(document.getElementById('slider-max')?.value) || 50000;

  if (r) chips.push(r);
  if (maxPrice < 50000) {
    chips.push(`حتى ${Number(maxPrice).toLocaleString('ar-EG')} ج`);
  }
  if (selectedAct) {
    const a = ACTIVITIES.find(x => x.id === selectedAct);
    if (a) chips.push(a.label);
  }

  const chipsEl = document.getElementById('active-chips');
  if (chipsEl) {
    chipsEl.innerHTML = chips.map(ch =>
      `<span class="chip" onclick="clearAllFilters()">${ch} ×</span>`
    ).join('');
  }
}

function clearAllFilters() {
  const chipsEl = document.getElementById('active-chips');
  if (chipsEl) chipsEl.innerHTML = '';

  ['f-region', 'f-dur'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const actSel = document.getElementById('f-act');
  if (actSel) actSel.value = '';
  selectedAct = '';

  const sliderMax = document.getElementById('slider-max');
  if (sliderMax) sliderMax.value = 50000;
  updateMainSlider();

  filterAndRender(); // نفس مسار الجلب — لا تكرار للمنطق
}


/* ================================================================
   🗺️ القسم العاشر: التنقل بين الصفحات
   ================================================================ */

/**
 * يُظهر صفحة ويُخفي باقي الصفحات
 * يحدّث الرابط النشط في الـ Nav
 * @param {string} p — اسم الصفحة:
 *   home / how / owner / market / login / signup / dashboard / confirm / space-detail  ← جديد
 */
function showPage(p) {
  if (p === 'bazaars') {
    window.location.href = '/bazaars/';
    return;
  }

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');

  // تحديث الرابط النشط في الـ Nav
  // ⚠️ المحدد يستثني أزرار الأقسام (.nav-section-btn) — وإلا تُظلَّل بالخطأ
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.querySelectorAll('.nav-section-btn').forEach(b => b.classList.remove('active'));
  const links = document.querySelectorAll('.nav-links a:not(.nav-section-btn)');
  if (p === 'home') links[0]?.classList.add('active');
  if (p === 'how') links[1]?.classList.add('active');
  if (p === 'owner') links[2]?.classList.add('active');
  if (p === 'market' || p === 'space-detail') document.getElementById('nsb-spaces')?.classList.add('active');

  // لو فتحنا الماركت بليس — الشبكة مُحمَّلة مسبقًا من loadData()، لا حاجة لتهيئة هنا
  if (p === 'market') {
    setTimeout(initMpSlider, 120);
  }

  if (p === 'pricing') {
    setTimeout(initPricingAnimations, 80);
  }

  // مزامنة شريط التنقل السفلي (موبايل) مع الصفحة النشطة
  updateBottomNav(p === 'home' ? 'home' : p === 'dashboard' ? 'user' : '');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToSearch() {
  showPage('home');
  setTimeout(() => {
    document.getElementById('search-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

function goToLogin() { showPage('login'); }

function goToDashboard() {
  closeUserDropdown();
  if (currentUser) loadDashboardData(currentUser);
  showPage('dashboard');
}


/* ================================================================
   🪪 البروفايل العام الموحّد — هوية الناشر الرقمية
   يجلب البيانات عبر RPC: get_public_profile (بروفايل + مساحات + بازارات)
   ================================================================ */
function _oppEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* رجوع من صفحة البروفايل: للصفحة السابقة إن وُجدت، وإلا للرئيسية */
function oppGoBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.href = '/';
}

async function loadOwnerProfile(userId) {
  const root = document.getElementById('opp-root');
  if (!root) return;
  if (!userId) { root.innerHTML = _oppNotFound(); return; }

  // ننتظر تهيئة العميل إن لزم
  let tries = 0;
  while (!sbClient && tries < 20) { await new Promise(r => setTimeout(r, 100)); tries++; }
  if (!sbClient) { root.innerHTML = _oppNotFound(); return; }

  try {
    const { data, error } = await sbClient.rpc('get_public_profile', { p_user_id: userId });
    if (error) throw error;
    if (!data || !data.found) { root.innerHTML = _oppNotFound(); return; }
    renderOwnerProfile(data);
  } catch (e) {
    console.warn('[owner-profile] load error:', e.message || e);
    root.innerHTML = _oppNotFound();
  }
}

function _oppNotFound() {
  return `<div style="text-align:center;padding:80px 20px;color:#9a9aa3">
    <div style="font-size:42px;margin-bottom:10px">🪪</div>
    <div style="font-size:18px;font-weight:700;color:#55555f">لم يتم العثور على هذا البروفايل</div>
    <div style="margin-top:8px">قد يكون الحساب غير متاح أو تم حذفه.</div>
    <a href="/" class="btn-primary" style="display:inline-block;margin-top:20px;padding:10px 22px;border-radius:12px;background:var(--orange,#F36418);color:#fff;text-decoration:none">العودة للرئيسية</a>
  </div>`;
}

function renderOwnerProfile(data) {
  const root = document.getElementById('opp-root');
  const p = data.profile || {};
  const spaces  = data.spaces  || [];
  const bazaars = data.bazaars || [];
  const roles = Array.isArray(p.roles) ? p.roles : [];

  const displayName = p.entity_name || p.full_name || 'ناشر داخل مكاني سبوت';
  const initial = (displayName.trim()[0] || 'م');

  // الأفاتار: avatar_url من profiles (المصدر الموحد) ثم org_logo كاحتياط
  const avatarUrl = p.avatar_url || p.org_logo || '';
  const avatarHtml = avatarUrl
    ? `<div class="opp-avatar" style="background-image:url('${_oppEsc(avatarUrl)}')"></div>`
    : `<div class="opp-avatar">${_oppEsc(initial)}</div>`;

  const coverStyle = p.cover_url ? `style="background-image:url('${_oppEsc(p.cover_url)}')"` : '';

  // badges الأدوار
  const roleMap = {
    space_owner:      { ico: '🏢', label: 'صاحب مساحات' },
    bazaar_organizer: { ico: '🎪', label: 'منظم فعاليات' },
  };
  const effectiveRoles = roles.length ? roles : (spaces.length ? ['space_owner'] : (bazaars.length ? ['bazaar_organizer'] : []));
  const roleBadges = effectiveRoles.map(r => {
    const m = roleMap[r]; if (!m) return '';
    return `<span class="opp-rbadge">${m.ico} ${m.label}</span>`;
  }).join('');

  // الإحصائيات
  const statsHtml = `
    ${spaces.length  ? `<div class="opp-stat"><b>${spaces.length}</b><span>مساحة منشورة</span></div>` : ''}
    ${bazaars.length ? `<div class="opp-stat"><b>${bazaars.length}</b><span>بازار / فعالية</span></div>` : ''}
    ${p.region ? `<div class="opp-stat"><b>📍</b><span>${_oppEsc(p.region)}</span></div>` : ''}`;

  // روابط التواصل (إن وُجدت من organizer_profiles)
  const social = [
    p.whatsapp      ? `<a href="https://wa.me/${_oppEsc(String(p.whatsapp).replace(/[^0-9]/g,''))}" target="_blank" rel="noopener" title="واتساب">🟢</a>` : '',
    p.instagram_url ? `<a href="${_oppEsc(p.instagram_url)}" target="_blank" rel="noopener" title="إنستغرام">📸</a>` : '',
    p.facebook_url  ? `<a href="${_oppEsc(p.facebook_url)}" target="_blank" rel="noopener" title="فيسبوك">📘</a>` : '',
    p.tiktok_url    ? `<a href="${_oppEsc(p.tiktok_url)}" target="_blank" rel="noopener" title="تيك توك">🎵</a>` : '',
  ].filter(Boolean).join('');

  // قسم المساحات
  const spacesSection = roles.includes('space_owner') || spaces.length ? `
    <div class="opp-section">
      <div class="opp-section-title">🏢 المساحات المنشورة</div>
      ${spaces.length
        ? `<div class="opp-grid">${spaces.map(_oppSpaceCard).join('')}</div>`
        : `<div class="opp-empty">لا توجد مساحات منشورة حالياً.</div>`}
    </div>` : '';

  // قسم البازارات
  const bazaarsSection = roles.includes('bazaar_organizer') || bazaars.length ? `
    <div class="opp-section">
      <div class="opp-section-title">🎪 البازارات والفعاليات</div>
      ${bazaars.length
        ? `<div class="opp-grid">${bazaars.map(_oppBazaarCard).join('')}</div>`
        : `<div class="opp-empty">لا توجد فعاليات منشورة حالياً.</div>`}
    </div>` : '';

  root.innerHTML = `
    <div class="opp-cover" ${coverStyle}>
      <button class="opp-back" onclick="oppGoBack()" aria-label="رجوع">→ رجوع</button>
    </div>
    <div class="opp-body">
      <div class="opp-head">
        ${avatarHtml}
        <div class="opp-headinfo">
          <div class="opp-name">${_oppEsc(displayName)}${p.is_verified ? '<span class="opp-verified" title="حساب موثّق">✔️</span>' : ''}</div>
          <div class="opp-type">${_oppEsc(p.entity_type || 'ناشر داخل المنصة')}</div>
        </div>
      </div>
      ${roleBadges ? `<div class="opp-rolebadges">${roleBadges}</div>` : ''}
      ${p.bio ? `<div class="opp-bio">${_oppEsc(p.bio)}</div>` : ''}
      ${social ? `<div class="opp-social">${social}</div>` : ''}
      ${statsHtml.trim() ? `<div class="opp-stats">${statsHtml}</div>` : ''}
      ${spacesSection}
      ${bazaarsSection}
    </div>`;

  document.title = `${displayName} — مكاني سبوت`;
}

function _oppSpaceCard(s) {
  const img = s.image_url || (Array.isArray(s.extra_images) && s.extra_images[0]) || '';
  const imgStyle = img ? `style="background-image:url('${_oppEsc(img)}')"` : '';
  const emoji = !img ? (s.icon_emoji || '🏢') : '';
  const price = s.min_price ? `<span class="opp-card-price">من ${Number(s.min_price).toLocaleString('ar-EG')} ج</span>` : '';
  return `<a class="opp-card" href="/spaces/?space=${_oppEsc(s.id)}">
    <div class="opp-card-img" ${imgStyle}>${emoji}</div>
    <div class="opp-card-body">
      <div class="opp-card-name">${_oppEsc(s.name || 'مساحة')}</div>
      <div class="opp-card-meta"><span>${_oppEsc(s.region || s.type || '')}</span>${price}</div>
    </div>
  </a>`;
}

function _oppBazaarCard(b) {
  const img = b.event_image_url || b.image || '';
  const imgStyle = img ? `style="background-image:url('${_oppEsc(img)}')"` : '';
  const emoji = !img ? '🎪' : '';
  const price = b.price_per_slot ? `<span class="opp-card-price">${Number(b.price_per_slot).toLocaleString('ar-EG')} ج/يوم</span>` : '';
  let dateLabel = '';
  if (b.date_start) {
    try { dateLabel = new Date(b.date_start).toLocaleDateString('ar-EG', { month: 'short', year: 'numeric' }); } catch (e) {}
  }
  return `<a class="opp-card" href="/bazaars/?bazaar=${_oppEsc(b.id)}">
    <div class="opp-card-img" ${imgStyle}>${emoji}</div>
    <div class="opp-card-body">
      <div class="opp-card-name">${_oppEsc(b.name || 'بازار')}</div>
      <div class="opp-card-meta"><span>${_oppEsc(b.venue_name || b.region || dateLabel)}</span>${price}</div>
    </div>
  </a>`;
}


/* ================================================================
   📋 القسم الحادي عشر: مودال الحجز
   ================================================================ */

async function openBooking(spaceId) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return null;
  currentBookingSpace = s;   /* لالتقاط owner_id/space_id عند الإرسال */
  trackEvent('booking_button_clicked', { space_id: spaceId, space_name: s.name });

  const sizePrices = {};
  const sizesClean = [];
  (s.sizes || []).forEach(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    sizePrices[label] = price;
    sizesClean.push(label);
  });

  const selSize = sizesClean[0] || '';
  const selPrice = sizePrices[selSize] || s.price;

  document.getElementById('msi-name').textContent = s.name;
  document.getElementById('msi-meta').innerHTML =
    `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(selPrice).toLocaleString('ar-EG')} ج/شهر</strong>`;

  const sizeSelect = document.getElementById('bk-size');
  sizeSelect.innerHTML = '<option value="">اختر الحجم</option>' +
    sizesClean.map(sz => `<option value="${sz}" ${sz === selSize ? 'selected' : ''}>${sz}</option>`).join('') +
    '<option value="مخصص">مخصص — هحدده لاحقاً</option>';

  sizeSelect.onchange = function () {
    const p = sizePrices[this.value] || s.price;
    document.getElementById('msi-meta').innerHTML =
      `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(p).toLocaleString('ar-EG')} ج/شهر</strong>`;
  };

  if (currentUser) {
    const nameEl = document.getElementById('bk-name');
    const phoneEl = document.getElementById('bk-phone');
    const emailEl = document.getElementById('bk-email');
    if (nameEl) nameEl.value = currentProfile?.full_name || currentUser.user_metadata?.full_name || '';
    if (phoneEl) phoneEl.value = currentProfile?.phone || '';
    if (emailEl) emailEl.value = currentUser.email || '';
  } else {
    ['bk-name', 'bk-phone', 'bk-email'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  document.getElementById('modal-form-wrap').style.display = 'block';
  document.getElementById('modal-success').style.display = 'none';
  document.getElementById('bk-error').style.display = 'none';
  ['bk-other-act', 'bk-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const durEl = document.getElementById('bk-dur');
  if (durEl) durEl.value = '';
  const otherWrap = document.getElementById('other-act-wrap');
  if (otherWrap) otherWrap.style.display = 'none';
  document.querySelectorAll('.act-pick-btn').forEach(b => b.classList.remove('on'));

  if (selectedAct) {
    const btn = document.querySelector(`.act-pick-btn[data-id="${selectedAct}"]`);
    if (btn) {
      btn.classList.add('on');
      if (otherWrap) otherWrap.style.display = (selectedAct === 'other') ? 'block' : 'none';
    }
  }

  document.getElementById('booking-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  return s;
}

function closeModal() {
  document.getElementById('booking-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function closeModalOnBg(e) {
  if (e.target === document.getElementById('booking-modal')) closeModal();
}


/* ================================================================
   📬 القسم الثاني عشر: إرسال طلب الحجز لـ Google Sheets + Supabase
   ================================================================ */

async function submitBooking() {
  const name = document.getElementById('bk-name').value.trim();
  const phone = document.getElementById('bk-phone').value.trim();
  const email = document.getElementById('bk-email').value.trim();
  const actBtn = document.querySelector('.act-pick-btn.on');
  const size = document.getElementById('bk-size').value;
  const dur = document.getElementById('bk-dur').value;
  const date = document.getElementById('bk-date').value;
  const notes = document.getElementById('bk-notes').value.trim();

  // ── Validation ──────────────────────────────────────────────
  if (!name) { showFormError('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showFormError('من فضلك ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!actBtn) { showFormError('من فضلك اختار نوع نشاطك التجاري'); return; }
  if (!currentUser) { showFormError('يجب تسجيل الدخول لإرسال طلب الحجز'); return; }

  document.getElementById('bk-error').style.display = 'none';

  const submitBtn = document.querySelector('#modal-form-wrap .btn-primary');
  const origText = submitBtn.innerHTML;
  submitBtn.innerHTML = '⏳ جاري الإرسال…';
  submitBtn.disabled = true;
  submitBtn.style.opacity = '0.7';

  // ── بيانات المساحة من الحالة الحقيقية (currentBookingSpace) لا من نص العرض ──
  const spaceName = currentBookingSpace?.name || document.getElementById('msi-name').textContent;
  const spaceLoc  = currentBookingSpace?.loc || '';
  const price     = resolveSizePrice(currentBookingSpace, size);

  // ── حفظ الحجز عبر الطبقة المشتركة (shared/booking.js) — بدون Google Sheets ──
  const result = await submitSpaceBookingRequest(sbClient, currentUser, {
    spaceId:  currentBookingSpace?.id,
    ownerId:  currentBookingSpace?.ownerId,
    spaceName, spaceLoc, price,
    activity: actBtn?.textContent || '',
    size, duration: dur, startDate: date, notes,
  });

  if (!result.ok) {
    submitBtn.innerHTML = origText;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '1';
    showFormError(result.error);
    return;
  }

  // ── تحديث الـ Profile لو في بيانات ناقصة ───────────────
  const profileUpdate = {};
  if (name && !currentProfile?.full_name) profileUpdate.full_name = name;
  if (phone && !currentProfile?.phone) profileUpdate.phone = phone;
  if (email && !currentProfile?.email) profileUpdate.email = email;
  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await sbClient
      .from('profiles')
      .upsert({ id: currentUser.id, ...profileUpdate }, { onConflict: 'id' });
    if (!profileError) currentProfile = { ...currentProfile, ...profileUpdate };
  }

  await loadDashboardData(currentUser);

  // ── عرض شاشة النجاح ────────────────────────────────────────
  trackEvent('booking_submitted', { space_id: currentBookingSpace?.id, space_name: currentBookingSpace?.name });
  document.getElementById('modal-form-wrap').style.display = 'none';
  document.getElementById('modal-success').style.display = 'block';
}


function showFormError(msg) {
  const el = document.getElementById('bk-error');
  if (!el) return;
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
/* ================================================================
   🔐 القسم الثالث عشر: نظام تسجيل الدخول (Supabase Auth)
   ================================================================ */

async function initAuth() {
  if (!sbClient) return;

  try {
    const { data: { session } } = await sbClient.auth.getSession();

    if (session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient.from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      currentAvatarUrl = profile?.avatar_url || null;   // 🪪 المصدر الموحّد
      setNavUser(session.user, profile);

      // يُفتح الداشبورد تلقائياً في حالتين صريحتين فقط:
      //   1) رابط مباشر /?p=dashboard (من الصفحات الفرعية)
      //   2) العودة من redirect مصادقة (Google OAuth / تأكيد بريد)
      // فيما عدا ذلك تبقى الصفحة الافتراضية (الرئيسية) كما هي
      const urlPage = new URLSearchParams(window.location.search).get('p');
      if (urlPage === 'dashboard' || _authRedirect) {
        _authRedirect = false;
        await loadDashboardData(session.user);
        showPage('dashboard');
      }
    } else {
      setNavUser(null, null);
    }

    // تنظيف مفتاح قديم لم يعد مستخدماً (كان يسبب فتح الداشبورد بدل الرئيسية)
    localStorage.removeItem('lastPage');
  } catch (_) {
    setNavUser(null, null);
  }

  // ⚠️ ملاحظة مهمة: Supabase يطلق حدث SIGNED_IN ليس فقط عند تسجيل دخول جديد،
  // بل أيضاً عند تجديد الـ token وعند العودة للتبويب (tab focus).
  // لذلك لا نحوّل للداشبورد إلا عند تسجيل دخول فعلي من صفحة login/signup
  // أو عند العودة من redirect مصادقة — وإلا تُترك صفحة المستخدم الحالية كما هي.
  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      const sameUser = currentUser && currentUser.id === session.user.id;
      currentUser = session.user;

      // لا داعي لإعادة جلب الـ profile عند كل تجديد token
      if (!sameUser || !currentProfile) {
        const { data: profile } = await sbClient.from('profiles').select('*').eq('id', session.user.id).single();
        currentProfile = profile;
        currentAvatarUrl = profile?.avatar_url || null;   // 🪪 المصدر الموحّد
      }
      setNavUser(session.user, currentProfile);

      // تحديد الصفحة النشطة حالياً
      const activePage = document.querySelector('.page.active')?.id || '';
      const isOnAuthPage = ['pg-login', 'pg-signup'].some(
        id => document.getElementById(id)?.classList.contains('active')
      );

      if (isOnAuthPage || _authRedirect) {
        // تسجيل دخول فعلي (من صفحة الدخول أو عائد من OAuth) — روّح للداشبورد
        _authRedirect = false;
        await loadDashboardData(session.user);
        showPage('dashboard');
      } else if (activePage === 'pg-dashboard' && !sameUser) {
        // مستخدم جديد والصفحة المعروضة هي الداشبورد — حمّل بياناته فقط
        await loadDashboardData(session.user);
      }
      // غير ذلك: تجديد جلسة/عودة للتبويب — لا نغيّر الصفحة إطلاقاً

    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentProfile = null;
      currentAvatarUrl = null;
      setNavUser(null, null);
    }
  });
}

function setNavUser(user, profile) {
  // يُزامن الـ class مع الحالة النهائية (بعد تأكيد getSession)
  document.documentElement.classList.toggle('sb-authed', !!user);

  const guestEl = document.getElementById('nav-guest');
  const loggedEl = document.getElementById('nav-logged');
  if (!guestEl || !loggedEl) return;

  if (!user) {
    guestEl.style.display = 'flex';
    loggedEl.style.display = 'none';
  } else {
    const name = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
    const email = user.email || '';
    const initial = name.trim()[0] || '؟';
    const roleLabel = { tenant: 'مستأجر', owner: 'صاحب مساحة' }[profile?.role] || 'مستخدم';

    guestEl.style.display = 'none';
    loggedEl.style.display = 'flex';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const circleEl = document.getElementById('nav-av-circle');
    if (circleEl) {
      if (currentAvatarUrl) {
        circleEl.innerHTML = `<img src="${currentAvatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.outerHTML='${initial}'">`;
      } else {
        circleEl.textContent = initial;
      }
    }
    set('nav-av-name', name);
    set('nav-av-email', email);
    set('dd-name', name);
    set('dd-email', email);
    set('dd-role', roleLabel);

    const badgeEl = document.getElementById('dd-plan-badge');
    if (badgeEl) {
      if (profile?.role === 'owner') {
        const plan = profile?.plan_tier || 'starter';
        const planBadges = {
          starter: { text: '🆓 Starter', cls: 'pb-starter' },
          growth: { text: '🟧 Growth', cls: 'pb-growth' },
          pro: { text: '👑 Pro', cls: 'pb-pro' },
        };
        const b = planBadges[plan] || planBadges.starter;
        badgeEl.textContent = b.text;
        badgeEl.className = `plan-badge ${b.cls}`;
        badgeEl.style.display = 'inline-flex';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    const ownerBtn = document.getElementById('dd-owner-dash-btn');
    if (ownerBtn) ownerBtn.style.display = profile?.role === 'owner' ? 'flex' : 'none';

    updateBnUser(user, profile);
  }

  const bnUserIcon = document.getElementById('bn-user-icon');
  const bnUserLabel = document.getElementById('bn-user-label');

  if (bnUserIcon && bnUserLabel) {
    if (user) {
      const initial = (profile?.full_name || user.email || 'م')[0].toUpperCase();
      bnUserIcon.innerHTML = currentAvatarUrl
        ? `<img src="${currentAvatarUrl}" style="width:22px;height:22px;border-radius:50%;object-fit:cover" onerror="this.outerHTML='<span style=\\'width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;\\'>${initial}</span>'">`
        : `<span style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">${initial}</span>`;
      bnUserLabel.textContent = 'حسابي';
      const descEl = document.getElementById('bn-user-desc');
      if (descEl) descEl.textContent = profile?.full_name?.split(' ')[0] || 'مرحباً';
    } else {
      bnUserIcon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
      bnUserLabel.textContent = 'دخول';
    }
  }
}


/* ================================================================
   🔽 القسم الرابع عشر: القائمة المنسدلة للمستخدم
   ================================================================ */

function toggleUserDropdown() {
  const btn = document.getElementById('nav-avatar-btn');
  const dd = document.getElementById('nav-dropdown');
  if (!btn || !dd) return;
  dd.classList.contains('open')
    ? closeUserDropdown()
    : (btn.classList.add('open'), dd.classList.add('open'));
}

function closeUserDropdown() {
  document.getElementById('nav-avatar-btn')?.classList.remove('open');
  document.getElementById('nav-dropdown')?.classList.remove('open');
}

document.addEventListener('click', e => {
  const area = document.getElementById('nav-avatar-btn');
  if (area && !area.contains(e.target)) closeUserDropdown();
});


/* ================================================================
   📧 القسم الخامس عشر: تسجيل الدخول بالبريد الإلكتروني
   ================================================================ */

async function doEmailLogin() {
  if (!sbClient) return;
  clearAuthAlert('login-alert');

  const email = document.getElementById('li-email')?.value.trim();
  const pass = document.getElementById('li-pass')?.value;

  if (!email) { showAuthAlert('login-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass) { showAuthAlert('login-alert', 'error', 'من فضلك ادخل كلمة المرور'); return; }

  setBtnLoading('btn-login-submit', true);
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password: pass });
  setBtnLoading('btn-login-submit', false, 'تسجيل الدخول ←');

  if (error) {
    const msgs = {
      'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غلط',
      'Email not confirmed': 'لازم تأكد بريدك الإلكتروني الأول — فتش في الـ Inbox',
      'Too many requests': 'كتر طلبات تسجيل الدخول — انتظر قليلاً وحاول تاني',
    };
    showAuthAlert('login-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  trackEvent('login', { method: 'email' });
  await loadDashboardData(data.user);
  showPage('dashboard');
}


/* ================================================================
   ✍️ القسم السادس عشر: إنشاء حساب جديد
   ================================================================ */

async function doEmailSignup() {
  if (!sbClient) return;
  clearAuthAlert('signup-alert');
  trackEvent('signup_started', { method: 'email' });

  const name = document.getElementById('su-name')?.value.trim();
  const phone = document.getElementById('su-phone')?.value.trim();
  const email = document.getElementById('su-email')?.value.trim();
  const pass = document.getElementById('su-pass')?.value;
  const role = document.getElementById('su-role')?.value;
  const city = document.getElementById('su-city')?.value;

  if (!name) { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showAuthAlert('signup-alert', 'error', 'ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!email) { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass || pass.length < 8) {
    showAuthAlert('signup-alert', 'error', 'كلمة المرور لازم تكون ٨ أحرف على الأقل'); return;
  }
  if (!role) { showAuthAlert('signup-alert', 'error', 'من فضلك اختار نوع حسابك'); return; }

  setBtnLoading('btn-signup-submit', true);

  const { data, error } = await sbClient.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: window.location.origin,
      data: { full_name: name, phone, role, city }
    }
  });

  setBtnLoading('btn-signup-submit', false, 'إنشاء حساب ←');

  if (error) {
    const msgs = {
      'User already registered': 'البريد ده مسجّل بالفعل — سجّل دخولك',
      'Password should be at least 6 characters': 'كلمة المرور قصيرة — لازم ٦ أحرف على الأقل',
    };
    showAuthAlert('signup-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  if (data.user) {
    await sbClient.from('profiles').upsert({
      id: data.user.id,
      full_name: name,
      phone: phone,
      role: role,
      city: city,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  trackEvent('signup_completed', { method: 'email' });
  const addrEl = document.getElementById('confirm-em-addr');
  if (addrEl) addrEl.textContent = email;
  showPage('confirm');
}


/* ================================================================
   🌐 القسم السابع عشر: تسجيل الدخول بـ Google
   ================================================================ */

async function authWithGoogle() {
  if (!sbClient) return;
  trackEvent('signup_started', { method: 'google' });

  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });

  if (error) {
    showAuthAlert('login-alert', 'error', 'في مشكلة مع Google: ' + error.message);
  }
}


/* ================================================================
   🚪 القسم الثامن عشر: تسجيل الخروج
   ================================================================ */

async function doLogout() {
  if (!sbClient) return;
  closeUserDropdown();
  await sbClient.auth.signOut();
  currentUser = null;
  currentProfile = null;
  currentAvatarUrl = null;
  localStorage.removeItem('lastPage');
  setNavUser(null, null);
  showPage('home');
}


/* ================================================================
   🏠 القسم التاسع عشر: لوحة التحكم (Dashboard)
   ================================================================ */

async function loadDashboardData(user) {
  if (!sbClient) return;

  const [profileRes, orgProfileRes, reqRes] = await Promise.all([
    sbClient.from('profiles').select('*').eq('id', user.id).single(),
    sbClient.from('organizer_profiles').select('is_verified,avatar_url').eq('user_id', user.id).single(),
    sbClient.from('organizer_requests').select('status').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1).single(),
  ]);

  currentUser = user;
  currentProfile = profileRes.data;
  currentAvatarUrl = profileRes.data?.avatar_url || orgProfileRes.data?.avatar_url || null;   // 🪪 المصدر الموحّد: profiles أولاً

  const profile = profileRes.data;
  const name = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const firstName = name.split(' ')[0];

  const el = document.getElementById('dash-firstname');
  if (el) el.textContent = firstName;

  setNavUser(user, profile);

  // عرض قسم الترقية / الانتقال لأصحاب المساحات
  renderUpgradeSection(profile);

  // عرض CTA تنظيم البازار
  const isVerified = orgProfileRes.data?.is_verified === true;
  const reqStatus = reqRes.data?.status || null;
  renderBazaarCTA(isVerified, reqStatus);

  await loadUserBookings(user.id);
  await loadUserRatings(user.id);
  await loadMyBazaars(user.id);

  // ✅ Realtime — يراقب أي تغيير في حالة الحجوزات ويحدّث الداشبورد تلقائياً
  _subscribeBookings(user.id);
}

/* ── renderBazaarCTA — CTA تنظيم البازار في أسفل الداشبورد ── */
function renderBazaarCTA(isVerified, reqStatus) {
  const wrap = document.getElementById('dash-bazaar-cta-wrap');
  if (!wrap) return;

  if (isVerified) {
    // موثّق — لا نظهر CTA، بس رسالة ترحيبية صغيرة
    wrap.innerHTML = `
      <div style="text-align:center;padding:14px 20px;color:var(--ink3);font-size:12px">
        ✓ أنت منظّم موثّق —
        <a href="/bazaars/profile.html" style="color:var(--orange);font-weight:700;text-decoration:none">
          شوف ملفك كمنظّم ←
        </a>
      </div>`;
    return;
  }

  if (reqStatus === 'pending') {
    wrap.innerHTML = `
      <div style="background:#fffbeb;border:1.5px solid #fcd34d;border-radius:16px;
                  padding:16px 20px;display:flex;align-items:center;gap:14px">
        <span style="font-size:26px">⏳</span>
        <div>
          <div style="font-weight:800;color:#d97706;font-size:13px">طلب التوثيق كمنظّم بزار قيد المراجعة</div>
          <div style="font-size:12px;color:#d97706;opacity:.8;margin-top:3px">سنُبلّغك فور الموافقة</div>
        </div>
      </div>`;
    return;
  }

  // مستخدم عادي — عرض CTA كامل
  wrap.innerHTML = `
    <div style="background:linear-gradient(135deg,#fff7ed,#ffedd5);
                border:2px solid var(--orange);border-radius:18px;
                padding:28px 24px;text-align:center">
      <div style="font-size:42px;margin-bottom:12px">🎪</div>
      <h3 style="font-size:17px;font-weight:900;color:var(--dark);margin:0 0 10px">
        هل تريد تنظيم بازار؟
      </h3>
      <p style="font-size:13px;color:var(--ink2);margin:0 0 20px;line-height:1.8;max-width:420px;margin-inline:auto">
        وثّق حسابك كمنظّم وابدأ في نشر بازاراتك على مكاني Spot —
        شارة ✓ بتظهر عندك وبتكسب ثقة العارضين.
      </p>
      <a href="/bazaars/verification.html" class="btn btn-primary"
         style="padding:12px 32px;display:inline-block;font-size:14px;
                text-decoration:none;border-radius:50px">
        🎪 اطلب التوثيق الآن ←
      </a>
    </div>`;
}

/* ── loadMyBazaars — يحمّل بازارات المستخدم في الداشبورد ── */
async function loadMyBazaars(userId) {
  const wrap = document.getElementById('dash-my-bazaars');
  if (!wrap || !sbClient) return;

  try {
    const { data: bazaars } = await sbClient
      .from('bazaars')
      .select('id,name,date_start,date_end,location,image,status')
      .eq('organizer_id', userId)
      .order('date_start', { ascending: false });

    if (!bazaars || bazaars.length === 0) {
      wrap.innerHTML = `
        <div style="text-align:center;padding:28px 16px;color:var(--ink3)">
          <div style="font-size:32px;margin-bottom:8px">🎪</div>
          <div style="font-size:13px;font-weight:600">لم تنظّم أي بازار بعد</div>
          <div style="font-size:12px;margin-top:4px">ابدأ من قسم تنظيم البازار أعلاه</div>
        </div>`;
      return;
    }

    wrap.innerHTML = bazaars.map(b => {
      const ds = b.date_start
        ? new Date(b.date_start).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
        : '—';
      const imgHtml = b.image
        ? `<img src="${b.image}" alt="${b.name}"
                style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0"
                onerror="this.style.display='none'">`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);
                       display:flex;align-items:center;justify-content:center;font-size:18px">🎪</div>`;
      const _today = new Date().toISOString().split('T')[0];
      const _end   = b.date_end || b.date_start;
      const _expired = _end && _end < _today;
      const statusBadge = _expired
        ? `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:#f3f4f6;color:#6b7280;font-weight:700">انتهى</span>`
        : b.status === 'published'
        ? `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:#dcfce7;color:#16a34a;font-weight:700">منشور</span>`
        : `<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--surface2);color:var(--ink3);font-weight:700">${b.status || 'مسودة'}</span>`;
      return `
        <div onclick="window.location.href='/bazaars/?bazaar=${b.id}'"
             style="display:flex;align-items:center;gap:12px;padding:12px 0;
                    border-bottom:1px solid var(--border);cursor:pointer;
                    transition:background .15s;border-radius:8px"
             onmouseover="this.style.background='var(--surface2)';this.style.padding='12px 8px'"
             onmouseout="this.style.background='';this.style.padding='12px 0'">
          ${imgHtml}
          <div style="flex:1;min-width:0">
            <div style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div>
            <div style="font-size:11px;color:var(--ink3);margin-top:2px">📅 ${ds} · 📍 ${b.location || '—'}</div>
          </div>
          ${statusBadge}
        </div>`;
    }).join('');
  } catch (err) {
    wrap.innerHTML = `<div class="no-bookings" style="color:var(--red)">تعذّر تحميل البازارات</div>`;
  }
}

function showDashAlert(type, msg) {
  const el = document.getElementById('dash-alert');
  if (!el) return;
  el.innerHTML = `<div class="auth-alert auth-alert-${type}">
    <span>${type === 'error' ? '⚠️' : '✅'}</span>
    <span>${msg}</span>
  </div>`;
  setTimeout(() => { el.innerHTML = ''; }, 4000);
}


/* ================================================================
   🏬 الانتقال إلى لوحة أصحاب المساحات
   ================================================================ */

async function goToOwnerDashboard() {
  if (!sbClient) { window.location.href = '/dashboard/'; return; }

  const { data: { session } } = await sbClient.auth.getSession();

  if (!session) {
    const onLoginPage = document.getElementById('pg-login')?.classList.contains('active');
    if (onLoginPage) {
      showAuthAlert('login-alert', 'info',
        'سجّل دخولك أولاً من الأعلى — أصحاب المساحات ينتقلون للوحتهم مباشرة بعد الدخول');
      document.getElementById('li-email')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => document.getElementById('li-email')?.focus(), 400);
    } else {
      document.getElementById('owner-gate-modal')?.classList.add('open');
    }
    return;
  }

  const { data: profile } = await sbClient
    .from('profiles').select('role').eq('id', session.user.id).single();

  if (!profile) {
    showAuthAlert('login-alert', 'info', 'يتم تجهيز حسابك — أعد المحاولة بعد لحظة.');
    return;
  }

  if (profile.role === 'owner') {
    window.location.href = '/dashboard/';
    return;
  }

  openOwnerRequestModal();
}

function closeOwnerGateModal() {
  document.getElementById('owner-gate-modal')?.classList.remove('open');
}

function _ownerGateModalBg(e) {
  if (e.target === document.getElementById('owner-gate-modal')) closeOwnerGateModal();
}

/* ──────────────────────────────────────────────────────────────
   renderUpgradeSection — يرسم زر الترقية أو زر الانتقال
   حسب role المستخدم الحالي
   ────────────────────────────────────────────────────────────── */
function renderUpgradeSection(profile) {
  const el = document.getElementById('upgrade-action-section');
  if (!el) return;

  if (profile?.role === 'owner') {
    // صاحب مساحة — زر الانتقال للوحة التحكم الخاصة به
    el.innerHTML = `
      <div style="background:linear-gradient(135deg,#e8f5e9,#f1f8e9);
                  border:1.5px solid #81c784;border-radius:16px;padding:18px 20px;
                  display:flex;align-items:center;justify-content:space-between;
                  flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:28px">🏬</span>
          <div>
            <div style="font-weight:800;color:#2e7d32;font-size:14px">أنت صاحب مساحة!</div>
            <div style="font-size:12px;color:#2e7d32;opacity:.75;margin-top:3px">
              انتقل إلى لوحة تحكم أصحاب المساحات الخاصة بك
            </div>
          </div>
        </div>
        <button onclick="goToOwnerDashboard()"
          style="background:#16a34a;color:#fff;border:none;padding:10px 20px;
                 border-radius:12px;font-family:'Cairo',sans-serif;font-weight:800;
                 font-size:13px;cursor:pointer;white-space:nowrap">
          🏬 لوحة أصحاب المساحات ←
        </button>
      </div>`;
  } else {
    // مستأجر — عرض خيار الترقية
    el.innerHTML = `
      <div style="background:var(--surface2);border:1.5px dashed var(--border);
                  border-radius:16px;padding:18px 20px;
                  display:flex;align-items:center;justify-content:space-between;
                  flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:26px">🚀</span>
          <div>
            <div style="font-weight:800;color:var(--orange);font-size:13px">عندك مساحة للتأجير؟</div>
            <div style="font-size:12px;color:var(--ink3);margin-top:3px">
              اطلب ترقية حسابك وابدأ في عرض مساحاتك على المنصة
            </div>
          </div>
        </div>
        <button id="btn-upgrade-request" onclick="openOwnerRequestModal()"
          style="background:var(--orange);color:#fff;border:none;padding:10px 20px;
                 border-radius:12px;font-family:'Cairo',sans-serif;font-weight:800;
                 font-size:13px;cursor:pointer;white-space:nowrap">
          🏢 طلب تحويل الحساب
        </button>
      </div>`;
  }
}

/* ──────────────────────────────────────────────────────────────
   requestOwnerUpgrade — يرسل طلب الترقية لجدول upgrade_requests
   ────────────────────────────────────────────────────────────── */
async function requestOwnerUpgrade() {
  if (!sbClient || !currentUser) return;

  const btn = document.getElementById('btn-upgrade-request');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال…'; }

  const { error } = await sbClient
    .from('upgrade_requests')
    .insert({
      user_id: currentUser.id,
      user_email: currentUser.email || '',
      user_name: currentProfile?.full_name || currentUser.email || '',
      status: 'pending',
    });

  if (error) {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 طلب ترقية الحساب'; }
    showDashAlert('error', 'تعذّر إرسال الطلب — ' + (error.message || 'حاول مجدداً'));
  } else {
    if (btn) { btn.disabled = true; btn.textContent = '✅ تم إرسال الطلب'; }
    showDashAlert('success', '✅ تم إرسال طلبك! سنراجعه ونتواصل معك خلال 24 ساعة.');
  }
}


/* ================================================================
   📋 القسم العشرون: حجوزات المستخدم
   ================================================================ */

async function loadUserBookings(userId) {
  if (!sbClient) return;

  const contEl = document.getElementById('dash-bookings');
  const cntEl = document.getElementById('dash-booking-count');

  try {
    if (!BAZAARS.length) {
      try { await loadBazaars(); } catch (_) { }
    }

    const { data: spaceBookings } = await sbClient
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(250);

    const { data: bazaarBookings } = await sbClient
      .from('bazaar_bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(250);

    const localBazaarBookings = _loadLocalBazaarBookings(userId);
    const bazaarById = new Map();
    const slotOwned = new Set(); // tracks "bazaar_id:slot_id" pairs already covered by DB
    /* DB records take priority — add first */
    (bazaarBookings || []).forEach(b => {
      const key = b.id || `${b.bazaar_id}:${b.slot_id}`;
      bazaarById.set(key, b);
      if (b.bazaar_id && b.slot_id) slotOwned.add(`${b.bazaar_id}:${b.slot_id}`);
    });
    /* Local cache: skip entries already covered by a DB record for the same slot */
    localBazaarBookings.forEach(b => {
      const compositeKey = `${b.bazaar_id}:${b.slot_id}`;
      if (slotOwned.has(compositeKey)) return; // DB record exists — use it (has updated status)
      const key = b.id || compositeKey;
      if (!bazaarById.has(key)) {
        bazaarById.set(key, b);
        if (b.bazaar_id && b.slot_id) slotOwned.add(compositeKey);
      }
    });

    const normalizedSpaces = (spaceBookings || []).map(b => ({
      kind: 'space',
      id: b.id,
      isWaitlist: !!b.is_waitlist,
      title: b.space_name || '—',
      loc: b.space_loc || '—',
      price: b.price || '—',
      status: b.status || 'pending',
      activity: b.activity || '—',
      size: b.size || '—',
      duration: b.duration || '—',
      created_at: b.created_at,
    }));

    const normalizedBazaars = [...bazaarById.values()].map(b => {
      const bazaar = BAZAARS.find(x => String(x.id) === String(b.bazaar_id));
      const price = bazaar?.price_per_slot
        ? Number(bazaar.price_per_slot).toLocaleString('ar-EG') + ' ج / مكان'
        : 'بازار';
      return {
        kind: 'bazaar',
        title: bazaar?.name || b.bazaar_name || 'حجز بازار',
        loc: bazaar?.location || bazaar?.region || '—',
        price,
        status: b.status || 'confirmed',
        activity: b.business_name || b.activity || '—',
        size: b.slot_id ? 'مكان رقم ' + b.slot_id : 'مكان بازار',
        duration: bazaar?.date_start || '—',
        created_at: b.created_at,
      };
    });

    const bookings = [...normalizedSpaces, ...normalizedBazaars]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (cntEl) cntEl.textContent = bookings.length || 0;

    if (!contEl) return;

    if (!bookings.length) {
      contEl.innerHTML = `
        <div class="no-bookings">
          لا يوجد حجوزات بعد —
          <a onclick="showPage('home');setTimeout(scrollToSearch,150)" style="color:var(--orange);cursor:pointer">
            ابدأ دوّر على مساحة ←
          </a>
        </div>`;
      return;
    }

    const statusMap = {
      pending:         { label: 'قيد المراجعة ⏳',      cls: 'status-pending'   },
      viewing_pending: { label: 'طلب معاينة ⏳',         cls: 'status-pending'   },
      waitlist:        { label: 'قائمة الانتظار ⏳',     cls: 'status-waitlist'  },
      confirmed:       { label: 'مؤكد ✅',              cls: 'status-confirmed' },
      cancelled:       { label: 'ملغي ❌',               cls: 'status-cancelled' },
      completed:       { label: 'مكتمل 🏁',             cls: 'status-confirmed' },
    };

    // بناء HTML لكل حجز
    const allCards = bookings.map(b => {
      const st = (b.kind === 'space' && b.isWaitlist)
        ? statusMap.waitlist
        : (statusMap[b.status] || statusMap.pending);
      const dateStr = b.created_at
        ? new Date(b.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';
      const kindLabel = b.kind === 'bazaar' ? 'بازار' : 'مساحة';
      const canWithdraw = b.kind === 'space' && b.id &&
        (b.isWaitlist || b.status === 'pending' || b.status === 'viewing_pending');
      return `
      <div class="booking-card ${b.kind === 'bazaar' ? 'booking-card-bazaar' : ''}">
        <div class="booking-card-header">
          <div>
            <div class="booking-space-name"><span class="booking-kind-badge">${kindLabel}</span>${b.title}</div>
            <div class="booking-space-loc">📍 ${b.loc} · ${b.price}</div>
          </div>
          <span class="booking-status ${st.cls}">${st.label}</span>
        </div>
        <div class="booking-card-details">
          <span>🏷 ${b.activity}</span>
          <span>📐 ${b.size}</span>
          <span>⏱ ${b.duration}</span>
          <span>📅 ${dateStr}</span>
        </div>
        ${canWithdraw ? `<div class="booking-card-actions">
          <button class="btn-withdraw" onclick="withdrawBooking('${b.id}')">↩ سحب الطلب</button>
        </div>` : ''}
      </div>`;
    });

    // عرض أحدث 3 فقط — والباقي مخفي
    const visible = allCards.slice(0, 3).join('');
    const hidden = allCards.slice(3).join('');
    const hasMore = bookings.length > 3;
    contEl.innerHTML = visible +
      (hasMore ? `<div class="bookings-extra" id="bookings-extra" style="display:none">${hidden}</div>
        <button class="booking-collapse-btn" id="bookings-toggle" onclick="toggleBookings(${bookings.length})">
          ↓ عرض جميع الحجوزات (${bookings.length})
        </button>` : '');

  } catch (e) {
    if (contEl) contEl.innerHTML = '<div class="no-bookings">تعذّر تحميل الحجوزات</div>';
  }
}

async function withdrawBooking(bookingId) {
  if (!sbClient || !bookingId) return;
  if (!confirm('هل تريد سحب طلب الحجز هذا؟\nبعد السحب لن يظهر الطلب في قائمة المراجعة لصاحب المساحة.')) return;

  const btn = document.querySelector(`[onclick="withdrawBooking('${bookingId}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'جاري السحب…'; }

  try {
    const { data: { user }, error: authErr } = await sbClient.auth.getUser();
    if (authErr || !user) throw new Error('يجب تسجيل الدخول أولاً');

    const { error } = await sbClient.rpc('user_cancel_booking', { p_booking_id: bookingId });
    if (error) throw error;

    await loadUserBookings(user.id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '↩ سحب الطلب'; }
    alert('تعذّر سحب الطلب: ' + (e.message || 'خطأ غير معروف'));
  }
}

function _bazaarBookingCacheKey(userId) {
  return `makani:bazaar-bookings:${userId}`;
}

function _loadLocalBazaarBookings(userId) {
  try {
    const raw = localStorage.getItem(_bazaarBookingCacheKey(userId));
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function _saveLocalBazaarBooking(userId, booking) {
  if (!userId || !booking) return;
  const current = _loadLocalBazaarBookings(userId);
  const key = booking.id || `${booking.bazaar_id}-${booking.slot_id}-${booking.created_at}`;
  const next = [booking, ...current.filter(b => {
    const bKey = b.id || `${b.bazaar_id}-${b.slot_id}-${b.created_at}`;
    return bKey !== key;
  })].slice(0, 100);
  localStorage.setItem(_bazaarBookingCacheKey(userId), JSON.stringify(next));
}


/* ================================================================
   🔄 القسم العشرون-ب: Auto-refresh — تحديث الحجوزات كل 15 ثانية
   ================================================================ */
let _bookingInterval = null;

function _subscribeBookings(userId) {
  if (!userId) return;

  // امسح أي interval قديم
  if (_bookingInterval) {
    clearInterval(_bookingInterval);
    _bookingInterval = null;
  }

  _bookingInterval = setInterval(async () => {
    const onDash = document.getElementById('pg-dashboard')?.classList.contains('active');
    if (!onDash) return;
    await loadUserBookings(userId);
  }, 15000);
}
/* ================================================================
   🔽 دالة إظهار/إخفاء الحجوزات الإضافية في لوحة التحكم
   ================================================================ */

function toggleBookings(total) {
  const extra = document.getElementById('bookings-extra');
  const btn = document.getElementById('bookings-toggle');
  if (!extra || !btn) return;
  const isHidden = extra.style.display === 'none';
  extra.style.display = isHidden ? '' : 'none';
  btn.innerHTML = isHidden
    ? '↑ إخفاء الحجوزات القديمة'
    : `↓ عرض جميع الحجوزات (${total || ''})`;
}

/* ================================================================
   ⭐ القسم الواحد والعشرون: سمعة المستخدم (التقييمات المستلمة)
   نظام أحادي الاتجاه: أصحاب المساحات ومنظمو البازارات يقيّمون المستأجرين،
   وتظهر هنا على حساب المستأجر للقراءة فقط (لا يقيّم المستأجر أحداً).
   ================================================================ */

/* تأمين النص قبل عرضه (منع XSS لتعليقات الملّاك) */
function _escHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const REP_BADGES = {
  excellent: { label: 'سمعة ممتازة', emoji: '🏆', cls: 'rep-excellent' },
  trusted: { label: 'مستأجر موثوق', emoji: '✅', cls: 'rep-trusted' },
  good: { label: 'سمعة جيدة', emoji: '👍', cls: 'rep-good' },
  weak: { label: 'تحتاج لتحسين', emoji: '⚠️', cls: 'rep-weak' },
  new: { label: 'لا توجد تقييمات بعد', emoji: '✨', cls: 'rep-new' },
};

/* نجوم 1-5 للعرض */
function repStarsHtml(val, size) {
  const v = Math.round(Number(val) || 0);
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span style="color:${i <= v ? '#F36418' : '#d9d9d9'};font-size:${size || 14}px">★</span>`;
  }
  return s;
}

async function loadUserRatings(userId) {
  if (!sbClient) return;

  const contEl = document.getElementById('dash-ratings');
  if (!contEl) return;

  try {
    const [{ data: rep }, { data: list }] = await Promise.all([
      sbClient.rpc('get_user_reputation', { p_user_id: userId }),
      sbClient.from('user_ratings')
        .select('*')
        .eq('ratee_id', userId)
        .eq('status', 'visible')
        .order('created_at', { ascending: false }),
    ]);

    const total = rep?.total || 0;
    const avg = Number(rep?.avg_overall || 0);
    const badge = REP_BADGES[rep?.badge] || REP_BADGES.new;

    /* تحديث بطاقة الإحصائية في الأعلى */
    const statVal = document.getElementById('dash-rep-stat');
    const statSub = document.getElementById('dash-rep-sub');
    if (statVal) statVal.textContent = total ? avg.toFixed(1) : '—';
    if (statSub) statSub.textContent = total ? `${total} تقييم` : 'لا تقييمات بعد';

    if (!total) {
      contEl.innerHTML = `
        <div class="rep-empty">
          <div class="rep-empty-ico">✨</div>
          <div class="rep-empty-title">لا توجد تقييمات على حسابك بعد</div>
          <div class="rep-empty-sub">عند تعاملك مع أصحاب المساحات أو منظمي البازارات عبر المنصة، تظهر تقييماتهم لك هنا وتبني سمعتك.</div>
        </div>`;
      return;
    }

    const critRows = [
      ['⏰ الالتزام بالمواعيد', rep.avg_commitment],
      ['🧹 نظافة المكان', rep.avg_cleanliness],
      ['🤝 حسن التعامل', rep.avg_dealing],
      ['💳 الالتزام المالي', rep.avg_payment],
      ['📋 احترام الشروط', rep.avg_rules],
    ].filter(r => r[1] != null);

    const repPanel = `
      <div class="rep-panel">
        <div class="rep-badge ${badge.cls}">
          <div class="rep-badge-emoji">${badge.emoji}</div>
          <div class="rep-score">${avg.toFixed(1)}</div>
          <div class="rep-stars">${repStarsHtml(avg, 16)}</div>
          <div class="rep-badge-label">${badge.label}</div>
          <div class="rep-count">${total} تقييم · 👍 ${rep.positive || 0} · 👎 ${rep.negative || 0}</div>
        </div>
        ${critRows.length ? `<div class="rep-criteria">
          ${critRows.map(([label, val]) => `
            <div class="rep-crit-row">
              <span class="rep-crit-label">${label}</span>
              <span class="rep-crit-bar"><span class="rep-crit-fill" style="width:${(Number(val) / 5 * 100)}%"></span></span>
              <span class="rep-crit-val">${Number(val).toFixed(1)}</span>
            </div>`).join('')}
        </div>` : ''}
      </div>`;

    const listHtml = (list || []).map(r => {
      const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('ar-EG') : '';
      const ctxIcon = r.context_type === 'bazaar' ? '🎪' : '🏬';
      const roleLbl = r.rater_role === 'organizer' ? 'منظّم بازار' : 'صاحب مساحة';
      return `
        <div class="recv-rating-card">
          <div class="recv-rating-head">
            <div>
              <div class="recv-rater">${ctxIcon} ${_escHtml(r.rater_name || roleLbl)}</div>
              <div class="recv-context">${roleLbl}${r.context_name ? ' · ' + _escHtml(r.context_name) : ''}</div>
            </div>
            <div class="recv-rating-stars">${repStarsHtml(r.overall, 14)}<span class="recv-date">${dateStr}</span></div>
          </div>
          ${r.comment ? `<div class="recv-comment">"${_escHtml(r.comment)}"</div>` : ''}
        </div>`;
    }).join('');

    contEl.innerHTML = repPanel + `<div class="recv-ratings-list">${listHtml}</div>`;

  } catch (e) {
    contEl.innerHTML = '<div class="no-bookings">تعذّر تحميل التقييمات</div>';
  }
}


/* ================================================================
   🛠️ القسم الثاني والعشرون: دوال مساعدة مشتركة
   ================================================================ */

function showAuthAlert(containerId, type, msg) {
  const icons = { error: '⚠️', success: '✅', info: '💡' };
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="auth-alert auth-alert-${type}">
    <span>${icons[type] || '💡'}</span>
    <span>${msg}</span>
  </div>`;
}

function clearAuthAlert(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

function setBtnLoading(id, on, orig) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = on;
  if (on) b.innerHTML = `<span class="spin-sm"></span> جاري التحميل…`;
  else if (orig) b.innerHTML = orig;
}

function togglePassVis(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

/* ── دوال Bottom Navigation ── */

function updateBottomNav(page) {
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('bn-' + page);
  if (el) el.classList.add('active');
}

async function handleBnUser() {
  updateBottomNav('user');

  if (currentUser) {
    goToDashboard();
    return;
  }

  if (sbClient) {
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session?.user) {
        currentUser = session.user;
        const { data: profile } = await sbClient.from('profiles').select('*').eq('id', session.user.id).single();
        currentProfile = profile;
        currentAvatarUrl = profile?.avatar_url || null;   // 🪪 المصدر الموحّد
        setNavUser(session.user, profile);
        await loadDashboardData(session.user);
        showPage('dashboard');
        return;
      }
    } catch (_) { }
  }

  goToLogin();
}

function updateBnUser(user, profile) {
  const icon = document.getElementById('bn-user-icon');
  const label = document.getElementById('bn-user-label');
  const desc = document.getElementById('bn-user-desc');
  if (!icon || !label) return;

  if (user) {
    const initial = (profile?.full_name || user.email || '؟')[0].toUpperCase();
    icon.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">${initial}</span>`;
    label.textContent = 'حسابي';
    if (desc) desc.textContent = profile?.full_name?.split(' ')[0] || 'مرحباً';
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = 'دخول';
    if (desc) desc.textContent = 'سجّل أو ادخل';
  }
}


/* ================================================================
   🎪 القسم الثالث والعشرون: تحميل البازارات من Google Sheets
   ================================================================ */

/**
 * يُطبّع صف واحد من Google Sheets ليتناسب مع هيكل البازار
 * يدعم أسماء الأعمدة بالعربي والإنجليزي
 */
function _normalizeBazaarRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k];
    }
    return null;
  };
  const idVal = get('id', 'ID', 'رقم', 'No') || (Math.random() * 1e9 | 0).toString(36);
  const tagsVal = get('tags', 'Tags', 'وسوم', 'تاجات') || '';
  const firstTag = Array.isArray(tagsVal)
    ? tagsVal[0]
    : String(tagsVal || '').split(',').map(t => t.trim()).filter(Boolean)[0];

  return {
    id: String(idVal),
    name: get('name', 'اسم البازار', 'البازار', 'الاسم', 'Name') || '—',
    location: get('location', 'venueName', 'venue_name', 'اسم المكان', 'الموقع', 'المكان', 'Location') || '',
    region: get('region', 'area', 'Area', 'المنطقة', 'Region') || '',
    date_start: get('date_start', 'dateStart', 'date_start', 'تاريخ البداية', 'تاريخ البدء', 'من تاريخ', 'Start Date') || '',
    date_end: get('date_end', 'dateEnd', 'date_end', 'تاريخ النهاية', 'تاريخ الانتهاء', 'حتى تاريخ', 'End Date') || '',
    time_start: get('time_start', 'وقت البداية', 'وقت البدء', 'Start Time') || '',
    time_end: get('time_end', 'وقت النهاية', 'وقت الانتهاء', 'End Time') || '',
    price_per_slot: Number(get('price_per_slot', 'price', 'Price', 'السعر', 'سعر المكان') || 0),
    available_slots: Number(get('available_slots', 'availSlots', 'avail_slots', 'أماكن متاحة', 'Available Slots') || get('total_slots', 'totalSlots', 'total_slots', 'إجمالي الأماكن', 'Total Slots') || 0),
    total_slots: Number(get('total_slots', 'totalSlots', 'total_slots', 'إجمالي الأماكن', 'عدد الأماكن', 'Total Slots') || 0),
    image: get('image', 'صورة', 'رابط الصورة', 'Image', 'img') || '',
    description: get('description', 'الوصف', 'تفاصيل', 'Description') || '',
    category: get('category', 'venueType', 'venue_type', 'الفئة', 'النوع', 'التصنيف', 'Category') || firstTag || '',
    organizer: get('organizer', 'المنظم', 'جهة التنظيم', 'Organizer') || '',
    venue_address: get('venue_address', 'address', 'Address', 'عنوان المكان', 'العنوان', 'Venue') || '',
    status: get('status', 'الحالة', 'Status') || 'published',
  };
}

/* ================================================================
   🔍 مودال المعاينة — Inspection Modal
   ================================================================ */

let _inspSpaceId = null;
let _inspSelDate = null;

const _INSP_DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const _INSP_MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

async function openInspectionModal(spaceId) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return;
  _inspSpaceId = spaceId;
  _inspSelDate = null;

  // اسم المساحة
  const nameEl = document.getElementById('insp-space-name');
  if (nameEl) nameEl.textContent = s.name;

  // قائمة الأنشطة
  const actSel = document.getElementById('insp-activity');
  if (actSel) {
    actSel.innerHTML = '<option value="">اختر نشاطك</option>';
    const actList = (ACTIVITIES && ACTIVITIES.length) ? ACTIVITIES : (s.acts || []);
    actList.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      actSel.appendChild(opt);
    });
    const other = document.createElement('option');
    other.value = 'أخرى'; other.textContent = 'أخرى';
    actSel.appendChild(other);
  }

  // توليد المواعيد
  _inspBuildDates();

  // تعبئة بيانات المستخدم إن وجدت
  const nameInput = document.getElementById('insp-name');
  const phoneInput = document.getElementById('insp-phone');
  if (nameInput) nameInput.value = currentProfile?.full_name || currentProfile?.name || '';
  if (phoneInput) phoneInput.value = currentProfile?.phone || '';

  // reset
  const errEl = document.getElementById('insp-error');
  if (errEl) errEl.textContent = '';
  _inspGoStep(1);

  // فتح المودال
  const modal = document.getElementById('inspection-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('open'));
  document.body.style.overflow = 'hidden';
}

function closeInspectionModal() {
  const modal = document.getElementById('inspection-modal');
  if (!modal) return;
  modal.classList.remove('open');
  setTimeout(() => { modal.style.display = 'none'; }, 240);
  document.body.style.overflow = '';
}

function closeInspModalOnBg(e) {
  if (e.target.id === 'inspection-modal') closeInspectionModal();
}

function _inspGoStep(step) {
  [1, 2, 3].forEach(n => {
    const body = document.getElementById(`insp-step-${n}`);
    const dot = document.getElementById(`insp-dot-${n}`);
    const line = document.getElementById(`insp-line-${n}`);
    if (body) body.style.display = n === step ? 'block' : 'none';
    if (dot) {
      dot.classList.toggle('active', n === step);
      dot.classList.toggle('done', n < step);
    }
    if (line) line.classList.toggle('done', n < step);
  });
}

function _inspBuildDates() {
  const grid = document.getElementById('insp-dates-grid');
  if (!grid) return;
  const slots = _inspGetWorkingDays();
  grid.innerHTML = slots.map(d => `
    <label class="insp-date-card" onclick="_inspSelectDate(this,'${d.value}')">
      <input type="radio" name="insp-date" style="display:none">
      <div class="insp-date-radio"></div>
      <span style="flex:1">${d.dayLabel} — ${d.dateLabel}</span>
      <span class="insp-date-time">${d.time}</span>
    </label>`).join('');
}

function _inspSelectDate(el, val) {
  document.querySelectorAll('.insp-date-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  _inspSelDate = val;
}

function _inspSubmitForm() {
  const name = (document.getElementById('insp-name')?.value || '').trim();
  const phone = (document.getElementById('insp-phone')?.value || '').trim();
  const activity = (document.getElementById('insp-activity')?.value || '').trim();
  const errEl = document.getElementById('insp-error');

  if (!name) { errEl.textContent = '⚠ يرجى إدخال الاسم الكامل'; return; }
  if (!/^01\d{9}$/.test(phone)) { errEl.textContent = '⚠ رقم الهاتف 11 رقم يبدأ بـ 01'; return; }
  if (!activity) { errEl.textContent = '⚠ يرجى اختيار النشاط التجاري'; return; }
  if (!_inspSelDate) { errEl.textContent = '⚠ يرجى اختيار موعد للمعاينة'; return; }
  errEl.textContent = '';

  const s = heroItems.find(x => x.id === _inspSpaceId) || mpCurrentItems.find(x => x.id === _inspSpaceId);
  const spaceName = s ? s.name : '—';
  const waMsg = `مرحباً، عايز أحجز معاينة 🏪\nالاسم: ${name}\nالمساحة: ${spaceName}\nالموعد: ${_inspSelDate}\nالنشاط: ${activity}\nتم التحويل 150 ج على انستاباي`;
  const waLink = document.getElementById('insp-wa-link');
  if (waLink) waLink.href = `https://wa.me/+201148662218?text=${encodeURIComponent(waMsg)}`;

  _inspGoStep(2);
}

function _inspCopyNumber() {
  navigator.clipboard?.writeText('01148662218').then(() => _inspFlashCopy('insp-copy-num-btn'));
}

function _inspCopyId() {
  const id = document.getElementById('insp-id-val')?.textContent || '';
  navigator.clipboard?.writeText(id).then(() => _inspFlashCopy('insp-copy-id-btn'));
}

function _inspFlashCopy(btnId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = '✓ تم';
  btn.style.cssText += ';background:rgba(37,211,102,0.2);color:#25D366;border-color:rgba(37,211,102,0.3)';
  setTimeout(() => {
    btn.textContent = orig;
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
  }, 2000);
}

function _inspConfirm() {
  const name = (document.getElementById('insp-name')?.value || '').trim();
  const phone = (document.getElementById('insp-phone')?.value || '').trim();
  const activity = (document.getElementById('insp-activity')?.value || '').trim();
  const s = heroItems.find(x => x.id === _inspSpaceId) || mpCurrentItems.find(x => x.id === _inspSpaceId);
  const spaceName = s ? s.name : '—';

  const inspId = `INS-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const idEl = document.getElementById('insp-id-val');
  if (idEl) idEl.textContent = inspId;

  const detailsEl = document.getElementById('insp-confirm-details');
  if (detailsEl) {
    detailsEl.innerHTML = [
      ['المساحة', spaceName],
      ['الموعد', _inspSelDate || '—'],
      ['النشاط', activity],
    ].map(([k, v]) => `
      <div class="insp-detail-row">
        <span class="insp-detail-key">${k}</span>
        <span class="insp-detail-val">${v}</span>
      </div>`).join('');
  }

  // رسالة واتساب للأونر
  const ownerMsg = `🔔 طلب معاينة جديد\n${'─'.repeat(16)}\nرقم الطلب: ${inspId}\nالمساحة: ${spaceName}\nالاسم: ${name}\nالهاتف: ${phone}\nالنشاط: ${activity}\nالموعد المطلوب: ${_inspSelDate || '—'}\n${'─'.repeat(16)}\n⏳ في انتظار تأكيد الدفع`;
  window.open(`https://wa.me/+201148662218?text=${encodeURIComponent(ownerMsg)}`, '_blank');

  _inspGoStep(3);
}

function _inspGetWorkingDays() {
  const result = [];
  const times = ['11:00 ص', '11:00 ص', '2:00 م'];
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (result.length < 3) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const dayLabel = _INSP_DAY_NAMES[dow];
      const dateLabel = `${d.getDate()} ${_INSP_MONTH_NAMES[d.getMonth()]}`;
      const time = times[result.length];
      result.push({
        dayLabel,
        dateLabel,
        time,
        value: `${dayLabel} ${dateLabel} — الساعة ${time}`,
      });
    }
    d.setDate(d.getDate() + 1);
  }
  return result;
}

/* ================================================================
   ⭐ صفحة الباقات — Pricing Page Animations
   ================================================================ */

let _pricingObserver = null;

function initPricingAnimations() {
  const pg = document.getElementById('pg-pricing');
  if (!pg) return;

  // trigger hero animations immediately
  pg.querySelectorAll('.pkg-hero .pkg-anim-down').forEach(el => {
    el.classList.add('pkg-ready');
  });
  pg.querySelector('.pkg-hero')?.classList.add('pkg-anim-in');

  // IntersectionObserver for Trust Bar count-up + other sections
  if (_pricingObserver) _pricingObserver.disconnect();

  _pricingObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;

      const el = entry.target;

      // count-up numbers
      if (el.classList.contains('pkg-trust-num') && !el.dataset.static) {
        _pkgCountUp(el);
      }

      // section reveal — trigger parent animation class
      const section = el.closest('section') || el;
      section.classList.add('pkg-anim-in');

      // pitch pulse
      if (el.classList.contains('pkg-pitch')) {
        el.classList.add('pkg-pitch-pulse');
      }

      _pricingObserver.unobserve(el);
    });
  }, { threshold: 0.15 });

  // observe each animatable element
  pg.querySelectorAll('.pkg-trust-num').forEach(el => _pricingObserver.observe(el));
  pg.querySelectorAll('.pkg-cards-section, .pkg-table-section, .pkg-addons-section, .pkg-pitch, .pkg-faq-section, .pkg-cta-banner').forEach(el => _pricingObserver.observe(el));
}

function _pkgCountUp(el) {
  const target = parseInt(el.dataset.target, 10);
  const prefix = el.dataset.prefix || '';
  const suffix = el.dataset.suffix || '';
  const duration = target > 100 ? 1200 : 800;
  const step = 16;
  const increment = target / (duration / step);
  let current = 0;

  const timer = setInterval(() => {
    current = Math.min(current + increment, target);
    el.textContent = prefix + Math.floor(current).toLocaleString('ar-EG') + suffix;
    if (current >= target) clearInterval(timer);
  }, step);
}

/**
 * تحويل رابط Google Drive "view" لرابط صورة مباشر يشتغل في <img>
 * مثال: https://drive.google.com/file/d/ABC123/view  →  https://lh3.googleusercontent.com/d/ABC123
 */
function _toDirectImgUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  // /file/d/ID/view  أو  /file/d/ID
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^\/\?\s]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  // open?id=ID
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&\s]+)/);
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  // uc?id=ID أو uc?export=view&id=ID
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&\s]+)/);
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`;
  return url;
}

async function loadBazaars() {
  // 1. أولاً: محاولة التحميل من Supabase (المصدر الرئيسي والحديث)
  if (sbClient) {
    try {
      const { data, error } = await sbClient
        .from('bazaars')
        .select('id,name,venue_name,region,date_start,date_end,time_start,time_end,price_per_slot,available_slots,total_slots,image,description,category,venue_type,organizer,organizer_id,is_organizer_verified,venue_address,address,maps_link,sketch_url,event_image_url,status,is_featured,is_archived,premium_slots,premium_price')
        .in('status', ['published', 'live', 'completed'])
        .eq('is_archived', false)
        .eq('is_deleted', false)
        .order('date_start', { ascending: true });

      if (!error && data && data.length > 0) {
        BAZAARS = data.map(b => ({
          id: String(b.id),
          name: b.name || '—',
          location: b.venue_name || b.location || '',
          region: b.region || '',
          date_start: b.date_start || '',
          date_end: b.date_end || '',
          time_start: b.time_start || '',
          time_end: b.time_end || '',
          price_per_slot: Number(b.price_per_slot) || 0,
          available_slots: Number(b.available_slots) || 0,
          total_slots: Number(b.total_slots) || 0,
          image: _toDirectImgUrl(b.image || ''),
          description: b.description || '',
          category: b.category || b.venue_type || '',
          organizer: b.organizer || '',
          organizer_id: b.organizer_id || null,
          is_organizer_verified: b.is_organizer_verified || false,
          venue_address: b.venue_address || b.address || '',
          maps_link: b.maps_link || '',
          sketch_url: _toDirectImgUrl(b.sketch_url || ''),
          event_image_url: _toDirectImgUrl(b.event_image_url || b.image || ''),
          status: b.status || 'published',
          is_featured: !!b.is_featured,
        }));
        console.log(`🎪 تم تحميل ${BAZAARS.length} بازار من Supabase للصفحة الرئيسية.`);
        return;
      }
    } catch (sbErr) {
      console.warn('⚠️ تعذر التحميل من Supabase، سيتم الانتقال للـ fallback:', sbErr.message);
    }
  }

  // 2. ثانياً (Fallback): التحميل من Google Sheets
  try {
    const res = await fetch(BAZAAR_SHEET_URL);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ الشيت مش بيرجع JSON:', text.substring(0, 300));
      return;
    }

    let rows = Array.isArray(json) ? json
      : Array.isArray(json.data) ? json.data
        : Array.isArray(json.rows) ? json.rows
          : Array.isArray(json.bazaars) ? json.bazaars
            : Array.isArray(json.result) ? json.result
              : Array.isArray(json.items) ? json.items
                : Array.isArray(json.values) ? json.values
                  : (json.status === 'ok' && Array.isArray(json.data)) ? json.data
                    : [];

    rows = rows.filter(r =>
      r && typeof r === 'object' &&
      Object.values(r).some(v => v !== '' && v !== null && v !== undefined)
    );

    if (!rows.length) {
      return;
    }

    rows = rows
      .map(r => {
        const b = _normalizeBazaarRow(r);
        b.image = _toDirectImgUrl(b.image);
        return b;
      })
      .filter(b => b.name && b.name !== '—')
      .filter(b => !b.status || ['published', 'approved', 'active', 'مقبول', 'موافق', 'منشور', 'تمت الموافقة'].includes(String(b.status).trim().toLowerCase()))
      .sort((a, b) => new Date(a.date_start || 0) - new Date(b.date_start || 0));

    BAZAARS = rows;
    console.log(`🎪 تم تحميل ${BAZAARS.length} بازار من Google Sheets (Fallback).`);

  } catch (err) {
    console.error('❌ خطأ في تحميل البازارات (Sheets):', err.message);
  }
}

/** Supabase fallback */
async function _loadBazaarsFromSupabase() {
  await loadBazaars();
}

/* تهريب HTML — يمنع XSS عند إدراج بيانات بازار (اسم/وصف/موقع يكتبها المنظم) في innerHTML */
function _escBz(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
}

function _renderHomeBazaarEmpty(message) {
  const container = document.getElementById('bz-home-scroll');
  if (!container) return;
  container.innerHTML = `
    <div class="bz-home-empty-pro">
      <div class="bz-home-empty-pro-icon">🎪</div>
      <div class="bz-home-empty-pro-title">لا توجد فعاليات في الوقت الحالي</div>
      <div class="bz-home-empty-pro-sub">${_escBz(message || 'لا يوجد بازار قادم أو جارٍ الآن — تابعنا لتصلك أحدث الفعاليات فور إضافتها.')}</div>
      <div class="bz-home-empty-pro-actions">
        <button class="btn btn-primary" onclick="window.location.href='/bazaars/'">عرض جميع البازارات</button>
        <a class="btn" href="https://wa.me/201103467711?text=${encodeURIComponent('مرحبا، عايز أعرف لما يتضاف بازار جديد')}" target="_blank" rel="noopener noreferrer">تابعنا لمعرفة الجديد</a>
      </div>
    </div>`;
}

/* المصدر الوحيد لقرار "أي بازار يظهر في الصفحة الرئيسية" — عبر get_homepage_featured_bazaar()،
   نفس الدالة الوحيدة في القاعدة، بلا أي منطق اختيار مكرر هنا */
async function loadHomeFeaturedBazaar() {
  const container = document.getElementById('bz-home-scroll');
  if (!container) return;

  if (!sbClient) {
    _renderHomeBazaarEmpty('تعذّر الاتصال بقاعدة البيانات حاليًا.');
    return;
  }

  try {
    const { data, error } = await sbClient.rpc('get_homepage_featured_bazaar');
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) { _renderHomeBazaarEmpty(); return; }

    renderFeaturedBazaarCard({
      id: String(row.id),
      name: row.name || '—',
      location: row.venue_name || row.location || '',
      region: row.region || '',
      date_start: row.date_start || '',
      date_end: row.date_end || '',
      time_start: row.time_start || '',
      time_end: row.time_end || '',
      price_per_slot: Number(row.price_per_slot) || 0,
      available_slots: Number(row.available_slots) || 0,
      total_slots: Number(row.total_slots) || 0,
      image: _toDirectImgUrl(row.image || ''),
      description: row.description || '',
      category: row.category || row.venue_type || '',
      status: row.status || 'published',
      is_featured: !!row.is_featured,
    });
  } catch (err) {
    console.error('❌ خطأ في تحميل بازار الصفحة الرئيسية:', err.message);
    _renderHomeBazaarEmpty('تعذّر تحميل البازارات حاليًا — حاول تحديث الصفحة.');
  }
}

function renderFeaturedBazaarCard(featured) {
  const container = document.getElementById('bz-home-scroll');
  if (!container) return;

  // حالة العرض تُشتق من بيانات البازار نفسه فقط — لا تخمين، ولا حاجة لرقم "أولوية" منفصل:
  // is_featured=true → مميّز (بغض النظر عن الأولوية التي أوصلته)، status='live' → جارٍ الآن، غير ذلك → قادم (عداد تنازلي)
  const isLive     = featured.status === 'live';
  const availSlots = typeof featured.available_slots === 'number' ? featured.available_slots : (featured.total_slots || 0);
  const isSoldOut  = availSlots === 0 && (featured.total_slots || 0) > 0;

  const countdownHtml = (!isLive && featured.date_start) ? (() => {
    const tStart = featured.time_start ? featured.time_start.substring(0, 5) : '10:00';
    const endDay  = featured.date_end || featured.date_start;
    const tEnd    = featured.time_end ? featured.time_end.substring(0, 5) : '23:59';
    return `
      <div class="bz-countdown" id="bz-countdown-timer" data-start="${featured.date_start}T${tStart}" data-end="${endDay}T${tEnd}">
        <div class="bz-countdown-label" id="bz-countdown-label">انطلاق</div>
        <div class="bz-countdown-units" id="bz-countdown-units">
          <div class="bz-countdown-unit"><span class="bz-countdown-val" id="bz-days">00</span><span class="bz-countdown-lbl">أيام</span></div>
          <div class="bz-countdown-unit"><span class="bz-countdown-val" id="bz-hours">00</span><span class="bz-countdown-lbl">ساعات</span></div>
          <div class="bz-countdown-unit"><span class="bz-countdown-val" id="bz-minutes">00</span><span class="bz-countdown-lbl">دقائق</span></div>
          <div class="bz-countdown-unit"><span class="bz-countdown-val" id="bz-seconds">00</span><span class="bz-countdown-lbl">ثواني</span></div>
        </div>
      </div>`;
  })() : '';

  container.innerHTML = `
    <div class="bz-home-split-grid bz-home-single">
      <div class="bz-featured-wrapper" style="width:100%">
        <div class="bz-featured-card" onclick="window.location.href='bazaars/?bazaar=${featured.id}'">
          <div class="bz-featured-img-container">
            ${featured.image
              ? `<img src="${featured.image}" alt="${_escBz(featured.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\\'bz-mini-placeholder\\\'>🎪</div>'">`
              : `<div class="bz-mini-placeholder">🎪</div>`}

            <div class="bz-featured-badges">
              <span class="bz-featured-cat">${_escBz(featured.category || 'بازار قريب')}</span>
              <div style="display:flex;gap:6px;align-items:center">
                ${featured.is_featured ? '<span class="bz-featured-star-badge">⭐ فعالية مميزة</span>' : ''}
                ${isLive ? '<span class="bz-featured-live-badge">🔴 جارٍ الآن</span>' : ''}
                <span class="${isSoldOut ? 'bz-featured-soldout' : 'bz-featured-available'}">
                  ${isSoldOut ? 'مكتمل' : availSlots + ' مكان متاح'}
                </span>
              </div>
            </div>

            ${countdownHtml}
          </div>

          <div class="bz-featured-body">
            <h3 class="bz-featured-title">${_escBz(featured.name)}</h3>
            <div class="bz-featured-location">📍 ${_escBz(featured.location || featured.region || 'سيتم تحديد المكان قريباً')}</div>
            ${featured.description ? `<p class="bz-featured-desc">${_escBz(featured.description)}</p>` : '<p class="bz-featured-desc">لا يوجد وصف للبازار حالياً. انضم إلينا في هذه الفعالية المميزة واستكشف الأجنحة المتاحة.</p>'}

            <div class="bz-featured-footer">
              <div class="bz-featured-price">
                ${Number(featured.price_per_slot || 0).toLocaleString('ar-EG')} <span>ج / مكان</span>
              </div>
              <button class="bz-featured-btn">${isLive ? 'احجز الآن — جارٍ حاليًا' : 'احجز مكانك الآن'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  if (!isLive) initBazaarCountdown();
}

let _bzCountdownInterval = null;
function initBazaarCountdown() {
  if (_bzCountdownInterval) clearInterval(_bzCountdownInterval);

  const timerEl = document.getElementById('bz-countdown-timer');
  if (!timerEl) return;

  // قراءة وقت البداية والنهاية من الـ data attributes
  const startStr = timerEl.dataset.start;
  const endStr   = timerEl.dataset.end;
  if (!startStr) return;

  const startDate = new Date(startStr);
  const endDate   = endStr ? new Date(endStr) : null;

  const pad = n => String(n).padStart(2, '0');

  function updateTimer() {
    const now = new Date();

    // ━━ الحالة 1: البازار انتهى ━━
    if (endDate && now > endDate) {
      clearInterval(_bzCountdownInterval);
      timerEl.innerHTML = `<span style="font-size:13px;font-weight:700;color:#9ca3af;font-family:var(--font-display)">🏁 انتهى البازار</span>`;
      return;
    }

    // ━━ الحالة 2: البازار جارٍ الآن ━━
    if (now >= startDate) {
      clearInterval(_bzCountdownInterval);
      timerEl.innerHTML = `<span style="font-size:14px;font-weight:900;color:var(--orange);font-family:var(--font-display);animation:pulse 1.2s infinite">🔥 جارٍ الآن!</span>`;
      return;
    }

    // ━━ الحالة 3: لم يبدأ بعد — عداد تنازلي ━━
    const diff    = startDate - now;
    const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    const d = document.getElementById('bz-days');
    const h = document.getElementById('bz-hours');
    const m = document.getElementById('bz-minutes');
    const s = document.getElementById('bz-seconds');
    if (d) d.textContent = pad(days);
    if (h) h.textContent = pad(hours);
    if (m) m.textContent = pad(minutes);
    if (s) s.textContent = pad(seconds);

    // تغيير النص "انطلاق" أو "ينتهي بعد" حسب الحالة
    const lbl = document.getElementById('bz-countdown-label');
    if (lbl) lbl.textContent = days === 0 ? 'ينطلق خلال' : 'انطلاق';
  }

  updateTimer();
  _bzCountdownInterval = setInterval(updateTimer, 1000);
}

async function loadMarketShowcase() {
  const container = document.getElementById('market-home-showcase');
  if (!container) return;

  if (!sbClient) {
    container.innerHTML = `<div class="bz-home-empty">تعذر الاتصال بقاعدة البيانات لتحميل المشاريع.</div>`;
    return;
  }

  try {
    const { data: listings, error } = await sbClient
      .from('listings')
      .select('id, title, description, category, price, cover_image, region, expires_at, status')
      .eq('status', 'approved')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(3);

    if (error) throw error;

    if (!listings || listings.length === 0) {
      container.innerHTML = `
        <div class="bz-home-empty" style="grid-column: 1/-1; text-align: center; padding: 40px 20px;">
          <div style="font-size: 40px; margin-bottom: 12px;">🛍️</div>
          <div style="font-weight: 700; color: var(--ink2); font-size: 14px;">لا توجد مشاريع معروضة للبيع حالياً</div>
          <div style="font-size: 12px; color: var(--ink3); margin-top: 4px;">تابعنا للاطلاع على الفرص الجديدة قريباً!</div>
        </div>`;
      return;
    }

    function getMarketCategoryLabel(catId) {
      const categories = [
        { id: 'food-juice-cart', label: 'عربية أكل / عصير' },
        { id: 'fast-food-partition', label: 'بارتشن وجبات سريعة' },
        { id: 'beauty-partition', label: 'بارتشن عناية شخصية' },
        { id: 'clothing-partition', label: 'بارتشن ملابس / بوتيك' },
        { id: 'handmade', label: 'هاند ميد' },
        { id: 'phones', label: 'تليفونات وإكسسوار' },
        { id: 'gifts', label: 'هدايا وديكور' },
        { id: 'corner-space', label: 'كورنر سبيس' },
        { id: 'vending', label: 'آلات بيع ذاتي' },
        { id: 'other', label: 'أخرى' },
      ];
      const match = categories.find(c => c.id === catId);
      return match ? match.label : 'نشاط تجاري';
    }

    container.innerHTML = listings.map(l => {
      const categoryLabel = getMarketCategoryLabel(l.category);
      const imgUrl = _toDirectImgUrl(l.cover_image || '');
      const priceText = l.price ? `${Number(l.price).toLocaleString('ar-EG')} ج` : 'السعر عند التواصل';

      return `
        <div class="market-showcase-card" onclick="window.location.href='/market/?listing=${l.id}'">
          <div class="market-showcase-img-wrap">
            ${imgUrl
          ? `<img src="${imgUrl}" alt="${l.title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\\'bz-mini-placeholder\\\' style=\\\'font-size:38px\\\' >📦</div>'">`
          : `<div class="bz-mini-placeholder" style="font-size:38px">📦</div>`}
            <span class="market-showcase-cat-badge">${categoryLabel}</span>
          </div>
          <div class="market-showcase-body">
            <h3 class="market-showcase-title">${l.title || 'مشروع للبيع'}</h3>
            <p class="market-showcase-desc">${l.description || 'لا يوجد وصف متاح للمشروع حالياً.'}</p>
            <div class="market-showcase-meta">
              <span>📍 ${l.region || 'مصر'}</span>
              <span class="market-showcase-price">${priceText}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('❌ خطأ في تحميل مشاريع الماركت:', err.message);
    container.innerHTML = `<div class="bz-home-empty">تعذر تحميل المشروعات للبيع حالياً — يرجى المحاولة لاحقاً.</div>`;
  }
}

function shareCard(type, id, name) {
  const base = window.location.origin + window.location.pathname;
  let url, shareText;

  if (type === 'space') {
    url = base + '?space=' + id;
    shareText = 'شوف المساحة دي على مكاني Spot: ' + name;
  } else if (type === 'unit') {
    const parts = String(id).split(':');
    url = base + '?space=' + parts[0] + '&unit=' + encodeURIComponent(parts[1] || '');
    shareText = 'شوف الوحدة دي على مكاني Spot: ' + name;
  } else {
    url = base + '?bazaar=' + id;
    shareText = 'شوف البازار ده على مكاني Spot: ' + name;
  }

  if (navigator.share) {
    navigator.share({ title: 'مكاني Spot', text: shareText, url }).catch(() => { });
  } else {
    navigator.clipboard.writeText(url)
      .then(() => _showShareToast('✅ تم نسخ الرابط!'))
      .catch(() => _showShareToast('📋 الرابط: ' + url));
  }
}

/** يعرض toast صغيرة تأكيداً للمشاركة */
function _showShareToast(msg) {
  let t = document.getElementById('_share-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_share-toast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '90px', left: '50%',
      transform: 'translateX(-50%)',
      background: '#1a1a1a', color: '#fff',
      padding: '10px 24px', borderRadius: '30px',
      fontSize: '13px', fontFamily: "'Cairo',sans-serif",
      zIndex: '9999', opacity: '0',
      transition: 'opacity 0.25s', pointerEvents: 'none',
      whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.22)'
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

/* ══════════════════════════════════════════
   🏢  OWNER REQUEST — طلب تحويل الحساب
   ══════════════════════════════════════════ */
function handleOwnerUpgradeBtn() {
  if (!currentUser) { showPage('signup'); return; }
  openOwnerRequestModal();
}

function openOwnerRequestModal() {
  const phoneEl = document.getElementById('oreq-phone');
  if (phoneEl) phoneEl.value = currentProfile?.phone || '';
  ['oreq-place-name', 'oreq-notes'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const typeEl = document.getElementById('oreq-place-type');
  if (typeEl) typeEl.value = '';
  const planEl = document.getElementById('oreq-selected-plan');
  if (planEl) planEl.value = '';
  const msgEl = document.getElementById('oreq-msg');
  if (msgEl) msgEl.style.display = 'none';
  const btn = document.getElementById('oreq-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'إرسال الطلب ←'; }
  const formWrap = document.getElementById('owner-req-form-wrap');
  const success = document.getElementById('oreq-success');
  if (formWrap) formWrap.style.display = 'block';
  if (success) success.style.display = 'none';
  document.getElementById('owner-request-modal')?.classList.add('open');
}

function closeOwnerRequestModal() {
  document.getElementById('owner-request-modal')?.classList.remove('open');
}

function closeOwnerRequestModalOnBg(e) {
  if (e.target === document.getElementById('owner-request-modal')) closeOwnerRequestModal();
}

async function submitOwnerRequest() {
  const placeName = document.getElementById('oreq-place-name')?.value.trim() || '';
  const placeType = document.getElementById('oreq-place-type')?.value || '';
  const phone = document.getElementById('oreq-phone')?.value.trim() || '';
  const notes = document.getElementById('oreq-notes')?.value.trim() || '';
  const selectedPlan = document.getElementById('oreq-selected-plan')?.value || '';
  const msgEl = document.getElementById('oreq-msg');
  const btn = document.getElementById('oreq-btn');

  const showMsg = (text, isErr) => {
    if (!msgEl) return;
    msgEl.style.cssText = `display:block;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;margin-bottom:12px;background:${isErr ? 'rgba(239,68,68,.1)' : 'rgba(34,197,94,.1)'};color:${isErr ? 'var(--red,#ef4444)' : 'var(--green,#22c55e)'};border:1px solid ${isErr ? 'rgba(239,68,68,.3)' : 'rgba(34,197,94,.3)'}`;
    msgEl.textContent = text;
  };

  if (!phone) {
    showMsg('⚠ رقم الواتساب مطلوب', true); return;
  }
  if (!sbClient || !currentUser) {
    showMsg('⚠ خطأ في الاتصال — أعد تحميل الصفحة', true); return;
  }

  btn.disabled = true; btn.textContent = '⏳ جاري الإرسال…';
  if (msgEl) msgEl.style.display = 'none';

  try {
    const { error } = await sbClient.from('upgrade_requests').insert({
      user_id: currentUser.id,
      user_email: currentUser.email,
      user_name: currentProfile?.full_name || currentUser.email,
      place_name: placeName || null,
      place_type: placeType || null,
      phone,
      notes: notes || null,
      selected_plan: selectedPlan || null,
      status: 'pending',
    });
    if (error) throw error;
    document.getElementById('owner-req-form-wrap').style.display = 'none';
    document.getElementById('oreq-success').style.display = 'block';
  } catch (err) {
    showMsg('❌ حدث خطأ: ' + (err.message || 'حاول مرة أخرى'), true);
    btn.disabled = false; btn.textContent = 'إرسال الطلب ←';
  }
}
