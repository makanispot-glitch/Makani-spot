/* ================================================================
   📁 equipment-app.js — منطق سوق المعدات
   ================================================================ */


/* ================================================================
   ⚙️ القسم 1: الإعدادات
   ================================================================ */

const EQ_SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const EQ_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';
const R2_PUBLIC       = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';


/* ================================================================
   📋 القسم 2: الثوابت
   ================================================================ */

const EQ_CATEGORIES = [
  { id: 'food-juice-cart',     label: 'عربية أكل / عصير' },
  { id: 'fast-food-partition', label: 'بارتشن وجبات سريعة' },
  { id: 'beauty-partition',    label: 'بارتشن عناية شخصية' },
  { id: 'clothing-partition',  label: 'بارتشن ملابس / بوتيك' },
  { id: 'handmade',            label: 'هاند ميد' },
  { id: 'phones',              label: 'تليفونات وإكسسوار' },
  { id: 'gifts',               label: 'هدايا وديكور' },
  { id: 'corner-space',        label: 'كورنر سبيس' },
  { id: 'vending',             label: 'آلات بيع ذاتي' },
  { id: 'other',               label: 'أخرى' },
];

const EQ_CONDITIONS = [
  { id: 'new',       label: 'جديد' },
  { id: 'like-new',  label: 'كالجديد' },
  { id: 'good',      label: 'جيد' },
  { id: 'fair',      label: 'مقبول' },
];

const EQ_GOVS = [
  'القاهرة','الجيزة','الإسكندرية','الشرقية','الدقهلية',
  'المنوفية','القليوبية','البحيرة','كفر الشيخ','الغربية',
  'سوهاج','المنيا','أسيوط','قنا','الأقصر','أسوان',
  'بورسعيد','السويس','الإسماعيلية','دمياط','الفيوم',
  'بني سويف','مطروح','شمال سيناء','جنوب سيناء',
  'الوادي الجديد','البحر الأحمر',
];

const FETCH_SIZE   = 24;  // إعلانات لكل جلب من الخادم
const MAX_RENEWALS = 5;
const LISTING_DAYS = 60;

/* يشتق URL الكرت/التفاصيل من URL الكامل المخزّن في DB
   الصور القديمة (قبل نظام المستويات) ترجع كما هي — backward-compatible */
function _cardUrl(u)   { return (u && u.includes('_f.webp')) ? u.replace('_f.webp', '_c.webp') : u; }
function _detailUrl(u) { return (u && u.includes('_f.webp')) ? u.replace('_f.webp', '_d.webp') : u; }

/* عدّاد عام لتحديد fetchpriority للصور الأولى (above-the-fold)
   أول 6 صور = high priority (LCP)، الباقي = lazy + low priority */
let _eqImgCounter = 0;
function _imgAttrs(isLazy = true) {
  const idx = _eqImgCounter++;
  if (idx < 6) return ' decoding="async" fetchpriority="high"';
  return (isLazy ? ' loading="lazy"' : '') + ' decoding="async" fetchpriority="low"';
}


/* ================================================================
   🗄️ القسم 3: المتغيرات العامة + نقطة البداية
   ================================================================ */

let eqSb             = null;
let eqUser           = null;
let eqListings       = [];
let eqFiltered       = [];
let eqOffset         = 0;     // offset للجلب التالي من الخادم
let eqHasMore        = false; // هل يوجد المزيد على الخادم
let eqActiveCategory = '';
let eqSearch        = '';
let eqSortBy        = 'newest';
let eqGov           = '';
let eqPriceMax      = 0;
let eqFavorites     = new Set();
let eqNotifications = [];
let eqMyListings    = [];
let eqDrawerDraft   = {
  category: '',
  gov: '',
  sortBy: 'newest',
  priceMax: 0,
};

document.addEventListener('DOMContentLoaded', async () => {

  /* ── Sidebar events — attached first, before any early return ── */
  const _sidebarTab     = document.getElementById('eq-sidebar-tab');
  const _mobileFilterBtn = document.getElementById('eq-mobile-filter-btn');
  const _sidebarOverlay = document.getElementById('eq-sidebar-overlay');
  const _drawerCloseBtn = document.getElementById('eq-drawer-close-btn');
  const _drawerResetBtn = document.getElementById('eq-drawer-reset-btn');
  const _drawerApplyBtn = document.getElementById('eq-drawer-apply-btn');
  const _lightbox       = document.getElementById('eq-lightbox');
  if (_sidebarTab) {
    _sidebarTab.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      eqOpenSidebar();
    });
    _sidebarTab.addEventListener('pointerup', e => {
      e.preventDefault();
      e.stopPropagation();
      eqOpenSidebar();
    });
  }
  if (_mobileFilterBtn) {
    _mobileFilterBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      eqOpenSidebar();
    });
  }
  if (_sidebarOverlay) _sidebarOverlay.addEventListener('click', eqCloseSidebar);
  if (_drawerCloseBtn) {
    _drawerCloseBtn.addEventListener('click', e => {
      e.preventDefault();
      eqCloseSidebar();
    });
  }
  if (_drawerResetBtn) {
    _drawerResetBtn.addEventListener('click', e => {
      e.preventDefault();
      eqResetDrawer();
    });
  }
  if (_drawerApplyBtn) {
    _drawerApplyBtn.addEventListener('click', e => {
      e.preventDefault();
      eqApplyDrawerFilters();
    });
  }

  /* ── Lightbox keyboard + swipe ── */
  document.addEventListener('keydown', e => {
    if (!document.getElementById('eq-lightbox')?.classList.contains('open')) return;
    if (e.key === 'ArrowLeft')  eqLightboxNav(-1);
    if (e.key === 'ArrowRight') eqLightboxNav(1);
    if (e.key === 'Escape')     eqLightboxClose();
  });
  let _lbTX = 0;
  const _lbEl = document.getElementById('eq-lb-img');
  if (_lbEl) {
    _lbEl.addEventListener('touchstart', e => { _lbTX = e.touches[0].clientX; }, { passive: true });
    _lbEl.addEventListener('touchend',   e => {
      const dx = e.changedTouches[0].clientX - _lbTX;
      if (Math.abs(dx) > 40) eqLightboxNav(dx < 0 ? 1 : -1);
    });
  }
  if (_lightbox) {
    _lightbox.addEventListener('wheel', e => {
      if (!_lightbox.classList.contains('open')) return;
      e.preventDefault();
      eqLightboxZoom(e.deltaY < 0 ? 0.15 : -0.15);
    }, { passive: false });
  }

  eqShowLoading();

  /* بعض المتصفحات (Brave، Firefox+uBlock) تحجب CDN أو Supabase */
  if (typeof supabase === 'undefined') {
    eqShowError('يبدو أن المتصفح يحجب خدمات الموقع. جرّب تعطيل حاجب الإعلانات على هذه الصفحة ثم أعد التحميل.');
    return;
  }

  try {
    eqSb = supabase.createClient(EQ_SUPABASE_URL, EQ_SUPABASE_KEY);
    await eqInitAuth();
    await eqLoadFavorites();
    eqBuildCategoryTabs();
    await eqLoadListings();
    eqBindSearch();
    eqRunLifecycle();

    // الربط العميق للمشروع من الرابط الرئيسي
    const urlParams = new URLSearchParams(window.location.search);
    const listingId = urlParams.get('listing');
    if (listingId) {
      setTimeout(() => {
        eqOpenDetail(listingId);
      }, 500);
    }
  } catch (e) {
    eqShowError('حدث خطأ في تحميل الصفحة. حاول إعادة التحميل.');
  }
});


/* ================================================================
   📊 Google Analytics 4 — تتبع الأحداث
   ================================================================ */

function trackEvent(eventName, params = {}) {
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, params);
  }
}


/* ================================================================
   🔐 القسم 14: المصادقة (مشتركة مع المنصة الرئيسية)
   ================================================================ */

async function eqInitAuth() {
  const { data: { session } } = await eqSb.auth.getSession();
  eqUser = session?.user || null;
  eqRenderNavUser();

  eqSb.auth.onAuthStateChange((_e, sess) => {
    eqUser = sess?.user || null;
    eqRenderNavUser();
    if (eqUser) {
      eqLoadFavorites();
      eqLoadNotifications();
    } else {
      eqFavorites.clear();
      eqNotifications = [];
    }
  });
}

