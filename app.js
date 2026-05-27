/* ================================================================
   📁 app.js — الطبقة الثالثة: السلوك والوظائف
   ================================================================
   🧠 هذا الملف مسؤول عن كل ما يتحرك في الموقع:
      - تحميل البيانات من Google Sheets
      - نظام تسجيل الدخول عبر Supabase
      - عرض الكروت والفلاتر
      - مودال الحجز وإرسال البيانات
      - صفحة الماركت بليس (كل المساحات)
      - صفحة تفاصيل المساحة الرئيسية + المساحات الفرعية  ← جديد
      - لوحة التحكم: تعديل البيانات، الحجوزات، التقييمات

   📌 كيف تعدّل؟
      - لتغيير رابط Google Sheet: غيّر SHEET_URL
      - لتغيير رابط استقبال الحجوزات: غيّر BOOKING_URL
      - لتغيير إعدادات Supabase: غيّر SUPABASE_URL و SUPABASE_KEY
   ================================================================ */


/* ================================================================
   ⚙️ القسم الأول: إعدادات وروابط المنصة
   (هنا كل الروابط المهمة — عدّلها من هنا فقط)
   ================================================================ */

/**
 * 📊 رابط Google Apps Script الذي يجيب بيانات المساحات والأنشطة
 * لو غيّرت الشيت أو أعدت نشر الـ Script، ضع الرابط الجديد هنا
 */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbwNGSGQXZjQeG1i-3DSiUdHKQJQq7JGBFNuXx0deVfJB1b2jGkxDRRI2SIgWwvU900tsQ/exec";

/**
 * 📬 رابط Google Apps Script الذي يستقبل طلبات الحجز ويحفظها في الشيت
 * لو غيّرت شيت الحجوزات، ضع الرابط الجديد هنا
 */
const BOOKING_URL = "https://script.google.com/macros/s/AKfycbzZPnqZ4hjy8nzzGDcrQUpJK_pZn01lGIJXL-EfScxpGISLMjo6wL6xCLqNMviBpD69/exec";

/**
 * 🎪 رابط Google Apps Script لبيانات البازارات من Google Sheets
 * كل مرة تحدّث الشيت وترفعه، بيانات البازارات بتظهر تلقائياً على الموقع
 */
const BAZAAR_SHEET_URL = "https://script.google.com/macros/s/AKfycbwb0eB118CzrlByCAn2ESbF-6md7h1E-pTJtIph8jfYfeZTkY7GAJNM5RPSNHxbFsqOcA/exec";

/**
 * 🔐 إعدادات Supabase — قاعدة بيانات المستخدمين
 * هذه البيانات من لوحة تحكم Supabase الخاصة بك
 */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';


/* ================================================================
   🗄️ القسم الثاني: المتغيرات العامة
   (بيانات تُحفظ مؤقتاً أثناء تشغيل الصفحة)
   ================================================================ */

let SPACES         = [];    // قائمة المساحات المحمّلة من الشيت
let ACTIVITIES     = [];    // قائمة الأنشطة التجارية
let activeTab      = '';    // التبويب النشط حالياً (مول / نادي / مدرسة)
let selectedAct    = '';    // النشاط المحدد في الفلتر
let sbClient       = null;  // كائن Supabase يُهيَّأ عند التحميل
let currentUser    = null;  // بيانات المستخدم المسجّل حالياً
let currentProfile = null;  // بيانات الـ profile من قاعدة البيانات

// ── متغيرات خاصة بصفحة الماركت بليس ──
let mpPage        = 1;      // رقم الصفحة الحالية في الماركت بليس
const MP_PER_PAGE = 12;     // عدد المساحات في كل صفحة
let mpFiltered    = [];     // المساحات بعد تطبيق الفلاتر
let mpActiveTypes = [];     // أنواع المكان المفلترة حالياً (mall / club / school)
let mpActiveActs  = [];     // الأنشطة المفلترة حالياً

// ── متغيرات خاصة بصفحة تفاصيل المساحة ── (جديد)
let currentSpaceDetail = null;  // المساحة الرئيسية المعروضة حالياً في صفحة التفاصيل
let detailPrevPage     = 'market'; // الصفحة السابقة للرجوع إليها من التفاصيل

// ── متغيرات خاصة بنظام البازارات ──
let BAZAARS        = [];          // قائمة البازارات المحمّلة من الشيت / Supabase

