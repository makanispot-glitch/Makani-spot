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

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';


/* ================================================================
   🗄️ القسم 2: المتغيرات العامة
   ================================================================ */

let sbClient       = null;     // كائن Supabase
let currentUser    = null;     // بيانات المستخدم المسجّل
let currentProfile = null;     // بيانات الـ profile

let BAZAARS        = [];       // قائمة البازارات المحمّلة
let bzFiltered     = [];       // البازارات بعد تطبيق الفلاتر
let currentBazaar  = null;     // البازار المعروض في صفحة التفاصيل
let bzPage         = 1;        // رقم الصفحة الحالية
const BZ_PER_PAGE  = 9;        // عدد البازارات في كل صفحة
let selectedSlotId = null;     // id المكان المختار في الخريطة
let bzActiveChip   = '';       // الـ chip المفعّل
let bzTimeNav      = 'all'; // التنقل الزمني: 'all' | 'today' | 'upcoming'
let bzVerifiedOnly = false;    // فلتر "منظمين موثّقين فقط"


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

  // التنقل عبر URL parameter: /bazaars/?detail=ID
  const urlParams = new URLSearchParams(window.location.search);
  const bazaarId  = urlParams.get('bazaar');
  if (bazaarId) {
    await openBazaarDetail(bazaarId);
  }
});


/* ================================================================
   🔐 القسم 4: المصادقة
   ================================================================ */

async function bzInitAuth() {
  if (!sbClient) return;
  try {
    const { data: { session } } = await sbClient.auth.getSession();
    currentUser = session?.user || null;
    if (currentUser) await _loadBzProfile();
    bzRenderNavUser();

    sbClient.auth.onAuthStateChange(async (_e, sess) => {
      currentUser = sess?.user || null;
      currentProfile = null;
      if (currentUser) await _loadBzProfile();
      bzRenderNavUser();
    });
  } catch (e) {
    console.warn('تعذّر تهيئة المصادقة:', e.message);
  }
}

