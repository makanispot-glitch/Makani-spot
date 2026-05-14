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
  { id: 'partition',   label: 'بارتشن وأثاث' },
  { id: 'food-cart',   label: 'عربات طعام' },
  { id: 'fridge',      label: 'ثلاجات وتبريد' },
  { id: 'display',     label: 'ڤيترينات وعرض' },
  { id: 'kitchen',     label: 'معدات مطبخ' },
  { id: 'coffee',      label: 'معدات كافيه' },
  { id: 'pos',         label: 'كاشير وPOS' },
  { id: 'vending',     label: 'أجهزة بيع ذاتي' },
  { id: 'storage',     label: 'رفوف وتخزين' },
  { id: 'lighting',    label: 'إضاءة تجارية' },
  { id: 'other',       label: 'أخرى' },
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

const EQ_PER_PAGE = 12;
const MAX_RENEWALS = 5;
const LISTING_DAYS  = 60;


/* ================================================================
   🗄️ القسم 3: المتغيرات العامة + نقطة البداية
   ================================================================ */

let eqSb            = null;
let eqUser          = null;
let eqListings      = [];
let eqFiltered      = [];
let eqPage          = 1;
let eqActiveCategory = '';
let eqSearch        = '';
let eqSortBy        = 'newest';
let eqGov           = '';
let eqPriceMax      = 0;
let eqFavorites     = new Set();
let eqNotifications = [];
let eqMyListings    = [];

document.addEventListener('DOMContentLoaded', async () => {
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
  } catch (e) {
    eqShowError('حدث خطأ في تحميل الصفحة. حاول إعادة التحميل.');
  }
});


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
    area.innerHTML = `
      <a class="eq-back-btn" href="/">← رجوع للمنصة</a>
      <div class="eq-notif-wrap" id="eq-notif-wrap">
        <button class="eq-notif-btn" onclick="eqToggleNotifPanel(event)">
          🔔<span class="eq-notif-badge" id="eq-notif-badge" style="display:none">0</span>
        </button>
        <div class="eq-notif-panel" id="eq-notif-panel">
          <div class="eq-notif-header">الإشعارات</div>
          <div class="eq-notif-list" id="eq-notif-list"></div>
        </div>
      </div>
      <div class="eq-account-wrap" id="eq-account-wrap">
        <button class="eq-account-btn" onclick="eqToggleAccountMenu(event)">
          <div class="eq-account-avatar">${initial}</div>
          <span>حسابي</span>
          <span class="eq-account-chevron">▼</span>
        </button>
        <div class="eq-account-dropdown">
          <div class="eq-account-email">${email}</div>
          <button class="eq-account-item" onclick="eqOpenMyListings();eqCloseAccountMenu()">
            إعلاناتي
          </button>
          <button class="eq-account-item" onclick="eqOpenFavorites()">
            المفضلة
          </button>
          <div class="eq-account-divider"></div>
          <button class="eq-account-item danger" onclick="eqSignOut()">
            خروج
          </button>
        </div>
      </div>`;
    eqLoadNotifications();
  } else {
    area.innerHTML = `
      <a class="eq-back-btn" href="/">← رجوع للمنصة</a>
      <a class="eq-btn eq-btn-outline" href="/?p=login">دخول / تسجيل</a>`;
  }
}

function eqToggleAccountMenu(e) {
  e.stopPropagation();
  document.getElementById('eq-account-wrap')?.classList.toggle('open');
}

function eqCloseAccountMenu() {
  document.getElementById('eq-account-wrap')?.classList.remove('open');
}

document.addEventListener('click', () => { eqCloseAccountMenu(); eqCloseNotifPanel(); });

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

