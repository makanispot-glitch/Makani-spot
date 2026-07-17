/* ================================================================
   📁 bazaars/app.js — منطق صفحة البازارات المستقلة
   ================================================================
   هذا الملف مسؤول عن:
     - تحميل البازارات من Supabase
     - الفلترة والبحث والترتيب
     - بناء كروت البازارات وعرضها
     - صفحة تفاصيل البازار + خريطة الأماكن البصرية
     - نظام حجز الأماكن (bazaar_slots + bazaar_bookings)
     - حالة المستخدم (تسجيل الدخول لإتمام الحجز)
   ================================================================ */


/* ================================================================
   ⚙️ القسم 1: الإعدادات والثوابت
   ================================================================ */

/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */


/* ================================================================
   🗄️ القسم 2: المتغيرات العامة
   ================================================================ */

let sbClient        = null;     // كائن Supabase
let currentUser     = null;     // بيانات المستخدم المسجّل
let currentProfile  = null;     // بيانات الـ profile
let currentCapabilities = null; // getAccountCapabilities(profile, organizerProfile) — مصدر واحد لقرارات الصلاحيات

let BAZAARS        = [];       // قائمة البازارات المحمّلة
let bzFiltered     = [];       // البازارات بعد تطبيق الفلاتر
let currentBazaar  = null;     // البازار المعروض في صفحة التفاصيل
let bzPage         = 1;        // رقم الصفحة الحالية
const BZ_PER_PAGE  = 9;        // عدد البازارات في كل صفحة
let selectedSlotId = null;     // id المكان المختار في الخريطة
let bzActiveChip   = '';       // الـ chip المفعّل
let bzTimeNav        = 'all';  // التنقل الزمني: 'all' | 'today' | 'upcoming' | 'past'
let bzOrgSearchOpen  = false;  // حالة لوحة البحث عن المنظم
let _slotMapChannel  = null;   // قناة Realtime لخريطة الأماكن
let _bzRenderPending = false;  // throttle للرندر بـ requestAnimationFrame
let _bazaarStatsChannel = null; // قناة Realtime لإحصائيات الأنشطة (bazaar_bookings)
let _bzStatsDebounce    = null; // مؤقّت تهدئة إعادة جلب إحصائيات الأنشطة

/* "اليوم" بتوقيت القاهرة — نفس المنطقة الزمنية التي يعتمدها الكرون في قاعدة البيانات
   (update_bazaar_statuses/auto_archive_expired_bazaars) لتفادي أي تعارض قرب منتصف الليل
   بين حالة البازار المعروضة هنا وحالته الفعلية في القاعدة */
function _cairoTodayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

/* تنسيق الأرقام والتواريخ حسب اللغة الحالية — بديل موحّد عن toLocaleString('ar-EG') المكرر */
function _bzNumLocale() { return getLocale() === 'en' ? 'en-US' : 'ar-EG'; }
function _bzFmtNum(val) { return Number(val || 0).toLocaleString(_bzNumLocale()); }
function _bzFmtDateLong(d, opts) { return new Date(d).toLocaleDateString(_bzNumLocale(), opts); }


/* ================================================================
   🌐 دعم اللغتين — إعادة رسم المحتوى الديناميكي عند تبديل اللغة
   ================================================================ */
/* مسجَّل عند تحميل الملف (top-level)، قبل أي نداء t() — راجع feedback-i18n-gotchas نقطة 6 */
document.addEventListener('makani:locale-changed', () => {
  bzRenderNavUser();
  if (BAZAARS.length) renderBazaarCards();
  updateBzSlider();
  if (currentBazaar) {
    if (currentUser) openBazaarDetail(currentBazaar.id, { silent: true });
    else _showBzLoginGate(currentBazaar);
  }
  if (currentUser) bzLoadPostponeAlerts();
  if (document.getElementById('bz-opp-cards')) _bzInitOpportunitiesPage();
});


/* ================================================================
   🚀 القسم 3: نقطة البداية
   ================================================================ */

document.addEventListener('DOMContentLoaded', async function () {

  // تهيئة Supabase
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.warn('⚠️ Supabase غير محمّل بعد');
  }

  // تحقق من حالة تسجيل الدخول
  await bzInitAuth();

  // تحميل البازارات
  await loadBazaars();


  // M9: تحميل تنبيهات التأجيل للمستخدم المسجّل
  if (currentUser) bzLoadPostponeAlerts();

  // GN: تهيئة نظام الإشعارات الموحّد
  if (currentUser) GN.init(sbClient, currentUser.id);

  // التنقل عبر URL parameter: /bazaars/?bazaar=ID (و book=1 للانتقال مباشرة لخريطة الأماكن — رابط الحجز المباشر)
  const urlParams = new URLSearchParams(window.location.search);
  const bazaarId  = urlParams.get('bazaar');
  if (bazaarId) {
    await openBazaarDetail(bazaarId, { scrollToBooking: urlParams.get('book') === '1' });
  }
});


/* ================================================================
   🔐 القسم 4: المصادقة
   ================================================================ */

/* تحديث فوري للصلاحيات (المرحلة ٦) — عند موافقة أدمن (owner/منظّم) بينما التبويب
   مفتوح: أعد جلب البروفايل وأعد رسم الناف بلا reload. مسجَّل مرة واحدة فقط؛
   يتحقق من currentUser وقت وصول الحدث نفسه لا وقت التسجيل. */
window.addEventListener('gn:permission-changed', async () => {
  if (!currentUser) return;
  await _loadBzProfile();
  bzRenderNavUser();
});

async function bzInitAuth() {
  if (!sbClient) return;
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    currentUser = session?.user || null;
    if (currentUser) await _loadBzProfile();
    bzRenderNavUser();
    if (document.getElementById('bz-opp-cards')) _bzInitOpportunitiesPage();

    sbClient.auth.onAuthStateChange(async (_e, sess) => {
      currentUser = sess?.user || null;
      currentProfile = null;
      currentCapabilities = null;
      if (currentUser) {
        await _loadBzProfile();
        GN.init(sbClient, currentUser.id);
      } else {
        GN.destroy();
      }
      bzRenderNavUser();
    });
  } catch (e) {
    console.warn('تعذّر تهيئة المصادقة:', e.message);
  }
}

function _bzInitOpportunitiesPage() {
  const grid = document.getElementById('bz-opp-cards');
  if (!grid) return;
  if (!currentUser) {
    grid.innerHTML = `<div class="bzopp-access-msg"><span style="font-size:40px">🔒</span><p>${t('opportunities.loginRequiredMsg')}</p><a href="/?p=login" style="display:inline-block;margin-top:12px;padding:10px 22px;background:var(--orange);color:#fff;border-radius:var(--radius-pill);font-weight:800;text-decoration:none">${t('opportunities.loginBtn')}</a></div>`;
    return;
  }
  if (!_bzIsOrganizer()) {
    grid.innerHTML = `<div class="bzopp-access-msg"><span style="font-size:40px">🔒</span><p>${t('opportunities.notOrganizerMsg')}</p></div>`;
    return;
  }
  bzLoadOpportunities();
}

async function _loadBzProfile() {
  if (!sbClient || !currentUser) return;
  try {
    const [profRes, orgRes] = await Promise.all([
      sbClient.from('profiles').select('full_name, phone, avatar_url, is_verified, roles').eq('id', currentUser.id).single(),
      sbClient.from('organizer_profiles').select('avatar_url, logo, image, is_verified').eq('user_id', currentUser.id).single()
    ]);
    currentProfile = {
      ...(profRes.data || {}),
      avatar_url: profRes.data?.avatar_url || orgRes.data?.avatar_url || orgRes.data?.logo || orgRes.data?.image || '',
    };
    // ملاحظة: is_verified/roles لم تعُد تُحسَب هنا — كل قرارات الصلاحيات تقرأ
    // من currentCapabilities (المصدر الوحيد)، لا من currentProfile مباشرة.
    currentCapabilities = getAccountCapabilities(profRes.data, orgRes.data);
  } catch (_) {}
}

function bzRenderNavUser() {
  const area = document.getElementById('bz-nav-user');
  if (!area) return;

  if (currentUser) {
    const name      = currentProfile?.full_name || currentUser.email || '';
    const initial   = (name[0] || '?').toUpperCase();
    const email     = currentUser.email || '';
    const avatarUrl = currentProfile?.avatar_url || '';
    const avatarHtml = avatarUrl
      ? `<img src="${_toDirectImgUrl(avatarUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : initial;

    area.innerHTML = `
      <div class="bz-nav-user-wrap">


        ${_bzIsOrganizer() ? `
        <a class="bz-cta-organize" href="/bazaars/organize.html" title="${t('userNav.createBazaarTooltip')}">
          <svg class="bz-cta-organize-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <span class="bz-cta-organize-full">${t('userNav.createBazaar')}</span><span class="bz-cta-organize-short">${t('userNav.createBazaarShort')}</span>
        </a>` : ''}

        <div class="nav-avatar-btn" id="bz-avatar-btn" onclick="bzToggleAccountMenu(event)">
          <div class="nav-avatar-circle">${avatarHtml}</div>
          <div class="nav-avatar-info">
            <div class="nav-avatar-name">${name || t('userNav.defaultAccountName')}</div>
            <div class="nav-avatar-email">${email}</div>
          </div>
          <div class="nav-avatar-caret">▼</div>

          <div class="nav-dropdown" id="bz-dropdown">
            <div class="nav-dropdown-header">
              <div class="nav-dropdown-name">${name || t('userNav.defaultAccountName')}</div>
              <div class="nav-dropdown-email">${email}</div>
              <div class="nav-dropdown-role">${currentCapabilities?.organizerVerified ? t('userNav.roleOrganizerVerified') : _bzIsOrganizer() ? t('userNav.roleOrganizer') : t('userNav.roleUser')}</div>
            </div>
            ${_bzIsOrganizer() ? `
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/organize.html'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              ${t('userNav.createBazaar')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/manage.html'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="1.6" fill="currentColor" stroke="none"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="1.6" fill="currentColor" stroke="none"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="17" r="1.6" fill="currentColor" stroke="none"/></svg>
              ${t('userNav.manageBazaars')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/opportunities.html'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21h16"/><path d="M6 21V7l6-4 6 4v14"/><path d="M10 21v-5h4v5"/><path d="M10 10h.01M14 10h.01M10 14h.01M14 14h.01"/></svg>
              ${t('userNav.opportunities')}
            </button>
            <div class="nav-dropdown-sep"></div>` : ''}
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/profile.html'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/></svg>
              ${t('userNav.profile')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/?p=dashboard'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              ${t('userNav.dashboard')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/market/'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
              ${t('userNav.myListings')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 21h17L12 3 3.5 21Z"/><path d="M12 3v18"/></svg>
              ${t('userNav.joinBazaar')}
            </button>
            <button class="nav-dropdown-item" onclick="window.location.href='/?p=market'">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              ${t('userNav.findSpace')}
            </button>
            <div class="nav-dropdown-sep"></div>
            <button class="nav-dropdown-item danger" onclick="bzSignOut()">
              <svg class="dd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>
              ${t('userNav.signOut')}
            </button>
          </div>
        </div>

      </div>`;
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
  bzUpdateBnUser();
  // جرس الإشعارات الموحّد
  if (currentUser) GN.mount(
    document.querySelector('#bz-nav-user .bz-nav-user-wrap') ||
    document.getElementById('bz-nav-user')
  );
  // أيقونة إدارة البازارات — بجوار الجرس
  if (currentUser) bzMountManageIcon();
}

/* أيقونة "إدارة البازارات" في الناف — نفس تصميم/حجم جرس الإشعارات (gn-bell)
   تفتح دائماً /bazaars/manage.html، والصفحة نفسها تقرر: تسجيل دخول ناقص /
   ليس منظم بازارات بعد / لوحة الإدارة الكاملة — راجع الحارس في manage.js */
function bzMountManageIcon() {
  const wrap = document.querySelector('#bz-nav-user .bz-nav-user-wrap');
  if (!wrap) return;

  wrap.querySelector('#bz-manage-icon')?.remove();

  const btn = document.createElement('div');
  btn.id        = 'bz-manage-icon';
  btn.className = 'gn-bell';
  btn.setAttribute('role', 'button');
  btn.setAttribute('aria-label', t('userNav.manageIconTooltip'));
  btn.title = t('userNav.manageIconTooltip');
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    '     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
    '     width="20" height="20" aria-hidden="true">' +
    '  <line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>' +
    '  <line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>' +
    '  <line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="18" r="2" fill="currentColor" stroke="none"/>' +
    '</svg>';
  btn.addEventListener('click', () => { window.location.href = '/bazaars/manage.html'; });

  /* الترتيب المعتمد في كل صفحات المنصة: الجرس ملاصق للأفاتار مباشرة (GN.mount
     بيحطه قبل avatarBtn مباشرة). فأيقونة الإدارة الجديدة لازم تتحط قبل الجرس
     (بعيد عن الأفاتار)، مش بعده — عشان محدش يتقحّم بين الجرس والأفاتار. */
  const bell = wrap.querySelector('#gn-bell');
  if (bell) bell.insertAdjacentElement('beforebegin', btn);
  else wrap.insertBefore(btn, wrap.querySelector('.nav-avatar-btn') || wrap.firstChild);
}

function bzToggleAccountMenu(e) {
  e.stopPropagation();
  const btn = document.getElementById('bz-avatar-btn');
  const dd  = document.getElementById('bz-dropdown');
  if (!btn || !dd) return;
  if (dd.classList.contains('open')) {
    btn.classList.remove('open');
    dd.classList.remove('open');
  } else {
    btn.classList.add('open');
    dd.classList.add('open');
  }
}

document.addEventListener('click', (e) => {
  const btn = document.getElementById('bz-avatar-btn');
  if (btn && !btn.contains(e.target)) {
    btn.classList.remove('open');
    document.getElementById('bz-dropdown')?.classList.remove('open');
  }
});

async function bzSignOut() {
  await sbClient?.auth.signOut();
  window.location.reload();
}

/* ── إشعارات المنظم ── */
/* إشعارات المنظم (organizer_notifications) — تم إزالة الكود الميّت
   الإشعارات الآن موحّدة في جدول notifications عبر وحدة GN */


/* ================================================================
   🧭 القسم 5: التنقل بين الصفحتين
   ================================================================ */

function showBzPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}


/* ================================================================
   🛠️ القسم 6: دوال مساعدة للبيانات
   ================================================================ */

function _toDirectImgUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^\/\?\s]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&\s]+)/);
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  const m3 = url.match(/drive\.google\.com\/uc\?.*id=([^&\s]+)/);
  if (m3) return `https://lh3.googleusercontent.com/d/${m3[1]}`;
  return url;
}

/* رابط آمن للعرض كـ href — يقبل http/https فقط (يمنع حقن javascript:/data: وغيرها عبر روابط
   التوثيق التي يُدخلها المنظم يدوياً)، ويُهرّب المحتوى لمنع كسر الخاصية بعلامات اقتباس */
function _safeEventLinkHref(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return _esc(u);
  } catch { return null; }
}

/* تهريب HTML — يمنع XSS عند إدراج محتوى المستخدم في innerHTML */
function _esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}


/* ================================================================
   📥 القسم 7: تحميل البازارات من Supabase
   ================================================================ */

async function loadBazaars() {
  try {
    if (!sbClient) {
      _renderBazaarsEmpty(t('grid.connectionError'));
      return;
    }

    const { data, error } = await sbClient
      .from('bazaars')
      .select('id,name,venue_name,region,date_start,date_end,time_start,time_end,price_per_slot,available_slots,total_slots,image,description,category,venue_type,organizer,organizer_id,organizer_avatar_url,is_organizer_verified,venue_address,address,maps_link,sketch_url,event_image_url,status,is_featured,is_archived,premium_slots,premium_price,event_links,included_amenities,chair_count,other_amenities_note,ad_budget_tier,will_have_photography,will_have_social_coverage,will_have_paid_ads')
      .in('status', ['published', 'live', 'completed'])
      .eq('is_archived', false)
      .eq('is_deleted', false)
      .order('date_start', { ascending: true });

    if (error) throw new Error(error.message);

    if (!data || !data.length) {
      _renderBazaarsEmpty();
      return;
    }

    BAZAARS = data.map(b => ({
      id:                   String(b.id),
      name:                 b.name || '—',
      location:             b.venue_name || b.location || '',
      region:               b.region || '',
      date_start:           b.date_start || '',
      date_end:             b.date_end || '',
      time_start:           b.time_start || '',
      time_end:             b.time_end || '',
      price_per_slot:       Number(b.price_per_slot) || 0,
      available_slots:      Number(b.available_slots) || 0,
      total_slots:          Number(b.total_slots) || 0,
      image:                _toDirectImgUrl(b.image || ''),
      description:          b.description || '',
      category:             b.category || b.venue_type || '',
      organizer:            b.organizer || '',
      organizer_id:         b.organizer_id || null,
      organizer_avatar_url: _toDirectImgUrl(b.organizer_avatar_url || ''),
      is_organizer_verified: b.is_organizer_verified || false,
      venue_address:        b.venue_address || b.address || '',
      maps_link:            b.maps_link || '',
      sketch_url:           _toDirectImgUrl(b.sketch_url || ''),
      event_image_url:      _toDirectImgUrl(b.event_image_url || b.image || ''),
      status:               b.status || 'published',
      event_links:          Array.isArray(b.event_links) ? b.event_links : [],
      included_amenities:        Array.isArray(b.included_amenities) ? b.included_amenities : [],
      chair_count:                Number(b.chair_count) || null,
      other_amenities_note:       b.other_amenities_note || '',
      ad_budget_tier:              b.ad_budget_tier || '',
      will_have_photography:      !!b.will_have_photography,
      will_have_social_coverage:  !!b.will_have_social_coverage,
      will_have_paid_ads:         !!b.will_have_paid_ads,
    }));

    console.log(`✅ تم تحميل ${BAZAARS.length} بازار من Supabase`);
    applyBzFilters();

  } catch (err) {
    console.error('❌ خطأ في تحميل البازارات:', err.message);
    _renderBazaarsEmpty(t('grid.loadError'));
  }
}

function _renderBazaarsEmpty(hint) {
  const hintHtml = hint
    ? `<div style="margin-top:10px;font-size:11px;color:#FFA366;opacity:0.80;
                   background:rgba(243,100,24,0.08);border:1px solid rgba(243,100,24,0.20);
                   border-radius:8px;padding:8px 14px;max-width:400px;margin-inline:auto">
         ⚠️ ${hint}
       </div>`
    : '';
  const grid = document.getElementById('bz-grid');
  if (grid) grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:14px">🎪</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:8px">${t('grid.emptyTitle')}</div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:10px">${t('grid.emptyHint')}</div>
      ${hintHtml}
    </div>`;
}


/* ================================================================
   🃏 القسم 8: بناء كروت البازارات
   ================================================================ */

function buildBazaarCard(b) {
  /* ── التاريخ ── */
  let dayNum = '', monthStr = '', dateLabel = '—', endLabel = '';
  if (b.date_start) {
    const d  = new Date(b.date_start);
    dayNum   = d.getDate();
    monthStr = _bzFmtDateLong(d, { month: 'short' });
    dateLabel = _bzFmtDateLong(d, { weekday:'short', month:'long', day:'numeric' });
  }
  if (b.date_end && b.date_end !== b.date_start) {
    endLabel = (getLocale() === 'en' ? ' → ' : ' ← ') + _bzFmtDateLong(b.date_end, { month:'short', day:'numeric' });
  }

  /* ── حالة الوقت ── */
  const todayStr   = _cairoTodayStr();
  const endDate    = b.date_end || b.date_start;
  const isExpired  = b.status === 'completed' || (endDate ? endDate < todayStr : false);
  const isActiveNow = !isExpired && b.date_start && b.date_start <= todayStr
                    && (!b.date_end || b.date_end >= todayStr);

  /* ── الأماكن ── */
  const availSlots = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
  const isSoldOut  = availSlots === 0 && (b.total_slots || 0) > 0;

  /* ── الصورة ── */
  const imgHtml = b.image
    ? `<img src="${b.image}" alt="${b.name}" loading="lazy"
           onerror="this.parentElement.innerHTML='<div class=\\'bz-img-placeholder\\'>🎪</div>'">`
    : `<div class="bz-img-placeholder">🎪</div>`;

  /* ── المنظّم ── */
  const orgName     = b.organizer || '';
  const orgInitial  = orgName ? orgName[0].toUpperCase() : '🎪';
  const orgVerified = b.is_organizer_verified;
  const orgSubText  = orgVerified ? t('card.verifiedOrganizer') : t('card.organizerFallback');

  const orgProfileHref = b.organizer_id
    ? `/bazaars/profile.html?organizer=${b.organizer_id}`
    : null;

  /* أفاتار المنظم: صورة حقيقية إن وُجدت، وإلا الحرف الأول */
  const orgAvatarInner = b.organizer_avatar_url
    ? `<img src="${b.organizer_avatar_url}" alt="${_esc(orgName)}"
           style="width:100%;height:100%;object-fit:cover;border-radius:50%"
           onerror="this.outerHTML='${_esc(orgInitial)}'">`
    : orgInitial;

  const orgHtml = orgName ? `
  <div class="bz-card-organizer" ${orgProfileHref ? `style="cursor:pointer" onclick="event.stopPropagation();window.location.href='${orgProfileHref}'"` : ''}>
    <div class="bz-org-avatar" data-org-id="${b.organizer_id || ''}" data-initial="${_esc(orgInitial)}">${orgAvatarInner}</div>
    <div class="bz-org-info">
      <div class="bz-org-name">🎪 ${orgName}</div>
      <div class="bz-org-sub">${orgSubText}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-right:auto">
      ${orgVerified ? `<span class="bz-verified-badge">${t('card.verifiedBadge')}</span>` : ''}
      ${orgProfileHref ? `<span style="font-size:10px;color:var(--orange);opacity:.8">${getLocale() === 'en' ? '→' : '←'}</span>` : ''}
    </div>
  </div>` : '';

  /* ── HTML ── */
  return `
  <div class="bz-card${isSoldOut ? ' soldout-card' : ''}${isExpired ? ' bz-card-expired' : ''}" onclick="openBazaarDetail('${b.id}')">

    ${orgVerified ? '<div class="bz-verified-org-bar"></div>' : ''}

    <!-- صورة البازار (يمين) -->
    <div class="bz-card-img">
      ${imgHtml}
      ${dayNum ? `
      <div class="bz-date-box">
        <span class="bz-date-box-day">${dayNum}</span>
        <span class="bz-date-box-month">${monthStr}</span>
      </div>` : ''}
      ${b.category ? `
      <div class="bz-card-cat-pill">
        <span>${b.category}</span>
      </div>` : ''}
      ${isExpired    ? `<div class="bz-expired-badge">${t('card.expired')}</div>`
        : isSoldOut  ? `<div class="bz-soldout-badge">${t('card.soldOut')}</div>`
        : isActiveNow? `<div class="bz-active-now-badge">${t('card.activeNow')}</div>`
        : ''}
    </div>

    <!-- المحتوى (يسار) -->
    <div class="bz-card-content">

      <!-- الاسم والموقع -->
      <div class="bz-card-name" title="${b.name}">${b.name}</div>
      ${(b.location || b.region) ? `
      <div class="bz-card-location">
        <span>📍</span> ${[b.location, b.region].filter(Boolean).join(' — ')}
      </div>` : ''}

      <!-- التاريخ والوقت -->
      <div class="bz-card-datetime">
        <span>📅 ${dateLabel}${endLabel}</span>
        ${b.time_start ? `<span>🕐 ${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}</span>` : ''}
      </div>

      <!-- الوصف -->
      ${b.description
        ? `<div class="bz-card-desc">${b.description}</div>`
        : `<div class="bz-card-desc" style="color:var(--ink3);font-style:italic">${t('card.noDescription')}</div>`}

      <!-- المنظّم -->
      ${orgHtml}

      <!-- الذيل: السعر + الأماكن + زر -->
      <div class="bz-card-footer">
        <div>
          <div class="bz-price-tag">${_bzFmtNum(b.price_per_slot)} ${t('card.priceUnit')}</div>
          <div class="bz-slots-tag${isSoldOut ? ' sold-out' : ''}">
            ${isSoldOut ? t('card.noSlotsAvailable') : t('card.slotsAvailable', { count: availSlots })}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="share-btn-inline"
                  onclick="event.stopPropagation();shareCard('${b.id}','${(b.name||'').replace(/'/g,"\\'")}');"
                  title="${t('card.shareTooltip')}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                 width="13" height="13" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
          </button>
          <button class="btn btn-primary" style="font-size:12px;padding:8px 16px;white-space:nowrap"
                  onclick="event.stopPropagation();openBazaarDetail('${b.id}')">
            ${t('card.detailsBtn')}
          </button>
        </div>
      </div>

    </div>
  </div>`;
}


/* ================================================================
   🔄 القسم 9: عرض الشبكة + Pagination
   ================================================================ */

function renderBazaarCards() {
  const grid    = document.getElementById('bz-grid');
  const countEl = document.getElementById('bz-count');
  if (!grid) return;

  if (countEl) countEl.textContent = t('grid.count', { count: bzFiltered.length });

  const start    = (bzPage - 1) * BZ_PER_PAGE;
  const pageData = bzFiltered.slice(start, start + BZ_PER_PAGE);

  if (!pageData.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:14px">🎪</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--ink2)">${t('grid.emptyFilteredTitle')}</div>
        <div style="font-size:13px;color:var(--ink3);margin-bottom:18px">${t('grid.emptyFilteredHint')}</div>
        <button class="btn btn-primary" onclick="clearBzFilters()">${t('grid.clearFiltersBtn')}</button>
      </div>`;
    renderBzPagination();
    return;
  }

  grid.innerHTML = pageData.map(b => buildBazaarCard(b)).join('');
  renderBzPagination();
  _loadOrgAvatarsForCards(pageData);
}