function eqRenderNavUser() {
  const area = document.getElementById('eq-nav-user');
  if (!area) return;
  if (eqUser) {
    const initial = (eqUser.email || '?')[0].toUpperCase();
    const email   = eqUser.email || '';
    const name    = eqUser.user_metadata?.full_name || eqUser.email || '';

    area.innerHTML = `
      <button class="eq-fav-nav-btn" id="eq-fav-nav-btn" onclick="eqOpenFavorites()" title="المفضلة">❤️</button>
      <div class="eq-notif-wrap" id="eq-notif-wrap">
        <button class="eq-notif-btn" onclick="eqToggleNotifPanel(event)">
          🔔<span class="eq-notif-badge" id="eq-notif-badge" style="display:none">0</span>
        </button>
        <div class="eq-notif-panel" id="eq-notif-panel">
          <div class="eq-notif-header">الإشعارات</div>
          <div class="eq-notif-list" id="eq-notif-list"></div>
        </div>
      </div>
      <div class="nav-avatar-btn" id="eq-avatar-btn" onclick="eqToggleAccountMenu(event)">
        <div class="nav-avatar-circle">${initial}</div>
        <div class="nav-avatar-info">
          <div class="nav-avatar-name">${name || 'حسابي'}</div>
          <div class="nav-avatar-email">${email}</div>
        </div>
        <div class="nav-avatar-caret">▼</div>

        <div class="nav-dropdown" id="eq-dropdown">
          <div class="nav-dropdown-header">
            <div class="nav-dropdown-name">${name || 'حسابي'}</div>
            <div class="nav-dropdown-email">${email}</div>
            <div class="nav-dropdown-role">مشاريع للبيع</div>
          </div>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/profile.html'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>
            الملف الشخصي
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/?p=dashboard'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            لوحة التحكم
          </button>
          <button class="nav-dropdown-item" onclick="eqOpenMyListings();eqCloseAccountMenu()">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
            إعلاناتي
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 21h17L12 3 3.5 21Z"/><path d="M12 3v18"/></svg>
            اشترك في بزار
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/?p=market'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            دور على مساحة
          </button>
          <div class="nav-dropdown-sep"></div>
          <button class="nav-dropdown-item danger" onclick="eqSignOut()">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            تسجيل الخروج
          </button>
        </div>
      </div>`;
    eqLoadNotifications();
  } else {
    area.innerHTML = `
      <button class="btn-login-nav" onclick="window.location.href='/?p=login'">
        <svg class="btn-login-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-3.9 3.6-7 8-7s8 3.1 8 7"/>
        </svg>
        <span>دخول</span>
        <span class="btn-login-sep">|</span>
        <span>سجّل</span>
      </button>`;
  }
  eqUpdateBnUser();
}

function eqToggleAccountMenu(e) {
  e.stopPropagation();
  const btn = document.getElementById('eq-avatar-btn');
  const dd  = document.getElementById('eq-dropdown');
  if (!btn || !dd) return;
  if (dd.classList.contains('open')) {
    btn.classList.remove('open');
    dd.classList.remove('open');
  } else {
    btn.classList.add('open');
    dd.classList.add('open');
  }
}

function eqCloseAccountMenu() {
  document.getElementById('eq-avatar-btn')?.classList.remove('open');
  document.getElementById('eq-dropdown')?.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const btn = document.getElementById('eq-avatar-btn');
  if (btn && !btn.contains(e.target)) eqCloseAccountMenu();
  eqCloseNotifPanel();
});

function eqOpenMyListings() {
  document.getElementById('eq-my-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  eqLoadMyListings();
}

function eqCloseMyListings() {
  document.getElementById('eq-my-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function eqSignOut() {
  await eqSb.auth.signOut();
  window.location.reload();
}


/* ================================================================
   📥 القسم 4: تحميل الإعلانات من Supabase
   ================================================================ */

const _EQ_SELECT = `id, title, description, category, condition, price, negotiable,
               region, area, phone, contact_pref,
               cover_image, images, is_featured,
               view_count, contact_count, status,
               expires_at, created_at, user_id`;

async function eqLoadListings(append = false) {
  if (!append) { eqShowLoading(); eqOffset = 0; }
  try {
    const { data, error } = await eqSb
      .from('listings')
      .select(_EQ_SELECT)
      .eq('status', 'approved')
      .gt('expires_at', new Date().toISOString())
      .order('is_featured', { ascending: false })
      .order('created_at',  { ascending: false })
      .range(eqOffset, eqOffset + FETCH_SIZE);   // +1 لكشف وجود المزيد

    if (error) throw error;
    eqHasMore = (data || []).length > FETCH_SIZE;
    const items = eqHasMore ? data.slice(0, FETCH_SIZE) : (data || []);
    eqOffset += items.length;

    eqListings = append ? [...eqListings, ...items] : items;
    eqApplyFilters();
  } catch (e) {
    eqShowError(e.message);
  }
}


/* ================================================================
   🔍 القسم 5: الفلترة والبحث
   ================================================================ */

function eqApplyFilters() {
  let list = [...eqListings];

  if (eqActiveCategory) {
    list = list.filter(l => l.category === eqActiveCategory);
  }
  if (eqSearch.trim()) {
    const q = eqSearch.trim().toLowerCase();
    list = list.filter(l =>
      l.title.toLowerCase().includes(q) ||
      (l.region || '').toLowerCase().includes(q)
    );
  }
  if (eqGov) {
    list = list.filter(l => l.region === eqGov);
  }
  if (eqPriceMax > 0) {
    list = list.filter(l => l.price <= eqPriceMax);
  }

  if (eqSortBy === 'newest') {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } else if (eqSortBy === 'cheapest') {
    list.sort((a, b) => a.price - b.price);
  } else if (eqSortBy === 'views') {
    list.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
  }

  eqFiltered = list;
  eqRenderGrid();
}

function eqBindSearch() {
  const inp = document.getElementById('eq-search');
  if (!inp) return;
  let timer;
  inp.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      eqSearch = inp.value;
      eqApplyFilters();
    }, 300);
  });

  const govSel = document.getElementById('eq-gov');
  if (govSel) govSel.addEventListener('change', () => {
    eqGov = govSel.value;
    eqSyncDrawerFromActive();
    eqApplyFilters();
    eqUpdateDrawerBadge();
  });

  const sortSel = document.getElementById('eq-sort');
  if (sortSel) sortSel.addEventListener('change', () => {
    eqSortBy = sortSel.value;
    eqSyncDrawerFromActive();
    eqApplyFilters();
  });

  const priceInp = document.getElementById('eq-price-max');
  if (priceInp) priceInp.addEventListener('input', () => {
    eqPriceMax = parseInt(priceInp.value) || 0;
    const lbl = document.getElementById('eq-price-label');
    if (lbl) lbl.textContent = eqPriceMax > 0 ? eqPriceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';
    eqSyncDrawerFromActive();
    eqApplyFilters();
    eqUpdateDrawerBadge();
  });
}

