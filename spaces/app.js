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

/* BOOKING_URL/SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js — لا تكتب Google Sheets بعد الآن */

/* ══════════════════════════════════════════════════════
   📊  SPACE ANALYTICS TRACKING (spaces/)
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
   ================================================================ */

let ACTIVITIES     = [];
let sbClient       = null;
let currentUser    = null;
let currentProfile = null;
let currentAvatarUrl = null;

// ── متغيرات الماركت بليس — بحث/فلترة/ترتيب/ترقيم خادمي عبر searchPublicSpaces (RPC) ──
let mpPage           = 1;
const MP_PER_PAGE    = 12;
let mpCurrentSpaces  = [];   // مساحات الصفحة الحالية (من الخادم)
let mpTotalCount     = 0;    // إجمالي المطابق فعليًا في القاعدة
let annCurrentFiltered = []; // الإعلانات بعد الفلترة المحلية (مجموعة صغيرة، تُدار من الأدمن)

const PLACE_TYPES = [
  { id: 'mall',            label: '🏬 مول تجاري' },
  { id: 'admin_mall',      label: '🏢 مول إداري' },
  { id: 'club',            label: '⚽ نادي رياضي' },
  { id: 'school',          label: '🏫 مدرسة' },
  { id: 'hospital',        label: '🏥 مستشفى' },
  { id: 'gov_entity',      label: '🏛 جهة حكومية' },
  { id: 'company',         label: '💼 شركة' },
  { id: 'university',      label: '🎓 جامعة' },
  { id: 'youth_center',    label: '🤸 مركز شباب' },
  { id: 'edu_institution', label: '📚 مؤسسة تعليمية' },
  { id: 'admin_building',  label: '🏗 مبنى إداري' },
  { id: 'outlet',          label: '🛒 منفذ بيع' },
  { id: 'facility',        label: '🏭 منشأة حكومية' },
];

// ── متغيرات صفحة تفاصيل المساحة ──
let currentSpaceDetail = null;
let detailPrevPage     = 'market';

// المساحة الجاري حجزها — لربط الحجز بصاحب المساحة (نظام التقييمات)
let bookingSpace = null;

// ── الإعلانات الرسمية والمناقصات ──
let ANNOUNCEMENTS    = [];
let mpContentFilter  = 'all';    // 'all' | 'spaces' | 'announcements'
let currentAnnDetail = null;

// ── نظام الـ Slider ──
const _sliders = {};
const CS_AUTO_DELAY = 3800;
const SD_AUTO_DELAY = 4500;


/* ================================================================
   📊 Google Analytics 4 — تتبع الأحداث
   ================================================================ */

function trackEvent(eventName, params = {}) {
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
}


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

  // إعادة رسم المحتوى الديناميكي عند تبديل اللغة — data-i18n بيغطي النص
  // الثابت بس، الكروت/صفحة التفاصيل مبنيين بـ t() وقت البناء فمحتاجين
  // إعادة رسم فعلية (من البيانات المحفوظة locally، بدون طلب Supabase تاني)
  // عشان التبديل يفضل سلس وسريع زي ما هو مطلوب — لا reload.
  document.addEventListener('makani:locale-changed', () => {
    renderMarketplace();
    _updateResultsCounter();
    if (currentSpaceDetail) {
      openSpaceDetail(currentSpaceDetail.id, detailPrevPage);
    } else if (currentAnnDetail) {
      _renderAnnDetail(currentAnnDetail);
    }
  });

  // ESC لإغلاق الـ lightbox
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const lb = document.getElementById('ann-lightbox');
      if (lb && lb.style.display === 'flex') { lb.style.display = 'none'; document.body.style.overflow = ''; }
    }
  });

  // تهيئة مؤشر سعر الماركت بعد لحظة
  setTimeout(initMpSlider, 150);

  // Deep link: فتح مساحة مباشرة عبر ?space=ID — openSpaceDetail يجلبها مباشرة
  // بالمعرّف لو لم تكن ضمن الصفحة الحالية، فلا حاجة لانتظار/استطلاع دوري
  const params  = new URLSearchParams(window.location.search);
  const spaceId = params.get('space');
  const unitId  = params.get('unit');
  const autoBook = params.get('book') === '1';   // قادم من زر «احجز» في الصفحة الرئيسية
  if (spaceId) {
    openSpaceDetail(spaceId, 'market').then(() => {
      if (unitId) {
        setTimeout(() => {
          const notesEl = document.getElementById('bk-notes');
          if (notesEl) notesEl.value = `الوحدة المطلوبة: ${unitId}`;
        }, 600);
      }
      // فتح نموذج الحجز مباشرة (يطبّق بوابة الدخول داخلياً إن لم يكن مسجلاً)
      if (autoBook) setTimeout(() => openBooking(spaceId), 650);
    });
  }
});

/* يبحث عن مساحة فيما هو معروض حاليًا (شبكة الماركت بليس)، وإلا يجلبها مباشرة
   بالمعرّف — مصدر واحد لكل أزرار الإجراء السريع (تفاصيل/حجز) */
async function findOrFetchSpace(spaceId) {
  return mpCurrentSpaces.find(x => x.id === spaceId) || await fetchSpaceById(sbClient, spaceId);
}


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

    // تحميل الإعلانات الرسمية النشطة (بدون فلتر الموعد — الإخفاء يدوي من الأدمن)
    const { data: annData } = await sbClient
      .from('official_announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    ANNOUNCEMENTS = (annData || []).map(mapAnnouncementObject);

    buildModalActivityPicker();
    buildMpActivityFilters();

    // المساحات المنشورة تُجلب خادميًا (بحث/فلترة/ترتيب/ترقيم — shared/space-model.js)
    await _applyCurrentFilters();
    setTimeout(() => csInitAll(), 120);

  } catch (err) {
    showLoadingState('mp-grid', true, err.message || 'خطأ في تحميل البيانات');
  }
}

/* mapSupabaseToSpaceObject انتقلت إلى shared/space-model.js باسم mapSpaceRow */

function mapAnnouncementObject(row) {
  // imageUrls: يأخذ image_urls أولاً ثم يبني من image_url للتوافق الخلفي
  const imgs = Array.isArray(row.image_urls) && row.image_urls.length
    ? row.image_urls
    : (row.image_url ? [row.image_url] : []);
  return {
    _type:              'announcement',
    id:                 row.id,
    title:              row.title              || '',
    imageUrl:           imgs[0]               || '',
    imageUrls:          imgs,
    issuingBody:        row.issuing_body       || '',
    announcementType:   row.announcement_type  || 'مناقصة رسمية',
    classification:     row.classification     || '',
    governorate:        row.governorate        || '',
    source:             row.source             || '',
    publishedAt:        row.published_at       || '',
    submissionDeadline: row.submission_deadline|| '',
    sessionDate:        row.session_date       || '',
    sessionTime:        row.session_time       || '',
    documentPrice:      row.document_price     || null,
    insuranceValue:     row.insurance_value    || 'غير محدد',
    description:        row.description        || '',
    createdAt:          row.created_at         || '',
    placeType:          row.place_type         || '',
    activityType:       row.activity_type      || '',
  };
}

function showLoadingState(gridId, isError, msg) {
  const grid = document.getElementById(gridId || 'mp-grid');
  if (!grid) return;
  if (isError) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:18px">⚠️</div>
        <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:8px">${t('loading.error')}</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:22px;max-width:400px;margin-inline:auto">${msg || ''}</div>
        <button class="btn btn-primary" onclick="loadData()">${t('loading.retry')}</button>
      </div>`;
    return;
  }
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px;display:inline-block;animation:spin 1.2s linear infinite">⏳</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:6px">${t('loading.spinner')}</div>
      <div style="font-size:13px;color:var(--ink3)">${t('loading.wait')}</div>
    </div>`;
}


/* ================================================================
   🔄 Supabase Realtime — تحديث فوري عند الموافقة على مساحة
   ================================================================ */

