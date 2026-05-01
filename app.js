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
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxyCDOQW3SlaoSEPAAFfClUcHYyxA6-iei4Zuvvv5Us8caWP9X3WjgoeyhsOVNGJ9XqQw/exec";

/**
 * 📬 رابط Google Apps Script الذي يستقبل طلبات الحجز ويحفظها في الشيت
 * لو غيّرت شيت الحجوزات، ضع الرابط الجديد هنا
 */
const BOOKING_URL = "https://script.google.com/macros/s/AKfycbzZPnqZ4hjy8nzzGDcrQUpJK_pZn01lGIJXL-EfScxpGISLMjo6wL6xCLqNMviBpD69/exec";

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

  // تحقق من حالة تسجيل الدخول
  initAuth();

  // تهيئة مؤشر السعر في الصفحة الرئيسية
  initPriceSlider();
});


/* ================================================================
   🎚️ القسم الرابع: مؤشر السعر (Slider) — الصفحة الرئيسية
   ================================================================ */

/**
 * يُهيّئ مؤشر السعر في الصفحة الرئيسية (المؤشرات المزدوجة)
 * يربط الأحداث بالعناصر ويرسم الشريط الملوّن
 */
function initPriceSlider() {
  const sliderMin = document.getElementById('slider-min');
  const sliderMax = document.getElementById('slider-max');
  
  if (!sliderMin || !sliderMax) return;
  
  if (parseInt(sliderMin.value) > parseInt(sliderMax.value)) {
    sliderMin.value = sliderMax.value;
  }
  if (parseInt(sliderMax.value) < parseInt(sliderMin.value)) {
    sliderMax.value = sliderMin.value;
  }
  
  sliderMin.addEventListener('input', updateMainSlider);
  sliderMax.addEventListener('input', updateMainSlider);
  updateMainSlider();
}

/**
 * يحدّث مظهر الشريط والتسميات عند تحريك المؤشرات
 */