function eqSetCategory(cat, el) {
  eqActiveCategory = cat;
  document.querySelectorAll('#eq-tabs .eq-tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  eqSyncDrawerFromActive();
  eqApplyFilters();
  eqUpdateDrawerBadge();
}

function eqBuildCategoryTabs() {
  const cont = document.getElementById('eq-tabs');
  if (!cont) return;
  const all = `<button class="eq-tab on" onclick="eqSetCategory('',this)">الكل</button>`;
  const tabs = EQ_CATEGORIES.map(c =>
    `<button class="eq-tab" onclick="eqSetCategory('${c.id}',this)">${c.label}</button>`
  ).join('');
  cont.innerHTML = all + tabs;

  const govSel = document.getElementById('eq-gov');
  if (govSel) {
    govSel.innerHTML = '<option value="">كل المحافظات</option>' +
      EQ_GOVS.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  /* Build mobile drawer tabs + gov */
  const drawerTabs = document.getElementById('eq-drawer-tabs');
  if (drawerTabs) {
    const drawerAll  = `<button class="eq-tab on" onclick="eqDrawerSetCategory('',this)">الكل</button>`;
    const drawerCats = EQ_CATEGORIES.map(c =>
      `<button class="eq-tab" data-cat="${c.id}" onclick="eqDrawerSetCategory('${c.id}',this)">${c.label}</button>`
    ).join('');
    drawerTabs.innerHTML = drawerAll + drawerCats;
  }
  const drawerGov = document.getElementById('eq-drawer-gov');
  if (drawerGov) {
    drawerGov.innerHTML = '<option value="">كل المحافظات</option>' +
      EQ_GOVS.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  eqInitFilterFab();
}


/* ================================================================
   📱 زر الفلتر الطائر — Mobile Filter FAB
   ================================================================ */

function eqInitFilterFab() {
  if (window.innerWidth > 768) return;

  const filtersBar = document.getElementById('eq-filters-bar');
  const fab        = document.getElementById('eq-filter-fab');
  if (!filtersBar || !fab) return;

  /* بناء تابس الفئات داخل اللوحة */
  const fabTabs = document.getElementById('eq-fab-panel-tabs');
  if (fabTabs) {
    const allBtn = `<button class="eq-tab on" id="eq-fab-all" onclick="eqFabSetCategory('',this)">الكل</button>`;
    const catBtns = EQ_CATEGORIES.map(c =>
      `<button class="eq-tab" onclick="eqFabSetCategory('${c.id}',this)">${c.label}</button>`
    ).join('');
    fabTabs.innerHTML = allBtn + catBtns;
  }

  /* بناء قائمة المحافظات */
  const fabGov = document.getElementById('eq-fab-gov');
  if (fabGov) {
    fabGov.innerHTML = '<option value="">كل المحافظات</option>' +
      EQ_GOVS.map(g => `<option value="${g}">${g}</option>`).join('');
  }

  /* إظهار / إخفاء FAB عند التمرير */
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) {
      fab.classList.add('eq-fab-vis');
    } else {
      fab.classList.remove('eq-fab-vis');
      eqCloseFabPanel();
    }
  }, { threshold: 0, rootMargin: '-68px 0px 0px 0px' });
  observer.observe(filtersBar);

  /* إغلاق اللوحة بالضغط خارجها */
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('eq-fab-panel');
    if (fab && panel && !fab.contains(e.target) && !panel.contains(e.target)) {
      eqCloseFabPanel();
    }
  });
}

function eqToggleFabPanel(e) {
  e.stopPropagation();
  const panel = document.getElementById('eq-fab-panel');
  const fab   = document.getElementById('eq-filter-fab');
  if (!panel || !fab) return;
  const isOpen = panel.classList.contains('eq-fab-open');
  if (isOpen) {
    eqCloseFabPanel();
  } else {
    panel.classList.add('eq-fab-open');
    fab.classList.add('eq-fab-open');
  }
}

function eqCloseFabPanel() {
  document.getElementById('eq-fab-panel')?.classList.remove('eq-fab-open');
  document.getElementById('eq-filter-fab')?.classList.remove('eq-fab-open');
}

function eqUpdateFabBadge() {
  const badge = document.getElementById('eq-fab-badge');
  if (!badge) return;
  const count = (eqActiveCategory ? 1 : 0) + (eqGov ? 1 : 0) + (eqPriceMax > 0 ? 1 : 0);
  badge.textContent = count;
  badge.classList.toggle('show', count > 0);
}

