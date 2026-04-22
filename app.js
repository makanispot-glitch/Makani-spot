/* ================================================================
   📁 app.js — الطبقة الثالثة: السلوك والوظائف
   ================================================================
   🧠 هذا الملف مسؤول عن كل ما يتحرك في الموقع:
      - تحميل البيانات من Google Sheets
      - نظام تسجيل الدخول عبر Supabase
      - عرض الكروت والفلاتر
      - مودال الحجز وإرسال البيانات
      - صفحة الماركت بليس (كل المساحات)
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
const SHEET_URL = "https://script.google.com/macros/s/AKfycbwpfHaeIG9UBYmO_QmchJCqnKgJcahvncYkS1gRRAD_RxIla9JvSQmPSO2soBwpuX6N2g/exec";

/**
 * 📬 رابط Google Apps Script الذي يستقبل طلبات الحجز ويحفظها في الشيت
 * لو غيّرت شيت الحجوزات، ضع الرابط الجديد هنا
 */
const BOOKING_URL = "https://script.google.com/macros/s/AKfycbyjhFQ_owlHoRibE5XLxh882fOQJg9A6RGwUfKeHOioYJWK6E43c51n7HsncRqXE0IP/exec";

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
 * يُهيّئ مؤشر السعر المزدوج في الصفحة الرئيسية
 * يربط الأحداث بالعناصر ويرسم الشريط الملوّن
 */
function initPriceSlider() {
  const s1 = document.getElementById('slider-min');
  const s2 = document.getElementById('slider-max');
  if (!s1 || !s2) return;
  s1.addEventListener('input', updateMainSlider);
  s2.addEventListener('input', updateMainSlider);
  updateMainSlider(); // رسم مبدئي
}

/**
 * يحدّث مظهر الشريط والتسميات عند تحريك أي من المؤشرين
 * يضمن أن الحد الأدنى لا يتجاوز الحد الأقصى
 */
function updateMainSlider() {
  const s1 = document.getElementById('slider-min');
  const s2 = document.getElementById('slider-max');
  if (!s1 || !s2) return;

  let minVal = parseInt(s1.value);
  let maxVal = parseInt(s2.value);
  const RANGE_MAX = parseInt(s1.max) || 50000;

  // منع التقاطع بين المؤشرين
  if (minVal > maxVal - 500) {
    minVal = maxVal - 500;
    s1.value = minVal;
  }

  const pMin = (minVal / RANGE_MAX) * 100;
  const pMax = (maxVal / RANGE_MAX) * 100;

  // تلوين الجزء النشط من الشريط باللون البرتقالي
  const track = document.getElementById('slider-track');
  if (track) {
    track.style.background =
      `linear-gradient(to left, #e8e8e8 ${100 - pMax}%, #FF6B00 ${100 - pMax}%, #FF6B00 ${100 - pMin}%, #e8e8e8 ${100 - pMin}%)`;
  }

  // تحديث تسميات الأسعار
  const lMin = document.getElementById('price-min-label');
  const lMax = document.getElementById('price-max-label');
  if (lMin) lMin.textContent = Number(minVal).toLocaleString('ar-EG') + ' ج';
  if (lMax) lMax.textContent = maxVal >= RANGE_MAX ? 'بلا حد' : Number(maxVal).toLocaleString('ar-EG') + ' ج';
}


/* ================================================================
   📊 القسم الخامس: تحميل البيانات من Google Sheets
   ================================================================ */

/**
 * يجيب المساحات والأنشطة من Google Sheets عبر Apps Script
 * يُعرض مؤشر تحميل أثناء الانتظار
 * بعد التحميل يعرض أول 6 مساحات في الهوم فقط
 */
async function loadData() {
  showLoadingState('spaces-grid');
  try {
    const res  = await fetch(SHEET_URL);
    const json = await res.json();

    if (json.status !== "ok") throw new Error(json.message || "خطأ في قراءة الشيت");

    ACTIVITIES = json.activities || [];
    SPACES     = json.spaces     || [];

    buildActivityFilters();      // ابنِ قائمة الأنشطة في الفلتر الرئيسي
    buildModalActivityPicker();  // ابنِ أزرار الأنشطة في مودال الحجز
    buildMpActivityFilters();    // ابنِ أزرار الأنشطة في فلتر الماركت بليس

    // أظهر أول 6 مساحات فقط في الهوم + زرار "عرض الكل"
    renderCards(SPACES.slice(0, 6), 'spaces-grid', SPACES.length > 6);

    // تحديث العداد
    const counter = document.getElementById('res-count');
    if (counter) counter.textContent = SPACES.length + ' مساحة';

  } catch (err) {
    showErrorState(err.message, 'spaces-grid');
  }
}

/**
 * يعرض شاشة التحميل داخل أي grid
 * @param {string} gridId — id الـ grid المراد إظهار التحميل فيه
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
 * @param {string} msg    — رسالة الخطأ
 * @param {string} gridId — id الـ grid المراد إظهار الخطأ فيه
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

/**
 * يملأ قائمة الأنشطة في صندوق البحث الرئيسي (dropdown)
 */
