/* ================================================================
   📁 bazaars/app.js — منطق صفحة البازارات المستقلة
   ================================================================
   هذا الملف مسؤول عن:
     - تحميل البازارات من Google Sheets / Supabase
     - الفلترة والبحث والترتيب
     - بناء كروت البازارات وعرضها
     - صفحة تفاصيل البازار + خريطة الأماكن البصرية
     - نظام حجز الأماكن (bazaar_slots + bazaar_bookings)
     - حالة المستخدم (تسجيل الدخول لإتمام الحجز)
   ================================================================ */


/* ================================================================
   ⚙️ القسم 1: الإعدادات والثوابت
   ================================================================ */

const BAZAAR_SHEET_URL = "https://script.google.com/macros/s/AKfycby3adz7kud__ds_rVxZHyzEr6DS5SfdcdT7hUblmKwl1yvbEtlL7NpnpaWrrh7PLpjQPQ/exec";

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
let selectedSlotSource = 'supabase'; // مصدر المكان: supabase | sheet
let bzActiveChip   = '';       // الـ chip المفعّل
let bzTimeNav      = 'upcoming'; // التنقل الزمني: 'today' | 'upcoming'
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
      sbClient.from('organizer_profiles').select('avatar_url, logo, image').eq('user_id', currentUser.id).single()
    ]);
    currentProfile = {
      ...(profRes.data || {}),
      avatar_url: orgRes.data?.avatar_url || orgRes.data?.logo || orgRes.data?.image || ''
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
          <button class="nav-dropdown-item" onclick="window.location.href='/?p=dashboard'">🏠 لوحة التحكم</button>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/profile.html'">👤 الملف الشخصي</button>
          <button class="nav-dropdown-item" onclick="window.location.href='/bazaars/verification.html'">🎪 نظّم بازار</button>
          <button class="nav-dropdown-item" onclick="window.location.href='/market/'">📋 إعلاناتي</button>
          <button class="nav-dropdown-item" onclick="window.location.href='/'">🔍 دوّر على مساحة</button>
          <div class="nav-dropdown-sep"></div>
          <button class="nav-dropdown-item danger" onclick="bzSignOut()">🚪 تسجيل الخروج</button>
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
    organizer:            get('organizer','المنظم','جهة التنظيم','Organizer')                  || '',
    organizer_id:         get('organizer_id','organizerId','organizer_user_id','معرف المنظم')  || null,
    is_organizer_verified:
      (() => {
        const v = get('is_organizer_verified','organizerVerified','organizer_verified','منظم موثّق');
        return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
      })(),
    venue_address:        get('venue_address','address','Address','عنوان المكان','العنوان','Venue') || '',
    status:               get('status','الحالة','Status')                                || 'published',
  };
}

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

