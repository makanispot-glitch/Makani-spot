/* ================================================================
   📁 spaces/app.js — صفحة المساحات المستقلة
   ================================================================
   هذا الملف مسؤول عن كل وظائف صفحة المساحات المستقلة:
     - تحميل بيانات المساحات من Google Sheets
     - عرض الكروت والفلاتر (الماركت بليس)
     - صفحة تفاصيل المساحة الرئيسية + المساحات الفرعية
     - مودال الحجز وإرسال البيانات
     - نظام تسجيل الدخول عبر Supabase
   ================================================================ */


/* ================================================================
   ⚙️ القسم الأول: إعدادات وروابط المنصة
   ================================================================ */

const SHEET_URL   = "https://script.google.com/macros/s/AKfycbwNGSGQXZjQeG1i-3DSiUdHKQJQq7JGBFNuXx0deVfJB1b2jGkxDRRI2SIgWwvU900tsQ/exec";
const BOOKING_URL = "https://script.google.com/macros/s/AKfycbzZPnqZ4hjy8nzzGDcrQUpJK_pZn01lGIJXL-EfScxpGISLMjo6wL6xCLqNMviBpD69/exec";

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';


/* ================================================================
   🗄️ القسم الثاني: المتغيرات العامة
   ================================================================ */

let SPACES         = [];
let ACTIVITIES     = [];
let sbClient       = null;
let currentUser    = null;
let currentProfile = null;

// ── متغيرات الماركت بليس ──
let mpPage        = 1;
const MP_PER_PAGE = 12;
let mpFiltered    = [];
let mpActiveTypes = [];
let mpActiveActs  = [];

// ── متغيرات صفحة تفاصيل المساحة ──
let currentSpaceDetail = null;
let detailPrevPage     = 'market';

// ── نظام الـ Slider ──
const _sliders = {};
const CS_AUTO_DELAY = 3800;
const SD_AUTO_DELAY = 4500;


/* ================================================================
   🚀 القسم الثالث: نقطة البداية
   ================================================================ */

document.addEventListener('DOMContentLoaded', function () {

  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.warn('⚠️ Supabase غير محمّل بعد');
  }

  loadData();
  initAuth();

  // تهيئة مؤشر سعر الماركت بعد لحظة
  setTimeout(initMpSlider, 150);

  // Deep link: فتح مساحة مباشرة عبر ?space=ID
  const params  = new URLSearchParams(window.location.search);
  const spaceId = params.get('space');
  const unitId  = params.get('unit');
  if (spaceId) {
    // ننتظر تحميل البيانات ثم نفتح التفاصيل
    const _tryOpen = setInterval(() => {
      const s = SPACES.find(x => String(x.id) === String(spaceId));
      if (s) {
        clearInterval(_tryOpen);
        openSpaceDetail(s.id, 'market');
        if (unitId) {
          setTimeout(() => {
            const notesEl = document.getElementById('bk-notes');
            if (notesEl) notesEl.value = `الوحدة المطلوبة: ${unitId}`;
          }, 600);
        }
      }
    }, 300);
    // وقف الانتظار بعد 8 ثواني إذا لم تُحمَّل البيانات
    setTimeout(() => clearInterval(_tryOpen), 8000);
  }
});


/* ================================================================
   📊 القسم الرابع: تحميل البيانات من Google Sheets
   ================================================================ */

async function loadData() {
  showLoadingState('mp-grid');
  try {
    const res  = await fetch(SHEET_URL);
    const json = await res.json();

    if (json.status !== "ok") throw new Error(json.message || "خطأ في قراءة الشيت");

    ACTIVITIES = json.activities || [];
    SPACES     = json.spaces     || [];

    buildModalActivityPicker();
    buildMpActivityFilters();

    // عرض الماركت بليس فوراً
    mpFiltered = [...SPACES];
    renderMarketplace();
    setTimeout(() => csInitAll(), 120);

    const counter = document.getElementById('mp-count');
    if (counter) counter.textContent = SPACES.length + ' مساحة';

  } catch (err) {
    showLoadingState('mp-grid', true, err.message);
  }
}

