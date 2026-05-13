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
  { id: 'food-cart',   label: 'عربية أكل' },
  { id: 'fridge',      label: 'ثلاجات وتبريد' },
  { id: 'display',     label: 'ڤيترينات وعرض' },
  { id: 'kitchen',     label: 'معدات مطبخ' },
  { id: 'pos',         label: 'كاشير وPOS' },
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

let eqSb          = null;
let eqUser        = null;
let eqListings    = [];
let eqFiltered    = [];
let eqPage        = 1;
let eqActiveCategory = '';
let eqSearch      = '';
let eqSortBy      = 'newest';
let eqGov         = '';
let eqPriceMax    = 0;

document.addEventListener('DOMContentLoaded', async () => {
  eqSb = supabase.createClient(EQ_SUPABASE_URL, EQ_SUPABASE_KEY);
  await eqInitAuth();
  eqBuildCategoryTabs();
  await eqLoadListings();
  eqBindSearch();
  eqRunLifecycle();
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
  });
}

function eqRenderNavUser() {
  const area = document.getElementById('eq-nav-user');
  if (!area) return;
  if (eqUser) {
    area.innerHTML = `
      <button class="eq-btn eq-btn-ghost" onclick="eqOpenMyListings()" style="font-size:13px">📋 إعلاناتي</button>
      <a class="eq-nav-link" href="index.html">رجوع للمنصة</a>
      <button class="eq-btn eq-btn-outline" onclick="eqSignOut()">خروج</button>`;
  } else {
    area.innerHTML = `
      <a class="eq-nav-link" href="index.html">رجوع للمنصة</a>
      <a class="eq-btn eq-btn-outline" href="index.html">دخول / تسجيل</a>`;
  }
}

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
    ? `<img src="${img}" alt="${listing.title}" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="eq-card-no-img">📦</div>`;

  return `
<div class="eq-card" onclick="eqOpenDetail('${listing.id}')">
  <div class="eq-card-img">${imgHtml}${feat}</div>
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

  const imgs   = [listing.cover_image, ...(listing.images || [])].filter(Boolean);
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

  const waBtn = listing.contact_pref !== 'call'
    ? `<a class="eq-btn eq-btn-primary eq-btn-full" href="https://wa.me/2${listing.phone}?text=${encodeURIComponent('مرحبا، شايف إعلانك عن '+listing.title+' في مكاني Spot')}" target="_blank" onclick="eqIncrementContact('${id}')">💬 تواصل عبر واتساب</a>`
    : '';
  const callBtn = listing.contact_pref !== 'whatsapp'
    ? `<a class="eq-btn eq-btn-outline eq-btn-full" href="tel:${listing.phone}" onclick="eqIncrementContact('${id}')">📞 اتصل بالبائع</a>`
    : '';

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
        ${waBtn}
        ${callBtn}
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
  /* RPC يجاوز RLS — يتطلب دالة increment_view_count في Supabase */
  await eqSb.rpc('increment_view_count', { listing_id: id }).catch(() => null);
}

async function eqIncrementContact(id) {
  const listing = eqListings.find(l => l.id === id);
  if (!listing) return;
  listing.contact_count = (listing.contact_count || 0) + 1;
  /* RPC يجاوز RLS — يتطلب دالة increment_contact_count في Supabase */
  await eqSb.rpc('increment_contact_count', { listing_id: id }).catch(() => null);
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
      `<div class="eq-empty"><p>يجب تسجيل الدخول أولاً</p><a class="eq-btn eq-btn-primary" href="index.html">تسجيل الدخول</a></div>`;
    return;
  }

  const { data, error } = await eqSb
    .from('listings')
    .select('*')
    .eq('user_id', eqUser.id)
    .neq('status', 'deleted')
    .order('created_at', { ascending: false });

  if (error) { console.error(error); return; }

  const cont = document.getElementById('eq-my-listings');
  if (!cont) return;

  if (!data || data.length === 0) {
    cont.innerHTML = `<div class="eq-empty"><p>ما عندكش إعلانات لحد دلوقتي</p><a class="eq-btn eq-btn-primary" href="post-ad.html">انشر إعلانك الأول</a></div>`;
    return;
  }

  cont.innerHTML = data.map(l => eqBuildMyCard(l)).join('');
}

function eqBuildMyCard(l) {
  const statusMap = {
    pending:  { label: 'قيد المراجعة', cls: 'eq-status-pending' },
    approved: { label: 'نشط',          cls: 'eq-status-active'  },
    rejected: { label: 'مرفوض',        cls: 'eq-status-rejected' },
    expired:  { label: 'منتهي',        cls: 'eq-status-expired'  },
  };
  const st    = statusMap[l.status] || { label: l.status, cls: '' };
  const exp   = l.expires_at ? new Date(l.expires_at) : null;
  const now   = new Date();
  const days  = exp ? Math.max(0, Math.ceil((exp - now) / 86400000)) : 0;
  const canRenew = l.status === 'approved' && days <= 15 && (l.renewal_count || 0) < MAX_RENEWALS;
  const canDelete = ['pending','rejected','expired'].includes(l.status);

  return `
<div class="eq-my-card">
  <div class="eq-my-card-img">
    ${l.cover_image ? `<img src="${l.cover_image}" alt="${l.title}">` : '<div class="eq-card-no-img">📦</div>'}
  </div>
  <div class="eq-my-card-body">
    <div class="eq-my-card-title">${l.title}</div>
    <span class="eq-status ${st.cls}">${st.label}</span>
    ${l.status === 'rejected' && l.rejection_reason ? `<div class="eq-rejection-reason">سبب الرفض: ${l.rejection_reason}</div>` : ''}
    ${l.status === 'approved' ? `<div class="eq-days-left">متبقي <strong>${days}</strong> يوم</div>` : ''}
    <div class="eq-my-stats">👁 ${l.view_count||0} مشاهدة | 📞 ${l.contact_count||0} تواصل</div>
    <div class="eq-my-actions">
      ${canRenew ? `<button class="eq-btn eq-btn-primary" onclick="eqRenew('${l.id}')">🔄 تجديد</button>` : ''}
      ${canDelete ? `<button class="eq-btn eq-btn-danger" onclick="eqDeleteListing('${l.id}')">حذف</button>` : ''}
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

async function eqDeleteListing(id) {
  if (!confirm('هل أنت متأكد من حذف الإعلان؟')) return;
  const { error } = await eqSb.from('listings').update({ status: 'deleted' }).eq('id', id);
  if (error) { alert('حدث خطأ في الحذف'); return; }
  alert('تم حذف الإعلان');
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
});