function eqFabSetCategory(cat, el) {
  eqActiveCategory = cat;
  /* تحديث تابس اللوحة */
  document.querySelectorAll('#eq-fab-panel-tabs .eq-tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  /* مزامنة شريط الفئات الرئيسي */
  document.querySelectorAll('#eq-tabs .eq-tab').forEach(t => {
    const isMatch = cat === '' ? t.textContent.trim() === 'الكل'
      : t.getAttribute('onclick')?.includes(`'${cat}'`);
    t.classList.toggle('on', isMatch);
  });
  eqApplyFilters();
  eqUpdateFabBadge();
}

function eqFabGovChange(sel) {
  eqGov = sel.value;
  const main = document.getElementById('eq-gov');
  if (main) main.value = sel.value;
  eqApplyFilters();
  eqUpdateFabBadge();
}

function eqFabSortChange(sel) {
  eqSortBy = sel.value;
  const main = document.getElementById('eq-sort');
  if (main) main.value = sel.value;
  eqApplyFilters();
}

function eqFabPriceChange(inp) {
  eqPriceMax = parseInt(inp.value) || 0;
  const val = document.getElementById('eq-fab-price-val');
  if (val) val.textContent = eqPriceMax > 0 ? eqPriceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';
  const mainInp = document.getElementById('eq-price-max');
  if (mainInp) mainInp.value = inp.value;
  const mainLbl = document.getElementById('eq-price-label');
  if (mainLbl) mainLbl.textContent = eqPriceMax > 0 ? eqPriceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';
  eqApplyFilters();
  eqUpdateFabBadge();
}


/* ================================================================
   📱 Mobile Filter Sidebar Drawer
   ================================================================ */

function eqToggleSidebar() {
  if (document.body.classList.contains('filter-open')) {
    eqCloseSidebar();
  } else {
    eqOpenSidebar();
  }
}

function eqOpenSidebar() {
  eqSyncDrawerFromActive();
  const drawer = document.getElementById('eq-filter-drawer');
  const overlay = document.getElementById('eq-sidebar-overlay');
  document.body.classList.add('filter-open');
  if (drawer) {
    drawer.classList.add('is-open');
    drawer.style.transform = 'translateX(0)';
    drawer.style.pointerEvents = 'auto';
  }
  if (overlay) overlay.style.display = 'block';
  document.getElementById('eq-sidebar-tab')?.setAttribute('aria-expanded', 'true');
  document.getElementById('eq-mobile-filter-btn')?.setAttribute('aria-expanded', 'true');
}

function eqCloseSidebar() {
  const drawer = document.getElementById('eq-filter-drawer');
  const overlay = document.getElementById('eq-sidebar-overlay');
  document.body.classList.remove('filter-open');
  if (drawer) {
    drawer.classList.remove('is-open');
    drawer.style.transform = '';
    drawer.style.pointerEvents = '';
  }
  if (overlay) overlay.style.display = '';
  document.getElementById('eq-sidebar-tab')?.setAttribute('aria-expanded', 'false');
  document.getElementById('eq-mobile-filter-btn')?.setAttribute('aria-expanded', 'false');
}

/* ── Card Carousel ── */
function eqCardNav(carouselId, dir) {
  const wrap = document.getElementById(carouselId);
  if (!wrap) return;
  const slides = wrap.querySelector('.eq-card-slides');
  const dots   = wrap.querySelectorAll('.eq-cn-dot');
  const total  = wrap.querySelectorAll('.eq-card-slide').length;
  const idx    = (parseInt(wrap.dataset.idx || '0') + dir + total) % total;
  wrap.dataset.idx = idx;
  slides.style.transform = `translateX(${-idx * 100}%)`;
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

/* ── Image Lightbox ── */
let eqLbImages = [];
let eqLbIndex  = 0;
let eqLbZoom   = 1;

function eqOpenLightbox(listingId, startIdx) {
  const listing = eqListings.find(l => l.id === listingId);
  if (!listing) return;
  eqLbImages = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  if (!eqLbImages.length) return;
  eqLbIndex = startIdx ?? 0;
  eqLbZoom = 1;
  eqLightboxRender();
}

function eqLightboxRender() {
  const lb      = document.getElementById('eq-lightbox');
  const img     = document.getElementById('eq-lb-img');
  const counter = document.getElementById('eq-lb-counter');
  const prev    = document.getElementById('eq-lb-prev');
  const next    = document.getElementById('eq-lb-next');
  const zoomLbl = document.getElementById('eq-lb-zoom-label');
  if (!lb || !img) return;
  img.src = eqLbImages[eqLbIndex];
  img.style.transform = `scale(${eqLbZoom})`;
  const multi = eqLbImages.length > 1;
  if (counter) { counter.textContent = `${eqLbIndex + 1} / ${eqLbImages.length}`; counter.style.display = multi ? '' : 'none'; }
  if (prev) prev.style.display = multi ? 'flex' : 'none';
  if (next) next.style.display = multi ? 'flex' : 'none';
  if (zoomLbl) zoomLbl.textContent = Math.round(eqLbZoom * 100) + '%';
  lb.classList.add('open');
  document.body.classList.add('lightbox-open');
}

function eqLightboxNav(dir) {
  if (!eqLbImages.length) return;
  eqLbIndex = (eqLbIndex + dir + eqLbImages.length) % eqLbImages.length;
  eqLbZoom = 1;
  eqLightboxRender();
}

function eqLightboxZoom(delta) {
  if (!eqLbImages.length) return;
  eqLbZoom = Math.max(0.5, Math.min(3, Math.round((eqLbZoom + delta) * 100) / 100));
  eqLightboxRender();
}

function eqLightboxResetZoom() {
  eqLbZoom = 1;
  eqLightboxRender();
}

function eqLightboxClose() {
  document.getElementById('eq-lightbox')?.classList.remove('open');
  document.body.classList.remove('lightbox-open');
  eqLbZoom = 1;
}

function eqDrawerSetCategory(cat, el) {
  eqDrawerDraft.category = cat;
  document.querySelectorAll('#eq-drawer-tabs .eq-tab').forEach(t => t.classList.remove('on'));
  if (el) {
    el.dataset.cat = cat || '';
    el.classList.add('on');
  }
  eqUpdateDrawerBadge();
}

function eqDrawerGovChange(sel) {
  eqDrawerDraft.gov = sel.value;
  eqUpdateDrawerBadge();
}

function eqDrawerSortChange(sel) {
  eqDrawerDraft.sortBy = sel.value;
}

function eqDrawerPriceChange(inp) {
  eqDrawerDraft.priceMax = parseInt(inp.value) || 0;
  const label = eqDrawerDraft.priceMax > 0 ? eqDrawerDraft.priceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';
  const drawerVal = document.getElementById('eq-drawer-price-val');
  if (drawerVal) drawerVal.textContent = label;
  eqUpdateDrawerBadge();
}

function eqUpdateDrawerBadge() {
  const count = (eqActiveCategory ? 1 : 0) + (eqGov ? 1 : 0) + (eqPriceMax > 0 ? 1 : 0);
  ['eq-drawer-badge', 'eq-mobile-filter-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  });
}

function eqResetDrawer() {
  eqDrawerDraft = {
    category: '',
    gov: '',
    priceMax: 0,
    sortBy: 'newest',
  };
  eqRenderDrawerDraft();
}

function eqApplyDrawerFilters() {
  eqActiveCategory = eqDrawerDraft.category;
  eqGov = eqDrawerDraft.gov;
  eqPriceMax = eqDrawerDraft.priceMax;
  eqSortBy = eqDrawerDraft.sortBy;

  eqSyncMainFiltersFromActive();
  eqApplyFilters();
  eqUpdateDrawerBadge();
  eqCloseSidebar();
}

function eqSyncDrawerFromActive() {
  eqDrawerDraft = {
    category: eqActiveCategory,
    gov: eqGov,
    priceMax: eqPriceMax,
    sortBy: eqSortBy,
  };
  eqRenderDrawerDraft();
}

function eqRenderDrawerDraft() {
  const drawerGov   = document.getElementById('eq-drawer-gov');
  const drawerSort  = document.getElementById('eq-drawer-sort');
  const drawerPrice = document.getElementById('eq-drawer-price');
  const drawerVal   = document.getElementById('eq-drawer-price-val');
  const label = eqDrawerDraft.priceMax > 0 ? eqDrawerDraft.priceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';

  if (drawerGov)   drawerGov.value   = eqDrawerDraft.gov;
  if (drawerSort)  drawerSort.value  = eqDrawerDraft.sortBy;
  if (drawerPrice) drawerPrice.value = eqDrawerDraft.priceMax;
  if (drawerVal)   drawerVal.textContent = label;

  document.querySelectorAll('#eq-drawer-tabs .eq-tab').forEach(t => {
    const cat = t.dataset.cat ?? '';
    t.classList.toggle('on', cat === eqDrawerDraft.category);
  });
}

function eqSyncMainFiltersFromActive() {
  const mainGov   = document.getElementById('eq-gov');
  const mainSort  = document.getElementById('eq-sort');
  const mainPrice = document.getElementById('eq-price-max');
  const mainLbl   = document.getElementById('eq-price-label');
  const label = eqPriceMax > 0 ? eqPriceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';

  if (mainGov)   mainGov.value   = eqGov;
  if (mainSort)  mainSort.value  = eqSortBy;
  if (mainPrice) mainPrice.value = eqPriceMax;
  if (mainLbl)   mainLbl.textContent = label;

  document.querySelectorAll('#eq-tabs .eq-tab').forEach(t => {
    const onclick = t.getAttribute('onclick') || '';
    const isAll = eqActiveCategory === '' && onclick.includes("eqSetCategory('',");
    const isCat = eqActiveCategory && onclick.includes(`'${eqActiveCategory}'`);
    t.classList.toggle('on', !!(isAll || isCat));
  });
}

function eqStopFilterEvent(e) {
  if (!e) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();
}

function eqInstallMobileFilterControls() {
  const drawer = document.getElementById('eq-filter-drawer');
  if (!drawer) return;

  const openers = [
    document.getElementById('eq-sidebar-tab'),
    document.getElementById('eq-mobile-filter-btn'),
  ].filter(Boolean);
  const overlay = document.getElementById('eq-sidebar-overlay');
  const closeBtn = document.getElementById('eq-drawer-close-btn');
  const resetBtn = document.getElementById('eq-drawer-reset-btn');
  const applyBtn = document.getElementById('eq-drawer-apply-btn');
  const tabs = document.getElementById('eq-drawer-tabs');

  window.__forceMarketFilterOpen = function (e) {
    eqStopFilterEvent(e);
    eqOpenSidebar();
    return false;
  };
  window.__forceMarketFilterClose = function (e) {
    eqStopFilterEvent(e);
    eqCloseSidebar();
    return false;
  };
  window.__forceMarketFilterReset = function (e) {
    eqStopFilterEvent(e);
    eqResetDrawer();
    return false;
  };
  window.__forceMarketFilterApply = function (e) {
    eqStopFilterEvent(e);
    eqApplyDrawerFilters();
    return false;
  };

  openers.forEach(btn => {
    if (btn.dataset.eqAppFilterBound === '1') return;
    btn.dataset.eqAppFilterBound = '1';
    btn.addEventListener('click', window.__forceMarketFilterOpen, true);
  });

  if (overlay && overlay.dataset.eqAppFilterBound !== '1') {
    overlay.dataset.eqAppFilterBound = '1';
    overlay.addEventListener('click', window.__forceMarketFilterClose, true);
  }
  if (closeBtn && closeBtn.dataset.eqAppFilterBound !== '1') {
    closeBtn.dataset.eqAppFilterBound = '1';
    closeBtn.addEventListener('click', window.__forceMarketFilterClose, true);
  }
  if (resetBtn && resetBtn.dataset.eqAppFilterBound !== '1') {
    resetBtn.dataset.eqAppFilterBound = '1';
    resetBtn.addEventListener('click', window.__forceMarketFilterReset, true);
  }
  if (applyBtn && applyBtn.dataset.eqAppFilterBound !== '1') {
    applyBtn.dataset.eqAppFilterBound = '1';
    applyBtn.addEventListener('click', window.__forceMarketFilterApply, true);
  }

  if (tabs && tabs.dataset.eqAppFilterBound !== '1') {
    tabs.dataset.eqAppFilterBound = '1';
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.eq-tab');
      if (!btn) return;
      eqStopFilterEvent(e);
      eqDrawerSetCategory(btn.dataset.cat || '', btn);
    }, true);
  }

  if (document.body.dataset.eqMobileFilterDelegated !== '1') {
    document.body.dataset.eqMobileFilterDelegated = '1';
    const delegatedFilterClick = e => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const pathHas = selector => path.find(node => node?.matches?.(selector));
      const rawTarget = e.target?.nodeType === 1 ? e.target : e.target?.parentElement;
      const target = rawTarget || path.find(node => node?.nodeType === 1);
      if (!target) return;
      const openBtn = pathHas('#eq-mobile-filter-btn, #eq-sidebar-tab') || target.closest?.('#eq-mobile-filter-btn, #eq-sidebar-tab');
      const closeTarget = pathHas('#eq-drawer-close-btn, #eq-sidebar-overlay') || target.closest?.('#eq-drawer-close-btn, #eq-sidebar-overlay');
      const resetTarget = pathHas('#eq-drawer-reset-btn') || target.closest?.('#eq-drawer-reset-btn');
      const applyTarget = pathHas('#eq-drawer-apply-btn') || target.closest?.('#eq-drawer-apply-btn');
      const tabTarget = pathHas('#eq-drawer-tabs .eq-tab') || target.closest?.('#eq-drawer-tabs .eq-tab');

      if (openBtn) {
        eqStopFilterEvent(e);
        eqOpenSidebar();
      } else if (closeTarget) {
        eqStopFilterEvent(e);
        eqCloseSidebar();
      } else if (resetTarget) {
        eqStopFilterEvent(e);
        eqResetDrawer();
      } else if (applyTarget) {
        eqStopFilterEvent(e);
        eqApplyDrawerFilters();
      } else if (tabTarget) {
        eqStopFilterEvent(e);
        eqDrawerSetCategory(tabTarget.dataset.cat || '', tabTarget);
      }
    };
    window.addEventListener('pointerdown', delegatedFilterClick, true);
    window.addEventListener('click', delegatedFilterClick, true);
  }
}

