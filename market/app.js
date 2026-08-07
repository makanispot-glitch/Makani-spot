/* ================================================================
   📁 equipment-app.js — منطق سوق المعدات
   ================================================================ */


/* ================================================================
   ⚙️ القسم 1: الإعدادات
   ================================================================ */

const EQ_SUPABASE_URL = SUPABASE_URL;
const EQ_SUPABASE_KEY = SUPABASE_KEY;
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

/* تصنيفات قديمة من تسمية «سوق المعدات» قبل تحويل القسم لمشاريع كاملة.
   إعلانات منشورة فعلًا لسه شايلة الـid القديم في DB، وكانت النتيجة إنها:
   (١) متظهرش تحت أي تبويب تصنيف — مفيش زر بيطابقها أصلًا، فتبقى غير قابلة
   للوصول بالفلتر، و(٢) بادج التصنيف في الكرت بيطبع الـid الخام بالإنجليزي
   (food-cart) لأن eqCatLabel بترجع defaultValue وقت غياب الترجمة.
   الخريطة دي بتطبّع القديم للحالي وقت القراءة فقط — من غير أي كتابة في DB،
   فتفضل شغّالة كمان لو ظهر إعلان قديم تاني بعد تجديد. */
const EQ_CATEGORY_ALIASES = {
  'food-cart':  'food-juice-cart',
  'partition':  'fast-food-partition',
  'fridge':     'other',
  'display':    'other',
  'kitchen':    'other',
  'coffee':     'other',
  'pos':        'other',
  'storage':    'other',
  'lighting':   'other',
};

/* التصنيف المعياري للإعلان: يرجّع الـid الحالي مهما كان المخزَّن قديمًا */
function eqNormCat(id) {
  return EQ_CATEGORY_ALIASES[id] || id || '';
}

/* كل الـids اللي بتنتمي لتصنيف واحد (الحالي + أي قديم بيأشّر عليه) —
   تُستخدم في استعلام الفلترة عشان يطلع القديم والجديد مع بعض */
function eqCatIds(catId) {
  const ids = [catId];
  for (const [legacy, current] of Object.entries(EQ_CATEGORY_ALIASES)) {
    if (current === catId) ids.push(legacy);
  }
  return ids;
}

/* شرائح السعر الجاهزة — أسرع طريق للمستخدم بدل ضبط قيمة بالمللي‑متر.
   كان في السابق سلايدر واحد أقصاه 100,000 بينما أسعار المشاريع المنشورة
   بتوصل 1,500,000 — يعني تحريكه لآخر اليمين كان *يستبعد* الإعلانات الأغلى
   ومفيش طريقة أصلًا لضبط حد أعلى منه. */
const EQ_PRICE_TIERS = [
  { id: 'any', min: 0,      max: 0 },
  { id: 't1',  min: 0,      max: 50000 },
  { id: 't2',  min: 50000,  max: 150000 },
  { id: 't3',  min: 150000, max: 500000 },
  { id: 't4',  min: 500000, max: 0 },
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
let eqAvatarUrl      = null;
let eqListings       = [];
let eqFiltered       = [];
/* هل اكتمل أول جلب فعلي؟ نفس علّة spaces/app.js: makani:locale-changed يُطلق مرة
   عند اكتمال initI18n، وملفات locales تأتي من كاش الـSW قبل استعلام listings
   بمئات المللي‑ثانية — فكان eqRenderGrid يقرأ eqFiltered=[] ويرسم الحالة الفارغة
   فوق الـspinner. يُرفع في eqLoadListings وحدها (لا في eqApplyFilters) لأن الأخيرة
   يستدعيها كل تفاعل فلترة وقد يسبق أول جلب. */
let eqDataReady      = false;
let eqOffset         = 0;     // offset للجلب التالي من الخادم
let eqHasMore        = false; // هل يوجد المزيد على الخادم
let eqActiveCategory = '';
let eqSearch        = '';
let eqSortBy        = 'newest';
let eqGov           = '';
let eqPriceMin      = 0;
let eqPriceMax      = 0;
let eqTotalCount    = 0;      // العدد الحقيقي للنتائج المطابقة على الخادم
let eqFavorites     = new Set();
let eqMyListings    = [];
/* عدّادات لكل تصنيف/محافظة فوق *كل* الإعلانات الحية (لا الصفحة المحمَّلة) —
   تُعرض على الشرائح فيعرف المستخدم فين النتائج قبل ما يضغط */
let eqFacets        = { cats: new Map(), govs: new Map(), total: 0 };
/* عيّنة من أول صفحة بلا فلاتر — تُستخدم في اقتراحات الحالة الفارغة بعد ما
   بقت eqListings تحمل النتائج المفلترة وحدها */
let eqSampleListings = [];
let _eqSampleFetching = false;
let eqDrawerDraft   = {
  category: '',
  gov: '',
  sortBy: 'newest',
  priceMin: 0,
  priceMax: 0,
};

document.addEventListener('DOMContentLoaded', async () => {

  eqInitFilterBarSticky();

  /* ── Sidebar events — attached first, before any early return ── */
  const _sidebarTab     = document.getElementById('eq-sidebar-tab');
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
    eqShowError(t('error.adBlocker'));
    return;
  }

  try {
    eqSb = supabase.createClient(EQ_SUPABASE_URL, EQ_SUPABASE_KEY);
    await eqInitAuth();
    await eqLoadFavorites();
    eqReadUrlFilters();          // فلاتر جاية من رابط مُشارَك / رجوع المتصفح
    eqInitView();                // شبكة/قائمة من الجلسة السابقة
    await eqLoadFacets();        // العدّادات لازم تسبق بناء الشرائح
    eqBuildCategoryTabs();
    eqSyncDrawerFromActive();
    eqBindSearch();
    await eqLoadListings();
    eqRunLifecycle();

    // الربط العميق للمشروع من الرابط الرئيسي
    const urlParams = new URLSearchParams(window.location.search);
    const listingId = urlParams.get('listing');
    const manageId  = urlParams.get('manage');
    if (listingId) {
      setTimeout(() => {
        eqOpenDetail(listingId);
      }, 500);
    } else if (manageId && eqUser) {
      /* من إشعار "إعلانك أوشك على الانتهاء" — يفتح على شاشة تعديل الإعلان مباشرة */
      setTimeout(async () => {
        document.getElementById('eq-my-modal').classList.add('open');
        document.body.style.overflow = 'hidden';
        await eqLoadMyListings();
        eqOpenEdit(manageId);
      }, 500);
    } else if (urlParams.get('myListings') && eqUser) {
      setTimeout(() => {
        eqOpenMyListings();
      }, 500);
    }
  } catch (e) {
    eqShowError(t('error.pageLoadError'));
  }
});

/* إعادة رسم المحتوى الديناميكي عند تبديل اللغة — نفس نمط spaces/app.js
   (data-i18n بتغطي النص الثابت بس؛ الكروت/المودالات المبنية بـ t() وقت
   البناء محتاجة إعادة رسم فعلية من البيانات المحفوظة محليًا، بدون طلب
   Supabase جديد، عشان التبديل يفضل سريع وسلس) */