async function _loadBzProfile() {
  if (!sbClient || !currentUser) return;
  try {
    const [profRes, orgRes] = await Promise.all([
      sbClient.from('profiles').select('full_name, phone').eq('id', currentUser.id).single(),
      sbClient.from('organizer_profiles').select('avatar_url, logo, image, is_verified').eq('user_id', currentUser.id).single()
    ]);
    currentProfile = {
      ...(profRes.data || {}),
      avatar_url:  orgRes.data?.avatar_url || orgRes.data?.logo || orgRes.data?.image || '',
      is_verified: orgRes.data?.is_verified === true,
    };
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

        ${currentProfile?.is_verified ? `
        <a class="bz-org-pill" href="/bazaars/organize.html">
          <span class="bz-org-ico">🎪</span>
          <span class="bz-org-texts">
            <span class="bz-org-title">نظّم بازار</span>
            <span class="bz-org-sub">زوّد دخلك الآن</span>
          </span>
        </a>` : ''}

        <div class="nav-avatar-btn" id="bz-avatar-btn" onclick="bzToggleAccountMenu(event)">
          <div class="nav-avatar-circle">${avatarHtml}</div>
          <div class="nav-avatar-info">
            <div class="nav-avatar-name">${name || 'حسابي'}</div>
            <div class="nav-avatar-email">${email}</div>
          </div>
          <div class="nav-avatar-caret">▼</div>

          <div class="nav-dropdown" id="bz-dropdown">
            <div class="nav-dropdown-header">
              <div class="nav-dropdown-name">${name || 'حسابي'}</div>
              <div class="nav-dropdown-email">${email}</div>
              <div class="nav-dropdown-role">🎪 مستخدم البازارات</div>
            </div>
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/profile.html'">👤 الملف الشخصي</button>
            <button class="nav-dropdown-item" onclick="window.location.href='/?p=dashboard'">🏠 لوحة التحكم</button>
            <button class="nav-dropdown-item" onclick="window.location.href='/market/'">📋 إعلاناتي</button>
            <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/'">🎟 اشترك في بزار</button>
            <button class="nav-dropdown-item" onclick="window.location.href='/?p=market'">🔍 دور على مساحة</button>
            <div class="nav-dropdown-sep"></div>
            <button class="nav-dropdown-item danger" onclick="bzSignOut()">🚪 تسجيل الخروج</button>
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
        <span>دخول</span>
        <span class="btn-login-sep">|</span>
        <span>سجّل</span>
      </button>`;
  }
  bzUpdateBnUser();
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


/* ================================================================
   📥 القسم 7: تحميل البازارات من Supabase
   ================================================================ */

async function loadBazaars() {
  try {
    if (!sbClient) {
      _renderBazaarsEmpty('تعذّر الاتصال بقاعدة البيانات');
      return;
    }

    const { data, error } = await sbClient
      .from('bazaars')
      .select('*')
      .eq('status', 'published')
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
      is_organizer_verified: b.is_organizer_verified || false,
      venue_address:        b.venue_address || b.address || '',
      maps_link:            b.maps_link || '',
      sketch_url:           _toDirectImgUrl(b.sketch_url || ''),
      event_image_url:      _toDirectImgUrl(b.event_image_url || ''),
      status:               b.status || 'published',
    }));

    console.log(`✅ تم تحميل ${BAZAARS.length} بازار من Supabase`);
    applyBzFilters();

  } catch (err) {
    console.error('❌ خطأ في تحميل البازارات:', err.message);
    _renderBazaarsEmpty('تعذّر تحميل البازارات — حاول مرة أخرى');
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
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:8px">لا توجد بازارات حالياً</div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:10px">تابعنا للاطلاع على البازارات القادمة!</div>
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
    monthStr = d.toLocaleDateString('ar-EG', { month: 'short' });
    dateLabel = d.toLocaleDateString('ar-EG', { weekday:'short', month:'long', day:'numeric' });
  }
  if (b.date_end && b.date_end !== b.date_start) {
    endLabel = ' ← ' + new Date(b.date_end).toLocaleDateString('ar-EG', { month:'short', day:'numeric' });
  }

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
  const orgSubText  = orgVerified ? '⭐ منظّم موثّق' : 'منظّم البازار';

  const orgProfileHref = b.organizer_id
    ? `/bazaars/profile.html?organizer=${b.organizer_id}`
    : null;

  const orgHtml = orgName ? `
  <div class="bz-card-organizer" ${orgProfileHref ? `style="cursor:pointer" onclick="event.stopPropagation();window.location.href='${orgProfileHref}'"` : ''}>
    <div class="bz-org-avatar">${orgInitial}</div>
    <div class="bz-org-info">
      <div class="bz-org-name">🎪 ${orgName}</div>
      <div class="bz-org-sub">${orgSubText}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-right:auto">
      ${orgVerified ? `<span class="bz-verified-badge">✓ موثّق</span>` : ''}
      ${orgProfileHref ? `<span style="font-size:10px;color:var(--orange);opacity:.8">←</span>` : ''}
    </div>
  </div>` : '';

  /* ── HTML ── */
  return `
  <div class="bz-card${isSoldOut ? ' soldout-card' : ''}" onclick="openBazaarDetail('${b.id}')">

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
      ${isSoldOut ? '<div class="bz-soldout-badge">مكتمل</div>' : ''}
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
        : '<div class="bz-card-desc" style="color:var(--ink3);font-style:italic">لا يوجد وصف</div>'}

      <!-- المنظّم -->
      ${orgHtml}

      <!-- الذيل: السعر + الأماكن + زر -->
      <div class="bz-card-footer">
        <div>
          <div class="bz-price-tag">${Number(b.price_per_slot || 0).toLocaleString('ar-EG')} ج / مكان</div>
          <div class="bz-slots-tag${isSoldOut ? ' sold-out' : ''}">
            ${isSoldOut ? '🔴 لا أماكن متاحة' : `🟢 ${availSlots} مكان متاح`}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="share-btn-inline"
                  onclick="event.stopPropagation();shareCard('${b.id}','${(b.name||'').replace(/'/g,"\\'")}');"
                  title="مشاركة البازار">
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
            التفاصيل ←
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

  if (countEl) countEl.textContent = bzFiltered.length + ' بازار';

  const start    = (bzPage - 1) * BZ_PER_PAGE;
  const pageData = bzFiltered.slice(start, start + BZ_PER_PAGE);

  if (!pageData.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
        <div style="font-size:52px;margin-bottom:14px">🎪</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--ink2)">لا توجد بازارات بالمعايير دي</div>
        <div style="font-size:13px;color:var(--ink3);margin-bottom:18px">جرب تغيير الفلاتر</div>
        <button class="btn btn-primary" onclick="clearBzFilters()">مسح الفلاتر</button>
      </div>`;
    renderBzPagination();
    return;
  }

  grid.innerHTML = pageData.map(b => buildBazaarCard(b)).join('');
  renderBzPagination();
}

function renderBzPagination() {
  const cont = document.getElementById('bz-pagination');
  if (!cont) return;

  const totalPages = Math.ceil(bzFiltered.length / BZ_PER_PAGE);
  if (totalPages <= 1) { cont.innerHTML = ''; return; }

  let html = '';
  if (bzPage > 1) html += `<button class="pg-btn" onclick="bzGoPage(${bzPage - 1})">السابق</button>`;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - bzPage) <= 2) {
      html += `<button class="pg-btn${i === bzPage ? ' on' : ''}" onclick="bzGoPage(${i})">${i}</button>`;
    } else if (Math.abs(i - bzPage) === 3) {
      html += `<span class="pg-dots">…</span>`;
    }
  }
  if (bzPage < totalPages) html += `<button class="pg-btn" onclick="bzGoPage(${bzPage + 1})">التالي</button>`;
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
    const today = new Date().toISOString().split('T')[0];
    data = data.filter(b => b.date_start && (b.date_start === today ||
      (b.date_start <= today && (!b.date_end || b.date_end >= today))));
  } else if (bzTimeNav === 'upcoming') {
    const today = new Date().toISOString().split('T')[0];
    data = data.filter(b => !b.date_start || b.date_start >= today);
  }
  // bzTimeNav === 'all' → لا فلتر زمني، اعرض كل شيء

  if (bzVerifiedOnly) {
    data = data.filter(b => b.is_organizer_verified === true);
  }

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

  bzFiltered = data;
  bzPage     = 1;
  renderBazaarCards();
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
  bzVerifiedOnly = false;
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
  if (lb) lb.textContent = val >= max ? 'بلا حد' : Number(val).toLocaleString('ar-EG') + ' ج';
}

function setBzChip(chip, el) {
  const wasActive = bzActiveChip === chip;
  bzActiveChip = wasActive ? '' : chip;
  document.querySelectorAll('.bz-chip').forEach(c => c.classList.remove('active'));
  if (!wasActive && el) el.classList.add('active');
  applyBzFilters();
}

function setBzVerifiedFilter(el) {
  bzVerifiedOnly = !bzVerifiedOnly;
  document.querySelectorAll('.bz-chip').forEach(c => c.classList.remove('active'));
  if (bzVerifiedOnly && el) el.classList.add('active');
  applyBzFilters();
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
    ? new Date(b.date_start).toLocaleDateString('ar-EG', { month:'long', day:'numeric' })
    : '';

  const headerEl = document.getElementById('bzd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeBazaarDetail()">→ العودة للبازارات</button>
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
          سجّل دخولك لعرض التفاصيل
        </h2>
        <p style="font-size:14px;color:var(--ink3);line-height:1.9;margin-bottom:28px;font-family:'IBM Plex Sans Arabic',sans-serif">
          سجّل دخولك لمعرفة المزيد من تفاصيل البازار والحجز
        </p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" style="padding:13px 32px;font-size:15px"
                  onclick="window.location.href='/?p=login'">
            تسجيل الدخول ←
          </button>
          <button class="btn" style="padding:13px 22px;font-size:14px"
                  onclick="closeBazaarDetail()">
            العودة للبازارات
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

async function openBazaarDetail(bazaarId) {
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
    ? new Date(b.date_start).toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  const endStr = b.date_end && b.date_end !== b.date_start
    ? ' — ' + new Date(b.date_end).toLocaleDateString('ar-EG', { month:'long', day:'numeric' })
    : '';
  const timeRange = b.time_start
    ? `🕐 ${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}`
    : '';

  const headerEl = document.getElementById('bzd-header');
  if (headerEl) {
    headerEl.innerHTML = `
      <div class="sd-header-inner">
        <div class="sd-back-row">
          <button class="sd-back-btn" onclick="closeBazaarDetail()">→ العودة للبازارات</button>
          <div class="sd-breadcrumb">
            <span onclick="window.location.href='/'" style="cursor:pointer">الرئيسية</span>
            <span class="sd-bc-sep">·</span>
            <span onclick="closeBazaarDetail()" style="cursor:pointer">البازارات</span>
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
            <div class="sd-price-val">${Number(b.price_per_slot || 0).toLocaleString('ar-EG')} ج</div>
            <div class="sd-price-lbl">/ مكان واحد</div>
          </div>
        </div>
        <div class="bz-detail-nav">
          ${prevB
            ? `<button class="bz-detail-nav-btn" onclick="openBazaarDetail('${prevB.id}')">← ${prevB.name}</button>`
            : '<span></span>'}
          <span class="bz-detail-nav-count">${idx + 1} / ${allList.length}</span>
          ${nextB
            ? `<button class="bz-detail-nav-btn" onclick="openBazaarDetail('${nextB.id}')">${nextB.name} →</button>`
            : '<span></span>'}
        </div>
      </div>`;
  }

  _renderBazaarInfo(b);

  const slotmapEl = document.getElementById('bzd-slotmap');
  if (slotmapEl) {
    slotmapEl.innerHTML = `
      <div class="sd-subspaces-header">
        <h2 class="sd-section-title">🗺️ خريطة الأماكن</h2>
      </div>
      <div style="text-align:center;padding:50px 20px;color:var(--ink3)">
        <div style="font-size:36px;margin-bottom:12px;display:inline-block;animation:spin 1s linear infinite">⏳</div>
        <div style="font-size:14px">جاري تحميل خريطة الأماكن…</div>
      </div>`;
  }

  const panel = document.getElementById('bzd-booking-panel');
  if (panel) panel.style.display = 'none';

  showBzPage('bazaar-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (!sbClient) {
    if (slotmapEl) slotmapEl.innerHTML = _renderSlotMapFallback();
    return;
  }

  try {
    const { data: slots, error } = await sbClient
      .from('bazaar_slots')
      .select('*')
      .eq('bazaar_id', bazaarId)
      .order('row_label', { ascending: true });

    if (error || !slots?.length) {
      if (slotmapEl) slotmapEl.innerHTML = _renderSlotMapFallback();
    } else {
      renderSlotMap(slots);
    }
  } catch (err) {
    if (slotmapEl) slotmapEl.innerHTML = _renderSlotMapFallback();
  }
}

function _renderBazaarInfo(b) {
  const infoEl = document.getElementById('bzd-info');
  if (!infoEl) return;

  const dateStr = b.date_start
    ? new Date(b.date_start).toLocaleDateString('ar-EG', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  const endStr = b.date_end && b.date_end !== b.date_start
    ? new Date(b.date_end).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })
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

  infoEl.innerHTML = `
    ${imgHtml}
    <div class="sd-info-grid">

      ${b.description ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">📝 عن هذا البازار</div>
        <p class="sd-description">${b.description}</p>
      </div>` : ''}

      <div class="sd-info-card">
        <div class="sd-info-title">📅 تفاصيل الحدث</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
          <div class="sd-extra-row"><span>تاريخ البدء</span><span style="font-weight:700">${dateStr}</span></div>
          ${endStr ? `<div class="sd-extra-row"><span>تاريخ الانتهاء</span><span style="font-weight:700">${endStr}</span></div>` : ''}
          ${b.time_start ? `<div class="sd-extra-row"><span>⏰ الوقت</span><span>${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}</span></div>` : ''}
          ${b.category   ? `<div class="sd-extra-row"><span>🏷 الفئة</span><span class="bz-detail-cat-badge" style="font-size:11px">${b.category}</span></div>` : ''}
          ${b.organizer  ? `
          <div class="sd-extra-row" ${b.organizer_id ? `style="cursor:pointer" onclick="openOrganizerProfile('${b.organizer_id}')"` : ''}>
            <span>🧑‍💼 المنظم</span>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="font-weight:700">${b.organizer}</span>
              ${b.is_organizer_verified
                ? `<span class="bz-verified-badge">✓ موثّق</span>`
                : `<span style="font-size:10px;color:var(--ink3);background:var(--surface2);border-radius:50px;padding:2px 7px;">لم يتم التحقق بعد</span>`}
              ${b.organizer_id ? `<span style="font-size:11px;color:var(--orange);font-weight:700">← عرض الصفحة</span>` : ''}
            </div>
          </div>` : ''}
        </div>
      </div>

      <div class="sd-info-card">
        <div class="sd-info-title">💰 التسعير والأماكن</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:9px">
          <div class="sd-extra-row">
            <span>سعر المكان الواحد</span>
            <strong style="color:var(--orange);font-size:16px">${Number(b.price_per_slot || 0).toLocaleString('ar-EG')} ج</strong>
          </div>
          ${b.total_slots ? `<div class="sd-extra-row"><span>إجمالي الأماكن</span><span>${b.total_slots} مكان</span></div>` : ''}
          <div class="sd-extra-row">
            <span>الأماكن المتاحة</span>
            <span style="color:${isSoldOut ? 'var(--red)' : 'var(--green)'};font-weight:800">
              ${isSoldOut ? '🔴 مكتمل' : `🟢 ${availSlots} مكان`}
            </span>
          </div>
        </div>
      </div>

      ${(b.venue_address || b.location) ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">📍 الموقع والعنوان</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
          <div class="sd-extra-row">
            <span>اسم المكان</span>
            <span style="font-weight:700">${b.location || '—'}</span>
          </div>
          ${b.venue_address ? `<div class="sd-extra-row"><span>العنوان</span><span>${b.venue_address}</span></div>` : ''}
          ${b.region ? `<div class="sd-extra-row"><span>المنطقة</span><span>${b.region}</span></div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px">
            ${mapsHref ? `
            <a href="${mapsHref}" target="_blank" rel="noopener"
               class="bz-maps-btn">
              🗺️ فتح في Google Maps
            </a>` : ''}
            ${b.sketch_url ? `
            <button onclick="openBazaarMap('sketch')"
                    class="bz-maps-btn" style="background:rgba(99,102,241,0.10);border-color:rgba(99,102,241,0.30);color:#6366f1;cursor:pointer">
              🗺️ خريطة / اسكتش البازار
            </button>` : ''}
            ${b.event_image_url ? `
            <button onclick="openBazaarMap('photo')"
                    class="bz-maps-btn" style="background:rgba(16,185,129,0.10);border-color:rgba(16,185,129,0.28);color:#059669;cursor:pointer">
              📸 صورة واقعية للمكان
            </button>` : ''}
          </div>
        </div>
      </div>` : ''}

      ${(!b.venue_address && !b.location && (b.sketch_url || b.event_image_url)) ? `
      <div class="sd-info-card sd-info-full">
        <div class="sd-info-title">🖼️ خريطة وصور البازار</div>
        <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:10px">
          ${b.sketch_url ? `
          <button onclick="openBazaarMap('sketch')"
                  class="bz-maps-btn" style="background:rgba(99,102,241,0.10);border-color:rgba(99,102,241,0.30);color:#6366f1;cursor:pointer">
            🗺️ خريطة / اسكتش البازار
          </button>` : ''}
          ${b.event_image_url ? `
          <button onclick="openBazaarMap('photo')"
                  class="bz-maps-btn" style="background:rgba(16,185,129,0.10);border-color:rgba(16,185,129,0.28);color:#059669;cursor:pointer">
            📸 صورة واقعية للمكان
          </button>` : ''}
        </div>
      </div>` : ''}

    </div>

    <!-- ═══ مربع المنظّم ═══ -->
    <div id="bzd-organizer-card" style="margin-top:16px"></div>`;

  /* تحميل بيانات المنظّم من Supabase */
  if (b.organizer_id && sbClient) {
    _loadOrganizerCard(b.organizer_id, b.organizer);
  } else if (b.organizer) {
    _renderOrganizerCardBasic(b.organizer, b.is_organizer_verified);
  }
}