eqInstallMobileFilterControls();
document.addEventListener('DOMContentLoaded', eqInstallMobileFilterControls);
window.addEventListener('load', eqInstallMobileFilterControls);
setTimeout(eqInstallMobileFilterControls, 300);


/* ================================================================
   🃏 القسم 6: بناء كروت الإعلانات
   ================================================================ */

function eqBuildCard(listing) {
  const allImgs = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  const cond    = EQ_CONDITIONS.find(c => c.id === listing.condition)?.label || listing.condition;
  const cat     = EQ_CATEGORIES.find(c => c.id === listing.category)?.label || listing.category;
  const price   = Number(listing.price).toLocaleString('ar-EG');
  const nego    = listing.negotiable ? '<span class="eq-badge eq-badge-nego">قابل للتفاوض</span>' : '';
  const feat    = listing.is_featured ? '<span class="eq-badge eq-badge-feat">⭐ مميز</span>' : '';
  const favIcon = eqFavorites.has(listing.id) ? '❤️' : '🤍';
  const lid     = listing.id;

  let imgAreaHtml;
  if (allImgs.length === 0) {
    imgAreaHtml = `<div class="eq-card-no-img">📦</div>${feat}`;
  } else {
    const slides = allImgs.map((u, i) =>
      `<div class="eq-card-slide"><img src="${_cardUrl(u)}" alt="${listing.title}"${_imgAttrs(true)}
        onclick="eqOpenLightbox('${lid}',${i});event.stopPropagation()"
        onerror="this.parentNode.style.display='none'"></div>`
    ).join('');
    const navHtml = allImgs.length > 1 ? `
      <button class="eq-cn-btn eq-cn-prev" onclick="eqCardNav('eqc-${lid}',-1);event.stopPropagation()" aria-label="السابقة">‹</button>
      <button class="eq-cn-btn eq-cn-next" onclick="eqCardNav('eqc-${lid}',1);event.stopPropagation()" aria-label="التالية">›</button>
      <div class="eq-cn-dots">${allImgs.map((_,i) => `<span class="eq-cn-dot${i===0?' active':''}"></span>`).join('')}</div>` : '';
    imgAreaHtml = `
      <div class="eq-card-carousel${allImgs.length > 1 ? ' has-many' : ''}" id="eqc-${lid}" data-idx="0">
        <div class="eq-card-slides">${slides}</div>
        ${navHtml}
      </div>
      ${feat}`;
  }

  return `
<div class="eq-card" data-category="${listing.category || ''}" data-region="${listing.region || ''}" data-price="${Number(listing.price) || 0}" onclick="eqOpenDetail('${lid}')">
  <div class="eq-card-img" style="position:relative">
    ${imgAreaHtml}
    <button class="eq-fav-btn" data-fav="${lid}" onclick="eqToggleFavorite(event,'${lid}')" title="المفضلة">${favIcon}</button>
  </div>
  <div class="eq-card-body">
    <div class="eq-card-meta">
      <span class="eq-badge eq-badge-cat">${cat}</span>
      <span class="eq-badge eq-badge-cond">${cond}</span>
      ${nego}
    </div>
    <div class="eq-card-title">${listing.title}</div>
    <div class="eq-card-price">${price} ج</div>
    <div class="eq-card-loc">📍 ${listing.region || ''}${listing.area ? ' — ' + listing.area : ''}</div>
  </div>
</div>`;
}


/* ================================================================
   🔄 القسم 7: عرض الشبكة + Load More
   ================================================================ */

function eqRenderGrid() {
  const grid  = document.getElementById('eq-grid');
  const count = document.getElementById('eq-count');
  const more  = document.getElementById('eq-load-more');

  if (!grid) return;

  if (eqFiltered.length === 0) {
    grid.innerHTML = `<div class="eq-empty">لا توجد إعلانات تطابق بحثك 🔍</div>`;
    if (count) count.textContent = '0 إعلان';
    if (more)  more.style.display = 'none';
    return;
  }

  _eqImgCounter = 0; /* أعد العدّاد لتحصل أول 6 صور على fetchpriority=high */
  grid.innerHTML = eqFiltered.map(eqBuildCard).join('');
  if (count) count.textContent = eqFiltered.length + (eqHasMore ? '+' : '') + ' إعلان';
  if (more)  more.style.display = eqHasMore ? 'flex' : 'none';
}

async function eqLoadMore() {
  if (!eqHasMore) return;
  const btn = document.getElementById('eq-load-more');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ تحميل…'; }
  try {
    await eqLoadListings(true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'عرض المزيد'; }
  }
}

function eqShowLoading() {
  const grid = document.getElementById('eq-grid');
  if (grid) grid.innerHTML = `
    <div class="eq-loading">
      <div class="eq-spinner"></div>
      <p>جاري تحميل الإعلانات…</p>
    </div>`;
}

function eqShowError(msg) {
  const grid = document.getElementById('eq-grid');
  if (grid) grid.innerHTML = `
    <div class="eq-empty">
      <p>⚠️ ${msg}</p>
      <button class="eq-btn eq-btn-primary" onclick="eqLoadListings()">حاول تاني</button>
    </div>`;
}


/* ================================================================
   🔎 القسم 8: تفاصيل الإعلان (Modal)
   ================================================================ */

async function eqOpenDetail(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;

  trackEvent('listing_viewed', { listing_id: id, category: listing.category });
  eqIncrementView(id);

  const imgs   = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  const cond   = EQ_CONDITIONS.find(c => c.id === listing.condition)?.label || listing.condition;
  const cat    = EQ_CATEGORIES.find(c => c.id === listing.category)?.label || listing.category;
  const price  = Number(listing.price).toLocaleString('ar-EG');
  const nego   = listing.negotiable ? ' (قابل للتفاوض)' : '';
  const date   = new Date(listing.created_at).toLocaleDateString('ar-EG');

  const swiperId  = `eq-sw-${id}`;
  const galleryHtml = imgs.length > 0
    ? `<div class="eq-detail-gallery">
        <div class="eq-swiper-wrap">
          <div class="eq-swiper" id="${swiperId}">
            ${imgs.map((u, i) => `<div class="eq-swiper-slide"><img src="${_detailUrl(u)}" alt="${listing.title}" loading="lazy" onclick="eqOpenLightbox('${id}',${i})" style="cursor:zoom-in"></div>`).join('')}
          </div>
          ${imgs.length > 1
            ? `<div class="eq-swiper-dots" id="${swiperId}-dots">${imgs.map((_, i) => `<span class="eq-swiper-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
               <button class="eq-swiper-prev" onclick="eqSwiperNav('${swiperId}',-1);event.stopPropagation()" aria-label="السابقة">&#8249;</button>
               <button class="eq-swiper-next" onclick="eqSwiperNav('${swiperId}',1);event.stopPropagation()" aria-label="التالية">&#8250;</button>`
            : ''}
          <button class="eq-share-btn" onclick="eqShare('${id}')" title="مشاركة الإعلان">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
      </div>`
    : `<div class="eq-detail-no-img">📦</div>`;

  const isFav   = eqFavorites.has(id);
  const favBtn  = `<button class="eq-btn eq-btn-ghost" data-fav="${id}" onclick="eqToggleFavorite(event,'${id}')">${isFav ? '❤️ في المفضلة' : '🤍 أضف للمفضلة'}</button>`;

  const contactHtml = eqUser
    ? `${listing.contact_pref !== 'call'
        ? `<a class="eq-btn eq-btn-primary eq-btn-full" href="https://wa.me/2${listing.phone}?text=${encodeURIComponent('مرحبا، شايف إعلانك عن '+listing.title+' في مكاني Spot')}" target="_blank" onclick="eqIncrementContact('${id}')">💬 تواصل عبر واتساب</a>`
        : ''}
       ${listing.contact_pref !== 'whatsapp'
        ? `<a class="eq-btn eq-btn-outline eq-btn-full" href="tel:${listing.phone}" onclick="eqIncrementContact('${id}')">📞 اتصل بالبائع</a>`
        : ''}`
    : `<a class="eq-btn eq-btn-primary eq-btn-full" href="/">🔒 سجّل الدخول لعرض معلومات التواصل</a>`;

  document.getElementById('eq-modal-body').innerHTML = `
    ${galleryHtml}
    <div class="eq-detail-info">
      <div class="eq-detail-badges">
        <span class="eq-badge eq-badge-cat">${cat}</span>
        <span class="eq-badge eq-badge-cond">${cond}</span>
        ${listing.is_featured ? '<span class="eq-badge eq-badge-feat">⭐ مميز</span>' : ''}
      </div>
      <h2 class="eq-detail-title">${listing.title}</h2>
      <div class="eq-detail-price">${price} ج${nego}</div>
      ${listing.description ? `<div class="eq-detail-desc">${listing.description}</div>` : ''}
      <div class="eq-detail-loc">📍 ${listing.region || ''}${listing.area ? ' — ' + listing.area : ''}</div>
      <div class="eq-detail-date">📅 نُشر ${date}</div>
      <div class="eq-detail-stats">👁 ${listing.view_count || 0} مشاهدة</div>
      <div class="eq-detail-actions">
        ${contactHtml}
        ${favBtn}
        <button class="eq-btn eq-btn-ghost" onclick="eqOpenReport('${id}')">🚩 إبلاغ عن إعلان</button>
      </div>
    </div>`;

  document.getElementById('eq-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  /* Swiper scroll → تحديث الـ dots */
  if (imgs.length > 1) {
    const swiper = document.getElementById(swiperId);
    const dots   = document.querySelectorAll(`#${swiperId}-dots .eq-swiper-dot`);
    if (swiper && dots.length) {
      swiper.addEventListener('scroll', () => {
        const idx = Math.round(swiper.scrollLeft / swiper.clientWidth);
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      }, { passive: true });
    }
  }
}