function buildActivityFilters() {
  const sel = document.getElementById('f-act');
  if (!sel) return;
  sel.innerHTML = '<option value="">— كل الأنشطة —</option>' +
    ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
}

/**
 * يُشغَّل عند اختيار نشاط من القائمة الرئيسية
 * @param {string} id — id النشاط المختار
 */
function onActDropdown(id) {
  selectedAct = id;
  filterAndRender();
  showSearchChips();
}

/**
 * يملأ أزرار الأنشطة داخل مودال الحجز
 */
function buildModalActivityPicker() {
  const picker = document.getElementById('modal-act-picker');
  if (!picker) return;
  picker.innerHTML = ACTIVITIES.map(a =>
    `<button class="act-pick-btn" data-id="${a.id}" onclick="toggleModalAct('${a.id}',this)">${a.label}</button>`
  ).join('');
}

/**
 * تحديد/إلغاء نشاط في مودال الحجز
 * يخفي/يظهر حقل "اذكر نشاطك" لو اختار "أخرى"
 * @param {string} id — id النشاط
 * @param {Element} el — الزرار المضغوط
 */
function toggleModalAct(id, el) {
  document.querySelectorAll('.act-pick-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const wrap = document.getElementById('other-act-wrap');
  if (wrap) wrap.style.display = (id === 'other') ? 'block' : 'none';
}

/**
 * يبني أزرار الأنشطة في الفلتر الجانبي لصفحة الماركت بليس
 */
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
 * @param {Object} s — بيانات المساحة
 * @returns {string} — HTML الكارد
 */
function buildCardHtml(s) {
  // ── صورة الكارد أو الإيموجي البديل ──
  const thumbHtml = s.image
    ? `<img src="${s.image}" alt="${s.name}" loading="lazy"
           onerror="this.parentElement.innerHTML='<div class=\\'card-thumb-placeholder ${s.thumbClass}\\'>${s.icon}</div>'">`
    : `<div class="card-thumb-placeholder ${s.thumbClass}">${s.icon}</div>`;

  // ── أزرار الأنشطة ──
  const actsHtml = s.allActs
    ? '<span class="act-tag act-tag-all">✓ يصلح لجميع الأنشطة</span>'
    : (s.acts || []).slice(0, 5).map(id => {
        const a = ACTIVITIES.find(x => x.id === id);
        return a ? `<span class="act-tag">${a.label}</span>` : '';
      }).join('') + (s.acts && s.acts.length > 5 ? `<span class="act-tag">+${s.acts.length - 5}</span>` : '');

  // ── نظام التسعير حسب الحجم ──
  // كل حجم عنده سعره الخاص — مثال: "١×١ م:1900"
  const sizePrices = {};
  const sizesClean = [];
  (s.sizes || []).forEach(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    sizePrices[label] = price;
    sizesClean.push(label);
  });

  const defaultSize  = sizesClean[0] || '';
  const defaultPrice = sizePrices[defaultSize] || s.price;

  // ── أزرار الأحجام (كل زرار يغيّر السعر في الكارد) ──
  const sizesHtml = sizesClean.map((sz, i) =>
    `<span class="size-chip${i === 0 ? ' on' : ''}"
      data-price="${sizePrices[sz]}"
      data-size="${sz}"
      onclick="event.stopPropagation();
               var c=this.closest('.space-card');
               c.querySelectorAll('.size-chip').forEach(x=>x.classList.remove('on'));
               this.classList.add('on');
               c.querySelector('.price-main').innerHTML=
                 Number(this.dataset.price).toLocaleString('ar-EG')+' ج <span style=\\'font-size:12px;font-weight:400;color:var(--ink2)\\'>/شهر</span>';">
      ${sz}
    </span>`
  ).join('');

  return `
  <div class="space-card">
    <div class="card-thumb">
      ${thumbHtml}
      <span class="card-badge ${s.badgeClass}">${s.badge}</span>
    </div>
    <div class="card-body">
      <div class="card-name">${s.name}</div>
      <div class="card-loc">📍 ${s.loc}</div>
      <div class="card-acts">${actsHtml}</div>
      <div class="card-sizes">${sizesHtml}</div>
      <div class="card-footer">
        <div class="price-main">${Number(defaultPrice).toLocaleString('ar-EG')} ج <span>/ شهر</span></div>
        <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                onclick="openBooking(${s.id})">احجز دلوقتي ←</button>
      </div>
      <div class="card-tip">
        <div class="tip-dot"></div>
        <div><strong>موسم البيع:</strong> ${s.season}<br>${s.insight}</div>
      </div>
    </div>
  </div>`;
}

/**
 * يرسم كروت المساحات في أي grid
 * @param {Array}   data       — قائمة المساحات المراد عرضها
 * @param {string}  gridId     — id العنصر المراد الرسم فيه (افتراضي: spaces-grid)
 * @param {boolean} showViewAll — هل يُظهر زرار "عرض الكل" في نهاية الكروت؟
 */