function closeBazaarDetail() {
  currentBazaar  = null;
  selectedSlotId = null;
  showBzPage('bazaars');
}

function openBazaarMap(type) {
  if (!currentBazaar) return;
  const url   = type === 'sketch' ? currentBazaar.sketch_url : currentBazaar.event_image_url;
  const name  = currentBazaar.name || 'البازار';
  const title = type === 'sketch'
    ? '🗺️ خريطة البازار — ' + name
    : '📸 صورة المكان — ' + name;
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
           onerror="this.outerHTML='<div style=&quot;color:white;text-align:center;padding:40px;font-family:Cairo,sans-serif&quot;>⚠️ تعذّر تحميل الصورة</div>'">
      <div style="text-align:center">
        <a href="${url}" target="_blank" rel="noopener"
           style="color:rgba(255,255,255,0.65);font-size:12px;font-family:'Cairo',sans-serif;text-decoration:none">
          فتح في تبويب جديد ↗
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

async function _loadOrganizerCard(userId, fallbackName) {
  const el = document.getElementById('bzd-organizer-card');
  if (!el) return;
  el.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink3);font-size:13px">⏳ جاري تحميل بيانات المنظّم…</div>`;

  try {
    const [orgRes, reviewsRes, bazaarsRes] = await Promise.all([
      sbClient.from('organizer_profiles').select('*').eq('user_id', userId).single(),
      sbClient.from('organizer_reviews').select('rating, comment, reviewer_name, created_at').eq('organizer_id', userId).order('created_at', { ascending: false }).limit(3),
      sbClient.from('bazaars').select('id, status').eq('organizer_id', userId),
    ]);

    const org      = orgRes.data;
    const reviews  = reviewsRes.data || [];
    const bazaars  = bazaarsRes.data || [];
    const name     = org?.name || fallbackName || 'منظّم البازار';

    if (!org) { _renderOrganizerCardBasic(fallbackName, false); return; }

    /* إحصائيات */
    const totalBazaars    = bazaars.length;
    const activeBazaars   = bazaars.filter(bz => ['published','approved','active'].includes(String(bz.status||'').toLowerCase())).length;
    const avgRating       = reviews.length
      ? (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(1)
      : null;
    const joinDate = org.created_at
      ? new Date(org.created_at).toLocaleDateString('ar-EG', { year:'numeric', month:'long' })
      : null;

    /* الصورة */
    const avatarUrl  = org.avatar_url || org.logo || org.image || '';
    const avatarHtml = avatarUrl
      ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="${name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.textContent='${name[0]||'م'}';">`
      : (name[0] || 'م').toUpperCase();

    /* التقييمات */
    const starsHtml = avgRating
      ? `${'★'.repeat(Math.round(Number(avgRating)))}${'☆'.repeat(5 - Math.round(Number(avgRating)))}`
      : '';

    const reviewsHtml = reviews.length ? `
      <div style="margin-top:14px">
        <div style="font-size:12px;font-weight:700;color:var(--ink2);margin-bottom:8px">آراء العملاء (${reviews.length})</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${reviews.map(r => `
          <div style="background:var(--surface2);border-radius:10px;padding:10px 12px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span style="font-size:12px;font-weight:700">${r.reviewer_name || 'مجهول'}</span>
              <span style="color:var(--orange);font-size:12px">${'★'.repeat(Number(r.rating)||0)}</span>
            </div>
            ${r.comment ? `<div style="font-size:12px;color:var(--ink2);line-height:1.6">${r.comment}</div>` : ''}
          </div>`).join('')}
        </div>
      </div>` : '';

    el.innerHTML = `
    <div style="background:var(--surface);border:1.5px solid var(--border);border-radius:16px;overflow:hidden">
      <!-- رأس المربع -->
      <div style="background:linear-gradient(135deg,rgba(243,100,24,.10),rgba(243,100,24,.03));
                  padding:16px 20px;border-bottom:1px solid var(--border);
                  display:flex;align-items:center;gap:14px">
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
            <div style="font-size:16px;font-weight:900;color:var(--dark)">${name}</div>
            ${org.is_verified ? `<span class="bz-verified-badge">✓ منظّم موثّق</span>` : ''}
          </div>
          ${avgRating ? `
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">
            <span style="color:var(--orange);font-size:14px">${starsHtml}</span>
            <span style="font-size:13px;font-weight:800;color:var(--orange)">${avgRating}</span>
            <span style="font-size:11px;color:var(--ink3)">(${reviews.length} تقييم)</span>
          </div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:2px;
                    background:var(--surface2);border-radius:12px;padding:10px 16px;flex-shrink:0">
          <div style="font-size:22px;font-weight:900;color:var(--orange);font-family:'Cairo',sans-serif">${totalBazaars}</div>
          <div style="font-size:10px;color:var(--ink3);font-weight:600">بازار منظّم</div>
        </div>
      </div>
      <!-- تفاصيل -->
      <div style="padding:14px 20px">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px">
          ${activeBazaars ? `
          <div style="background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.2);
                      border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:18px;font-weight:900;color:#22C55E">${activeBazaars}</div>
            <div style="font-size:10px;color:var(--ink3)">بازار نشط</div>
          </div>` : ''}
          ${avgRating ? `
          <div style="background:rgba(243,100,24,.08);border:1px solid rgba(243,100,24,.2);
                      border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:18px;font-weight:900;color:var(--orange)">${avgRating}⭐</div>
            <div style="font-size:10px;color:var(--ink3)">متوسط التقييم</div>
          </div>` : ''}
          ${joinDate ? `
          <div style="background:var(--surface2);border:1px solid var(--border);
                      border-radius:10px;padding:10px;text-align:center">
            <div style="font-size:12px;font-weight:800;color:var(--ink2)">${joinDate}</div>
            <div style="font-size:10px;color:var(--ink3)">تاريخ الانضمام</div>
          </div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap">
          ${org.whatsapp ? `
          <a href="https://wa.me/${org.whatsapp.replace(/\D/g,'')}" target="_blank"
             style="display:inline-flex;align-items:center;gap:5px;
                    background:rgba(34,197,94,.12);color:#22C55E;
                    border:1px solid rgba(34,197,94,.3);border-radius:8px;
                    padding:6px 14px;font-size:12px;font-weight:700;text-decoration:none"
             onclick="event.stopPropagation()">
            💬 واتساب
          </a>` : ''}
          <a href="/bazaars/profile.html?organizer=${userId}"
             style="display:inline-flex;align-items:center;gap:5px;
                    background:rgba(243,100,24,.10);color:var(--orange);
                    border:1px solid rgba(243,100,24,.28);border-radius:8px;
                    padding:6px 14px;font-size:12px;font-weight:700;text-decoration:none"
             onclick="event.stopPropagation()">
            👤 صفحة المنظّم ←
          </a>
        </div>
        ${reviewsHtml}
      </div>
    </div>`;

  } catch (err) {
    console.warn('تعذّر تحميل بيانات المنظّم:', err.message);
    _renderOrganizerCardBasic(fallbackName, false);
  }
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
      <div style="font-size:11px;color:var(--ink3);margin-top:2px">منظّم البازار</div>
    </div>
    ${isVerified ? `<span class="bz-verified-badge">✓ موثّق</span>` : ''}
  </div>`;
}


function _renderSlotMapFallback() {
  return `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">🗺️ خريطة الأماكن</h2>
    </div>
    <div style="text-align:center;padding:40px 24px;
                background:var(--surface);border-radius:var(--radius-lg);
                border:1.5px dashed var(--border)">
      <div style="font-size:52px;margin-bottom:14px">🎪</div>
      <div style="font-size:15px;font-weight:700;color:var(--ink2);margin-bottom:6px">
        خريطة الأماكن مش متاحة حالياً
      </div>
      <div style="font-size:13px;color:var(--ink3);margin-bottom:20px;max-width:360px;margin-inline:auto">
        تواصل معنا مباشرة على واتساب لمعرفة الأماكن المتبقية وإتمام الحجز
      </div>
      <a href="https://wa.me/201103467711" target="_blank" rel="noopener"
         style="display:inline-flex;align-items:center;gap:8px;background:#25D366;
                color:#fff;padding:12px 26px;border-radius:var(--radius-lg);
                font-weight:800;text-decoration:none;font-family:'Cairo',sans-serif;
                box-shadow:0 4px 16px rgba(37,211,102,0.35)">
        واتساب — استفسر عن مكان
      </a>
    </div>`;
}


/* ================================================================
   🪑 القسم 12: خريطة الأماكن البصرية
   ================================================================ */

function renderSlotMap(slots) {
  const el = document.getElementById('bzd-slotmap');
  if (!el) return;

  const availCount    = slots.filter(s => s.status === 'available').length;
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
          ? _buildSlotHtml(slot, slotIdx++)
          : `<div class="bz-slot bz-slot-empty"></div>`;
      }
    }
    gridHtml += '</div>';
  } else {
    gridHtml = '<div class="bz-slot-grid">' +
      slots.map((s, i) => _buildSlotHtml(s, i)).join('') +
      '</div>';
  }

  el.innerHTML = `
    <div class="sd-subspaces-header">
      <h2 class="sd-section-title">🗺️ خريطة الأماكن</h2>
      <div class="sd-units-summary">
        <span class="sd-units-avail">${availCount} متاح</span>
        ${bookedCount   > 0 ? `<span class="sd-units-rented">${bookedCount} محجوز</span>` : ''}
        ${featuredCount > 0 ? `<span class="sd-units-avail" style="color:#c47800;border-color:rgba(245,200,66,.35);background:rgba(250,200,30,.1)">⭐ ${featuredCount} مميز</span>` : ''}
      </div>
    </div>

    <div class="bz-legend">
      <span class="bz-legend-item"><span class="bz-legend-dot available"></span> متاح — اضغط للحجز</span>
      <span class="bz-legend-item"><span class="bz-legend-dot booked"></span> محجوز</span>
      <span class="bz-legend-item"><span class="bz-legend-dot selected"></span> مختارك</span>
      ${featuredCount > 0 ? `<span class="bz-legend-item"><span class="bz-legend-dot featured"></span> مكان مميز ⭐</span>` : ''}
    </div>

    <div class="bz-slotmap-scroll">${gridHtml}</div>

    <div style="font-size:12px;color:var(--ink3);text-align:center;margin-top:10px;padding-bottom:4px">
      اضغط على أي مكان متاح لاختياره وإتمام الحجز
    </div>`;
}