async function eqLoadListings() {
  eqShowLoading();
  try {
    const { data, error } = await eqSb
      .from('listings')
      .select(`id, title, description, category, condition, price, negotiable,
               region, area, phone, contact_pref,
               cover_image, images, is_featured,
               view_count, contact_count, status,
               expires_at, created_at, user_id`)
      .eq('status', 'approved')
      .gt('expires_at', new Date().toISOString())
      .order('is_featured', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    eqListings = data || [];
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
  eqPage = 1;
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
  if (govSel) govSel.addEventListener('change', () => { eqGov = govSel.value; eqApplyFilters(); });

  const sortSel = document.getElementById('eq-sort');
  if (sortSel) sortSel.addEventListener('change', () => { eqSortBy = sortSel.value; eqApplyFilters(); });

  const priceInp = document.getElementById('eq-price-max');
  if (priceInp) priceInp.addEventListener('input', () => {
    eqPriceMax = parseInt(priceInp.value) || 0;
    const lbl = document.getElementById('eq-price-label');
    if (lbl) lbl.textContent = eqPriceMax > 0 ? eqPriceMax.toLocaleString('ar-EG') + ' ج' : 'بلا حد';
    eqApplyFilters();
  });
}

function eqSetCategory(cat, el) {
  eqActiveCategory = cat;
  document.querySelectorAll('.eq-tab').forEach(t => t.classList.remove('on'));
  if (el) el.classList.add('on');
  eqApplyFilters();
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
}


/* ================================================================
   🃏 القسم 6: بناء كروت الإعلانات
   ================================================================ */

function eqBuildCard(listing) {
  const img    = listing.cover_image || (listing.images && listing.images[0]) || '';
  const cond   = EQ_CONDITIONS.find(c => c.id === listing.condition)?.label || listing.condition;
  const cat    = EQ_CATEGORIES.find(c => c.id === listing.category)?.label || listing.category;
  const price  = Number(listing.price).toLocaleString('ar-EG');
  const nego   = listing.negotiable ? '<span class="eq-badge eq-badge-nego">قابل للتفاوض</span>' : '';
  const feat   = listing.is_featured ? '<span class="eq-badge eq-badge-feat">⭐ مميز</span>' : '';
  const imgHtml = img
    ? `<img src="${img}" alt="${listing.title}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'eq-card-no-img\\'>📦</div>'">`
    : `<div class="eq-card-no-img">📦</div>`;
  const favIcon = eqFavorites.has(listing.id) ? '❤️' : '🤍';

  return `
<div class="eq-card" onclick="eqOpenDetail('${listing.id}')">
  <div class="eq-card-img" style="position:relative">
    ${imgHtml}${feat}
    <button class="eq-fav-btn" data-fav="${listing.id}" onclick="eqToggleFavorite(event,'${listing.id}')" title="المفضلة">${favIcon}</button>
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

  const slice = eqFiltered.slice(0, eqPage * EQ_PER_PAGE);

  if (eqFiltered.length === 0) {
    grid.innerHTML = `<div class="eq-empty">لا توجد إعلانات تطابق بحثك 🔍</div>`;
    if (count) count.textContent = '0 إعلان';
    if (more)  more.style.display = 'none';
    return;
  }

  grid.innerHTML = slice.map(eqBuildCard).join('');
  if (count) count.textContent = eqFiltered.length + ' إعلان';
  if (more)  more.style.display = slice.length < eqFiltered.length ? 'flex' : 'none';
}

function eqLoadMore() {
  eqPage++;
  eqRenderGrid();
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

  eqIncrementView(id);

  const imgs   = [...new Set([listing.cover_image, ...(listing.images || [])].filter(Boolean))];
  const cond   = EQ_CONDITIONS.find(c => c.id === listing.condition)?.label || listing.condition;
  const cat    = EQ_CATEGORIES.find(c => c.id === listing.category)?.label || listing.category;
  const price  = Number(listing.price).toLocaleString('ar-EG');
  const nego   = listing.negotiable ? ' (قابل للتفاوض)' : '';
  const date   = new Date(listing.created_at).toLocaleDateString('ar-EG');

  const galleryHtml = imgs.length > 0
    ? `<div class="eq-detail-gallery">
        <div class="eq-detail-main-img">
          <img id="eq-detail-img-main" src="${imgs[0]}" alt="${listing.title}">
        </div>
        ${imgs.length > 1 ? `<div class="eq-detail-thumbs">
          ${imgs.map((u, i) => `<img src="${u}" class="eq-thumb${i===0?' active':''}" onclick="eqSwitchImg('${u}',this)">`).join('')}
        </div>` : ''}
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
}

function eqCloseModal() {
  document.getElementById('eq-modal').classList.remove('open');
  document.body.style.overflow = '';
}

function eqSwitchImg(url, el) {
  document.getElementById('eq-detail-img-main').src = url;
  document.querySelectorAll('.eq-thumb').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
}


/* ================================================================
   📊 القسم 19 & 20: عدادات المشاهدات والتواصل
   ================================================================ */

async function eqIncrementView(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
  listing.view_count = (listing.view_count || 0) + 1;
  const { error } = await eqSb.rpc('increment_view_count', { listing_id: id });
  if (error) console.warn('[view_count RPC]', error.message);
}

async function eqIncrementContact(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
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
    ${l.cover_image ? `<img src="${l.cover_image}" alt="${l.title}">` : '<div class="eq-card-no-img">📦</div>'}
  </div>
  <div class="eq-my-card-body">
    <div class="eq-my-card-title">${l.title}</div>
    <span class="eq-status ${st.cls}">${st.label}</span>
    ${l.status === 'rejected' && l.reject_reason ? `<div class="eq-rejection-reason">سبب الرفض: ${l.reject_reason}</div>` : ''}
    ${l.status === 'approved' ? `<div class="eq-days-left">متبقي <strong>${days}</strong> يوم</div>` : ''}
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
    ? 'هل أنت متأكد من حذف الإعلان النشط؟ لن يظهر للمستخدمين ولا يمكن التراجع.'
    : 'هل أنت متأكد من حذف الإعلان؟';
  if (!confirm(msg)) return;
  const { error } = await eqSb.from('listings')
    .update({ status: 'deleted' })
    .eq('id', id).eq('user_id', eqUser.id);
  if (error) { alert('حدث خطأ في الحذف: ' + error.message); return; }
  alert('تم حذف الإعلان');
  eqLoadMyListings();
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

  eqCloseEdit();
  alert(origStatus === 'rejected'
    ? 'تم حفظ التعديلات ✅\nتم إرسال الإعلان للمراجعة مجدداً.'
    : 'تم حفظ التعديلات بنجاح ✅');
  eqLoadMyListings();
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
  await eqSb.rpc('expire_listings').catch(() => null);
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

async function eqLoadFavorites() {
  if (!eqUser) return;
  const { data } = await eqSb
    .from('favorites')
    .select('listing_id')
    .eq('user_id', eqUser.id);
  eqFavorites = new Set((data || []).map(f => f.listing_id));
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
      ? `<img src="${l.cover_image}" alt="${l.title}" style="width:60px;height:60px;object-fit:cover;border-radius:8px;flex-shrink:0">`
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
