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

// المساحة الجاري حجزها — لربط الحجز بصاحب المساحة (نظام التقييمات)
let bookingSpace = null;

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
  subscribeSpacesRealtime();

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
   📊 القسم الرابع: تحميل البيانات من Supabase
   ================================================================ */

async function loadData() {
  showLoadingState('mp-grid');
  try {
    // تحميل الأنشطة
    const { data: activitiesData, error: actErr } = await sbClient
      .from('space_activities')
      .select('id, emoji, name_ar')
      .eq('is_active', true)
      .order('sort_order');
    if (actErr) throw actErr;
    ACTIVITIES = (activitiesData || []).map(a => ({
      id:    a.id,
      label: `${a.emoji || ''} ${a.name_ar}`.trim(),
    }));

    // تحميل المساحات المعتمدة مع وحداتها الفرعية
    const { data: spacesData, error: spacesErr } = await sbClient
      .from('spaces')
      .select('*, space_units(unit_id, name, floor, size, price, status, location, image_url, notes)')
      .eq('status', 'approved')
      .eq('is_active', true)
      .order('sort_order');
    if (spacesErr) throw spacesErr;

    // تحميل باقات أصحاب المساحات
    const ownerIds = [...new Set((spacesData || []).map(s => s.owner_id).filter(Boolean))];
    let profilesMap = {};
    if (ownerIds.length > 0) {
      const { data: profiles } = await sbClient
        .from('profiles')
        .select('id, plan_tier, full_name, avatar_url')
        .in('id', ownerIds);
      (profiles || []).forEach(p => { profilesMap[p.id] = p; });
    }

    SPACES = (spacesData || []).map(row => mapSupabaseToSpaceObject(row, profilesMap));
    _sortByPlan(SPACES);

    buildModalActivityPicker();
    buildMpActivityFilters();

    mpFiltered = [...SPACES];
    renderMarketplace();
    setTimeout(() => csInitAll(), 120);

    const counter = document.getElementById('mp-count');
    if (counter) counter.textContent = SPACES.length + ' مساحة';

  } catch (err) {
    showLoadingState('mp-grid', true, err.message || 'خطأ في تحميل البيانات');
  }
}