function _bazaarApiUrl(params = {}) {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${BAZAAR_SHEET_URL}?${qs}` : BAZAAR_SHEET_URL;
}

function _normalizeBazaarSlot(row) {
  return {
    id: String(row.id || row.slotId || row.slot_id || ''),
    bazaar_id: row.bazaar_id || row.bazaarId || row.bazaarID || '',
    row: row.row || row.rowIndex || null,
    col: row.col || row.colIndex || null,
    row_label: row.rowLabel || row.row_label || '',
    slot_number: row.slot_number || row.slotNumber || row.number || row.id || row.slotId || '',
    price: Number(row.price || 0),
    status: row.status || 'available',
    source: 'sheet',
  };
}

async function _loadBazaarSlotsFromSheet(bazaarId) {
  const res = await fetch(_bazaarApiUrl({ action: 'slots', bazaarId }));
  const json = await res.json();
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(json.slots)
      ? json.slots
      : Array.isArray(json.data)
        ? json.data
        : [];

  return rows
    .map(_normalizeBazaarSlot)
    .filter(s => s.id && String(s.bazaar_id) === String(bazaarId));
}


/* ================================================================
   📥 القسم 7: تحميل البازارات من Google Sheets
   ================================================================ */

async function loadBazaars() {
  try {
    const res  = await fetch(BAZAAR_SHEET_URL);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error('❌ الشيت مش بيرجع JSON:', text.substring(0, 300));
      _renderBazaarsEmpty('تأكد أن الـ Apps Script منشور كـ "Anyone can access"');
      return;
    }

    console.log('📊 استجابة الشيت:', json);

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
      console.warn('⚠️ الشيت فارغ أو البيانات مش مكتشفة:', json);
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
      .filter(b => !b.status || ['published','approved','active','مقبول','موافق','منشور','تمت الموافقة'].includes(String(b.status).trim().toLowerCase()))
      .sort((a, b) => new Date(a.date_start || 0) - new Date(b.date_start || 0));

    console.log(`✅ تم تحميل ${rows.length} بازار:`, rows);

    BAZAARS = rows;
    applyBzFilters();

  } catch (err) {
    console.error('❌ خطأ في تحميل البازارات:', err.message);
    _loadBazaarsFromSupabase();
  }
}

async function _loadBazaarsFromSupabase() {
  if (!sbClient) { _renderBazaarsEmpty(); return; }
  try {
    const { data, error } = await sbClient
      .from('bazaars').select('*')
      .eq('status', 'published')
      .order('date_start', { ascending: true });
    if (!error && data?.length) {
      BAZAARS = data;
      applyBzFilters();
    } else {
      _renderBazaarsEmpty();
    }
  } catch (e) { _renderBazaarsEmpty(); }
}

function _renderBazaarsEmpty(hint) {
  const hintHtml = hint
    ? `<div style="margin-top:10px;font-size:11px;color:#FFA366;opacity:0.80;
                   background:rgba(255,107,0,0.08);border:1px solid rgba(255,107,0,0.20);
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
  let dayNum = '', monthStr = '';
  if (b.date_start) {
    const d  = new Date(b.date_start);
    dayNum   = d.getDate();
    monthStr = d.toLocaleDateString('ar-EG', { month: 'short' });
  }

  const dateLabel = b.date_start
    ? new Date(b.date_start).toLocaleDateString('ar-EG', { weekday:'short', month:'long', day:'numeric' })
    : '—';
  const endLabel = b.date_end && b.date_end !== b.date_start
    ? ' ← ' + new Date(b.date_end).toLocaleDateString('ar-EG', { month:'short', day:'numeric' })
    : '';

  const availSlots = typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0);
  const isSoldOut  = availSlots === 0 && (b.total_slots || 0) > 0;

  const imgHtml = b.image
    ? `<img src="${b.image}" alt="${b.name}" loading="lazy"
             onerror="this.parentElement.innerHTML='<div class=\\'bz-img-placeholder\\'>🎪</div>'">`
    : `<div class="bz-img-placeholder">🎪</div>`;

  const timeHtml = b.time_start
    ? `<div class="bz-card-time">🕐 ${b.time_start}${b.time_end ? ' — ' + b.time_end : ''}</div>`
    : '';

  const catHtml = b.category
    ? `<span class="bz-category-badge">${b.category}</span>`
    : '';

  const verifiedBadge = b.is_organizer_verified
    ? `<span class="bz-verified-badge">✓ موثّق</span>`
    : '';

  return `
  <div class="bz-card" onclick="openBazaarDetail('${b.id}')">
    <div class="bz-card-img">
      ${imgHtml}
      <div class="bz-card-overlay">
        <div class="bz-card-overlay-name">${b.name}</div>
        <div class="bz-card-overlay-loc">📍 ${b.location || '—'}</div>
      </div>
      ${dayNum ? `
      <div class="bz-date-box">
        <span class="bz-date-box-month">${monthStr}</span>
        <span class="bz-date-box-day">${dayNum}</span>
      </div>` : ''}
      ${isSoldOut ? '<div class="bz-soldout-badge">مكتمل</div>' : ''}
    </div>
    <div class="bz-card-body">
      <div class="bz-card-meta-row">
        <span class="bz-card-date-txt">📅 ${dateLabel}${endLabel}</span>
        ${catHtml}
      </div>
      ${timeHtml}
      ${b.description
        ? `<div class="bz-card-desc">${b.description.substring(0,80)}${b.description.length > 80 ? '…' : ''}</div>`
        : ''}
      ${b.organizer ? `
      <div style="font-size:11px;color:var(--ink3);margin:4px 0;display:flex;align-items:center;gap:5px">
        <span>🧑‍💼 ${b.organizer}</span>${verifiedBadge}
      </div>` : ''}
      <div class="bz-card-footer">
        <div style="display:flex;flex-direction:column;gap:3px">
          <span class="bz-price-tag">${Number(b.price_per_slot || 0).toLocaleString('ar-EG')} ج / مكان</span>
          <span class="bz-slots-tag${isSoldOut ? ' sold-out' : ''}">
            ${isSoldOut ? '🔴 لا أماكن متاحة' : `🟢 ${availSlots} مكان متاح`}
          </span>
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
          <button class="btn btn-primary" style="font-size:12px;padding:8px 14px;white-space:nowrap"
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
  bzTimeNav      = 'upcoming';
  document.querySelectorAll('.bz-chip').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.bz-time-btn').forEach(btn => {
    btn.classList.toggle('bz-time-active', btn.dataset.nav === 'upcoming');
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
    `linear-gradient(to right, #e8e8e8 ${100 - pct}%, #FF6B00 ${100 - pct}%)`;
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

async function openBazaarDetail(bazaarId) {
  const b = BAZAARS.find(x => String(x.id) === String(bazaarId));
  if (!b) return;

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
  selectedSlotSource = 'supabase';

  showBzPage('bazaar-detail');
  window.scrollTo({ top: 0, behavior: 'instant' });

  try {
    const sheetSlots = await _loadBazaarSlotsFromSheet(bazaarId);
    if (sheetSlots.length) {
      renderSlotMap(sheetSlots);
      return;
    }
  } catch (err) {
    console.warn('تعذر تحميل أماكن البازار من الشيت:', err);
  }

  if (!sbClient) {
    if (slotmapEl) slotmapEl.innerHTML = _renderSlotMapFallback();
    return;
  }

  try {
    const { data: slots, error } = await sbClient
      .from('bazaar_slots')
      .select('*')
      .eq('bazaar_id', bazaarId)
      .order('slot_number', { ascending: true });

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

  const mapsHref = b.venue_address || b.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.venue_address || b.location)}`
    : '';

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
          <div class="sd-extra-row">
            <span>🧑‍💼 المنظم</span>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-weight:700">${b.organizer}</span>
              ${b.is_organizer_verified
                ? `<span class="bz-verified-badge">✓ موثّق</span>`
                : `<span style="font-size:10px;color:var(--ink3);background:var(--surface2);border-radius:50px;padding:2px 7px;">لم يتم التحقق بعد</span>`}
              ${b.organizer_id
                ? `<button class="btn" style="font-size:11px;padding:4px 10px;border-radius:8px"
                           onclick="openOrganizerProfile('${b.organizer_id}')">عرض البروفايل</button>`
                : ''}
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
          ${mapsHref ? `
          <a href="${mapsHref}" target="_blank" rel="noopener"
             class="bz-maps-btn">
            🗺️ فتح في Google Maps
          </a>` : ''}
        </div>
      </div>` : ''}

    </div>`;
}

function closeBazaarDetail() {
  currentBazaar  = null;
  selectedSlotId = null;
  selectedSlotSource = 'supabase';
  showBzPage('bazaars');
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

  const source    = slot.source || 'supabase';
  const clickAttr = isAvailable
    ? `onclick="selectSlot('${slot.id}','${slot.slot_number || slot.id}','${source}')"`
    : '';

  const bookedLabel = isFeatured ? `محجوز (مميز ⭐)` : `محجوز`;
  const availLabel  = isFeatured ? `اضغط للحجز (مميز ⭐)` : `اضغط للحجز`;
  const titleAttr   = isBooked
    ? `title="مكان ${slot.slot_number || ''} — ${bookedLabel}"`
    : `title="مكان ${slot.slot_number || ''} — ${availLabel}"`;

  const delay       = Math.min(index * 0.028, 0.55).toFixed(3);
  const featuredTip = isFeatured
    ? `<span class="bz-featured-tooltip">⭐ مكان مميز</span>`
    : '';

  return `<div class="bz-slot ${cls}"
              data-slot-id="${slot.id}"
              data-featured="${isFeatured}"
              style="animation-delay:${delay}s"
              ${clickAttr} ${titleAttr}>
    ${slot.slot_number || ''}
    ${featuredTip}
  </div>`;
}

function selectSlot(slotId, slotLabel, source = 'supabase') {
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

  selectedSlotId     = slotId;
  selectedSlotSource = source;

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
  selectedSlotId     = null;
  selectedSlotSource = 'supabase';

  const panel = document.getElementById('bzd-booking-panel');
  if (panel) panel.style.display = 'none';
}


/* ================================================================
   📬 القسم 13: إرسال حجز البازار
   ================================================================ */

async function _bookBazaarSlotViaSheet({ name, phone, email, business, notes }) {
  const res = await fetch(_bazaarApiUrl({
    action:   'book',
    slotId:   selectedSlotId,
    bazaarId: currentBazaar.id,
    name,
    phone,
    email:    email || '',
    activity: business,
    userId:   currentUser?.id || '',
    notes:    notes || '',
  }));
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'تعذر حفظ الحجز في الشيت');
  return json;
}

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
  if (selectedSlotSource !== 'sheet' && !sbClient) {
    showBzbError('في مشكلة في الاتصال — حاول تاني'); return;
  }

  const submitBtn = document.querySelector('#bzd-booking-panel .btn-primary');
  if (submitBtn) {
    submitBtn.innerHTML  = '⏳ جاري الحجز…';
    submitBtn.disabled   = true;
    submitBtn.style.opacity = '0.7';
  }

  const _sendToSheet = async (source) => {
    try {
      await fetch(BAZAAR_SHEET_URL, {
        method:  'POST',
        mode:    'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:      'book',
          bookingId,
          bazaarId:    currentBazaar.id,
          bazaarName:  currentBazaar.name,
          slotId:      selectedSlotId,
          name, phone,
          email:       email || '',
          business,
          notes:       notes || '',
          userId:      currentUser.id.toString(),
          status:      'confirmed',
          source,
        }),
      });
    } catch (_) {
      console.warn('تعذر إرسال الحجز للشيت');
    }
  };

  try {
    const bookingId = crypto.randomUUID();
    const now       = new Date().toISOString();

    const bazaarBookingRecord = {
      id:            bookingId,
      bazaar_id:     String(currentBazaar.id),
      bazaar_name:   currentBazaar.name,
      slot_id:       selectedSlotId,
      user_id:       currentUser.id.toString(),
      user_name:     name,
      user_phone:    phone,
      user_email:    email || null,
      business_name: business,
      notes:         notes || null,
      status:        'confirmed',
      created_at:    now,
    };

    if (selectedSlotSource === 'sheet') {

      await _bookBazaarSlotViaSheet({ name, phone, email, business, notes });

      if (sbClient && currentUser) {
        const { error: sheetMirrorErr } = await sbClient
          .from('bazaar_bookings')
          .insert({
            id:            bazaarBookingRecord.id,
            bazaar_id:     bazaarBookingRecord.bazaar_id,
            slot_id:       bazaarBookingRecord.slot_id,
            user_id:       bazaarBookingRecord.user_id,
            user_name:     bazaarBookingRecord.user_name,
            user_phone:    bazaarBookingRecord.user_phone,
            user_email:    bazaarBookingRecord.user_email,
            business_name: bazaarBookingRecord.business_name,
            notes:         bazaarBookingRecord.notes,
            status:        bazaarBookingRecord.status,
            created_at:    bazaarBookingRecord.created_at,
          });
        if (sheetMirrorErr) {
          console.warn('تعذر حفظ نسخة في Supabase:', sheetMirrorErr.message);
        }
      }

    } else {

      const { error: lockErr } = await sbClient
        .from('bazaar_slots')
        .update({ status: 'booked', booked_by: currentUser.id.toString(), updated_at: now })
        .eq('id', selectedSlotId)
        .eq('status', 'available');

      if (lockErr) throw new Error('تعذّر حجز المكان: ' + lockErr.message);

      const { error: bookingErr } = await sbClient
        .from('bazaar_bookings')
        .insert({
          id:            bazaarBookingRecord.id,
          bazaar_id:     bazaarBookingRecord.bazaar_id,
          slot_id:       bazaarBookingRecord.slot_id,
          user_id:       bazaarBookingRecord.user_id,
          user_name:     bazaarBookingRecord.user_name,
          user_phone:    bazaarBookingRecord.user_phone,
          user_email:    bazaarBookingRecord.user_email,
          business_name: bazaarBookingRecord.business_name,
          notes:         bazaarBookingRecord.notes,
          status:        bazaarBookingRecord.status,
          created_at:    bazaarBookingRecord.created_at,
        });

      if (bookingErr) throw new Error('تعذّر حفظ الحجز: ' + bookingErr.message);

      await _sendToSheet('supabase');
    }

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