function renderCards(data, gridId, showViewAll) {
  const grid = document.getElementById(gridId || 'spaces-grid');
  if (!grid) return;

  // رسالة "لا توجد نتائج"
  if (!data.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:70px 20px;color:var(--ink2)">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">مش لاقيين مساحات بالمعايير دي</div>
        <div style="font-size:14px">جرب تغيير النشاط أو المنطقة أو السعر</div>
      </div>`;
    return;
  }

  // زرار "عرض جميع المساحات" يظهر لو في مساحات أكتر من المعروضة
  const viewAllHtml = showViewAll ? `
    <div style="grid-column:1/-1;text-align:center;padding:14px 0 4px">
      <button class="btn-view-all" onclick="goToMarketplace()">
        <span>عرض جميع المساحات المتاحة (${SPACES.length})</span>
        <span class="view-all-arrow">←</span>
      </button>
    </div>` : '';

  grid.innerHTML = data.map(s => buildCardHtml(s)).join('') + viewAllHtml;
}


/* ================================================================
   🛍️ القسم الثامن: صفحة الماركت بليس (كل المساحات)
   ================================================================ */

/**
 * يفتح صفحة الماركت بليس ويصفّرها
 * يُستدعى من زرار "عرض الكل" في الهوم
 */
function goToMarketplace() {
  showPage('market');
  mpPage        = 1;
  mpActiveTypes = [];
  mpActiveActs  = [];
  mpFiltered    = [...SPACES];

  // صفّر مؤشرات السعر
  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (s1) s1.value = 0;
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMpSlider();

  // صفّر باقي الفلاتر
  const mpRegion = document.getElementById('mp-region');
  if (mpRegion) mpRegion.value = '';
  const mpSort = document.getElementById('mp-sort');
  if (mpSort) mpSort.value = 'default';

  document.querySelectorAll('.mp-type-btn').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.mp-act-btn').forEach(b => b.classList.remove('on'));

  renderMarketplace();
}

/**
 * تبديل حالة زرار نوع المكان (mall / club / school) في الفلتر الجانبي
 * @param {string}  type — نوع المكان
 * @param {Element} el   — الزرار المضغوط
 */
function toggleMpType(type, el) {
  el.classList.toggle('on');
  mpActiveTypes = el.classList.contains('on')
    ? [...mpActiveTypes, type]
    : mpActiveTypes.filter(t => t !== type);
  mpPage = 1;
  applyMpFilters();
}

/**
 * تبديل حالة زرار النشاط في الفلتر الجانبي
 * @param {string}  id — id النشاط
 * @param {Element} el — الزرار المضغوط
 */
function toggleMpAct(id, el) {
  el.classList.toggle('on');
  mpActiveActs = el.classList.contains('on')
    ? [...mpActiveActs, id]
    : mpActiveActs.filter(a => a !== id);
  mpPage = 1;
  applyMpFilters();
}

/**
 * يطبّق جميع فلاتر الماركت بليس ويرتّب النتائج
 * يُستدعى عند أي تغيير في الفلاتر أو الترتيب
 */
function applyMpFilters() {
  const region = document.getElementById('mp-region')?.value || '';
  const minVal = parseInt(document.getElementById('mp-slider-min')?.value) || 0;
  const maxVal = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
  const sort   = document.getElementById('mp-sort')?.value || 'default';

  let data = [...SPACES];

  // فلترة بالمنطقة
  if (region) data = data.filter(s => s.loc === region);

  // فلترة بنوع المكان
  if (mpActiveTypes.length) data = data.filter(s => mpActiveTypes.includes(s.type));

  // فلترة بالسعر
  data = data.filter(s => s.price >= minVal && s.price <= maxVal);

  // فلترة بالنشاط (يظهر لو يصلح لأي نشاط أو يصلح للأنشطة المحددة)
  if (mpActiveActs.length) {
    data = data.filter(s => s.allActs || (s.acts && mpActiveActs.some(a => s.acts.includes(a))));
  }

  // الترتيب
  if (sort === 'price-asc')  data.sort((a, b) => a.price - b.price);
  if (sort === 'price-desc') data.sort((a, b) => b.price - a.price);

  mpFiltered = data;
  mpPage     = 1;
  renderMarketplace();
  updateMpChips();
}

/**
 * يمسح جميع فلاتر الماركت بليس ويرجع للحالة الأصلية
 */
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

/**
 * يحدّث Chips الفلاتر النشطة فوق الشبكة
 * يُظهر الفلاتر المحددة حالياً كـ tags قابلة للإزالة
 */
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

/**
 * يرسم الصفحة الحالية من مساحات الماركت بليس
 * يتحكم في الـ pagination
 */
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

  grid.innerHTML = pageData.map(s => buildCardHtml(s)).join('');
  renderMpPagination();
}

/**
 * يرسم أزرار التنقل بين الصفحات (Pagination)
 * يعرض أرقام الصفحات مع نقاط للصفحات البعيدة
 */
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

/**
 * ينتقل لصفحة معينة في الماركت بليس ويسكرول للأعلى
 * @param {number} n — رقم الصفحة المراد الانتقال إليها
 */
function mpGoPage(n) {
  mpPage = n;
  renderMarketplace();
  document.getElementById('mp-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── مؤشر سعر الماركت بليس ── */

/**
 * يُهيّئ مؤشر السعر المزدوج في صفحة الماركت بليس
 * يُستدعى عند فتح الصفحة (مؤجّل قليلاً لضمان وجود العناصر)
 */
function initMpSlider() {
  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (!s1 || !s2) return;
  s1.addEventListener('input', updateMpSlider);
  s2.addEventListener('input', updateMpSlider);
  updateMpSlider();
}

/**
 * يحدّث مظهر الشريط والتسميات في مؤشر سعر الماركت بليس
 */
function updateMpSlider() {
  const s1 = document.getElementById('mp-slider-min');
  const s2 = document.getElementById('mp-slider-max');
  if (!s1 || !s2) return;

  let minVal = parseInt(s1.value);
  let maxVal = parseInt(s2.value);
  const RANGE_MAX = parseInt(s1.max) || 50000;

  // منع التقاطع
  if (minVal > maxVal - 500) {
    minVal = maxVal - 500;
    s1.value = minVal;
  }

  const pMin = (minVal / RANGE_MAX) * 100;
  const pMax = (maxVal / RANGE_MAX) * 100;

  // تلوين الشريط
  const track = document.getElementById('mp-slider-track');
  if (track) {
    track.style.background =
      `linear-gradient(to left, #e8e8e8 ${100 - pMax}%, #FF6B00 ${100 - pMax}%, #FF6B00 ${100 - pMin}%, #e8e8e8 ${100 - pMin}%)`;
  }

  // تحديث التسميات
  const lMin = document.getElementById('mp-price-min-label');
  const lMax = document.getElementById('mp-price-max-label');
  if (lMin) lMin.textContent = Number(minVal).toLocaleString('ar-EG') + ' ج';
  if (lMax) lMax.textContent = maxVal >= RANGE_MAX ? 'بلا حد' : Number(maxVal).toLocaleString('ar-EG') + ' ج';
}

/**
 * يفتح/يغلق الفلتر الجانبي على الموبايل
 */
function toggleMpSidebar() {
  document.getElementById('mp-sidebar')?.classList.toggle('open');
  document.getElementById('mp-sidebar-overlay')?.classList.toggle('open');
}


/* ================================================================
   🔍 القسم التاسع: الفلترة والبحث — الصفحة الرئيسية
   ================================================================ */

/**
 * تغيير التبويب (الكل / مولات / نوادي / مدارس)
 * @param {Element} el   — الزرار المضغوط
 * @param {string}  type — نوع المكان
 */
function setTab(el, type) {
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  activeTab = type;
  filterAndRender();
}

/**
 * يُشغَّل عند الضغط على زرار "بحث"
 * يطبّق الفلاتر ويعرض الـ chips
 */
function doSearch() {
  filterAndRender();
  showSearchChips();
}

/**
 * يصفّي المساحات حسب الفلاتر المحددة ويعرض النتائج
 * يأخذ قيم الـ slider بدلاً من الـ input القديم
 */
function filterAndRender() {
  let data = [...SPACES];

  const reg  = document.getElementById('f-region')?.value || '';
  const type = document.getElementById('f-type')?.value || activeTab;
  const mn   = parseInt(document.getElementById('slider-min')?.value) || 0;
  const mx   = parseInt(document.getElementById('slider-max')?.value) || 999999;

  if (reg)  data = data.filter(s => s.loc === reg);
  if (type) data = data.filter(s => s.type === type);
  data = data.filter(s => s.price >= mn && s.price <= mx);
  if (selectedAct) data = data.filter(s => s.allActs || (s.acts && s.acts.includes(selectedAct)));

  // تحديث العداد
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = data.length + ' مساحة';

  // أظهر أول 6 نتائج + زرار "عرض الكل" لو في أكتر
  renderCards(data.slice(0, 6), 'spaces-grid', data.length > 6);
}

/**
 * يعرض الفلاتر المحددة كـ chips قابلة للحذف
 */
function showSearchChips() {
  const chips = [];
  const r  = document.getElementById('f-region')?.value;
  const mn = document.getElementById('slider-min')?.value;
  const mx = document.getElementById('slider-max')?.value;

  if (r) chips.push(r);
  if (mn || mx) {
    chips.push(`${Number(mn || 0).toLocaleString('ar-EG')} – ${Number(mx || 0).toLocaleString('ar-EG')} ج`);
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

/**
 * يمسح كل الفلاتر ويرجع للعرض الافتراضي
 */
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

  // إعادة ضبط مؤشر السعر
  const s1 = document.getElementById('slider-min');
  const s2 = document.getElementById('slider-max');
  if (s1) s1.value = 0;
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMainSlider();

  // إعادة عرض أول 6 مساحات
  renderCards(SPACES.slice(0, 6), 'spaces-grid', SPACES.length > 6);
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = SPACES.length + ' مساحة';
}


/* ================================================================
   🗺️ القسم العاشر: التنقل بين الصفحات
   ================================================================ */

/**
 * يُظهر صفحة ويُخفي باقي الصفحات
 * يحدّث الرابط النشط في الـ Nav
 * @param {string} p — اسم الصفحة (home / how / owner / market / login / signup / dashboard / confirm)
 */
function showPage(p) {
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

  // لو فتحنا الماركت بليس — هيّئ الـ slider وارسم الكروت لو مش مرسومة
  if (p === 'market') {
    setTimeout(initMpSlider, 120);
    if (SPACES.length && !mpFiltered.length) {
      mpFiltered = [...SPACES];
      renderMarketplace();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * يرجع للصفحة الرئيسية ويسكرول لصندوق البحث
 */
function scrollToSearch() {
  showPage('home');
  setTimeout(() => {
    document.getElementById('search-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

/** الانتقال لصفحة تسجيل الدخول */
function goToLogin() { showPage('login'); }

/** الانتقال للوحة التحكم مع إغلاق القائمة المنسدلة */
function goToDashboard() {
  closeUserDropdown();
  showPage('dashboard');
}


/* ================================================================
   📋 القسم الحادي عشر: مودال الحجز
   ================================================================ */

/**
 * يفتح مودال الحجز لمساحة معينة
 * يملأ بيانات المستخدم تلقائياً لو هو مسجّل دخول
 * @param {number} spaceId — id المساحة
 */
function openBooking(spaceId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  // استخرج الأحجام والأسعار
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

  // عرض معلومات المساحة في المودال
  document.getElementById('msi-name').textContent = s.name;
  document.getElementById('msi-meta').innerHTML =
    `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(selPrice).toLocaleString('ar-EG')} ج/شهر</strong>`;

  // بناء خيارات الحجم
  const sizeSelect = document.getElementById('bk-size');
  sizeSelect.innerHTML = '<option value="">اختر الحجم</option>' +
    sizesClean.map(sz => `<option value="${sz}" ${sz === selSize ? 'selected' : ''}>${sz}</option>`).join('') +
    '<option value="مخصص">مخصص — هحدده لاحقاً</option>';

  // تغيير السعر عند تغيير الحجم
  sizeSelect.onchange = function () {
    const p = sizePrices[this.value] || s.price;
    document.getElementById('msi-meta').innerHTML =
      `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(p).toLocaleString('ar-EG')} ج/شهر</strong>`;
  };

  // ── تعبئة تلقائية لو المستخدم مسجّل دخول ──
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

  // إعادة ضبط باقي الحقول
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

  // لو الشخص اختار نشاط في الفلتر — حدده تلقائياً في المودال
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

/** إغلاق المودال وإعادة التمرير الطبيعي */
function closeModal() {
  document.getElementById('booking-modal').classList.remove('open');
  document.body.style.overflow = '';
}

/** إغلاق المودال عند الضغط على الخلفية */
function closeModalOnBg(e) {
  if (e.target === document.getElementById('booking-modal')) closeModal();
}


/* ================================================================
   📬 القسم الثاني عشر: إرسال طلب الحجز لـ Google Sheets
   ================================================================ */

/**
 * يرسل بيانات الحجز لـ Google Apps Script
 * لو المستخدم مسجّل — يحفظ الحجز أيضاً في Supabase
 */
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

  // ── التحقق من صحة البيانات ──
  if (!name) { showFormError('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showFormError('من فضلك ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!actBtn) { showFormError('من فضلك اختار نوع نشاطك التجاري'); return; }

  document.getElementById('bk-error').style.display = 'none';

  // تعطيل زرار الإرسال أثناء الانتظار
  const submitBtn     = document.querySelector('#modal-form-wrap .btn-primary');
  const origText      = submitBtn.innerHTML;
  submitBtn.innerHTML = '⏳ جاري الإرسال…';
  submitBtn.disabled  = true;
  submitBtn.style.opacity = '0.7';

  // استخرج معلومات المساحة من المودال
  const spaceName  = document.getElementById('msi-name').textContent;
  const metaText   = document.getElementById('msi-meta').textContent;
  const locMatch   = metaText.match(/📍\s*([^·]+)/);
  const priceMatch = metaText.match(/([\d,٠-٩]+\s*ج)/);
  const spaceLoc   = locMatch   ? locMatch[1].trim()   : '';
  const spacePrice = priceMatch ? priceMatch[1].trim() : '';

  // البيانات التي ستُرسَل للشيت
  const payload = {
    name, phone, email,
    spaceName, spaceLoc, spacePrice,
    activity: actBtn?.textContent || '',
    otherAct, size,
    duration:  dur,
    startDate: date,
    notes,
    userId: currentUser?.id || '',
  };

  try {
    // إرسال البيانات لـ Google Apps Script
    // no-cors: لأن Apps Script لا يدعم CORS الكامل
    await fetch(BOOKING_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    // لو المستخدم مسجّل — احفظ الحجز في Supabase أيضاً
    if (sbClient && currentUser) {
      await sbClient.from('bookings').insert({
        user_id:    currentUser.id,
        space_name: payload.spaceName,
        space_loc:  payload.spaceLoc,
        price:      payload.spacePrice,
        activity:   payload.activity,
        size:       payload.size,
        duration:   payload.duration,
        start_date: payload.startDate,
        notes:      payload.notes,
        status:     'pending',
        created_at: new Date().toISOString(),
      });
      // تحديث لوحة التحكم فوراً
      await loadDashboardData(currentUser);
    }

    // نجاح الإرسال — أظهر رسالة النجاح
    document.getElementById('modal-form-wrap').style.display = 'none';
    document.getElementById('modal-success').style.display   = 'block';

  } catch (fetchErr) {
    // فشل الإرسال — أعِد تفعيل الزرار وأظهر رسالة الخطأ
    submitBtn.innerHTML     = origText;
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
    showFormError('في مشكلة في إرسال الطلب — تأكد من الاتصال بالإنترنت وحاول تاني');
  }
}

/**
 * يعرض رسالة خطأ داخل مودال الحجز
 * @param {string} msg — نص الخطأ
 */
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

/**
 * يُهيّئ نظام المصادقة عند فتح الصفحة
 * يتحقق من وجود جلسة مستخدم مسجّل
 */
async function initAuth() {
  if (!sbClient) return;

  try {
    // تحقق من الجلسة الحالية
    const { data: { session } } = await sbClient.auth.getSession();

    if (session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      setNavUser(session.user, profile);
    } else {
      setNavUser(null, null);
    }
  } catch (_) {
    setNavUser(null, null);
  }

  // استمع لأي تغيير في حالة تسجيل الدخول
  // (مثلاً لو سجّل من نافذة ثانية، أو بعد Google OAuth)
  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      setNavUser(session.user, profile);

      // لو رجع من Google OAuth — ابعته للداشبورد
      if (['pg-login', 'pg-signup'].some(id => document.getElementById(id)?.classList.contains('active'))) {
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

/**
 * يحدّث شريط التنقل حسب حالة المستخدم
 * @param {object|null} user    — بيانات المستخدم أو null لو زائر
 * @param {object|null} profile — بيانات الـ profile من قاعدة البيانات
 */
function setNavUser(user, profile) {
  const guestEl  = document.getElementById('nav-guest');
  const loggedEl = document.getElementById('nav-logged');
  if (!guestEl || !loggedEl) return;

  if (!user) {
    // زائر غير مسجّل
    guestEl.style.display  = 'flex';
    loggedEl.style.display = 'none';
    return;
  }

  const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const email     = user.email || '';
  const initial   = name.trim()[0] || '؟';
  const roleLabel = { tenant: 'مستأجر', owner: 'صاحب مساحة' }[profile?.role] || 'مستخدم';

  // أخفِ زرار "دخول" وأظهر الأفاتار
  guestEl.style.display  = 'none';
  loggedEl.style.display = 'flex';

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('nav-av-circle', initial);
  set('nav-av-name',   name);
  set('nav-av-email',  email);
  set('dd-name',       name);
  set('dd-email',      email);
  set('dd-role',       roleLabel);
}


/* ================================================================
   🔽 القسم الرابع عشر: القائمة المنسدلة للمستخدم
   ================================================================ */

/** فتح أو إغلاق القائمة المنسدلة */
function toggleUserDropdown() {
  const btn = document.getElementById('nav-avatar-btn');
  const dd  = document.getElementById('nav-dropdown');
  if (!btn || !dd) return;
  dd.classList.contains('open')
    ? closeUserDropdown()
    : (btn.classList.add('open'), dd.classList.add('open'));
}

/** إغلاق القائمة المنسدلة */
function closeUserDropdown() {
  document.getElementById('nav-avatar-btn')?.classList.remove('open');
  document.getElementById('nav-dropdown')?.classList.remove('open');
}

// إغلاق القائمة لو ضغط المستخدم في أي مكان آخر
document.addEventListener('click', e => {
  const area = document.getElementById('nav-avatar-btn');
  if (area && !area.contains(e.target)) closeUserDropdown();
});


/* ================================================================
   📧 القسم الخامس عشر: تسجيل الدخول بالبريد الإلكتروني
   ================================================================ */

/**
 * تسجيل دخول بالبريد وكلمة المرور
 */
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
    // ترجمة رسائل الخطأ للعربية
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

/**
 * إنشاء حساب جديد بالبريد وكلمة المرور
 * يحفظ بيانات المستخدم في جدول profiles تلقائياً
 */
async function doEmailSignup() {
  if (!sbClient) return;
  clearAuthAlert('signup-alert');

  const name  = document.getElementById('su-name')?.value.trim();
  const phone = document.getElementById('su-phone')?.value.trim();
  const email = document.getElementById('su-email')?.value.trim();
  const pass  = document.getElementById('su-pass')?.value;
  const role  = document.getElementById('su-role')?.value;
  const city  = document.getElementById('su-city')?.value;

  // ── التحقق من صحة البيانات ──
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

  // إنشاء المستخدم في Supabase Auth
  const { data, error } = await sbClient.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: window.location.origin,           // رابط التأكيد الذي يُرسَل بالبريد
      data: { full_name: name, phone, role, city }       // بيانات إضافية تُحفظ مع المستخدم
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

  // حفظ بيانات المستخدم في جدول profiles
  // (يحدث تلقائياً إذا كان عندك Trigger في Supabase، لكن نعمله يدوياً كاحتياط)
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

  // أظهر صفحة "اتحقق من بريدك"
  const addrEl = document.getElementById('confirm-em-addr');
  if (addrEl) addrEl.textContent = email;
  showPage('confirm');
}


/* ================================================================
   🌐 القسم السابع عشر: تسجيل الدخول بـ Google
   ================================================================ */

/**
 * 🌐 تسجيل الدخول أو إنشاء حساب باستخدام Google OAuth
 * هذه الدالة يتم استدعاؤها عند الضغط على زر "تسجيل الدخول بجوجل"
 */
async function authWithGoogle() {

  // ⚠️ تأكد إن Supabase متحمّل قبل ما نستخدمه
  if (!sbClient) return;

  // 🚀 بدء عملية تسجيل الدخول عبر Google
  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      /**
       * 🔁 الرابط الذي سيعود إليه المستخدم بعد تسجيل الدخول
       * مهم جداً يكون ثابت (مش ديناميك)
       * لأن ده اللي بيحل مشكلة Error 522
       */
      redirectTo: "https://makanispot.com"
    }
  });

  // ❌ في حالة حدوث خطأ
  if (error) {
    showAuthAlert('login-alert', 'error', 'في مشكلة مع Google: ' + error.message);
  }
}


/* ================================================================
   🚪 القسم الثامن عشر: تسجيل الخروج
   ================================================================ */

/**
 * تسجيل الخروج وإعادة الـ Navbar للحالة الأصلية
 */
async function doLogout() {
  if (!sbClient) return;
  closeUserDropdown();
  await sbClient.auth.signOut();
  currentUser    = null;
  currentProfile = null;
  setNavUser(null, null);
  showPage('home'); // رجّعه للصفحة الرئيسية
}


/* ================================================================
   🏠 القسم التاسع عشر: لوحة التحكم (Dashboard)
   ================================================================ */

/**
 * يحمّل بيانات المستخدم ويملأ لوحة التحكم
 * يجلب الحجوزات والتقييمات أيضاً
 * @param {object} user — بيانات المستخدم من Supabase
 */
async function loadDashboardData(user) {
  if (!sbClient) return;

  // جيب الـ profile من قاعدة البيانات
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

  // ملّي عناصر الصفحة بالبيانات
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('dash-firstname', firstName);
  set('dpf-name',       name);
  set('dpf-email',      user.email || '—');
  set('dpf-phone',      profile?.phone || '—');
  set('dpf-city',       profile?.city  || '—');
  set('dpf-role',       roleLabel);
  set('dpf-date',       dateStr);

  // ملّي حقول التعديل بالقيم الحالية
  const efName  = document.getElementById('ef-name');
  const efPhone = document.getElementById('ef-phone');
  const efCity  = document.getElementById('ef-city');
  if (efName)  efName.value  = name;
  if (efPhone) efPhone.value = profile?.phone || '';
  if (efCity)  efCity.value  = profile?.city  || '';

  // تحديث Badge الدور
  const badge = document.getElementById('dash-role-badge');
  if (badge) {
    badge.textContent = roleLabel;
    badge.className   = 'dash-role-badge' + (profile?.role === 'owner' ? ' owner' : '');
  }

  // تحديث الـ Navbar
  setNavUser(user, profile);

  // جلب الحجوزات والتقييمات
  await loadUserBookings(user.id);
  await loadUserRatings(user.id);
}

/**
 * يُظهر/يُخفي فورم تعديل البيانات الشخصية
 */
function toggleEditProfile() {
  const viewEl = document.getElementById('profile-view');
  const editEl = document.getElementById('profile-edit');
  if (!viewEl || !editEl) return;
  const editing = editEl.style.display !== 'none';
  viewEl.style.display = editing ? 'block' : 'none';
  editEl.style.display = editing ? 'none'  : 'block';
}

/**
 * يحفظ التعديلات على البيانات الشخصية في Supabase
 */
async function saveProfile() {
  if (!sbClient || !currentUser) return;

  const name  = document.getElementById('ef-name')?.value.trim();
  const phone = document.getElementById('ef-phone')?.value.trim();
  const city  = document.getElementById('ef-city')?.value;

  if (!name) { showDashAlert('error', 'من فضلك ادخل اسمك'); return; }

  setBtnLoading('btn-save-profile', true);
  const { error } = await sbClient
    .from('profiles')
    .upsert({ id: currentUser.id, full_name: name, phone, city }, { onConflict: 'id' });
  setBtnLoading('btn-save-profile', false, '💾 حفظ التعديلات');

  if (error) { showDashAlert('error', 'في مشكلة في الحفظ'); return; }

  showDashAlert('success', 'اتحفظت بياناتك بنجاح ✅');
  await loadDashboardData(currentUser);  // تحديث الصفحة بالبيانات الجديدة
  toggleEditProfile();                   // إغلاق فورم التعديل
}

/**
 * يعرض رسالة تنبيه داخل لوحة التحكم
 * تختفي تلقائياً بعد 4 ثوانٍ
 * @param {string} type — نوع الرسالة (error / success)
 * @param {string} msg  — نص الرسالة
 */
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

/**
 * يجلب حجوزات المستخدم من Supabase ويعرضها في لوحة التحكم
 * @param {string} userId — id المستخدم
 */
async function loadUserBookings(userId) {
  if (!sbClient) return;

  const contEl = document.getElementById('dash-bookings');
  const cntEl  = document.getElementById('dash-booking-count');

  try {
    const { data: bookings } = await sbClient
      .from('bookings')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    // تحديث عداد الحجوزات
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

    // خريطة حالات الحجز
    const statusMap = {
      pending:   { label: 'في الانتظار', cls: 'status-pending'   },
      confirmed: { label: 'مؤكد',        cls: 'status-confirmed' },
      cancelled: { label: 'ملغي',        cls: 'status-cancelled' },
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
   ⭐ القسم الواحد والعشرون: تقييمات المستخدم
   ================================================================ */

/**
 * يجلب تقييمات المستخدم من Supabase ويعرضها في لوحة التحكم
 * @param {string} userId — id المستخدم
 */
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

/**
 * يرسل تقييم جديد لـ Supabase
 */
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

  // إعادة ضبط الفورم
  document.getElementById('rating-space-name').value = '';
  document.getElementById('rating-comment').value    = '';
  document.querySelectorAll('.star-btn').forEach(b => b.classList.remove('on'));
  document.getElementById('rating-form-wrap').style.display = 'none';

  // تحديث قائمة التقييمات
  await loadUserRatings(currentUser.id);
}

/**
 * يُفعّل النجوم عند الضغط عليها
 * @param {number}  val — القيمة (1-5)
 * @param {Element} el  — الزرار المضغوط
 */
function selectStar(val, el) {
  const btns = document.querySelectorAll('.star-btn');
  btns.forEach((b, i) => b.classList.toggle('on', i < val));
  // نحفظ القيمة في الزرار الأخير لنقرأها وقت الإرسال
  if (btns[val - 1]) btns[val - 1].dataset.val = val;
}

/**
 * يُظهر/يُخفي فورم إضافة تقييم جديد
 */
function toggleRatingForm() {
  const formEl = document.getElementById('rating-form-wrap');
  if (!formEl) return;
  formEl.style.display = (formEl.style.display === 'none' || !formEl.style.display) ? 'block' : 'none';
}


/* ================================================================
   🛠️ القسم الثاني والعشرون: دوال مساعدة مشتركة
   ================================================================ */

/**
 * يعرض رسالة تنبيه في صفحات Auth (تسجيل الدخول / إنشاء حساب)
 * @param {string} containerId — id الـ container
 * @param {string} type        — نوع الرسالة (error / success / info)
 * @param {string} msg         — نص الرسالة
 */
function showAuthAlert(containerId, type, msg) {
  const icons = { error: '⚠️', success: '✅', info: '💡' };
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="auth-alert auth-alert-${type}">
    <span>${icons[type] || '💡'}</span>
    <span>${msg}</span>
  </div>`;
}

/**
 * يمسح رسالة التنبيه من الـ container
 * @param {string} id — id الـ container
 */
function clearAuthAlert(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

/**
 * يعطّل/يفعّل زرار مع إظهار حالة التحميل
 * @param {string}  id   — id الزرار
 * @param {boolean} on   — true لتعطيل، false لتفعيل
 * @param {string}  orig — النص الأصلي للزرار (لإعادته بعد التحميل)
 */
function setBtnLoading(id, on, orig) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = on;
  if (on)         b.innerHTML = `<span class="spin-sm"></span> جاري التحميل…`;
  else if (orig)  b.innerHTML = orig;
}

/**
 * يُظهر/يُخفي كلمة المرور في حقل الإدخال
 * @param {string} id — id حقل كلمة المرور
 */
function togglePassVis(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}