function _buildSlotHtml(slot, index = 0) {
  const isBooked    = slot.status === 'booked';
  const isAvailable = !isBooked;
  const isFeatured  = slot.is_featured == true || slot.is_featured === 'true'
                   || slot.is_featured === 1   || slot.is_featured === '1'
                   || slot.is_featured === 'yes';

  let cls = isBooked ? 'booked' : 'available';
  if (isFeatured) cls += ' featured';

  const displayLabel = (slot.row_label || '') + (slot.slot_number || '');

  const clickAttr = isAvailable
    ? `onclick="selectSlot('${slot.id}','${displayLabel || slot.id}')"`
    : '';

  const bookedLabel = isFeatured ? `محجوز (مميز ⭐)` : `محجوز`;
  const availLabel  = isFeatured ? `اضغط للحجز (مميز ⭐)` : `اضغط للحجز`;
  const titleAttr   = isBooked
    ? `title="مكان ${displayLabel} — ${bookedLabel}"`
    : `title="مكان ${displayLabel} — ${availLabel}"`;

  const delay       = Math.min(index * 0.028, 0.55).toFixed(3);
  const featuredTip = isFeatured
    ? `<span class="bz-featured-tooltip">⭐ مكان مميز</span>`
    : '';

  return `<div class="bz-slot ${cls}"
              data-slot-id="${slot.id}"
              data-featured="${isFeatured}"
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
    const price       = Number(currentBazaar.price_per_slot || 0).toLocaleString('ar-EG');
    const featuredTag = isFeatured ? ' ⭐ مميز' : '';
    slotInfoEl.textContent = `مكان رقم ${slotLabel}${featuredTag} · ${price} ج`;
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
  const notes    = document.getElementById('bzb-notes')?.value.trim();

  const errorEl = document.getElementById('bzb-error');
  const showBzbError = msg => {
    if (!errorEl) return;
    errorEl.textContent   = '⚠ ' + msg;
    errorEl.style.display = 'block';
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  if (errorEl) errorEl.style.display = 'none';

  if (!name)     { showBzbError('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    showBzbError('ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!business) { showBzbError('من فضلك اكتب اسم نشاطك أو مشروعك'); return; }
  if (!sbClient) {
    showBzbError('في مشكلة في الاتصال — حاول تاني'); return;
  }

  const submitBtn = document.querySelector('#bzd-booking-panel .btn-primary');
  if (submitBtn) {
    submitBtn.innerHTML  = '⏳ جاري الحجز…';
    submitBtn.disabled   = true;
    submitBtn.style.opacity = '0.7';
  }

  try {
    const now = new Date().toISOString();

    /* قفل الوحدة — نقرأ الصفوف المُحدَّثة للتحقق من عدم سبق الحجز */
    const { data: lockedRows, error: lockErr } = await sbClient
      .from('bazaar_slots')
      .update({ status: 'booked' })
      .eq('id', selectedSlotId)
      .eq('status', 'available')
      .select('id');

    if (lockErr) throw new Error('تعذّر حجز المكان: ' + lockErr.message);
    if (!lockedRows || lockedRows.length === 0) throw new Error('تعذّر حجز المكان');

    // حفظ الحجز
    const { error: bookingErr } = await sbClient
      .from('bazaar_bookings')
      .insert({
        bazaar_id:     String(currentBazaar.id),
        slot_id:       selectedSlotId,
        user_id:       currentUser.id.toString(),
        user_name:     name,
        user_phone:    phone,
        user_email:    email || null,
        business_name: business,
        notes:         notes || null,
        status:        'pending',
        created_at:    now,
      });

    if (bookingErr) throw new Error('تعذّر حفظ الحجز: ' + bookingErr.message);

    // تحديث available_slots في البازار
    await sbClient
      .from('bazaars')
      .update({ available_slots: Math.max(0, (currentBazaar.available_slots || 1) - 1) })
      .eq('id', String(currentBazaar.id));

    const bazaarBookingRecord = {
      bazaar_id: String(currentBazaar.id), slot_id: selectedSlotId,
      user_id: currentUser.id.toString(), user_name: name, user_phone: phone,
      user_email: email || null, business_name: business, notes: notes || null,
      status: 'pending', created_at: now,
    };
    _saveLocalBazaarBooking(currentUser.id, bazaarBookingRecord);

    const slotEl = document.querySelector(`.bz-slot[data-slot-id="${selectedSlotId}"]`);
    if (slotEl) {
      slotEl.classList.remove('selected', 'available');
      slotEl.classList.add('booked');
      slotEl.onclick = null;
      slotEl.title   = `مكان ${slotEl.textContent.trim()} — محجوز`;
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
          <div class="success-title" style="font-size:22px;margin-bottom:8px">تم الحجز بنجاح! 🎉</div>
          <div class="success-body" style="font-size:14px;line-height:1.9;margin-bottom:20px">
            شكراً <strong>${name}</strong>!<br>
            تم تأكيد حجزك في بازار <strong style="color:var(--orange)">${currentBazaar.name}</strong>.<br>
            هنتواصل معاك على <strong dir="ltr">${phone}</strong> بكل التفاصيل.
          </div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" style="padding:12px 28px"
                    onclick="closeBazaarDetail()">← كل البازارات</button>
            <a class="btn" href="/?p=dashboard" style="padding:12px 28px">حجوزاتي</a>
          </div>
        </div>`;
    }

  } catch (err) {
    if (submitBtn) {
      submitBtn.innerHTML  = 'تأكيد حجز المكان ←';
      submitBtn.disabled   = false;
      submitBtn.style.opacity = '1';
    }
    const msg = err.message.includes('تعذّر حجز')
      ? 'تم حجز هذا المكان للتو — اختار مكاناً آخر'
      : 'في مشكلة في الحجز — تأكد من الاتصال وحاول تاني';
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
   🔗 القسم 15: مشاركة البازار
   ================================================================ */

function shareCard(bazaarId, name) {
  const base      = window.location.origin + '/bazaars/';
  const url       = base + '?bazaar=' + bazaarId;
  const shareText = 'شوف البازار ده على مكاني Spot: ' + name;

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
    label.textContent = 'حسابي';
    if (desc) desc.textContent = currentProfile?.full_name?.split(' ')[0] || 'مرحباً';
  } else {
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:22px;height:22px;stroke:#9CA3AF"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`;
    label.textContent = 'دخول';
    if (desc) desc.textContent = 'سجّل أو ادخل';
  }
}