function mapSupabaseToSpaceObject(row, profilesMap) {
  profilesMap = profilesMap || {};
  const sizes = row.sizes_prices
    ? row.sizes_prices.split(/[|·]/).map(s => s.trim()).filter(Boolean)
    : [];
  const ownerProfile = (row.owner_id && profilesMap[row.owner_id]) || {};
  const isBroker = row.is_broker || false;
  return {
    id:          row.id,
    ownerId:     row.owner_id    || null,
    name:        row.name        || '',
    loc:         row.region      || '',
    type:        row.type        || '',
    price:       row.min_price   || 0,
    sizes:       sizes,
    acts:        row.activities  || [],
    allActs:     row.all_acts    || false,
    badge:       row.badge       || 'متاح',
    badgeClass:  row.badge_class || 'badge-avail',
    season:      row.season      || '',
    insight:     row.insight     || '',
    image:       row.image_url   || '',
    icon:        row.icon_emoji  || '',
    thumbClass:  row.thumb_color || '',
    extraImages: row.extra_images || [],
    description: row.description || '',
    amenities:   row.amenities   || [],
    isBroker:    isBroker,
    ownerName:   isBroker ? 'مكاني سبوت' : (ownerProfile.full_name || null),
    ownerAvatar: isBroker ? null : (ownerProfile.avatar_url || null),
    planTier:    isBroker ? 'broker' : (ownerProfile.plan_tier || 'starter'),
    subSpaces:   (row.space_units || []).map(u => ({
      unitId:   u.unit_id   || '',
      name:     u.name      || '',
      location: u.location  || '',
      size:     u.size      || '',
      price:    u.price     || 0,
      status:   u.status    || 'available',
      image:    u.image_url || '',
      floor:    u.floor     || '',
      notes:    u.notes     || '',
    })),
  };
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
   🔄 Supabase Realtime — تحديث فوري عند الموافقة على مساحة
   ================================================================ */

/**
 * تحديث صامت للمساحات — بدون spinner وبدون إعادة ضبط الصفحة الحالية
 * يُستدعى من Realtime ومن الـ polling الاحتياطي
 */
async function silentRefreshSpaces() {
  if (document.hidden || !sbClient) return;
  try {
    const { data: spacesData, error } = await sbClient
      .from('spaces')
      .select('*, space_units(unit_id, name, floor, size, price, status, location, image_url, notes)')
      .eq('status', 'approved')
      .eq('is_active', true)
      .order('sort_order');
    if (error || !spacesData) return;

    /* باقات الأصحاب */
    const ownerIds = [...new Set(spacesData.map(s => s.owner_id).filter(Boolean))];
    let profilesMap = {};
    if (ownerIds.length) {
      const { data: profiles } = await sbClient
        .from('profiles').select('id, plan_tier, full_name, avatar_url').in('id', ownerIds);
      (profiles || []).forEach(p => { profilesMap[p.id] = p; });
    }

    SPACES = spacesData.map(row => mapSupabaseToSpaceObject(row, profilesMap));
    _sortByPlan(SPACES);

    /* أعد تطبيق الفلاتر الحالية بدون إعادة ضبط الصفحة */
    const region = document.getElementById('mp-region')?.value  || '';
    const maxVal = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
    const sort   = document.getElementById('mp-sort')?.value    || 'default';
    let data = [...SPACES];
    if (region) data = data.filter(s => s.loc === region);
    if (mpActiveTypes.length) data = data.filter(s => mpActiveTypes.includes(s.type));
    data = data.filter(s => (parseInt(s.price) || 0) <= maxVal);
    if (mpActiveActs.length) {
      data = data.filter(s => s.allActs || (s.acts && mpActiveActs.some(a => s.acts.includes(a))));
    }
    if (sort === 'price-asc')  data.sort((a, b) => a.price - b.price);
    if (sort === 'price-desc') data.sort((a, b) => b.price - a.price);
    mpFiltered = data;

    /* احتفظ بالصفحة الحالية — فقط صحّح لو أصبحت خارج النطاق */
    const maxPage = Math.max(1, Math.ceil(mpFiltered.length / MP_PER_PAGE));
    if (mpPage > maxPage) mpPage = maxPage;

    renderMarketplace();
    const counter = document.getElementById('mp-count');
    if (counter) counter.textContent = SPACES.length + ' مساحة';
  } catch { /* صامت — لو الشبكة منقطعة */ }
}

function subscribeSpacesRealtime() {
  if (!sbClient) return;
  let debounce = null;
  sbClient.channel('spaces-public-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(silentRefreshSpaces, 1500);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'space_units' }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(silentRefreshSpaces, 1500);
    })
    .subscribe();
  /* Fallback polling كل 5 دقائق — لو انقطع الـ Realtime */
  setInterval(silentRefreshSpaces, 300000);
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


/* ── نظام الباقات والبادجيات ── */

function _sortByPlan(arr) {
  const ord = { pro: 0, growth: 1, starter: 2 };
  arr.sort((a, b) => (ord[a.planTier] ?? 2) - (ord[b.planTier] ?? 2));
  return arr;
}

function _planTrustBadgeHtml(s) {
  if (s.isBroker) return `<span class="card-trust-badge trust-broker">🏛️ بروكر</span>`;
  const tier = (s.planTier || 'starter').toLowerCase();
  if (tier === 'pro')    return `<span class="card-trust-badge trust-partner">🏆 شريك معتمد</span>`;
  if (tier === 'growth') return `<span class="card-trust-badge trust-verified">✓ موثّق</span>`;
  return '';
}

function _planCardClass(s) {
  return (s.planTier || 'starter') === 'pro' ? ' space-card--pro' : '';
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
              onclick="event.stopPropagation();openSpaceDetail('${s.id}','${fromPage}')">
         تفاصيل ←
       </button>`
    : '';

  const availableUnits = (s.subSpaces || []).filter(u => u.status === 'available' || !u.status).length;
  const unitsBadgeHtml = s.subSpaces && s.subSpaces.length > 0
    ? `<span class="units-badge">${availableUnits} وحدة متاحة</span>`
    : '';

  const _spaceNameSafe = (s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const _shareSpaceBtn = `<button class="share-btn" onclick="event.stopPropagation();shareCard('space','${s.id}','${_spaceNameSafe}')" title="مشاركة المساحة"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;
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
          <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                  onclick="openBooking('${s.id}')">احجز دلوقتي ←</button>
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
                    onclick="openBooking('${s.id}')">احجز دلوقتي ←</button>
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

      ${(s.isBroker || s.ownerName) ? (() => {
        const isBroker = s.isBroker;
        const name     = isBroker ? 'مكاني سبوت' : (s.ownerName || 'صاحب المساحة');
        const roleLabel = isBroker
          ? 'بروكر معتمد'
          : (s.planTier === 'pro' ? 'شريك معتمد' : s.planTier === 'growth' ? 'صاحب مساحة موثّق' : 'صاحب المساحة');
        const badgeCls  = isBroker ? 'trust-broker' : s.planTier === 'pro' ? 'trust-partner' : s.planTier === 'growth' ? 'trust-verified' : '';
        const badgeHtml = badgeCls ? `<span class="sd-trust-badge ${badgeCls}" style="margin-top:4px">${roleLabel}</span>` : `<span class="sd-owner-role">${roleLabel}</span>`;
        const avatarHtml = s.ownerAvatar
          ? `<img src="${s.ownerAvatar}" alt="${name}" class="sd-owner-avatar" onerror="this.outerHTML='<div class=sd-owner-avatar-placeholder${isBroker?' broker':''}>${name[0]}</div>'">`
          : `<div class="sd-owner-avatar-placeholder${isBroker ? ' broker' : ''}">${isBroker ? '🏛️' : name[0]}</div>`;
        return `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">👤 صاحب المساحة</div>
        <div class="sd-owner-card" style="margin-top:10px">
          ${avatarHtml}
          <div class="sd-owner-info">
            <div class="sd-owner-name">${name}</div>
            ${badgeHtml}
          </div>
        </div>
      </div>`;
      })() : ''}
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
        <button class="btn btn-primary" style="margin-top:16px" onclick="openBooking('${s.id}')">
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
                         onclick="openBookingForUnit('${s.id}','${unit.unitId}')">
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
  bookingSpace = s;   // ربط الحجز بالمساحة وصاحبها (نظام التقييمات)

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

  /* ── اكتشاف امتلاء المساحة → وضع قائمة الانتظار ── */
  const availCount = (s.subSpaces || []).filter(u => u.status === 'available' || !u.status).length;
  const isFull     = (s.subSpaces || []).length > 0 && availCount === 0;
  bookingSpace.isWaitlist = isFull;
  _applyWaitlistMode(isFull);

  document.getElementById('modal-form-wrap').style.display = 'block';
  document.getElementById('modal-success').style.display   = 'none';
  document.getElementById('bk-error').style.display        = 'none';
  ['bk-other-act', 'bk-notes', 'bk-profile-link'].forEach(id => {
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

/* تبديل واجهة المودال بين الحجز العادي وقائمة الانتظار */
function _applyWaitlistMode(isWaitlist) {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? 'block' : 'none'; };
  const set  = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  show('bk-waitlist-banner', isWaitlist);
  show('bk-profile-wrap',    isWaitlist);

  set('bk-modal-title', isWaitlist ? 'انضم لقائمة الانتظار ⏳' : 'احجز مساحتك');
  set('bk-modal-sub',   isWaitlist
        ? 'كل الوحدات محجوزة — سيتواصل معك المالك فور توفّر وحدة'
        : 'سنتواصل معك خلال ٢٤ ساعة لإتمام الترتيبات');

  const btn = document.getElementById('bk-submit-btn');
  if (btn) btn.innerHTML = isWaitlist ? 'سجّلني في قائمة الانتظار ←' : 'ابعت طلب الحجز ←';
}

/* ================================================================
   📅 حجز المعاينة — Viewing System
   ================================================================ */

let _viewingSpaceId = null;

function openViewing(spaceId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;
  _viewingSpaceId = spaceId;

  // بيانات المساحة في الموديل
  document.getElementById('vm-space-name').textContent = s.name || '—';
  document.getElementById('vm-space-loc').textContent  = s.loc  ? '📍 ' + s.loc : '—';

  // تعبئة الاسم والموبايل لو المستخدم مسجل
  if (currentUser) {
    const nameEl  = document.getElementById('vm-name');
    const phoneEl = document.getElementById('vm-phone');
    if (nameEl)  nameEl.value  = currentProfile?.full_name || currentUser.user_metadata?.full_name || '';
    if (phoneEl) phoneEl.value = currentProfile?.phone || '';
  } else {
    ['vm-name', 'vm-phone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  // تاريخ افتراضي = بكره
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateEl = document.getElementById('vm-date');
  if (dateEl) {
    dateEl.min   = tomorrow.toISOString().split('T')[0];
    dateEl.value = '';
  }

  // إظهار الفورم وإخفاء النجاح
  document.getElementById('vm-form-wrap').style.display = 'block';
  document.getElementById('vm-success').style.display   = 'none';
  document.getElementById('vm-error').style.display     = 'none';

  document.getElementById('visit-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeViewingModal() {
  document.getElementById('visit-modal').classList.remove('open');
  document.body.style.overflow = '';
  _viewingSpaceId = null;
}

function closeViewingOnBg(e) {
  if (e.target === document.getElementById('visit-modal')) closeViewingModal();
}

async function submitViewing() {
  const name  = document.getElementById('vm-name').value.trim();
  const phone = document.getElementById('vm-phone').value.trim();
  const date  = document.getElementById('vm-date').value;

  const errEl = document.getElementById('vm-error');
  const show  = msg => { errEl.textContent = '⚠ ' + msg; errEl.style.display = 'block'; };

  if (!name)  { show('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    show('من فضلك ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  errEl.style.display = 'none';

  const btn = document.getElementById('vm-submit-btn');
  btn.innerHTML = '⏳ جاري الإرسال…';
  btn.disabled  = true;

  const s = SPACES.find(x => x.id === _viewingSpaceId);
  const payload = {
    type:      'viewing',
    name, phone,
    spaceName: s?.name || '',
    spaceLoc:  s?.loc  || '',
    date,
    userId:    currentUser?.id || '',
    viewingId: crypto.randomUUID(),
  };

  try {
    // إرسال لـ Google Sheets (نفس رابط الحجز)
    try {
      await fetch(BOOKING_URL, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      });
    } catch (_) {}

    // حفظ في Supabase لو مسجل
    if (sbClient && currentUser) {
      await sbClient.from('bookings').insert({
        id:         payload.viewingId,
        user_id:    currentUser.id,
        space_name: payload.spaceName,
        space_loc:  payload.spaceLoc,
        activity:   'معاينة',
        duration:   'معاينة - 150 ج',
        start_date: date || null,
        notes:      'طلب معاينة — ١٥٠ ج.م.',
        status:     'viewing_pending',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    document.getElementById('vm-form-wrap').style.display = 'none';
    document.getElementById('vm-success').style.display   = 'block';

  } catch (err) {
    btn.innerHTML = 'تأكيد طلب المعاينة ←';
    btn.disabled  = false;
    show('في مشكلة في الإرسال — تأكد من الاتصال بالإنترنت وحاول تاني');
  }
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
  const isWaitlist  = !!bookingSpace?.isWaitlist;
  const profileLink = (document.getElementById('bk-profile-link')?.value || '').trim();

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
    isWaitlist,
    profileLink,
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
        id:           bookingId,
        user_id:      currentUser.id,
        owner_id:     bookingSpace?.ownerId || null,   // ربط بصاحب المساحة (نظام التقييمات)
        space_id:     bookingSpace?.id || null,         // ربط بالمساحة
        space_name:   spaceName,
        space_loc:    spaceLoc,
        price:        spacePrice,
        activity:     payload.activity,
        size,
        duration:     dur,
        start_date:   date,
        notes,
        is_waitlist:  isWaitlist,                       // قائمة انتظار عند امتلاء المساحة
        profile_link: profileLink || null,              // رابط بروفايل النشاط (اختياري)
        status:       'pending',
        created_at:   now,
        updated_at:   now,
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

    /* رسالة نجاح مخصّصة لقائمة الانتظار */
    const sTitle = document.getElementById('bk-success-title');
    const sBody  = document.getElementById('bk-success-body');
    if (isWaitlist) {
      if (sTitle) sTitle.innerHTML = 'تم تسجيلك في <span>قائمة الانتظار!</span>';
      if (sBody)  sBody.innerHTML  = 'سيتواصل معك صاحب المكان فور توفّر وحدة مناسبة.<br>طلبك محفوظ ضمن قائمة انتظار <strong>' + (spaceName || 'المساحة') + '</strong>.';
    } else {
      if (sTitle) sTitle.innerHTML = 'اتبعت طلبك <span>بنجاح!</span>';
      if (sBody)  sBody.innerHTML  = 'شكراً ليك — اتستلم طلب الحجز.<br>فريق <strong>مكاني Spot</strong> هيتواصل معاك في <strong style="color:var(--orange)">٢٤ ساعة</strong>.';
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
  if (p === 'market' || p === 'space-detail') {
    document.getElementById('nsb-spaces')?.classList.add('active');
  }
  if (p === 'market') {
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