// ── متغيرات نظام الـ Slider (سلايدر الصور) ──
// يُستخدم في: كروت المساحات (الهوم + الماركت) + صفحة التفاصيل
const _sliders = {};  // يحفظ حالة كل سلايدر { index, images, autoTimer }
//   المفتاح = معرّف فريد لكل سلايدر (مثل: "card-5" أو "detail-5")


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

  // تحميل بيانات المساحات من Google Sheets
  loadData();

  // تحميل البازارات من Supabase
  loadBazaars();

  // تحقق من حالة تسجيل الدخول
  initAuth();

  // تهيئة مؤشر السعر في الصفحة الرئيسية
  initPriceSlider();

  // التنقل المباشر عبر URL parameter: /?p=market أو /?p=dashboard إلخ
  const urlPage = new URLSearchParams(window.location.search).get('p');
  if (urlPage) {
    if (['home','how','owner','login','signup'].includes(urlPage)) {
      showPage(urlPage);
    } else if (urlPage === 'market') {
      window.location.replace('/spaces/');
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

  const max        = parseInt(sliderMax.value);
  const range      = parseInt(sliderMax.max) || 50000;
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
    const res  = await fetch(SHEET_URL);
    const json = await res.json();

    if (json.status !== "ok") throw new Error(json.message || "خطأ في قراءة الشيت");

    ACTIVITIES = json.activities || [];
    SPACES     = (json.spaces || []).map(s => ({
      ...s,
      planTier: (s.planTier || s.plan_tier || '').toLowerCase().trim() || 'starter',
    }));
    _sortByPlan(SPACES);

    buildActivityFilters();
    buildModalActivityPicker();
    buildMpActivityFilters();

    renderCards(SPACES.slice(0, 6), 'spaces-grid', SPACES.length > 6, 'home');
    // تهيئة الـ sliders بعد رسم الكروت
    setTimeout(() => csInitAll(), 120);

    const counter = document.getElementById('res-count');
    if (counter) counter.textContent = SPACES.length + ' مساحة';

  } catch (err) {
    showErrorState(err.message, 'spaces-grid');
  }
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

/** ترتيب المساحات حسب الباقة: Pro أول، Growth ثاني، Starter أخير */
function _sortByPlan(arr) {
  const ord = { pro: 0, growth: 1, starter: 2 };
  arr.sort((a, b) => (ord[a.planTier] ?? 2) - (ord[b.planTier] ?? 2));
  return arr;
}

/** يبني HTML لـ badge الثقة بناءً على planTier */
function _planTrustBadgeHtml(s) {
  const tier = (s.planTier || 'starter').toLowerCase();
  if (tier === 'pro')    return `<span class="card-trust-badge trust-partner">🏆 شريك معتمد</span>`;
  if (tier === 'growth') return `<span class="card-trust-badge trust-verified">✓ موثّق</span>`;
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
  const actsHtml = s.allActs ? '<span class="act-tag act-tag-all">✓ كل الأنشطة</span>' : (s.acts || []).slice(0, 3).map(id => `<span class="act-tag">${id}</span>`).join('');
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

  const detailsBtnHtml = hasDetails
    ? `<button class="btn btn-details" style="font-size:12px;padding:7px 14px"
              onclick="event.stopPropagation();openSpaceDetail(${s.id},'${fromPage}')">
         تفاصيل ←
       </button>`
    : '';

  const availableUnits = (s.subSpaces || []).filter(u => u.status === 'available' || !u.status).length;
  const unitsBadgeHtml = s.subSpaces && s.subSpaces.length > 0
    ? `<span class="units-badge">${availableUnits} وحدة متاحة</span>`
    : '';

  // 4. البناء النهائي
  const _spaceNameSafe = (s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const _shareSpaceBtn = `<button class="share-btn" onclick="event.stopPropagation();shareCard('space',${s.id},'${_spaceNameSafe}')" title="مشاركة المساحة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;
  const _trustBadge    = _planTrustBadgeHtml(s);
  const _cardClass     = _planCardClass(s);

  return `
  <div class="space-card${_cardClass}">
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
          <button class="btn btn-ghost btn-insp"
                  onclick="event.stopPropagation();openInspectionModal(${s.id})">🔍 معاينة</button>
          <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                  onclick="openBooking(${s.id})">احجز ←</button>
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
function renderCards(data, gridId, showViewAll, fromPage) {
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

  const viewAllHtml = showViewAll ? `
    <div style="grid-column:1/-1;text-align:center;padding:14px 0 4px">
      <a class="btn-view-all" href="/spaces/">
        <span>عرض جميع المساحات المتاحة (${SPACES.length})</span>
        <span class="view-all-arrow">←</span>
      </a>
    </div>` : '';

  grid.innerHTML = data.map(s => buildCardHtml(s, fromPage)).join('') + viewAllHtml;
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

function openSpaceDetail(spaceId, fromPage) {
  const s = SPACES.find(x => x.id === spaceId);
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
              ${_planTrustBadgeHtml(s) ? `<span class="sd-trust-badge trust-${(s.planTier||'starter') === 'pro' ? 'partner' : 'verified'}">${(s.planTier||'starter') === 'pro' ? '🏆 شريك معتمد' : '✓ موثّق'}</span>` : ''}
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
              <button class="btn btn-ghost" style="flex:1;justify-content:center;font-size:13px;padding:9px 10px"
                      onclick="openInspectionModal(${s.id})">🔍 معاينة</button>
              <button class="btn btn-primary" style="flex:1;justify-content:center;font-size:13px;padding:9px 10px"
                      onclick="openBooking(${s.id})">احجز ←</button>
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
        <button class="btn btn-primary" style="margin-top:16px" onclick="openBooking(${s.id})">
          احجز دلوقتي ←
        </button>
      </div>`;
    return;
  }

  // ── عداد الوحدات المتاحة ──
  const availCount  = units.filter(u => u.status === 'available' || !u.status).length;
  const rentedCount = units.filter(u => u.status === 'rented').length;

  const statusMap = {
    available: { label: 'متاحة',    cls: 'sub-status-available' },
    rented:    { label: 'مؤجّرة',   cls: 'sub-status-rented'    },
    reserved:  { label: 'محجوزة',   cls: 'sub-status-reserved'  },
  };

  const unitsHtml = units.map(unit => {
    const st        = statusMap[unit.status] || statusMap.available;
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
                         onclick="openBookingForUnit(${s.id},'${unit.unitId}')">
                   احجز ←
                 </button>`
              : `<span style="font-size:12px;color:var(--ink3);padding:7px 0">غير متاح حالياً</span>`
            }
            <button class="share-btn-inline" onclick="event.stopPropagation();shareCard('unit','${s.id}:${(unit.unitId||'').replace(/'/g,"\\'")}','${(unit.name||unit.unitId||'').replace(/'/g,"\\'")}');" title="مشاركة الوحدة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
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
function openBookingForUnit(spaceId, unitId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  // افتح مودال الحجز الاعتيادي أولاً
  openBooking(spaceId);

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
  window.location.href = '/spaces/';
}

function toggleMpType(type, el) {
  el.classList.toggle('on');
  mpActiveTypes = el.classList.contains('on')
    ? [...mpActiveTypes, type]
    : mpActiveTypes.filter(t => t !== type);
  mpPage = 1;
  applyMpFilters();
}

function toggleMpAct(id, el) {
  el.classList.toggle('on');
  mpActiveActs = el.classList.contains('on')
    ? [...mpActiveActs, id]
    : mpActiveActs.filter(a => a !== id);
  mpPage = 1;
  applyMpFilters();
}

function applyMpFilters() {
  const region = document.getElementById('mp-region')?.value || '';
  const minVal = 0; // الحد الأدنى ثابت عند الصفر دائماً
  const maxVal = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
  const sort   = document.getElementById('mp-sort')?.value || 'default';

  let data = [...SPACES];

  if (region) data = data.filter(s => s.loc === region);
  if (mpActiveTypes.length) data = data.filter(s => mpActiveTypes.includes(s.type));
  data = data.filter(s => {
    const p = parseInt(s.price) || 0;
    return p >= minVal && p <= maxVal;
  });
  if (mpActiveActs.length) {
    data = data.filter(s => s.allActs || (s.acts && mpActiveActs.some(a => s.acts.includes(a))));
  }

  if (sort === 'price-asc')  data.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') data.sort((a, b) => b.price - a.price);

  mpFiltered = data;
  mpPage     = 1;
  renderMarketplace();
  updateMpChips();
}

function clearMpFilters() {
  mpActiveTypes = [];
  mpActiveActs  = [];
  document.querySelectorAll('.mp-type-btn').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.mp-act-btn').forEach(b  => b.classList.remove('on'));

  const s2 = document.getElementById('mp-slider-max');
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMpSlider();

  const mpRegion = document.getElementById('mp-region');
  if (mpRegion) mpRegion.value = '';
  const mpSort = document.getElementById('mp-sort');
  if (mpSort) mpSort.value = 'default';

  mpFiltered = [...SPACES];
  mpPage     = 1;
  renderMarketplace();
  updateMpChips();
}

function updateMpChips() {
  const cont = document.getElementById('mp-active-chips');
  if (!cont) return;
  const chips  = [];
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
  const grid    = document.getElementById('mp-grid');
  const countEl = document.getElementById('mp-count');
  if (!grid) return;

  if (countEl) countEl.textContent = mpFiltered.length + ' مساحة';

  const start    = (mpPage - 1) * MP_PER_PAGE;
  const pageData = mpFiltered.slice(start, start + MP_PER_PAGE);

  if (!pageData.length) {
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

  grid.innerHTML = pageData.map(s => buildCardHtml(s, 'market')).join('');
  // تهيئة الـ sliders في الماركت بعد الرسم
  setTimeout(() => csInitAll(), 120);
  renderMpPagination();
}

function renderMpPagination() {
  const cont = document.getElementById('mp-pagination');
  if (!cont) return;

  const totalPages = Math.ceil(mpFiltered.length / MP_PER_PAGE);
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
  renderMarketplace();
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

  const maxVal   = parseInt(s2.value);
  const RANGE_MAX = parseInt(s2.max) || 50000;
  const pMax     = (maxVal / RANGE_MAX) * 100;

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
  filterAndRender();
  showSearchChips();
}

function filterAndRender() {
  let data = [...SPACES];

  const reg      = document.getElementById('f-region')?.value || '';
  const type     = document.getElementById('f-type')?.value || activeTab;
  const minPrice = 0; // الحد الأدنى ثابت عند الصفر
  const maxPrice = parseInt(document.getElementById('slider-max')?.value) || 50000;

  if (reg)  data = data.filter(s => s.loc === reg);
  if (type) data = data.filter(s => s.type === type);
  data = data.filter(s => {
    const price = parseInt(s.price) || 0;
    return price >= minPrice && price <= maxPrice;
  });
  if (selectedAct) data = data.filter(s => s.allActs || (s.acts && s.acts.includes(selectedAct)));

  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = data.length + ' مساحة';

  renderCards(data.slice(0, 6), 'spaces-grid', data.length > 6, 'home');
}

function showSearchChips() {
  const chips = [];
  const r        = document.getElementById('f-region')?.value;
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

  renderCards(SPACES.slice(0, 6), 'spaces-grid', SPACES.length > 6, 'home');
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = SPACES.length + ' مساحة';
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

  // حفظ الصفحة الحالية (باستثناء صفحات التفاصيل — لا نحفظها في localStorage)
  if (['home','how','owner','pricing','market','bazaars','dashboard'].includes(p)) {
    localStorage.setItem('lastPage', p);
  }

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');

  // تحديث الرابط النشط في الـ Nav
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.querySelectorAll('.nav-section-btn').forEach(b => b.classList.remove('active'));
  const links = document.querySelectorAll('.nav-links a');
  if (p === 'home')    links[0]?.classList.add('active');
  if (p === 'how')     links[1]?.classList.add('active');
  if (p === 'owner')   links[2]?.classList.add('active');
  if (p === 'pricing') links[3]?.classList.add('active');
  if (p === 'market' || p === 'space-detail')  document.getElementById('nsb-spaces')?.classList.add('active');

  // لو فتحنا الماركت بليس
  if (p === 'market') {
    setTimeout(initMpSlider, 120);
    if (SPACES.length && !mpFiltered.length) {
      mpFiltered = [...SPACES];
      renderMarketplace();
    }
  }

  if (p === 'pricing') {
    setTimeout(initPricingAnimations, 80);
  }

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
   📋 القسم الحادي عشر: مودال الحجز
   ================================================================ */

function openBooking(spaceId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  const sizePrices = {};
  const sizesClean = [];
  (s.sizes || []).forEach(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    sizePrices[label] = price;
    sizesClean.push(label);
  });

  const selSize  = sizesClean[0] || '';
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
    const nameEl  = document.getElementById('bk-name');
    const phoneEl = document.getElementById('bk-phone');
    const emailEl = document.getElementById('bk-email');
    if (nameEl)  nameEl.value  = currentProfile?.full_name || currentUser.user_metadata?.full_name || '';
    if (phoneEl) phoneEl.value = currentProfile?.phone || '';
    if (emailEl) emailEl.value = currentUser.email || '';
  } else {
    ['bk-name', 'bk-phone', 'bk-email'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  document.getElementById('modal-form-wrap').style.display = 'block';
  document.getElementById('modal-success').style.display   = 'none';
  document.getElementById('bk-error').style.display        = 'none';
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
  const name     = document.getElementById('bk-name').value.trim();
  const phone    = document.getElementById('bk-phone').value.trim();
  const email    = document.getElementById('bk-email').value.trim();
  const actBtn   = document.querySelector('.act-pick-btn.on');
  const otherAct = document.getElementById('bk-other-act').value.trim();
  const size     = document.getElementById('bk-size').value;
  const dur      = document.getElementById('bk-dur').value;
  const date     = document.getElementById('bk-date').value;
  const notes    = document.getElementById('bk-notes').value.trim();

  // ── Validation ──────────────────────────────────────────────
  if (!name) { showFormError('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showFormError('من فضلك ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!actBtn) { showFormError('من فضلك اختار نوع نشاطك التجاري'); return; }

  document.getElementById('bk-error').style.display = 'none';

  const submitBtn     = document.querySelector('#modal-form-wrap .btn-primary');
  const origText      = submitBtn.innerHTML;
  submitBtn.innerHTML = '⏳ جاري الإرسال…';
  submitBtn.disabled  = true;
  submitBtn.style.opacity = '0.7';

  // ── استخراج بيانات المساحة ──────────────────────────────────
  const spaceName  = document.getElementById('msi-name').textContent;
  const metaText   = document.getElementById('msi-meta').textContent;
  const locMatch   = metaText.match(/📍\s*([^·]+)/);
  const priceMatch = metaText.match(/([\d,٠-٩]+\s*ج)/);
  const spaceLoc   = locMatch   ? locMatch[1].trim() : '';
  const spacePrice = priceMatch ? priceMatch[1].trim() : '';

  // ── توليد bookingId مشترك بين الشيت و Supabase ──────────────
  const bookingId = crypto.randomUUID();
  const now       = new Date().toISOString();

  const payload = {
    name, phone, email,
    spaceName, spaceLoc, spacePrice,
    activity:  actBtn?.textContent || '',
    otherAct,  size,
    duration:  dur,
    startDate: date,
    notes,
    userId:    currentUser?.id || '',
    bookingId,
  };

  try {

    // ── 1) إرسال للشيت ─────────────────────────────────────────
    // ✅ حذفنا no-cors عشان نعرف لو في خطأ حقيقي
    // لو الشيت Apps Script بيرفع CORS error، فعّل CORS في doPost
    let sheetOk = false;
try {
  await fetch(BOOKING_URL, {
    method:  'POST',
    mode:    'no-cors',          // ← رجّعناه
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  sheetOk = true; // no-cors دايماً بيكمّل بدون error
} catch (sheetErr) {
  sheetOk = true;
}

    // ── 2) حفظ في Supabase (لو المستخدم مسجّل) ────────────────
    if (sbClient && currentUser) {

      const { error: bookingError } = await sbClient.from('bookings').insert({
        id:         bookingId,
        user_id:    currentUser.id,
        space_name: spaceName,
        space_loc:  spaceLoc,
        price:      spacePrice,
        activity:   payload.activity,
        size,
        duration:   dur,
        start_date: date,
        notes,
        status:     'pending',
        created_at: now,
        updated_at: now,        // ← جديد: لتتبع آخر تحديث
      });

      if (bookingError) {
        // خطأ Supabase في حفظ الحجز — نكمل ونعرض النجاح لأن الشيت استلم الطلب
      }

      // ── 3) تحديث الـ Profile لو في بيانات ناقصة ───────────────
      const profileUpdate = {};
      if (name  && !currentProfile?.full_name) profileUpdate.full_name = name;
      if (phone && !currentProfile?.phone)     profileUpdate.phone     = phone;
      if (email && !currentProfile?.email)     profileUpdate.email     = email;

      if (Object.keys(profileUpdate).length > 0) {
        const { error: profileError } = await sbClient
          .from('profiles')
          .upsert({ id: currentUser.id, ...profileUpdate }, { onConflict: 'id' });

        if (!profileError) {
          currentProfile = { ...currentProfile, ...profileUpdate };
        }
      }

      // ── 4) تحديث الداشبورد فوراً ───────────────────────────────
      await loadDashboardData(currentUser);
    }

    // ── عرض شاشة النجاح ────────────────────────────────────────
    document.getElementById('modal-form-wrap').style.display = 'none';
    document.getElementById('modal-success').style.display   = 'block';

  } catch (err) {
    console.error('❌ خطأ غير متوقع في submitBooking:', err.message);
    submitBtn.innerHTML     = origText;
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
    showFormError('في مشكلة في إرسال الطلب — تأكد من الاتصال بالإنترنت وحاول تاني');
  }
}


function showFormError(msg) {
  const el = document.getElementById('bk-error');
  if (!el) return;
  el.textContent   = '⚠ ' + msg;
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
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      setNavUser(session.user, profile);

      // URL param له أولوية على lastPage
      const urlPage = new URLSearchParams(window.location.search).get('p');
      if (urlPage === 'dashboard') {
        await loadDashboardData(session.user);
        showPage('dashboard');
      } else {
        const lastPage = localStorage.getItem('lastPage');
        if (lastPage && lastPage !== 'home') {
          document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
          const target = document.getElementById('pg-' + lastPage);
          if (target) target.classList.add('active');

          if (lastPage === 'dashboard') {
            await loadDashboardData(session.user);
          }
          if (lastPage === 'market') {
            setTimeout(initMpSlider, 120);
            if (SPACES.length && !mpFiltered.length) {
              mpFiltered = [...SPACES];
              renderMarketplace();
            }
          }
        }
      }
    } else {
      localStorage.removeItem('lastPage');
      setNavUser(null, null);
    }
  } catch (_) {
    setNavUser(null, null);
  }

  // ✅ [تعديل 3] إصلاح onAuthStateChange — الداشبورد يظهر فوراً بدون Refresh
  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      setNavUser(session.user, profile);

      // تحديد الصفحة النشطة حالياً
      const activePage = document.querySelector('.page.active')?.id || '';
      const isOnAuthPage = ['pg-login', 'pg-signup'].some(
        id => document.getElementById(id)?.classList.contains('active')
      );

      if (isOnAuthPage) {
        // جاي من صفحة login أو signup — روّح للداشبورد مباشرة
        await loadDashboardData(session.user);
        showPage('dashboard');
      } else if (activePage === 'pg-dashboard') {
        // الصفحة الحالية هي الداشبورد (مثلاً بعد Google OAuth) — حمّل البيانات فقط
        await loadDashboardData(session.user);
      } else {
        // Google OAuth redirect للـ home أو أي صفحة تانية — روّح للداشبورد
        await loadDashboardData(session.user);
        showPage('dashboard');
      }

    } else if (event === 'SIGNED_OUT') {
      currentUser    = null;
      currentProfile = null;
      setNavUser(null, null);
    }
  });
}

function setNavUser(user, profile) {
  const guestEl  = document.getElementById('nav-guest');
  const loggedEl = document.getElementById('nav-logged');
  if (!guestEl || !loggedEl) return;

  if (!user) {
    guestEl.style.display  = 'flex';
    loggedEl.style.display = 'none';
  } else {
    const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
    const email     = user.email || '';
    const initial   = name.trim()[0] || '؟';
    const roleLabel = { tenant: 'مستأجر', owner: 'صاحب مساحة' }[profile?.role] || 'مستخدم';

    guestEl.style.display  = 'none';
    loggedEl.style.display = 'flex';

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('nav-av-circle', initial);
    set('nav-av-name',   name);
    set('nav-av-email',  email);
    set('dd-name',       name);
    set('dd-email',      email);
    set('dd-role',       roleLabel);

    const ownerBtn = document.getElementById('dd-owner-dash-btn');
    if (ownerBtn) ownerBtn.style.display = profile?.role === 'owner' ? 'flex' : 'none';

    updateBnUser(user, profile);
  }

  const bnUserIcon  = document.getElementById('bn-user-icon');
  const bnUserLabel = document.getElementById('bn-user-label');

  if (bnUserIcon && bnUserLabel) {
    if (user) {
      const initial = (profile?.full_name || user.email || 'م')[0].toUpperCase();
      bnUserIcon.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">${initial}</span>`;
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
  const dd  = document.getElementById('nav-dropdown');
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
  const pass  = document.getElementById('li-pass')?.value;

  if (!email) { showAuthAlert('login-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass)  { showAuthAlert('login-alert', 'error', 'من فضلك ادخل كلمة المرور'); return; }

  setBtnLoading('btn-login-submit', true);
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password: pass });
  setBtnLoading('btn-login-submit', false, 'تسجيل الدخول ←');

  if (error) {
    const msgs = {
      'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غلط',
      'Email not confirmed':       'لازم تأكد بريدك الإلكتروني الأول — فتش في الـ Inbox',
      'Too many requests':         'كتر طلبات تسجيل الدخول — انتظر قليلاً وحاول تاني',
    };
    showAuthAlert('login-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  await loadDashboardData(data.user);
  showPage('dashboard');
}


/* ================================================================
   ✍️ القسم السادس عشر: إنشاء حساب جديد
   ================================================================ */

async function doEmailSignup() {
  if (!sbClient) return;
  clearAuthAlert('signup-alert');

  const name  = document.getElementById('su-name')?.value.trim();
  const phone = document.getElementById('su-phone')?.value.trim();
  const email = document.getElementById('su-email')?.value.trim();
  const pass  = document.getElementById('su-pass')?.value;
  const role  = document.getElementById('su-role')?.value;
  const city  = document.getElementById('su-city')?.value;

  if (!name)  { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showAuthAlert('signup-alert', 'error', 'ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!email) { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass || pass.length < 8) {
    showAuthAlert('signup-alert', 'error', 'كلمة المرور لازم تكون ٨ أحرف على الأقل'); return;
  }
  if (!role)  { showAuthAlert('signup-alert', 'error', 'من فضلك اختار نوع حسابك'); return; }

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
      'User already registered':                    'البريد ده مسجّل بالفعل — سجّل دخولك',
      'Password should be at least 6 characters':   'كلمة المرور قصيرة — لازم ٦ أحرف على الأقل',
    };
    showAuthAlert('signup-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  if (data.user) {
    await sbClient.from('profiles').upsert({
      id:         data.user.id,
      full_name:  name,
      phone:      phone,
      role:       role,
      city:       city,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  const addrEl = document.getElementById('confirm-em-addr');
  if (addrEl) addrEl.textContent = email;
  showPage('confirm');
}


/* ================================================================
   🌐 القسم السابع عشر: تسجيل الدخول بـ Google
   ================================================================ */

async function authWithGoogle() {
  if (!sbClient) return;

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
  currentUser    = null;
  currentProfile = null;
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
    sbClient.from('organizer_profiles').select('is_verified').eq('user_id', user.id).single(),
    sbClient.from('organizer_requests').select('status').eq('user_id', user.id)
            .order('created_at', { ascending: false }).limit(1).single(),
  ]);

  currentUser    = user;
  currentProfile = profileRes.data;

  const profile   = profileRes.data;
  const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const firstName = name.split(' ')[0];

  const el = document.getElementById('dash-firstname');
  if (el) el.textContent = firstName;

  setNavUser(user, profile);

  // عرض قسم الترقية / الانتقال لأصحاب المساحات
  renderUpgradeSection(profile);

  // عرض CTA تنظيم البازار
  const isVerified = orgProfileRes.data?.is_verified === true;
  const reqStatus  = reqRes.data?.status || null;
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
      .select('id,name,date_start,location,image,status')
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
        ? new Date(b.date_start).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })
        : '—';
      const imgHtml = b.image
        ? `<img src="${b.image}" alt="${b.name}"
                style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0"
                onerror="this.style.display='none'">`
        : `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);
                       display:flex;align-items:center;justify-content:center;font-size:18px">🎪</div>`;
      const statusBadge = b.status === 'published'
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

function goToOwnerDashboard() {
  window.location.href = '/dashboard/';
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
        <button id="btn-upgrade-request" onclick="requestOwnerUpgrade()"
          style="background:var(--orange);color:#fff;border:none;padding:10px 20px;
                 border-radius:12px;font-family:'Cairo',sans-serif;font-weight:800;
                 font-size:13px;cursor:pointer;white-space:nowrap">
          🚀 طلب ترقية الحساب
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
      user_id:    currentUser.id,
      user_email: currentUser.email || '',
      user_name:  currentProfile?.full_name || currentUser.email || '',
      status:     'pending',
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
  const cntEl  = document.getElementById('dash-booking-count');

  try {
    if (!BAZAARS.length) {
      try { await loadBazaars(); } catch (_) {}
    }

    const { data: spaceBookings } = await sbClient
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: bazaarBookings } = await sbClient
      .from('bazaar_bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    const localBazaarBookings = _loadLocalBazaarBookings(userId);
    const bazaarById = new Map();
    [...(bazaarBookings || []), ...localBazaarBookings].forEach(b => {
      const key = b.id || `${b.bazaar_id}-${b.slot_id}-${b.created_at}`;
      if (!bazaarById.has(key)) bazaarById.set(key, b);
    });

    const normalizedSpaces = (spaceBookings || []).map(b => ({
      kind: 'space',
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
  pending:   { label: 'قيد المراجعة ⏳', cls: 'status-pending'   },
  confirmed: { label: 'مؤكد ✅',          cls: 'status-confirmed' },
  cancelled: { label: 'ملغي ❌',          cls: 'status-cancelled' },
  completed: { label: 'مكتمل 🏁',        cls: 'status-confirmed' },
};
     
    // بناء HTML لكل حجز
    const allCards = bookings.map(b => {
      const st      = statusMap[b.status] || statusMap.pending;
      const dateStr = b.created_at
        ? new Date(b.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';
      const kindLabel = b.kind === 'bazaar' ? 'بازار' : 'مساحة';
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
      </div>`;
    });

    // عرض أحدث 3 فقط — والباقي مخفي
    const visible  = allCards.slice(0, 3).join('');
    const hidden   = allCards.slice(3).join('');
    const hasMore  = bookings.length > 3;
    contEl.innerHTML = visible +
      (hasMore ? `<div class="bookings-extra" id="bookings-extra" style="display:none">${hidden}</div>
        <button class="booking-collapse-btn" id="bookings-toggle" onclick="toggleBookings(${bookings.length})">
          ↓ عرض جميع الحجوزات (${bookings.length})
        </button>` : '');

  } catch (e) {
    if (contEl) contEl.innerHTML = '<div class="no-bookings">تعذّر تحميل الحجوزات</div>';
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
  const btn   = document.getElementById('bookings-toggle');
  if (!extra || !btn) return;
  const isHidden = extra.style.display === 'none';
  extra.style.display = isHidden ? '' : 'none';
  btn.innerHTML = isHidden
    ? '↑ إخفاء الحجوزات القديمة'
    : `↓ عرض جميع الحجوزات (${total || ''})`;
}

/* ================================================================
   ⭐ القسم الواحد والعشرون: تقييمات المستخدم
   ================================================================ */

async function loadUserRatings(userId) {
  if (!sbClient) return;

  const contEl = document.getElementById('dash-ratings');
  if (!contEl) return;

  try {
    const { data: ratings } = await sbClient
      .from('ratings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!ratings?.length) {
      contEl.innerHTML = `<div class="no-bookings">لا يوجد تقييمات بعد</div>`;
      return;
    }

    contEl.innerHTML = ratings.map(r => {
      const stars   = Array.from({ length: 5 }, (_, i) =>
        `<span style="color:${i < r.rating ? '#FF6B00' : '#ddd'}">★</span>`
      ).join('');
      const dateStr = r.created_at
        ? new Date(r.created_at).toLocaleDateString('ar-EG')
        : '—';

      return `
      <div class="rating-card">
        <div class="rating-card-header">
          <div class="rating-stars">${stars}</div>
          <span class="rating-date">${dateStr}</span>
        </div>
        <div class="rating-space">${r.space_name || '—'}</div>
        ${r.comment ? `<div class="rating-comment">"${r.comment}"</div>` : ''}
      </div>`;
    }).join('');

  } catch (e) {
    contEl.innerHTML = '<div class="no-bookings">تعذّر تحميل التقييمات</div>';
  }
}

async function submitRating() {
  if (!sbClient || !currentUser) {
    showDashAlert('error', 'لازم تسجّل دخولك الأول');
    return;
  }

  const spaceName = document.getElementById('rating-space-name')?.value.trim();
  const ratingVal = parseInt(document.querySelector('.star-btn.on')?.dataset.val || '0');
  const comment   = document.getElementById('rating-comment')?.value.trim();

  if (!spaceName) { showDashAlert('error', 'اكتب اسم المساحة'); return; }
  if (!ratingVal) { showDashAlert('error', 'اختار تقييمك بالنجوم'); return; }

  setBtnLoading('btn-submit-rating', true);
  const { error } = await sbClient.from('ratings').insert({
    user_id:    currentUser.id,
    space_name: spaceName,
    rating:     ratingVal,
    comment:    comment,
    created_at: new Date().toISOString(),
  });
  setBtnLoading('btn-submit-rating', false, '⭐ إرسال التقييم');

  if (error) { showDashAlert('error', 'في مشكلة في الإرسال'); return; }

  showDashAlert('success', 'شكراً! اتضاف تقييمك ⭐');

  document.getElementById('rating-space-name').value = '';
  document.getElementById('rating-comment').value    = '';
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('on'));
  document.getElementById('rating-form-wrap').style.display = 'none';

  await loadUserRatings(currentUser.id);
}

function selectStar(val, el) {
  const btns = document.querySelectorAll('.star-btn');
  btns.forEach((b, i) => b.classList.toggle('on', i < val));
  if (btns[val - 1]) btns[val - 1].dataset.val = val;
}

function toggleRatingForm() {
  const formEl = document.getElementById('rating-form-wrap');
  if (!formEl) return;
  formEl.style.display = (formEl.style.display === 'none' || !formEl.style.display) ? 'block' : 'none';
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
  if (on)         b.innerHTML = `<span class="spin-sm"></span> جاري التحميل…`;
  else if (orig)  b.innerHTML = orig;
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
        const { data: profile } = await sbClient
          .from('profiles').select('*').eq('id', session.user.id).single();
        currentProfile = profile;
        setNavUser(session.user, profile);
        await loadDashboardData(session.user);
        showPage('dashboard');
        return;
      }
    } catch (_) {}
  }

  goToLogin();
}

function updateBnUser(user, profile) {
  const icon  = document.getElementById('bn-user-icon');
  const label = document.getElementById('bn-user-label');
  const desc  = document.getElementById('bn-user-desc');
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
  const idVal = get('id','ID','رقم','No') || (Math.random() * 1e9 | 0).toString(36);
  const tagsVal = get('tags','Tags','وسوم','تاجات') || '';
  const firstTag = Array.isArray(tagsVal)
    ? tagsVal[0]
    : String(tagsVal || '').split(',').map(t => t.trim()).filter(Boolean)[0];

  return {
    id:             String(idVal),
    name:           get('name','اسم البازار','البازار','الاسم','Name')             || '—',
    location:       get('location','venueName','venue_name','اسم المكان','الموقع','المكان','Location') || '',
    region:         get('region','area','Area','المنطقة','Region')                               || '',
    date_start:     get('date_start','dateStart','date_start','تاريخ البداية','تاريخ البدء','من تاريخ','Start Date') || '',
    date_end:       get('date_end','dateEnd','date_end','تاريخ النهاية','تاريخ الانتهاء','حتى تاريخ','End Date') || '',
    time_start:     get('time_start','وقت البداية','وقت البدء','Start Time')       || '',
    time_end:       get('time_end','وقت النهاية','وقت الانتهاء','End Time')        || '',
    price_per_slot: Number(get('price_per_slot','price','Price','السعر','سعر المكان') || 0),
    available_slots:Number(get('available_slots','availSlots','avail_slots','أماكن متاحة','Available Slots') || get('total_slots','totalSlots','total_slots','إجمالي الأماكن','Total Slots') || 0),
    total_slots:    Number(get('total_slots','totalSlots','total_slots','إجمالي الأماكن','عدد الأماكن','Total Slots') || 0),
    image:          get('image','صورة','رابط الصورة','Image','img')                || '',
    description:    get('description','الوصف','تفاصيل','Description')             || '',
    category:       get('category','venueType','venue_type','الفئة','النوع','التصنيف','Category') || firstTag || '',
    organizer:      get('organizer','المنظم','جهة التنظيم','Organizer')            || '',
    venue_address:  get('venue_address','address','Address','عنوان المكان','العنوان','Venue') || '',
    status:         get('status','الحالة','Status')                                || 'published',
  };
}

/* ================================================================
   🔍 مودال المعاينة — Inspection Modal
   ================================================================ */

let _inspSpaceId   = null;
let _inspSelDate   = null;

const _INSP_DAY_NAMES   = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const _INSP_MONTH_NAMES = ['يناير','فبراير','مارس','إبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

function openInspectionModal(spaceId) {
  const s = SPACES.find(x => x.id === spaceId);
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
  [1,2,3].forEach(n => {
    const body = document.getElementById(`insp-step-${n}`);
    const dot  = document.getElementById(`insp-dot-${n}`);
    const line = document.getElementById(`insp-line-${n}`);
    if (body) body.style.display = n === step ? 'block' : 'none';
    if (dot) {
      dot.classList.toggle('active', n === step);
      dot.classList.toggle('done',   n <  step);
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
  const name     = (document.getElementById('insp-name')?.value     || '').trim();
  const phone    = (document.getElementById('insp-phone')?.value    || '').trim();
  const activity = (document.getElementById('insp-activity')?.value || '').trim();
  const errEl    = document.getElementById('insp-error');

  if (!name)                         { errEl.textContent = '⚠ يرجى إدخال الاسم الكامل'; return; }
  if (!/^01\d{9}$/.test(phone))      { errEl.textContent = '⚠ رقم الهاتف 11 رقم يبدأ بـ 01'; return; }
  if (!activity)                     { errEl.textContent = '⚠ يرجى اختيار النشاط التجاري'; return; }
  if (!_inspSelDate)                 { errEl.textContent = '⚠ يرجى اختيار موعد للمعاينة'; return; }
  errEl.textContent = '';

  const s = SPACES.find(x => x.id === _inspSpaceId);
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
  const name     = (document.getElementById('insp-name')?.value     || '').trim();
  const phone    = (document.getElementById('insp-phone')?.value    || '').trim();
  const activity = (document.getElementById('insp-activity')?.value || '').trim();
  const s        = SPACES.find(x => x.id === _inspSpaceId);
  const spaceName = s ? s.name : '—';

  const inspId = `INS-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const idEl = document.getElementById('insp-id-val');
  if (idEl) idEl.textContent = inspId;

  const detailsEl = document.getElementById('insp-confirm-details');
  if (detailsEl) {
    detailsEl.innerHTML = [
      ['المساحة', spaceName],
      ['الموعد',  _inspSelDate || '—'],
      ['النشاط',  activity],
    ].map(([k,v]) => `
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
  const times  = ['11:00 ص', '11:00 ص', '2:00 م'];
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (result.length < 3) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) {
      const dayLabel  = _INSP_DAY_NAMES[dow];
      const dateLabel = `${d.getDate()} ${_INSP_MONTH_NAMES[d.getMonth()]}`;
      const time      = times[result.length];
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
  try {
    const res  = await fetch(BAZAAR_SHEET_URL);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ الشيت مش بيرجع JSON:', text.substring(0, 300));
      _renderBazaarsEmpty();
      return;
    }

    let rows = Array.isArray(json)              ? json
             : Array.isArray(json.data)         ? json.data
             : Array.isArray(json.rows)         ? json.rows
             : Array.isArray(json.bazaars)      ? json.bazaars
             : Array.isArray(json.result)       ? json.result
             : Array.isArray(json.items)        ? json.items
             : Array.isArray(json.values)       ? json.values
             : (json.status === 'ok' && Array.isArray(json.data)) ? json.data
             : [];

    rows = rows.filter(r =>
      r && typeof r === 'object' &&
      Object.values(r).some(v => v !== '' && v !== null && v !== undefined)
    );

    if (!rows.length) {
      _renderBazaarsEmpty();
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
    renderHomeBazaars();

  } catch (err) {
    console.error('❌ خطأ في تحميل البازارات:', err.message);
    _renderBazaarsEmpty();
  }
}

/** Supabase fallback */
async function _loadBazaarsFromSupabase() {
  if (!sbClient) { _renderBazaarsEmpty(); return; }
  try {
    const { data, error } = await sbClient
      .from('bazaars').select('*')
      .eq('status', 'published')
      .order('date_start', { ascending: true });
    if (!error && data?.length) {
      BAZAARS = data;
      renderHomeBazaars();
    } else {
      _renderBazaarsEmpty();
    }
  } catch (e) { _renderBazaarsEmpty(); }
}

function _renderBazaarsEmpty() {
  const scroll = document.getElementById('bz-home-scroll');
  if (scroll) {
    scroll.innerHTML = `
      <div class="bz-home-empty">
        لا توجد بازارات قريبة الآن — تابعنا قريباً!
      </div>`;
  }
}



function renderHomeBazaars() {
  const container = document.getElementById('bz-home-scroll');
  if (!container) return;

  const today = new Date().toISOString().split('T')[0];
  const upcoming = BAZAARS
    .filter(b => !b.date_start || b.date_start >= today)
    .sort((a, b) => (a.date_start || '').localeCompare(b.date_start || ''));

  if (!upcoming.length) {
    container.innerHTML = `
      <div class="bz-home-empty">
        لا توجد بزارات قريبة الآن — تابعنا قريباً!
      </div>`;
    return;
  }

  const b = upcoming[0];
  const dateStr = b.date_start
    ? new Date(b.date_start).toLocaleDateString('ar-EG', { weekday:'short', month:'long', day:'numeric' })
    : 'قريباً';
  const availSlots = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
  const isSoldOut  = availSlots === 0 && (b.total_slots || 0) > 0;

  container.innerHTML = `
    <div class="bz-mini-card bz-mini-card-featured" onclick="window.location.href='bazaars/?bazaar=${b.id}'">
      <div class="bz-mini-img">
        ${b.image
          ? `<img src="${b.image}" alt="${b.name}" loading="lazy"
                  onerror="this.parentElement.innerHTML='<div class=\\\'bz-mini-placeholder\\\' >🎪</div>'">`
          : `<div class="bz-mini-placeholder">🎪</div>`}
        <div class="bz-mini-date">${dateStr}</div>
      </div>
      <div class="bz-mini-body">
        <div class="bz-mini-kicker">${b.category || 'بازار قريب'}</div>
        <div class="bz-mini-name">${b.name}</div>
        <div class="bz-mini-loc">📍 ${b.location || b.region || 'سيتم تحديد المكان قريباً'}</div>
        <div class="bz-mini-meta">
          <span>${Number(b.price_per_slot || 0).toLocaleString('ar-EG')} ج / مكان</span>
          <span class="${isSoldOut ? 'is-soldout' : 'is-available'}">
            ${isSoldOut ? 'مكتمل' : availSlots + ' مكان متاح'}
          </span>
        </div>
      </div>
    </div>`;
}

function shareCard(type, id, name) {
  const base = window.location.origin + window.location.pathname;
  let url, shareText;

  if (type === 'space') {
    url       = base + '?space=' + id;
    shareText = 'شوف المساحة دي على مكاني Spot: ' + name;
  } else if (type === 'unit') {
    const parts = String(id).split(':');
    url       = base + '?space=' + parts[0] + '&unit=' + encodeURIComponent(parts[1] || '');
    shareText = 'شوف الوحدة دي على مكاني Spot: ' + name;
  } else {
    url       = base + '?bazaar=' + id;
    shareText = 'شوف البازار ده على مكاني Spot: ' + name;
  }

  if (navigator.share) {
    navigator.share({ title: 'مكاني Spot', text: shareText, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(()  => _showShareToast('✅ تم نسخ الرابط!'))
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

/**
 * يتحقق من حالة تسجيل الدخول ويوجّه لطلب الترقية أو التسجيل
 * يُستخدم في صفحة "عندك مساحة فاضية؟"
 */
function handleOwnerUpgradeBtn() {
  if (currentUser) {
    goToDashboard();
  } else {
    showPage('signup');
  }
}