/**
 * تحديث صامت للمساحات — بدون spinner وبدون إعادة ضبط الصفحة الحالية.
 * يُستدعى من polling الاحتياطي (كل 5 دقائق) ويحترم الـ pagination الخادمي.
 */
async function silentRefreshSpaces() {
  if (document.hidden || !sbClient) return;
  try {
    await _applyCurrentFilters();
  } catch { /* صامت — لو الشبكة منقطعة */ }
}

function subscribeSpacesRealtime() {
  if (!sbClient) return;
  let debounce = null;
  const refresh = () => {
    clearTimeout(debounce);
    debounce = setTimeout(silentRefreshSpaces, 1500);
  };
  sbClient.channel('spaces-public-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'space_units' }, refresh)
    .subscribe();
  /* Fallback polling كل 5 دقائق — لو انقطع الـ Realtime */
  setInterval(silentRefreshSpaces, 300000);
}

/* ── يطبّق الفلاتر الحالية عبر بحث خادمي موحّد (search_public_spaces) —
   مشترك بين التحميل الأول وsilentRefresh والـ Realtime وتغيير الصفحة/الفلتر ── */
async function _applyCurrentFilters() {
  const region    = document.getElementById('mp-region')?.value    || '';
  const maxVal    = parseInt(document.getElementById('mp-slider-max')?.value) || 999999;
  const sort      = document.getElementById('mp-sort')?.value      || 'default';
  const placeFlt  = document.getElementById('mp-place-sel')?.value || '';
  const actFlt    = document.getElementById('mp-act-sel')?.value   || '';
  const annClsFlt = document.getElementById('mp-ann-class')?.value || '';
  const sliderMax = parseInt(document.getElementById('mp-slider-max')?.max || 50000);

  // ── إعلانات (مناقصات + مزادات + إعلانات حكومية) — مجموعة صغيرة تُدار من
  //    الأدمن، تبقى فلترة محلية كما هي (ليست جزءًا من مشكلة الحجم) ──
  annCurrentFiltered = [];
  if (mpContentFilter !== 'spaces') {
    let annData = [...ANNOUNCEMENTS];
    if (region)    annData = annData.filter(a => a.governorate === region);
    if (placeFlt)  annData = annData.filter(a => a.placeType === placeFlt);
    if (actFlt)    annData = annData.filter(a => a.activityType === actFlt);
    if (annClsFlt) annData = annData.filter(a => a.classification === annClsFlt);
    annData.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    annCurrentFiltered = annData;
  }

  // ── مساحات: بحث/فلترة/ترتيب/ترقيم خادمي — نفس مصدر الرئيسية ──
  if (mpContentFilter === 'announcements') {
    mpCurrentSpaces = [];
    mpTotalCount = 0;
  } else {
    try {
      const { items, totalCount } = await searchPublicSpaces(sbClient, {
        region:     region || null,
        types:      placeFlt ? [placeFlt] : null,
        activities: actFlt ? [actFlt] : null,
        maxPrice:   maxVal < sliderMax ? maxVal : null,
        sort,
        limit:      MP_PER_PAGE,
        offset:     (mpPage - 1) * MP_PER_PAGE,
      });
      mpCurrentSpaces = items;
      mpTotalCount = totalCount;
    } catch (err) {
      showLoadingState('mp-grid', true, err.message || t('loading.errorSpaces'));
      return;
    }
  }

  renderMarketplace();
  _updateResultsCounter();
}

/* منفصلة عن _applyCurrentFilters عشان تبديل اللغة يقدر يحدّث النص بس
   من غير إعادة جلب من Supabase — راجع مستمع makani:locale-changed تحت */
function _updateResultsCounter() {
  const counter = document.getElementById('mp-count');
  if (!counter) return;
  const annCnt = annCurrentFiltered.length;
  const spCnt  = mpTotalCount;
  if (annCnt && spCnt) counter.textContent = t('results.resultsCount', { count: spCnt + annCnt });
  else if (annCnt)     counter.textContent = t('results.announcementsCount', { count: annCnt });
  else                 counter.textContent = t('results.spacesCount', { count: spCnt });
}


/* ================================================================
   🏷️ القسم الخامس: بناء فلاتر الأنشطة
   ================================================================ */

function buildModalActivityPicker() {
  const sel = document.getElementById('bk-activity');
  if (!sel) return;
  sel.innerHTML = `<option value="">${t('bookingModal.activityPick')}</option>` +
    ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('') +
    `<option value="other">${t('card.otherActivity')}</option>`;
}

function onActivityChange(sel) {
  const wrap = document.getElementById('other-act-wrap');
  if (wrap) wrap.style.display = (sel.value === 'other') ? 'block' : 'none';
}

function buildMpActivityFilters() {
  const sel = document.getElementById('mp-act-sel');
  if (!sel) return;
  sel.innerHTML = `<option value="">${t('market.activityAll')}</option>` +
    ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
}


/* ── نظام الباقات والبادجيات ── */
/* ترتيب المساحات حسب الباقة صار جزءًا من ORDER BY داخل search_public_spaces (RPC) */

/* يحلّ قيمة النشاط المخزّنة (مُعرّف مثل coffee أو اسم عربي) إلى تسمية للعرض.
   يطابق بالمُعرّف أو الاسم العربي أو التسمية الكاملة — وإلا يعيد القيمة كما هي. */
function _resolveActLabel(val) {
  if (!val) return '';
  const a = (ACTIVITIES || []).find(x =>
    x.id === val ||
    x.label === val ||
    x.label.replace(/^[^؀-ۿ]+/, '').trim() === String(val).trim()
  );
  return a ? a.label : val;
}

/* _planTrustBadgeHtml انتقلت إلى shared/plan-badge.js (planTrustBadgeCardHtml/planTrustBadgeInlineHtml)
   — كانت مكرّرة حرفيًا هنا وفي app.js، ونصّها القديم "✓ موثّق" لباقة Growth كان
   يتصادم مع شارة توثيق الهوية الحقيقية (راجع shared/account.js: identityVerified/organizerVerified). */

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

  const actsHtml = s.allActs ? `<span class="act-tag act-tag-all">${t('card.allActivities')}</span>` : (s.acts || []).slice(0, 3).map(id => `<span class="act-tag">${_resolveActLabel(id)}</span>`).join('');
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

  const _perMonthLabel = t('card.perMonth');
  const _currency      = t('card.currency');
  const sizesHtml = sizesClean.map((sz, i) =>
    `<span class="size-chip${i === 0 ? ' on' : ''}" data-price="${sizePrices[sz]}" onclick="event.stopPropagation(); var c=this.closest('.space-card'); c.querySelectorAll('.size-chip').forEach(x=>x.classList.remove('on')); this.classList.add('on'); c.querySelector('.price-main').innerHTML=Number(this.dataset.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')+' ${_currency} <span>${_perMonthLabel}</span>';">${sz}</span>`
  ).join('');

  const hasDetails = (s.subSpaces && s.subSpaces.length > 0) ||
                     (s.extraImages && s.extraImages.length > 0) ||
                     s.description;

  const detailsBtnHtml = hasDetails
    ? `<button class="btn btn-details" style="font-size:12px;padding:7px 14px"
              onclick="event.stopPropagation();_trackSpaceEvent('${s.id}','${s.ownerId||''}','detail_click');openSpaceDetail('${s.id}','${fromPage}')">
         ${t('card.details')}
       </button>`
    : '';

  const availableUnits = (s.subSpaces || []).filter(u => u.status === 'available' || !u.status).length;
  const unitsBadgeHtml = s.subSpaces && s.subSpaces.length > 0
    ? `<span class="units-badge">${t('card.unitsAvailable', { count: availableUnits })}</span>`
    : '';

  const _spaceNameSafe = (s.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const _shareSpaceBtn = `<button class="share-btn" onclick="event.stopPropagation();shareCard('space','${s.id}','${_spaceNameSafe}')" title="${t('card.share')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>`;
  const _trustBadge    = planTrustBadgeCardHtml(s);
  const _cardClass     = _planCardClass(s);

  return `
  <div class="space-card${_cardClass}" data-sid="${s.id}" data-oid="${s.ownerId||''}">
    <div class="card-thumb">
      ${thumbHtml}
      <span class="card-badge ${s.badgeClass || 'badge-avail'}">${s.badge || t('card.badgeDefault')}</span>
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
        <div class="price-main">${Number(defaultPrice).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${_currency} <span>${_perMonthLabel}</span></div>
        <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap">
          ${detailsBtnHtml}
          <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                  onclick="openBooking('${s.id}')">${t('card.bookNow')}</button>
        </div>
      </div>
      ${(s.season || s.insight) ? `
      <div class="card-tip">
        <div class="tip-dot"></div>
        <div>${s.season ? `<strong>${t('card.season')}</strong> ${s.season}` : ''}${s.insight ? `<br>${s.insight}` : ''}</div>
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
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">${t('empty.title')}</div>
        <div style="font-size:14px">${t('empty.hint')}</div>
      </div>`;
    return;
  }

  grid.innerHTML = data.map(s => buildCardHtml(s, fromPage)).join('');
  requestAnimationFrame(_initCardViewTracking);
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
          <button class="sd-back-btn" onclick="closeSpaceDetail()">${t('detail.back')}</button>
          <div class="sd-breadcrumb">
            <span onclick="window.location.href='/'" style="cursor:pointer">${t('detail.home')}</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="showPage('market')" style="cursor:pointer">${t('detail.spacesCrumb')}</span>
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
          ${t('detail.loginRequiredTitle')}
        </h2>
        <p style="font-size:14px;color:var(--ink3);line-height:1.9;margin-bottom:28px;font-family:'IBM Plex Sans Arabic',sans-serif">
          ${t('detail.loginRequiredBody')}
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:13px 32px;font-size:15px"
                  onclick="showPage('login')">
            ${t('detail.loginBtn')}
          </button>
          <button class="btn" style="padding:13px 22px;font-size:14px"
                  onclick="closeSpaceDetail()">
            ${t('detail.backToSpacesBtn')}
          </button>
        </div>
      </div>`;
  }

  const subEl = document.getElementById('sd-subspaces');
  if (subEl) subEl.innerHTML = '';

  showPage('space-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function openSpaceDetail(spaceId, fromPage) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return;

  _trackSpaceEvent(s.id, s.ownerId, 'detail_click');

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
            ${t('detail.back')}
          </button>
          <div class="sd-breadcrumb">
            <span onclick="window.location.href='/'" style="cursor:pointer">${t('detail.home')}</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="showPage('market')" style="cursor:pointer">${t('detail.spacesCrumb')}</span>
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
                   <span style="color:var(--orange);font-weight:700">${t('detail.unitsCount', { count: s.subSpaces.length })}</span>`
                : ''}
            </div>
          </div>
          <div class="sd-price-box">
            <div class="sd-price-val">${Number(s.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${t('card.currency')}</div>
            <div class="sd-price-lbl">${t('detail.startingFrom')}</div>
            <button class="btn btn-primary" style="margin-top:10px;width:100%;justify-content:center"
                    onclick="openBooking('${s.id}')">${t('card.bookNow')}</button>
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

/* 🪪 الانتقال لصفحة البروفايل العام للناشر (الهوية الرقمية الموحّدة) */
function goToOwnerProfile(ownerId) {
  if (!ownerId) return;
  window.location.href = `/?p=owner-profile&id=${ownerId}`;
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
      allImages.push({ url, caption: t('detail.imageCaption', { name: s.name, n: i + 2 }) });
  });

  if (!allImages.length) {
    galleryEl.innerHTML = `
      <div class="sd-gallery-placeholder">
        <div style="font-size:64px;opacity:0.25">${s.icon || '🏪'}</div>
        <div style="font-size:13px;color:var(--ink3);margin-top:10px">${t('detail.noImages')}</div>
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
                title="${t('detail.nextImage')}">&#8250;</button>
        <button class="sd-arrow sd-arrow-prev"
                onclick="event.stopPropagation();sdPrev('${detailSliderId}')"
                title="${t('detail.prevImage')}">&#8249;</button>
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
    ? `<span class="act-tag act-tag-all">${t('detail.activitiesAll')}</span>`
    : (s.acts || []).map(id => {
        const label = _resolveActLabel(id);
        return label ? `<span class="act-tag">${label}</span>` : '';
      }).join('');

  const sizesHtml = (s.sizes || []).map(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    return `
      <div class="sd-size-row">
        <span class="sd-size-label">${label}</span>
        <span class="sd-size-price">${Number(price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${t('card.currency')} ${t('card.perMonth')}</span>
      </div>`;
  }).join('');

  const amenitiesHtml = (s.amenities || []).map(a =>
    `<span class="sd-amenity">✓ ${a}</span>`
  ).join('');

  infoEl.innerHTML = `
    <div class="sd-info-grid">
      ${s.description ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('detail.aboutTitle')}</div>
        <p class="sd-description">${s.description}</p>
      </div>` : ''}

      <div class="sd-info-card">
        <div class="sd-info-title">${t('detail.activitiesTitle')}</div>
        <div class="card-acts" style="margin-top:8px">${actsHtml || '—'}</div>
      </div>

      ${sizesHtml ? `
      <div class="sd-info-card">
        <div class="sd-info-title">${t('detail.sizesTitle')}</div>
        <div class="sd-sizes-list" style="margin-top:10px">${sizesHtml}</div>
      </div>` : ''}

      ${amenitiesHtml ? `
      <div class="sd-info-card">
        <div class="sd-info-title">${t('detail.amenitiesTitle')}</div>
        <div class="sd-amenities-wrap" style="margin-top:10px">${amenitiesHtml}</div>
      </div>` : ''}

      ${s.season ? `
      <div class="sd-info-card">
        <div class="sd-info-title">${t('detail.additionalInfoTitle')}</div>
        <div style="margin-top:8px">
          <div class="sd-extra-row"><span>${t('card.season')}</span><span>${s.season}</span></div>
          ${s.insight ? `<div style="font-size:13px;color:var(--ink2);margin-top:6px;line-height:1.7">${s.insight}</div>` : ''}
        </div>
      </div>` : ''}

      ${(() => {
        const isBroker  = s.isBroker;
        const hasOwner  = !isBroker && !!s.ownerName;

        // الناشر: إما مكاني Spot (is_broker أو بدون مالك) أو صاحب مساحة معيّن
        const name      = hasOwner ? s.ownerName : t('brand');
        const tier      = s.planTier || 'starter';

        const roleLabel = isBroker
          ? t('detail.platformPublisher')
          : hasOwner
            ? (tier === 'broker'  ? t('detail.certifiedBroker')
             : tier === 'pro'     ? t('detail.certifiedPartner')
             : tier === 'growth'  ? t('detail.growthPartner')
             : t('detail.spaceOwner'))
          : t('detail.platformPublisher');

        const badgeCls  = isBroker || !hasOwner
          ? 'trust-makani'
          : (tier === 'broker' ? 'trust-broker'
           : tier === 'pro'    ? 'trust-partner'
           : tier === 'growth' ? 'trust-verified'
           : '');

        const badgeHtml = badgeCls
          ? `<span class="sd-trust-badge ${badgeCls}" style="margin-top:4px">${roleLabel}</span>`
          : `<span class="sd-owner-role">${roleLabel}</span>`;

        // الأفاتار: مكاني Spot يعرض الشعار، المالك يعرض صورته أو الحرف الأول
        let avatarHtml;
        if (!hasOwner) {
          // مكاني Spot — نعرض الشعار
          avatarHtml = `<div class="sd-owner-avatar-placeholder makani-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h20l-2 4H4Z"/><path d="M4 11v9h16v-9"/><path d="M9 20v-6h6v6"/></svg>
          </div>`;
        } else if (s.ownerAvatar) {
          avatarHtml = `<img src="${s.ownerAvatar}" alt="${name}" class="sd-owner-avatar"
            onerror="this.outerHTML='<div class=\\'sd-owner-avatar-placeholder\\'>${name[0]}</div>'">`;
        } else {
          avatarHtml = `<div class="sd-owner-avatar-placeholder">${name[0]}</div>`;
        }

        // البطاقة قابلة للضغط فقط لو الناشر صاحب مساحة حقيقي (ليس مكاني سبوت)
        const clickable = hasOwner && s.ownerId && !isBroker;
        const cardAttrs = clickable
          ? `style="margin-top:10px;cursor:pointer" onclick="goToOwnerProfile('${s.ownerId}')" title="${t('detail.viewProfileTitle')}"`
          : `style="margin-top:10px"`;
        const arrowHtml = clickable
          ? `<span style="margin-inline-start:auto;color:var(--ink2);font-size:18px">‹</span>`
          : '';

        return `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('detail.publisherTitle')}</div>
        <div class="sd-owner-card" ${cardAttrs}>
          ${avatarHtml}
          <div class="sd-owner-info">
            <div class="sd-owner-name">${name}</div>
            ${badgeHtml}
          </div>
          ${arrowHtml}
        </div>
      </div>`;
      })()}
    </div>`;
}

function _renderSubSpaces(s) {
  const subEl = document.getElementById('sd-subspaces');
  if (!subEl) return;

  const units = s.subSpaces || [];

  if (!units.length) {
    subEl.innerHTML = '';
    return;
  }

  const availCount  = units.filter(u => u.status === 'available' || !u.status).length;
  const rentedCount = units.filter(u => u.status === 'rented').length;

  const statusMap = {
    available: { label: t('subspaces.statusAvailable'), cls: 'sub-status-available' },
    rented:    { label: t('subspaces.statusRented'),     cls: 'sub-status-rented'    },
    reserved:  { label: t('subspaces.statusReserved'),   cls: 'sub-status-reserved'  },
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
            ${unit.price ? `<span class="sub-spec sub-price">${Number(unit.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${t('card.currency')}${t('card.perMonth')}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px">
            ${!isBlocked
              ? `<button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                         onclick="openBookingForUnit('${s.id}','${unit.unitId}')">
                   ${t('subspaces.book')}
                 </button>`
              : `<span style="font-size:12px;color:var(--ink3);padding:7px 0">${t('subspaces.unavailable')}</span>`
            }
            <button class="share-btn-inline" onclick="event.stopPropagation();shareCard('unit','${s.id}:${(unit.unitId||'').replace(/'/g,"\\'")}','${(unit.name||unit.unitId||'').replace(/'/g,"\\'")}');" title="${t('card.shareUnit')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="13" height="13" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  subEl.innerHTML = `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">${t('subspaces.header', { count: units.length })}</h2>
      <div class="sd-units-summary">
        <span class="sd-units-avail">${t('subspaces.availableCount', { count: availCount })}</span>
        ${rentedCount > 0 ? `<span class="sd-units-rented">${t('subspaces.rentedCount', { count: rentedCount })}</span>` : ''}
      </div>
    </div>
    <div class="sub-grid">${unitsHtml}</div>`;
}

function _typeLabel(type) {
  if (!type) return '';
  return t('placeTypes.' + type, { defaultValue: type });
}


/* ================================================================
   📋 القسم الثامن: فتح مودال الحجز لوحدة فرعية
   ================================================================ */

async function openBookingForUnit(spaceId, unitId) {
  const opened = await openBooking(spaceId);
  if (!opened) return;

  setTimeout(() => {
    const notesEl = document.getElementById('bk-notes');
    if (notesEl && unitId) {
      notesEl.value = t('bookingModal.requestedUnit', { unitId });
    }
    const metaEl = document.getElementById('msi-meta');
    if (metaEl) {
      metaEl.insertAdjacentHTML('beforeend',
        ` · <strong style="color:var(--orange)">${t('bookingModal.unitLabel', { unitId })}</strong>`);
    }
  }, 50);
}


/* ================================================================
   🛍️ القسم التاسع: صفحة الماركت بليس (الفلاتر والعرض)
   ================================================================ */

function goToMarketplace() {
  showPage('market');
  mpPage = 1;

  const s2 = document.getElementById('mp-slider-max');
  if (s2) s2.value = parseInt(s2?.max || 50000);
  updateMpSlider();

  const mpRegion = document.getElementById('mp-region');
  if (mpRegion) mpRegion.value = '';
  const mpSort = document.getElementById('mp-sort');
  if (mpSort) mpSort.value = 'default';

  const placeSel = document.getElementById('mp-place-sel');
  const actSel   = document.getElementById('mp-act-sel');
  if (placeSel) placeSel.value = '';
  if (actSel)   actSel.value   = '';

  _applyCurrentFilters();
}

function applyMpFilters() {
  mpPage = 1;
  _applyCurrentFilters();
  updateMpChips();
}

function setContentFilter(type, btn) {
  mpContentFilter = type;
  document.querySelectorAll('.mp-ctype-btn').forEach(b => b.className = 'mp-ctype-btn');
  if (btn) {
    const cls = type === 'all' ? 'on-all' : type === 'spaces' ? 'on-sp' : 'on-ann';
    btn.classList.add(cls);
  }
  // إظهار تصنيف الإعلان عند عرض "المناقصات والإعلانات" فقط
  const clsWrap = document.getElementById('mp-ann-class-wrap');
  if (clsWrap) clsWrap.style.display = type === 'announcements' ? '' : 'none';
  applyMpFilters();
}

function clearMpFilters() {
  mpContentFilter = 'all';

  const placeSel = document.getElementById('mp-place-sel');
  const actSel   = document.getElementById('mp-act-sel');
  const s2       = document.getElementById('mp-slider-max');
  const mpRegion = document.getElementById('mp-region');
  const mpSort   = document.getElementById('mp-sort');
  const annClass = document.getElementById('mp-ann-class');
  const clsWrap  = document.getElementById('mp-ann-class-wrap');

  if (placeSel) placeSel.value = '';
  if (actSel)   actSel.value   = '';
  if (s2)       s2.value       = parseInt(s2.max || 50000);
  if (mpRegion) mpRegion.value = '';
  if (mpSort)   mpSort.value   = 'default';
  if (annClass) annClass.value = '';
  if (clsWrap)  clsWrap.style.display = 'none';

  updateMpSlider();

  document.querySelectorAll('.mp-ctype-btn').forEach(b => b.className = 'mp-ctype-btn');
  const allBtn = document.getElementById('mp-ctype-all');
  if (allBtn) allBtn.classList.add('on-all');

  mpPage = 1;
  _applyCurrentFilters();
  updateMpChips();
}

function updateMpChips() {
  const cont = document.getElementById('mp-active-chips');
  if (!cont) return;
  const chips = [];
  const contentMap = {
    spaces:        t('chips.spacesOnly'),
    announcements: t('chips.announcementsOnly'),
  };
  if (contentMap[mpContentFilter]) {
    chips.push(`<span class="mp-chip" onclick="clearMpFilters()">${contentMap[mpContentFilter]} ×</span>`);
  }

  const placeVal = document.getElementById('mp-place-sel')?.value || '';
  if (placeVal) {
    chips.push(`<span class="mp-chip" onclick="clearMpFilters()">${_typeLabel(placeVal) || placeVal} ×</span>`);
  }

  const actVal = document.getElementById('mp-act-sel')?.value || '';
  if (actVal) {
    const act = ACTIVITIES.find(a => a.id === actVal);
    if (act) chips.push(`<span class="mp-chip" onclick="clearMpFilters()">${act.label} ×</span>`);
  }

  cont.innerHTML = chips.join('');
}

function renderMarketplace() {
  const grid = document.getElementById('mp-grid');
  if (!grid) return;

  // الإعلانات تُعرض فقط على آخر صفحة مساحات (أو لا مساحات إطلاقًا) — لا تتكرر
  // عبر الصفحات، ولا تحتاج ترقيمها الخاص لأنها مجموعة صغيرة مُدارة من الأدمن
  const totalSpacesPages = Math.max(1, Math.ceil(mpTotalCount / MP_PER_PAGE));
  const annForThisPage = (mpPage >= totalSpacesPages) ? annCurrentFiltered : [];
  const pageData = [...mpCurrentSpaces, ...annForThisPage];

  if (!pageData.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:14px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">${t('empty.titleShort')}</div>
        <div style="font-size:13px;color:var(--ink2);margin-bottom:18px">${t('empty.hintShort')}</div>
        <button class="btn btn-primary" onclick="clearMpFilters()">${t('market.clearFilters')}</button>
      </div>`;
    renderMpPagination();
    return;
  }

  grid.innerHTML = pageData.map(item =>
    item._type === 'announcement'
      ? buildAnnouncementCardHtml(item)
      : buildCardHtml(item, 'market')
  ).join('');
  setTimeout(() => csInitAll(), 120);
  renderMpPagination();
}