function eqCloseModal() {
  document.getElementById('eq-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function eqSwiperNav(swiperId, dir) {
  const swiper = document.getElementById(swiperId);
  if (!swiper) return;
  swiper.scrollBy({ left: dir * swiper.clientWidth, behavior: 'smooth' });
}

/* زر مشاركة الإعلان — Web Share API أو واتساب */
function eqShare(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
  const price = Number(listing.price).toLocaleString('ar-EG');
  const pageUrl = window.location.origin + window.location.pathname;
  const text  = `🔖 *${listing.title}*\n💰 السعر: ${price} ج\n📍 ${listing.region || ''}\n\n🛒 تصفح المزيد: ${pageUrl}`;

  if (navigator.share) {
    navigator.share({ title: listing.title, text, url: pageUrl }).catch(() => {});
    return;
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}


/* ================================================================
   📊 القسم 19 & 20: عدادات المشاهدات والتواصل
   ================================================================ */

/* Batch view_count: queue IDs, flush every 30 s to avoid a DB write per open */
const _eqViewQueue = new Set();
let   _eqViewTimer = null;

function eqIncrementView(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
  /* Skip listings already seen this browser session */
  if (sessionStorage.getItem('eq_seen_' + id)) return;
  sessionStorage.setItem('eq_seen_' + id, '1');
  listing.view_count = (listing.view_count || 0) + 1;
  _eqViewQueue.add(id);
  if (!_eqViewTimer) _eqViewTimer = setTimeout(_eqFlushViews, 30_000);
}

async function _eqFlushViews() {
  _eqViewTimer = null;
  if (_eqViewQueue.size === 0) return;
  const ids = [..._eqViewQueue];
  _eqViewQueue.clear();
  for (const id of ids) {
    const { error } = await eqSb.rpc('increment_view_count', { listing_id: id });
    if (error) console.warn('[view_count]', error.message);
  }
}

window.addEventListener('beforeunload', _eqFlushViews);

async function eqIncrementContact(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
  trackEvent('listing_contact', { listing_id: id, category: listing.category });
  listing.contact_count = (listing.contact_count || 0) + 1;
  const { error } = await eqSb.rpc('increment_contact_count', { listing_id: id });
  if (error) console.warn('[contact_count RPC]', error.message);
}


/* ================================================================
   🚩 القسم 18: الإبلاغ عن إعلان
   ================================================================ */

function eqOpenReport(id) {
  document.getElementById('eq-report-id').value = id;
  document.getElementById('eq-report-reason').value = '';
  document.getElementById('eq-report-modal').classList.add('open');
}

function eqCloseReport() {
  document.getElementById('eq-report-modal').classList.remove('open');
}

async function eqSubmitReport() {
  const id     = document.getElementById('eq-report-id').value;
  const reason = document.getElementById('eq-report-reason').value.trim();
  if (!reason) { alert('من فضلك اكتب سبب الإبلاغ'); return; }

  const reportData = { listing_id: id, reason, reporter_id: eqUser?.id || null };
  const { error } = await eqSb.from('listing_reports').insert(reportData);
  if (error) { alert('حدث خطأ، حاول مرة أخرى'); return; }

  eqCloseReport();
  eqCloseModal();
  alert('تم إرسال البلاغ، شكراً لمساعدتنا في الحفاظ على جودة المنصة');
}


/* ================================================================
   👤 القسم 15: Dashboard المستخدم — إعلاناتي
   ================================================================ */

async function eqLoadMyListings() {
  if (!eqUser) {
    document.getElementById('eq-my-listings').innerHTML =
      `<div class="eq-empty"><p>يجب تسجيل الدخول أولاً</p><a class="eq-btn eq-btn-primary" href="/">تسجيل الدخول</a></div>`;
    return;
  }

  const { data, error } = await eqSb
    .from('listings')
    .select('*')
    .eq('user_id', eqUser.id)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[eqLoadMyListings]', error);
    document.getElementById('eq-my-listings').innerHTML =
      `<div class="eq-empty"><p>حدث خطأ في تحميل الإعلانات: ${error.message}</p></div>`;
    return;
  }

  const cont = document.getElementById('eq-my-listings');
  if (!cont) return;

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>ما عندكش إعلانات لحد دلوقتي</p><a class="eq-btn eq-btn-primary" href="/post-ad/">انشر إعلانك الأول</a></div>`;
    return;
  }

  eqMyListings = data;
  cont.innerHTML = data.map(l => eqBuildMyCard(l)).join('');
}

function eqBuildMyCard(l) {
  const statusMap = {
    pending:  { label: 'قيد المراجعة', cls: 'eq-status-pending'  },
    approved: { label: 'نشط',          cls: 'eq-status-active'   },
    rejected: { label: 'مرفوض',        cls: 'eq-status-rejected' },
    expired:  { label: 'منتهي',        cls: 'eq-status-expired'  },
    paused:   { label: 'موقوف مؤقتاً', cls: 'eq-status-paused'   },
  };
  const st       = statusMap[l.status] || { label: l.status, cls: '' };
  const exp      = l.expires_at ? new Date(l.expires_at) : null;
  const now      = new Date();
  const days     = exp ? Math.max(0, Math.ceil((exp - now) / 86400000)) : 0;
  const canRenew = l.status === 'approved' && days <= 15 && (l.renewal_count || 0) < MAX_RENEWALS;
  const canEdit  = ['pending','approved','paused','rejected'].includes(l.status);
  const canPause = l.status === 'approved';
  const canResume= l.status === 'paused';

  return `
<div class="eq-my-card">
  <div class="eq-my-card-img">
    ${l.cover_image ? `<img src="${_cardUrl(l.cover_image)}" alt="${l.title}">` : '<div class="eq-card-no-img">📦</div>'}
  </div>
  <div class="eq-my-card-body">
    <div class="eq-my-card-title">${l.title}</div>
    <span class="eq-status ${st.cls}">${st.label}</span>
    ${l.status === 'rejected' && l.reject_reason ? `<div class="eq-rejection-reason">سبب الرفض: ${l.reject_reason}</div>` : ''}
    ${l.status === 'approved'
      ? days <= 7
        ? `<div class="eq-days-warning">⚠️ إعلانك ينتهي بعد <strong>${days}</strong> ${days === 1 ? 'يوم' : 'أيام'} — جدّد الآن</div>`
        : `<div class="eq-days-left">متبقي <strong>${days}</strong> يوم</div>`
      : ''}
    <div class="eq-my-stats">👁 ${l.view_count||0} مشاهدة | 📞 ${l.contact_count||0} تواصل</div>
    <div class="eq-my-actions">
      ${canEdit   ? `<button class="eq-btn eq-btn-outline" onclick="eqOpenEdit('${l.id}')">✏️ تعديل</button>` : ''}
      ${canRenew  ? `<button class="eq-btn eq-btn-primary" onclick="eqRenew('${l.id}')">🔄 تجديد</button>` : ''}
      ${canPause  ? `<button class="eq-btn eq-btn-ghost"  onclick="eqTogglePause('${l.id}','approved')">⏸ إيقاف</button>` : ''}
      ${canResume ? `<button class="eq-btn eq-btn-primary" onclick="eqTogglePause('${l.id}','paused')">▶ تفعيل</button>` : ''}
      <button class="eq-btn eq-btn-danger" onclick="eqDeleteListing('${l.id}','${l.status}')">🗑 حذف</button>
    </div>
  </div>
</div>`;
}


/* ================================================================
   🔄 القسم 16: تجديد الإعلان
   ================================================================ */

async function eqRenew(id) {
  const { data: listing } = await eqSb.from('listings').select('renewal_count, expires_at').eq('id', id).single();
  if (!listing) return;

  if ((listing.renewal_count || 0) >= MAX_RENEWALS) {
    alert('وصلت للحد الأقصى من التجديدات (5 مرات). من فضلك أنشئ إعلاناً جديداً.');
    return;
  }

  const base = new Date(listing.expires_at);
  const now  = new Date();
  const newExpiry = base > now ? new Date(base) : new Date(now);
  newExpiry.setDate(newExpiry.getDate() + LISTING_DAYS);

  const { error } = await eqSb.from('listings').update({
    expires_at:    newExpiry.toISOString(),
    renewal_count: (listing.renewal_count || 0) + 1,
    status:        'approved',
  }).eq('id', id);

  if (error) { alert('حدث خطأ في التجديد'); return; }

  await eqSb.from('listing_renewals').insert({ listing_id: id, user_id: eqUser.id });
  alert('تم تجديد إعلانك بنجاح! ✅');
  eqLoadMyListings();
}


/* ================================================================
   🗑️ القسم 17: حذف الإعلان (Soft Delete)
   ================================================================ */

async function eqDeleteListing(id, status) {
  const msg = status === 'approved'
    ? 'هل أنت متأكد من حذف الإعلان النشط؟ سيُحذف نهائياً مع صوره ولا يمكن التراجع.'
    : 'هل أنت متأكد من الحذف النهائي؟ سيُحذف الإعلان وصوره نهائياً.';
  if (!confirm(msg)) return;

  try {
    const { data: { session } } = await eqSb.auth.getSession();
    const token = session?.access_token;
    if (!token) { alert('يجب تسجيل الدخول أولاً'); return; }

    const res = await fetch('/delete-listing', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body:    JSON.stringify({ id }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      /* Fallback: soft delete إذا فشل الـ Function */
      if (res.status >= 500) {
        const { error } = await eqSb.from('listings')
          .update({ status: 'deleted' })
          .eq('id', id).eq('user_id', eqUser.id);
        if (error) { alert('حدث خطأ في الحذف: ' + error.message); return; }
        alert('تم حذف الإعلان');
        eqLoadMyListings();
        return;
      }
      alert('تعذّر الحذف: ' + (err.error || 'خطأ غير متوقع'));
      return;
    }

    alert('تم حذف الإعلان نهائياً');
    eqLoadMyListings();
  } catch (e) {
    alert('حدث خطأ في الحذف — تحقق من الاتصال وأعد المحاولة');
  }
}


/* ================================================================
   ✏️ القسم 23: تعديل الإعلان
   ================================================================ */

function eqOpenEdit(id) {
  const l = eqMyListings.find(x => x.id === id);
  if (!l) return;

  document.getElementById('eq-edit-id').value     = id;
  document.getElementById('eq-edit-orig-status').value = l.status;

  /* ملء قوائم الاختيار */
  document.getElementById('eq-edit-category').innerHTML =
    EQ_CATEGORIES.map(c => `<option value="${c.id}"${l.category===c.id?' selected':''}>${c.label}</option>`).join('');

  document.getElementById('eq-edit-condition').innerHTML =
    EQ_CONDITIONS.map(c => `<option value="${c.id}"${l.condition===c.id?' selected':''}>${c.label}</option>`).join('');

  document.getElementById('eq-edit-region').innerHTML =
    EQ_GOVS.map(g => `<option value="${g}"${l.region===g?' selected':''}>${g}</option>`).join('');

  /* ملء الحقول */
  document.getElementById('eq-edit-title').value       = l.title        || '';
  document.getElementById('eq-edit-desc').value        = l.description  || '';
  document.getElementById('eq-edit-price').value       = l.price        || '';
  document.getElementById('eq-edit-negotiable').checked= !!l.negotiable;
  document.getElementById('eq-edit-area').value        = l.area         || '';
  document.getElementById('eq-edit-phone').value       = l.phone        || '';
  document.getElementById('eq-edit-contact').value     = l.contact_pref || 'both';

  /* ملاحظة حسب الحالة */
  const note = document.getElementById('eq-edit-note');
  if (l.status === 'approved' || l.status === 'paused') {
    note.className = 'eq-edit-note eq-edit-note-info';
    note.textContent = 'التعديل لن يغيّر حالة الإعلان — سيظل كما هو بعد الحفظ.';
  } else if (l.status === 'rejected') {
    note.className = 'eq-edit-note eq-edit-note-warn';
    note.textContent = 'بعد الحفظ سيُرسل الإعلان للمراجعة مجدداً.';
  } else {
    note.className = 'eq-edit-note eq-edit-note-info';
    note.textContent = 'التعديلات ستُحفظ والإعلان سيبقى قيد المراجعة.';
  }

  document.getElementById('eq-edit-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function eqCloseEdit() {
  document.getElementById('eq-edit-modal').classList.remove('open');
  document.body.style.overflow = '';
}

async function eqSubmitEdit() {
  const id         = document.getElementById('eq-edit-id').value;
  const origStatus = document.getElementById('eq-edit-orig-status').value;
  const title      = document.getElementById('eq-edit-title').value.trim();
  const desc       = document.getElementById('eq-edit-desc').value.trim();
  const price      = parseInt(document.getElementById('eq-edit-price').value) || 0;
  const phone      = document.getElementById('eq-edit-phone').value.trim();

  if (!title)         { alert('من فضلك أدخل عنوان الإعلان');  return; }
  if (!phone)         { alert('من فضلك أدخل رقم التليفون');   return; }
  if (!price || price <= 0) { alert('من فضلك أدخل سعراً صحيحاً'); return; }

  /* الإعلانات المرفوضة تعود للمراجعة بعد التعديل */
  const newStatus = origStatus === 'rejected' ? 'pending' : origStatus;

  const btn = document.getElementById('eq-edit-save-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جاري الحفظ…';

  const { error } = await eqSb.from('listings').update({
    category:     document.getElementById('eq-edit-category').value,
    title,
    description:  desc,
    condition:    document.getElementById('eq-edit-condition').value,
    price,
    negotiable:   document.getElementById('eq-edit-negotiable').checked,
    region:       document.getElementById('eq-edit-region').value,
    area:         document.getElementById('eq-edit-area').value.trim() || null,
    phone,
    contact_pref: document.getElementById('eq-edit-contact').value,
    status:       newStatus,
  }).eq('id', id).eq('user_id', eqUser.id);

  btn.disabled = false;
  btn.textContent = '💾 حفظ التعديلات';

  if (error) { alert('خطأ في الحفظ: ' + error.message); return; }

  /* ── مزامنة الهاتف والمنطقة إلى جدول profiles (تلقائياً) ── */
  if (eqUser && phone) {
    const region = document.getElementById('eq-edit-region')?.value || null;
    const syncData = { id: eqUser.id, phone };
    if (region) syncData.city = region;
    eqSb.from('profiles')
        .upsert(syncData, { onConflict: 'id' })
        .then(() => {}).catch(() => {});
  }

  eqCloseEdit();
  alert(origStatus === 'rejected'
    ? 'تم حفظ التعديلات ✅\nتم إرسال الإعلان للمراجعة مجدداً.'
    : 'تم حفظ التعديلات بنجاح ✅');
  eqLoadMyListings();
}

function eqHandleBnUser() {
  if (eqUser) {
    window.location.href = '/?p=dashboard';
  } else {
    window.location.href = '/?p=login';
  }
}

function eqUpdateBnUser() {
  const icon  = document.getElementById('bn-user-icon');
  const label = document.getElementById('bn-user-label');
  const desc  = document.getElementById('bn-user-desc');
  if (!icon || !label) return;

  if (eqUser) {
    const name    = eqUser.user_metadata?.full_name || eqUser.email || '';
    const initial = (name[0] || '؟').toUpperCase();
    icon.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">${initial}</span>`;
    label.textContent = 'حسابي';
    if (desc) desc.textContent = name.split(' ')[0] || 'مرحباً';
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = 'دخول';
    if (desc) desc.textContent = 'سجّل أو ادخل';
  }
}