function showLoadingState(gridId, isError, msg) {
  const grid = document.getElementById(gridId || 'mp-grid');
  if (!grid) return;
  if (isError) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:18px">⚠️</div>
        <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:8px">في مشكلة في تحميل البيانات</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:22px;max-width:400px;margin-inline:auto">${msg || ''}</div>
        <button class="btn btn-primary" onclick="loadData()">🔄 حاول تاني</button>
      </div>`;
    return;
  }
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px;display:inline-block;animation:spin 1.2s linear infinite">⏳</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:6px">جاري تحميل البيانات…</div>
      <div style="font-size:13px;color:var(--ink3)">لحظة صغيرة…</div>
    </div>`;
}


/* ================================================================
   🏷️ القسم الخامس: بناء فلاتر الأنشطة
   ================================================================ */

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
   🃏 القسم السادس: بناء وعرض كروت المساحات
   ================================================================ */

function buildCardHtml(s, fromPage) {
  fromPage = fromPage || 'market';

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

  const _spaceNameSafe = (s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const _shareSpaceBtn = `<button class="share-btn" onclick="event.stopPropagation();shareCard('space',${s.id},'${_spaceNameSafe}')" title="مشاركة المساحة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;

  return `
  <div class="space-card">
    <div class="card-thumb">
      ${thumbHtml}
      <span class="card-badge ${s.badgeClass || 'badge-avail'}">${s.badge || 'متاح'}</span>
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

function renderCards(data, gridId, showViewAll, fromPage) {
  const grid = document.getElementById(gridId || 'mp-grid');
  if (!grid) return;
  fromPage = fromPage || 'market';

  if (!data.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:70px 20px;color:var(--ink2)">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">مش لاقيين مساحات بالمعايير دي</div>
        <div style="font-size:14px">جرب تغيير النشاط أو المنطقة أو السعر</div>
      </div>`;
    return;
  }

  grid.innerHTML = data.map(s => buildCardHtml(s, fromPage)).join('');
}


/* ================================================================
   🏢 القسم السابع: صفحة تفاصيل المساحة
   ================================================================ */

function openSpaceDetail(spaceId, fromPage) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  currentSpaceDetail = s;
  detailPrevPage = fromPage || 'market';

  const headerEl = document.getElementById('sd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeSpaceDetail()">
            → العودة
          </button>
          <div class="sd-breadcrumb">
            <span onclick="window.location.href='/'" style="cursor:pointer">الرئيسية</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="showPage('market')" style="cursor:pointer">المساحات</span>
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

  _renderDetailGallery(s);
  _renderDetailInfo(s);
  _renderSubSpaces(s);

  showPage('space-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function closeSpaceDetail() {
  if (currentSpaceDetail) {
    _sdCleanup(`detail-${currentSpaceDetail.id}`);
  }
  const prevPage = detailPrevPage || 'market';
  currentSpaceDetail = null;
  detailPrevPage = 'market';
  showPage(prevPage);
}

function _renderDetailGallery(s) {
  const galleryEl = document.getElementById('sd-gallery');
  if (!galleryEl) return;

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

  if (!allImages.length) {
    galleryEl.innerHTML = `
      <div class="sd-gallery-placeholder">
        <div style="font-size:64px;opacity:0.25">${s.icon || '🏪'}</div>
        <div style="font-size:13px;color:var(--ink3);margin-top:10px">لا توجد صور متاحة</div>
      </div>`;
    return;
  }

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

  const thumbsHtml = allImages.map((img, i) => `
    <div class="sd-thumb-item${i === 0 ? ' sd-thumb-on' : ''}"
         data-thumb-index="${i}"
         onclick="sdGoTo('${detailSliderId}',${i})">
      <img src="${img.url}" alt="${img.caption}" loading="lazy"
           onerror="this.parentElement.style.display='none'">
    </div>`).join('');

  galleryEl.innerHTML = `
    <div class="sd-gallery-wrap">
      <div class="sd-slider" id="${detailSliderId}"
           onmouseenter="sdPause('${detailSliderId}')"
           onmouseleave="sdResume('${detailSliderId}')">
        <div class="sd-slides-track">${slidesHtml}</div>
        <button class="sd-arrow sd-arrow-next"
                onclick="event.stopPropagation();sdNext('${detailSliderId}')"
                title="الصورة التالية">&#8250;</button>
        <button class="sd-arrow sd-arrow-prev"
                onclick="event.stopPropagation();sdPrev('${detailSliderId}')"
                title="الصورة السابقة">&#8249;</button>
        <div class="sd-counter" id="${detailSliderId}-counter">1 / ${allImages.length}</div>
        <div class="sd-dots" id="${detailSliderId}-dots">${dotsHtml}</div>
      </div>
      <div class="sd-thumbs-row" id="${detailSliderId}-thumbs">
        ${thumbsHtml}
      </div>
    </div>`;

  _sdInit(detailSliderId, allImages.length);
}

function _renderDetailInfo(s) {
  const infoEl = document.getElementById('sd-info');
  if (!infoEl) return;

  const actsHtml = s.allActs
    ? '<span class="act-tag act-tag-all">✓ يصلح لجميع الأنشطة</span>'
    : (s.acts || []).map(id => {
        const a = ACTIVITIES.find(x => x.id === id);
        return a ? `<span class="act-tag">${a.label}</span>` : '';
      }).join('');

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

function _typeLabel(type) {
  return { mall: '🏬 مول تجاري', club: '⚽ نادي رياضي', school: '🏫 مدرسة' }[type] || type;
}


/* ================================================================
   📋 القسم الثامن: فتح مودال الحجز لوحدة فرعية
   ================================================================ */

function openBookingForUnit(spaceId, unitId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  openBooking(spaceId);

  setTimeout(() => {
    const notesEl = document.getElementById('bk-notes');
    if (notesEl && unitId) {
      notesEl.value = `الوحدة المطلوبة: ${unitId}`;
    }
    const metaEl = document.getElementById('msi-meta');
    if (metaEl) {
      metaEl.insertAdjacentHTML('beforeend',
        ` · <strong style="color:var(--orange)">وحدة ${unitId}</strong>`);
    }
  }, 50);
}


/* ================================================================
   🛍️ القسم التاسع: صفحة الماركت بليس (الفلاتر والعرض)
   ================================================================ */

function goToMarketplace() {
  showPage('market');
  mpPage        = 1;
  mpActiveTypes = [];
  mpActiveActs  = [];
  mpFiltered    = [...SPACES];

  const s2 = document.getElementById('mp-slider-max');
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
  const maxVal = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
  const sort   = document.getElementById('mp-sort')?.value || 'default';

  let data = [...SPACES];

  if (region) data = data.filter(s => s.loc === region);
  if (mpActiveTypes.length) data = data.filter(s => mpActiveTypes.includes(s.type));
  data = data.filter(s => {
    const p = parseInt(s.price) || 0;
    return p >= 0 && p <= maxVal;
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

  const maxVal    = parseInt(s2.value);
  const RANGE_MAX = parseInt(s2.max) || 50000;
  const pMax      = (maxVal / RANGE_MAX) * 100;

  const track = document.getElementById('mp-slider-track');
  if (track) {
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
   🎠 القسم العاشر: نظام الـ Slider للصور
   ================================================================ */

/* ── Slider الكروت ── */

function csInitAll() {
  document.querySelectorAll('.card-slider').forEach(el => {
    const id = el.dataset.slider;
    if (!id || _sliders[id]) return;
    const slides = el.querySelectorAll('.cs-slide');
    if (!slides.length) return;
    _sliders[id] = { index: 0, total: slides.length, autoTimer: null, paused: false };
    _csStartAuto(id);
    _csInitSwipe(el, id);
  });
}

function csGoTo(id, idx) {
  const el = document.getElementById(id);
  if (!el || !_sliders[id]) return;
  const state = _sliders[id];
  state.index = (idx + state.total) % state.total;
  el.querySelectorAll('.cs-slide').forEach((s, i) =>
    s.classList.toggle('cs-active', i === state.index));
  el.querySelectorAll('.cs-dot').forEach((d, i) =>
    d.classList.toggle('cs-dot-on', i === state.index));
}

function csNext(id) { csGoTo(id, (_sliders[id]?.index ?? 0) + 1); }
function csPrev(id) { csGoTo(id, (_sliders[id]?.index ?? 0) - 1); }

function csPause(id) {
  if (_sliders[id]) {
    _sliders[id].paused = true;
    clearInterval(_sliders[id].autoTimer);
  }
}

function csResume(id) {
  if (_sliders[id] && !_sliders[id].paused) return;
  if (_sliders[id]) {
    _sliders[id].paused = false;
    _csStartAuto(id);
  }
}

function _csStartAuto(id) {
  if (!_sliders[id]) return;
  clearInterval(_sliders[id].autoTimer);
  _sliders[id].autoTimer = setInterval(() => {
    if (!_sliders[id]?.paused) csNext(id);
  }, CS_AUTO_DELAY);
}

function _csInitSwipe(el, id) {
  let startX = 0, startY = 0;
  el.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    const dy = Math.abs(e.changedTouches[0].clientY - startY);
    if (Math.abs(dx) > 40 && dy < 60) {
      dx < 0 ? csNext(id) : csPrev(id);
      csPause(id);
      setTimeout(() => csResume(id), 3000);
    }
  }, { passive: true });
}

/* ── Slider صفحة التفاصيل ── */

function _sdInit(id, total) {
  _sliders[id] = { index: 0, total, autoTimer: null, paused: false };
  const el = document.getElementById(id);
  if (!el) return;
  _sdStartAuto(id);
  _sdInitSwipe(el, id);
}

function sdGoTo(id, idx) {
  const el = document.getElementById(id);
  if (!el || !_sliders[id]) return;
  const state = _sliders[id];
  state.index = (idx + state.total) % state.total;

  el.querySelectorAll('.sd-slide').forEach((s, i) =>
    s.classList.toggle('sd-slide-active', i === state.index));

  const dotsEl = document.getElementById(`${id}-dots`);
  if (dotsEl) {
    dotsEl.querySelectorAll('.sd-dot').forEach((d, i) =>
      d.classList.toggle('sd-dot-on', i === state.index));
  }

  const thumbsEl = document.getElementById(`${id}-thumbs`);
  if (thumbsEl) {
    thumbsEl.querySelectorAll('.sd-thumb-item').forEach((t, i) =>
      t.classList.toggle('sd-thumb-on', i === state.index));
    const activeThumb = thumbsEl.querySelector('.sd-thumb-on');
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }

  const counterEl = document.getElementById(`${id}-counter`);
  if (counterEl) counterEl.textContent = `${state.index + 1} / ${state.total}`;
}

function sdNext(id) { sdGoTo(id, (_sliders[id]?.index ?? 0) + 1); }
function sdPrev(id) { sdGoTo(id, (_sliders[id]?.index ?? 0) - 1); }

function sdPause(id) {
  if (_sliders[id]) {
    _sliders[id].paused = true;
    clearInterval(_sliders[id].autoTimer);
  }
}

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

function _sdCleanup(id) {
  if (_sliders[id]) {
    clearInterval(_sliders[id].autoTimer);
    delete _sliders[id];
  }
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

  const spaceName  = document.getElementById('msi-name').textContent;
  const metaText   = document.getElementById('msi-meta').textContent;
  const locMatch   = metaText.match(/📍\s*([^·]+)/);
  const priceMatch = metaText.match(/([\d,٠-٩]+\s*ج)/);
  const spaceLoc   = locMatch   ? locMatch[1].trim() : '';
  const spacePrice = priceMatch ? priceMatch[1].trim() : '';

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
    try {
      await fetch(BOOKING_URL, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (_) {}

    if (sbClient && currentUser) {
      await sbClient.from('bookings').insert({
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
        updated_at: now,
      });

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
    }

    document.getElementById('modal-form-wrap').style.display = 'none';
    document.getElementById('modal-success').style.display   = 'block';

  } catch (err) {
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
   🗺️ القسم الثاني عشر: التنقل بين الصفحات
   ================================================================ */

function showPage(p) {
  // صفحات خارجية — التوجيه للمنصة الرئيسية
  if (p === 'home')      { window.location.href = '/';             return; }
  if (p === 'how')       { window.location.href = '/?p=how';       return; }
  if (p === 'owner')     { window.location.href = '/?p=owner';     return; }
  if (p === 'dashboard') { window.location.href = '/?p=dashboard'; return; }
  if (p === 'bazaars')   { window.location.href = '/bazaars/';     return; }

  // الصفحات المحلية: market / space-detail / login / signup / confirm
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');

  // تحديث الـ Nav
  document.querySelectorAll('.nav-section-btn').forEach(b => b.classList.remove('active'));
  if (p === 'market') {
    document.getElementById('nsb-spaces')?.classList.add('active');
    setTimeout(initMpSlider, 120);
    if (SPACES.length && !mpFiltered.length) {
      mpFiltered = [...SPACES];
      renderMarketplace();
    }
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function goToLogin() { showPage('login'); }

function goToOwnerDashboard() {
  window.location.href = '/dashboard/';
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
    } else {
      setNavUser(null, null);
    }
  } catch (_) {
    setNavUser(null, null);
  }

  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      setNavUser(session.user, profile);

      const isOnAuthPage = ['pg-login', 'pg-signup'].some(
        id => document.getElementById(id)?.classList.contains('active')
      );

      if (isOnAuthPage) {
        // بعد تسجيل الدخول من auth pages، روّح للماركت
        showPage('market');
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
}


/* ================================================================
   🔽 القسم الرابع عشر: القائمة المنسدلة للمستخدم
   ================================================================ */

function toggleUserDropdown() {
  const btn = document.getElementById('nav-avatar-btn');
  const dd  = document.getElementById('nav-dropdown');
  if (!btn || !dd) return;
  dd.classList.contains('open')
    ? (btn.classList.remove('open'), dd.classList.remove('open'))
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

  // بعد تسجيل الدخول، ارجع للماركت
  showPage('market');
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
      emailRedirectTo: window.location.origin + '/spaces/',
      data: { full_name: name, phone, role, city }
    }
  });

  setBtnLoading('btn-signup-submit', false, 'إنشاء حساب ←');

  if (error) {
    const msgs = {
      'User already registered':                  'البريد ده مسجّل بالفعل — سجّل دخولك',
      'Password should be at least 6 characters': 'كلمة المرور قصيرة — لازم ٦ أحرف على الأقل',
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
      redirectTo: window.location.origin + '/spaces/'
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
  setNavUser(null, null);
  showPage('market');
}


/* ================================================================
   🛠️ القسم التاسع عشر: دوال مساعدة مشتركة
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
  if (on)        b.innerHTML = `<span class="spin-sm"></span> جاري التحميل…`;
  else if (orig) b.innerHTML = orig;
}

function togglePassVis(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}


/* ================================================================
   📱 القسم العشرون: Bottom Navigation
   ================================================================ */

function updateBottomNav(page) {
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('bn-' + page);
  if (el) el.classList.add('active');
}

async function handleBnUser() {
  updateBottomNav('user');

  if (currentUser) {
    // مستخدم مسجّل — روّح للداشبورد في المنصة الرئيسية
    window.location.href = '/?p=dashboard';
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
        window.location.href = '/?p=dashboard';
        return;
      }
    } catch (_) {}
  }

  showPage('login');
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
   🔗 القسم الحادي والعشرون: مشاركة المساحات
   ================================================================ */

function shareCard(type, id, name) {
  const base = window.location.origin + '/spaces/';
  let url, shareText;

  if (type === 'space') {
    url       = base + '?space=' + id;
    shareText = 'شوف المساحة دي على مكاني Spot: ' + name;
  } else if (type === 'unit') {
    const parts = String(id).split(':');
    url       = base + '?space=' + parts[0] + '&unit=' + encodeURIComponent(parts[1] || '');
    shareText = 'شوف الوحدة دي على مكاني Spot: ' + name;
  } else {
    url       = base + '?space=' + id;
    shareText = 'شوف المساحة دي على مكاني Spot: ' + name;
  }

  if (navigator.share) {
    navigator.share({ title: 'مكاني Spot', text: shareText, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(()  => _showShareToast('✅ تم نسخ الرابط!'))
      .catch(() => _showShareToast('📋 الرابط: ' + url));
  }
}

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