/* ================================================================
   📢 كروت وتفاصيل الإعلانات الرسمية
   ================================================================ */

function buildAnnouncementCardHtml(a) {
  const today    = new Date();
  const deadline = new Date(a.submissionDeadline);
  const daysLeft = Math.ceil((deadline - today) / 86400000);

  let dlHtml;
  if (daysLeft < 0) {
    dlHtml = `<span class="ann-deadline ann-dl-expired">${t('announcements.submissionClosed')}</span>`;
  } else if (daysLeft === 0) {
    dlHtml = `<span class="ann-deadline ann-dl-urgent">${t('announcements.lastDay')}</span>`;
  } else if (daysLeft <= 3) {
    dlHtml = `<span class="ann-deadline ann-dl-urgent">${t('announcements.daysLeft', { count: daysLeft })}</span>`;
  } else {
    dlHtml = `<span class="ann-deadline ann-dl-ok">${t('announcements.openUntil', { date: _fmtAnnDate(a.submissionDeadline) })}</span>`;
  }

  const typeClass = { 'مناقصة رسمية':'ann-badge-tender','مزاد علني':'ann-badge-auction','إعلان رسمي':'ann-badge-official' }[a.announcementType] || 'ann-badge-other';
  const thumb = a.imageUrl
    ? `<img src="${a.imageUrl}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='<div class=ann-thumb-ph>📄</div>'">`
    : `<div class="ann-thumb-ph">📄</div>`;

  const finRows = [];
  if (a.documentPrice) finRows.push(`<span>📄 ${t('announcements.documentsValue')}: ${Number(a.documentPrice).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${t('card.currency')}</span>`);
  if (a.insuranceValue && a.insuranceValue !== 'غير محدد') finRows.push(`<span>🔒 ${t('announcements.insuranceValue')}: ${a.insuranceValue}</span>`);

  return `<div class="ann-card" onclick="openAnnouncementDetail('${a.id}')">
  <div class="ann-thumb">
    ${thumb}
    <span class="ann-type-badge ${typeClass}">${_annTypeLabel(a.announcementType)}</span>
  </div>
  <div class="ann-body">
    <div class="ann-title">${a.title}</div>
    <div class="ann-issuer">🏛 ${a.issuingBody}</div>
    <div class="ann-meta-row">📍 ${a.governorate}${a.classification ? ` · ${a.classification}` : ''}</div>
    ${dlHtml}
    ${finRows.length ? `<div class="ann-financial">${finRows.join('')}</div>` : ''}
    <div class="ann-publisher">${t('announcements.publishedBy')}</div>
    <button class="ann-details-btn">${t('announcements.viewDetails')}</button>
  </div>
</div>`;
}