function renderBzPagination() {
  const cont = document.getElementById('bz-pagination');
  if (!cont) return;

  const totalPages = Math.ceil(bzFiltered.length / BZ_PER_PAGE);
  if (totalPages <= 1) { cont.innerHTML = ''; return; }

  let html = '';
  if (bzPage > 1) html += `<button class="pg-btn" onclick="bzGoPage(${bzPage - 1})">${t('grid.prevPage')}</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - bzPage) <= 2) {
      html += `<button class="pg-btn${i === bzPage ? ' on' : ''}" onclick="bzGoPage(${i})">${i}</button>`;
    } else if (Math.abs(i - bzPage) === 3) {
      html += `<span class="pg-dots">…</span>`;
    }
  }
  if (bzPage < totalPages) html += `<button class="pg-btn" onclick="bzGoPage(${bzPage + 1})">${t('grid.nextPage')}</button>`;
  cont.innerHTML = html;
}

function bzGoPage(n) {
  bzPage = n;
  renderBazaarCards();
  document.getElementById('bz-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}


/* ================================================================
   🔍 القسم 10: الفلترة والبحث
   ================================================================ */

function applyBzFilters() {
  const region   = document.getElementById('bz-region')?.value    || '';
  const dateFrom = document.getElementById('bz-date-from')?.value  || '';
  const dateTo   = document.getElementById('bz-date-to')?.value    || '';
  const maxPrice = parseInt(document.getElementById('bz-slider-max')?.value) || 999999;
  const sort     = document.getElementById('bz-sort')?.value       || 'date-asc';
  const search   = (document.getElementById('bz-search')?.value || '').trim().toLowerCase();

  let data = [...BAZAARS];

  if (search) {
    data = data.filter(b =>
      (b.name        || '').toLowerCase().includes(search) ||
      (b.location    || '').toLowerCase().includes(search) ||
      (b.description || '').toLowerCase().includes(search) ||
      (b.category    || '').toLowerCase().includes(search) ||
      (b.organizer   || '').toLowerCase().includes(search) ||
      (b.region      || '').toLowerCase().includes(search)
    );
  }

  if (bzTimeNav === 'today') {
    const today = _cairoTodayStr();
    data = data.filter(b => b.date_start && (b.date_start === today ||
      (b.date_start <= today && (!b.date_end || b.date_end >= today))));
  } else if (bzTimeNav === 'upcoming') {
    const today = _cairoTodayStr();
    data = data.filter(b => {
      const endDate = b.date_end || b.date_start;
      if (endDate && endDate < today) return false; // مستبعد — منتهي
      return !b.date_start || b.date_start >= today;
    });
  } else if (bzTimeNav === 'past') {
    const today = _cairoTodayStr();
    data = data.filter(b => {
      const endDate = b.date_end || b.date_start;
      return !!(endDate && endDate < today);
    });
  }
  // bzTimeNav === 'all' → يعرض كل شيء حتى المنتهية (مع شارة "انتهى" بصرياً)

  if (bzActiveChip === 'available') {
    data = data.filter(b => {
      const available = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
      return available > 0 || !b.total_slots;
    });
  } else if (bzActiveChip === 'soldout') {
    data = data.filter(b => {
      const available = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
      return available === 0 && (b.total_slots || 0) > 0;
    });
  }

  if (region)   data = data.filter(b => (b.region || b.location || '').includes(region));
  if (dateFrom) data = data.filter(b => b.date_start && b.date_start >= dateFrom);
  if (dateTo)   data = data.filter(b => b.date_start && b.date_start <= dateTo);
  data = data.filter(b => (b.price_per_slot || 0) <= maxPrice);

  if (sort === 'date-asc')   data.sort((a, b) => (a.date_start||'').localeCompare(b.date_start||''));
  if (sort === 'price-asc')  data.sort((a, b) => (a.price_per_slot||0) - (b.price_per_slot||0));
  if (sort === 'price-desc') data.sort((a, b) => (b.price_per_slot||0) - (a.price_per_slot||0));
  if (sort === 'slots-desc') data.sort((a, b) => (b.available_slots||0) - (a.available_slots||0));

  /* ترتيب حسب حالة الوقت: الجارية الآن أولاً، ثم القادمة/العادية، والمنتهية دائماً في الأسفل —
     بغض النظر عن الفرز المختار (فرز مستقر يحافظ على ترتيب كل مجموعة داخلياً) */
  { const _td = _cairoTodayStr();
    const _timeRank = (b) => {
      const end = b.date_end || b.date_start || '';
      if (end && end < _td) return 2; // منتهي
      const isOngoing = b.date_start && b.date_start <= _td && (!b.date_end || b.date_end >= _td);
      return isOngoing ? 0 : 1; // جارٍ الآن أولاً، ثم البقية
    };
    data.sort((x, y) => _timeRank(x) - _timeRank(y));
  }

  bzFiltered = data;
  bzPage     = 1;

  /* throttle الرندر بـ requestAnimationFrame — يمنع تجميد المتصفح عند تغييرات متتالية */
  if (!_bzRenderPending) {
    _bzRenderPending = true;
    requestAnimationFrame(() => {
      _bzRenderPending = false;
      renderBazaarCards();
    });
  }
}

function clearBzFilters() {
  ['bz-region','bz-date-from','bz-date-to','bz-search'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const sl = document.getElementById('bz-slider-max');
  if (sl) sl.value = parseInt(sl.max || 10000);
  updateBzSlider();
  const so = document.getElementById('bz-sort');
  if (so) so.value = 'date-asc';

  bzActiveChip   = '';
  bzOrgSearchOpen = false;
  const orgPanel = document.getElementById('bz-org-search-panel');
  if (orgPanel) orgPanel.style.display = 'none';
  const orgBtn = document.getElementById('bz-chip-org-search');
  if (orgBtn) orgBtn.classList.remove('active');
  bzTimeNav      = 'all';
  document.querySelectorAll('.bz-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.bz-time-btn').forEach(btn => {
    btn.classList.toggle('bz-time-active', btn.dataset.nav === 'all');
  });

  applyBzFilters();
}

function updateBzSlider() {
  const sl = document.getElementById('bz-slider-max');
  if (!sl) return;
  const val = parseInt(sl.value);
  const max = parseInt(sl.max) || 10000;
  const pct = (val / max) * 100;
  const tr  = document.getElementById('bz-slider-track');
  if (tr) tr.style.background =
    `linear-gradient(to right, #e8e8e8 ${100 - pct}%, #F36418 ${100 - pct}%)`;
  const lb = document.getElementById('bz-price-label');
  if (lb) lb.textContent = val >= max ? t('filters.noLimit') : _bzFmtNum(val) + ' ' + t('card.currency');
}

function setBzChip(chip, el) {
  const wasActive = bzActiveChip === chip;
  bzActiveChip = wasActive ? '' : chip;
  document.querySelectorAll('.bz-chip').forEach(c => c.classList.remove('active'));
  if (!wasActive && el) el.classList.add('active');
  applyBzFilters();
}

/* ── بحث المنظمين ── */
function toggleOrgSearch(el) {
  bzOrgSearchOpen = !bzOrgSearchOpen;
  const panel = document.getElementById('bz-org-search-panel');
  const input = document.getElementById('bz-org-search-input');
  const results = document.getElementById('bz-org-results');
  if (panel) panel.style.display = bzOrgSearchOpen ? '' : 'none';
  if (el) el.classList.toggle('active', bzOrgSearchOpen);
  if (bzOrgSearchOpen && input) {
    input.value = '';
    if (results) results.innerHTML = '';
    setTimeout(() => input.focus(), 80);
  }
}

let _orgSearchTimer = null;
async function searchOrganizers(q) {
  const results = document.getElementById('bz-org-results');
  if (!results) return;
  clearTimeout(_orgSearchTimer);

  if (!q || q.trim().length < 1) {
    results.innerHTML = '';
    return;
  }

  results.innerHTML = `<div style="padding:10px;font-size:13px;color:var(--ink3)">${t('orgSearch.searching')}</div>`;

  _orgSearchTimer = setTimeout(async () => {
    try {
      const { data, error } = await sbClient
        .from('organizer_profiles')
        .select('user_id, full_name, logo, whatsapp, bio')
        .ilike('full_name', `%${q.trim()}%`)
        .eq('is_verified', true)
        .limit(8);

      if (error) throw error;
      if (!data || !data.length) {
        results.innerHTML = `<div style="padding:12px;font-size:13px;color:var(--ink3);text-align:center">${t('orgSearch.noResults')}</div>`;
        return;
      }

      results.innerHTML = data.map(org => {
        const name    = org.full_name || t('orgSearch.defaultName');
        const initial = (name[0] || '?').toUpperCase();
        const logo    = org.logo ? `<img src="${org.logo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : initial;
        // عدد بازارات هذا المنظم من البيانات المحملة
        const bzCount = BAZAARS.filter(b => b.organizer_id === org.user_id).length;
        return `
          <div onclick="window.location.href='/bazaars/profile.html?organizer=${org.user_id}'"
            style="display:flex;align-items:center;gap:12px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-lg);
                   background:var(--surface);cursor:pointer;margin-bottom:8px;transition:border-color .2s"
            onmouseover="this.style.borderColor='var(--orange)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="width:40px;height:40px;border-radius:50%;background:var(--orange);color:#fff;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;flex-shrink:0;overflow:hidden">
              ${logo}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:800;font-size:14px;color:var(--dark)">${name}
                <span style="display:inline-flex;align-items:center;gap:2px;background:linear-gradient(135deg,#e8f5e9,#f1f8e9);color:#2e7d32;border:1px solid #a5d6a7;font-size:10px;font-weight:800;padding:1px 6px;border-radius:50px;margin-right:5px">${t('orgSearch.verifiedBadge')}</span>
              </div>
              <div style="font-size:12px;color:var(--ink3);margin-top:2px">${bzCount ? t('orgSearch.bazaarCount', { count: bzCount }) : t('orgSearch.noBazaarsYet')}</div>
            </div>
            <div style="font-size:12px;color:var(--orange);font-weight:700;white-space:nowrap">${t('orgSearch.viewProfile')}</div>
          </div>`;
      }).join('');
    } catch(e) {
      console.warn('searchOrganizers error:', e.message);
      results.innerHTML = `<div style="padding:12px;font-size:13px;color:var(--ink3);text-align:center">${t('orgSearch.searchError')}</div>`;
    }
  }, 320);
}

function setBzTimeNav(nav) {
  bzTimeNav = nav;
  document.querySelectorAll('.bz-time-btn').forEach(btn => {
    btn.classList.toggle('bz-time-active', btn.dataset.nav === nav);
  });
  applyBzFilters();
}


/* ================================================================
   🗺️ القسم 11: صفحة تفاصيل البازار
   ================================================================ */

function _showBzLoginGate(b) {
  currentBazaar  = b;
  selectedSlotId = null;

  const dateStr = b.date_start
    ? _bzFmtDateLong(b.date_start, { month:'long', day:'numeric' })
    : '';

  const headerEl = document.getElementById('bzd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeBazaarDetail()">${t('loginGate.backToBazaars')}</button>
        </div>
        <div class="sd-title-row">
          <div style="flex:1">
            ${b.category ? `<span class="bz-detail-cat-badge">${b.category}</span>` : ''}
            <h1 class="sd-name" style="margin-top:8px">${b.name}</h1>
            <div class="sd-meta">
              <span>📍 ${b.location || '—'}</span>
              ${dateStr ? `<span class="sd-meta-sep">·</span><span>📅 ${dateStr}</span>` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  const infoEl = document.getElementById('bzd-info');
  if (infoEl) {
    infoEl.innerHTML = `
      <div style="text-align:center;padding:64px 24px;max-width:460px;margin:0 auto">
        <div style="font-size:64px;margin-bottom:20px">🔒</div>
        <h2 style="font-size:22px;font-weight:900;color:var(--dark);margin-bottom:10px;font-family:'Cairo',sans-serif">
          ${t('loginGate.title')}
        </h2>
        <p style="font-size:14px;color:var(--ink3);line-height:1.9;margin-bottom:28px;font-family:'IBM Plex Sans Arabic',sans-serif">
          ${t('loginGate.body')}
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:13px 32px;font-size:15px"
                  onclick="window.location.href='/?p=login'">
            ${t('loginGate.loginBtn')}
          </button>
          <button class="btn" style="padding:13px 22px;font-size:14px"
                  onclick="closeBazaarDetail()">
            ${t('loginGate.backBtn')}
          </button>
        </div>
      </div>`;
  }

  const slotmapEl = document.getElementById('bzd-slotmap');
  if (slotmapEl) slotmapEl.innerHTML = '';

  const panel = document.getElementById('bzd-booking-panel');
  if (panel) panel.style.display = 'none';

  showBzPage('bazaar-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function openBazaarDetail(bazaarId, opts = {}) {
  const b = BAZAARS.find(x => String(x.id) === String(bazaarId));
  if (!b) return;

  if (!currentUser) {
    _showBzLoginGate(b);
    return;
  }

  currentBazaar  = b;
  selectedSlotId = null;

  const allList = bzFiltered.length ? bzFiltered : BAZAARS;
  const idx     = allList.findIndex(x => String(x.id) === String(bazaarId));
  const prevB   = idx > 0                    ? allList[idx - 1] : null;
  const nextB   = idx < allList.length - 1   ? allList[idx + 1] : null;

  const dateStr = b.date_start
    ? _bzFmtDateLong(b.date_start, { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  const endStr = b.date_end && b.date_end !== b.date_start
    ? ' — ' + _bzFmtDateLong(b.date_end, { month:'long', day:'numeric' })
    : '';
  const timeRange = b.time_start
    ? `🕐 ${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}`
    : '';

  const isMyBazaar = currentUser && b.organizer_id && String(currentUser.id) === String(b.organizer_id);

  const headerEl = document.getElementById('bzd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeBazaarDetail()">${t('detail.backBtn')}</button>
          ${isMyBazaar ? `
          <a href="/bazaars/manage.html?id=${b.id}"
             style="display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:var(--radius-pill);border:1.5px solid var(--orange);background:var(--orange);color:#fff;font-family:var(--font-display);font-size:13px;font-weight:800;text-decoration:none;white-space:nowrap;transition:opacity .15s;flex-shrink:0"
             onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">
            ${t('detail.editBtn')}
          </a>` : ''}
          <div class="sd-breadcrumb" style="${isMyBazaar ? 'margin-inline-start:auto' : ''}">
            <span onclick="window.location.href='/'" style="cursor:pointer">${t('detail.home')}</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="closeBazaarDetail()" style="cursor:pointer">${t('detail.bazaarsCrumb')}</span>
            <span class="sd-bc-sep">·</span>
            ${b.category ? `<span onclick="closeBazaarDetail()" style="cursor:pointer">${b.category}</span><span class="sd-bc-sep">·</span>` : ''}
            <span style="color:var(--orange)">${b.name}</span>
          </div>
        </div>
        <div class="sd-title-row">
          <div style="flex:1">
            ${b.category ? `<span class="bz-detail-cat-badge">${b.category}</span>` : ''}
            <h1 class="sd-name" style="margin-top:8px">${b.name}</h1>
            <div class="sd-meta">
              <span>📍 ${b.location || '—'}</span>
              <span class="sd-meta-sep">·</span>
              <span>📅 ${dateStr}${endStr}</span>
              ${timeRange ? `<span class="sd-meta-sep">·</span><span>${timeRange}</span>` : ''}
            </div>
          </div>
          <div class="sd-price-box">
            <div class="sd-price-val">${_bzFmtNum(b.price_per_slot)} ${t('card.currency')}</div>
            <div class="sd-price-lbl">${t('detail.priceUnit')}</div>
            <div class="bzd-quick-actions">
              <button type="button" class="bzd-quick-action" id="bzd-copy-link-btn"
                      onclick="copyBazaarBookingLink()" title="${t('detail.copyLinkTooltip')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span id="bzd-copy-link-label">${t('detail.copyLinkLabel')}</span>
              </button>
              <button type="button" class="bzd-quick-action"
                      onclick="shareCard('${b.id}','${(b.name||'').replace(/'/g,"\\'")}')" title="${t('detail.shareTooltip')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
                     stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
                <span>${t('detail.shareLabel')}</span>
              </button>
            </div>
          </div>
        </div>
        <div class="bz-detail-nav">
          ${prevB
            ? `<button class="bz-detail-nav-btn" onclick="openBazaarDetail('${prevB.id}')">${t('nav.prevBazaar', { name: prevB.name })}</button>`
            : '<span></span>'}
          <span class="bz-detail-nav-count">${t('detail.navCount', { current: idx + 1, total: allList.length })}</span>
          ${nextB
            ? `<button class="bz-detail-nav-btn" onclick="openBazaarDetail('${nextB.id}')">${t('nav.nextBazaar', { name: nextB.name })}</button>`
            : '<span></span>'}
        </div>
      </div>`;
  }

  _renderBazaarInfo(b);

  /* ── تحقق من حالة البازار: منتهي / جارٍ الآن (توقّف استقبال الحجوزات) / متاح للحجز ── */
  const _todayStr  = _cairoTodayStr();
  const _endDate   = b.date_end || b.date_start;
  const _isExpired = b.status === 'completed' || (_endDate && _endDate < _todayStr);
  const _isLiveNow = !_isExpired && b.status === 'live';

  const slotmapEl        = document.getElementById('bzd-slotmap');
  const panel            = document.getElementById('bzd-booking-panel');
  const reviewsSectionEl = document.getElementById('bzd-reviews-section');

  _unsubscribeSlotMap();
  _unsubscribeBazaarStats();
  _loadBazaarActivityStats(bazaarId, b, _isExpired);

  if (reviewsSectionEl) reviewsSectionEl.style.display = 'none';
  if (_isExpired) _loadBazaarReviews(bazaarId, b);

  if (slotmapEl) {
    slotmapEl.innerHTML = `
      <div class="sd-subspaces-header">
        <h2 class="sd-section-title">${t('slotMap.title')}</h2>
      </div>
      <div style="text-align:center;padding:50px 20px;color:var(--ink3)">
        <div style="font-size:36px;margin-bottom:12px;display:inline-block;animation:spin 1s linear infinite">⏳</div>
        <div style="font-size:14px">${t('slotMap.loading')}</div>
      </div>`;
  }

  if (panel) panel.style.display = 'none';

  if (!opts.silent) {
    showBzPage('bazaar-detail');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  if (!sbClient) {
    if (slotmapEl) slotmapEl.innerHTML = _isExpired ? _renderSlotMapEndedFallback(_endDate) : _renderSlotMapFallback();
    return;
  }

  try {
    const { data: slots, error } = await sbClient
      .from('bazaar_slots')
      .select('id,bazaar_id,row_label,slot_number,row,col,price,status,is_featured')
      .eq('bazaar_id', bazaarId)
      .order('row_label', { ascending: true });

    if (error || !slots?.length) {
      if (slotmapEl) slotmapEl.innerHTML = _isExpired ? _renderSlotMapEndedFallback(_endDate) : _renderSlotMapFallback();
      if (_isExpired && b.organizer_id) _loadOrgPastBazaars(b.organizer_id, b.id);
    } else if (_isExpired) {
      /* ── انتهى البازار: نعرض الخريطة كاملة في وضع عرض فقط (Read Only) ── */
      const expDateFmt = _bzFmtDateLong(_endDate, { year:'numeric', month:'long', day:'numeric' });
      renderSlotMap(slots, { mode: 'ended', endDateFmt: expDateFmt });
      if (slotmapEl) {
        const pastWrap = document.createElement('div');
        pastWrap.id = 'bzd-past-org-bazaars';
        pastWrap.style.marginTop = '20px';
        slotmapEl.appendChild(pastWrap);
      }
      if (b.organizer_id) _loadOrgPastBazaars(b.organizer_id, b.id);
    } else if (_isLiveNow) {
      /* ── البازار جارٍ الآن: توقف استقبال الحجوزات، الخريطة للعرض فقط ── */
      renderSlotMap(slots, { mode: 'live' });
    } else {
      renderSlotMap(slots, { mode: 'open' });
      _subscribeSlotMap(bazaarId);
    }
  } catch (err) {
    if (slotmapEl) slotmapEl.innerHTML = _isExpired ? _renderSlotMapEndedFallback(_endDate) : _renderSlotMapFallback();
  }

  /* رابط الحجز المباشر (?book=1): وصل بالفعل لصفحة التفاصيل — تبقّى فقط تمريره لخريطة الأماكن */
  if (opts.scrollToBooking) _scrollToBazaarBookingSection();
}

function _renderBazaarInfo(b) {
  const infoEl = document.getElementById('bzd-info');
  if (!infoEl) return;

  const dateStr = b.date_start
    ? _bzFmtDateLong(b.date_start, { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  const endStr = b.date_end && b.date_end !== b.date_start
    ? _bzFmtDateLong(b.date_end, { year:'numeric', month:'long', day:'numeric' })
    : '';
  const availSlots = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
  const isSoldOut  = availSlots === 0 && (b.total_slots || 0) > 0;

  const imgHtml = b.image ? `
    <div style="border-radius:var(--radius-xl);overflow:hidden;margin-bottom:24px;max-height:340px">
      <img src="${b.image}" alt="${b.name}"
           style="width:100%;height:340px;object-fit:cover;display:block"
           onerror="this.parentElement.innerHTML='<div style=height:180px;display:flex;align-items:center;justify-content:center;font-size:72px;background:var(--surface2)>🎪</div>'">
    </div>` : '';

  const mapsHref = b.maps_link
    || ((b.venue_address || b.location)
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.venue_address || b.location)}`
        : '');

  /* ── المميزات التي يحصل عليها العارض (التجهيزات + الدعاية + التغطية الإعلامية) ── */
  const _adBudgetLabels = {
    limited: t('info.adBudgetLimited'),
    medium:  t('info.adBudgetMedium'),
    good:    t('info.adBudgetGood'),
    large:   t('info.adBudgetLarge'),
  };
  const _amenities   = Array.isArray(b.included_amenities) ? b.included_amenities.filter(Boolean) : [];
  const _hasCoverage = !!(b.will_have_photography || b.will_have_social_coverage || b.will_have_paid_ads);
  const _hasPerks    = _amenities.length > 0 || !!b.other_amenities_note || !!b.ad_budget_tier || _hasCoverage;

  const perksHtml = _hasPerks ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('info.perksTitle')}</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:16px">

          ${(_amenities.length || b.other_amenities_note) ? `
          <div>
            <div class="bz-perk-group-title">${t('info.facilitiesTitle')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${_amenities.map(a => `<span class="bz-amenity-pill">✔ ${a === 'كرسي' && b.chair_count > 1 ? `${t('amenities.' + a, { defaultValue: a })}${t('info.chairCountSuffix', { count: b.chair_count })}` : t('amenities.' + a, { defaultValue: a })}</span>`).join('')}
              ${b.other_amenities_note ? `<span class="bz-amenity-pill">✔ ${b.other_amenities_note}</span>` : ''}
            </div>
          </div>` : ''}

          ${b.ad_budget_tier ? `
          <div>
            <div class="bz-perk-group-title">${t('info.adBudgetTitle')}</div>
            <div class="sd-extra-row"><span>${t('info.adBudgetLabel')}</span><span style="font-weight:700">${_adBudgetLabels[b.ad_budget_tier] || b.ad_budget_tier}</span></div>
          </div>` : ''}

          ${_hasCoverage ? `
          <div>
            <div class="bz-perk-group-title">${t('info.coverageTitle')}</div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${b.will_have_photography     ? `<div style="font-size:13px">${t('info.photography')}</div>` : ''}
              ${b.will_have_social_coverage ? `<div style="font-size:13px">${t('info.socialCoverage')}</div>` : ''}
              ${b.will_have_paid_ads        ? `<div style="font-size:13px">${t('info.paidAds')}</div>` : ''}
            </div>
          </div>` : ''}

        </div>
      </div>` : '';

  infoEl.innerHTML = `
    ${imgHtml}
    <div class="sd-info-grid">

      ${b.description ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('info.aboutTitle')}</div>
        <p class="sd-description">${b.description}</p>
      </div>` : ''}

      <div class="sd-info-card">
        <div class="sd-info-title">${t('info.eventDetailsTitle')}</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
          <div class="sd-extra-row"><span>${t('info.startDate')}</span><span style="font-weight:700">${dateStr}</span></div>
          ${endStr ? `<div class="sd-extra-row"><span>${t('info.endDate')}</span><span style="font-weight:700">${endStr}</span></div>` : ''}
          ${b.time_start ? `<div class="sd-extra-row"><span>${t('info.timeLabel')}</span><span>${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}</span></div>` : ''}
          ${b.category   ? `<div class="sd-extra-row"><span>${t('info.categoryLabel')}</span><span class="bz-detail-cat-badge" style="font-size:11px">${b.category}</span></div>` : ''}
          ${b.organizer  ? `
          <div class="sd-extra-row" ${b.organizer_id ? `style="cursor:pointer" onclick="openOrganizerProfile('${b.organizer_id}')"` : ''}>
            <span>${t('info.organizerLabel')}</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:700">${b.organizer}</span>
              ${b.is_organizer_verified
                ? `<span class="bz-verified-badge">${t('card.verifiedBadge')}</span>`
                : `<span style="font-size:10px;color:var(--ink3);background:var(--surface2);border-radius:50px;padding:2px 7px;">${t('info.notVerifiedYet')}</span>`}
              ${b.organizer_id ? `<span style="font-size:11px;color:var(--orange);font-weight:700">${t('info.viewProfileArrow')}</span>` : ''}
            </div>
          </div>` : ''}
        </div>
      </div>

      <div class="sd-info-card">
        <div class="sd-info-title">${t('info.pricingTitle')}</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
          <div class="sd-extra-row">
            <span>${t('info.pricePerSlot')}</span>
            <strong style="color:var(--orange);font-size:16px">${_bzFmtNum(b.price_per_slot)} ${t('card.currency')}</strong>
          </div>
          ${b.total_slots ? `<div class="sd-extra-row"><span>${t('info.totalSlots')}</span><span>${t('info.totalSlotsUnit', { count: b.total_slots })}</span></div>` : ''}
          <div class="sd-extra-row">
            <span>${t('info.availableSlotsLabel')}</span>
            <span style="color:${isSoldOut ? 'var(--red)' : 'var(--green)'};font-weight:800">
              ${isSoldOut ? t('info.soldOutBadge') : t('info.availableBadge', { count: availSlots })}
            </span>
          </div>
        </div>
      </div>

      ${perksHtml}

      ${(b.venue_address || b.location) ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('info.locationTitle')}</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <div class="sd-extra-row">
            <span>${t('info.venueName')}</span>
            <span style="font-weight:700">${b.location || '—'}</span>
          </div>
          ${b.venue_address ? `<div class="sd-extra-row"><span>${t('info.address')}</span><span>${b.venue_address}</span></div>` : ''}
          ${b.region ? `<div class="sd-extra-row"><span>${t('info.regionLabel')}</span><span>${b.region}</span></div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">
            ${mapsHref ? `
            <a href="${mapsHref}" target="_blank" rel="noopener"
               class="bz-maps-btn">
              ${t('info.openMaps')}
            </a>` : ''}
            ${b.sketch_url ? `
            <button onclick="openBazaarMap('sketch')"
                    class="bz-maps-btn" style="background:rgba(99,102,241,0.10);border-color:rgba(99,102,241,0.30);color:#6366f1;cursor:pointer">
              ${t('info.sketchMap')}
            </button>` : ''}
            ${b.event_image_url ? `
            <button onclick="openBazaarMap('photo')"
                    class="bz-maps-btn" style="background:rgba(16,185,129,0.10);border-color:rgba(16,185,129,0.28);color:#059669;cursor:pointer">
              ${t('info.realPhoto')}
            </button>` : ''}
          </div>
        </div>
      </div>` : ''}

      ${(!b.venue_address && !b.location && (b.sketch_url || b.event_image_url)) ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">${t('info.mediaTitle')}</div>
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:10px">
          ${b.sketch_url ? `
          <button onclick="openBazaarMap('sketch')"
                  class="bz-maps-btn" style="background:rgba(99,102,241,0.10);border-color:rgba(99,102,241,0.30);color:#6366f1;cursor:pointer">
            ${t('info.sketchMap')}
          </button>` : ''}
          ${b.event_image_url ? `
          <button onclick="openBazaarMap('photo')"
                  class="bz-maps-btn" style="background:rgba(16,185,129,0.10);border-color:rgba(16,185,129,0.28);color:#059669;cursor:pointer">
            ${t('info.realPhoto')}
          </button>` : ''}
        </div>
      </div>` : ''}

      ${(() => {
        const _rl_today = _cairoTodayStr();
        const _rl_end   = b.date_end || b.date_start;
        const _rl_exp   = _rl_end && _rl_end < _rl_today;
        if (!_rl_exp && b.status !== 'completed' && b.status !== 'live') return '';
        const links = Array.isArray(b.event_links) ? b.event_links.filter(u => u) : [];
        if (links.length > 0) {
          const icons = { 'facebook.com':'📘','fb.com':'📘','instagram.com':'📸','tiktok.com':'🎵','youtube.com':'▶️','youtu.be':'▶️','x.com':'🐦','twitter.com':'🐦','snapchat.com':'👻','linkedin.com':'💼' };
          const getIcon = u => { try { const d = new URL(u).hostname.replace('www.',''); return Object.entries(icons).find(([k]) => d.includes(k))?.[1] || '🔗'; } catch { return '🔗'; } };
          return `<div class="sd-info-card sd-info-full" style="border-color:#86efac;background:#f0fdf4">
            <div class="sd-info-title" style="color:#15803d;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
              <span>${t('info.linksAddedTitle')}</span>
              <span style="font-size:10px;font-weight:400;color:#059669;background:#dcfce7;border:1px solid #86efac;border-radius:50px;padding:2px 8px" title="${t('info.linksAddedNoteTitle')}">
                ${t('info.linksAddedNote')}
              </span>
            </div>
            <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
              ${links.map(u => {
                const safeHref = _safeEventLinkHref(u);
                if (!safeHref) return '';
                return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" dir="ltr"
                  style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:#047857;text-decoration:none;word-break:break-all">
                  <span>${getIcon(u)}</span><span>${_esc(u)}</span>
                </a>`;
              }).join('')}
            </div>
          </div>`;
        }
        return (_rl_exp || b.status === 'completed')
          ? `<div class="sd-info-card sd-info-full" style="border-color:#fde047;background:#fefce8">
              <div class="sd-info-title" style="color:#92400e">${t('info.linksNotAddedTitle')}</div>
              <div style="font-size:12px;color:#a16207;margin-top:6px">${t('info.linksNotAddedBody')}</div>
            </div>`
          : '';
      })()}

    </div>

    <!-- زر الإبلاغ -->
    <div style="text-align:center;margin-top:10px">
      <button onclick="openReportAbuseDialog('${b.id}')"
        style="background:none;border:none;cursor:pointer;font-size:11.5px;color:var(--ink3);font-family:inherit;padding:4px 8px;border-radius:6px;transition:color .18s"
        onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='var(--ink3)'">
        ${t('info.reportBtn')}
      </button>
    </div>

    <!-- ═══ مربع المنظّم ═══ -->
    <div id="bzd-organizer-card" style="margin-top:16px"></div>`;

  /* تحميل بيانات المنظّم من Supabase */
  if (b.organizer_id && sbClient) {
    _loadOrganizerCard(b.organizer_id, b.organizer);
  } else if (b.organizer) {
    _renderOrganizerCardBasic(b.organizer, b.is_organizer_verified);
  }

  /* M11: تحميل سجل التحديثات */
  const timelineEl = document.getElementById('bzd-timeline');
  if (timelineEl) { timelineEl.style.display = 'none'; timelineEl.innerHTML = ''; }
  if (sbClient && b.id) _loadBazaarTimeline(b.id);
}

async function _loadOrgPastBazaars(organizerId, currentBazaarId) {
  const el = document.getElementById('bzd-past-org-bazaars');
  if (!el || !sbClient) return;
  try {
    const todayStr = _cairoTodayStr();
    const { data: past } = await sbClient
      .from('bazaars')
      .select('id,name,date_start,date_end,event_links')
      .eq('organizer_id', organizerId)
      .neq('id', currentBazaarId)
      .lt('date_end', todayStr)
      .in('status', ['published', 'live', 'completed'])
      .eq('is_deleted', false)
      .order('date_end', { ascending: false })
      .limit(5);

    if (!past?.length) { el.remove(); return; }

    const icons = { 'facebook.com':'📘','fb.com':'📘','instagram.com':'📸','tiktok.com':'🎵','youtube.com':'▶️','youtu.be':'▶️','x.com':'🐦','twitter.com':'🐦','snapchat.com':'👻','linkedin.com':'💼' };
    const getIcon = u => { try { const d = new URL(u).hostname.replace('www.',''); return Object.entries(icons).find(([k]) => d.includes(k))?.[1] || '🔗'; } catch { return '🔗'; } };

    const rows = past.map(pb => {
      const links   = Array.isArray(pb.event_links) ? pb.event_links.filter(u => u) : [];
      const dateStr = pb.date_end
        ? _bzFmtDateLong(pb.date_end, { year:'numeric', month:'short', day:'numeric' })
        : '—';
      return `
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
          <div style="font-size:13px;font-weight:800;color:var(--dark);margin-bottom:3px">${_esc(pb.name)}</div>
          <div style="font-size:11px;color:var(--ink3);margin-bottom:${links.length ? '8px' : '0'}">📅 ${dateStr}</div>
          ${links.length
            ? `<div style="display:flex;flex-direction:column;gap:6px">
                ${links.map(u => {
                  const safeHref = _safeEventLinkHref(u);
                  if (!safeHref) return '';
                  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" dir="ltr"
                    style="display:flex;align-items:center;gap:6px;font-size:12px;color:#047857;text-decoration:none;word-break:break-all">
                    <span>${getIcon(u)}</span><span>${_esc(u)}</span>
                  </a>`;
                }).join('')}
              </div>`
            : `<div style="font-size:11px;color:var(--ink3);font-style:italic">${t('pastBazaars.noLinks')}</div>`}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title" style="color:var(--ink2)">${t('pastBazaars.title')}</div>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">${rows}</div>
      </div>`;
  } catch(e) {
    el.remove();
  }
}

function closeBazaarDetail() {
  _unsubscribeSlotMap();
  _unsubscribeBazaarStats();
  currentBazaar  = null;
  selectedSlotId = null;
  showBzPage('bazaars');
}

/* ================================================================
   📊 إحصائيات الأنشطة داخل البازار — من الحجوزات المؤكدة فقط
   (status='confirmed'؛ لا تُحتسب pending/cancelled) عبر RPC
   get_bazaar_activity_stats (تجميع فقط، بلا PII — بديل عن قراءة
   bazaar_bookings مباشرة التي يمنعها RLS لغير المنظم/صاحب الحجز)
   ================================================================ */

/* نفس فئات النشاط الموجودة في استمارة الحجز (bzb-activity) — أيقونات عرض فقط */
const BZ_ACTIVITY_ICONS = {
  'أكل ومشروبات':   '🍔', 'حلويات':          '🍰',
  'ملابس':          '👕', 'إكسسوارات':       '💍', 'موضة': '👗',
  'مجوهرات':        '💎', 'ساعات':           '⌚',
  'هدايا':          '🎁', 'ديكور':           '🖼️', 'مستلزمات منزلية': '🏠',
  'حرف يدوية':      '✋', 'عطور':            '🧴', 'عناية شخصية': '💆',
  'كتب':            '📚', 'إلكترونيات':      '🔌', 'تقنية': '💻',
  'ألعاب أطفال':    '🧸',
  'بيع بالجملة':    '📦', 'خدمات':           '🛠️', 'متنوع': '🗂️',
};

/* ألوان تصنيفية بترتيب ثابت (مُتحقَّق CVD ΔE≥12 على خلفية بيضاء) — لا تُدار أو تُولَّد ألوان إضافية */
const BZ_STATS_HUES        = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948'];
const BZ_STATS_OTHER_COLOR = '#c3c2b7';
const BZ_STATS_MAX_SLICES  = 6; // فوق كده يُطوى الباقي في "أخرى" — حد donut/pie الموصى به

async function _loadBazaarActivityStats(bazaarId, b, isExpired) {
  const sectionEl = document.getElementById('bzd-activity-stats-section');
  const el        = document.getElementById('bzd-activity-stats');
  if (!sectionEl || !el || !sbClient) return;

  sectionEl.style.display = 'block';
  el.innerHTML = `
    <div class="sd-subspaces-header"><h2 class="sd-section-title">${t('activityStats.title')}</h2></div>
    <div style="text-align:center;padding:30px 20px;color:var(--ink3)">
      <div style="font-size:28px;margin-bottom:8px;display:inline-block;animation:spin 1s linear infinite">⏳</div>
      <div style="font-size:13px">${t('activityStats.loading')}</div>
    </div>`;

  try {
    const { data, error } = await sbClient.rpc('get_bazaar_activity_stats', { p_bazaar_id: bazaarId });
    if (error) throw new Error(error.message);
    _renderBazaarActivityStats(data || {}, b);
    if (!isExpired) _subscribeBazaarStats(bazaarId, b);
  } catch (err) {
    console.warn('[bazaar-stats] load error:', err.message || err);
    sectionEl.style.display = 'none';
  }
}

function _renderBazaarActivityStats(data, b) {
  const el = document.getElementById('bzd-activity-stats');
  if (!el) return;

  const total      = Number(data.total_confirmed) || 0;
  const activities = Array.isArray(data.activities) ? data.activities : [];
  const headerHtml = `<div class="sd-subspaces-header"><h2 class="sd-section-title">${t('activityStats.title')}</h2></div>`;

  if (!total || !activities.length) {
    el.innerHTML = `
      ${headerHtml}
      <div class="bz-stats-empty">
        <div class="bz-stats-empty-ico">📊</div>
        <div>${t('activityStats.emptyBody')}</div>
      </div>`;
    return;
  }

  /* أعلى 6 أنشطة بألوان مستقلة + طيّ الباقي في "أخرى" رمادية (لا نولّد لونًا سابعًا) */
  const top       = activities.slice(0, BZ_STATS_MAX_SLICES);
  const rest      = activities.slice(BZ_STATS_MAX_SLICES);
  const restCount = rest.reduce((s, a) => s + (Number(a.count) || 0), 0);

  const segments = top.map((a, i) => ({
    label: t('activities.' + a.activity, { defaultValue: a.activity }),
    count: Number(a.count) || 0,
    color: BZ_STATS_HUES[i],
    icon:  BZ_ACTIVITY_ICONS[a.activity] || '🏷️',
  }));
  if (restCount > 0) segments.push({ label: t('activityStats.other'), count: restCount, color: BZ_STATS_OTHER_COLOR, icon: '🏷️' });

  const totalSlots   = Number(b?.total_slots) || 0;
  const occupancyPct = totalSlots > 0 ? Math.round((total / totalSlots) * 100) : null;

  const summaryHtml = `
    <div class="bz-stats-summary">
      <div class="bz-stats-chip"><b>${total}</b><span>${t('activityStats.confirmedSlotLabel', { count: total })}</span></div>
      <div class="bz-stats-chip"><b>${activities.length}</b><span>${t('activityStats.differentActivitiesLabel', { count: activities.length })}</span></div>
      ${occupancyPct !== null ? `<div class="bz-stats-chip"><b>${occupancyPct}%</b><span>${t('activityStats.occupancyLabel')}</span></div>` : ''}
    </div>`;

  const listHtml = segments.map(s => {
    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0;
    return `
      <div class="bz-stats-row" style="--bz-stat-color:${s.color}">
        <div class="bz-stats-row-fill" style="width:${pct}%"></div>
        <span class="bz-stats-swatch"></span>
        <span class="bz-stats-row-label">${s.icon} ${_escBz(s.label)}</span>
        <span class="bz-stats-row-count">${t('activityStats.participant', { count: s.count })}</span>
        <span class="bz-stats-row-pct">${pct}%</span>
      </div>`;
  }).join('');

  el.innerHTML = `
    ${headerHtml}
    ${summaryHtml}
    <div class="bz-stats-body">
      <div class="bz-stats-donut-wrap">${_buildActivityDonutSvg(segments, total)}</div>
      <div class="bz-stats-list">${listHtml}</div>
    </div>`;
}

/* دونات SVG عبر stroke-dasharray/stroke-dashoffset — بلا مكتبات خارجية، Responsive عبر viewBox */
function _buildActivityDonutSvg(segments, total) {
  const SIZE = 120, R = 44, CX = 60, CY = 60, STROKE = 16, GAP = 3;
  const circumference = 2 * Math.PI * R;

  let cum = 0;
  const arcs = segments.map(s => {
    const raw = (s.count / total) * circumference;
    const len = Math.max(raw - GAP, 0);
    const arc = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${s.color}"
      stroke-width="${STROKE}" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-cum}">
      <title>${_escBz(t('activityStats.donutTooltip', { label: s.label, count: s.count, pct: Math.round((s.count / total) * 100) }))}</title>
    </circle>`;
    cum += raw;
    return arc;
  }).join('');

  return `
    <svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${t('activityStats.donutAriaLabel')}">
      <g transform="rotate(-90 ${CX} ${CY})">${arcs}</g>
      <text x="${CX}" y="${CY - 4}" text-anchor="middle" font-family="var(--font-display)"
            font-size="22" font-weight="800" fill="var(--ink)">${total}</text>
      <text x="${CX}" y="${CY + 15}" text-anchor="middle" font-family="var(--font-body)"
            font-size="10" fill="var(--ink3)">${t('activityStats.centerLabel')}</text>
    </svg>`;
}

function _escBz(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── Realtime: تحديث الإحصائيات تلقائيًا عند تأكيد/إلغاء أي حجز داخل هذا البازار ── */
function _subscribeBazaarStats(bazaarId, b) {
  if (!sbClient || !bazaarId) return;
  _unsubscribeBazaarStats();

  _bazaarStatsChannel = sbClient
    .channel(`bz-bookings-stats-${bazaarId}`)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'bazaar_bookings',
      filter: `bazaar_id=eq.${bazaarId}`
    }, () => {
      clearTimeout(_bzStatsDebounce);
      _bzStatsDebounce = setTimeout(async () => {
        if (!currentBazaar || String(currentBazaar.id) !== String(bazaarId) || !sbClient) return;
        try {
          const { data, error } = await sbClient.rpc('get_bazaar_activity_stats', { p_bazaar_id: bazaarId });
          if (!error) _renderBazaarActivityStats(data || {}, b);
        } catch (_) {}
      }, 500);
    })
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR') console.warn('⚠️ Activity stats realtime channel error');
    });
}

function _unsubscribeBazaarStats() {
  clearTimeout(_bzStatsDebounce);
  if (_bazaarStatsChannel) {
    try { sbClient?.removeChannel(_bazaarStatsChannel); } catch (_) {}
    _bazaarStatsChannel = null;
  }
}
window.addEventListener('beforeunload', _unsubscribeBazaarStats);

/* ================================================================
   ⭐ تقييمات البازار — تُتاح فقط بعد انتهاء البازار فعلياً
   ================================================================ */
async function _loadBazaarReviews(bazaarId, b) {
  const sectionEl = document.getElementById('bzd-reviews-section');
  const el        = document.getElementById('bzd-reviews');
  if (!sectionEl || !el || !sbClient) return;

  sectionEl.style.display = 'block';
  el.innerHTML = `
    <div class="sd-subspaces-header"><h2 class="sd-section-title">${t('reviews.title')}</h2></div>
    <div style="text-align:center;padding:30px 20px;color:var(--ink3)">
      <div style="font-size:28px;margin-bottom:8px;display:inline-block;animation:spin 1s linear infinite">⏳</div>
      <div style="font-size:13px">${t('reviews.loading')}</div>
    </div>`;

  try {
    const { data, error } = await sbClient.rpc('get_bazaar_rating_summary', { p_bazaar_id: bazaarId });
    if (error) throw new Error(error.message);
    _renderBazaarReviews(bazaarId, b, data || {});
  } catch (err) {
    el.innerHTML = `
      <div class="sd-subspaces-header"><h2 class="sd-section-title">${t('reviews.title')}</h2></div>
      <div style="text-align:center;padding:24px;color:var(--ink3);font-size:13px">${t('reviews.loadError')}</div>`;
  }
}

function _renderBazaarReviews(bazaarId, b, data) {
  const el = document.getElementById('bzd-reviews');
  if (!el) return;

  const total   = data.total || 0;
  const avg     = Number(data.avg_rating || 0);
  const dist    = data.distribution || {};
  const reviews = Array.isArray(data.reviews) ? data.reviews : [];

  const starsHtml = (val, size) => Array.from({ length: 5 }, (_, i) =>
    `<span style="font-size:${size}px;color:${i < Math.round(val) ? '#f5c842' : 'var(--border)'}">★</span>`
  ).join('');

  const distBarsHtml = [5, 4, 3, 2, 1].map(n => {
    const count = dist[String(n)] || 0;
    const pct   = total > 0 ? Math.round(count / total * 100) : 0;
    return `
      <div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="width:34px;color:var(--ink3);flex-shrink:0">${n} ⭐</span>
        <span style="flex:1;height:8px;background:var(--surface2);border-radius:6px;overflow:hidden">
          <span style="display:block;height:100%;width:${pct}%;background:#f5c842;border-radius:6px"></span>
        </span>
        <span style="width:24px;color:var(--ink3);text-align:left;flex-shrink:0">${count}</span>
      </div>`;
  }).join('');

  const summaryHtml = total > 0 ? `
    <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:18px">
      <div style="text-align:center;flex-shrink:0">
        <div style="font-size:34px;font-weight:900;color:var(--dark);line-height:1">${avg.toFixed(1)}</div>
        <div style="margin:5px 0">${starsHtml(avg, 16)}</div>
        <div style="font-size:11px;color:var(--ink3);white-space:nowrap">${t('reviews.basedOn', { count: total })}</div>
      </div>
      <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:5px">${distBarsHtml}</div>
    </div>` : `
    <div style="text-align:center;padding:24px 16px;background:var(--surface2);border-radius:var(--radius-lg);margin-bottom:18px">
      <div style="font-size:32px;margin-bottom:8px">💬</div>
      <div style="font-size:14px;font-weight:700;color:var(--ink2);margin-bottom:4px">${t('reviews.emptyTitle')}</div>
      <div style="font-size:12.5px;color:var(--ink3)">${t('reviews.emptySubtitle')}</div>
    </div>`;

  const myReview   = currentUser ? reviews.find(r => r.reviewer_id === currentUser.id) : null;
  const isMyBazaar = currentUser && b.organizer_id && String(currentUser.id) === String(b.organizer_id);

  const reviewsListHtml = reviews.map(r => {
    const dateStr = r.created_at
      ? _bzFmtDateLong(r.created_at, { year: 'numeric', month: 'short', day: 'numeric' })
      : '';
    return `
      <div class="op-review-item" id="bz-review-card-${r.id}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;gap:8px">
          <div style="display:flex;align-items:center;gap:6px;min-width:0">
            <span style="font-weight:700;font-size:13px;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(r.reviewer_name)}</span>
            ${r.is_verified_exhibitor ? `<span style="font-size:10px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:50px;padding:1px 7px;white-space:nowrap;flex-shrink:0">${t('reviews.verifiedExhibitor')}</span>` : ''}
          </div>
          <span style="font-size:11px;color:var(--ink3);flex-shrink:0">${dateStr}</span>
        </div>
        <div style="margin-bottom:6px">${starsHtml(r.rating, 13)}</div>
        ${r.comment ? `<p style="font-size:13px;color:var(--ink2);line-height:1.7;margin:0">${_esc(r.comment)}</p>` : ''}
        ${isMyBazaar ? `
        <div style="margin-top:8px">
          <button onclick="_toggleReportReviewBox('${r.id}')" id="bz-report-btn-${r.id}"
            style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--ink3);font-family:inherit;padding:0;transition:color .15s"
            onmouseover="this.style.color='#dc2626'" onmouseout="this.style.color='var(--ink3)'">
            ${t('reviews.reportCommentBtn')}
          </button>
          <div id="bz-report-box-${r.id}" style="display:none;margin-top:8px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-md)">
            <textarea id="bz-report-reason-${r.id}" placeholder="${t('reviews.reportReasonPlaceholder')}" maxlength="200"
              style="width:100%;box-sizing:border-box;padding:8px 10px;border-radius:var(--radius-md);border:1.5px solid var(--border);background:var(--surface2);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans Arabic',sans-serif);font-size:12px;min-height:48px;resize:vertical;outline:none"></textarea>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button onclick="reportBazaarReview('${r.id}')" style="background:#dc2626;color:#fff;border:none;border-radius:var(--radius-pill);padding:6px 16px;font-size:11.5px;font-weight:700;cursor:pointer;font-family:var(--font-display)">${t('reviews.confirmReport')}</button>
              <button onclick="_toggleReportReviewBox('${r.id}')" style="background:none;border:1px solid var(--border);border-radius:var(--radius-pill);padding:6px 16px;font-size:11.5px;font-weight:700;cursor:pointer;color:var(--ink3);font-family:var(--font-display)">${t('reviews.cancel')}</button>
            </div>
          </div>
        </div>` : ''}
      </div>`;
  }).join('');

  const formHtml = isMyBazaar ? '' : !currentUser ? `
    <div style="text-align:center;padding:16px;background:var(--surface2);border-radius:var(--radius-lg);margin-top:16px">
      <a href="/?p=login" style="color:var(--orange);font-weight:700;font-size:13px;text-decoration:none">${t('reviews.loginPrompt')}</a>
    </div>`
  : b.status !== 'completed' ? `
    <div style="text-align:center;padding:16px;background:var(--surface2);border-radius:var(--radius-lg);margin-top:16px;font-size:12.5px;color:var(--ink3)">
      ${t('reviews.notYetOpenMsg')}
    </div>`
  : `
    <div style="margin-top:16px;padding:16px;background:var(--surface2);border-radius:var(--radius-lg);border:1.5px solid var(--border)">
      <div style="font-size:13px;font-weight:800;color:var(--dark);margin-bottom:10px">${t('reviews.formTitle')}</div>
      ${myReview ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:10px">${t('reviews.alreadyReviewedNote', { rating: myReview.rating })}</div>` : ''}
      <div class="bz-star-picker" id="bz-review-star-picker" data-value="0">
        ${[1, 2, 3, 4, 5].map(n => `<span class="bz-star-pick" data-star="${n}" onclick="_setBzReviewStar(${n})" onmouseover="_hoverBzReviewStar(${n})" onmouseout="_hoverBzReviewStar(0)">★</span>`).join('')}
      </div>
      <textarea id="bz-review-comment" placeholder="${t('reviews.commentPlaceholder')}" maxlength="500" oninput="_updateBzReviewCharCount(this)"
        style="width:100%;box-sizing:border-box;margin-top:10px;padding:10px 12px;border-radius:var(--radius-md);border:1.5px solid var(--border);background:var(--surface);color:var(--ink);font-family:var(--font-body,'IBM Plex Sans Arabic',sans-serif);font-size:13px;min-height:64px;resize:vertical;outline:none"></textarea>
      <div id="bz-review-char-count" style="font-size:11px;color:var(--ink3);text-align:left;margin-top:3px">${t('reviews.charCount', { count: 0 })}</div>
      <div id="bz-review-msg" style="display:none;font-size:12px;margin-top:8px"></div>
      <button class="btn btn-primary" id="bz-review-submit-btn" onclick="submitBazaarReview('${bazaarId}')" style="margin-top:10px;padding:10px 22px">
        ${t('reviews.submitBtn')}
      </button>
    </div>`;

  el.innerHTML = `
    <div class="sd-subspaces-header"><h2 class="sd-section-title">${t('reviews.title')}</h2></div>
    ${summaryHtml}
    ${reviewsListHtml ? `<div style="display:flex;flex-direction:column;gap:10px">${reviewsListHtml}</div>` : ''}
    ${formHtml}
  `;
}

function _setBzReviewStar(n) {
  const picker = document.getElementById('bz-review-star-picker');
  if (!picker) return;
  picker.dataset.value = n;
  _hoverBzReviewStar(n);
}

function _hoverBzReviewStar(n) {
  const picker = document.getElementById('bz-review-star-picker');
  if (!picker) return;
  const selected = Number(picker.dataset.value || 0);
  const show     = n || selected;
  picker.querySelectorAll('.bz-star-pick').forEach(starEl => {
    starEl.classList.toggle('active', Number(starEl.dataset.star) <= show);
  });
}

function _updateBzReviewCharCount(el) {
  const countEl = document.getElementById('bz-review-char-count');
  if (countEl) countEl.textContent = t('reviews.charCount', { count: el.value.length });
}

/* ── الإبلاغ عن تعليق (متاح لمنظم البازار فقط) ── */
function _toggleReportReviewBox(reviewId) {
  const box = document.getElementById(`bz-report-box-${reviewId}`);
  if (box) box.style.display = box.style.display === 'none' ? 'block' : 'none';
}

async function reportBazaarReview(reviewId) {
  if (!sbClient) return;
  const box    = document.getElementById(`bz-report-box-${reviewId}`);
  const reason = document.getElementById(`bz-report-reason-${reviewId}`)?.value.trim() || null;

  try {
    const { data, error } = await sbClient.rpc('report_bazaar_review', {
      p_review_id: reviewId,
      p_reason:    reason,
    });
    if (error) throw new Error(error.message);

    if (!data?.success) {
      const map = {
        not_authorized:       t('reviews.errors.not_authorized'),
        review_not_found:     t('reviews.errors.review_not_found'),
        already_under_review: t('reviews.errors.already_under_review'),
        unauthorized:         t('reviews.errors.unauthorized'),
      };
      throw new Error(map[data?.error] || t('reviews.reportFailed'));
    }

    /* إخفاء فوري للتعليق من الواجهة — تحديث متفائل بلا الحاجة لإعادة تحميل الملخص كاملاً */
    const card = document.getElementById(`bz-review-card-${reviewId}`);
    if (card) {
      card.innerHTML = `<div style="font-size:12.5px;color:var(--ink3);text-align:center;padding:8px">${t('reviews.reportedMsg')}</div>`;
    }
  } catch (err) {
    if (box) box.style.display = 'none';
    alert('⚠ ' + (err.message || t('reviews.reportFailed')));
  }
}

async function submitBazaarReview(bazaarId) {
  const picker     = document.getElementById('bz-review-star-picker');
  const rating     = Number(picker?.dataset?.value || 0);
  const msgEl      = document.getElementById('bz-review-msg');
  const btn        = document.getElementById('bz-review-submit-btn');
  const commentEl  = document.getElementById('bz-review-comment');

  const showMsg = (ok, text) => {
    if (!msgEl) return;
    msgEl.style.display = 'block';
    msgEl.style.color   = ok ? '#15803d' : 'var(--red)';
    msgEl.textContent   = (ok ? '✅ ' : '⚠ ') + text;
  };

  if (!rating) { showMsg(false, t('reviews.ratingRequired')); return; }
  if (!currentUser || !sbClient) { showMsg(false, t('reviews.loginRequired')); return; }

  if (btn) { btn.disabled = true; btn.textContent = t('reviews.submitting'); }

  try {
    const { data, error } = await sbClient.rpc('submit_bazaar_review', {
      p_bazaar_id: bazaarId,
      p_rating:    rating,
      p_comment:   commentEl?.value.trim() || null,
    });
    if (error) throw new Error(error.message);

    if (!data?.success) {
      const map = {
        bazaar_not_completed:         t('reviews.errors.bazaar_not_completed'),
        cannot_review_own_bazaar:     t('reviews.errors.cannot_review_own_bazaar'),
        bazaar_not_found:             t('reviews.errors.bazaar_not_found'),
        invalid_rating:               t('reviews.errors.invalid_rating'),
        unauthorized:                 t('reviews.errors.unauthorized'),
        comment_too_long:             t('reviews.errors.comment_too_long'),
        comment_contains_promo_link:  t('reviews.errors.comment_contains_promo_link'),
        comment_looks_like_spam:      t('reviews.errors.comment_looks_like_spam'),
        comment_contains_banned_word: t('reviews.errors.comment_contains_banned_word'),
        comment_duplicate_content:    t('reviews.errors.comment_duplicate_content'),
        review_removed_by_admin:      t('reviews.errors.review_removed_by_admin'),
      };
      throw new Error(map[data?.error] || t('reviews.saveError'));
    }

    showMsg(true, t('reviews.saveSuccess'));
    await _loadBazaarReviews(bazaarId, currentBazaar);
  } catch (err) {
    showMsg(false, err.message || t('reviews.saveError'));
    if (btn) { btn.disabled = false; btn.textContent = t('reviews.submitBtn'); }
  }
}

/* ================================================================
   📡 القسم 11-ب: Realtime — تحديث خريطة الأماكن لحظياً
   ================================================================ */

function _subscribeSlotMap(bazaarId) {
  if (!sbClient || !bazaarId) return;
  _unsubscribeSlotMap();

  _slotMapChannel = sbClient
    .channel(`bz-slots-${bazaarId}`)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'bazaar_slots',
      filter: `bazaar_id=eq.${bazaarId}`
    }, payload => _onSlotRealtimeUpdate(payload.new))
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR') console.warn('⚠️ Slot realtime channel error');
    });
}

function _unsubscribeSlotMap() {
  if (_slotMapChannel) {
    try { sbClient?.removeChannel(_slotMapChannel); } catch(_) {}
    _slotMapChannel = null;
  }
}
// تأكد من إغلاق القناة حتى لو أُغلق التبويب مباشرة
window.addEventListener('beforeunload', _unsubscribeSlotMap);

function _onSlotRealtimeUpdate(updated) {
  if (!updated?.id) return;
  const slotEl = document.querySelector(`.bz-slot[data-slot-id="${updated.id}"]`);
  if (!slotEl) return;

  const STATUSES = ['available', 'pending', 'booked', 'selected'];
  const prevStatus = STATUSES.find(c => slotEl.classList.contains(c)) || '';
  const newStatus  = updated.status;
  if (prevStatus === newStatus) return;

  // المستخدم الحالي كان قد اختار هذا المكان وجاء شخص آخر وحجزه
  if (String(updated.id) === String(selectedSlotId) && newStatus !== 'available') {
    selectedSlotId = null;
    const panel = document.getElementById('bzd-booking-panel');
    if (panel) panel.style.display = 'none';
    _showRealtimeToast(t('slotMap.realtimeSlotTaken'), '#b45309');
  }

  // تحديث الـ class
  STATUSES.forEach(c => slotEl.classList.remove(c));
  slotEl.classList.add(newStatus);

  const isFeatured = slotEl.dataset.featured === 'true';
  const lbl        = (slotEl.dataset.slotLabel || slotEl.textContent.trim().split('\n')[0]).trim();

  if (newStatus === 'available') {
    slotEl.onclick = () => selectSlot(updated.id, lbl);
    slotEl.title   = t('slotMap.slotLabel', { label: lbl }) + (isFeatured ? t('slotMap.featuredSuffix') : '') + ' — ' + t('slotMap.clickToBookStatus');
  } else {
    slotEl.onclick = null;
    slotEl.title   = newStatus === 'pending'
      ? t('slotMap.slotLabel', { label: lbl }) + ' — ' + t('slotMap.pendingStatus')
      : t('slotMap.slotLabel', { label: lbl }) + ' — ' + t('slotMap.bookedStatus');
  }

  // تحديث إحصائية الأماكن في رأس الخريطة
  _refreshSlotMapCounts();
}

function _refreshSlotMapCounts() {
  const slots   = document.querySelectorAll('.bz-slot:not(.bz-slot-empty)');
  let avail = 0, pend = 0, booked = 0;
  slots.forEach(el => {
    if      (el.classList.contains('booked'))                                    booked++;
    else if (el.classList.contains('pending'))                                   pend++;
    else if (el.classList.contains('available') || el.classList.contains('selected')) avail++;
  });
  const summaryEl = document.querySelector('.sd-units-summary');
  if (!summaryEl) return;
  const spans = summaryEl.querySelectorAll('span');
  if (spans[0]) spans[0].textContent = t('slotMap.availableCount', { count: avail });
}

function _showRealtimeToast(msg, bg = '#333') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    background:${bg};color:#fff;padding:12px 22px;border-radius:10px;
    font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;
    z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.28);white-space:nowrap`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 3200);
  setTimeout(() => t.remove(),              3600);
}

async function refreshSlotMap() {
  if (!currentBazaar || !sbClient) return;
  const btn = document.querySelector('.bz-refresh-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳'; }

  try {
    const { data: slots, error } = await sbClient
      .from('bazaar_slots')
      .select('id,bazaar_id,row_label,slot_number,row,col,price,status,is_featured')
      .eq('bazaar_id', currentBazaar.id)
      .order('row_label', { ascending: true });

    if (!error && slots?.length) {
      _unsubscribeSlotMap();
      selectedSlotId = null;
      const panel = document.getElementById('bzd-booking-panel');
      if (panel) panel.style.display = 'none';
      renderSlotMap(slots, { mode: _slotMapMode, endDateFmt: _slotMapEndDateFmt });
      if (_slotMapMode === 'open') _subscribeSlotMap(currentBazaar.id);
      _showRealtimeToast(t('slotMap.refreshDone'), '#16a34a');
    }
  } catch(_) {}

  if (btn) { btn.disabled = false; btn.textContent = '↻'; }
}

function openBazaarMap(type) {
  if (!currentBazaar) return;
  const url   = type === 'sketch' ? currentBazaar.sketch_url : currentBazaar.event_image_url;
  const name  = currentBazaar.name || t('slotMap.defaultBazaarName');
  const title = type === 'sketch'
    ? t('slotMap.lightboxSketchTitle', { name })
    : t('slotMap.lightboxPhotoTitle', { name });
  if (!url) return;

  const existing = document.getElementById('bz-map-lightbox');
  if (existing) existing.remove();

  const lb = document.createElement('div');
  lb.id = 'bz-map-lightbox';
  Object.assign(lb.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.92)',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: '20px', cursor: 'zoom-out',
  });
  lb.onclick = () => lb.remove();
  lb.innerHTML = `
    <div style="max-width:90vw;max-height:90vh;display:flex;flex-direction:column;gap:14px;cursor:default"
         onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="color:#fff;font-family:'Cairo',sans-serif;font-size:15px;font-weight:700">${title}</div>
        <button onclick="document.getElementById('bz-map-lightbox').remove()"
                style="background:rgba(255,255,255,0.15);border:none;color:#fff;border-radius:50%;
                       width:38px;height:38px;cursor:pointer;font-size:22px;font-family:'Cairo',sans-serif;
                       display:flex;align-items:center;justify-content:center;flex-shrink:0">×</button>
      </div>
      <img src="${url}" alt="${name}"
           style="max-width:80vw;max-height:74vh;object-fit:contain;border-radius:12px;display:block;
                  box-shadow:0 8px 40px rgba(0,0,0,0.5)"
           onerror="this.outerHTML='<div style=&quot;color:white;text-align:center;padding:40px;font-family:Cairo,sans-serif&quot;>${t('slotMap.lightboxLoadError')}</div>'">
      <div style="text-align:center">
        <a href="${url}" target="_blank" rel="noopener"
           style="color:rgba(255,255,255,0.65);font-size:12px;font-family:'Cairo',sans-serif;text-decoration:none">
          ${t('slotMap.lightboxOpenNewTab')}
        </a>
      </div>
    </div>`;
  document.body.appendChild(lb);

  const onKey = e => { if (e.key === 'Escape') { lb.remove(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}


/* ================================================================
   👤 مربع المنظّم في صفحة التفاصيل
   ================================================================ */

/* Cache لبيانات المنظمين — يتجنب 3 queries في كل فتح تفاصيل */
const _orgCardCache = new Map(); // userId → { data, ts }
const _ORG_CARD_TTL = 5 * 60 * 1000; // 5 دقائق

/* cache للأفاتار في الكروت: userId → avatarUrl | null */
const _orgAvatarCache = new Map();

async function _loadOrgAvatarsForCards(bazaars) {
  if (!sbClient) return;
  const orgIds = [...new Set(bazaars.filter(b => b.organizer_id).map(b => b.organizer_id))];
  if (!orgIds.length) return;

  // استخدام cache موجود (من _orgCardCache أو _orgAvatarCache)
  const toFetch = orgIds.filter(id => {
    if (_orgAvatarCache.has(id)) return false;
    const cached = _orgCardCache.get(id);
    if (cached) {
      const url = cached.data?.org?.avatar_url || cached.data?.org?.logo || null;
      _orgAvatarCache.set(id, url);
      return false;
    }
    return true;
  });

  if (toFetch.length) {
    try {
      const { data } = await sbClient
        .from('organizer_profiles')
        .select('user_id, avatar_url, logo')
        .in('user_id', toFetch);
      toFetch.forEach(id => _orgAvatarCache.set(id, null)); // null إذا لم يُرجع نتيجة
      (data || []).forEach(p => {
        _orgAvatarCache.set(p.user_id, p.avatar_url || p.logo || null);
      });
    } catch (_) {
      toFetch.forEach(id => _orgAvatarCache.set(id, null));
    }
  }

  // تحديث DOM
  orgIds.forEach(id => {
    const url = _orgAvatarCache.get(id);
    if (!url) return;
    document.querySelectorAll(`.bz-org-avatar[data-org-id="${id}"]`).forEach(el => {
      const ini = el.dataset.initial || '🎪';
      el.innerHTML = `<img src="${url}" alt="${t('orgSearch.defaultName')}"
        style="width:100%;height:100%;object-fit:cover;border-radius:50%"
        onerror="this.parentElement.innerHTML=this.parentElement.dataset.initial">`;
    });
  });
}

async function _loadOrganizerCard(userId, fallbackName) {
  const el = document.getElementById('bzd-organizer-card');
  if (!el) return;

  /* استخدام الـ cache إذا لم يتجاوز 5 دقائق */
  const cached = _orgCardCache.get(userId);
  if (cached && (Date.now() - cached.ts) < _ORG_CARD_TTL) {
    _renderOrganizerCardData(el, cached.data, userId, fallbackName);
    return;
  }

  el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink3);font-size:13px">${t('organizer.loadingCard')}</div>`;

  try {
    const [orgRes, reviewsRes, bazaarsRes] = await Promise.all([
      sbClient.from('organizer_profiles').select('*').eq('user_id', userId).single(),
      sbClient.from('organizer_reviews').select('rating, comment, created_at').eq('organizer_id', userId).order('created_at', { ascending: false }).limit(3),
      sbClient.from('bazaars').select('id, status, event_links').eq('organizer_id', userId).eq('is_deleted', false),
    ]);

    const org     = orgRes.data;
    const reviews = reviewsRes.data || [];
    const bazaars = bazaarsRes.data || [];

    /* إحصائيات الحجوزات المكتملة */
    let completedBookings = 0;
    if (bazaars.length > 0) {
      const bzIds = bazaars.map(b => b.id);
      try {
        const { count } = await sbClient.from('bazaar_bookings')
          .select('id', { count: 'exact', head: true })
          .in('bazaar_id', bzIds)
          .eq('status', 'confirmed');
        completedBookings = count || 0;
      } catch (_) { /* غير حرج */ }
    }

    if (!org) { _renderOrganizerCardBasic(fallbackName, false); return; }

    /* خزّن في الـ cache وارسم */
    _orgCardCache.set(userId, { data: { org, reviews, bazaars, completedBookings }, ts: Date.now() });
    _renderOrganizerCardData(el, { org, reviews, bazaars, completedBookings }, userId, fallbackName);

  } catch (err) {
    console.warn('تعذّر تحميل بيانات المنظّم:', err.message);
    _renderOrganizerCardBasic(fallbackName, false);
  }
}

function _renderOrganizerCardData(el, { org, reviews, bazaars, completedBookings = 0 }, userId, fallbackName) {
  const name = org?.name || fallbackName || t('organizer.defaultOrganizerName');
  if (!org) { _renderOrganizerCardBasic(fallbackName, false); return; }

  const totalBazaars  = bazaars.length;
  const activeBazaars = bazaars.filter(bz => ['published','approved','active','live'].includes(String(bz.status||'').toLowerCase())).length;
  const completedBazaars = bazaars.filter(bz => bz.status === 'completed');
  const docsCount  = completedBazaars.filter(bz => bz.event_links && bz.event_links.length > 0).length;
  const nodocsCount = completedBazaars.length - docsCount;
  const postponedCount = bazaars.filter(bz => bz.status === 'postponed').length;
  const cancelledCount = bazaars.filter(bz => bz.status === 'cancelled').length;
  const hasReputation  = completedBazaars.length > 0;
  const avgRating     = reviews.length
    ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(1)
    : null;
  const joinDate = (org.joined_at || org.created_at)
    ? _bzFmtDateLong(org.joined_at || org.created_at, { year:'numeric', month:'long' })
    : null;

  const avatarUrl  = org.avatar_url || org.logo || org.image || '';
  const avatarHtml = avatarUrl
    ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="${_esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${_esc(name[0] || t('organizer.defaultOrganizerName')[0])}';">`
    : (name[0] || t('organizer.defaultOrganizerName')[0]).toUpperCase();

  const starsHtml = avgRating
    ? `${'★'.repeat(Math.round(Number(avgRating)))}${'☆'.repeat(5 - Math.round(Number(avgRating)))}`
    : '';

  const reviewsHtml = reviews.length ? `
    <div style="margin-top:14px">
      <div style="font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:8px">${t('organizer.customerReviews', { count: reviews.length })}</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${reviews.map(r => `
        <div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:12px;font-weight:700">${_esc(r.reviewer_name) || t('organizer.noReviewerName')}</span>
            <span style="color:var(--orange);font-size:12px">${'★'.repeat(Number(r.rating)||0)}</span>
          </div>
          ${r.comment ? `<div style="font-size:12px;color:var(--ink2);line-height:1.6">${_esc(r.comment)}</div>` : ''}
        </div>`).join('')}
      </div>
    </div>` : '';

  el.innerHTML = `
  <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,rgba(243,100,24,.10),rgba(243,100,24,.03));
                padding:16px 20px;border-bottom:1px solid var(--border);
                display:flex;align-items:center;gap:14px;
                cursor:pointer;user-select:none"
         onclick="window.location.href='/bazaars/profile.html?organizer=${userId}'">
      <div style="width:56px;height:56px;border-radius:50%;
                  background:linear-gradient(180deg,#F47432 0%,#F36418 100%);
                  display:flex;align-items:center;justify-content:center;
                  font-size:22px;font-weight:900;color:#fff;
                  flex-shrink:0;overflow:hidden;
                  border:2px solid rgba(243,100,24,.28)">
        ${avatarHtml}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:16px;font-weight:900;color:var(--dark)">${_esc(name)}</div>
          ${org.is_verified ? `<span class="bz-verified-badge">${t('organizer.verifiedOrganizerFull')}</span>` : ''}
        </div>
        ${avgRating ? `
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
          <span style="color:var(--orange);font-size:14px">${starsHtml}</span>
          <span style="font-size:13px;font-weight:800;color:var(--orange)">${avgRating}</span>
          <span style="font-size:11px;color:var(--ink3)">${t('organizer.ratingCount', { count: reviews.length })}</span>
        </div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px;
                  background:var(--surface2);border-radius:12px;padding:10px 16px;flex-shrink:0">
        <div style="font-size:22px;font-weight:900;color:var(--orange);font-family:'Cairo',sans-serif">${totalBazaars}</div>
        <div style="font-size:10px;color:var(--ink3);font-weight:600">${t('organizer.bazaarsOrganized', { count: totalBazaars })}</div>
      </div>
    </div>
    <div style="padding:14px 20px">
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
        ${activeBazaars ? `
        <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);
                    border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:900;color:#22C55E">${activeBazaars}</div>
          <div style="font-size:10px;color:var(--ink3)">${t('organizer.activeBazaar', { count: activeBazaars })}</div>
        </div>` : ''}
        ${avgRating ? `
        <div style="background:rgba(243,100,24,.08);border:1px solid rgba(243,100,24,.2);
                    border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:18px;font-weight:900;color:var(--orange)">${avgRating}⭐</div>
          <div style="font-size:10px;color:var(--ink3)">${t('organizer.avgRating')}</div>
        </div>` : ''}
        ${joinDate ? `
        <div style="background:var(--surface2);border:1px solid var(--border);
                    border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:12px;font-weight:800;color:var(--ink2)">${joinDate}</div>
          <div style="font-size:10px;color:var(--ink3)">${t('organizer.joinDate')}</div>
        </div>` : ''}
      </div>
      ${hasReputation ? `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
        <div style="font-size:11px;font-weight:700;color:var(--ink3);margin-bottom:6px">${t('organizer.performanceHistory')}</div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${completedBazaars.length > 0 ? `<span style="font-size:12px;font-weight:700;color:#1d4ed8">${t('organizer.completedBazaars', { count: completedBazaars.length })}</span>` : ''}
          ${completedBookings > 0 ? `<span style="font-size:12px;font-weight:700;color:#047857">${t('organizer.completedBookings', { count: completedBookings })}</span>` : ''}
          ${docsCount > 0   ? `<span style="font-size:12px;font-weight:700;color:#059669">${t('organizer.addedLinksCount', { count: docsCount })}</span>` : ''}
          ${nodocsCount > 0 ? `<span style="font-size:12px;color:#92400e">${t('organizer.noLinksCount', { count: nodocsCount })}</span>` : ''}
          ${postponedCount > 0 ? `<span style="font-size:12px;color:var(--ink3)">${t('organizer.postponedCount', { count: postponedCount })}</span>` : ''}
          ${cancelledCount > 0 ? `<span style="font-size:12px;color:#dc2626">${t('organizer.cancelledCount', { count: cancelledCount })}</span>` : ''}
        </div>
      </div>` : ''}
      ${reviewsHtml}
    </div>
  </div>`;
}

function _renderOrganizerCardBasic(name, isVerified) {
  const el = document.getElementById('bzd-organizer-card');
  if (!el || !name) return;
  el.innerHTML = `
  <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;
              padding:14px 18px;display:flex;align-items:center;gap:12px">
    <div style="width:44px;height:44px;border-radius:50%;flex-shrink:0;
                background:linear-gradient(180deg,#F47432 0%,#F36418 100%);
                display:flex;align-items:center;justify-content:center;
                font-size:18px;font-weight:900;color:#fff">
      ${name[0].toUpperCase()}
    </div>
    <div style="flex:1">
      <div style="font-size:14px;font-weight:800;color:var(--dark)">${name}</div>
      <div style="font-size:11px;color:var(--ink3);margin-top:2px">${t('organizer.defaultOrganizerName')}</div>
    </div>
    ${isVerified ? `<span class="bz-verified-badge">${t('card.verifiedBadge')}</span>` : ''}
  </div>`;
}


function _renderSlotMapFallback() {
  return `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">${t('slotMap.title')}</h2>
    </div>
    <div style="text-align:center;padding:40px 24px;
                background:var(--surface);border-radius:var(--radius-lg);
                border:1.5px dashed var(--border)">
      <div style="font-size:52px;margin-bottom:14px">🎪</div>
      <div style="font-size:15px;font-weight:700;color:var(--ink2);margin-bottom:6px">
        ${t('slotMap.fallbackTitle')}
      </div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:20px;max-width:360px;margin-inline:auto">
        ${t('slotMap.fallbackDesc')}
      </div>
      <a href="https://wa.me/201103467711" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:8px;background:#25D366;
                color:#fff;padding:12px 26px;border-radius:var(--radius-lg);
                font-weight:800;text-decoration:none;font-family:'Cairo',sans-serif;
                box-shadow:0 4px 16px rgba(37,211,102,0.35)">
        ${t('slotMap.fallbackWhatsapp')}
      </a>
    </div>`;
}

function _renderSlotMapEndedFallback(endDate) {
  const expDateFmt = endDate
    ? _bzFmtDateLong(endDate, { year:'numeric', month:'long', day:'numeric' })
    : '';
  return `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">${t('slotMap.title')}</h2>
    </div>
    <div style="text-align:center;padding:40px 24px;background:rgba(15,15,22,0.92);border-radius:16px;margin-top:16px">
      <div style="font-size:30px;margin-bottom:10px">🔒</div>
      <div style="font-size:15px;font-weight:900;color:#fff;margin-bottom:8px;max-width:420px;margin-inline:auto;line-height:1.6">
        ${t('slotMap.endedTitle')}
      </div>
      <div style="font-size:12.5px;color:rgba(255,255,255,.78);max-width:420px;margin-inline:auto;line-height:1.7">
        ${t('slotMap.endedDesc')}
      </div>
      ${expDateFmt ? `<div style="font-size:11px;color:rgba(255,255,255,.55);margin-top:8px">${t('slotMap.endedOn', { date: expDateFmt })}</div>` : ''}
      <button class="btn btn-primary" style="padding:12px 28px;margin-top:20px" onclick="closeBazaarDetail()">
        ${t('slotMap.backToAvailable')}
      </button>
    </div>
    <div id="bzd-past-org-bazaars" style="margin-top:20px"></div>`;
}


/* ================================================================
   🪑 القسم 12: خريطة الأماكن البصرية
   ================================================================ */

let _slotMapMode       = 'open';  // 'open' | 'live' | 'ended' — تُستخدم عند إعادة تحديث الخريطة (refreshSlotMap)
let _slotMapEndDateFmt = null;

function renderSlotMap(slots, opts = {}) {
  const { mode = 'open', endDateFmt = null } = opts;
  const readOnly = mode !== 'open';
  _slotMapMode       = mode;
  _slotMapEndDateFmt = endDateFmt;

  const el = document.getElementById('bzd-slotmap');
  if (!el) return;

  const availCount    = slots.filter(s => s.status === 'available').length;
  const pendingCount  = slots.filter(s => s.status === 'pending').length;
  const bookedCount   = slots.filter(s => s.status === 'booked').length;
  const featuredCount = slots.filter(s =>
    s.is_featured == true || s.is_featured === 'true' ||
    s.is_featured === 1   || s.is_featured === '1'    || s.is_featured === 'yes'
  ).length;

  const hasLayout = slots.some(s => s.row != null && s.col != null);
  let gridHtml = '';
  let slotIdx  = 0;

  if (hasLayout) {
    const maxRow = Math.max(...slots.map(s => parseInt(s.row) || 1));
    const maxCol = Math.max(...slots.map(s => parseInt(s.col) || 1));

    const matrix = Array.from({ length: maxRow }, () => Array(maxCol).fill(null));
    slots.forEach(s => {
      const r = parseInt(s.row) - 1;
      const c = parseInt(s.col) - 1;
      if (r >= 0 && c >= 0) matrix[r][c] = s;
    });

    gridHtml = `<div class="bz-slot-grid bz-slot-grid-fixed"
                     style="grid-template-columns:repeat(${maxCol},40px)">`;
    for (let r = 0; r < maxRow; r++) {
      for (let c = 0; c < maxCol; c++) {
        const slot = matrix[r][c];
        gridHtml += slot
          ? _buildSlotHtml(slot, slotIdx++, readOnly)
          : `<div class="bz-slot bz-slot-empty"></div>`;
      }
    }
    gridHtml += '</div>';
  } else {
    gridHtml = '<div class="bz-slot-grid">' +
      slots.map((s, i) => _buildSlotHtml(s, i, readOnly)).join('') +
      '</div>';
  }

  const bannerHtml = mode === 'live'
    ? `<div class="bz-slotmap-banner bz-slotmap-banner-live">${t('slotMap.liveBanner')}</div>`
    : '';

  const endedOverlayHtml = mode === 'ended' ? `
    <div class="bz-slotmap-overlay">
      <div class="bz-slotmap-overlay-ico">🔒</div>
      <div class="bz-slotmap-overlay-title">${t('slotMap.endedTitle')}</div>
      <div class="bz-slotmap-overlay-desc">${t('slotMap.endedDesc')}</div>
      ${endDateFmt ? `<div class="bz-slotmap-overlay-date">${t('slotMap.endedOn', { date: endDateFmt })}</div>` : ''}
    </div>` : '';

  el.innerHTML = `
    ${bannerHtml}
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">${t('slotMap.title')}</h2>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <div class="sd-units-summary">
          <span class="sd-units-avail">${t('slotMap.availableCount', { count: availCount })}</span>
          ${pendingCount  > 0 ? `<span class="sd-units-avail" style="color:#b45309;border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.1)">${t('slotMap.pendingCount', { count: pendingCount })}</span>` : ''}
          ${bookedCount   > 0 ? `<span class="sd-units-rented">${t('slotMap.bookedCount', { count: bookedCount })}</span>` : ''}
          ${featuredCount > 0 ? `<span class="sd-units-avail" style="color:#c47800;border-color:rgba(245,200,66,.35);background:rgba(250,200,30,.1)">${t('slotMap.featuredCount', { count: featuredCount })}</span>` : ''}
        </div>
        <button class="bz-refresh-btn" onclick="refreshSlotMap()" title="${t('slotMap.refreshTooltip')}">↻</button>
      </div>
    </div>

    <div class="bz-legend">
      <span class="bz-legend-item"><span class="bz-legend-dot available"></span> ${t('slotMap.legendAvailable')}${readOnly ? '' : t('slotMap.legendAvailableBookHint')}</span>
      ${pendingCount > 0 ? `<span class="bz-legend-item"><span class="bz-legend-dot pending"></span> ${t('slotMap.legendPending')}</span>` : ''}
      <span class="bz-legend-item"><span class="bz-legend-dot booked"></span> ${t('slotMap.legendBooked')}</span>
      ${!readOnly ? `<span class="bz-legend-item"><span class="bz-legend-dot selected"></span> ${t('slotMap.legendSelected')}</span>` : ''}
      ${featuredCount > 0 ? `<span class="bz-legend-item"><span class="bz-legend-dot featured"></span> ${t('slotMap.legendFeatured')}</span>` : ''}
    </div>

    <div class="bz-slotmap-wrap${mode === 'ended' ? ' bz-slotmap-ended' : ''}">
      <div class="bz-slotmap-scroll${readOnly ? ' bz-readonly' : ''}">${gridHtml}</div>
      ${endedOverlayHtml}
    </div>

    ${!readOnly ? `<div style="font-size:12px;color:var(--ink3);text-align:center;margin-top:10px;padding-bottom:4px">
      ${t('slotMap.clickHint')}
    </div>` : ''}`;
}

function _buildSlotHtml(slot, index = 0, readOnly = false) {
  const isPending   = slot.status === 'pending';
  const isBooked    = slot.status === 'booked';
  const isAvailable = !isBooked && !isPending;
  const isFeatured  = slot.is_featured == true || slot.is_featured === 'true'
                   || slot.is_featured === 1   || slot.is_featured === '1'
                   || slot.is_featured === 'yes';

  let cls = isBooked ? 'booked' : isPending ? 'pending' : 'available';
  if (isFeatured) cls += ' featured';

  const displayLabel = (slot.row_label || '') + (slot.slot_number || '');

  const clickAttr = (isAvailable && !readOnly)
    ? `onclick="selectSlot('${slot.id}','${displayLabel || slot.id}')"`
    : '';

  const featSuffix   = isFeatured ? t('slotMap.featuredSuffix') : '';
  const bookedLabel  = t('slotMap.bookedStatus') + featSuffix;
  const pendingLabel = t('slotMap.pendingStatus') + featSuffix;
  const availLabel   = (readOnly ? t('slotMap.availableStatus') : t('slotMap.clickToBookStatus')) + featSuffix;
  const slotLbl      = t('slotMap.slotLabel', { label: displayLabel });
  const titleAttr    = isBooked
    ? `title="${slotLbl} — ${bookedLabel}"`
    : isPending
    ? `title="${slotLbl} — ${pendingLabel}"`
    : `title="${slotLbl} — ${availLabel}"`;

  const delay       = Math.min(index * 0.028, 0.55).toFixed(3);
  const featuredTip = isFeatured
    ? `<span class="bz-featured-tooltip">${t('slotMap.legendFeatured')}</span>`
    : '';

  return `<div class="bz-slot ${cls}"
              data-slot-id="${slot.id}"
              data-featured="${isFeatured}"
              data-price="${Number(slot.price || 0)}"
              data-slot-label="${displayLabel}"
              style="animation-delay:${delay}s"
              ${clickAttr} ${titleAttr}>
    ${displayLabel}
    ${featuredTip}
  </div>`;
}

function selectSlot(slotId, slotLabel) {
  document.querySelectorAll('.bz-slot.selected').forEach(el => {
    el.classList.remove('selected');
    el.classList.add('available');
  });

  const slotEl    = document.querySelector(`.bz-slot[data-slot-id="${slotId}"]`);
  const isFeatured = slotEl?.dataset?.featured === 'true';
  if (slotEl) {
    slotEl.classList.remove('available');
    slotEl.classList.add('selected');
    slotEl.style.animation = 'none';
    requestAnimationFrame(() => {
      slotEl.style.animation = 'slotPop 0.32s cubic-bezier(.22,.68,0,1.2) both';
    });
  }

  selectedSlotId = slotId;

  const slotInfoEl = document.getElementById('bzd-slot-info');
  if (slotInfoEl && currentBazaar) {
    const slotPrice = Number(slotEl?.dataset?.price || 0);
    const displayPrice = slotPrice > 0 ? slotPrice : Number(currentBazaar.price_per_slot || 0);
    const priceStr  = _bzFmtNum(displayPrice);
    const featuredTag = isFeatured ? t('booking.featuredTag') : '';
    slotInfoEl.textContent = t('booking.slotInfoSelected', { label: slotLabel, featured: featuredTag, price: priceStr });
  }

  if (currentUser) {
    const nb = document.getElementById('bzb-name');
    const pb = document.getElementById('bzb-phone');
    const eb = document.getElementById('bzb-email');
    if (nb && !nb.value) nb.value = currentProfile?.full_name || currentUser.user_metadata?.full_name || '';
    if (pb && !pb.value) pb.value = currentProfile?.phone || '';
    if (eb && !eb.value) eb.value = currentUser.email || '';
  }

  const panel = document.getElementById('bzd-booking-panel');
  if (panel) {
    panel.style.display = 'block';
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  }
}

function clearSlotSelection() {
  document.querySelectorAll('.bz-slot.selected').forEach(el => {
    el.classList.remove('selected');
    el.classList.add('available');
  });
  selectedSlotId = null;

  const panel = document.getElementById('bzd-booking-panel');
  if (panel) panel.style.display = 'none';
}


/* ================================================================
   📬 القسم 13: إرسال حجز البازار — Supabase فقط
   ================================================================ */

async function submitBazaarBooking() {
  if (!selectedSlotId || !currentBazaar) return;

  if (!currentUser) {
    window.location.href = '/?p=login';
    return;
  }

  const name     = document.getElementById('bzb-name')?.value.trim();
  const phone    = document.getElementById('bzb-phone')?.value.trim();
  const email    = document.getElementById('bzb-email')?.value.trim();
  const business = document.getElementById('bzb-business')?.value.trim();
  const activity = document.getElementById('bzb-activity')?.value.trim() || null;
  const notes    = document.getElementById('bzb-notes')?.value.trim();

  const errorEl = document.getElementById('bzb-error');
  const showBzbError = (msg, focusEl) => {
    if (!errorEl) return;
    errorEl.textContent   = '⚠ ' + msg;
    errorEl.style.display = 'block';
    (focusEl || errorEl).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  if (errorEl) errorEl.style.display = 'none';

  if (!name)     { showBzbError(t('booking.validation.nameRequired')); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showBzbError(t('booking.validation.phoneInvalid')); return;
  }
  if (!activity) { showBzbError(t('booking.validation.activityRequired'), document.getElementById('bzb-activity')); return; }
  if (!business) { showBzbError(t('booking.validation.businessRequired')); return; }
  if (!sbClient) {
    showBzbError(t('booking.validation.connectionError')); return;
  }

  const submitBtn = document.querySelector('#bzd-booking-panel .btn-primary');
  if (submitBtn) {
    submitBtn.innerHTML  = t('booking.submitting');
    submitBtn.disabled   = true;
    submitBtn.style.opacity = '0.7';
  }

  /* نحتفظ بـ ID المكان الذي قفلناه لنتمكن من التراجع عنه في حالة الفشل */
  const _capturedSlotId = selectedSlotId;
  let   _slotWasLocked  = false;

  /* احسب سعر المكان المختار (يأخذ أولوية على السعر الافتراضي للبازار) */
  const _capturedSlotEl  = document.querySelector(`.bz-slot[data-slot-id="${_capturedSlotId}"]`);
  const _capturedSlotPrice = Number(_capturedSlotEl?.dataset?.price || 0);
  const _bookingAmount   = _capturedSlotPrice > 0 ? _capturedSlotPrice : Number(currentBazaar.price_per_slot || 0);

  try {
    const now = new Date().toISOString();

    /* التحقق من حد الحجوزات: بحد أقصى 2 مكان لنفس المستخدم في نفس البازار */
    const { data: existingBks } = await sbClient
      .from('bazaar_bookings')
      .select('id')
      .eq('bazaar_id', String(currentBazaar.id))
      .eq('user_id', currentUser.id)
      .in('status', ['pending', 'confirmed']);

    if ((existingBks?.length || 0) >= 2) {
      showBzbError(t('booking.validation.bookingLimitExceeded'));
      if (submitBtn) { submitBtn.innerHTML = t('booking.submitBtnRetry'); submitBtn.disabled = false; submitBtn.style.opacity = '1'; }
      return;
    }

    /* قفل الوحدة بحجز مبدئي — pending */
    const { data: lockedRows, error: lockErr } = await sbClient
      .from('bazaar_slots')
      .update({ status: 'pending' })
      .eq('id', _capturedSlotId)
      .eq('status', 'available')
      .select('id');

    if (lockErr) throw new Error('تعذّر حجز المكان: ' + lockErr.message);
    if (!lockedRows || lockedRows.length === 0) throw new Error('تعذّر حجز المكان — ربما تم الحجز للتو من شخص آخر');

    /* ← من هنا فصاعداً: الـ slot في pending ونحن المسؤولون عنه */
    _slotWasLocked = true;

    // حفظ الحجز
    const { data: insertedBooking, error: bookingErr } = await sbClient
      .from('bazaar_bookings')
      .insert({
        bazaar_id:     String(currentBazaar.id),
        slot_id:       _capturedSlotId,
        user_id:       currentUser.id,
        user_name:     name,
        user_phone:    phone,
        user_email:    email || null,
        business_name: business,
        activity:      activity,
        notes:         notes || null,
        status:        'pending',
        amount:        _bookingAmount,
        created_at:    now,
      })
      .select('id')
      .single();

    if (bookingErr) throw new Error('booking_insert_failed: ' + bookingErr.message);

    /* الحجز نجح → لا داعي للـ rollback حتى لو فشل أي شيء بعد هذه النقطة */
    _slotWasLocked = false;
    window.mkPwaInstall?.signalSuccess();

    // تحديث available_slots بشكل atomic (RPC تضمن عدم التعارض بين مستخدمين)
    await sbClient.rpc('decrement_available_slots', { p_bazaar_id: String(currentBazaar.id) });

    // إشعار المنظم بالحجز الجديد → جدول notifications الموحّد
    if (currentBazaar.organizer_id) {
      const slotLabel = document.querySelector(`.bz-slot[data-slot-id="${selectedSlotId}"]`)
        ?.dataset?.slotLabel || selectedSlotId;
      sbClient.from('notifications').insert({
        user_id:    currentBazaar.organizer_id,
        type:       'new_booking',
        source:     'bazaar',
        title:      `حجز جديد — ${currentBazaar.name}`,
        body:       `${name} (${phone}) طلب حجز مكان ${slotLabel}`,
        action_url: `/?p=dashboard`,
        metadata:   { bazaar_id: String(currentBazaar.id) },
      }).catch(() => {});
    }

    const bazaarBookingRecord = {
      id: insertedBooking?.id || null,
      bazaar_id: String(currentBazaar.id), slot_id: selectedSlotId,
      user_id: currentUser.id, user_name: name, user_phone: phone,
      user_email: email || null, business_name: business, notes: notes || null,
      status: 'pending', amount: _bookingAmount, created_at: now,
    };
    _saveLocalBazaarBooking(currentUser.id, bazaarBookingRecord);

    const slotEl = document.querySelector(`.bz-slot[data-slot-id="${selectedSlotId}"]`);
    if (slotEl) {
      slotEl.classList.remove('selected', 'available');
      slotEl.classList.add('pending');
      slotEl.onclick = null;
      slotEl.title   = t('slotMap.slotLabel', { label: slotEl.textContent.trim() }) + ' — ' + t('slotMap.pendingAdminNote');
    }

    if (typeof currentBazaar.available_slots === 'number') {
      currentBazaar.available_slots = Math.max(0, currentBazaar.available_slots - 1);
    }

    selectedSlotId = null;

    const panel = document.getElementById('bzd-booking-panel');
    if (panel) {
      panel.innerHTML = `
        <div class="bz-bp-inner bz-bp-success">
          <div class="success-circle" style="width:60px;height:60px;font-size:26px;margin:0 auto 16px">✓</div>
          <div class="success-title" style="font-size:22px;margin-bottom:8px">${t('booking.success.title')}</div>
          <div class="success-body" style="font-size:14px;line-height:1.9;margin-bottom:20px">
            ${t('booking.success.body', { name: _esc(name), bazaarName: _esc(currentBazaar.name), phone: _esc(phone) })}
          </div>
          <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;
                      padding:10px 14px;font-size:12.5px;color:#92400e;margin-bottom:16px;text-align:start">
            ${t('booking.success.pendingNote')}
          </div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" style="padding:12px 28px"
                    onclick="closeBazaarDetail()">${t('booking.success.allBazaarsBtn')}</button>
            <a class="btn" href="/?p=dashboard" style="padding:12px 28px">${t('booking.success.myBookingsBtn')}</a>
          </div>
        </div>`;
    }

  } catch (err) {
    /*
     * Rollback: إذا كنا قفلنا الـ slot (وضعناه pending) لكن فشل إدراج الحجز،
     * نُعيده لـ available حتى لا يبقى "مشغولاً وهمياً" للأبد.
     */
    if (_slotWasLocked && _capturedSlotId) {
      sbClient.from('bazaar_slots')
        .update({ status: 'available' })
        .eq('id', _capturedSlotId)
        .catch(() => {});

      // تحديث الـ DOM فوراً دون انتظار الـ DB
      const slotElRb = document.querySelector(`.bz-slot[data-slot-id="${_capturedSlotId}"]`);
      if (slotElRb) {
        slotElRb.classList.remove('pending', 'selected');
        slotElRb.classList.add('available');
        const lbl = slotElRb.dataset.slotLabel || '';
        const isFeat = slotElRb.dataset.featured === 'true';
        slotElRb.onclick = () => selectSlot(_capturedSlotId, lbl);
        slotElRb.title = t('slotMap.slotLabel', { label: lbl }) + (isFeat ? t('slotMap.featuredSuffix') : '') + ' — ' + t('slotMap.clickToBookStatus');
      }
    }

    if (submitBtn) {
      submitBtn.innerHTML  = t('booking.confirmBtnRetry');
      submitBtn.disabled   = false;
      submitBtn.style.opacity = '1';
    }
    const msg = err.message?.includes('booking_limit_exceeded')
      ? t('booking.validation.bookingLimitExceeded')
      : err.message?.includes('تعذّر حجز')
        ? t('booking.validation.slotTaken')
        : t('booking.validation.genericError');
    showBzbError(msg);
  }
}


/* ================================================================
   💾 القسم 14: Local Cache للحجوزات
   ================================================================ */

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
   🔗 القسم 15: مشاركة ونسخ رابط الحجز
   ================================================================ */

function shareCard(bazaarId, name) {
  const base      = window.location.origin + '/bazaars/';
  const url       = base + '?bazaar=' + bazaarId;
  const shareText = t('share.checkOutBazaar', { name });

  if (navigator.share) {
    navigator.share({ title: t('brand'), text: shareText, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(()  => _showShareToast(t('share.linkCopied')))
      .catch(() => _showShareToast(t('share.linkFallback', { url })));
  }
}

/* رابط الحجز المباشر لبازار معيّن — نفس رابط shareCard مع علامة book=1
   التي تقرأها نقطة الدخول في القسم 3 لتمرّر تلقائياً لخريطة الأماكن */
function _bazaarBookingUrl(bazaarId) {
  return window.location.origin + '/bazaars/?bazaar=' + bazaarId + '&book=1';
}

/* نسخ رابط الحجز المباشر لهذا البازار للحافظة — بدون فتح نافذة أو عرض الرابط كنص،
   ثم تمرير سلس لخريطة الأماكن كأن المستخدم اختارها بنفسه (بلا اختيار مكان فعلي) */
function copyBazaarBookingLink() {
  if (!currentBazaar) return;
  const url = _bazaarBookingUrl(currentBazaar.id);

  const onCopied = () => {
    _flashCopiedBtn();
    _showShareToast(t('detail.copyLinkToast'));
    _scrollToBazaarBookingSection();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(onCopied).catch(() => _fallbackCopyText(url, onCopied));
  } else {
    _fallbackCopyText(url, onCopied);
  }
}

/* نسخ احتياطي للحافظة للمتصفحات القديمة التي لا تدعم navigator.clipboard —
   يظل ينسخ فعلياً بدل عرض الرابط كنص داخل الصفحة */
function _fallbackCopyText(text, onSuccess) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', opacity: '0', left: '-9999px' });
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) { onSuccess(); return; }
  } catch (_) { /* تجاهل — سيظهر تنبيه الفشل أدناه */ }
  _showShareToast(t('detail.copyLinkFailedToast'));
}

/* تأكيد بصري سريع على زر النسخ نفسه (بالإضافة إلى الـ Toast) */
function _flashCopiedBtn() {
  const btn   = document.getElementById('bzd-copy-link-btn');
  const label = document.getElementById('bzd-copy-link-label');
  if (!btn || !label) return;
  const orig = label.textContent;
  label.textContent = t('detail.copyLinkDone');
  btn.classList.add('bzd-quick-action--done');
  clearTimeout(btn._doneTmr);
  btn._doneTmr = setTimeout(() => {
    label.textContent = orig;
    btn.classList.remove('bzd-quick-action--done');
  }, 1800);
}

/* تمرير سلس لخريطة الأماكن + نبضة توضيحية — تُستخدم عند فتح رابط حجز مباشر
   (?book=1) أو عند نسخه من نفس الصفحة، بلا أي تعديل على منطق اختيار المكان */
function _scrollToBazaarBookingSection() {
  const slotmapEl = document.getElementById('bzd-slotmap');
  if (!slotmapEl) return;
  setTimeout(() => {
    slotmapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    slotmapEl.classList.add('bzd-slotmap-highlight');
    setTimeout(() => slotmapEl.classList.remove('bzd-slotmap-highlight'), 2200);
  }, 80);
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
      whiteSpace: 'nowrap', boxShadow: '0 4px 16px rgba(0,0,0,0.22)',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tmr);
  t._tmr = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}


/* ================================================================
   🔗 القسم 16: روابط الصفحات المستقلة
   ================================================================ */

function openVerificationRequest() {
  window.location.href = '/bazaars/verification.html';
}

function openOrganizerProfile(organizerId) {
  if (!organizerId) return;
  window.location.href = `/bazaars/profile.html?organizer=${organizerId}`;
}

function bzHandleBnUser() {
  if (currentUser) {
    window.location.href = '/?p=dashboard';
  } else {
    window.location.href = '/?p=login';
  }
}

function bzUpdateBnUser() {
  const icon  = document.getElementById('bn-user-icon');
  const label = document.getElementById('bn-user-label');
  const desc  = document.getElementById('bn-user-desc');
  if (!icon || !label) return;

  if (currentUser) {
    const initial = (currentProfile?.full_name || currentUser.email || '؟')[0].toUpperCase();
    icon.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:var(--orange);color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">${initial}</span>`;
    label.textContent = t('bottomNav.myAccount');
    if (desc) desc.textContent = currentProfile?.full_name?.split(' ')[0] || t('bottomNav.welcome');
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = t('bottomNav.login');
    if (desc) desc.textContent = t('bottomNav.loginDesc');
  }
}


/* ================================================================
   📅 القسم 17: M9 — استجابة الحاجز بعد التأجيل
   ================================================================ */

async function bzLoadPostponeAlerts() {
  if (!currentUser || !sbClient) return;

  const userId = String(currentUser.id);

  const { data: bookings, error } = await sbClient
    .from('bazaar_bookings')
    .select('id,status,postponement_deadline,bazaar_id,slot_id')
    .eq('user_id', userId)
    .eq('status', 'pending_after_postponement');

  if (error || !bookings?.length) return;

  // جلب تفاصيل البازارات
  const bazaarIds = [...new Set(bookings.map(b => b.bazaar_id))];
  const { data: bazaarsData } = await sbClient
    .from('bazaars')
    .select('id,title:name,start_date:date_start,end_date:date_end,location')
    .in('id', bazaarIds);

  const bazaarMap = {};
  (bazaarsData || []).forEach(b => { bazaarMap[b.id] = b; });

  // جلب آخر تأجيل لكل بازار
  const { data: postponements } = await sbClient
    .from('bazaar_postponements')
    .select('bazaar_id,old_start_date,old_end_date,new_start_date,new_end_date,reason,created_at')
    .in('bazaar_id', bazaarIds)
    .order('created_at', { ascending: false });

  const lastPostponement = {};
  (postponements || []).forEach(p => {
    if (!lastPostponement[p.bazaar_id]) lastPostponement[p.bazaar_id] = p;
  });

  // render
  const alertEl = document.getElementById('bz-postpone-alert');
  const itemsEl = document.getElementById('bz-postpone-items');
  const countEl = document.getElementById('bz-postpone-count');
  if (!alertEl || !itemsEl) return;

  countEl.textContent = t('postponeAlert.pendingCount', { count: bookings.length });

  itemsEl.innerHTML = bookings.map(booking => {
    const bz   = bazaarMap[booking.bazaar_id] || {};
    const post = lastPostponement[booking.bazaar_id] || {};
    const deadline = booking.postponement_deadline
      ? _bzFmtDateLong(booking.postponement_deadline, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
      : null;
    const isExpired = booking.postponement_deadline && new Date(booking.postponement_deadline) < new Date();

    return `
<div id="bz-pa-${booking.id}" style="background:#fff;border:1px solid #fdba74;border-radius:12px;padding:14px 16px">
  <div style="font-size:14px;font-weight:900;color:var(--dark);margin-bottom:6px">🎪 ${_bzEsc(bz.title || t('postponeAlert.defaultBazaarName'))}</div>
  ${post.old_start_date ? `
  <div style="font-size:12px;color:var(--ink3);margin-bottom:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="text-decoration:line-through;color:#dc2626">${_bzFmtDate(post.old_start_date)} — ${_bzFmtDate(post.old_end_date)}</span>
    <span>→</span>
    <span style="color:#047857;font-weight:800">${_bzFmtDate(post.new_start_date)} — ${_bzFmtDate(post.new_end_date)}</span>
  </div>` : ''}
  ${post.reason ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:8px">${t('postponeAlert.reasonLabel', { reason: _bzEsc(post.reason) })}</div>` : ''}
  ${deadline ? `<div style="font-size:11px;color:${isExpired ? '#dc2626' : '#c2410c'};margin-bottom:10px">${t('postponeAlert.deadlineLabel', { deadline })}${isExpired ? t('postponeAlert.deadlineExpiredSuffix') : ''}</div>` : ''}
  ${isExpired ? `
  <div style="font-size:12px;color:var(--ink3);background:var(--surface2);padding:8px 12px;border-radius:8px">${t('postponeAlert.expiredNote')}</div>` : `
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button onclick="bzRespondPostpone('${booking.id}','accepted')"
      style="padding:8px 18px;border-radius:50px;background:linear-gradient(180deg,#22c55e,#16a34a);color:#fff;border:none;font-size:13px;font-weight:800;font-family:var(--font-display);cursor:pointer;box-shadow:0 2px 8px rgba(34,197,94,.25)">
      ${t('postponeAlert.acceptBtn')}
    </button>
    <button onclick="bzRespondPostpone('${booking.id}','cancelled')"
      style="padding:8px 18px;border-radius:50px;background:var(--surface);color:#dc2626;border:1.5px solid #fca5a5;font-size:13px;font-weight:800;font-family:var(--font-display);cursor:pointer">
      ${t('postponeAlert.cancelBtn')}
    </button>
  </div>`}
</div>`;
  }).join('');

  alertEl.style.display = 'block';
}

async function bzRespondPostpone(bookingId, response) {
  const btn = event.target;
  const orig = btn.textContent;
  btn.disabled    = true;
  btn.textContent = t('postponeAlert.responding');

  const { data, error } = await sbClient.rpc('respond_to_postponement', {
    p_booking_id: bookingId,
    p_response:   response,
  });

  if (error || !data?.success) {
    const msgs = {
      booking_not_found:     t('postponeAlert.errors.booking_not_found'),
      not_authorized:        t('postponeAlert.errors.not_authorized'),
      not_pending_response:  t('postponeAlert.errors.not_pending_response'),
      deadline_passed:       t('postponeAlert.errors.deadline_passed'),
    };
    const err = data?.error || error?.message || t('postponeAlert.errors.generic');
    btn.disabled    = false;
    btn.textContent = orig;
    alert(msgs[err] || err);
    return;
  }

  // إخفاء بطاقة هذا الحجز
  const card = document.getElementById(`bz-pa-${bookingId}`);
  if (card) {
    const msg = response === 'accepted'
      ? t('postponeAlert.acceptedMsg')
      : t('postponeAlert.cancelledMsg');
    card.innerHTML = `<div style="font-size:13px;font-weight:700;color:${response==='accepted'?'#047857':'#dc2626'};padding:10px">${msg}</div>`;
    setTimeout(() => {
      card.style.transition = 'opacity .4s';
      card.style.opacity    = '0';
      setTimeout(() => {
        card.remove();
        // إخفاء القسم إذا لم تتبق بطاقات
        const remaining = document.querySelectorAll('[id^="bz-pa-"]');
        if (!remaining.length) {
          const alertEl = document.getElementById('bz-postpone-alert');
          if (alertEl) alertEl.style.display = 'none';
        } else {
          const countEl = document.getElementById('bz-postpone-count');
          if (countEl) countEl.textContent = t('postponeAlert.pendingCount', { count: remaining.length });
        }
      }, 450);
    }, 2000);
  }
}

function _bzFmtDate(d) {
  if (!d) return '—';
  return _bzFmtDateLong(d, { day: 'numeric', month: 'long' });
}

function _bzEsc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}


/* ================================================================
   📋 القسم 18: M11 — سجل التحديثات (Update History Timeline)
   ================================================================ */

/* دالة بدل const ثابت — لازم تُستدعى وقت الرسم (بعد جاهزية i18next) لا وقت تحميل الملف */
const _BZ_CHANGE_ICONS = {
  cancel: '🚫', postpone: '📅', edit_info: '✏️',
  edit_slots_count: '🔢', reserve_slot: '🔒', unreserve_slot: '🔓',
};
function _bzChangeLabel(changeType) {
  return {
    ico:   _BZ_CHANGE_ICONS[changeType] || '📝',
    label: t('timeline.changeTypes.' + changeType, { defaultValue: changeType }),
  };
}

async function _loadBazaarTimeline(bazaarId) {
  if (!sbClient || !bazaarId) return;

  const [logRes, postponeRes] = await Promise.all([
    sbClient
      .from('bazaar_change_log')
      .select('id,change_type,change_data,note,created_at')
      .eq('bazaar_id', bazaarId)
      .order('created_at', { ascending: false })
      .limit(20),
    sbClient
      .from('bazaar_postponements')
      .select('id,old_start_date,old_end_date,new_start_date,new_end_date,reason,created_at')
      .eq('bazaar_id', bazaarId)
      .order('created_at', { ascending: false })
      .limit(10),
  ]);

  const logs        = logRes.data || [];
  const postpones   = postponeRes.data || [];
  const timelineEl  = document.getElementById('bzd-timeline');
  if (!timelineEl) return;

  // دمج السجلَّين في timeline موحّدة مرتّبة زمنياً
  const events = [
    ...logs.map(l => ({ ...l, _type: 'log', _time: new Date(l.created_at) })),
    ...postpones.map(p => ({ ...p, _type: 'postpone', _time: new Date(p.created_at) })),
  ].sort((a, b) => b._time - a._time);

  if (!events.length) return;

  const itemsHtml = events.map(ev => {
    const timeAgo = _bzTimeAgo(ev._time);

    if (ev._type === 'postpone') {
      return `
<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
  <div style="flex-shrink:0;margin-top:2px">
    <div style="width:32px;height:32px;border-radius:50%;background:#fff7ed;border:2px solid #fdba74;display:flex;align-items:center;justify-content:center;font-size:15px">📅</div>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-size:13px;font-weight:800;color:var(--dark)">${t('timeline.postponeLabel')}</div>
    <div style="font-size:12px;color:var(--ink3);margin-top:3px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="text-decoration:line-through;color:#dc2626">${_bzFmtDate(ev.old_start_date)} — ${_bzFmtDate(ev.old_end_date)}</span>
      <span>→</span>
      <span style="color:#047857;font-weight:700">${_bzFmtDate(ev.new_start_date)} — ${_bzFmtDate(ev.new_end_date)}</span>
    </div>
    ${ev.reason ? `<div style="font-size:11px;color:var(--ink3);margin-top:4px;background:var(--surface2);padding:5px 9px;border-radius:6px;border-inline-start:2px solid #fdba74">${_bzEsc(ev.reason)}</div>` : ''}
    <div style="font-size:10px;color:var(--ink3);margin-top:4px">${timeAgo}</div>
  </div>
</div>`;
    }

    const meta  = _bzChangeLabel(ev.change_type);
    const data  = ev.change_data || {};
    let detail  = '';

    if (ev.change_type === 'edit_info') {
      const changed = Object.keys(data.after || {}).filter(k => k !== 'images');
      if (changed.length) detail = `<div style="font-size:11px;color:var(--ink3);margin-top:3px">${t('timeline.editedFieldsPrefix')}${changed.map(_bzFieldLabel).join(getLocale() === 'en' ? ', ' : '، ')}</div>`;
    } else if (ev.change_type === 'edit_slots_count') {
      detail = `<div style="font-size:11px;color:var(--ink3);margin-top:3px">${t('timeline.slotsChangeDetail', { old: data.old_total || '?', new: data.new_total || '?', booked: data.booked_count || 0 })}</div>`;
    } else if (ev.change_type === 'cancel' && data.affected_bookings > 0) {
      detail = `<div style="font-size:11px;color:#dc2626;margin-top:3px">${t('timeline.affectedBookings', { count: data.affected_bookings })}</div>`;
    }

    const noteHtml = ev.note
      ? `<div style="font-size:11px;color:var(--ink3);margin-top:4px;background:var(--surface2);padding:5px 9px;border-radius:6px;border-inline-start:2px solid var(--orange)">${_bzEsc(ev.note)}</div>`
      : '';

    return `
<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
  <div style="flex-shrink:0;margin-top:2px">
    <div style="width:32px;height:32px;border-radius:50%;background:var(--orange-ultra);border:2px solid rgba(243,100,24,.25);display:flex;align-items:center;justify-content:center;font-size:15px">${meta.ico}</div>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-size:13px;font-weight:800;color:var(--dark)">${meta.label}</div>
    ${detail}
    ${noteHtml}
    <div style="font-size:10px;color:var(--ink3);margin-top:4px">${timeAgo}</div>
  </div>
</div>`;
  }).join('');

  timelineEl.innerHTML = `
<div style="background:var(--surface);border-radius:var(--radius-xl);border:1px solid var(--border);padding:18px 20px;margin-top:16px">
  <div style="font-size:14px;font-weight:900;color:var(--dark);margin-bottom:14px;padding-bottom:10px;border-bottom:1.5px solid var(--border);display:flex;align-items:center;gap:8px">
    ${t('timeline.title')}
    <span style="font-size:11px;font-weight:700;background:var(--orange-ultra);color:var(--orange);padding:2px 8px;border-radius:50px">${events.length}</span>
  </div>
  <div>${itemsHtml}</div>
</div>`;
  timelineEl.style.display = 'block';
}

function _bzFieldLabel(key) {
  return t('timeline.fieldLabels.' + key, { defaultValue: key });
}

function _bzTimeAgo(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)   return t('timeline.timeAgo.now');
  if (mins < 60)  return t('timeline.timeAgo.minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return t('timeline.timeAgo.hoursAgo', { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 30)  return t('timeline.timeAgo.daysAgo', { count: days });
  return _bzFmtDateLong(date, { year:'numeric', month:'short', day:'numeric' });
}


/* ================================================================
   🔔 القسم 19: M14 — إشعارات user_bazaar_notifications
   ================================================================ */

/* نظام M14 للإشعارات (user_bazaar_notifications) — تم إزالته
   الإشعارات الآن موحّدة في جدول notifications عبر وحدة GN */


/* ================================================================
   🎪 القسم 20: فرص المساحات — للمنظمين فقط (B2B Marketplace)
   ================================================================ */

/* دوال بدل const ثابت — لازم تُستدعى وقت الرسم (بعد جاهزية i18next) لا وقت تحميل الملف */
function _bzVenueLabel(type) { return t('opportunities.venueTypes.' + type, { defaultValue: type }); }
function _bzFootLabel(level)  { return t('opportunities.footfall.' + level, { defaultValue: level }); }

/* هل المستخدم منظم بازار؟ (وسم القدرة roles[] — يفتح الناف وopportunities.html) */
function _bzIsOrganizer() {
  return !!currentCapabilities?.isOrganizer;
}


/* تحميل الفرص المتاحة عبر RPC */
async function bzLoadOpportunities() {
  if (!sbClient || !currentUser) return;
  try {
    const { data, error } = await sbClient.rpc('organizer_get_open_opportunities');
    if (error) throw error;
    bzRenderOpportunityCards(data || []);
  } catch (e) {
    const el = document.getElementById('bz-opp-cards');
    if (el) el.innerHTML = `<div style="color:red;padding:14px;font-size:12px">${t('opportunities.loadError', { error: e.message })}</div>`;
  }
}

/* رندر بطاقات الفرص */
function bzRenderOpportunityCards(opps) {
  const grid  = document.getElementById('bz-opp-cards');
  const badge = document.getElementById('bz-opp-count-badge');
  if (!grid) return;

  if (badge) {
    if (opps.length) { badge.textContent = t('opportunities.countBadge', { count: opps.length }); badge.style.display = ''; }
    else             { badge.style.display = 'none'; }
  }

  if (!opps.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px 20px;color:var(--ink3)">
      <div style="font-size:28px;margin-bottom:8px">📭</div>
      <div>${t('opportunities.empty')}</div>
    </div>`;
    return;
  }

  grid.innerHTML = opps.map(opp => {
    const imgHtml = opp.image_url
      ? `<img src="${_bzEsc(opp.image_url)}" class="bzopp-card-img" alt="" loading="lazy" onerror="this.style.display='none'">`
      : '';
    const typeLabel = opp.venue_type ? _bzVenueLabel(opp.venue_type) : '';
    const cityLine  = [opp.city ? _bzEsc(opp.city) : '', typeLabel].filter(Boolean).join(' · ');
    const appliedHtml = opp.already_applied
      ? `<div class="bzopp-already-applied">${t('opportunities.alreadyApplied')}</div>`
      : `<button class="bzopp-apply-btn" onclick="openBzProposalModal('${opp.id}','${_bzEsc(opp.place_name)}')">
           ${t('opportunities.applyBtn')}
         </button>`;

    return `
      <div class="bzopp-pub-card">
        ${imgHtml}
        ${typeLabel ? `<span class="bzopp-type-tag">${typeLabel}</span>` : ''}
        <div class="bzopp-pub-card-title">${_bzEsc(opp.place_name)}</div>
        ${cityLine && !typeLabel ? `<div class="bzopp-pub-card-city">${cityLine}</div>` : ''}
        ${opp.city && typeLabel ? `<div class="bzopp-pub-card-city">${_bzEsc(opp.city)}</div>` : ''}
        <div class="bzopp-pub-card-chips">
          ${opp.available_area ? `<span class="bzopp-chip orange">${t('opportunities.areaUnit', { area: opp.available_area })}</span>` : ''}
          <span class="bzopp-chip">${opp.is_indoor ? t('opportunities.indoor') : t('opportunities.outdoor')}</span>
          ${opp.has_electricity ? `<span class="bzopp-chip">${t('opportunities.electricity')}</span>` : ''}
          ${opp.has_setup ? `<span class="bzopp-chip">${t('opportunities.setup')}</span>` : ''}
          ${opp.expected_footfall ? `<span class="bzopp-chip">${_bzFootLabel(opp.expected_footfall)}</span>` : ''}
        </div>
        <div class="bzopp-pub-card-dates">${t('opportunities.datesRange', { start: opp.available_start, end: opp.available_end, days: opp.days_count || '?' })}</div>
        ${opp.notes ? `<div style="font-size:12px;color:var(--ink3);margin-bottom:12px;line-height:1.6">${_bzEsc(opp.notes)}</div>` : ''}
        <div class="bzopp-pub-card-spacer"></div>
        ${appliedHtml}
      </div>`;
  }).join('');
}

/* فتح مودال تقديم عرض */
function openBzProposalModal(requestId, placeName) {
  if (!currentUser) {
    alert(t('proposalModal.loginRequired'));
    return;
  }
  document.getElementById('bz-prop-request-id').value = requestId;
  document.getElementById('bz-prop-modal-title').textContent = t('proposalModal.subtitlePrefix') + placeName;
  document.getElementById('bz-prop-modal-sub').textContent = t('proposalModal.dataNote');
  document.getElementById('bz-proposal-form')?.reset();
  const msg = document.getElementById('bz-prop-msg');
  if (msg) msg.style.display = 'none';
  const modal = document.getElementById('bz-proposal-modal');
  if (modal) modal.classList.add('open');
}

function closeBzProposalModal() {
  const modal = document.getElementById('bz-proposal-modal');
  if (modal) modal.classList.remove('open');
}

/* إرسال العرض */
async function submitBzProposal(e) {
  e.preventDefault();
  if (!currentUser) { alert(t('proposalModal.loginRequired')); return; }

  const btn = document.getElementById('bz-prop-btn');
  const msg = document.getElementById('bz-prop-msg');
  const get = id => document.getElementById(id)?.value?.trim() || '';

  btn.disabled = true;
  btn.textContent = t('proposalModal.submitting');
  if (msg) msg.style.display = 'none';

  try {
    const { error } = await sbClient.rpc('submit_bazaar_proposal', {
      p_request_id:                get('bz-prop-request-id'),
      p_organizer_phone:           get('bz-prop-phone'),
      p_concept_description:       get('bz-prop-concept')    || null,
      p_proposed_rent:             parseFloat(document.getElementById('bz-prop-rent')?.value) || null,
      p_proposed_start:            get('bz-prop-start')       || null,
      p_proposed_end:              get('bz-prop-end')         || null,
      p_proposed_exhibitors_count: parseInt(document.getElementById('bz-prop-exhibitors')?.value) || null,
      p_notes:                     get('bz-prop-notes')       || null,
    });

    if (error) throw error;

    if (msg) {
      msg.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:rgba(34,197,94,.10);border:1px solid rgba(34,197,94,.3);border-radius:10px;font-size:13px;color:#166534';
      msg.innerHTML     = `<span style="font-size:18px;flex-shrink:0">✅</span><div><strong>${t('proposalModal.successTitle')}</strong><br>${t('proposalModal.successBody')}</div>`;
    }

    setTimeout(() => { closeBzProposalModal(); bzLoadOpportunities(); }, 2200);

  } catch (err) {
    if (msg) {
      msg.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;font-size:13px;color:#991b1b';
      msg.innerHTML     = `<span style="font-size:18px;flex-shrink:0">❌</span><div><strong>${t('proposalModal.errorTitle')}</strong><br>${_bzEsc(err.message || t('proposalModal.tryAgain'))}</div>`;
    }
  }

  btn.disabled    = false;
  btn.textContent = t('proposalModal.submitBtn');
}

/* ══════════════════════════════════════════════
   🚩 نظام الإبلاغ عن إساءة / محتوى مضلل
══════════════════════════════════════════════ */
function openReportAbuseDialog(bazaarId) {
  const existing = document.getElementById('abuse-report-modal');
  if (existing) existing.remove();

  const REASONS = [
    { val: 'fake_event',       lbl: t('abuseReport.reasons.fake_event') },
    { val: 'misleading_info',  lbl: t('abuseReport.reasons.misleading_info') },
    { val: 'fraud',            lbl: t('abuseReport.reasons.fraud') },
    { val: 'inappropriate',    lbl: t('abuseReport.reasons.inappropriate') },
    { val: 'other',            lbl: t('abuseReport.reasons.other') },
  ];

  const modal = document.createElement('div');
  modal.id = 'abuse-report-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);padding:20px';
  modal.innerHTML = `
    <div style="background:var(--surface,#fff);border-radius:20px;border:1px solid var(--border,#e5e7eb);max-width:420px;width:100%;box-shadow:0 24px 64px rgba(0,0,0,.22);overflow:hidden">
      <div style="padding:16px 22px;border-bottom:1px solid var(--border,#e5e7eb);display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:900;color:var(--dark,#111);font-family:'Cairo',sans-serif">${t('abuseReport.title')}</div>
        <button onclick="document.getElementById('abuse-report-modal').remove()" style="background:none;border:none;cursor:pointer;font-size:24px;color:var(--ink3,#9ca3af);font-family:'Cairo',sans-serif;line-height:1">×</button>
      </div>
      <div style="padding:18px 22px;display:flex;flex-direction:column;gap:12px">
        <div style="font-size:12.5px;color:var(--ink3,#6b7280);line-height:1.7;background:var(--surface2,#f9f9f7);border-radius:10px;padding:10px 12px">
          ${t('abuseReport.disclaimer')}
        </div>
        <div id="abuse-reasons" style="display:flex;flex-direction:column;gap:6px">
          ${REASONS.map(r => `
            <label id="ar-lbl-${r.val}" style="display:flex;align-items:center;gap:9px;padding:9px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;font-family:'Cairo',sans-serif;transition:border-color .15s"
              onclick="document.querySelectorAll('#abuse-reasons label').forEach(l=>l.style.borderColor='var(--border,#e5e7eb)');this.style.borderColor='#F47432';document.getElementById('ar-inp-${r.val}').checked=true">
              <input type="radio" id="ar-inp-${r.val}" name="abuse-reason" value="${r.val}" style="display:none"> ${r.lbl}
            </label>`).join('')}
        </div>
        <textarea id="abuse-note" rows="2" placeholder="${t('abuseReport.notePlaceholder')}" maxlength="300"
          style="padding:9px 12px;border:1.5px solid var(--border,#e5e7eb);border-radius:10px;font-family:'Cairo',sans-serif;font-size:13px;resize:vertical;width:100%;box-sizing:border-box;background:var(--surface2,#f9f9f7)"></textarea>
        <div id="abuse-msg" style="display:none;font-size:12.5px;padding:9px 12px;border-radius:10px;font-family:'Cairo',sans-serif"></div>
        <div style="display:flex;justify-content:flex-end;gap:8px;padding-top:4px">
          <button onclick="document.getElementById('abuse-report-modal').remove()"
            style="padding:9px 20px;border-radius:50px;background:var(--surface2,#f9f9f7);border:1.5px solid var(--border,#e5e7eb);font-family:'Cairo',sans-serif;font-size:13px;cursor:pointer;font-weight:700">${t('abuseReport.cancel')}</button>
          <button onclick="submitAbuseReport('${bazaarId}')" id="abuse-submit-btn"
            style="padding:9px 24px;border-radius:50px;background:linear-gradient(180deg,#F47432,#F36418);color:#fff;border:none;font-family:'Cairo',sans-serif;font-size:13px;font-weight:800;cursor:pointer">${t('abuseReport.submit')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function submitAbuseReport(bazaarId) {
  const reason = document.querySelector('input[name="abuse-reason"]:checked')?.value;
  const msg    = document.getElementById('abuse-msg');
  const btn    = document.getElementById('abuse-submit-btn');

  const showMsg = (text, isErr) => {
    if (!msg) return;
    msg.style.display = 'block';
    msg.style.cssText += isErr
      ? ';background:#fef2f2;color:#dc2626;border:1px solid #fecaca'
      : ';background:#ecfdf5;color:#047857;border:1px solid #6ee7b7';
    msg.textContent = text;
  };

  if (!reason) { showMsg(t('abuseReport.reasonRequired'), true); return; }
  if (!sbClient) { showMsg(t('abuseReport.loginRequired'), true); return; }

  const note = document.getElementById('abuse-note')?.value.trim() || null;
  if (btn) { btn.disabled = true; btn.textContent = t('abuseReport.submitting'); }

  const { data, error } = await sbClient.rpc('report_bazaar_abuse', {
    p_bazaar_id: bazaarId,
    p_reason:    reason,
    p_note:      note,
  });

  if (btn) { btn.disabled = false; btn.textContent = t('abuseReport.submit'); }

  if (error || !data?.ok) {
    const errMsgs = {
      already_reported:   t('abuseReport.errors.already_reported'),
      not_authenticated:  t('abuseReport.errors.not_authenticated'),
      bazaar_not_found:   t('abuseReport.errors.bazaar_not_found'),
    };
    showMsg(errMsgs[data?.error || ''] || t('abuseReport.errors.generic'), true);
    return;
  }

  showMsg(t('abuseReport.successMsg'), false);
  setTimeout(() => document.getElementById('abuse-report-modal')?.remove(), 2800);
}

/* escape helper محلي للصفحة */
function _bzEsc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