/* ================================================================
   ⏸ القسم 24: إيقاف / تفعيل الإعلان
   ================================================================ */

async function eqTogglePause(id, currentStatus) {
  const pausing  = currentStatus === 'approved';
  const newStatus = pausing ? 'paused' : 'approved';
  const msg = pausing
    ? 'هل تريد إيقاف الإعلان مؤقتاً؟ لن يظهر للمستخدمين حتى تعيد تفعيله.'
    : 'هل تريد إعادة تفعيل الإعلان؟ سيظهر للمستخدمين فوراً.';
  if (!confirm(msg)) return;

  const { error } = await eqSb.from('listings')
    .update({ status: newStatus })
    .eq('id', id).eq('user_id', eqUser.id);

  if (error) { alert('حدث خطأ: ' + error.message); return; }
  alert(pausing ? 'تم إيقاف الإعلان مؤقتاً ⏸' : 'تم تفعيل الإعلان بنجاح ✅');
  eqLoadMyListings();
}


/* ================================================================
   ⏰ القسم 22: Lifecycle & Expiry Handler (Lazy Evaluation)
   ================================================================ */

async function eqRunLifecycle() {
  /* RPC يجاوز RLS — يتطلب دالة expire_listings في Supabase */
  try {
    await eqSb.rpc('expire_listings');
  } catch (_) {
    /* Lifecycle is best-effort and must not block the market page. */
  }
}