/* الإعلانات الرسمية مخزّنة في DB بنص عربي حرفي (announcement_type) — لا يوجد
   عمود كود منفصل بعد (راجع migrations/i18n_locale_and_code_columns_20260716.sql).
   لحد ما الـ migration دي تتطبّق، بنترجم القيم الثلاث المعروفة يدويًا هنا فقط
   للعرض، والقيمة الخام تفضل زي ما هي في أي مكان تاني (فلترة، تخزين، إلخ). */
function _annTypeLabel(raw) {
  const map = { 'مناقصة رسمية': 'typeTender', 'مزاد علني': 'typeAuction', 'إعلان رسمي': 'typeOfficial' };
  const key = map[raw];
  return key ? t('announcements.' + key) : (raw || '');
}

function openAnnouncementDetail(id) {
  const a = ANNOUNCEMENTS.find(x => x.id === id);
  if (!a) return;
  currentAnnDetail = a;

  // ── بوابة الدخول ──
  if (!currentUser) {
    _showAnnLoginGate(a);
    return;
  }

  _renderAnnDetail(a);
}

function _showAnnLoginGate(a) {
  const headerEl = document.getElementById('ann-det-header');
  if (headerEl) {
    headerEl.innerHTML = `<div class="sd-header-inner">
      <div class="sd-back-row">
        <button class="sd-back-btn" onclick="closeAnnouncementDetail()">${t('detail.back')}</button>
      </div>
      <div class="sd-title-row">
        <div>
          <h1 class="sd-name">${a.title}</h1>
          <div class="sd-meta">
            <span style="background:rgba(37,99,235,.12);color:#1d4ed8;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:800">${_annTypeLabel(a.announcementType)}</span>
            <span class="sd-meta-sep">·</span>
            <span>📍 ${a.governorate}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  const bodyEl = document.getElementById('ann-det-body');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="text-align:center;padding:60px 24px;max-width:420px;margin:0 auto">
        <div style="font-size:56px;margin-bottom:18px">🔐</div>
        <div style="font-size:19px;font-weight:900;color:var(--fg-1,#1a1a1a);margin-bottom:10px;font-family:var(--font-display,'Cairo',sans-serif)">
          ${t('announcements.loginRequiredTitle')}
        </div>
        <div style="font-size:14px;color:var(--fg-2,#555);line-height:1.7;margin-bottom:28px">
          ${t('announcements.loginRequiredBody')}
        </div>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:13px 32px;font-size:15px" onclick="showPage('login')">
            ${t('detail.loginBtn')}
          </button>
          <button class="btn" style="padding:13px 22px;font-size:14px" onclick="showPage('signup')">
            ${t('announcements.createAccount')}
          </button>
        </div>
        <button class="btn" style="margin-top:18px;padding:10px 20px;font-size:13px;color:var(--fg-3,#888)" onclick="closeAnnouncementDetail()">
          ${t('detail.backToSpacesBtn')}
        </button>
      </div>`;
  }

  showPage('announcement-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function _renderAnnDetail(a) {
  const today    = new Date();
  const deadline = new Date(a.submissionDeadline);
  const daysLeft = Math.ceil((deadline - today) / 86400000);
  let statusHtml;
  if (daysLeft < 0)       statusHtml = `<div class="ann-status-bar ann-st-expired">${t('announcements.statusExpired')}</div>`;
  else if (daysLeft === 0) statusHtml = `<div class="ann-status-bar ann-st-urgent">${t('announcements.statusUrgentToday')}</div>`;
  else if (daysLeft <= 3)  statusHtml = `<div class="ann-status-bar ann-st-urgent">${t('announcements.statusUrgentDays', { count: daysLeft })}</div>`;
  else                     statusHtml = `<div class="ann-status-bar ann-st-ok">${t('announcements.statusOpen', { date: _fmtAnnDate(a.submissionDeadline) })}</div>`;

  const headerEl = document.getElementById('ann-det-header');
  if (headerEl) {
    headerEl.innerHTML = `<div class="sd-header-inner">
      <div class="sd-back-row">
        <button class="sd-back-btn" onclick="closeAnnouncementDetail()">${t('detail.back')}</button>
      </div>
      <div class="sd-title-row">
        <div>
          <h1 class="sd-name">${a.title}</h1>
          <div class="sd-meta">
            <span style="background:rgba(37,99,235,.12);color:#1d4ed8;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:800">${_annTypeLabel(a.announcementType)}</span>
            <span class="sd-meta-sep">·</span>
            <span>📍 ${a.governorate}</span>
            <span class="sd-meta-sep">·</span>
            <span>🏛 ${a.issuingBody}</span>
          </div>
        </div>
      </div>
    </div>`;
  }

  const bodyEl = document.getElementById('ann-det-body');
  if (bodyEl) {
    // بناء gallery الصور
    const imgs = a.imageUrls && a.imageUrls.length ? a.imageUrls : (a.imageUrl ? [a.imageUrl] : []);
    const _imgCell = (url, title) => {
      const safe = url.replace(/'/g, "\\'");
      return `<div onclick="openLightbox('${safe}')"
                   style="cursor:zoom-in;border-radius:12px;overflow:hidden;
                          border:1px solid var(--bd-1,#e5e7eb);background:var(--bg2,#f8f9fa)">
                <img src="${url}" alt="${title||''}"
                     style="width:100%;height:auto;display:block;
                            max-height:420px;object-fit:contain;vertical-align:top">
              </div>`;
    };
    const galleryHtml = imgs.length === 0 ? ''
      : imgs.length === 1
        ? `<div style="margin-bottom:16px">${_imgCell(imgs[0], a.title)}</div>`
        : `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px">
             ${imgs.map(u => _imgCell(u, a.title)).join('')}
           </div>`;

    const _notSpecified = t('announcements.notSpecified');
    bodyEl.innerHTML = `
      ${galleryHtml}
      ${statusHtml}
      <div class="ann-det-grid">
        <div class="ann-det-card">
          <div class="ann-det-card-title">${t('announcements.detailsLabel')}</div>
          ${_annRow(t('announcements.issuer'), a.issuingBody)}
          ${_annRow(t('announcements.type'), _annTypeLabel(a.announcementType))}
          ${_annRow(t('announcements.classification'), a.classification)}
          ${_annRow(t('announcements.governorate'), a.governorate)}
          ${a.source ? _annRow(t('announcements.source'), a.source) : ''}
        </div>
        <div class="ann-det-card">
          <div class="ann-det-card-title">${t('announcements.datesLabel')}</div>
          ${_annRow(t('announcements.publishDate'), _fmtAnnDate(a.publishedAt))}
          ${_annRow(t('announcements.deadline'), _fmtAnnDate(a.submissionDeadline))}
          ${a.sessionDate ? _annRow(t('announcements.sessionDate'), _fmtAnnDate(a.sessionDate) + (a.sessionTime ? ' — ' + a.sessionTime : '')) : ''}
        </div>
        <div class="ann-det-card">
          <div class="ann-det-card-title">${t('announcements.financialLabel')}</div>
          ${a.documentPrice ? _annRow(t('announcements.documentsValue'), Number(a.documentPrice).toLocaleString(getLocale()==='en'?'en-US':'ar-EG') + ' ' + t('card.currency')) : _annRow(t('announcements.documentsValue'), _notSpecified)}
          ${_annRow(t('announcements.insuranceValue'), (a.insuranceValue && a.insuranceValue !== 'غير محدد') ? a.insuranceValue : _notSpecified)}
        </div>
      </div>
      ${a.description ? `<div class="sd-sec-title" style="margin-bottom:10px">${t('announcements.detailsTitle')}</div>
        <div class="ann-desc">${a.description.replace(/\n/g, '<br>')}</div>` : ''}
      <div style="height:80px"></div>`;
  }

  showPage('announcement-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ================================================================
   🔍 Lightbox — تكبير صورة الإعلان
   ================================================================ */
let _lbScale = 1;

function openLightbox(url) {
  const lb  = document.getElementById('ann-lightbox');
  const img = document.getElementById('ann-lb-img');
  if (!lb || !img) return;
  img.src = url;
  _lbScale = 1;
  img.style.transform = 'scale(1)';
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeLightbox(e) {
  // يُغلق فقط لو الضغط على الخلفية الداكنة (ليس الصورة أو الأزرار)
  if (e && e.target.id !== 'ann-lightbox') return;
  const lb = document.getElementById('ann-lightbox');
  if (lb) lb.style.display = 'none';
  document.body.style.overflow = '';
}

function lbZoom(delta) {
  _lbScale = Math.min(4, Math.max(0.5, _lbScale + delta));
  const img = document.getElementById('ann-lb-img');
  if (img) img.style.transform = `scale(${_lbScale})`;
}

function closeAnnouncementDetail() {
  currentAnnDetail = null;
  showPage('market');
}

function _fmtAnnDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(getLocale() === 'en' ? 'en-US' : 'ar-EG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function _annRow(k, v) {
  return `<div class="ann-det-row"><span class="ann-det-key">${k}</span><span class="ann-det-val">${v || '—'}</span></div>`;
}

function renderMpPagination() {
  const cont = document.getElementById('mp-pagination');
  if (!cont) return;

  const totalPages = Math.max(1, Math.ceil(mpTotalCount / MP_PER_PAGE));
  let html = '';

  if (totalPages > 1) {
    if (mpPage > 1) html += `<button class="pg-btn" onclick="mpGoPage(${mpPage - 1})">${t('market.prevPage')}</button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || Math.abs(i - mpPage) <= 2) {
        html += `<button class="pg-btn${i === mpPage ? ' on' : ''}" onclick="mpGoPage(${i})">${i}</button>`;
      } else if (Math.abs(i - mpPage) === 3) {
        html += `<span class="pg-dots">…</span>`;
      }
    }
    if (mpPage < totalPages) html += `<button class="pg-btn" onclick="mpGoPage(${mpPage + 1})">${t('market.nextPage')}</button>`;
  }

  cont.innerHTML = html;
}

function mpGoPage(n) {
  mpPage = n;
  _applyCurrentFilters();
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
  if (lMax) lMax.textContent = maxVal >= RANGE_MAX ? t('market.priceNoLimit') : Number(maxVal).toLocaleString(getLocale()==='en'?'en-US':'ar-EG') + ' ' + t('card.currency');
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

async function openBooking(spaceId) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return null;

  // بوابة الدخول — لا حجز بدون تسجيل (لضمان ربط الحجز بالمستخدم وصاحب المساحة)
  if (!currentUser) {
    _showSpaceLoginGate(s, detailPrevPage || 'market');
    return null;
  }

  bookingSpace = s;   // ربط الحجز بالمساحة وصاحبها (نظام التقييمات)
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

  const selSize  = sizesClean[0] || '';
  const selPrice = sizePrices[selSize] || s.price;

  const _curr = t('card.currency');
  document.getElementById('msi-name').textContent = s.name;
  document.getElementById('msi-meta').innerHTML =
    `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(selPrice).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${_curr}${t('card.perMonth')}</strong>`;

  const sizeSelect = document.getElementById('bk-size');
  sizeSelect.innerHTML = `<option value="">${t('bookingModal.sizePick')}</option>` +
    sizesClean.map(sz => `<option value="${sz}" ${sz === selSize ? 'selected' : ''}>${sz}</option>`).join('') +
    `<option value="مخصص">${t('bookingModal.customSize')}</option>`;

  sizeSelect.onchange = function () {
    const p = sizePrices[this.value] || s.price;
    document.getElementById('msi-meta').innerHTML =
      `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(p).toLocaleString(getLocale()==='en'?'en-US':'ar-EG')} ${_curr}${t('card.perMonth')}</strong>`;
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
  ['bk-other-act', 'bk-notes', 'bk-profile-link', 'bk-project-image'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const durEl      = document.getElementById('bk-dur');
  if (durEl) durEl.value = '';
  const actSel     = document.getElementById('bk-activity');
  if (actSel) actSel.value = '';
  const otherWrap  = document.getElementById('other-act-wrap');
  if (otherWrap) otherWrap.style.display = 'none';

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

/* تبديل واجهة المودال بين الحجز العادي وقائمة الانتظار */
function _applyWaitlistMode(isWaitlist) {
  const show = (id, on) => { const el = document.getElementById(id); if (el) el.style.display = on ? 'block' : 'none'; };
  const set  = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

  show('bk-waitlist-banner', isWaitlist);
  // الحقلان الاختياريان يظهران دائماً (ليس فقط في وضع الانتظار)

  set('bk-modal-title', isWaitlist ? t('bookingModal.waitlistModalTitle') : t('bookingModal.title'));
  set('bk-modal-sub',   isWaitlist ? t('bookingModal.waitlistModalSub') : t('bookingModal.subtitle'));

  const btn = document.getElementById('bk-submit-btn');
  if (btn) btn.innerHTML = isWaitlist ? t('bookingModal.waitlistSubmit') : t('bookingModal.submit');
}

/* ================================================================
   📅 حجز المعاينة — Viewing System
   ================================================================ */

let _viewingSpaceId = null;

async function openViewing(spaceId) {
  const s = await findOrFetchSpace(spaceId);
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

  if (!name)  { show(t('validation.nameRequired')); return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    show(t('validation.phoneInvalid')); return;
  }
  if (!currentUser) { show(t('validation.loginRequiredViewing')); return; }
  errEl.style.display = 'none';

  const btn = document.getElementById('vm-submit-btn');
  btn.innerHTML = t('auth2.sending');
  btn.disabled  = true;

  const s = await findOrFetchSpace(_viewingSpaceId);

  try {
    const { error } = await sbClient.from('bookings').insert({
      id:         crypto.randomUUID(),
      user_id:    currentUser.id,
      owner_id:   s?.ownerId || null,   // ربط طلب المعاينة بصاحب المساحة → يظهر في لوحة أصحاب المساحات
      space_id:   s?.id || null,         // ربط بالمساحة
      space_name: s?.name || '',
      space_loc:  s?.loc  || '',
      activity:   'معاينة',
      duration:   'معاينة - 150 ج',
      start_date: date || null,
      notes:      'طلب معاينة — ١٥٠ ج.م.',
      status:     'viewing_pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) throw error;

    document.getElementById('vm-form-wrap').style.display = 'none';
    document.getElementById('vm-success').style.display   = 'block';

  } catch (err) {
    btn.innerHTML = t('visitModal.submit');
    btn.disabled  = false;
    show(t('validation.sendError'));
  }
}

async function submitBooking() {
  const name         = document.getElementById('bk-name').value.trim();
  const phone        = document.getElementById('bk-phone').value.trim();
  const email        = document.getElementById('bk-email').value.trim();
  const actSel       = document.getElementById('bk-activity');
  const actId        = actSel ? actSel.value : '';
  const otherAct     = document.getElementById('bk-other-act').value.trim();
  const size         = document.getElementById('bk-size').value;
  const dur          = document.getElementById('bk-dur').value;
  const date         = document.getElementById('bk-date').value;
  const notes        = document.getElementById('bk-notes').value.trim();
  const isWaitlist   = !!bookingSpace?.isWaitlist;
  const profileLink  = (document.getElementById('bk-profile-link')?.value || '').trim();
  const projectImage = (document.getElementById('bk-project-image')?.value || '').trim();

  // نوع النشاط من الـ dropdown
  const actLabel = actId === 'other'
    ? (otherAct || t('validation.otherActivityFallback'))
    : (ACTIVITIES.find(a => String(a.id) === String(actId))?.label || actId);

  if (!name) { showFormError(t('validation.nameRequired')); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showFormError(t('validation.phoneInvalid')); return;
  }
  if (!actId) { showFormError(t('validation.activityRequired')); return; }
  if (!currentUser) { showFormError(t('validation.loginRequiredBooking')); return; }

  document.getElementById('bk-error').style.display = 'none';

  const submitBtn     = document.querySelector('#modal-form-wrap .btn-primary');
  const origText      = submitBtn.innerHTML;
  submitBtn.innerHTML = t('auth2.sending');
  submitBtn.disabled  = true;
  submitBtn.style.opacity = '0.7';

  const spaceName = bookingSpace?.name || document.getElementById('msi-name').textContent;
  const spaceLoc  = bookingSpace?.loc || '';
  const price     = resolveSizePrice(bookingSpace, size);

  // دمج روابط المشروع والبراند في الملاحظات إذا وُجدت
  let fullNotes = notes;
  if (projectImage) fullNotes += (fullNotes ? '\n' : '') + `📸 صورة المشروع: ${projectImage}`;
  if (profileLink)  fullNotes += (fullNotes ? '\n' : '') + `🏷 بروفايل البراند: ${profileLink}`;

  const result = await submitSpaceBookingRequest(sbClient, currentUser, {
    spaceId:  bookingSpace?.id,
    ownerId:  bookingSpace?.ownerId,
    spaceName, spaceLoc, price,
    activity: actLabel,
    size, duration: dur, startDate: date,
    notes: fullNotes,
    isWaitlist, profileLink,
  });

  if (!result.ok) {
    submitBtn.innerHTML     = origText;
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
    showFormError(result.error);
    return;
  }

  const profileUpdate = {};
  if (name  && !currentProfile?.full_name) profileUpdate.full_name = name;
  if (phone && !currentProfile?.phone)     profileUpdate.phone     = phone;
  if (email && !currentProfile?.email)     profileUpdate.email     = email;
  if (Object.keys(profileUpdate).length > 0) {
    const { error: profileError } = await sbClient
      .from('profiles')
      .upsert({ id: currentUser.id, ...profileUpdate }, { onConflict: 'id' });
    if (!profileError) currentProfile = { ...currentProfile, ...profileUpdate };
  }

  /* رسالة نجاح مخصّصة لقائمة الانتظار */
  const sTitle = document.getElementById('bk-success-title');
  const sBody  = document.getElementById('bk-success-body');
  if (isWaitlist) {
    if (sTitle) sTitle.innerHTML = t('validation.waitlistSuccessTitle');
    if (sBody)  sBody.innerHTML  = t('validation.waitlistSuccessBody', { spaceName: spaceName || t('validation.defaultSpaceName') });
  } else {
    if (sTitle) sTitle.innerHTML = t('bookingModal.successTitlePlain') + '<span>' + t('bookingModal.successTitleStrong') + '</span>';
    if (sBody)  sBody.innerHTML  = t('bookingModal.successBody');
  }

  trackEvent('booking_submitted', { space_id: bookingSpace?.id, space_name: bookingSpace?.name });
  document.getElementById('modal-form-wrap').style.display = 'none';
  document.getElementById('modal-success').style.display   = 'block';
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

  // صفحات فيها .sd-sticky-footer (زر عودة ثابت) — نخفي bottom-nav حتى لا يغطّيه على الموبايل
  document.body.classList.toggle('sd-detail-open', p === 'space-detail' || p === 'announcement-detail');

  // تحديث الـ Nav
  document.querySelectorAll('.nav-section-btn').forEach(b => b.classList.remove('active'));
  if (p === 'market' || p === 'space-detail' || p === 'announcement-detail') {
    document.getElementById('nsb-spaces')?.classList.add('active');
  }
  if (p === 'market') {
    setTimeout(initMpSlider, 120);
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

/* تحديث فوري للصلاحيات (المرحلة ٦) — عند موافقة أدمن بينما التبويب مفتوح:
   أعد جلب البروفايل وأعد رسم الناف بلا reload. مسجَّل مرة واحدة فقط. */
window.addEventListener('gn:permission-changed', async () => {
  if (!currentUser || !sbClient) return;
  const { data: profile } = await sbClient.from('profiles').select('*').eq('id', currentUser.id).single();
  currentProfile = profile;
  currentAvatarUrl = profile?.avatar_url || null;
  setNavUser(currentUser, profile);
});

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
      GN.init(sbClient, session.user.id);
    } else {
      setNavUser(null, null);
    }
  } catch (_) {
    setNavUser(null, null);
  }

  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      currentUser = session.user;
      const { data: profile } = await sbClient.from('profiles').select('*').eq('id', session.user.id).single();
      currentProfile = profile;
      currentAvatarUrl = profile?.avatar_url || null;   // 🪪 المصدر الموحّد
      setNavUser(session.user, profile);
      GN.init(sbClient, session.user.id);

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
      currentAvatarUrl = null;
      setNavUser(null, null);
      GN.destroy();
    }
  });
}

function setNavUser(user, profile) {
  // يُزامن الـ class مع الحالة النهائية (بعد تأكيد getSession)
  document.documentElement.classList.toggle('sb-authed', !!user);

  const guestEl  = document.getElementById('nav-guest');
  const loggedEl = document.getElementById('nav-logged');
  if (!guestEl || !loggedEl) return;

  if (!user) {
    guestEl.style.display  = 'flex';
    loggedEl.style.display = 'none';
  } else {
    const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || t('userNav.defaultName');
    const email     = user.email || '';
    const initial   = name.trim()[0] || '؟';
    const caps      = getAccountCapabilities(profile);
    const roleLabel = caps.isOwner ? t('userNav.roleOwner') : caps.isTenant ? t('userNav.roleTenant') : t('userNav.roleUser');

    guestEl.style.display  = 'none';
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
    set('nav-av-name',   name);
    set('nav-av-email',  email);
    set('dd-name',       name);
    set('dd-email',      email);
    set('dd-role',       roleLabel);

    const ownerBtn = document.getElementById('dd-owner-dash-btn');
    if (ownerBtn) ownerBtn.style.display = caps.isOwner ? 'flex' : 'none';

    updateBnUser(user, profile);

    // جرس الإشعارات الموحّد
    GN.mount(document.getElementById('nav-logged'));
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

  if (!email) { showAuthAlert('login-alert', 'error', t('auth2.emailRequired')); return; }
  if (!pass)  { showAuthAlert('login-alert', 'error', t('auth2.passwordRequired')); return; }

  setBtnLoading('btn-login-submit', true);
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password: pass });
  setBtnLoading('btn-login-submit', false, t('auth.login.submit'));

  if (error) {
    const msgs = {
      'Invalid login credentials': t('auth2.loginErrors.invalidCredentials'),
      'Email not confirmed':       t('auth2.loginErrors.emailNotConfirmed'),
      'Too many requests':         t('auth2.loginErrors.tooManyRequests'),
    };
    showAuthAlert('login-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  trackEvent('login', { method: 'email' });
  // بعد تسجيل الدخول، ارجع للماركت
  showPage('market');
}


/* ================================================================
   ✍️ القسم السادس عشر: إنشاء حساب جديد
   ================================================================ */

async function doEmailSignup() {
  if (!sbClient) return;
  clearAuthAlert('signup-alert');
  trackEvent('signup_started', { method: 'email' });

  const name  = document.getElementById('su-name')?.value.trim();
  const phone = document.getElementById('su-phone')?.value.trim();
  const email = document.getElementById('su-email')?.value.trim();
  const pass  = document.getElementById('su-pass')?.value;
  const role  = document.getElementById('su-role')?.value;
  const city  = document.getElementById('su-city')?.value;

  if (!name)  { showAuthAlert('signup-alert', 'error', t('validation.nameRequired')); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showAuthAlert('signup-alert', 'error', t('auth2.phoneRequired')); return;
  }
  if (!email) { showAuthAlert('signup-alert', 'error', t('auth2.emailRequired')); return; }
  if (!pass || pass.length < 8) {
    showAuthAlert('signup-alert', 'error', t('auth2.passwordTooShort')); return;
  }
  if (!role)  { showAuthAlert('signup-alert', 'error', t('auth2.roleRequired')); return; }

  setBtnLoading('btn-signup-submit', true);

  const { data, error } = await sbClient.auth.signUp({
    email,
    password: pass,
    options: {
      emailRedirectTo: window.location.origin + '/spaces/',
      data: { full_name: name, phone, role, city }
    }
  });

  setBtnLoading('btn-signup-submit', false, t('auth.signup.submit'));

  if (error) {
    const msgs = {
      'User already registered':                  t('auth2.signupErrors.alreadyRegistered'),
      'Password should be at least 6 characters': t('auth2.signupErrors.passwordTooShort6'),
    };
    const friendly = /rate limit|security purposes|after \d+ seconds/i.test(error.message || '')
      ? t('auth2.signupErrors.rateLimited')
      : null;
    showAuthAlert('signup-alert', 'error', msgs[error.message] || friendly || error.message);
    return;
  }

  if (data.user) {
    await sbClient.from('profiles').upsert({
      id:         data.user.id,
      full_name:  name,
      phone:      phone,
      /* التسجيل الذاتي كـowner أُغلق من الواجهة (نموذج التسجيل يعرض tenant فقط الآن) —
         نُثبّت القيمة هنا أيضًا كطبقة حماية ثانية، بصرف النظر عمّا يصل من الفورم.
         الترقية لـowner تمرّ حصرًا عبر نظام طلبات التحويل. */
      role:       'tenant',
      city:       city,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  trackEvent('signup_completed', { method: 'email' });
  const addrEl = document.getElementById('confirm-em-addr');
  if (addrEl) { addrEl.textContent = email; addrEl.dataset.email = email; }
  showPage('confirm');
}

let resendConfirmCooldownUntil = 0;

async function resendConfirmEmail() {
  if (!sbClient) return;
  const email = document.getElementById('confirm-em-addr')?.dataset.email;
  if (!email) return;
  if (Date.now() < resendConfirmCooldownUntil) return;

  clearAuthAlert('confirm-alert');
  setBtnLoading('btn-resend-confirm', true);
  const { error } = await sbClient.auth.resend({ type: 'signup', email });
  setBtnLoading('btn-resend-confirm', false, t('auth.confirm.resend'));

  if (error) {
    const friendly = /rate limit|security purposes|after \d+ seconds/i.test(error.message || '')
      ? t('auth2.resendRateLimited')
      : error.message;
    showAuthAlert('confirm-alert', 'error', friendly);
    return;
  }

  resendConfirmCooldownUntil = Date.now() + 60000;
  showAuthAlert('confirm-alert', 'success', t('auth2.resendSuccess'));
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
      redirectTo: window.location.origin + '/spaces/'
    }
  });

  if (error) {
    showAuthAlert('login-alert', 'error', t('auth2.googleError', { error: error.message }));
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
  if (on)        b.innerHTML = `<span class="spin-sm"></span> ${t('auth2.loading')}`;
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
    label.textContent = t('bottomNav.myAccount');
    if (desc) desc.textContent = profile?.full_name?.split(' ')[0] || t('bottomNav.welcome');
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = t('bottomNav.login');
    if (desc) desc.textContent = t('bottomNav.loginDesc');
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
    shareText = t('share.checkOutSpace', { name });
  } else if (type === 'unit') {
    const parts = String(id).split(':');
    url       = base + '?space=' + parts[0] + '&unit=' + encodeURIComponent(parts[1] || '');
    shareText = t('share.checkOutUnit', { name });
  } else {
    url       = base + '?space=' + id;
    shareText = t('share.checkOutSpace', { name });
  }

  if (navigator.share) {
    navigator.share({ title: t('brand'), text: shareText, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(()  => _showShareToast(t('share.linkCopied')))
      .catch(() => _showShareToast(t('share.linkFallback', { url })));
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