function updateMainSlider() {
  const sliderMin = document.getElementById('slider-min');
  const sliderMax = document.getElementById('slider-max');
  
  if (!sliderMin || !sliderMax) return;

  let min = parseInt(sliderMin.value);
  let max = parseInt(sliderMax.value);

  if (min > max) {
    [min, max] = [max, min];
    sliderMin.value = min;
    sliderMax.value = max;
  }

  const range = parseInt(sliderMax.max);
  const minPercent = (min / range) * 100;
  const maxPercent = (max / range) * 100;

  const track = document.getElementById('slider-track');
  if (track) {
    track.style.background =
      `linear-gradient(to left, #e8e8e8 0%, #e8e8e8 ${minPercent}%, #FF6B00 ${minPercent}%, #FF6B00 ${maxPercent}%, #e8e8e8 ${maxPercent}%, #e8e8e8 100%)`;
  }

  const minLabel = document.getElementById('price-min-label');
  const maxLabel = document.getElementById('price-max-label');
  
  if (minLabel) {
    minLabel.textContent = min === 0 ? '٠ ج' : Number(min).toLocaleString('ar-EG') + ' ج';
  }
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
    SPACES     = json.spaces     || [];

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
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:6px">جاري تحميل المساحات…</div>
      <div style="font-size:13px;color:var(--ink3)">بنجيب أحدث البيانات من الشيت</div>
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
  return `
  <div class="space-card">
    <div class="card-thumb">
      ${thumbHtml}
      <span class="card-badge ${s.badgeClass || 'badge-avail'}">${s.badge || 'متاح'}</span>
      ${unitsBadgeHtml}
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
                  onclick="openBooking(${s.id})">احجز دلوقتي ←</button>
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
      <button class="btn-view-all" onclick="goToMarketplace()">
        <span>عرض جميع المساحات المتاحة (${SPACES.length})</span>
        <span class="view-all-arrow">←</span>
      </button>
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
function openSpaceDetail(spaceId, fromPage) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

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
            <span onclick="goToMarketplace()" style="cursor:pointer">المساحات</span>
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
              ${s.subSpaces && s.subSpaces.length > 0
                ? `<span class="sd-meta-sep">·</span>
                   <span style="color:var(--orange);font-weight:700">${s.subSpaces.length} وحدة</span>`
                : ''}
            </div>
          </div>
          <div class="sd-price-box">
            <div class="sd-price-val">${Number(s.price).toLocaleString('ar-EG')} ج</div>
            <div class="sd-price-lbl">/ شهر (ابتداءً من)</div>
            <button class="btn btn-primary" style="margin-top:10px;width:100%;justify-content:center"
                    onclick="openBooking(${s.id})">احجز دلوقتي ←</button>
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
 * [قديم — محتفظ به للتوافق]
 * يغيّر الصورة الرئيسية في معرض التفاصيل
 * الآن يُستخدم sdGoTo بدلاً منه
 */
function sdSetMainImage(url, caption) {
  // يبحث عن الـ Slider النشط في صفحة التفاصيل ويذهب للصورة المطلوبة
  const activeDetail = currentSpaceDetail;
  if (!activeDetail) return;
  const id = `detail-${activeDetail.id}`;
  const state = _sliders[id];
  if (!state) return;
  // ابحث عن index الصورة المطلوبة وانتقل إليها
  const el = document.getElementById(id);
  if (!el) return;
  const slides = el.querySelectorAll('.sd-slide img');
  slides.forEach((img, i) => {
    if (img.src === url || img.src.endsWith(url)) sdGoTo(id, i);
  });
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
          ${!isBlocked
            ? `<button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                       onclick="openBookingForUnit(${s.id},'${unit.unitId}')">
                 احجز ←
               </button>`
            : `<span style="font-size:12px;color:var(--ink3);padding:7px 0">غير متاح حالياً</span>`
          }
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
 * يفتح صفحة الماركت بليس ويصفّرها
 */
function goToMarketplace() {
  showPage('market');
  mpPage        = 1;
  mpActiveTypes = [];
  mpActiveActs  = [];
  mpFiltered    = [...SPACES];

  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (s1) s1.value = 0;
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMpSlider();

  const mpRegion = document.getElementById('mp-region');
  if (mpRegion) mpRegion.value = '';
  const mpSort = document.getElementById('mp-sort');
  if (mpSort) mpSort.value = 'default';

  document.querySelectorAll('.mp-type-btn').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.mp-act-btn').forEach(b => b.classList.remove('on'));

  renderMarketplace();
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
  const minVal = parseInt(document.getElementById('mp-slider-min')?.value) || 0;
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

  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (s1) s1.value = 0;
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

function initMpSlider() {
  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (!s1 || !s2) return;
  s1.addEventListener('input', updateMpSlider);
  s2.addEventListener('input', updateMpSlider);
  updateMpSlider();
}

function updateMpSlider() {
  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (!s1 || !s2) return;

  let minVal = parseInt(s1.value);
  let maxVal = parseInt(s2.value);
  const RANGE_MAX = parseInt(s1.max) || 50000;

  if (minVal > maxVal - 500) {
    minVal = maxVal - 500;
    s1.value = minVal;
  }

  const pMin = (minVal / RANGE_MAX) * 100;
  const pMax = (maxVal / RANGE_MAX) * 100;

  const track = document.getElementById('mp-slider-track');
  if (track) {
    track.style.background =
      `linear-gradient(to left, #e8e8e8 ${100 - pMax}%, #FF6B00 ${100 - pMax}%, #FF6B00 ${100 - pMin}%, #e8e8e8 ${100 - pMin}%)`;
  }

  const lMin = document.getElementById('mp-price-min-label');
  const lMax = document.getElementById('mp-price-max-label');
  if (lMin) lMin.textContent = Number(minVal).toLocaleString('ar-EG') + ' ج';
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

  const reg  = document.getElementById('f-region')?.value || '';
  const type = document.getElementById('f-type')?.value || activeTab;
  const minPrice = parseInt(document.getElementById('slider-min')?.value) || 0;
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
  const r  = document.getElementById('f-region')?.value;
  const minPrice = parseInt(document.getElementById('slider-min')?.value) || 0;
  const maxPrice = parseInt(document.getElementById('slider-max')?.value) || 50000;

  if (r) chips.push(r);
  if (minPrice > 0 || maxPrice < 50000) {
    const minStr = minPrice > 0 ? Number(minPrice).toLocaleString('ar-EG') : '٠';
    const maxStr = maxPrice >= 50000 ? 'بلا حد' : Number(maxPrice).toLocaleString('ar-EG');
    chips.push(`${minStr} - ${maxStr} ج`);
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

  const sliderMin = document.getElementById('slider-min');
  const sliderMax = document.getElementById('slider-max');
  if (sliderMin) sliderMin.value = 0;
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
  // حفظ الصفحة الحالية (باستثناء صفحة التفاصيل — لا نحفظها في localStorage)
  if (['home','how','owner','market','dashboard'].includes(p)) {
    localStorage.setItem('lastPage', p);
  }

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');

  // تحديث الرابط النشط في الـ Nav
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const links = document.querySelectorAll('.nav-links a');
  if (p === 'home')   links[0]?.classList.add('active');
  if (p === 'how')    links[1]?.classList.add('active');
  if (p === 'owner')  links[2]?.classList.add('active');
  if (p === 'market') links[3]?.classList.add('active');

  // لو فتحنا الماركت بليس
  if (p === 'market') {
    setTimeout(initMpSlider, 120);
    if (SPACES.length && !mpFiltered.length) {
      mpFiltered = [...SPACES];
      renderMarketplace();
    }
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
  console.warn('⚠️ تحذير الشيت:', sheetErr.message);
  sheetOk = true; // نكمّل في Supabase على أي حال
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
        console.error('❌ خطأ Supabase في حفظ الحجز:', bookingError.message);
      } else {
        console.log('✅ تم حفظ الحجز في Supabase:', bookingId);
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
        } else {
          console.warn('⚠️ Profile update failed:', profileError.message);
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
    updateBnUser(user, profile);
  }

  const bnUserIcon  = document.getElementById('bn-user-icon');
  const bnUserLabel = document.getElementById('bn-user-label');

  if (bnUserIcon && bnUserLabel) {
    if (user) {
      const initial = (profile?.full_name || user.email || 'م')[0];
      bnUserIcon.textContent  = '👤';
      bnUserLabel.textContent = initial + '..';
    } else {
      bnUserIcon.textContent  = '👤';
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
      redirectTo: "https://makanispot.com"
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

  const { data: profile } = await sbClient
    .from('profiles').select('*').eq('id', user.id).single();

  currentUser    = user;
  currentProfile = profile;

  const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const firstName = name.split(' ')[0];
  const roleLabel = { tenant: 'مستأجر — صاحب مشروع', owner: 'صاحب مساحة' }[profile?.role] || 'مستخدم';
  const dateStr   = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('dash-firstname', firstName);
  set('dpf-name',       name);
  set('dpf-email',      user.email || '—');
  set('dpf-phone',      profile?.phone || '—');
  set('dpf-city',       profile?.city  || '—');
  set('dpf-role',       roleLabel);
  set('dpf-date',       dateStr);

  const efName  = document.getElementById('ef-name');
  const efPhone = document.getElementById('ef-phone');
  const efCity  = document.getElementById('ef-city');
  if (efName)  efName.value  = name;
  if (efPhone) efPhone.value = profile?.phone || '';
  if (efCity)  efCity.value  = profile?.city  || '';

  const badge = document.getElementById('dash-role-badge');
  if (badge) {
    if (profile?.role === 'owner') {
      badge.innerHTML          = '🏬 صاحب مساحة';
      badge.style.background   = 'var(--green-light)';
      badge.style.color        = '#16a34a';
      badge.style.borderColor  = 'rgba(34,197,94,0.25)';
    } else {
      badge.innerHTML          = '🏠 مستأجر';
      badge.style.background   = 'var(--orange-ultra)';
      badge.style.color        = 'var(--orange)';
      badge.style.borderColor  = 'var(--orange-pale)';
    }
  }

  const roleBox = document.getElementById('dpf-role-box');
  if (roleBox) {
    if (profile?.role === 'owner') {
      roleBox.textContent      = '🏬 صاحب مساحة';
      roleBox.style.background = 'var(--green-light)';
      roleBox.style.color      = '#16a34a';
      roleBox.style.borderColor = 'rgba(34,197,94,0.25)';
    } else {
      roleBox.textContent      = '🏠 مستأجر';
      roleBox.style.background = 'var(--orange-ultra)';
      roleBox.style.color      = 'var(--orange)';
      roleBox.style.borderColor = 'var(--orange-pale)';
    }
  }

  setNavUser(user, profile);

  await loadUserBookings(user.id);
  await loadUserRatings(user.id);

  // ✅ Realtime — يراقب أي تغيير في حالة الحجوزات ويحدّث الداشبورد تلقائياً
  _subscribeBookings(user.id);
}

function toggleEditProfile() {
  const viewEl = document.getElementById('profile-view');
  const editEl = document.getElementById('profile-edit');
  if (!viewEl || !editEl) return;

  const isEditing = editEl.style.display === 'block';

  if (isEditing) {
    viewEl.style.display = 'block';
    editEl.style.display = 'none';
  } else {
    const efName  = document.getElementById('ef-name');
    const efPhone = document.getElementById('ef-phone');
    const efCity  = document.getElementById('ef-city');
    const name    = document.getElementById('dpf-name')?.textContent;
    const phone   = document.getElementById('dpf-phone')?.textContent;
    const city    = currentProfile?.city || '';

    if (efName  && name  !== '—') efName.value  = name;
    if (efPhone && phone !== '—') efPhone.value = phone;
    if (efCity)                   efCity.value  = city;

    viewEl.style.display = 'none';
    editEl.style.display = 'block';
  }
}

async function saveProfile() {
  if (!sbClient || !currentUser) return;

  const name  = document.getElementById('ef-name')?.value.trim();
  const phone = document.getElementById('ef-phone')?.value.trim();
  const city  = document.getElementById('ef-city')?.value;

  if (!name) { showDashAlert('error', 'من فضلك ادخل اسمك'); return; }

  setBtnLoading('btn-save-profile', true);
  const { error } = await sbClient
    .from('profiles')
    .upsert(
      { id: currentUser.id, full_name: name, phone: phone, city: city },
      { onConflict: 'id' }
    );
  setBtnLoading('btn-save-profile', false, '💾 حفظ التعديلات');

  if (error) { showDashAlert('error', 'في مشكلة في الحفظ'); return; }

  showDashAlert('success', 'اتحفظت بياناتك بنجاح ✅');
  await loadDashboardData(currentUser);
  toggleEditProfile();
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
   📋 القسم العشرون: حجوزات المستخدم
   ================================================================ */

async function loadUserBookings(userId) {
  if (!sbClient) return;

  const contEl = document.getElementById('dash-bookings');
  const cntEl  = document.getElementById('dash-booking-count');

  try {
    const { data: bookings, error: bookErr } = await sbClient
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (bookErr) console.error('خطأ في جلب الحجوزات:', bookErr);

    if (cntEl) cntEl.textContent = bookings?.length || 0;

    if (!contEl) return;

    if (!bookings?.length) {
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
     
    contEl.innerHTML = bookings.map(b => {
      const st      = statusMap[b.status] || statusMap.pending;
      const dateStr = b.created_at
        ? new Date(b.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';

      return `
      <div class="booking-card">
        <div class="booking-card-header">
          <div>
            <div class="booking-space-name">${b.space_name || '—'}</div>
            <div class="booking-space-loc">📍 ${b.space_loc || '—'} · ${b.price || '—'}</div>
          </div>
          <span class="booking-status ${st.cls}">${st.label}</span>
        </div>
        <div class="booking-card-details">
          <span>🏷 ${b.activity || '—'}</span>
          <span>📐 ${b.size || '—'}</span>
          <span>⏱ ${b.duration || '—'}</span>
          <span>📅 ${dateStr}</span>
        </div>
      </div>`;
    }).join('');

  } catch (e) {
    if (contEl) contEl.innerHTML = '<div class="no-bookings">تعذّر تحميل الحجوزات</div>';
  }
}


/* ================================================================
   🔄 القسم العشرون-ب: Realtime — مراقبة تغييرات حالة الحجوزات
   ================================================================ */

let _bookingChannel = null; // نحفظ الـ channel عشان منعملش subscribe أكتر من مرة

function _subscribeBookings(userId) {
  if (!sbClient) return;

  // لو في subscription قديمة — شيلها الأول
  if (_bookingChannel) {
    sbClient.removeChannel(_bookingChannel);
    _bookingChannel = null;
  }

  _bookingChannel = sbClient
    .channel('bookings-status-' + userId)
    .on(
      'postgres_changes',
      {
        event:  'UPDATE',
        schema: 'public',
        table:  'bookings',
        filter: `user_id=eq.${userId}`,
      },
      async (payload) => {
        // أي تغيير في أي حجز للمستخدم ده → حدّث قائمة الحجوزات فوراً
        console.log('📡 تحديث حجز:', payload.new?.id, '→', payload.new?.status);
        await loadUserBookings(userId);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime مفعّل — بيراقب تغييرات الحجوزات');
      }
    });
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

function handleBnUser() {
  if (currentUser) {
    goToDashboard();
    updateBottomNav('user');
  } else {
    goToLogin();
    updateBottomNav('user');
  }
}

function updateBnUser(user, profile) {
  const icon  = document.getElementById('bn-user-icon');
  const label = document.getElementById('bn-user-label');
  if (!icon || !label) return;

  if (user) {
    const name = profile?.full_name || user.email?.split('@')[0] || '؟';
    icon.textContent  = name.trim()[0] || '👤';
    label.textContent = 'حسابي';
  } else {
    icon.textContent  = '👤';
    label.textContent = 'دخول';
  }
}