document.addEventListener('makani:locale-changed', () => {
  eqRenderNavUser();   // منطقة المستخدم في الناف + bn-user (بالكامل JS-rendered، مفيش data-i18n)
  eqBuildCategoryTabs();
  eqRenderDrawerDraft();
  eqRenderGrid();
  if (eqCurrentDetailId) eqOpenDetail(eqCurrentDetailId);
  if (document.getElementById('eq-my-modal')?.classList.contains('open')) eqLoadMyListings();
  if (document.getElementById('eq-fav-modal')?.classList.contains('open')) eqOpenFavorites();
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
  if (eqUser) {
    const { data: prof } = await eqSb.from('profiles')
      .select('avatar_url').eq('id', eqUser.id).single();
    eqAvatarUrl = prof?.avatar_url || null;   // 🪪 المصدر الموحّد
  }
  eqRenderNavUser();
  if (eqUser) GN.init(eqSb, eqUser.id);

  eqSb.auth.onAuthStateChange(async (_e, sess) => {
    eqUser = sess?.user || null;
    if (eqUser) {
      const { data: prof } = await eqSb.from('profiles')
        .select('avatar_url').eq('id', eqUser.id).single();
      eqAvatarUrl = prof?.avatar_url || null;   // 🪪 المصدر الموحّد
    } else {
      eqAvatarUrl = null;
    }
    eqRenderNavUser();
    if (eqUser) {
      eqLoadFavorites();
      GN.init(eqSb, eqUser.id);
    } else {
      eqFavorites.clear();
      GN.destroy();
    }
  });
}

function eqRenderNavUser() {
  const area = document.getElementById('eq-nav-user');
  if (!area) return;

  // زر تبديل اللغة المستقل يفضل ظاهر للزائر غير المسجّل فقط — المستخدم
  // المسجّل بيغيّر اللغة من داخل القائمة المنسدلة بدل ما يزدحم الناف.
  const langBtn = document.getElementById('langSwitchBtn');
  if (langBtn && eqUser) {
    langBtn.remove();
  } else if (langBtn) {
    langBtn.style.display = '';
  }

  if (eqUser) {
    const initial   = (eqUser.user_metadata?.full_name || eqUser.email || '?')[0].toUpperCase();
    const email     = eqUser.email || '';
    const name      = eqUser.user_metadata?.full_name || eqUser.email || '';
    const circleHtml = eqAvatarUrl
      ? `<img src="${eqAvatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.outerHTML='${initial}'">`
      : initial;

    area.innerHTML = `
      <button class="eq-fav-nav-btn" id="eq-fav-nav-btn" onclick="eqOpenFavorites()" title="${t('card.favoriteTitle')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.9a5.4 5.4 0 0 0-7.6 0L12 6.1l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.5a5.4 5.4 0 0 0 0-7.6Z"/></svg>
        <span class="eq-fav-badge" id="eq-fav-badge"></span>
      </button>
      <button class="eq-fav-nav-btn" id="eq-mylistings-nav-btn" onclick="eqOpenMyListings()" title="${t('navUser.myListings')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
      </button>
      
      <!-- جرس الإشعارات الموحد -->
      <div id="gn-bell" class="gn-bell" role="button" aria-label="الإشعارات">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span id="gn-badge" class="gn-badge"></span>
      </div>

      <div class="nav-avatar-btn" id="eq-avatar-btn" onclick="eqToggleAccountMenu(event)">
        <div class="nav-avatar-circle">${circleHtml}</div>
        <div class="nav-avatar-info">
          <div class="nav-avatar-name">${name || t('navUser.defaultName')}</div>
          <div class="nav-avatar-email">${email}</div>
        </div>
        <div class="nav-avatar-caret">▼</div>

        <div class="nav-dropdown" id="eq-dropdown">
          <div class="nav-dropdown-header">
            <div class="nav-dropdown-name">${name || t('navUser.defaultName')}</div>
            <div class="nav-dropdown-email">${email}</div>
            <div class="nav-dropdown-role">${t('navUser.roleLabel')}</div>
          </div>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/profile.html'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>
            ${t('navUser.profile')}
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/?p=dashboard'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            ${t('navUser.dashboard')}
          </button>
          <button class="nav-dropdown-item" onclick="eqOpenMyListings();eqCloseAccountMenu()">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
            ${t('navUser.myListings')}
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 21h17L12 3 3.5 21Z"/><path d="M12 3v18"/></svg>
            ${t('navUser.joinBazaar')}
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/?p=market'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            ${t('navUser.findSpace')}
          </button>
          <button class="nav-dropdown-item" onclick="window.location.href='/articles/'">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            ${t('userMenu.knowledge')}
          </button>
          <div class="nav-dropdown-sep"></div>
          <button type="button" class="nav-dropdown-item nav-dd-lang-trigger" id="eq-lang-trigger" onclick="eqToggleLangPanel(event)">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20 15.3 15.3 0 0 1 0-20z"/></svg>
            <span class="nav-dd-lang-label">${t('navUser.language')}</span>
            <span class="nav-dd-lang-current">${getLocale() === 'en' ? 'English' : 'العربية'}</span>
            <span class="nav-dd-lang-caret">▼</span>
          </button>
          <div class="nav-dd-lang-panel" id="eq-lang-panel">
            <button type="button" class="nav-dd-lang-opt${getLocale() === 'ar' ? ' active' : ''}" data-locale="ar" onclick="eqSelectLocale('ar', event)">
              <span class="nav-dd-lang-optlabel"><span class="nav-dd-lang-flag">🇪🇬</span>العربية</span>
              <span class="nav-dd-lang-check">✓</span>
            </button>
            <button type="button" class="nav-dd-lang-opt${getLocale() === 'en' ? ' active' : ''}" data-locale="en" onclick="eqSelectLocale('en', event)">
              <span class="nav-dd-lang-optlabel"><span class="nav-dd-lang-flag">🇬🇧</span>English</span>
              <span class="nav-dd-lang-check">✓</span>
            </button>
          </div>
          <div class="nav-dropdown-sep"></div>
          <button class="nav-dropdown-item danger" onclick="eqSignOut()">
            <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
            ${t('navUser.logout')}
          </button>
        </div>
      </div>`;
    GN.mount(area);
  } else {
    area.innerHTML = `
      <button class="btn-login-nav" onclick="window.location.href='/?p=login'">
        <svg class="btn-login-nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4"/>
          <path d="M4 20c0-3.9 3.6-7 8-7s8 3.1 8 7"/>
        </svg>
        <span>${t('nav.loginBtn')}</span>
        <span class="btn-login-sep">|</span>
        <span>${t('nav.signupBtn')}</span>
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
    // كل مرة تتفتح القائمة تفتح مقفولة — بدون ما تفضل موسّعة من مرة سابقة
    document.getElementById('eq-lang-trigger')?.classList.remove('open');
    document.getElementById('eq-lang-panel')?.classList.remove('open');
  }
}

/* عنصر "اللغة" داخل القائمة المنسدلة — أكورديون بسيط بيفتح خياري عربي/إنجليزي
   بدل التنقل المباشر (setLocale/getLocale نفسها لم تتغيّر). */
function eqToggleLangPanel(e) {
  e.stopPropagation();
  document.getElementById('eq-lang-trigger')?.classList.toggle('open');
  document.getElementById('eq-lang-panel')?.classList.toggle('open');
}

function eqSelectLocale(locale, e) {
  e.stopPropagation();
  setLocale(locale, eqSb && eqUser ? { sbClient: eqSb, userId: eqUser.id } : undefined);
}

function eqCloseAccountMenu() {
  document.getElementById('eq-avatar-btn')?.classList.remove('open');
  document.getElementById('eq-dropdown')?.classList.remove('open');
}

document.addEventListener('click', (e) => {
  const btn = document.getElementById('eq-avatar-btn');
  if (btn && !btn.contains(e.target)) eqCloseAccountMenu();
  /* gn-panel يُغلق من _outside listener داخل GN module */
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

/* الفلترة بقت على الخادم لا في الذاكرة.
   قبلها كانت eqApplyFilters بتفلتر eqListings — وهي أول 24 إعلان فقط —
   فأي تصنيف نتائجه بعد أول صفحة كان بيطلع «لا توجد إعلانات» وهو مليان،
   والعدّاد كان بيقول «24+» من غير ما يعرف الإجمالي الحقيقي. */
function _eqBuildQuery(opts = {}) {
  let q = eqSb.from('listings')
    .select(opts.select || _EQ_SELECT, opts.countOpts)
    .eq('status', 'approved')
    .gt('expires_at', new Date().toISOString());

  const cat = opts.category !== undefined ? opts.category : eqActiveCategory;
  const gov = opts.gov      !== undefined ? opts.gov      : eqGov;
  const pMin = opts.priceMin !== undefined ? opts.priceMin : eqPriceMin;
  const pMax = opts.priceMax !== undefined ? opts.priceMax : eqPriceMax;
  const term = (opts.search !== undefined ? opts.search : eqSearch).trim();

  if (cat)      q = q.in('category', eqCatIds(cat));
  if (gov)      q = q.eq('region', gov);
  if (pMin > 0) q = q.gte('price', pMin);
  if (pMax > 0) q = q.lte('price', pMax);
  if (term) {
    /* الفاصلة والأقواس والنسبة لها معنى في صياغة or= الخاصة بـPostgREST،
       فتنظَّف من نص المستخدم قبل الحقن وإلا انكسر الاستعلام كله */
    const s = term.replace(/[%,()]/g, ' ').trim();
    if (s) q = q.or(`title.ilike.%${s}%,region.ilike.%${s}%,area.ilike.%${s}%`);
  }
  return q;
}

function _eqApplySort(q, sortBy = eqSortBy) {
  if (sortBy === 'cheapest')  return q.order('price', { ascending: true });
  if (sortBy === 'priciest')  return q.order('price', { ascending: false });
  if (sortBy === 'views')     return q.order('view_count', { ascending: false, nullsFirst: false });
  return q.order('is_featured', { ascending: false })
          .order('created_at',  { ascending: false });
}

/* جلب واحد خفيف (٣ أعمدة) فوق كل الإعلانات الحية — منه تتبني عدّادات
   الشرائح وقائمة المحافظات، فتكون الأرقام إجمالية لا أرقام الصفحة */
async function eqLoadFacets() {
  try {
    const { data, error } = await eqSb
      .from('listings')
      .select('category, region')
      .eq('status', 'approved')
      .gt('expires_at', new Date().toISOString())
      .limit(2000);
    if (error) throw error;

    const cats = new Map(), govs = new Map();
    (data || []).forEach(l => {
      const c = eqNormCat(l.category);
      if (c) cats.set(c, (cats.get(c) || 0) + 1);
      if (l.region) govs.set(l.region, (govs.get(l.region) || 0) + 1);
    });
    eqFacets = { cats, govs, total: (data || []).length };
  } catch (e) {
    eqFacets = { cats: new Map(), govs: new Map(), total: 0 };
  }
}

let _eqLoadSeq = 0;   // يمنع رد استعلام قديم من الكتابة فوق أحدث منه

async function eqLoadListings(append = false) {
  if (!append) {
    eqOffset = 0;
    /* السبينر الكامل لأول تحميل وحده. بعده أي تغيير فلتر بيخفّت الشبكة
       الحالية بدل ما يمسحها — الوميض بين كل ضغطة والنتيجة كان بيخلي
       الفلترة تبان أبطأ مما هي، والعدّاد كان بيفضل شايل رقم الفلتر السابق */
    if (!eqDataReady) eqShowLoading(); else eqSetBusy(true);
  }
  const seq = ++_eqLoadSeq;
  try {
    const q = _eqApplySort(_eqBuildQuery({ countOpts: { count: 'exact' } }))
      .range(eqOffset, eqOffset + FETCH_SIZE - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    if (seq !== _eqLoadSeq) return;   // نتيجة متأخرة لفلتر اتغيّر بعدها

    const items = data || [];
    eqOffset += items.length;
    eqTotalCount = count ?? items.length;
    eqHasMore    = eqOffset < eqTotalCount;

    eqListings = append ? [...eqListings, ...items] : items;
    if (!append && !eqHasActiveFilters() && items.length) eqSampleListings = items.slice(0, 6);
    eqDataReady = true;   // خارج catch: لو فشل الجلب تبقى شاشة الخطأ لا «لا نتائج»
    eqFiltered = eqListings;
    eqSetBusy(false);
    eqRenderGrid();
    eqRenderFilterState();
  } catch (e) {
    if (seq === _eqLoadSeq) { eqSetBusy(false); eqShowError(e.message); }
  }
}

/* ================================================================
   🔲 تبديل العرض: شبكة / قائمة (ديسكتوب)
   الاتنين بيستخدموا نفس الـHTML بالظبط، فالتبديل كلاس واحد على الحاوية:
   بلا إعادة بناء للكروت، يعني الفلاتر والترتيب وموضع التمرير وحالة كل
   كاروسيل بتفضل زي ما هي، والانتقال فوري بلا أي طلب شبكة.
   ================================================================ */

const EQ_VIEW_KEY = 'makani_market_view';

function eqInitView() {
  let saved = 'grid';
  try { saved = localStorage.getItem(EQ_VIEW_KEY) || 'grid'; } catch (e) {}
  eqSetView(saved === 'list' ? 'list' : 'grid', { persist: false });
}

function eqSetView(view, opts = {}) {
  const grid = document.getElementById('eq-grid');
  if (grid) grid.classList.toggle('is-list', view === 'list');
  document.querySelectorAll('.eq-view-btn').forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  if (opts.persist !== false) {
    try { localStorage.setItem(EQ_VIEW_KEY, view); } catch (e) {}
  }
}

/* حالة «جارٍ التحديث» الخفيفة — الشبكة تفضل مكانها مخفوتة وغير قابلة للضغط */
function eqSetBusy(on) {
  document.getElementById('eq-grid')?.classList.toggle('is-busy', !!on);
  const count = document.getElementById('eq-count');
  if (count && on) count.textContent = t('grid.updating');
}


/* ================================================================
   🔍 القسم 5: الفلترة والبحث
   ================================================================ */

function eqHasActiveFilters() {
  return !!(eqActiveCategory || eqGov || eqPriceMin > 0 || eqPriceMax > 0 || eqSearch.trim());
}

function eqActiveFilterCount() {
  return (eqActiveCategory ? 1 : 0) + (eqGov ? 1 : 0) +
         ((eqPriceMin > 0 || eqPriceMax > 0) ? 1 : 0) + (eqSearch.trim() ? 1 : 0);
}

/* نقطة الدخول الوحيدة لإعادة الفلترة — تُعيد الجلب من الصفر وتحدّث الواجهة.
   التأجيل مكانه مستمع البحث وحده (300ms)؛ باقي الفلاتر ضغطة واحدة صريحة */
function eqApplyFilters() {
  eqSyncUrl();
  eqLoadListings(false);
  eqRenderFilterState();
}

function eqBindSearch() {
  const inp = document.getElementById('eq-search');
  if (inp && !inp.dataset.eqBound) {
    inp.dataset.eqBound = '1';
    let timer;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        eqSearch = inp.value;
        eqApplyFilters();
      }, 300);
    });
  }

  const govSel = document.getElementById('eq-gov');
  if (govSel && !govSel.dataset.eqBound) {
    govSel.dataset.eqBound = '1';
    govSel.addEventListener('change', () => { eqGov = govSel.value; eqApplyFilters(); });
  }

  const sortSel = document.getElementById('eq-sort');
  if (sortSel && !sortSel.dataset.eqBound) {
    sortSel.dataset.eqBound = '1';
    sortSel.addEventListener('change', () => { eqSortBy = sortSel.value; eqApplyFilters(); });
  }

  /* لوحة السعر — تُغلق بالضغط خارجها أو بـEsc */
  if (!document.body.dataset.eqPriceBound) {
    document.body.dataset.eqPriceBound = '1';
    document.addEventListener('click', e => {
      const pop = document.getElementById('eq-price-pop');
      const btn = document.getElementById('eq-price-btn');
      if (!pop || !pop.classList.contains('open')) return;
      if (!pop.contains(e.target) && !btn?.contains(e.target)) eqClosePricePop();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') eqClosePricePop();
    });
  }
}


/* ================================================================
   🎛️ القسم 5-ب: بناء عناصر الفلتر وعرض حالتها
   ================================================================ */

function _eqNum(n) {
  return Number(n || 0).toLocaleString(getLocale() === 'en' ? 'en-US' : 'ar-EG');
}

/* الملخّص المكتوب على زر السعر وشريحة الفلتر النشط */
function _eqPriceSummary(min = eqPriceMin, max = eqPriceMax) {
  if (min > 0 && max > 0) return `${_eqNum(min)} – ${_eqNum(max)} ${t('card.currency')}`;
  if (max > 0)            return t('filters.priceUnder', { price: _eqNum(max) + ' ' + t('card.currency') });
  if (min > 0)            return t('filters.priceOver',  { price: _eqNum(min) + ' ' + t('card.currency') });
  return t('filters.anyPrice');
}

function _eqTierLabel(tier) {
  if (tier.id === 'any') return t('filters.anyPrice');
  if (!tier.max)         return t('filters.priceOver',  { price: _eqNum(tier.min) });
  if (!tier.min)         return t('filters.priceUnder', { price: _eqNum(tier.max) });
  return `${_eqNum(tier.min)} – ${_eqNum(tier.max)}`;
}

/* خيارات المحافظات: اللي فيها إعلانات أولًا وبعددها، والباقي في مجموعة
   منفصلة — بدل 27 خيارًا متساويًا أغلبها طريق مسدود بلا نتائج */
function _eqGovOptionsHtml(selected) {
  const has = g => eqFacets.govs.get(g) || 0;
  const withData = EQ_GOVS.filter(has);
  const without  = EQ_GOVS.filter(g => !has(g));
  const opt = g => `<option value="${g}"${g === selected ? ' selected' : ''}>${eqGovLabel(g)}${has(g) ? ` (${_eqNum(has(g))})` : ''}</option>`;
  let html = `<option value=""${selected ? '' : ' selected'}>${t('filters.allGovs')}</option>`;
  if (withData.length) html += `<optgroup label="${t('filters.govsWithAds')}">${withData.map(opt).join('')}</optgroup>`;
  if (without.length)  html += `<optgroup label="${t('filters.govsOther')}">${without.map(opt).join('')}</optgroup>`;
  return html;
}

function _eqCatChipsHtml(handler, activeCat) {
  const chip = (id, label, count) => {
    const n = count === null ? '' : `<i class="eqf-chip-n">${_eqNum(count)}</i>`;
    return `<button type="button" class="eqf-chip${id === activeCat ? ' on' : ''}${count === 0 ? ' is-empty' : ''}"
      data-cat="${id}" onclick="${handler}('${id}')" aria-pressed="${id === activeCat}">${label}${n}</button>`;
  };
  /* لو فشل جلب العدّادات نخفيها كلها بدل ما نطبع «٠» على كل تصنيف —
     صفر كاذب أسوأ من غياب الرقم: بيقول للمستخدم إن كل قسم فاضي وهو مش فاضي */
  const hasFacets = eqFacets.total > 0;
  return chip('', t('filters.all'), hasFacets ? eqFacets.total : null) +
    EQ_CATEGORIES.map(c => chip(c.id, eqCatLabel(c.id), hasFacets ? (eqFacets.cats.get(c.id) || 0) : null)).join('');
}

function _eqTierChipsHtml(handler, min, max) {
  return EQ_PRICE_TIERS.map(tr => {
    const on = tr.min === min && tr.max === max;
    return `<button type="button" class="eqf-tier${on ? ' on' : ''}"
      onclick="${handler}(${tr.min},${tr.max})">${_eqTierLabel(tr)}</button>`;
  }).join('');
}

function eqBuildCategoryTabs() {
  const cont = document.getElementById('eq-tabs');
  if (cont) cont.innerHTML = _eqCatChipsHtml('eqSetCategory', eqActiveCategory);

  const govSel = document.getElementById('eq-gov');
  if (govSel) govSel.innerHTML = _eqGovOptionsHtml(eqGov);

  const tiers = document.getElementById('eq-price-tiers');
  if (tiers) tiers.innerHTML = _eqTierChipsHtml('eqSetPrice', eqPriceMin, eqPriceMax);

  /* نسخة الموبايل داخل الدرج — نفس المكوّنات بنفس العدّادات */
  const drawerTabs = document.getElementById('eq-drawer-tabs');
  if (drawerTabs) drawerTabs.innerHTML = _eqCatChipsHtml('eqDrawerSetCategory', eqDrawerDraft.category);

  const drawerGov = document.getElementById('eq-drawer-gov');
  if (drawerGov) drawerGov.innerHTML = _eqGovOptionsHtml(eqDrawerDraft.gov);

  const drawerTiers = document.getElementById('eq-drawer-price-tiers');
  if (drawerTiers) drawerTiers.innerHTML = _eqTierChipsHtml('eqDrawerSetPrice', eqDrawerDraft.priceMin, eqDrawerDraft.priceMax);

  eqRenderFilterState();
}

/* المصدر الوحيد لعرض حالة الفلاتر على كل الأسطح (شرائح، قوائم، شارات،
   شريط الفلاتر النشطة). أي تغيير في الحالة بيمرّ من هنا. */
function eqRenderFilterState() {
  document.querySelectorAll('#eq-tabs .eqf-chip').forEach(el => {
    const on = (el.dataset.cat || '') === eqActiveCategory;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on);
  });

  const govSel = document.getElementById('eq-gov');
  if (govSel && govSel.value !== eqGov) govSel.value = eqGov;
  const sortSel = document.getElementById('eq-sort');
  if (sortSel && sortSel.value !== eqSortBy) sortSel.value = eqSortBy;

  const priceLbl = document.getElementById('eq-price-label');
  if (priceLbl) priceLbl.textContent = _eqPriceSummary();
  document.getElementById('eq-price-btn')?.classList.toggle('on', eqPriceMin > 0 || eqPriceMax > 0);

  document.querySelectorAll('#eq-price-tiers .eqf-tier').forEach(el => {
    const on = el.getAttribute('onclick') === `eqSetPrice(${eqPriceMin},${eqPriceMax})`;
    el.classList.toggle('on', on);
  });
  const pMinInp = document.getElementById('eq-price-min-input');
  const pMaxInp = document.getElementById('eq-price-max-input');
  if (pMinInp && document.activeElement !== pMinInp) pMinInp.value = eqPriceMin || '';
  if (pMaxInp && document.activeElement !== pMaxInp) pMaxInp.value = eqPriceMax || '';

  eqRenderActiveChips();
  eqUpdateDrawerBadge();
}

/* شريط الفلاتر النشطة — إزالة أي فلتر بضغطة واحدة بدل الرجوع لمصدره.
   نسختان بنفس المحتوى: واحدة في شريط الفلاتر (ديسكتوب) وواحدة داخل
   المتن (موبايل)، لأن الشريط العلوي كله مخفي على الموبايل. */
function eqRenderActiveChips() {
  const wraps = [document.getElementById('eq-active-chips'),
                 document.getElementById('eq-active-chips-m')].filter(Boolean);
  if (!wraps.length) return;
  const chips = [];
  const chip = (label, fn) =>
    `<button type="button" class="eqf-active-chip" onclick="${fn}"><span>${label}</span><i aria-hidden="true">✕</i></button>`;

  if (eqActiveCategory) chips.push(chip(eqCatLabel(eqActiveCategory), "eqSetCategory('')"));
  if (eqGov)            chips.push(chip(eqGovLabel(eqGov), "eqSetGov('')"));
  if (eqPriceMin > 0 || eqPriceMax > 0) chips.push(chip(_eqPriceSummary(), 'eqSetPrice(0,0)'));
  if (eqSearch.trim())  chips.push(chip(`«${eqSearch.trim()}»`, 'eqClearSearch()'));

  const html = chips.length
    ? chips.join('') + `<button type="button" class="eqf-clear-all" onclick="eqClearAllFilters()">${t('filters.clearAll')}</button>`
    : '';
  wraps.forEach(w => {
    w.innerHTML = html;
    w.classList.toggle('has-items', chips.length > 0);
  });
}


/* ── مُبدّلات الفلاتر (سطح المكتب) ── */

function eqSetCategory(cat) {
  eqActiveCategory = cat === eqActiveCategory ? '' : cat;   // إعادة الضغط = إلغاء
  eqApplyFilters();
}

function eqSetGov(gov) {
  eqGov = gov || '';
  eqApplyFilters();
}

function eqSetPrice(min, max) {
  eqPriceMin = Number(min) || 0;
  eqPriceMax = Number(max) || 0;
  eqClosePricePop();
  eqApplyFilters();
}

function eqClearSearch() {
  eqSearch = '';
  const s = document.getElementById('eq-search');
  if (s) s.value = '';
  eqApplyFilters();
}

function eqApplyCustomPrice() {
  const min = parseInt(document.getElementById('eq-price-min-input')?.value) || 0;
  let   max = parseInt(document.getElementById('eq-price-max-input')?.value) || 0;
  /* لو المستخدم عكس الحدّين نصلّحها بدل ما نرجّع صفر نتائج بلا سبب واضح */
  if (min > 0 && max > 0 && max < min) { const tmp = max; max = min; eqPriceMin = tmp; }
  else eqPriceMin = min;
  eqPriceMax = max;
  eqClosePricePop();
  eqApplyFilters();
}

function eqTogglePricePop(e) {
  e?.stopPropagation();
  const pop = document.getElementById('eq-price-pop');
  if (!pop) return;
  const open = pop.classList.toggle('open');
  document.getElementById('eq-price-btn')?.setAttribute('aria-expanded', open);
}

function eqClosePricePop() {
  document.getElementById('eq-price-pop')?.classList.remove('open');
  document.getElementById('eq-price-btn')?.setAttribute('aria-expanded', 'false');
}


/* ================================================================
   🔗 مزامنة الفلاتر مع الرابط — رجوع المتصفح ومشاركة نتيجة مفلترة
   ================================================================ */

function eqSyncUrl() {
  const p = new URLSearchParams(window.location.search);
  const set = (k, v) => { if (v) p.set(k, v); else p.delete(k); };
  set('cat',  eqActiveCategory);
  set('gov',  eqGov);
  set('min',  eqPriceMin > 0 ? eqPriceMin : '');
  set('max',  eqPriceMax > 0 ? eqPriceMax : '');
  set('sort', eqSortBy !== 'newest' ? eqSortBy : '');
  set('q',    eqSearch.trim());
  const qs = p.toString();
  history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname);
}

function eqReadUrlFilters() {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get('cat') || '';
  if (cat && EQ_CATEGORIES.some(c => c.id === cat)) eqActiveCategory = cat;
  const gov = p.get('gov') || '';
  if (gov && EQ_GOVS.includes(gov)) eqGov = gov;
  eqPriceMin = Math.max(0, parseInt(p.get('min')) || 0);
  eqPriceMax = Math.max(0, parseInt(p.get('max')) || 0);
  const sort = p.get('sort') || '';
  if (['cheapest', 'priciest', 'views'].includes(sort)) eqSortBy = sort;
  const q = p.get('q') || '';
  if (q) {
    eqSearch = q;
    const inp = document.getElementById('eq-search');
    if (inp) inp.value = q;
  }
}


/* ================================================================
   📌 Desktop Sticky Filters Bar
   بدل ما نفترض ارتفاع .nav برقم ثابت (كان 68px مكرر في ملفين ومنفصل
   عن القيمة الحقيقية)، نقيسه فعليًا ونمرره كـ CSS var — لو ارتفاع الناف
   اتغيّر لأي سبب مستقبلاً، شريط الفلتر بيتبعه تلقائيًا بدون فجوة أو تراكب.
   ================================================================ */

function eqInitFilterBarSticky() {
  const nav = document.querySelector('.nav');
  const bar = document.getElementById('eq-filters-bar');
  const sentinel = document.getElementById('eq-filters-sentinel');
  if (!nav || !bar) return;

  const syncNavHeight = () => {
    document.documentElement.style.setProperty('--eq-nav-h', nav.offsetHeight + 'px');
  };
  syncNavHeight();
  /* قياس ثانٍ بعد load: الناف بيتغيّر ارتفاعه لما الخطوط تخلص تحميل ومنطقة
     المستخدم تتبني من JS، ولو فاتت اللحظة دي بيفضل الشريط اللاصق بفجوة
     أو تراكب تحت الناف */
  window.addEventListener('load', syncNavHeight);
  document.fonts?.ready?.then(syncNavHeight);
  if (window.ResizeObserver) {
    new ResizeObserver(syncNavHeight).observe(nav);
  } else {
    window.addEventListener('resize', syncNavHeight);
  }

  /* is-stuck: يُفعَّل فقط لما الشريط يبقى فعلاً ملتصق تحت الناف —
     يظهر الظل وقتها بس، بدل ما يبان دايمًا كأنه عنصر عائم منفصل */
  if (sentinel && window.IntersectionObserver) {
    new IntersectionObserver(([entry]) => {
      bar.classList.toggle('is-stuck', entry.boundingClientRect.top < nav.offsetHeight);
    }, { threshold: [0, 1] }).observe(sentinel);
  }
}

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

/* بلا سلوك toggle هنا عمدًا: الشريحة دي بيوصلها الحدث ٣ مرات (inline onclick
   + المستمع المفوَّض على pointerdown + نظيره على click في eqInstallMobileFilterControls)،
   فأي عكس للحالة كان هيلغي نفسه فورًا. الإلغاء متاح بشريحة «الكل» وبزر إعادة التعيين. */
function eqDrawerSetCategory(cat) {
  eqDrawerDraft.category = cat || '';
  eqRenderDrawerDraft();
}

function eqDrawerGovChange(sel) {
  eqDrawerDraft.gov = sel.value;
  eqRenderDrawerDraft();
}

function eqDrawerSortChange(sel) {
  eqDrawerDraft.sortBy = sel.value;
  eqRenderDrawerDraft();
}

function eqDrawerSetPrice(min, max) {
  eqDrawerDraft.priceMin = Number(min) || 0;
  eqDrawerDraft.priceMax = Number(max) || 0;
  eqRenderDrawerDraft();
}

function eqDrawerCustomPrice() {
  const min = parseInt(document.getElementById('eq-drawer-price-min')?.value) || 0;
  const max = parseInt(document.getElementById('eq-drawer-price-max')?.value) || 0;
  eqDrawerDraft.priceMin = (min > 0 && max > 0 && max < min) ? max : min;
  eqDrawerDraft.priceMax = (min > 0 && max > 0 && max < min) ? min : max;
  eqRenderDrawerDraft({ keepInputs: true });
}

/* الشارة على زر/لسان الفلتر بتعكس الفلاتر *المطبَّقة* — لا مسوّدة الدرج */
function eqUpdateDrawerBadge() {
  const count = eqActiveFilterCount();
  ['eq-drawer-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (!badge) return;
    badge.textContent = _eqNum(count);
    badge.classList.toggle('show', count > 0);
  });
}

function eqResetDrawer() {
  eqDrawerDraft = { category: '', gov: '', priceMin: 0, priceMax: 0, sortBy: 'newest' };
  eqRenderDrawerDraft();
}

function eqApplyDrawerFilters() {
  eqActiveCategory = eqDrawerDraft.category;
  eqGov      = eqDrawerDraft.gov;
  eqPriceMin = eqDrawerDraft.priceMin;
  eqPriceMax = eqDrawerDraft.priceMax;
  eqSortBy   = eqDrawerDraft.sortBy;

  eqApplyFilters();
  eqCloseSidebar();
}

function eqSyncDrawerFromActive() {
  eqDrawerDraft = {
    category: eqActiveCategory,
    gov:      eqGov,
    priceMin: eqPriceMin,
    priceMax: eqPriceMax,
    sortBy:   eqSortBy,
  };
  eqRenderDrawerDraft();
}

function eqRenderDrawerDraft(opts = {}) {
  const drawerGov  = document.getElementById('eq-drawer-gov');
  const drawerSort = document.getElementById('eq-drawer-sort');
  if (drawerGov)  drawerGov.value  = eqDrawerDraft.gov;
  if (drawerSort) drawerSort.value = eqDrawerDraft.sortBy;

  document.querySelectorAll('#eq-drawer-tabs .eqf-chip').forEach(el => {
    const on = (el.dataset.cat || '') === eqDrawerDraft.category;
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on);
  });
  document.querySelectorAll('#eq-drawer-price-tiers .eqf-tier').forEach(el => {
    el.classList.toggle('on',
      el.getAttribute('onclick') === `eqDrawerSetPrice(${eqDrawerDraft.priceMin},${eqDrawerDraft.priceMax})`);
  });

  if (!opts.keepInputs) {
    const minInp = document.getElementById('eq-drawer-price-min');
    const maxInp = document.getElementById('eq-drawer-price-max');
    if (minInp) minInp.value = eqDrawerDraft.priceMin || '';
    if (maxInp) maxInp.value = eqDrawerDraft.priceMax || '';
  }

  const summary = document.getElementById('eq-drawer-price-val');
  if (summary) summary.textContent = _eqPriceSummary(eqDrawerDraft.priceMin, eqDrawerDraft.priceMax);

  eqQueueDrawerPreview();
}

/* عدّاد حيّ على زر التطبيق: «عرض ٧ نتائج» قبل الإغلاق — استعلام count
   بلا صفوف (head) فتكلفته لا تُذكر، ومؤجَّل عشان ميتكررش مع كل ضغطة */
let _eqPreviewTimer = null;
let _eqPreviewSeq   = 0;
function eqQueueDrawerPreview() {
  clearTimeout(_eqPreviewTimer);
  _eqPreviewTimer = setTimeout(eqPreviewDrawerCount, 220);
}

async function eqPreviewDrawerCount() {
  const btn = document.getElementById('eq-drawer-apply-btn');
  if (!btn || !eqSb) return;
  const seq = ++_eqPreviewSeq;
  try {
    const { count, error } = await _eqBuildQuery({
      select: 'id',
      countOpts: { count: 'exact', head: true },
      category: eqDrawerDraft.category,
      gov:      eqDrawerDraft.gov,
      priceMin: eqDrawerDraft.priceMin,
      priceMax: eqDrawerDraft.priceMax,
    });
    if (error) throw error;
    if (seq !== _eqPreviewSeq) return;
    /* count للجمع النحوي، n للعرض — i18next مبيحوّلش أرقام {{count}}
       لأرقام عربية، فيبان الرقم لاتيني وسط واجهة أرقامها هندية */
    btn.textContent = count > 0
      ? t('filters.showNResults', { count: count, n: _eqNum(count) })
      : t('filters.noResultsBtn');
    btn.disabled = false;
  } catch (e) {
    if (seq === _eqPreviewSeq) btn.textContent = t('filters.showResults');
  }
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
      const btn = e.target.closest('.eqf-chip');
      if (!btn) return;
      eqStopFilterEvent(e);
      eqDrawerSetCategory(btn.dataset.cat || '');
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
      const openBtn = pathHas('#eq-sidebar-tab') || target.closest?.('#eq-sidebar-tab');
      const closeTarget = pathHas('#eq-drawer-close-btn, #eq-sidebar-overlay') || target.closest?.('#eq-drawer-close-btn, #eq-sidebar-overlay');
      const resetTarget = pathHas('#eq-drawer-reset-btn') || target.closest?.('#eq-drawer-reset-btn');
      const applyTarget = pathHas('#eq-drawer-apply-btn') || target.closest?.('#eq-drawer-apply-btn');
      const tabTarget = pathHas('#eq-drawer-tabs .eqf-chip') || target.closest?.('#eq-drawer-tabs .eqf-chip');

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
        eqDrawerSetCategory(tabTarget.dataset.cat || '');
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

function _eqEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* أيقونة المفضلة: خط رفيع وهي مطفية، ممتلئة وهي مفعّلة — بديل الإيموجي
   🤍/❤️ اللي كان شكله بيختلف من نظام لنظام ولونه بيصرخ وسط كرت هادئ */
function _eqHeartSvg(on) {
  return `<svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 20.7 3.9 12.6a5.2 5.2 0 0 1 7.4-7.3l.7.7.7-.7a5.2 5.2 0 0 1 7.4 7.3Z"/></svg>`;
}

/* ترتيب واحد للكرت في العرضين (شبكة/قائمة) وفي الموبايل — الاختلاف كله
   في CSS، فالتبديل بين العرضين مجرد كلاس على الحاوية: بلا إعادة بناء،
   وبالتالي الفلاتر والترتيب وموضع التمرير كلها بتفضل زي ما هي. */
function eqBuildCard(listing) {
  const allImgs = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  const cond    = eqCondLabel(listing.condition);
  const cat     = eqCatLabel(listing.category);
  const price   = _eqNum(listing.price);
  const lid     = listing.id;
  const title   = _eqEsc(listing.title);
  const isFav   = eqFavorites.has(lid);

  const flag = listing.is_featured
    ? `<span class="eq-card-flag">${t('card.featured')}</span>` : '';

  let mediaInner;
  if (allImgs.length === 0) {
    mediaInner = `<div class="eq-card-no-img">📦</div>`;
  } else {
    const slides = allImgs.map(u =>
      `<div class="eq-card-slide"><img src="${_cardUrl(u)}" alt="${title}"${_imgAttrs(true)}
        onerror="this.parentNode.style.display='none'"></div>`
    ).join('');
    const navHtml = allImgs.length > 1 ? `
      <button type="button" class="eq-cn-btn eq-cn-prev" onclick="eqCardNav('eqc-${lid}',-1);event.preventDefault();event.stopPropagation()" aria-label="${t('card.prev')}">‹</button>
      <button type="button" class="eq-cn-btn eq-cn-next" onclick="eqCardNav('eqc-${lid}',1);event.preventDefault();event.stopPropagation()" aria-label="${t('card.next')}">›</button>
      <div class="eq-cn-dots">${allImgs.map((_, i) => `<span class="eq-cn-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>` : '';
    mediaInner = `
      <div class="eq-card-carousel${allImgs.length > 1 ? ' has-many' : ''}" id="eqc-${lid}" data-idx="0">
        <div class="eq-card-slides">${slides}</div>
        ${navHtml}
      </div>`;
  }

  const locText = [listing.region ? eqGovLabel(listing.region) : '', listing.area]
    .filter(Boolean).map(_eqEsc).join(' — ');
  const desc = listing.description
    ? `<p class="eq-card-desc">${_eqEsc(listing.description)}</p>` : '';

  return `
<article class="eq-card" data-category="${listing.category || ''}" data-region="${_eqEsc(listing.region)}" data-price="${Number(listing.price) || 0}">
  <div class="eq-card-media">
    ${mediaInner}
    ${flag}
    <button type="button" class="eq-fav-btn${isFav ? ' on' : ''}" data-fav="${lid}"
            onclick="eqToggleFavorite(event,'${lid}')"
            aria-pressed="${isFav}" aria-label="${t('card.favoriteTitle')}" title="${t('card.favoriteTitle')}">${_eqHeartSvg(isFav)}</button>
    <span class="eq-card-chip">${cat}</span>
  </div>
  <div class="eq-card-body">
    <div class="eq-card-priceline">
      <span class="eq-card-price">${price} ${t('card.currency')}</span>
      ${listing.negotiable ? `<span class="eq-card-nego">${t('card.negotiable')}</span>` : ''}
    </div>
    <h3 class="eq-card-title"><a class="eq-card-link" href="/market/?listing=${lid}"
       onclick="return eqCardClick(event,'${lid}')">${title}</a></h3>
    ${desc}
    <div class="eq-card-meta">
      <span class="eq-card-loc">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
        ${locText}</span>
      <span class="eq-card-cond">${cond}</span>
    </div>
  </div>
</article>`;
}

/* الكرت رابط حقيقي (stretched link) لا div بـonclick: فيه تركيز بلوحة
   المفاتيح، وctrl/⌘+click بيفتح تبويب جديد، وزر الفأرة الأوسط والنسخ
   شغّالين — من غير ما نضحّي بمودال التفاصيل السريع في الضغطة العادية */
function eqCardClick(e, id) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return true;
  e.preventDefault();
  eqOpenDetail(id);
  return false;
}


/* ================================================================
   🔄 القسم 7: عرض الشبكة + Load More
   ================================================================ */

/* ── الحالة الفارغة كصفحة تحويل — نظير ما في /spaces/ لكن بلا استعلام إضافي،
   لأن الفلترة هنا محلية فوق eqListings المحمَّلة أصلًا ── */
function _eqEmptyHeadline() {
  const parts = [];
  if (eqActiveCategory) parts.push(t('empty.dynFragCat',   { cat: eqCatLabel(eqActiveCategory) }));
  if (eqGov)            parts.push(t('empty.dynFragGov',   { gov: eqGovLabel(eqGov) }));
  if (eqPriceMin > 0 || eqPriceMax > 0) parts.push(t('empty.dynFragPrice', { price: _eqPriceSummary() }));
  if (eqSearch.trim())  parts.push(t('empty.dynFragSearch',{ q: eqSearch.trim() }));
  if (!parts.length) return t('grid.empty');
  return t('empty.dynNoneCombo', { what: parts.join(' ') });
}

function eqClearAllFilters() {
  eqActiveCategory = ''; eqSearch = ''; eqGov = ''; eqPriceMin = 0; eqPriceMax = 0;
  const s = document.getElementById('eq-search'); if (s) s.value = '';
  eqApplyFilters();
}

/* يمسح باقي الفلاتر حتى لا يقع المستخدم في فراغ ثانٍ فورًا */
function eqJumpToGov(gov) {
  eqActiveCategory = ''; eqSearch = ''; eqPriceMin = 0; eqPriceMax = 0; eqGov = gov || '';
  const s = document.getElementById('eq-search'); if (s) s.value = '';
  eqApplyFilters();
  document.getElementById('eq-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _eqRenderDynamicEmpty(grid) {
  const anyFilter = eqHasActiveFilters();

  /* المصدر بقى eqFacets/eqSampleListings لا eqListings — بعد نقل الفلترة
     للخادم بقت eqListings هي *النتائج المفلترة* (فاضية هنا بالتعريف)، فكانت
     الاقتراحات هتبقى فاضية كمان لو فضلنا نقرأ منها */
  const govSoleFilter = !!eqGov && !eqActiveCategory && !eqPriceMin && !eqPriceMax && !eqSearch.trim();
  const govs = [...eqFacets.govs.entries()]
    .filter(([g]) => !(govSoleFilter && g === eqGov))
    .sort((a, b) => b[1] - a[1]).slice(0, 6);

  /* eqSampleListings بتتعبّى من أول تحميل *بلا* فلاتر. لو المستخدم دخل
     على رابط مفلتر جاهز (مشاركة أو رجوع) الكاش بيبقى فاضي وقسم
     «إعلانات ممكن تهمّك» يختفي — نجيبها ساعتها ونعيد الرسم مرة واحدة. */
  if (!eqSampleListings.length && !_eqSampleFetching) {
    _eqSampleFetching = true;
    eqSb.from('listings').select(_EQ_SELECT)
      .eq('status', 'approved').gt('expires_at', new Date().toISOString())
      .order('is_featured', { ascending: false }).order('created_at', { ascending: false })
      .limit(6)
      .then(({ data }) => {
        _eqSampleFetching = false;
        if (data?.length) { eqSampleListings = data; if (!eqFiltered.length) eqRenderGrid(); }
      }, () => { _eqSampleFetching = false; });
  }

  const alt = eqSampleListings.filter(l => !(govSoleFilter && l.region === eqGov)).slice(0, 3);

  grid.innerHTML = `
    <div class="eq-empty" style="grid-column:1/-1;text-align:center">
      <div style="font-size:46px;margin-bottom:12px">🔍</div>
      <p style="font-size:16px;font-weight:800;margin-bottom:6px">${_eqEmptyHeadline()}</p>
      <p style="font-size:13px;opacity:.75;margin-bottom:18px">${t('empty.dynSub')}</p>
      ${govs.length ? `
        <div style="font-size:12.5px;opacity:.7;margin-bottom:9px;font-weight:700">${t('empty.dynGovsLabel')}</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:18px">
          ${govs.map(([g, n]) => `
            <button class="eq-btn eq-btn-outline" style="padding:7px 14px;font-size:12.5px;border-radius:var(--radius-pill)"
                    onclick="eqJumpToGov('${String(g).replace(/'/g, "\\'")}')">
              📍 ${eqGovLabel(g)} (${_eqNum(n)})
            </button>`).join('')}
        </div>` : ''}
      ${anyFilter ? `<button class="eq-btn eq-btn-primary" onclick="eqClearAllFilters()">${t('empty.dynShowAll')}</button>` : ''}
      ${alt.length ? `
        <div style="margin-top:30px">
          <div style="font-size:13.5px;font-weight:800;margin-bottom:14px">${t('empty.dynAltTitle')}</div>
          <div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));
                      max-width:840px;margin:0 auto;text-align:initial">
            ${alt.map(eqBuildCard).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

function eqRenderGrid() {
  const grid  = document.getElementById('eq-grid');
  const count = document.getElementById('eq-count');
  const more  = document.getElementById('eq-load-more');

  if (!grid) return;
  /* الحارس في المصدر لا في المستمع: هذه البوابة الوحيدة للحالة الفارغة، فأي
     مستدعٍ لاحق يصير مغطّى تلقائيًا. eqShowLoading يبقى معروضًا حتى أول جلب. */
  if (!eqDataReady) return;

  if (eqFiltered.length === 0) {
    _eqRenderDynamicEmpty(grid);
    if (count) count.textContent = t('grid.countZero');
    if (more)  more.style.display = 'none';
    return;
  }

  _eqImgCounter = 0; /* أعد العدّاد لتحصل أول 6 صور على fetchpriority=high */
  grid.innerHTML = eqFiltered.map(eqBuildCard).join('');
  /* العدد من count الحقيقي على الخادم لا من طول الصفحة المحمّلة */
  const total = eqTotalCount || eqFiltered.length;
  if (count) count.textContent = t('grid.count', { count: total, n: _eqNum(total) });
  if (more)  more.style.display = eqHasMore ? 'flex' : 'none';
}

async function eqLoadMore() {
  if (!eqHasMore) return;
  const btn = document.getElementById('eq-load-more');
  if (btn) { btn.disabled = true; btn.textContent = t('grid.loadingMore'); }
  try {
    await eqLoadListings(true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('grid.loadMore'); }
  }
}

function eqShowLoading() {
  const grid = document.getElementById('eq-grid');
  if (grid) grid.innerHTML = `
    <div class="eq-loading">
      <div class="eq-spinner"></div>
      <p>${t('grid.loading')}</p>
    </div>`;
}

function eqShowError(msg) {
  const grid = document.getElementById('eq-grid');
  if (grid) grid.innerHTML = `
    <div class="eq-empty">
      <p>⚠️ ${msg}</p>
      <button class="eq-btn eq-btn-primary" onclick="eqLoadListings()">${t('error.retry')}</button>
    </div>`;
}


/* ================================================================
   🔎 القسم 8: تفاصيل الإعلان (Modal)
   ================================================================ */

let eqCurrentDetailId = null; // آخر إعلان مفتوح في المودال — لإعادة الرسم عند تبديل اللغة

/* الإعلان قد لا يكون ضمن الصفحة المحمّلة حاليًا: رابط عميق ?listing=،
   أو بطاقة من اقتراحات الحالة الفارغة، أو نتيجة استُبدلت بفلتر جديد —
   ساعتها نجيبه بمفرده بدل ما المودال ميفتحش من غير أي رسالة */
async function eqFetchListing(id) {
  try {
    const { data } = await eqSb.from('listings').select(_EQ_SELECT)
      .eq('id', id).eq('status', 'approved').maybeSingle();
    return data || null;
  } catch (e) { return null; }
}

async function eqOpenDetail(id) {
  let listing = eqListings.find(l => l.id === id) || eqSampleListings.find(l => l.id === id);
  if (!listing) listing = await eqFetchListing(id);
  if (!listing) return;
  eqCurrentDetailId = id;

  trackEvent('listing_viewed', { listing_id: id, category: listing.category });
  eqIncrementView(id);

  const imgs   = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  const cond   = eqCondLabel(listing.condition);
  const cat    = eqCatLabel(listing.category);
  const price  = Number(listing.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG');
  const nego   = listing.negotiable ? ` (${t('card.negotiable')})` : '';
  const date   = new Date(listing.created_at).toLocaleDateString(getLocale()==='en'?'en-US':'ar-EG');

  const swiperId  = `eq-sw-${id}`;
  const galleryHtml = imgs.length > 0
    ? `<div class="eq-detail-gallery">
        <div class="eq-swiper-wrap">
          <div class="eq-swiper" id="${swiperId}">
            ${imgs.map((u, i) => `<div class="eq-swiper-slide"><img src="${_detailUrl(u)}" alt="${listing.title}" loading="lazy" onclick="eqOpenLightbox('${id}',${i})" style="cursor:zoom-in"></div>`).join('')}
          </div>
          ${imgs.length > 1
            ? `<div class="eq-swiper-dots" id="${swiperId}-dots">${imgs.map((_, i) => `<span class="eq-swiper-dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
               <button class="eq-swiper-prev" onclick="eqSwiperNav('${swiperId}',-1);event.stopPropagation()" aria-label="${t('card.prev')}">&#8249;</button>
               <button class="eq-swiper-next" onclick="eqSwiperNav('${swiperId}',1);event.stopPropagation()" aria-label="${t('card.next')}">&#8250;</button>`
            : ''}
          <button class="eq-share-btn" onclick="eqShare('${id}')" title="${t('detail.shareTitle')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
        </div>
      </div>`
    : `<div class="eq-detail-no-img">📦</div>`;

  const isFav   = eqFavorites.has(id);
  const favBtn  = `<button class="eq-btn eq-btn-ghost" data-fav="${id}" onclick="eqToggleFavorite(event,'${id}')">${isFav ? t('detail.inFavorite') : t('detail.addFavorite')}</button>`;

  const contactHtml = eqUser
    ? `${listing.contact_pref !== 'call'
        ? `<a class="eq-btn eq-btn-primary eq-btn-full" href="https://wa.me/2${listing.phone}?text=${encodeURIComponent(t('detail.whatsappMsg', { title: listing.title }))}" target="_blank" onclick="eqIncrementContact('${id}')">${t('detail.whatsappContact')}</a>`
        : ''}
       ${listing.contact_pref !== 'whatsapp'
        ? `<a class="eq-btn eq-btn-outline eq-btn-full" href="tel:${listing.phone}" onclick="eqIncrementContact('${id}')">${t('detail.callSeller')}</a>`
        : ''}`
    : `<a class="eq-btn eq-btn-primary eq-btn-full" href="/?p=login&next=${encodeURIComponent('/market/?listing=' + id)}">${t('detail.loginToContact')}</a>`;

  document.getElementById('eq-modal-body').innerHTML = `
    ${galleryHtml}
    <div class="eq-detail-info">
      <div class="eq-detail-badges">
        <span class="eq-badge eq-badge-cat">${cat}</span>
        <span class="eq-badge eq-badge-cond">${cond}</span>
        ${listing.is_featured ? `<span class="eq-badge eq-badge-feat">${t('detail.featured')}</span>` : ''}
      </div>
      <h2 class="eq-detail-title">${listing.title}</h2>
      <div class="eq-detail-price">${price} ${t('card.currency')}${nego}</div>
      ${listing.description ? `<div class="eq-detail-desc">${listing.description}</div>` : ''}
      <div class="eq-detail-loc">📍 ${listing.region ? eqGovLabel(listing.region) : ''}${listing.area ? ' — ' + listing.area : ''}</div>
      <div class="eq-detail-date">${t('detail.published', { date })}</div>
      <div class="eq-detail-stats">${t('detail.views', { count: listing.view_count || 0 })}</div>
      <div class="eq-detail-actions">
        ${contactHtml}
        ${favBtn}
        <button class="eq-btn eq-btn-ghost" onclick="eqOpenReport('${id}')">${t('detail.reportBtn')}</button>
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
  eqCurrentDetailId = null;
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
  const price = Number(listing.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG');
  const pageUrl = `${window.location.origin}${window.location.pathname}?listing=${id}`;
  const text  = t('detail.shareText', { title: listing.title, price, region: listing.region ? eqGovLabel(listing.region) : '', url: pageUrl });

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
  try {
    if (sessionStorage.getItem('eq_seen_' + id)) return;
    sessionStorage.setItem('eq_seen_' + id, '1');
  } catch { /* WebView / private mode — skip dedup, allow count */ }
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
  if (!eqUser) { alert(t('report.loginRequired')); return; }
  document.getElementById('eq-report-id').value = id;
  document.getElementById('eq-report-reason').value = '';
  document.querySelectorAll('input[name="eq-report-cat"]').forEach(r => r.checked = false);
  document.getElementById('eq-report-modal').classList.add('open');
}

function eqCloseReport() {
  document.getElementById('eq-report-modal').classList.remove('open');
}

async function eqSubmitReport() {
  const id       = document.getElementById('eq-report-id').value;
  const category = document.querySelector('input[name="eq-report-cat"]:checked')?.value;
  const note     = document.getElementById('eq-report-reason').value.trim();
  if (!category) { alert(t('report.reasonRequired')); return; }
  if (!eqUser) { alert(t('report.loginRequired')); return; }

  /* السبب المخزّن في DB بيتبني بلغة المستخدم وقت الإبلاغ (نص ثابت
     يُقرأ لاحقًا من فريق المراجعة العربي — راجع project_i18n_english_support.md
     لسياسة "محتوى مُنشأ وقت الحدث يفضل بلغته الأصلية") */
  const reason = t('report.categories.' + category) + (note ? ' — ' + note : '');
  const reportData = { listing_id: id, reason, user_id: eqUser.id };
  const { error } = await eqSb.from('listing_reports').insert(reportData);
  if (error) { alert(t('report.submitError')); return; }

  eqCloseReport();
  eqCloseModal();
  alert(t('report.submitSuccess'));
}


/* ================================================================
   👤 القسم 15: Dashboard المستخدم — إعلاناتي
   ================================================================ */

async function eqLoadMyListings() {
  if (!eqUser) {
    document.getElementById('eq-my-listings').innerHTML =
      `<div class="eq-empty"><p>${t('myListings.loginRequired')}</p><a class="eq-btn eq-btn-primary" href="/?p=login&next=${encodeURIComponent('/market/?myListings=1')}">${t('myListings.loginBtn')}</a></div>`;
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
      `<div class="eq-empty"><p>${t('myListings.loadError', { error: error.message })}</p></div>`;
    return;
  }

  const cont = document.getElementById('eq-my-listings');
  if (!cont) return;

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>${t('myListings.noListings')}</p><a class="eq-btn eq-btn-primary" href="/post-ad/">${t('myListings.postFirst')}</a></div>`;
    return;
  }

  eqMyListings = data;
  cont.innerHTML = data.map(l => eqBuildMyCard(l)).join('');
}

function eqBuildMyCard(l) {
  const statusMap = {
    pending:  { label: t('myCard.statusPending'),  cls: 'eq-status-pending'  },
    approved: { label: t('myCard.statusActive'),   cls: 'eq-status-active'   },
    rejected: { label: t('myCard.statusRejected'), cls: 'eq-status-rejected' },
    expired:  { label: t('myCard.statusExpired'),  cls: 'eq-status-expired'  },
    paused:   { label: t('myCard.statusPaused'),   cls: 'eq-status-paused'   },
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
    ${l.status === 'rejected' && l.reject_reason ? `<div class="eq-rejection-reason">${t('myCard.rejectReason', { reason: l.reject_reason })}</div>` : ''}
    ${l.status === 'approved'
      ? days <= 7
        ? `<div class="eq-days-warning">${t('myCard.expiresWarning', { count: days, days })}</div>`
        : `<div class="eq-days-left">${t('myCard.daysLeft', { days })}</div>`
      : ''}
    <div class="eq-my-stats">${t('myCard.stats', { views: l.view_count||0, contacts: l.contact_count||0 })}</div>
    <div class="eq-my-actions">
      ${canEdit   ? `<button class="eq-btn eq-btn-outline" onclick="eqOpenEdit('${l.id}')">${t('myCard.edit')}</button>` : ''}
      ${canRenew  ? `<button class="eq-btn eq-btn-primary" onclick="eqRenew('${l.id}')">${t('myCard.renew')}</button>` : ''}
      ${canPause  ? `<button class="eq-btn eq-btn-ghost"  onclick="eqTogglePause('${l.id}','approved')">${t('myCard.pause')}</button>` : ''}
      ${canResume ? `<button class="eq-btn eq-btn-primary" onclick="eqTogglePause('${l.id}','paused')">${t('myCard.resume')}</button>` : ''}
      <button class="eq-btn eq-btn-danger" onclick="eqDeleteListing('${l.id}','${l.status}')">${t('myCard.delete')}</button>
    </div>
  </div>
</div>`;
}


/* ================================================================
   🔄 القسم 16: تجديد الإعلان
   ================================================================ */

async function eqRenew(id) {
  /* التقييد بـ user_id هنا وفي التحديث أدناه — بقية عمليات هذا الملف
     (التعديل/الإيقاف/الحذف) تقيّده أصلًا، وكان التجديد وحده يعتمد على RLS فقط. */
  const { data: listing } = await eqSb.from('listings')
    .select('renewal_count, expires_at')
    .eq('id', id).eq('user_id', eqUser.id).single();
  if (!listing) return;

  if ((listing.renewal_count || 0) >= MAX_RENEWALS) {
    alert(t('renew.maxReached'));
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
  }).eq('id', id).eq('user_id', eqUser.id);

  if (error) { alert(t('renew.error')); return; }

  await eqSb.from('listing_renewals').insert({ listing_id: id, user_id: eqUser.id });
  alert(t('renew.success'));
  eqLoadMyListings();
}


/* ================================================================
   🗑️ القسم 17: حذف الإعلان (Soft Delete)
   ================================================================ */

async function eqDeleteListing(id, status) {
  const msg = status === 'approved'
    ? t('delete.confirmActive')
    : t('delete.confirmOther');
  if (!confirm(msg)) return;

  try {
    const { data: { session } } = await eqSb.auth.getSession();
    const token = session?.access_token;
    if (!token) { alert(t('delete.loginRequired')); return; }

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
        if (error) { alert(t('delete.deleteError') + ': ' + error.message); return; }
        alert(t('delete.deletedSoft'));
        eqLoadMyListings();
        return;
      }
      alert(t('delete.deleteFailed', { error: err.error || t('delete.unexpectedError') }));
      return;
    }

    alert(t('delete.deletedFull'));
    eqLoadMyListings();
  } catch (e) {
    alert(t('delete.deleteError'));
  }
}


/* ================================================================
   ✏️ القسم 23: تعديل الإعلان
   ================================================================ */

async function eqOpenEdit(id) {
  const l = eqMyListings.find(x => x.id === id);
  if (!l) return;

  const { data: profile } = await eqSb.from('profiles')
    .select('is_suspended, suspension_reason, suspended_until')
    .eq('id', eqUser.id).single();
  const isSuspended = profile?.is_suspended &&
    (!profile.suspended_until || new Date(profile.suspended_until) > new Date());
  if (isSuspended) {
    const until = profile.suspended_until ? t('suspended.untilDate', { date: new Date(profile.suspended_until).toLocaleDateString(getLocale()==='en'?'en-US':'ar-EG') }) : t('suspended.untilReview');
    alert(t('suspended.title') + (profile.suspension_reason ? t('suspended.reason', { reason: profile.suspension_reason }) : '') + '\n' + until);
    return;
  }

  document.getElementById('eq-edit-id').value     = id;
  document.getElementById('eq-edit-orig-status').value = l.status;

  /* ملء قوائم الاختيار */
  document.getElementById('eq-edit-category').innerHTML =
    EQ_CATEGORIES.map(c => `<option value="${c.id}"${eqNormCat(l.category)===c.id?' selected':''}>${eqCatLabel(c.id)}</option>`).join('');

  document.getElementById('eq-edit-condition').innerHTML =
    EQ_CONDITIONS.map(c => `<option value="${c.id}"${l.condition===c.id?' selected':''}>${eqCondLabel(c.id)}</option>`).join('');

  document.getElementById('eq-edit-region').innerHTML =
    EQ_GOVS.map(g => `<option value="${g}"${l.region===g?' selected':''}>${eqGovLabel(g)}</option>`).join('');

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
    note.textContent = t('edit.noteApprovedPaused');
  } else if (l.status === 'rejected') {
    note.className = 'eq-edit-note eq-edit-note-warn';
    note.textContent = t('edit.noteRejected');
  } else {
    note.className = 'eq-edit-note eq-edit-note-info';
    note.textContent = t('edit.noteDefault');
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

  if (!title)         { alert(t('edit.titleRequired'));  return; }
  if (!phone)         { alert(t('edit.phoneRequired'));   return; }
  if (!price || price <= 0) { alert(t('edit.priceRequired')); return; }

  /* الإعلانات المرفوضة تعود للمراجعة بعد التعديل */
  const newStatus = origStatus === 'rejected' ? 'pending' : origStatus;

  const btn = document.getElementById('eq-edit-save-btn');
  btn.disabled = true;
  btn.textContent = t('edit.saving');

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
  btn.textContent = t('edit.save');

  if (error) { alert(t('edit.saveError', { error: error.message })); return; }

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
  alert(origStatus === 'rejected' ? t('edit.savedRejected') : t('edit.savedSuccess'));
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
    label.textContent = t('bottomNav.myAccount');
    if (desc) desc.textContent = name.split(' ')[0] || t('bottomNav.welcome');
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = t('bottomNav.login');
    if (desc) desc.textContent = t('bottomNav.loginDesc');
  }
}


/* ================================================================
   ⏸ القسم 24: إيقاف / تفعيل الإعلان
   ================================================================ */

async function eqTogglePause(id, currentStatus) {
  const pausing  = currentStatus === 'approved';
  const newStatus = pausing ? 'paused' : 'approved';
  const msg = pausing ? t('pause.confirmPause') : t('pause.confirmResume');
  if (!confirm(msg)) return;

  const { error } = await eqSb.from('listings')
    .update({ status: newStatus })
    .eq('id', id).eq('user_id', eqUser.id);

  if (error) { alert(t('pause.error', { error: error.message })); return; }
  alert(pausing ? t('pause.pausedSuccess') : t('pause.resumedSuccess'));
  eqLoadMyListings();
}


/* ================================================================
   ⏰ القسم 22: Lifecycle & Expiry Handler (Lazy Evaluation)
   ================================================================ */

async function eqRunLifecycle() {
  /* RPC يجاوز RLS — دالة expire_old_listings في Supabase (cron يومي هو الخط الأساسي،
     وهذا النداء تفاعلي إضافي عشان يتفعّل بسرعة أكبر أثناء تصفّح المستخدمين) */
  try {
    await eqSb.rpc('expire_old_listings');
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

/* التطبيع هنا لا عند كل مُستدعٍ: كرت، تفاصيل، عنوان الحالة الفارغة —
   كلها بتاخد الاسم العربي الصحيح للإعلانات القديمة بدل الـid الخام */
function eqCatLabel(id) {
  const norm = eqNormCat(id);
  return t('categories.' + norm, { defaultValue: norm });
}

function eqCondLabel(id) {
  return t('conditions.' + id, { defaultValue: id });
}

/* المحافظات مخزّنة في DB كنص عربي حرفي (قيمة region تُطابَق حرفيًا) — الترجمة
   للعرض فقط، القيمة الأصلية تفضل زي ما هي (راجع govLabels في locales/en/market.json) */
function eqGovLabel(g) {
  return t('govLabels.' + g, { defaultValue: g });
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
  const count = eqFavorites.size;
  const badge = document.getElementById('eq-fav-badge');
  if (badge) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.classList.toggle('show', count > 0);
  }
  btn.title = count > 0 ? t('favorites.titleWithCount', { count }) : t('favorites.title');
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

/* زر الكرت بقى SVG لا إيموجي، فالتحديث بيغيّر الرسمة والحالة معًا؛
   أزرار المودال تفضل نصية زي ما هي */
function _eqPaintFavBtn(btn, on) {
  if (btn.classList.contains('eq-fav-btn')) {
    btn.innerHTML = _eqHeartSvg(on);
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  } else {
    btn.textContent = on ? t('detail.inFavorite') : t('detail.addFavorite');
  }
}

async function eqToggleFavorite(e, id) {
  e.preventDefault();
  e.stopPropagation();
  /* الزائر كان بيتقذف للرئيسية بلا سبب ظاهر ولا طريق رجوع. دلوقتي بيروح
     لصفحة الدخول ومعاه رابط العودة لنفس الإعلان — نفس سلوك زر التواصل
     في مودال التفاصيل */
  if (!eqUser) {
    const back = encodeURIComponent('/market/?listing=' + id);
    window.location.href = `/?p=login&next=${back}`;
    return;
  }

  const isFav = eqFavorites.has(id);
  const allBtns = document.querySelectorAll(`[data-fav="${id}"]`);

  if (isFav) {
    await eqSb.from('favorites').delete()
      .eq('user_id', eqUser.id).eq('listing_id', id);
    eqFavorites.delete(id);
    allBtns.forEach(b => _eqPaintFavBtn(b, false));
  } else {
    await eqSb.from('favorites').insert({ user_id: eqUser.id, listing_id: id });
    eqFavorites.add(id);
    allBtns.forEach(b => _eqPaintFavBtn(b, true));
  }
  eqUpdateFavBtn();
}

async function eqOpenFavorites() {
  eqCloseAccountMenu();
  document.getElementById('eq-fav-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  const cont = document.getElementById('eq-fav-body');
  if (eqFavorites.size === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>${t('favorites.empty')}</p><a class="eq-btn eq-btn-primary" href="/market/">${t('favorites.browseProjects')}</a></div>`;
    return;
  }

  cont.innerHTML = `<div class="eq-loading"><div class="eq-spinner"></div><p>${t('favorites.loading')}</p></div>`;

  const { data } = await eqSb
    .from('listings')
    .select('id, title, cover_image, price, region, status, category')
    .in('id', [...eqFavorites]);

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>${t('favorites.emptyListings')}</p></div>`;
    return;
  }

  cont.innerHTML = data.map(l => {
    const img = l.cover_image
      ? `<img src="${_cardUrl(l.cover_image)}" alt="${l.title}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0">`
      : `<div style="width:60px;height:60px;background:#F3F4F6;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:20px">📦</div>`;
    const price = Number(l.price).toLocaleString(getLocale()==='en'?'en-US':'ar-EG');
    return `
    <div style="display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid #F0F0F0">
      <div style="cursor:pointer;display:flex;gap:12px;align-items:center;flex:1;min-width:0" onclick="eqCloseFavorites();eqOpenDetail('${l.id}')">
        ${img}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:14px;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.title}</div>
          <div style="color:var(--orange);font-weight:800;font-size:14px">${price} ${t('card.currency')}</div>
          <div style="font-size:12px;color:#999">📍 ${l.region ? eqGovLabel(l.region) : ''}</div>
        </div>
      </div>
      <button data-fav="${l.id}" onclick="eqToggleFavorite(event,'${l.id}');this.closest('div[style]').remove()"
        style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;flex-shrink:0" title="${t('detail.removeFavorite')}">❤️</button>
    </div>`;
  }).join('');
}

function eqCloseFavorites() {
  document.getElementById('eq-fav-modal')?.classList.remove('open');
  document.body.style.overflow = '';
}


/* ================================================================
   🔔 القسم 22: الإشعارات — موحّدة عبر وحدة GN
   ================================================================ */
/* تم نقل نظام الإشعارات إلى notifications.js (وحدة GN الموحّدة) */