/* ================================================================
   🛠️ القسم 21: دوال مساعدة
   ================================================================ */

function eqFmtDate(iso) {
  return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}

function eqCatLabel(id) {
  return EQ_CATEGORIES.find(c => c.id === id)?.label || id;
}

function eqCondLabel(id) {
  return EQ_CONDITIONS.find(c => c.id === id)?.label || id;
}

/* إغلاق المودالات عند الضغط على الخلفية */
document.addEventListener('click', e => {
  if (e.target.id === 'eq-modal')        eqCloseModal();
  if (e.target.id === 'eq-report-modal') eqCloseReport();
  if (e.target.id === 'eq-my-modal')     eqCloseMyListings();
  if (e.target.id === 'eq-fav-modal')    eqCloseFavorites();
  if (e.target.id === 'eq-edit-modal')   eqCloseEdit();
});


/* ================================================================
   ⭐ القسم 21: المفضلة
   ================================================================ */

function eqUpdateFavBtn() {
  const btn = document.getElementById('eq-fav-nav-btn');
  if (!btn) return;
  if (eqFavorites.size > 0) {
    btn.classList.add('has-favs');
    btn.title = `المفضلة (${eqFavorites.size})`;
  } else {
    btn.classList.remove('has-favs');
    btn.title = 'المفضلة';
  }
}

async function eqLoadFavorites() {
  if (!eqUser) return;
  const { data } = await eqSb
    .from('favorites')
    .select('listing_id')
    .eq('user_id', eqUser.id);
  eqFavorites = new Set((data || []).map(f => f.listing_id));
  eqUpdateFavBtn();
}

async function eqToggleFavorite(e, id) {
  e.stopPropagation();
  if (!eqUser) { window.location.href = '/'; return; }

  const isFav = eqFavorites.has(id);
  const allBtns = document.querySelectorAll(`[data-fav="${id}"]`);

  if (isFav) {
    await eqSb.from('favorites').delete()
      .eq('user_id', eqUser.id).eq('listing_id', id);
    eqFavorites.delete(id);
    allBtns.forEach(b => {
      b.textContent = b.classList.contains('eq-fav-btn') ? '🤍' : '🤍 أضف للمفضلة';
    });
  } else {
    await eqSb.from('favorites').insert({ user_id: eqUser.id, listing_id: id });
    eqFavorites.add(id);
    allBtns.forEach(b => {
      b.textContent = b.classList.contains('eq-fav-btn') ? '❤️' : '❤️ في المفضلة';
    });
  }
  eqUpdateFavBtn();
}

async function eqOpenFavorites() {
  eqCloseAccountMenu();
  document.getElementById('eq-fav-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  const cont = document.getElementById('eq-fav-body');
  if (eqFavorites.size === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>لا توجد مشاريع مفضلة</p><a class="eq-btn eq-btn-primary" href="/market/">تصفح المشاريع</a></div>`;
    return;
  }

  cont.innerHTML = `<div class="eq-loading"><div class="eq-spinner"></div><p>جاري التحميل…</p></div>`;

  const { data } = await eqSb
    .from('listings')
    .select('id, title, cover_image, price, region, status, category')
    .in('id', [...eqFavorites]);

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>لا توجد إعلانات مفضلة</p></div>`;
    return;
  }

  cont.innerHTML = data.map(l => {
    const img = l.cover_image
      ? `<img src="${_cardUrl(l.cover_image)}" alt="${l.title}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0">`
      : `<div style="width:60px;height:60px;background:#F3F4F6;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px">📦</div>`;
    const price = Number(l.price).toLocaleString('ar-EG');
    return `
    <div style="display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid #F0F0F0">
      <div style="cursor:pointer;display:flex;gap:12px;align-items:center;flex:1;min-width:0" onclick="eqCloseFavorites();eqOpenDetail('${l.id}')">
        ${img}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.title}</div>
          <div style="color:var(--orange);font-weight:800;font-size:14px">${price} ج</div>
          <div style="font-size:12px;color:#999">📍 ${l.region || ''}</div>
        </div>
      </div>
      <button data-fav="${l.id}" onclick="eqToggleFavorite(event,'${l.id}');this.closest('div[style]').remove()"
        style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;flex-shrink:0" title="إزالة من المفضلة">❤️</button>
    </div>`;
  }).join('');
}

function eqCloseFavorites() {
  document.getElementById('eq-fav-modal')?.classList.remove('open');
  document.body.style.overflow = '';
}


/* ================================================================
   🔔 القسم 22: الإشعارات
   ================================================================ */

async function eqLoadNotifications() {
  if (!eqUser) return;
  const { data } = await eqSb
    .from('notifications')
    .select('*')
    .eq('owner_id', eqUser.id.toString())
    .order('created_at', { ascending: false })
    .limit(30);
  eqNotifications = data || [];
  eqUpdateNotifBadge();
}

function eqUpdateNotifBadge() {
  const badge = document.getElementById('eq-notif-badge');
  if (!badge) return;
  const count = eqNotifications.filter(n => !n.is_read).length;
  badge.textContent = count > 9 ? '9+' : count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function eqToggleNotifPanel(e) {
  e.stopPropagation();
  eqCloseAccountMenu();
  const panel = document.getElementById('eq-notif-panel');
  const isOpen = panel.classList.contains('open');
  if (isOpen) {
    panel.classList.remove('open');
  } else {
    panel.classList.add('open');
    eqRenderNotifications();
    eqMarkNotifsRead();
  }
}

function eqCloseNotifPanel() {
  document.getElementById('eq-notif-panel')?.classList.remove('open');
}

function eqRenderNotifications() {
  const cont = document.getElementById('eq-notif-list');
  if (!cont) return;
  if (eqNotifications.length === 0) {
    cont.innerHTML = `<div style="text-align:center;padding:30px 20px;color:#999;font-size:14px">لا توجد إشعارات</div>`;
    return;
  }
  cont.innerHTML = eqNotifications.map(n => {
    const time = new Date(n.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
    const clickable = n.listing_id ? `onclick="eqCloseNotifPanel();eqOpenDetail('${n.listing_id}')" style="cursor:pointer"` : '';
    return `
    <div class="eq-notif-item${n.is_read ? '' : ' unread'}" ${clickable}>
      <div class="eq-notif-title">${n.title}</div>
      ${n.body ? `<div class="eq-notif-body">${n.body}</div>` : ''}
      <div class="eq-notif-time">${time}</div>
    </div>`;
  }).join('');
}

async function eqMarkNotifsRead() {
  const unreadIds = eqNotifications.filter(n => !n.is_read).map(n => n.id);
  if (unreadIds.length === 0) return;
  await eqSb.from('notifications').update({ is_read: true })
    .in('id', unreadIds).eq('owner_id', eqUser.id.toString());
  eqNotifications.forEach(n => { n.is_read = true; });
  eqUpdateNotifBadge();
}
