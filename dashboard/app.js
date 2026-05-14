/* ================================================================
   MAKANI SPOT — OWNER DASHBOARD APP LOGIC
   makani-dashboard-app.js | v1.0
   ملف منفصل عن المنصة الرئيسية (app.js)
   ================================================================ */

/* ══════════════════════════════════════════
   ⚙️  CONFIG
   ══════════════════════════════════════════ */
const SHEET_URL     = "https://script.google.com/macros/s/AKfycbxyCDOQW3SlaoSEPAAFfClUcHYyxA6-iei4Zuvvv5Us8caWP9X3WjgoeyhsOVNGJ9XqQw/exec";
const BOOKING_URL   = "https://script.google.com/macros/s/AKfycbzZPnqZ4hjy8nzzGDcrQUpJK_pZn01lGIJXL-EfScxpGISLMjo6wL6xCLqNMviBpD69/exec";
const ADD_SPACE_URL = SHEET_URL; // نفس الـ Apps Script الخاص بالمساحات — يدعم doPost بعد التحديث
const ADD_BAZAAR_URL = "https://script.google.com/macros/s/AKfycby3adz7kud__ds_rVxZHyzEr6DS5SfdcdT7hUblmKwl1yvbEtlL7NpnpaWrrh7PLpjQPQ/exec";

const ABANDONED_THRESHOLD = 30; // يوم — بعده تُعتبر المساحة "مهملة"

/* ══════════════════════════════════════════
   🔐  OWNERS — Hardcoded (الخيار الأسرع)
   لإضافة owner جديد: أضف سطراً وأعد النشر
   ══════════════════════════════════════════ */
const OWNERS = {
  "owner1":         { password: "makani123", name: "محمد أحمد",    id: "owner1",     initial: "م", place: "مول مدينة نصر",  phone: "01012345678" },
  "mall_admin":     { password: "admin2025", name: "هناء خالد",    id: "mall_admin", initial: "ه", place: "نادي الجزيرة",   phone: "01098765432" },
  "mall_citystars": { password: "cs2026",    name: "سيتي ستارز",   id: "citystars",  initial: "س", place: "مول سيتي ستارز", phone: "01000000001" },
  "club_wadi":      { password: "wadi99",    name: "وادي دجلة",    id: "wadi",       initial: "و", place: "نادي وادي دجلة", phone: "01000000002" },
};

/* ══════════════════════════════════════════
   📦  بيانات تجريبية — مرتبطة بكل owner
   🔗 DB-LINK: سيتم الجلب من Google Sheets (حقل ownerId)
   ══════════════════════════════════════════ */
const DEMO_SPACES = {
  "owner1": [
    { code:"A-12", loc:"مدخل رئيسي",       size:"١×١ م", act:"قهوة",       rent:4200, status:"rented",      tenant:"أحمد محمد",  score:9.2, daysEmpty:0,  floor:1 },
    { code:"A-05", loc:"الدور الأرضي",     size:"٢×١ م", act:"مشروبات",    rent:6500, status:"rented",      tenant:"نور خالد",   score:6.9, daysEmpty:0,  floor:1 },
    { code:"B-03", loc:"أمام المصعد",      size:"١×٢ م", act:"إكسسوار",    rent:5800, status:"rented",      tenant:"سارة علي",   score:8.7, daysEmpty:0,  floor:2 },
    { code:"C-07", loc:"ممر الأسواق",      size:"١×١ م", act:"حلويات",     rent:3900, status:"rented",      tenant:"محمد حسن",   score:7.4, daysEmpty:0,  floor:1 },
    { code:"D-02", loc:"الدور الثاني",     size:"٢×٢ م", act:"فاست فود",   rent:7200, status:"rented",      tenant:"خالد سمير",  score:4.2, daysEmpty:0,  floor:2 },
    { code:"D-08", loc:"الدور الثاني",     size:"١×١ م", act:null,         rent:null, status:"available",   tenant:null,         score:null,daysEmpty:45, floor:2 },
    { code:"E-01", loc:"المدخل الخلفي",   size:"١×٢ م", act:null,         rent:null, status:"available",   tenant:null,         score:null,daysEmpty:0,  floor:1, isNew:true },
    { code:"F-11", loc:"بجوار المطعم",    size:"٢×٢ م", act:null,         rent:null, status:"maintenance", tenant:null,         score:null,daysEmpty:0,  floor:2 },
  ],
  "mall_admin": [
    { code:"J-01", loc:"بوابة النادي",     size:"١×١ م", act:"عصائر",      rent:3500, status:"rented",      tenant:"عمر فتحي",   score:8.1, daysEmpty:0,  floor:0 },
    { code:"J-02", loc:"حوض السباحة",      size:"١×٢ م", act:null,         rent:null, status:"available",   tenant:null,         score:null,daysEmpty:60, floor:0 },
    { code:"J-03", loc:"الملاعب",          size:"٢×١ م", act:"وجبات خفيفة",rent:4100, status:"rented",      tenant:"لمياء رشاد", score:7.9, daysEmpty:0,  floor:0 },
    { code:"J-04", loc:"بجوار الكافيتريا",size:"١×١ م", act:null,         rent:null, status:"available",   tenant:null,         score:null,daysEmpty:35, floor:0 },
  ],
  "citystars": [],
  "wadi":      [],
};

const DEMO_TENANTS = {
  "owner1": [
    { id:1, name:"أحمد محمد",  act:"☕ قهوة",         space:"A-12", score:9.2, trend:"up",   statusLbl:"ممتاز", icon:"☕", contract:"٣١ مارس ٢٠٢٥",  daysLeft:35 },
    { id:2, name:"سارة علي",   act:"💎 إكسسوار",      space:"B-03", score:8.7, trend:"up",   statusLbl:"ممتاز", icon:"💎", contract:"١٥ مارس ٢٠٢٥",  daysLeft:21 },
    { id:3, name:"محمد حسن",   act:"🍬 حلويات",        space:"C-07", score:7.4, trend:"down", statusLbl:"جيد",   icon:"🍬", contract:"١ مايو ٢٠٢٥",    daysLeft:66 },
    { id:4, name:"نور خالد",   act:"🥤 مشروبات",       space:"A-05", score:6.9, trend:"flat", statusLbl:"متوسط", icon:"🥤", contract:"١٥ أبريل ٢٠٢٥", daysLeft:50 },
    { id:5, name:"خالد سمير",  act:"🍔 فاست فود",      space:"D-02", score:4.2, trend:"down", statusLbl:"ضعيف",  icon:"🍔", contract:"٢٨ مارس ٢٠٢٥",  daysLeft:42 },
  ],
  "mall_admin": [
    { id:1, name:"عمر فتحي",   act:"🍹 عصائر",         space:"J-01", score:8.1, trend:"up",   statusLbl:"جيد",   icon:"🍹", contract:"١ يونيو ٢٠٢٥",   daysLeft:90 },
    { id:2, name:"لمياء رشاد", act:"🥗 وجبات خفيفة",  space:"J-03", score:7.9, trend:"flat", statusLbl:"جيد",   icon:"🥗", contract:"١ أبريل ٢٠٢٥",   daysLeft:55 },
  ],
  "citystars": [],
  "wadi":      [],
};

const DEMO_CONTRACTS = {
  "owner1": [
    { name:"أحمد محمد",  space:"A-12", rent:"٤,٢٠٠", start:"1 نوفمبر ٢٠٢٤",   end:"٣١ مارس ٢٠٢٥",  daysLeft:35, status:"سارية" },
    { name:"سارة علي",   space:"B-03", rent:"٥,٨٠٠", start:"15 أغسطس ٢٠٢٤",   end:"١٥ مارس ٢٠٢٥",  daysLeft:21, status:"تنتهي قريباً" },
    { name:"محمد حسن",   space:"C-07", rent:"٣,٩٠٠", start:"1 مارس ٢٠٢٤",     end:"١ مايو ٢٠٢٥",   daysLeft:66, status:"سارية" },
    { name:"خالد سمير",  space:"D-02", rent:"٧,٢٠٠", start:"28 سبتمبر ٢٠٢٤",  end:"٢٨ مارس ٢٠٢٥",  daysLeft:42, status:"للمراجعة" },
  ],
  "mall_admin": [
    { name:"عمر فتحي",   space:"J-01", rent:"٣,٥٠٠", start:"1 ديسمبر ٢٠٢٤",   end:"١ يونيو ٢٠٢٥",  daysLeft:90, status:"سارية" },
    { name:"لمياء رشاد", space:"J-03", rent:"٤,١٠٠", start:"1 أكتوبر ٢٠٢٤",   end:"١ أبريل ٢٠٢٥",  daysLeft:55, status:"سارية" },
  ],
  "citystars": [],
  "wadi":      [],
};

/* ══════════════════════════════════════════
   🗂️  STATE
   ══════════════════════════════════════════ */
let currentOwner   = null;
let ownerSpaces    = [];
let ownerTenants   = [];
let ownerContracts = [];
let ownerAuthChecked = false;

/* ══════════════════════════════════════════
   📋  CONTRACTS & RATINGS — localStorage DB
   ══════════════════════════════════════════ */
const LS_CONTRACTS = 'ms_contracts_';
const LS_RATINGS   = 'ms_ratings_';

let contractsList      = [];
let ratingsList        = [];
let editingContractId  = null;

function contractsKey() { return LS_CONTRACTS + (currentOwner?.id || 'guest'); }
function ratingsKey()   { return LS_RATINGS   + (currentOwner?.id || 'guest'); }

/* ── تحميل العقود من localStorage ── */
function loadContractsLocal() {
  try {
    const raw = localStorage.getItem(contractsKey());
    contractsList = raw ? JSON.parse(raw) : [];
  } catch { contractsList = []; }
  contractsList = contractsList.map(enrichContract);
}

/* ── تحميل التقييمات من localStorage ── */
function loadRatingsLocal() {
  try {
    const raw = localStorage.getItem(ratingsKey());
    ratingsList = raw ? JSON.parse(raw) : [];
  } catch { ratingsList = []; }
}

/* ── حفظ العقود ── */
function saveContracts() {
  localStorage.setItem(contractsKey(), JSON.stringify(contractsList));
}

/* ── حفظ التقييمات ── */
function saveRatings() {
  localStorage.setItem(ratingsKey(), JSON.stringify(ratingsList));
}

/* ── إثراء العقد بالحقول المحسوبة ── */
function enrichContract(c) {
  const now      = new Date(); now.setHours(0, 0, 0, 0);
  const end      = c.endDate ? new Date(c.endDate) : null;
  const daysLeft = end ? Math.ceil((end - now) / 86400000) : 0;
  let status = 'active';
  if (!end || daysLeft < 0) status = 'expired';
  else if (daysLeft <= 14)  status = 'renewal';
  else if (daysLeft <= 30)  status = 'expiring';
  return { ...c, daysLeft, status };
}

/* ── توليد معرّف فريد ── */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/* ── تنسيق التاريخ بالعربية ── */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                    'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return dateStr; }
}

/* ── أيقونة النشاط ── */
function getActivityIcon(act) {
  if (!act) return '🏪';
  const a = act;
  if (a.includes('قهوة') || a.includes('كافيه'))  return '☕';
  if (a.includes('مشروب') || a.includes('عصير')) return '🥤';
  if (a.includes('حلو')  || a.includes('سكاكر')) return '🍬';
  if (a.includes('أكل')  || a.includes('فاست') || a.includes('وجبة')) return '🍔';
  if (a.includes('إكسسوار') || a.includes('مجوهر')) return '💎';
  if (a.includes('ملابس') || a.includes('أزياء')) return '👗';
  if (a.includes('هاند') || a.includes('يدوي'))   return '🎨';
  return '🏪';
}

/* ── عدد أيام العقد الكلي ── */
function daysTotal(start, end) {
  if (!start || !end) return 365;
  return Math.max(1, Math.ceil((new Date(end) - new Date(start)) / 86400000));
}

/* ══════════════════════════════════════════
   🔄  SYNC — يشتق ownerTenants و ownerContracts من contractsList
   ══════════════════════════════════════════ */
function syncDataFromContracts() {
  /* ownerContracts ← contractsList */
  ownerContracts = contractsList.map(c => ({
    name:     c.tenantName,
    space:    c.spaceCode,
    rent:     c.rent ? String(c.rent) : '—',
    start:    formatDate(c.startDate),
    end:      formatDate(c.endDate),
    daysLeft: c.daysLeft,
    status:   c.status === 'active'   ? 'سارية'
             : c.status === 'expiring' ? 'تنتهي قريباً'
             : c.status === 'renewal'  ? 'للمراجعة'
             : 'منتهية',
  }));

  /* ownerTenants ← contractsList + ratingsList */
  ownerTenants = contractsList
    .filter(c => c.status !== 'expired')
    .map(c => {
      const tenantRatings = ratingsList.filter(r => r.contractId === c.id);
      const sorted   = [...tenantRatings].sort((a, b) => b.month.localeCompare(a.month));
      const avgScore = tenantRatings.length
        ? parseFloat((tenantRatings.reduce((s, r) => s + r.avgScore, 0) / tenantRatings.length).toFixed(1))
        : null;
      const trend = sorted.length >= 2
        ? (sorted[0].avgScore > sorted[1].avgScore ? 'up'
          : sorted[0].avgScore < sorted[1].avgScore ? 'down' : 'flat')
        : 'flat';
      const statusLbl = !avgScore ? 'لا تقييم'
        : avgScore >= 8  ? 'ممتاز'
        : avgScore >= 6  ? 'جيد'
        : avgScore >= 4  ? 'متوسط'
        : 'ضعيف';
      return {
        id:        c.id,
        name:      c.tenantName,
        space:     c.spaceCode,
        act:       c.activity || '—',
        score:     avgScore,
        trend,
        statusLbl,
        icon:      getActivityIcon(c.activity),
        contract:  formatDate(c.endDate),
        daysLeft:  c.daysLeft,
      };
    });
}

/* ══════════════════════════════════════════
   📋  CONTRACTS CRUD
   ══════════════════════════════════════════ */
function submitContract(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim();
  const tenantName = get('cf-tenant');
  const spaceCode  = get('cf-space');
  const activity   = get('cf-activity');
  const rent       = parseFloat(get('cf-rent')) || 0;
  const startDate  = get('cf-start');
  const endDate    = get('cf-end');
  const notes      = get('cf-notes');

  if (endDate && startDate && endDate < startDate) {
    showContractMsg('danger', 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.');
    return;
  }

  const existing = editingContractId ? contractsList.find(c => c.id === editingContractId) : null;
  const contract = enrichContract({
    id:         editingContractId || genId(),
    tenantName, spaceCode, activity, rent, startDate, endDate, notes,
    createdAt:  existing?.createdAt || new Date().toISOString(),
  });

  if (editingContractId) {
    contractsList = contractsList.map(c => c.id === editingContractId ? contract : c);
  } else {
    contractsList.push(contract);
  }

  const wasEditing = !!editingContractId;
  saveContracts();
  syncDataFromContracts();
  renderAll();

  document.getElementById('contract-form')?.reset();
  cancelEditContract();
  showContractMsg('success', wasEditing ? '✅ تم تحديث العقد بنجاح.' : '✅ تمت إضافة العقد — يظهر المستأجر الآن في القائمة.');

  /* تحديث التنبيهات */
  updateNotifBadge();
}

function deleteContract(id) {
  if (!confirm('هل تريد حذف هذا العقد؟\nسيُزال المستأجر من القوائم ولا يمكن استرجاع العقد.')) return;
  contractsList = contractsList.filter(c => c.id !== id);
  /* احذف التقييمات المرتبطة أيضاً */
  ratingsList = ratingsList.filter(r => r.contractId !== id);
  saveContracts();
  saveRatings();
  syncDataFromContracts();
  renderAll();
}

function startEditContract(id) {
  const c = contractsList.find(x => x.id === id);
  if (!c) return;
  editingContractId = id;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('cf-tenant',   c.tenantName);
  set('cf-space',    c.spaceCode);
  set('cf-activity', c.activity);
  set('cf-rent',     c.rent);
  set('cf-start',    c.startDate);
  set('cf-end',      c.endDate);
  set('cf-notes',    c.notes);
  const titleEl = document.getElementById('contract-form-title');
  if (titleEl) titleEl.textContent = '✏️ تعديل العقد — ' + c.tenantName;
  const submitBtn = document.getElementById('contract-submit-btn');
  if (submitBtn) submitBtn.textContent = '✏️ تحديث العقد';
  const cancelBtn = document.getElementById('contract-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = '';
  document.getElementById('contract-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditContract() {
  editingContractId = null;
  const titleEl = document.getElementById('contract-form-title');
  if (titleEl) titleEl.textContent = '➕ إضافة عقد جديد';
  const submitBtn = document.getElementById('contract-submit-btn');
  if (submitBtn) submitBtn.textContent = '💾 حفظ العقد';
  const cancelBtn = document.getElementById('contract-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function showContractMsg(type, text) {
  const msg = document.getElementById('contract-msg');
  if (!msg) return;
  const ico = type === 'success' ? '✅' : '❌';
  msg.className = `alert-item ${type === 'success' ? 'success' : 'danger'}`;
  msg.style.display = 'flex';
  msg.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${text}</strong></div>`;
  setTimeout(() => { if (msg) msg.style.display = 'none'; }, 4000);
}

/* ══════════════════════════════════════════
   ⭐  RATINGS CRUD
   ══════════════════════════════════════════ */
function deleteRating(id) {
  if (!confirm('هل تريد حذف هذا التقييم؟')) return;
  ratingsList = ratingsList.filter(r => r.id !== id);
  saveRatings();
  syncDataFromContracts();
  renderAll();
}

/* ══════════════════════════════════════════
   🔐  SUPABASE — إعداد العميل
   ══════════════════════════════════════════ */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';

let sbClient = null;

function getSB() {
  if (!sbClient && window.supabase) {
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return sbClient;
}

/* ══════════════════════════════════════════
   🔐  AUTH — helpers
   ══════════════════════════════════════════ */

/** يظهر/يخفي رسالة الخطأ في صفحة اللوجين */
function showLoginError(msg) {
  const err = document.getElementById('login-error');
  if (!err) return;
  err.textContent = msg;
  err.style.display = 'block';
}
function hideLoginError() {
  const err = document.getElementById('login-error');
  if (err) err.style.display = 'none';
}

function showOwnerAccessGate(type, title, body) {
  const loginPage = document.getElementById('login-page');
  const app = document.getElementById('app');
  const titleEl = document.getElementById('access-title');
  const bodyEl = document.getElementById('access-body');
  const alertEl = document.getElementById('login-error');

  if (app) app.classList.remove('visible');
  if (loginPage) loginPage.style.display = 'flex';
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (alertEl) {
    alertEl.className = 'login-error ' + (type || 'info');
    alertEl.textContent = body;
    alertEl.style.display = 'block';
  }
}

/** حالة زر اللوجين (loading / normal) */
function setLoginLoading(isLoading) {
  const btn = document.getElementById('btn-login');
  if (!btn) return;
  btn.disabled    = isLoading;
  btn.textContent = isLoading ? '⏳ جاري التحقق…' : 'دخول للوحة التحكم ←';
}

/**
 * ✅ بعد نجاح الـ Auth — تتحقق من جدول profiles
 *    لو role = 'owner' → تفتح الداشبورد
 *    لو مش owner       → تعمل signOut وتعرض خطأ
 */
async function checkRoleAndProceed(user) {
  const sb = getSB();
  if (!sb) {
    showLoginError('⚠ خطأ في الاتصال — أعد تحميل الصفحة.');
    setLoginLoading(false);
    return;
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')          /* select * لتجنب خطأ الأعمدة غير الموجودة */
    .eq('id', user.id)
    .single();

  // 🛠 تشخيص — يظهر في Console للمطوّر فقط
  if (error) console.error('[Makani Dashboard] profiles query error:', JSON.stringify(error));
  if (!profile) console.warn('[Makani Dashboard] No profile row found for user id:', user.id);

  if (error || !profile) {
    // رسالة أوضح: هل المشكلة في الجدول أم في RLS أم في غياب الصف؟
    const detail = error
      ? `(${error.code}: ${error.message})`
      : '(لا يوجد صف في جدول profiles لهذا الحساب)';
    showOwnerAccessGate(
      'danger',
      'تعذّر التحقق من صلاحية الحساب',
      `لم نتمكن من قراءة بيانات حسابك. تواصل مع الإدارة لمراجعة الصلاحية. ${detail}`
    );
    setLoginLoading(false);
    return;
  }

  if (profile.role !== 'owner') {
    showOwnerAccessGate(
      'danger',
      'لوحة أصحاب المساحات غير مفعّلة لهذا الحساب',
      `حسابك الحالي مسجل كـ "${profile.role || 'tenant'}". اطلب ترقية الحساب من المنصة، وبعد تحويله إلى Owner ستفتح هذه اللوحة مباشرة.`
    );
    setLoginLoading(false);
    return;
  }

  /* ✅ role = owner → نبني currentOwner ونفتح الداشبورد */
  const displayName = profile.full_name || user.email || 'صاحب المساحة';
  currentOwner = {
    id:       user.id,
    username: user.email,
    email:    user.email,
    name:     displayName,
    place:    profile.place || '',
    initial:  displayName.charAt(0).toUpperCase(),
    phone:    profile.phone || '',
    role:     'owner',
  };

  sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));
  setLoginLoading(false);
  initDashboard();
}

/* ══════════════════════════════════════════
   1️⃣  تسجيل الدخول — Email + Password
   ══════════════════════════════════════════ */
async function doLogin() {
  await checkSessionOnLoad();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('app')?.classList.contains('visible')) {
    e.preventDefault();
  }
});

/* ══════════════════════════════════════════
   2️⃣  تسجيل الدخول — Google OAuth
   ══════════════════════════════════════════ */
async function doGoogleLogin() {
  hideLoginError();
  const sb = getSB();
  if (!sb) { showLoginError('⚠ Supabase غير متاح.'); return; }

  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href,  /* يرجع لنفس الصفحة بعد الـ OAuth */
    },
  });

  if (error) showLoginError('⚠ فشل تسجيل الدخول بـ Google: ' + error.message);
  /* لو نجح → Supabase يعمل redirect وعند الرجوع checkSessionOnLoad() بتشتغل */
}

/* ══════════════════════════════════════════
   تسجيل الخروج
   ══════════════════════════════════════════ */
async function doLogout() {
  const sb = getSB();
  if (sb) await sb.auth.signOut();

  sessionStorage.removeItem('ms_owner');
  currentOwner   = null;
  ownerSpaces    = [];
  ownerTenants   = [];
  ownerContracts = [];
  document.getElementById('app').classList.remove('visible');
  window.location.href = '/';
}

/* ══════════════════════════════════════════
   🚀  INIT DASHBOARD
   ══════════════════════════════════════════ */
function initDashboard() {
  setTxt('sb-initial', currentOwner.initial);
  setTxt('sb-name',    currentOwner.name);
  setTxt('sb-place',   currentOwner.place ? '📍 ' + currentOwner.place : '');

  /* ملء حقول الإعدادات تلقائياً */
  const stName  = document.getElementById('st-name');
  const stPhone = document.getElementById('st-phone');
  const stEmail = document.getElementById('st-email');
  if (stName)  stName.value  = currentOwner.name  || '';
  if (stPhone) stPhone.value = currentOwner.phone  || '';
  if (stEmail) stEmail.value = currentOwner.email  || '';

  /* تحميل العقود والتقييمات والمساحات المعلقة من localStorage */
  loadContractsLocal();
  loadRatingsLocal();
  loadPendingSpaces();
  syncDataFromContracts(); /* يُشتق منها ownerTenants و ownerContracts */

  loadOwnerData();
  loadNotifications();

  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').classList.add('visible');

  const firstNav = document.querySelector('[onclick*="overview"]');
  goTo('overview', firstNav);
}

/* ══════════════════════════════════════════
   📊  DATA LOADING
   🔗 DB-LINK: يجلب من Google Sheets ويفلتر بـ ownerId
   ══════════════════════════════════════════ */
async function loadOwnerData() {
  applyDemoData(); // عرض البيانات التجريبية فوراً كـ fallback

  try {
    const res  = await fetch(SHEET_URL);
    const data = await res.json();
    if (!data || !data.spaces) throw new Error('no spaces');

    /* 🔗 DB-LINK: فلتر المساحات حسب ownerId في الشيت */
    const mySpaces = (data.spaces || []).filter(s =>
      s.ownerId === currentOwner.id || s.ownerId === currentOwner.username
    );

    if (mySpaces.length > 0) {
      ownerSpaces = mySpaces.map(s => ({
        code:      s.unitId || s.id,
        loc:       s.location || s.loc || '—',
        size:      s.size || '—',
        act:       Array.isArray(s.acts) ? s.acts[0] : (s.acts || null),
        rent:      parseFloat(s.price) || null,
        status:    s.status || 'available',
        tenant:    s.tenant || null,
        score:     parseFloat(s.score) || null,
        daysEmpty: parseInt(s.daysEmpty) || 0,
        floor:     parseInt(s.floor) || 0,
      }));
      renderAll();
    }
  } catch {
    /* الـ fallback (DEMO data) مُعرَض بالفعل — لا شيء */
  }
}

function applyDemoData() {
  const id = currentOwner.id;
  /* المساحات: من البيانات التجريبية دائماً */
  ownerSpaces = DEMO_SPACES[id] || DEMO_SPACES[currentOwner.username] || [];

  /* المستأجرون والعقود: من contractsList إن وُجدت، وإلا demo */
  if (contractsList.length > 0) {
    syncDataFromContracts(); /* يعيد حساب ownerTenants و ownerContracts */
  } else {
    ownerTenants   = DEMO_TENANTS[id]   || DEMO_TENANTS[currentOwner.username] || [];
    ownerContracts = DEMO_CONTRACTS[id] || DEMO_CONTRACTS[currentOwner.username] || [];
  }

  renderAll();
}

function renderAll() {
  renderKPIs();
  renderOverview();
  renderSpaces();
  renderTenants();
  renderBestTenant();
  renderContracts();
  renderAlerts();
  renderRevenue();
  renderInsights();
  renderRatingsHistory();
  populateSelects();
}

/* ══════════════════════════════════════════
   💰  REVENUE VIEW — ديناميكي من ownerSpaces
   ══════════════════════════════════════════ */
function renderRevenue() {
  const active  = contractsList.filter(c => c.status !== 'expired');
  const monthly = active.reduce((sum, c) => sum + (parseFloat(c.rent) || 0), 0);
  const quarterly = monthly * 3;
  const yearly    = monthly * 12;
  const forecast  = Math.round(monthly * 1.05);

  const fmt = n => n ? n.toLocaleString('ar-EG') + ' ج' : '—';
  setTxt('rev-monthly',   fmt(monthly));
  setTxt('rev-quarterly', fmt(quarterly));
  setTxt('rev-yearly',    fmt(yearly));
  setTxt('rev-forecast',  fmt(forecast));

  const tbody = document.getElementById('revenue-tbody');
  if (!tbody) return;

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px">
      لا توجد عقود نشطة بعد — <button class="btn btn-primary btn-sm" onclick="goTo('contracts',document.querySelector('[data-view=contracts]'))">أضف عقداً ➕</button>
    </td></tr>`;
    return;
  }

  const total = monthly || 1;
  tbody.innerHTML = active.map(c => {
    const rent = parseFloat(c.rent) || 0;
    const pct  = Math.round((rent / total) * 100);
    let statusBadge = '';
    if (c.status === 'renewal')       statusBadge = `<span class="badge badge-red">تجديد عاجل</span>`;
    else if (c.status === 'expiring') statusBadge = `<span class="badge badge-yellow">ينتهي قريباً</span>`;
    else                              statusBadge = `<span class="badge badge-green">نشط</span>`;
    return `
      <tr>
        <td style="font-family:'Space Mono',monospace;color:var(--orange)">${c.spaceCode}</td>
        <td>${c.tenantName}</td>
        <td style="font-family:'Space Mono',monospace">${rent.toLocaleString('ar-EG')} ج</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="prog-bar" style="width:80px"><div class="prog-fill green" style="width:${pct}%"></div></div>
            <span style="font-size:11px;color:var(--text3)">${pct}%</span>
          </div>
        </td>
        <td>${statusBadge}</td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════
   🧠  INSIGHTS VIEW — محسوبة من البيانات
   ══════════════════════════════════════════ */
function renderInsights() {
  const urgentEl = document.getElementById('insights-urgent');
  const goodEl   = document.getElementById('insights-good');
  if (!urgentEl && !goodEl) return;

  const urgent = [];
  const good   = [];

  /* مساحات فارغة طويلاً */
  ownerSpaces
    .filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD)
    .forEach(s => urgent.push({
      ico:   '🏚️',
      color: 'var(--red)',
      title: `المساحة ${s.code} — فارغة منذ ${s.daysEmpty} يوم`,
      body:  `${s.loc} (${s.size}). مراجعة السعر أو توسيع الأنشطة المتاحة قد يسرّع إيجاد مستأجر.`,
    }));

  /* مستأجرون ضعيف أداؤهم */
  ownerTenants
    .filter(t => t.score < 5 && t.trend === 'down')
    .forEach(t => urgent.push({
      ico:   '📉',
      color: 'var(--red)',
      title: `${t.name} في ${t.space} — أداء ضعيف مستمر`,
      body:  `التقييم الحالي ${t.score}/10 ومتراجع. العقد ينتهي بعد ${t.daysLeft} يوم — ينصح بمراجعة الوضع.`,
    }));

  /* عقود تنتهي قريباً */
  ownerContracts
    .filter(c => c.daysLeft <= 30)
    .forEach(c => urgent.push({
      ico:   '⏰',
      color: 'var(--yellow)',
      title: `عقد ${c.name} ينتهي خلال ${c.daysLeft} يوم`,
      body:  `المساحة ${c.space} — تواصل مع المستأجر للتجديد أو ابدأ البحث عن بديل.`,
    }));

  /* مستأجرون ممتازون */
  ownerTenants
    .filter(t => t.score >= 8 && t.trend === 'up')
    .forEach(t => good.push({
      ico:   '⭐',
      color: 'var(--green)',
      title: `${t.name} — أداء ممتاز ومتصاعد`,
      body:  `تقييمه ${t.score}/10 في ازدياد. يُنصح بتجديد عقده مبكراً قبل انتهائه.`,
    }));

  /* مساحات جديدة بدون نشاط */
  ownerSpaces
    .filter(s => s.isNew && s.status === 'available')
    .forEach(s => good.push({
      ico:   '🆕',
      color: 'var(--blue)',
      title: `المساحة ${s.code} جديدة وجاهزة`,
      body:  `${s.loc} — أضفها على المنصة لجذب مستأجرين.`,
    }));

  /* render urgent */
  if (urgentEl) {
    if (!urgent.length) {
      urgentEl.innerHTML = `<div class="insight-card">
        <div class="insight-ico">✅</div>
        <div><div class="insight-title" style="color:var(--green)">لا توجد مشكلات عاجلة</div>
        <div class="insight-body">مساحاتك ومستأجروك يسيرون بشكل جيد حالياً.</div></div>
      </div>`;
    } else {
      urgentEl.innerHTML = urgent.map(u => `
        <div class="insight-card" style="border-color:rgba(255,77,77,0.30);background:rgba(255,77,77,0.06)">
          <div class="insight-ico">${u.ico}</div>
          <div><div class="insight-title" style="color:${u.color}">${u.title}</div>
          <div class="insight-body">${u.body}</div></div>
        </div>`).join('');
    }
  }

  /* render good/opportunities */
  if (goodEl) {
    if (!good.length) {
      goodEl.innerHTML = `<div class="insight-card">
        <div class="insight-ico">💡</div>
        <div><div class="insight-title">أضف بياناتك لتفعيل التوصيات</div>
        <div class="insight-body">بمجرد إضافة مساحاتك ومستأجريك، ستظهر هنا توصيات مخصصة.</div></div>
      </div>`;
    } else {
      goodEl.innerHTML = good.map(g => `
        <div class="insight-card">
          <div class="insight-ico">${g.ico}</div>
          <div><div class="insight-title" style="color:${g.color}">${g.title}</div>
          <div class="insight-body">${g.body}</div></div>
        </div>`).join('');
    }
  }
}

/* ══════════════════════════════════════════
   📋  RATINGS HISTORY — ديناميكي من ownerTenants
   ══════════════════════════════════════════ */
function renderRatingsHistory() {
  const tbody = document.getElementById('ratings-history-tbody');
  if (!tbody) return;

  if (!ratingsList.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px">لا توجد تقييمات بعد — ابدأ بتقييم مستأجريك</td></tr>`;
    return;
  }

  const sorted = [...ratingsList].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  tbody.innerHTML = sorted.map(r => {
    const col  = r.avgScore >= 8 ? 'var(--green)' : r.avgScore >= 6 ? 'var(--yellow)' : 'var(--red)';
    const [yr, mo] = r.month.split('-');
    const monthNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                        'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    const monthLbl = (monthNames[parseInt(mo, 10) - 1] || mo) + ' \'' + String(yr).slice(-2);
    return `
      <tr>
        <td>${r.tenantName}</td>
        <td style="font-family:'Space Mono',monospace;color:var(--text3)">${monthLbl}</td>
        <td><strong style="color:${col};font-family:'Space Mono',monospace">${r.avgScore}</strong>/10</td>
        <td style="font-size:11px;color:var(--text3)">${r.notes || '—'}</td>
        <td><button class="btn btn-sm" style="background:var(--red);color:#fff;padding:3px 10px;font-size:11px" onclick="deleteRating('${r.id}')">🗑️</button></td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════
   📈  KPIs
   ══════════════════════════════════════════ */
function renderKPIs() {
  const rented    = ownerSpaces.filter(s => s.status === 'rented');
  const avail     = ownerSpaces.filter(s => s.status === 'available');
  const maint     = ownerSpaces.filter(s => s.status === 'maintenance');

  /* الإيراد: من العقود الحقيقية أولاً، ثم من بيانات المساحات (demo) */
  const activeContracts = contractsList.filter(c => c.status !== 'expired');
  const monthly = activeContracts.length > 0
    ? activeContracts.reduce((sum, c) => sum + (parseFloat(c.rent) || 0), 0)
    : rented.reduce((sum, s) => sum + (s.rent || 0), 0);

  /* عدد المستأجرين: من العقود الحقيقية أولاً */
  const tenantsCount = activeContracts.length > 0 ? activeContracts.length : rented.length;

  const occ      = ownerSpaces.length ? Math.round((rented.length / ownerSpaces.length) * 100) : 0;

  /* متوسط التقييم: من ownerTenants (المبني من ratingsList الحقيقي) */
  const scoredT   = ownerTenants.filter(t => t.score !== null);
  const avgScore  = scoredT.length
    ? (scoredT.reduce((s, t) => s + (t.score || 0), 0) / scoredT.length).toFixed(1)
    : '—';
  const abandoned = ownerSpaces.filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD);
  const expiring  = contractsList.filter(c => c.status === 'expiring' || c.status === 'renewal');

  /* Overview KPIs */
  setTxt('kpi-revenue', monthly > 0 ? monthly.toLocaleString('ar-EG') : '—');
  setTxt('kpi-occ',     occ + '%');
  setTxt('kpi-tenants', String(tenantsCount));
  setTxt('kpi-score',   String(avgScore));

  const occBar = document.getElementById('kpi-occ-bar');
  if (occBar) occBar.style.width = occ + '%';

  /* Spaces view KPIs (pending = ownerPendingSpaces) */
  const totalSpaces = ownerSpaces.length || 1;
  setTxt('kpi-main',    String(rented.length));
  setTxt('kpi-avail',   String(avail.length));
  setTxt('kpi-maint',   String(maint.length));
  setTxt('kpi-pending', String(ownerPendingSpaces.length));
  const mainBar  = document.getElementById('kpi-main-bar');
  const availBar = document.getElementById('kpi-avail-bar');
  const maintBar = document.getElementById('kpi-maint-bar');
  if (mainBar)  mainBar.style.width  = Math.round((rented.length / totalSpaces) * 100) + '%';
  if (availBar) availBar.style.width = Math.round((avail.length  / totalSpaces) * 100) + '%';
  if (maintBar) maintBar.style.width = Math.round((maint.length  / totalSpaces) * 100) + '%';

  /* Sidebar badges */
  setTxt('nb-tenants',  String(tenantsCount));
  setTxt('nb-expiring', String(expiring.length));
  setTxt('nb-alerts',   String(abandoned.length + expiring.length));
}

/* ══════════════════════════════════════════
   🏠  OVERVIEW — يملأ كل عناصر الصفحة الرئيسية ديناميكياً
   ══════════════════════════════════════════ */
function renderOverview() {
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const COLORS    = ['var(--orange)','var(--green)','var(--blue)','var(--yellow)','var(--red)'];
  const NUM_AR    = ['١','٢','٣','٤','٥'];

  /* ── 1. Delta indicators على بطاقات KPI ─────────────────────────── */
  const activeContracts = contractsList.filter(c => c.status !== 'expired');
  const monthly  = activeContracts.reduce((s, c) => s + (parseFloat(c.rent) || 0), 0);
  const expiring = activeContracts.filter(c => c.status === 'expiring' || c.status === 'renewal');

  const revDelta = document.getElementById('kpi-rev-delta');
  if (revDelta) {
    if (monthly > 0) {
      revDelta.className = 'kpi-delta up';
      revDelta.textContent = `↑ ${activeContracts.length} عقد نشط`;
    } else {
      revDelta.className = 'kpi-delta flat';
      revDelta.textContent = '← أضف عقوداً للحساب';
    }
  }

  const occDelta = document.getElementById('kpi-occ-delta');
  if (occDelta) {
    const pct = ownerSpaces.length
      ? Math.round((ownerSpaces.filter(s => s.status === 'rented').length / ownerSpaces.length) * 100) : 0;
    occDelta.className = pct >= 70 ? 'kpi-delta up' : pct >= 40 ? 'kpi-delta flat' : 'kpi-delta down';
    occDelta.textContent = pct >= 70 ? '↑ إشغال جيد' : pct >= 40 ? '→ متوسط' : '↓ منخفض';
  }

  const tenDelta = document.getElementById('kpi-ten-delta');
  if (tenDelta) {
    if (expiring.length > 0) {
      tenDelta.className = 'kpi-delta down';
      tenDelta.textContent = `↓ ${expiring.length} ينتهي قريباً`;
    } else if (activeContracts.length > 0) {
      tenDelta.className = 'kpi-delta up';
      tenDelta.textContent = '↑ كل العقود سارية';
    } else {
      tenDelta.className = 'kpi-delta flat';
      tenDelta.textContent = '← لا توجد عقود';
    }
  }

  const scoreDelta = document.getElementById('kpi-score-delta');
  const starsEl    = document.getElementById('kpi-score-stars');
  const scoredT    = ownerTenants.filter(t => t.score !== null);
  if (scoredT.length) {
    const avg  = scoredT.reduce((s, t) => s + (t.score || 0), 0) / scoredT.length;
    const full = Math.min(5, Math.round(avg / 2));
    if (starsEl) starsEl.textContent = '★'.repeat(full) + '☆'.repeat(5 - full);
    if (scoreDelta) {
      scoreDelta.className = avg >= 8 ? 'kpi-delta up' : avg >= 6 ? 'kpi-delta flat' : 'kpi-delta down';
      scoreDelta.textContent = avg >= 8 ? '↑ ممتاز' : avg >= 6 ? '→ جيد' : '↓ يحتاج تحسين';
    }
  } else {
    if (starsEl)    starsEl.textContent = '☆☆☆☆☆';
    if (scoreDelta) { scoreDelta.className = 'kpi-delta flat'; scoreDelta.textContent = '← لا تقييمات بعد'; }
  }

  /* ── 2. أفضل المستأجرين (جدول ديناميكي) ────────────────────────── */
  const tbody = document.getElementById('overview-tenants-tbody');
  if (tbody) {
    const sorted = [...ownerTenants]
      .filter(t => t.score !== null)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 5);

    if (!sorted.length) {
      /* fallback: عرض المستأجرين بدون تقييم (من العقود النشطة) */
      const unratedTenants = ownerTenants.slice(0, 5);
      if (unratedTenants.length) {
        tbody.innerHTML = unratedTenants.map((t, i) => `
          <tr>
            <td><span style="color:var(--text3);font-family:'Space Mono',monospace">${NUM_AR[i] || i+1}</span></td>
            <td><strong>${t.name}</strong></td>
            <td style="color:var(--text2)">${t.space}</td>
            <td><span class="badge badge-orange">${t.icon} ${t.act !== '—' ? t.act : 'غير محدد'}</span></td>
            <td><span style="color:var(--text3);font-size:11px">لا تقييم</span></td>
            <td><span class="badge" style="background:var(--bg3);color:var(--text3)">—</span></td>
          </tr>`).join('');
      } else {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:24px;font-size:12px">
          أضف عقوداً ثم قيّم مستأجريك لتظهر هنا ←
          <button class="btn btn-sm btn-primary" style="margin-right:8px" onclick="goTo('contracts',document.querySelector('[onclick*=contracts]'))">أضف عقداً</button>
        </td></tr>`;
      }
    } else {
      tbody.innerHTML = sorted.map((t, i) => {
        const col  = t.score >= 8 ? 'var(--green)' : t.score >= 6 ? 'var(--yellow)' : 'var(--red)';
        const bCls = t.score >= 8 ? 'badge-green'  : t.score >= 6 ? 'badge-yellow'  : 'badge-red';
        const lbl  = t.score >= 8 ? 'ممتاز' : t.score >= 6 ? 'جيد' : t.score >= 4 ? 'متوسط' : 'ضعيف';
        const numEl = i === 0
          ? `<span style="color:var(--orange);font-weight:900;font-family:'Space Mono',monospace">١</span>`
          : t.score < 4
            ? `<span style="color:var(--red);font-family:'Space Mono',monospace">⚠</span>`
            : `<span style="color:var(--text3);font-family:'Space Mono',monospace">${NUM_AR[i]}</span>`;
        return `
          <tr>
            <td>${numEl}</td>
            <td><strong>${t.name}${t.act && t.act !== '—' ? ' — ' + t.act : ''}</strong></td>
            <td style="color:var(--text2)">${t.space}</td>
            <td><span class="badge badge-orange">${t.icon} ${t.act !== '—' ? t.act : '—'}</span></td>
            <td><strong style="color:${col};font-family:'Space Mono',monospace">${t.score}</strong></td>
            <td><span class="badge ${bCls}">${lbl}</span></td>
          </tr>`;
      }).join('');
    }
  }

  /* ── 3. التنبيهات المختصرة (أحدث 3) ────────────────────────────── */
  const alertsList = document.getElementById('overview-alerts-list');
  if (alertsList) {
    const previewAlerts = [];

    /* مستأجرون ضعيف أداؤهم */
    ownerTenants
      .filter(t => t.score !== null && t.score < 5 && t.trend === 'down')
      .slice(0, 1)
      .forEach(t => previewAlerts.push({
        cls: 'danger', ico: '📉',
        title: `تقييم ${t.name} منخفض (${t.score}/10)`,
        body:  `مستمر في التراجع — يُنصح بمراجعة الوضع.`,
      }));

    /* عقود تنتهي قريباً */
    contractsList
      .filter(c => c.status !== 'expired' && c.daysLeft >= 0 && c.daysLeft <= 30)
      .slice(0, 2)
      .forEach(c => previewAlerts.push({
        cls: c.daysLeft <= 14 ? 'danger' : 'warning', ico: '📅',
        title: `عقد ${c.tenantName} ينتهي خلال ${c.daysLeft} يوم`,
        body:  `المساحة ${c.spaceCode} — تواصل للتجديد أو ابحث عن بديل.`,
      }));

    /* مساحات مهملة */
    ownerSpaces
      .filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD)
      .slice(0, 2)
      .forEach(s => previewAlerts.push({
        cls: 'info', ico: '💡',
        title: `المساحة ${s.code} فارغة منذ ${s.daysEmpty} يوم`,
        body:  `${s.loc} — راجع السعر أو أوسع نطاق الأنشطة المسموحة.`,
      }));

    /* مساحات في الصيانة */
    ownerSpaces
      .filter(s => s.status === 'maintenance')
      .slice(0, 1)
      .forEach(s => previewAlerts.push({
        cls: 'warning', ico: '🔧',
        title: `المساحة ${s.code} في الصيانة`,
        body:  `${s.loc} — تأكد من انتهاء أعمال الصيانة في أقرب وقت.`,
      }));

    if (!previewAlerts.length) {
      alertsList.innerHTML = `
        <div class="alert-item success">
          <span class="alert-ico">✅</span>
          <div class="alert-text"><strong>لا توجد تنبيهات عاجلة حالياً</strong>كل شيء يسير بشكل جيد.</div>
        </div>`;
    } else {
      alertsList.innerHTML = previewAlerts.slice(0, 3).map(a => `
        <div class="alert-item ${a.cls}">
          <span class="alert-ico">${a.ico}</span>
          <div class="alert-text"><strong>${a.title}</strong> ${a.body}</div>
        </div>`).join('');
    }
  }

  /* ── 4. رسم بياني للإيرادات — آخر 6 شهور من العقود الحقيقية ──── */
  const chartEl = document.getElementById('overview-chart');
  if (chartEl) {
    const now    = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key:   `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: MONTHS_AR[d.getMonth()].slice(0, 3),
        total: 0,
      });
    }

    /* احسب إيراد كل شهر من العقود التي كانت سارية فيه */
    contractsList.forEach(c => {
      if (!c.startDate || !c.endDate || !c.rent) return;
      const start = new Date(c.startDate);
      const end   = new Date(c.endDate);
      const rent  = parseFloat(c.rent) || 0;
      months.forEach(m => {
        const mDate = new Date(m.key + '-01');
        if (mDate >= new Date(start.getFullYear(), start.getMonth(), 1) &&
            mDate <= new Date(end.getFullYear(),   end.getMonth(),   1)) {
          m.total += rent;
        }
      });
    });

    const maxTotal = Math.max(...months.map(m => m.total), 1);
    const lastIdx  = months.length - 1;

    if (months.every(m => m.total === 0)) {
      /* لا توجد عقود — عرض أعمدة placeholder */
      const pHts = [40, 55, 35, 70, 50, 80];
      chartEl.innerHTML = pHts.map((h, i) => `
        <div class="bar${i === lastIdx ? ' high' : ''}" style="height:${h}%;opacity:0.18">
          <span class="bar-label">${months[i].label}</span>
          <span class="bar-val">—</span>
        </div>`).join('');
    } else {
      chartEl.innerHTML = months.map((m, i) => {
        const h   = Math.max(8, Math.round((m.total / maxTotal) * 100));
        const val = m.total >= 1000
          ? (m.total / 1000).toFixed(0) + 'ك'
          : m.total > 0 ? m.total.toLocaleString('ar-EG') : '—';
        return `<div class="bar${i === lastIdx ? ' high' : ''}" style="height:${h}%">
          <span class="bar-label">${m.label}</span>
          <span class="bar-val">${val}</span>
        </div>`;
      }).join('');
    }
  }

  /* ── 5. توزيع الأنشطة ──────────────────────────────────────────── */
  const actsLegend = document.getElementById('overview-acts-legend');
  if (actsLegend) {
    const actCounts = {};
    ownerTenants.forEach(t => {
      const act = (t.act && t.act !== '—') ? t.act : 'أخرى';
      actCounts[act] = (actCounts[act] || 0) + 1;
    });
    const entries = Object.entries(actCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total   = ownerTenants.length || 1;

    if (!entries.length) {
      actsLegend.innerHTML = `<div class="donut-item" style="color:var(--text3);font-size:12px">أضف عقوداً لعرض توزيع الأنشطة</div>`;
    } else {
      actsLegend.innerHTML = entries.map(([act, count], i) => {
        const pct = Math.round((count / total) * 100);
        return `<div class="donut-item">
          <div class="donut-dot" style="background:${COLORS[i % COLORS.length]}"></div>
          ${act} (${pct}%)
        </div>`;
      }).join('');
    }
  }
}

/* ══════════════════════════════════════════
   📱  MOBILE SIDEBAR TOGGLE
   ══════════════════════════════════════════ */
function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const toggle   = document.getElementById('menu-toggle');
  if (!sidebar) return;

  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('active');
    if (toggle)  toggle.classList.add('is-open');
    document.body.style.overflow = 'hidden'; /* منع تمرير الخلفية */
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const toggle  = document.getElementById('menu-toggle');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
  if (toggle)  toggle.classList.remove('is-open');
  document.body.style.overflow = '';
}

/* ══════════════════════════════════════════
   🗺️  NAVIGATION
   ══════════════════════════════════════════ */
const VIEW_TITLES = {
  'overview':  'نظرة عامة',
  'tenants':   'المستأجرون',
  'spaces':    'المساحات',
  'contracts': 'العقود',
  'ratings':   'التقييمات',
  'revenue':   'الإيرادات',
  'insights':  'الرؤى والتوصيات',
  'add-space': 'إضافة مساحة جديدة',
  'add-bazaar':'تنظيم بازار',
  'alerts':    'التنبيهات',
  'settings':  'الإعدادات',
};

function goTo(viewId, navEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  setTxt('topbar-title', VIEW_TITLES[viewId] || viewId);

  /* على الموبايل: أغلق السايدبار بعد الاختيار */
  if (window.innerWidth <= 900) closeSidebar();
}

function setPeriod(p, btn) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  /* 🔗 DB-LINK: أعد جلب البيانات حسب الفترة من الشيت */
}

/* ══════════════════════════════════════════
   🗺️  SPACES VIEW
   ══════════════════════════════════════════ */
function renderSpaces() {
  /* ── طلبات الإضافة المعلقة ── */
  const pendingSec = document.getElementById('pending-spaces-section');
  if (pendingSec) {
    if (ownerPendingSpaces.length) {
      pendingSec.style.display = 'block';
      pendingSec.innerHTML = `
        <div class="pcard" style="border-color:rgba(255,184,0,0.35)">
          <div class="pcard-head" style="background:rgba(255,184,0,0.06)">
            <div>
              <div class="pcard-title" style="color:var(--yellow)">⏳ طلبات إضافة قيد المراجعة (${ownerPendingSpaces.length})</div>
              <div class="pcard-sub">أُرسلت للمنصة — فريق مكاني Spot سيراجعها ويضيفها خلال 24 ساعة</div>
            </div>
          </div>
          <div class="pcard-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>اسم المساحة</th><th>النوع</th><th>المنطقة</th><th>الأحجام</th><th>السعر</th><th>الوحدات</th><th>تاريخ الإرسال</th><th></th></tr></thead>
              <tbody>
                ${ownerPendingSpaces.map(p => {
                  const typeLabels = { mall:'🏬 مول', club:'🏊 نادي', school:'🏫 مدرسة' };
                  const sentDate   = p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('ar-EG') : '—';
                  return `<tr style="background:rgba(255,184,0,0.03)">
                    <td style="font-weight:700">${p.name}</td>
                    <td>${typeLabels[p.type] || p.type}</td>
                    <td>${p.loc}</td>
                    <td style="font-size:11px;color:var(--text3)">${p.sizes || '—'}</td>
                    <td style="font-family:'Space Mono',monospace">${p.price ? p.price.toLocaleString('ar-EG')+' ج' : '—'}</td>
                    <td style="text-align:center">${p.subCount > 0 ? `<span class="badge badge-blue">${p.subCount} وحدة</span>` : '—'}</td>
                    <td style="font-size:11px;color:var(--text3)">${sentDate}</td>
                    <td><button class="btn btn-sm" style="background:none;border:1px solid var(--red);color:var(--red);font-size:11px" onclick="removePendingSpace('${p.id}')">إلغاء</button></td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
    } else {
      pendingSec.style.display = 'none';
    }
  }

  const tbody          = document.getElementById('spaces-tbody');
  const abandonedSec   = document.getElementById('abandoned-section');
  const abandonedTbody = document.getElementById('abandoned-tbody');
  if (!tbody) return;

  const abandonedSpaces = ownerSpaces.filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD);

  /* ── قسم المساحات المهملة ── */
  if (abandonedSec) {
    if (abandonedSpaces.length) {
      abandonedSec.style.display = 'block';
      if (abandonedTbody) {
        abandonedTbody.innerHTML = abandonedSpaces.map(s => `
          <tr style="background:rgba(255,77,77,0.04)">
            <td style="font-family:'Space Mono',monospace;color:var(--red)">${s.code}</td>
            <td>${s.loc}</td>
            <td style="font-family:'Space Mono',monospace">${s.size}</td>
            <td><span class="badge badge-red">⚠ ${s.daysEmpty} يوم فارغة</span></td>
            <td>
              <button class="btn btn-primary btn-sm" onclick="goTo('add-space', document.querySelector('[data-view=add-space]'))">+ طلب مستأجر</button>
            </td>
          </tr>`).join('');
      }
    } else {
      abandonedSec.style.display = 'none';
    }
  }

  /* ── جدول كل المساحات ── */
  if (!ownerSpaces.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:30px;font-size:13px">
      لم تُضَف أي مساحات بعد — <button class="btn btn-primary btn-sm" onclick="goTo('add-space',document.querySelector('[data-view=add-space]'))">أضف الآن ➕</button>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = ownerSpaces.map(s => {
    const statusMap = {
      rented:      { cls:'badge-green',  lbl:'مؤجّرة' },
      available:   { cls:'badge-yellow', lbl:'متاحة' },
      maintenance: { cls:'badge-red',    lbl:'صيانة' },
    };
    const st          = statusMap[s.status] || { cls:'badge-blue', lbl:s.status };
    const isAbandoned = s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD;
    const codeColor   = isAbandoned ? 'var(--red)' : 'var(--orange)';
    const progCls     = !s.score ? '' : s.score >= 8 ? 'green' : s.score >= 6 ? 'yellow' : 'red';
    const progPct     = s.score ? s.score * 10 : 0;

    return `
      <tr ${isAbandoned ? 'style="background:rgba(255,77,77,0.04)"' : ''}>
        <td style="font-family:'Space Mono',monospace;color:${codeColor}">${s.code}</td>
        <td>${s.loc}</td>
        <td>${s.size}</td>
        <td>${s.act ? `<span class="badge badge-orange">${s.act}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
        <td style="font-family:'Space Mono',monospace">${s.rent ? s.rent.toLocaleString('ar-EG') + ' ج' : '—'}</td>
        <td>
          <span class="badge ${st.cls}">${st.lbl}</span>
          ${isAbandoned ? `<span style="font-size:10px;color:var(--red);display:block;margin-top:3px;font-family:'Space Mono',monospace">${s.daysEmpty}d فارغة</span>` : ''}
        </td>
        <td>
          ${s.score
            ? `<div class="prog-bar" style="width:80px"><div class="prog-fill ${progCls}" style="width:${progPct}%"></div></div>`
            : '<span style="color:var(--text3);font-size:11px">—</span>'}
        </td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════
   👥  TENANTS VIEW
   ══════════════════════════════════════════ */
function renderTenants() {
  const tbody = document.getElementById('tenants-tbody');
  if (!tbody) return;

  if (!ownerTenants.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:30px">لا يوجد مستأجرون حتى الآن</td></tr>';
    return;
  }

  tbody.innerHTML = ownerTenants.map(t => {
    const col   = t.score >= 8 ? 'var(--green)' : t.score >= 6 ? 'var(--yellow)' : 'var(--red)';
    const arrow = t.trend === 'up' ? '↑' : t.trend === 'down' ? '↓' : '→';
    const tCls  = t.trend === 'up' ? 'up' : t.trend === 'down' ? 'down' : 'flat';
    const bCls  = t.score >= 8 ? 'badge-green' : t.score >= 6 ? 'badge-yellow' : 'badge-red';
    const pCls  = t.score >= 8 ? 'green' : t.score >= 6 ? 'yellow' : 'red';

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:8px;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${t.icon}</div>
            <div>
              <div style="font-size:13px;font-weight:800;color:var(--text)">${t.name}</div>
              <div style="font-size:10px;color:var(--text3);font-family:'Space Mono',monospace">${t.act}</div>
            </div>
          </div>
        </td>
        <td style="font-family:'Space Mono',monospace;color:var(--orange)">${t.space}</td>
        <td>${t.act}</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <strong style="color:${col};font-family:'Space Mono',monospace;font-size:16px">${t.score}</strong>
            <span class="kpi-delta ${tCls}" style="font-size:11px">${arrow}</span>
          </div>
          <div class="prog-bar" style="width:80px;margin-top:4px">
            <div class="prog-fill ${pCls}" style="width:${t.score*10}%"></div>
          </div>
        </td>
        <td>
          <div class="prog-bar" style="width:80px">
            <div class="prog-fill ${pCls}" style="width:${t.score*10}%"></div>
          </div>
        </td>
        <td><span class="badge ${bCls}">${t.statusLbl}</span></td>
        <td><button class="btn btn-sm" onclick="showTenantDetail(${t.id})">عرض</button></td>
      </tr>`;
  }).join('');
}

function showTenantDetail(id) {
  const t = ownerTenants.find(x => x.id === id);
  if (!t) return;

  setTxt('td-name',  t.name + ' — ' + t.act);
  setTxt('td-space', 'المساحة: ' + t.space + ' · العقد حتى: ' + t.contract);

  const criteria = [
    { label:'⏰ الالتزام بالمواعيد', score: clamp(Math.round(t.score * 0.9  + jitter())) },
    { label:'🧹 نظافة المكان',        score: clamp(Math.round(t.score * 1.0  + jitter(0.5))) },
    { label:'🎨 شكل البراند',         score: clamp(Math.round(t.score * 0.85 + jitter())) },
    { label:'🤝 تعامل مع العملاء',    score: clamp(Math.round(t.score * 1.1)) },
    { label:'💼 الالتزام بالعقد',     score: clamp(Math.round(t.score * 0.95 + jitter(0.5))) },
  ];

  const scoresEl = document.getElementById('td-scores');
  if (scoresEl) {
    scoresEl.innerHTML = criteria.map(c => {
      const cls = c.score >= 8 ? 'green' : c.score >= 6 ? 'yellow' : 'red';
      return `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
            <span>${c.label}</span><strong style="font-family:'Space Mono',monospace">${c.score}/10</strong>
          </div>
          <div class="prog-bar"><div class="prog-fill ${cls}" style="width:${c.score*10}%"></div></div>
        </div>`;
    }).join('');
  }

  const months = ['أكت','نوف','ديس','يناير','فبراير'];
  const scores = months.map((_, i) => clamp(t.score + jitter(2) - (i === 4 ? 0 : 0.2 * (4 - i))));
  const maxS   = Math.max(...scores);

  const chartEl = document.getElementById('td-chart');
  if (chartEl) {
    chartEl.innerHTML = scores.map((s, i) => {
      const h   = Math.round((s / maxS) * 100);
      const cls = i === scores.length - 1 ? 'high' : '';
      return `<div class="bar ${cls}" style="height:${h}%"><span class="bar-label">${months[i]}</span><span class="bar-val">${s.toFixed(1)}</span></div>`;
    }).join('');
  }

  const detail = document.getElementById('tenant-detail');
  if (detail) {
    detail.style.display = 'block';
    detail.scrollIntoView({ behavior:'smooth', block:'start' });
  }
}

const clamp  = v => Math.min(10, Math.max(1, v));
const jitter = (r = 1) => (Math.random() - 0.5) * r;

/* ══════════════════════════════════════════
   📄  CONTRACTS VIEW — من contractsList الحقيقي
   ══════════════════════════════════════════ */
function renderContracts() {
  renderContractKPIs();
  const cont = document.getElementById('contracts-list');
  if (!cont) return;

  if (!contractsList.length) {
    cont.innerHTML = `<div class="pcard" style="margin-bottom:20px">
      <div class="pcard-body" style="text-align:center;padding:40px 20px">
        <div style="font-size:48px;margin-bottom:12px">📄</div>
        <div style="font-size:14px;font-weight:700;color:var(--text2);margin-bottom:6px">لم تُضَف عقود بعد</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.7">
          أضف أول عقد باستخدام النموذج أدناه.<br>
          ستظهر التنبيهات وبيانات الإيرادات والمستأجرين تلقائياً بعد الإضافة.
        </div>
      </div>
    </div>`;
    return;
  }

  cont.innerHTML = contractsList.map(c => {
    const total   = daysTotal(c.startDate, c.endDate);
    const elapsed = total - Math.max(0, c.daysLeft);
    const progPct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
    const bCls    = c.status === 'active'    ? 'badge-green'
                  : c.status === 'expiring'  ? 'badge-yellow'
                  : c.status === 'renewal'   ? 'badge-red'
                  : 'badge-blue';
    const statusLbl = c.status === 'active'   ? 'سارية'
                    : c.status === 'expiring' ? 'تنتهي قريباً'
                    : c.status === 'renewal'  ? 'للتجديد'
                    : c.status === 'expired'  ? 'منتهية' : '—';
    const fCls = c.daysLeft < 14 ? 'red' : c.daysLeft < 30 ? 'yellow' : 'green';
    const tenantRatings = ratingsList.filter(r => r.contractId === c.id);
    const avgScore = tenantRatings.length
      ? (tenantRatings.reduce((s, r) => s + r.avgScore, 0) / tenantRatings.length).toFixed(1)
      : null;

    return `
      <div class="contract-card" id="ccard-${c.id}">
        <div class="contract-head">
          <div>
            <div class="contract-name">${c.tenantName}</div>
            <div class="contract-space">📍 ${c.spaceCode}${c.activity ? ' · ' + c.activity : ''}</div>
          </div>
          <div style="text-align:left">
            <span class="badge ${bCls}">${statusLbl}</span>
            <div style="font-size:10px;color:var(--text3);margin-top:4px;font-family:'Space Mono',monospace">
              ${c.daysLeft > 0 ? c.daysLeft + ' يوم متبقي' : 'منتهي'}
            </div>
          </div>
        </div>
        <div class="contract-meta">
          <span>📅 البداية: ${formatDate(c.startDate)}</span>
          <span>📅 النهاية: ${formatDate(c.endDate)}</span>
          <span>💰 ${c.rent ? c.rent.toLocaleString('ar-EG') : '—'} ج/شهر</span>
          ${avgScore ? `<span>⭐ تقييم: ${avgScore}/10</span>` : ''}
        </div>
        <div class="contract-bar">
          <div class="contract-bar-top">
            <span>تقدم العقد</span>
            <span style="font-family:'Space Mono',monospace">${progPct}%</span>
          </div>
          <div class="prog-bar"><div class="prog-fill ${fCls}" style="width:${progPct}%"></div></div>
        </div>
        ${c.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:6px">📝 ${c.notes}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-sm" onclick="startEditContract('${c.id}')">✏️ تعديل</button>
          <button class="btn btn-sm" style="color:var(--red);border-color:rgba(255,77,77,0.25)" onclick="deleteContract('${c.id}')">🗑️ حذف</button>
        </div>
      </div>`;
  }).join('');
}

function renderContractKPIs() {
  const toAr = n => n.toLocaleString('ar-EG');
  setTxt('kpi-c-total',    toAr(contractsList.length));
  setTxt('kpi-c-active',   toAr(contractsList.filter(c => c.status === 'active').length));
  setTxt('kpi-c-expiring', toAr(contractsList.filter(c => c.status === 'expiring').length));
  setTxt('kpi-c-renewal',  toAr(contractsList.filter(c => c.status === 'renewal').length));
}

/* ── أفضل مستأجر — من التقييمات الفعلية ── */
function renderBestTenant() {
  const banner = document.getElementById('best-tenant-banner');
  if (!banner) return;

  const withScores = ownerTenants.filter(t => t.score !== null);
  if (!withScores.length) {
    banner.innerHTML = `
      <div style="font-size:28px">🏆</div>
      <div>
        <div style="font-size:13px;font-weight:800;color:var(--orange)">أفضل مستأجر هذا الشهر</div>
        <div style="font-size:13px;color:var(--text2);margin-top:3px">لم يتم إجراء تقييمات بعد.</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">قيّم مستأجريك من صفحة التقييمات لتفعيل هذا القسم.</div>
      </div>`;
    return;
  }

  const best = [...withScores].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
  const col  = best.score >= 8 ? 'var(--green)' : best.score >= 6 ? 'var(--yellow)' : 'var(--red)';
  const stars = '★'.repeat(Math.round(best.score / 2)) + '☆'.repeat(5 - Math.round(best.score / 2));
  banner.innerHTML = `
    <div style="font-size:32px">🏆</div>
    <div>
      <div style="font-size:13px;font-weight:800;color:var(--orange)">أفضل مستأجر — بناءً على تقييماتك</div>
      <div style="font-size:15px;font-weight:900;color:var(--text)">${best.name}${best.act && best.act !== '—' ? ' — ' + best.act : ''}</div>
      <div style="font-size:11px;color:var(--text2)">تقييم ${best.score}/10 · المساحة ${best.space}</div>
    </div>
    <div style="margin-right:auto;text-align:center">
      <div style="font-size:28px;font-weight:900;color:${col};font-family:'Space Mono',monospace">${best.score}</div>
      <div class="stars-sm">${stars}</div>
    </div>`;
}

/* ══════════════════════════════════════════
   🚨  ALERTS — محسوبة من البيانات + Supabase
   ══════════════════════════════════════════ */
function renderAlerts() {
  const list = document.getElementById('alerts-list');
  if (!list) return;

  const alerts = [];

  /* ── تنبيهات Supabase (مساحات + بازارات) ── */
  supabaseNotifications.forEach(n => {
    const typeMap = {
      'space_submitted': { type:'info',    ico:'📋', title:'طلب إضافة مساحة جديدة',      body: n.message || 'تم إرسال طلب إضافة المساحة — في انتظار المراجعة.' },
      'space_approved':  { type:'success', ico:'✅', title:'تمت الموافقة على المساحة',    body: n.message || 'تمت الموافقة على مساحتك وهي الآن قيد الإعداد للنشر.' },
      'space_published': { type:'success', ico:'🚀', title:'تم نشر المساحة على المنصة',  body: n.message || 'مساحتك أصبحت مرئية للمستأجرين على منصة مكاني Spot.' },
      'space_rejected':  { type:'danger',  ico:'❌', title:'تم رفض طلب المساحة',         body: n.message || 'راجع بيانات المساحة وأعد تقديم الطلب.' },
      'bazaar_submitted':{ type:'info',    ico:'🎪', title:'طلب تنظيم بازار قيد المراجعة',body: n.message || 'تم استلام طلب البازار وسيتم الرد خلال 24 ساعة.' },
      'bazaar_approved': { type:'success', ico:'🎉', title:'تمت الموافقة على البازار',     body: n.message || 'تمت الموافقة على بازارك وسيُنشر على المنصة قريباً.' },
      'bazaar_rejected': { type:'danger',  ico:'⚠️', title:'مراجعة مطلوبة على طلب البازار', body: n.message || 'يوجد ملاحظات على طلب البازار — تواصل مع الإدارة لمعرفة التفاصيل.' },
      'bazaar_updated':  { type:'warning', ico:'🔄', title:'تحديث على حالة البازار',       body: n.message || 'حدث تغيير في حالة طلب البازار — راجع التفاصيل.' },
    };
    const mapped = typeMap[n.type] || { type:'info', ico:'🔔', title: n.title || 'إشعار جديد', body: n.message || '' };
    alerts.push(mapped);
  });

  /* ── تنبيهات محلية: مساحات مهملة ── */
  ownerSpaces
    .filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD)
    .forEach(s => alerts.push({
      type:  'danger',
      ico:   '🏚️',
      title: `المساحة ${s.code} مهملة منذ ${s.daysEmpty} يوم`,
      body:  `${s.loc} (${s.size}) — لم تُؤجَّر منذ فترة. مكاني Spot تستطيع مساعدتك في إيجاد مستأجر مناسب.`,
    }));

  /* ── تقييمات منخفضة ومتراجعة ── */
  ownerTenants
    .filter(t => t.score < 5 && t.trend === 'down')
    .forEach(t => alerts.push({
      type:  'danger',
      ico:   '📉',
      title: `تقييم ${t.name} منخفض باستمرار`,
      body:  `التقييم الحالي ${t.score}/10 ومتراجع. العقد ينتهي بعد ${t.daysLeft} يوم — يُنصح بمراجعة الوضع.`,
    }));

  /* ── عقود تنتهي قريباً ── */
  ownerContracts
    .filter(c => c.daysLeft <= 30)
    .forEach(c => alerts.push({
      type:  'warning',
      ico:   '📅',
      title: `عقد ${c.name} ينتهي خلال ${c.daysLeft} يوم`,
      body:  `المساحة ${c.space} — تواصل مع المستأجر للتجديد أو ابدأ البحث عن بديل.`,
    }));

  /* ── دفعات متأخرة ── */
  ownerTenants
    .filter(t => t.score < 5)
    .forEach(t => alerts.push({
      type:  'warning',
      ico:   '💳',
      title: `تحقق من دفعات ${t.name}`,
      body:  `المستأجر يعاني من أداء ضعيف — تأكد من انتظام الدفع.`,
    }));

  /* ── لا مساحات مضافة ── */
  if (!ownerSpaces.length) {
    alerts.push({ type:'info', ico:'💡', title:'لم تُضَف مساحات بعد', body:'ابدأ بإضافة مساحاتك ليراها المستأجرون على المنصة.' });
  }

  /* تحديث badge الجرس بعد بناء القائمة */
  updateNotifBadge();

  if (!alerts.length) {
    list.innerHTML = `<div class="alert-item success">
      <span class="alert-ico">✅</span>
      <div class="alert-text"><strong>لا توجد تنبيهات حالياً</strong>كل شيء يسير بشكل ممتاز.</div>
    </div>`;
    return;
  }

  list.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.type}">
      <span class="alert-ico">${a.ico}</span>
      <div class="alert-text"><strong>${a.title}</strong>${a.body}</div>
    </div>`).join('');
}

/* ══════════════════════════════════════════
   📦  PENDING SPACES — localStorage
   ══════════════════════════════════════════ */
function pendingSpacesKey() { return 'ms_pending_' + (currentOwner?.id || 'guest'); }

function loadPendingSpaces() {
  try {
    const raw = localStorage.getItem(pendingSpacesKey());
    ownerPendingSpaces = raw ? JSON.parse(raw) : [];
  } catch { ownerPendingSpaces = []; }
}

function savePendingSpaces() {
  localStorage.setItem(pendingSpacesKey(), JSON.stringify(ownerPendingSpaces));
}

function removePendingSpace(id) {
  if (!confirm('هل تريد إلغاء هذا الطلب؟')) return;
  ownerPendingSpaces = ownerPendingSpaces.filter(p => p.id !== id);
  savePendingSpaces();
  renderSpaces();
}

/* ══════════════════════════════════════════
   ➕  ADD SPACE FORM — الأحجام
   ══════════════════════════════════════════ */
function addSizeRow() {
  const container = document.getElementById('as-sizes-container');
  const emptyMsg  = document.getElementById('as-sizes-empty-msg');
  if (!container) return;
  if (emptyMsg) emptyMsg.style.display = 'none';

  const idx = asSizeRowCount++;
  const div = document.createElement('div');
  div.id = 'as-size-row-' + idx;
  div.style.cssText = 'display:grid;grid-template-columns:2fr 2fr 40px;gap:8px;margin-bottom:8px;align-items:center';
  div.innerHTML = `
    <input type="text"   id="as-size-label-${idx}" placeholder="مثال: ١×١ م" style="width:100%" oninput="calcDefaultPrice()">
    <input type="number" id="as-size-price-${idx}" placeholder="السعر/شهر" min="0" style="width:100%;font-family:'Space Mono',monospace" oninput="calcDefaultPrice()">
    <button type="button" onclick="removeSizeRow(${idx})"
            style="background:none;border:1px solid var(--red);color:var(--red);border-radius:var(--r);padding:6px 10px;cursor:pointer;font-size:13px;line-height:1">✕</button>`;
  container.appendChild(div);
  calcDefaultPrice();
}

function removeSizeRow(idx) {
  const el = document.getElementById('as-size-row-' + idx);
  if (el) el.remove();
  calcDefaultPrice();
  const container = document.getElementById('as-sizes-container');
  const emptyMsg  = document.getElementById('as-sizes-empty-msg');
  if (container && !container.children.length && emptyMsg) emptyMsg.style.display = 'block';
}

function calcDefaultPrice() {
  const prices = Array.from(document.querySelectorAll('[id^="as-size-price-"]'))
    .map(r => parseFloat(r.value) || 0).filter(p => p > 0);
  const avg = prices.length ? Math.round(prices.reduce((a,b)=>a+b,0) / prices.length) : 0;
  const hiddenEl  = document.getElementById('as-default-price');
  const displayEl = document.getElementById('as-price-display');
  if (hiddenEl) hiddenEl.value = avg;
  if (displayEl) {
    if (avg > 0) {
      displayEl.style.display = 'block';
      displayEl.innerHTML = `💰 السعر الافتراضي المحسوب: <strong style="font-family:'Space Mono',monospace">${avg.toLocaleString('ar-EG')} ج.م.</strong> / شهر`;
    } else {
      displayEl.style.display = 'none';
    }
  }
}

function getSizesString() {
  const sizes = [];
  document.querySelectorAll('[id^="as-size-row-"]').forEach(row => {
    const idx   = row.id.replace('as-size-row-', '');
    const label = document.getElementById('as-size-label-' + idx)?.value.trim();
    const price = document.getElementById('as-size-price-' + idx)?.value.trim();
    if (label) sizes.push(price ? `${label}:${price}` : label);
  });
  return sizes.join(' · ');
}

function addAct(act) {
  const el = document.getElementById('as-acts');
  if (!el) return;
  const cur = el.value.trim();
  if (!cur) { el.value = act; return; }
  if (!cur.split('·').map(s=>s.trim()).includes(act)) el.value = cur + ' · ' + act;
}

function getAmenitiesString() {
  const checked = Array.from(document.querySelectorAll('[id^="as-amen-"]:checked')).map(c => c.value);
  const custom  = document.getElementById('as-amen-custom')?.value.trim();
  if (custom) checked.push(...custom.split('،').map(s=>s.trim()).filter(Boolean));
  return checked.join('·');
}

function updateSpaceIcon() {
  const type    = document.getElementById('as-type')?.value;
  const iconSel = document.getElementById('as-icon');
  if (!iconSel || !type) return;
  const defaults = { mall:'🏬', club:'🏊', school:'🏫' };
  if (defaults[type]) iconSel.value = defaults[type];
}

/* ══════════════════════════════════════════
   ➕  ADD SPACE FORM — الوحدات الفرعية
   ══════════════════════════════════════════ */
function addSubUnitRow() {
  const container = document.getElementById('as-units-container');
  const emptyMsg  = document.getElementById('as-units-empty-msg');
  if (!container) return;
  if (emptyMsg) emptyMsg.style.display = 'none';

  const idx = asUnitCounter++;
  const div = document.createElement('div');
  div.id = 'as-unit-row-' + idx;
  div.dataset.idx = idx;
  div.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:var(--r2);padding:16px;margin-bottom:14px';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <div style="font-weight:700;color:var(--orange);font-size:13px">📦 وحدة فرعية #${idx+1}</div>
      <button type="button" onclick="removeSubUnitRow(${idx})"
              style="background:none;border:1px solid var(--red);color:var(--red);border-radius:var(--r);padding:4px 12px;cursor:pointer;font-size:12px">حذف ✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">كود الوحدة <span style="color:var(--red)">*</span></label>
        <input type="text" id="as-unit-uid-${idx}" placeholder="مثال: A1, B2, G-15">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">اسم الوحدة <span style="color:var(--red)">*</span></label>
        <input type="text" id="as-unit-name-${idx}" placeholder="مثال: كشك أمام المصعد">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">الدور</label>
        <select id="as-unit-floor-${idx}">
          <option value="">اختر</option>
          <option value="أرضي">أرضي</option>
          <option value="أول">أول</option>
          <option value="ثاني">ثاني</option>
          <option value="ثالث">ثالث</option>
          <option value="بدروم">بدروم</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">المساحة <span style="color:var(--red)">*</span></label>
        <input type="text" id="as-unit-size-${idx}" placeholder="مثال: ١×١ م، ٢م²">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">السعر / شهر (ج.م.)</label>
        <input type="number" id="as-unit-price-${idx}" placeholder="مثال: 4500" min="0" style="font-family:'Space Mono',monospace">
      </div>
      <div class="form-group" style="margin:0">
        <label style="font-size:12px">الحالة</label>
        <select id="as-unit-status-${idx}">
          <option value="available">✅ متاحة</option>
          <option value="rented">🔴 مؤجّرة</option>
          <option value="reserved">🟡 محجوزة</option>
        </select>
      </div>
    </div>
    <div class="form-group" style="margin-top:10px">
      <label style="font-size:12px">الموقع الدقيق داخل المساحة</label>
      <input type="text" id="as-unit-loc-${idx}" placeholder="مثال: أمام المصعد، الركن الغربي">
    </div>
    <div class="form-group" style="margin-top:6px">
      <label style="font-size:12px">ملاحظات</label>
      <input type="text" id="as-unit-notes-${idx}" placeholder="أي تفاصيل إضافية">
    </div>
    <div style="margin-top:12px">
      <label style="font-size:12px;color:var(--text2);display:block;margin-bottom:6px">📷 صورة الوحدة (اختياري)</label>
      <div id="as-unit-img-zone-${idx}"
           style="border:2px dashed rgba(255,107,0,0.3);border-radius:var(--r);padding:14px;text-align:center;cursor:pointer;background:var(--orange-pale);transition:all 0.2s"
           onclick="document.getElementById('as-unit-img-${idx}').click()"
           onmouseenter="this.style.borderColor='var(--orange)'"
           onmouseleave="this.style.borderColor='rgba(255,107,0,0.3)'">
        <div style="font-size:20px">📤</div>
        <div style="font-size:11px;color:var(--orange);font-weight:600;margin-top:3px">اختر صورة الوحدة</div>
      </div>
      <input type="file" id="as-unit-img-${idx}" accept="image/*" style="display:none" onchange="handleUnitImageUpload(this,${idx})">
      <div id="as-unit-img-preview-${idx}" style="margin-top:8px"></div>
    </div>`;
  container.appendChild(div);
}

function removeSubUnitRow(idx) {
  const el = document.getElementById('as-unit-row-' + idx);
  if (el) el.remove();
  const container = document.getElementById('as-units-container');
  const emptyMsg  = document.getElementById('as-units-empty-msg');
  if (container && !container.children.length && emptyMsg) emptyMsg.style.display = 'block';
}

async function handleUnitImageUpload(input, idx) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    alert('الصورة أكبر من 5 ميجا — اختر صورة أصغر.');
    input.value = ''; return;
  }
  const resized = await resizeBazaarImage(file, 800, 600, 0.82);
  input.dataset.imgDataUrl = resized;
  const preview = document.getElementById('as-unit-img-preview-' + idx);
  if (preview) {
    preview.innerHTML = `
      <div style="position:relative">
        <img src="${resized}" style="width:100%;max-height:130px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border)">
        <button type="button"
                onclick="clearUnitImage(${idx})"
                style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:22px;text-align:center">✕</button>
      </div>`;
    const zone = document.getElementById('as-unit-img-zone-' + idx);
    if (zone) zone.style.display = 'none';
  }
}

function clearUnitImage(idx) {
  const input   = document.getElementById('as-unit-img-' + idx);
  const preview = document.getElementById('as-unit-img-preview-' + idx);
  const zone    = document.getElementById('as-unit-img-zone-' + idx);
  if (input)   { input.value = ''; delete input.dataset.imgDataUrl; }
  if (preview) preview.innerHTML = '';
  if (zone)    zone.style.display = 'block';
}

/* ── صورة رئيسية للمساحة ── */
async function handleMainSpaceImageUpload(input) {
  const file      = input.files?.[0];
  const preview   = document.getElementById('as-main-img-preview');
  const statusEl  = document.getElementById('as-main-img-status');
  const uploadIco = document.getElementById('as-main-upload-ico');
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">❌ أكبر من 5 ميجا</span>';
    input.value = ''; return;
  }
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--orange)">⏳ جاري المعالجة…</span>';
  asMainImgDataUrl = await resizeBazaarImage(file, 1200, 800, 0.85);
  if (preview) {
    preview.innerHTML = `
      <div style="position:relative;margin-top:8px">
        <img src="${asMainImgDataUrl}" style="width:100%;border-radius:var(--r);max-height:180px;object-fit:cover;border:2px solid rgba(0,200,83,0.30)">
        <button type="button" onclick="clearMainSpaceImage()"
                style="position:absolute;top:5px;left:5px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:12px;line-height:24px;text-align:center">✕</button>
      </div>`;
  }
  if (statusEl)  statusEl.innerHTML  = '<span style="color:var(--green)">✅ جاهزة للإرسال</span>';
  if (uploadIco) uploadIco.textContent = '✅';
}

function clearMainSpaceImage() {
  asMainImgDataUrl = null;
  const preview   = document.getElementById('as-main-img-preview');
  const input     = document.getElementById('as-main-img-input');
  const statusEl  = document.getElementById('as-main-img-status');
  const uploadIco = document.getElementById('as-main-upload-ico');
  if (preview)   preview.innerHTML    = '';
  if (input)     input.value          = '';
  if (statusEl)  statusEl.textContent = 'لم تُرفع';
  if (uploadIco) uploadIco.textContent = '📤';
}

/* ── صور إضافية للمساحة ── */
async function handleExtraSpaceImagesUpload(input) {
  const files     = Array.from(input.files).slice(0, 5 - asExtraImgsData.filter(Boolean).length);
  const container = document.getElementById('as-extra-imgs-container');
  if (!files.length || !container) return;
  for (const file of files) {
    if (file.size > 5 * 1024 * 1024) continue;
    const resized = await resizeBazaarImage(file, 1000, 700, 0.82);
    const idx     = asExtraImgsData.length;
    asExtraImgsData.push({ dataUrl: resized, name: file.name });
    const div = document.createElement('div');
    div.id = 'as-extra-img-' + idx;
    div.style.cssText = 'position:relative;width:calc(50% - 4px);flex-shrink:0';
    div.innerHTML = `
      <img src="${resized}" style="width:100%;height:90px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border)">
      <button type="button" onclick="removeExtraSpaceImage(${idx})"
              style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:20px;text-align:center">✕</button>`;
    container.appendChild(div);
  }
  input.value = '';
}

function removeExtraSpaceImage(idx) {
  asExtraImgsData[idx] = null;
  const el = document.getElementById('as-extra-img-' + idx);
  if (el) el.remove();
}

function collectSubUnits() {
  const units = [];
  document.querySelectorAll('[id^="as-unit-row-"]').forEach(div => {
    const idx     = div.dataset.idx;
    const imgInput = document.getElementById('as-unit-img-' + idx);
    const uid  = document.getElementById('as-unit-uid-' + idx)?.value.trim()   || '';
    const name = document.getElementById('as-unit-name-' + idx)?.value.trim() || '';
    if (!uid && !name) return;
    units.push({
      unitId:     uid,
      name:       name,
      floor:      document.getElementById('as-unit-floor-' + idx)?.value   || '',
      size:       document.getElementById('as-unit-size-' + idx)?.value.trim() || '',
      price:      parseFloat(document.getElementById('as-unit-price-' + idx)?.value) || 0,
      status:     document.getElementById('as-unit-status-' + idx)?.value  || 'available',
      location:   document.getElementById('as-unit-loc-' + idx)?.value.trim() || '',
      notes:      document.getElementById('as-unit-notes-' + idx)?.value.trim() || '',
      imgDataUrl: imgInput?.dataset?.imgDataUrl || '',
      imgName:    imgInput?.files?.[0]?.name || (uid + '.jpg'),
    });
  });
  return units;
}

/* ══════════════════════════════════════════
   ➕  ADD SPACE FORM
   🔗 DB-LINK: يرسل للـ Apps Script → يحفظ في الشيت
   ══════════════════════════════════════════ */
function populateSelects() {
  const available = ownerSpaces.filter(s => s.status === 'available');

  /* قائمة المساحات الفارغة في نموذج العقد */
  document.querySelectorAll('.select-available-space').forEach(sel => {
    sel.innerHTML = available.map(s => `<option value="${s.code}">${s.code} — ${s.loc}</option>`).join('');
  });

  /* قائمة المستأجرين في نموذج التقييم — من contractsList */
  document.querySelectorAll('.select-tenant').forEach(sel => {
    const active = contractsList.filter(c => c.status !== 'expired');
    sel.innerHTML = '<option value="">اختر المستأجر</option>' +
      active.map(c => `<option value="${c.id}">${c.tenantName} — ${c.spaceCode}</option>`).join('');
  });
}

async function submitAddSpace(e) {
  e.preventDefault();
  const btn = document.getElementById('add-space-btn');
  const msg = document.getElementById('add-space-msg');
  if (!btn || !msg) return;

  const get = id => document.getElementById(id)?.value?.trim() || '';

  const spaceName = get('as-name');
  const spaceType = get('as-type');
  const spaceLoc  = get('as-loc');

  if (!spaceName || !spaceType || !spaceLoc) {
    msg.className   = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML   = `<span class="alert-ico">❌</span><div class="alert-text"><strong>اسم المساحة ونوعها ومنطقتها مطلوبة.</strong></div>`;
    return;
  }

  btn.disabled  = true;
  btn.innerHTML = '⏳ جاري إرسال الطلب…';
  msg.style.display = 'none';

  const typeMap = {
    mall:   { badge:'متاح', badgeClass:'badge-avail', thumbClass:'thumb-mall' },
    club:   { badge:'متاح', badgeClass:'badge-info',  thumbClass:'thumb-club' },
    school: { badge:'متاح', badgeClass:'badge-warn',  thumbClass:'thumb-school' },
  };
  const tm = typeMap[spaceType] || typeMap.mall;

  const subUnits = collectSubUnits();

  /* ═══ Payload — يطابق أعمدة شيتي المساحات والوحدات الفرعية ═══ */
  const payload = {
    action:       'addSpace',
    /* Owner info */
    ownerId:      currentOwner.id,
    ownerName:    currentOwner.name,
    ownerPhone:   currentOwner.phone  || '',
    ownerEmail:   currentOwner.email  || '',
    ownerPlace:   currentOwner.place  || '',
    /* B-U: شيت "🏢 المساحات" */
    name:         spaceName,                          /* B */
    type:         spaceType,                          /* C */
    loc:          spaceLoc,                           /* D */
    badge:        get('as-badge') || tm.badge,        /* E */
    badgeClass:   tm.badgeClass,                      /* F */
    icon:         get('as-icon') || '🏬',             /* I */
    thumbClass:   tm.thumbClass,                      /* J */
    sizes:        getSizesString(),                   /* K */
    defaultPrice: parseFloat(get('as-default-price')) || 0, /* L */
    allActs:      document.getElementById('as-all-acts')?.checked ? 'نعم' : 'لا', /* M */
    acts:         get('as-acts'),                     /* N */
    season:       get('as-season'),                   /* O */
    insight:      get('as-insight'),                  /* P */
    description:  get('as-desc'),                     /* Q */
    amenities:    getAmenitiesString(),               /* R */
    visible:      'لا',                               /* S — غير ظاهر حتى الموافقة */
    order:        parseInt(get('as-order')) || 99,    /* T */
    notes:        get('as-notes'),                    /* U */
    /* الصور */
    mainImageDataUrl: asMainImgDataUrl || '',
    mainImageName:    document.getElementById('as-main-img-input')?.files?.[0]?.name || (spaceName + '.jpg'),
    extraImages:      asExtraImgsData.filter(Boolean),
    /* الوحدات الفرعية */
    subUnits:         subUnits,
    timestamp:        new Date().toISOString(),
  };

  try {
    await fetch(ADD_SPACE_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    /* حفظ محلي كـ pending */
    const pendingEntry = {
      id:          'ps-' + Date.now(),
      name:        spaceName,
      type:        spaceType,
      loc:         spaceLoc,
      sizes:       getSizesString(),
      price:       parseFloat(get('as-default-price')) || 0,
      acts:        get('as-acts'),
      subCount:    subUnits.length,
      status:      'pending',
      submittedAt: new Date().toISOString(),
    };
    ownerPendingSpaces.push(pendingEntry);
    savePendingSpaces();
    renderSpaces();

    msg.className     = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">✅</span>
      <div class="alert-text">
        <strong>تم إرسال طلب إضافة المساحة بنجاح!</strong><br>
        تظهر في شيت المساحات بحالة <strong>غير ظاهر</strong> — فريق مكاني Spot سيراجعها ويضيفها خلال 24 ساعة.<br>
        <div style="margin-top:6px;font-size:11px;color:var(--text3)">للمتابعة: واتساب 01103467711</div>
      </div>`;

    /* إعادة ضبط النموذج */
    document.getElementById('add-space-form')?.reset();
    clearMainSpaceImage();
    asExtraImgsData = [];
    const extraCont = document.getElementById('as-extra-imgs-container');
    const sizesCont = document.getElementById('as-sizes-container');
    const unitsCont = document.getElementById('as-units-container');
    if (extraCont) extraCont.innerHTML = '';
    if (sizesCont) sizesCont.innerHTML = '';
    if (unitsCont) unitsCont.innerHTML = '';
    asSizeRowCount = 0; asUnitCounter = 0;
    const sizeEmpty = document.getElementById('as-sizes-empty-msg');
    const unitEmpty = document.getElementById('as-units-empty-msg');
    const priceDisp = document.getElementById('as-price-display');
    if (sizeEmpty) sizeEmpty.style.display = 'block';
    if (unitEmpty) unitEmpty.style.display = 'block';
    if (priceDisp) priceDisp.style.display = 'none';

  } catch {
    msg.className     = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">❌</span>
      <div class="alert-text"><strong>تعذّر إرسال الطلب</strong><br>تأكد من الاتصال بالإنترنت وأعد المحاولة، أو تواصل معنا على واتساب 01103467711.</div>`;
  }

  btn.disabled  = false;
  btn.innerHTML = '🚀 إرسال طلب إضافة المساحة';
}

/* ══════════════════════════════════════════
   🖼️  IMAGE UPLOAD (Preview — الرفع الفعلي عبر Apps Script)
   🔗 DB-LINK: أرسل الصور لـ Google Drive عبر:
       const fd = new FormData();
       files.forEach(f => fd.append('file', f));
       fd.append('ownerId', currentOwner.id);
       await fetch(DRIVE_UPLOAD_URL, { method:'POST', body:fd });
   ══════════════════════════════════════════ */
function handleImageUpload(input) {
  const files   = Array.from(input.files);
  const preview = document.getElementById('img-preview');
  if (!files.length || !preview) return;

  preview.innerHTML = files.slice(0, 5).map(f => {
    const url = URL.createObjectURL(f);
    return `<div style="position:relative;display:inline-block;margin:4px">
      <img src="${url}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid var(--border)">
      <div style="position:absolute;bottom:0;left:0;right:0;font-size:9px;color:#fff;background:rgba(0,0,0,0.55);padding:2px 4px;border-radius:0 0 8px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.name}</div>
    </div>`;
  }).join('');
}

async function handleBazaarImageUpload(input) {
  const file      = input.files?.[0];
  const preview   = document.getElementById('bz-img-preview');
  const statusEl  = document.getElementById('bz-img-status');
  const uploadIco = document.getElementById('bz-upload-ico');
  if (!file || !preview) return;

  /* تحقق من الحجم */
  if (file.size > 5 * 1024 * 1024) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">❌ الصورة أكبر من 5 ميجا</span>';
    input.value = '';
    return;
  }

  if (statusEl) statusEl.innerHTML = '<span style="color:var(--orange)">⏳ جاري المعالجة…</span>';

  /* ضغط وتحجيم الصورة */
  const resized = await resizeBazaarImage(file, 1200, 800, 0.85);
  bzImageDataUrl = resized;

  /* معاينة مع زر حذف */
  preview.innerHTML = `
    <div style="position:relative;margin-top:4px">
      <img src="${resized}" style="width:100%;border-radius:var(--r);max-height:200px;object-fit:cover;border:2px solid rgba(0,200,83,0.35)">
      <button type="button" onclick="clearBazaarImage()"
              style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:13px;line-height:26px;text-align:center">✕</button>
      <div style="position:absolute;bottom:0;left:0;right:0;font-size:10px;color:#fff;background:rgba(0,0,0,0.55);padding:4px 8px;border-radius:0 0 var(--r) var(--r);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${file.name}</div>
    </div>`;

  if (statusEl)  statusEl.innerHTML  = '<span style="color:var(--green)">✅ جاهزة للإرسال</span>';
  if (uploadIco) uploadIco.textContent = '✅';
}

function clearBazaarImage() {
  bzImageDataUrl = null;
  const preview = document.getElementById('bz-img-preview');
  const input   = document.getElementById('bz-img-input');
  const statusEl  = document.getElementById('bz-img-status');
  const uploadIco = document.getElementById('bz-upload-ico');
  if (preview)   preview.innerHTML    = '';
  if (input)     input.value          = '';
  if (statusEl)  statusEl.textContent = 'لم تُرفع بعد';
  if (uploadIco) uploadIco.textContent = '📤';
}

/* ضغط الصورة عبر Canvas */
function resizeBazaarImage(file, maxW, maxH, quality) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* حساب الأيام والإيراد المتوقع في الوقت الفعلي */
function updateBazaarCalc() {
  const start  = document.getElementById('bz-start')?.value;
  const end    = document.getElementById('bz-end')?.value;
  const slots  = parseInt(document.getElementById('bz-total-slots')?.value) || 0;
  const price  = parseFloat(document.getElementById('bz-price')?.value)      || 0;

  /* عدد الأيام */
  const daysEl  = document.getElementById('bz-days-display');
  const daysVal = document.getElementById('bz-days-val');
  if (start && end && end >= start && daysEl && daysVal) {
    const diff = Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1;
    daysVal.textContent   = diff;
    daysEl.style.display  = 'block';
  } else if (daysEl) {
    daysEl.style.display  = 'none';
  }

  /* الإيراد المتوقع */
  const revEl  = document.getElementById('bz-rev-display');
  const revVal = document.getElementById('bz-rev-val');
  if (slots > 0 && price > 0 && revEl && revVal) {
    revVal.textContent  = (slots * price).toLocaleString('ar-EG');
    revEl.style.display = 'block';
  } else if (revEl) {
    revEl.style.display = 'none';
  }
}

async function submitAddBazaar(e) {
  e.preventDefault();
  const btn = document.getElementById('add-bazaar-btn');
  const msg = document.getElementById('add-bazaar-msg');
  if (!btn || !msg) return;

  const get = id => document.getElementById(id)?.value?.trim() || '';

  const startDate  = get('bz-start');
  const endDate    = get('bz-end');
  const totalSlots = parseInt(get('bz-total-slots')) || 0;
  const price      = parseFloat(get('bz-price'))     || 0;

  /* Validation */
  if (endDate && startDate && endDate < startDate) {
    msg.className   = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML   = `<span class="alert-ico">❌</span><div class="alert-text"><strong>تاريخ النهاية يجب أن يكون بعد تاريخ البداية.</strong></div>`;
    return;
  }

  const daysCount   = (startDate && endDate)
    ? Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1
    : 1;
  const expectedRev = totalSlots * price;

  btn.disabled     = true;
  btn.innerHTML    = '⏳ جاري إرسال الطلب…';
  msg.style.display = 'none';

  /* ═══ Payload — يطابق أعمدة شيت Bazaars تماماً ═══ */
  const payload = {
    action:       'addBazaar',
    /* معلومات صاحب المساحة */
    ownerId:      currentOwner.id,
    ownerName:    currentOwner.name,
    ownerEmail:   currentOwner.email  || '',
    ownerPhone:   currentOwner.phone  || '',
    ownerPlace:   currentOwner.place  || '',
    /* B→T أعمدة شيت Bazaars */
    name:         get('bz-name'),          /* B */
    description:  get('bz-description'),   /* C */
    venueType:    get('bz-venue-type'),     /* D */
    venueName:    get('bz-venue-name'),     /* E */
    area:         get('bz-area'),          /* F */
    address:      get('bz-address'),       /* G */
    dateStart:    startDate,               /* H */
    dateEnd:      endDate,                 /* I */
    daysCount:    daysCount,               /* J */
    totalSlots:   totalSlots,             /* K */
    availSlots:   totalSlots,             /* L — نفس العدد في البداية */
    bookedSlots:  0,                       /* M */
    price:        price,                   /* N */
    expectedRev:  expectedRev,            /* O */
    collectedRev: 0,                       /* P */
    minSpace:     parseFloat(get('bz-min-space')) || 2, /* Q */
    status:       'pending',              /* R */
    tags:         get('bz-tags'),          /* T */
    /* الصورة (base64 مضغوطة) → Apps Script يرفعها على Drive */
    imageDataUrl: bzImageDataUrl || '',
    imageName:    document.getElementById('bz-img-input')?.files?.[0]?.name || (get('bz-name') + '.jpg'),
    imageType:    'image/jpeg',
    timestamp:    new Date().toISOString(),
  };

  try {
    await fetch(ADD_BAZAAR_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    msg.className   = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML   = `<span class="alert-ico">✅</span>
      <div class="alert-text">
        <strong>تم إرسال طلب تنظيم البازار بنجاح!</strong><br>
        البيانات ستظهر في شيت Bazaars بحالة <strong>pending</strong>. فريق مكاني Spot سيراجع الطلب وينشره على المنصة.
        <div style="margin-top:6px;font-size:11px;color:var(--text3)">للمتابعة: واتساب 01103467711</div>
      </div>`;

    document.getElementById('add-bazaar-form')?.reset();
    clearBazaarImage();
    const daysEl = document.getElementById('bz-days-display');
    const revEl  = document.getElementById('bz-rev-display');
    if (daysEl) daysEl.style.display = 'none';
    if (revEl)  revEl.style.display  = 'none';

  } catch {
    msg.className   = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML   = `<span class="alert-ico">❌</span>
      <div class="alert-text"><strong>تعذّر إرسال الطلب</strong><br>تأكد من الاتصال بالإنترنت وأعد المحاولة، أو تواصل معنا على واتساب 01103467711.</div>`;
  }

  btn.disabled  = false;
  btn.innerHTML = '🚀 إرسال طلب تنظيم البازار';
}

/* ══════════════════════════════════════════
   ⭐  RATINGS
   ══════════════════════════════════════════ */
const AR_NUMS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'];

function updateRVal(idx, val) {
  const el = document.getElementById('rv-' + idx);
  if (el) el.textContent = AR_NUMS[parseInt(val)] || val;
  updateAvgRating();
}

function updateAvgRating() {
  const sliders = document.querySelectorAll('#rate-criteria input[type=range]');
  if (!sliders.length) return;
  const avg = Array.from(sliders).reduce((s, r) => s + parseInt(r.value), 0) / sliders.length;
  setTxt('rate-avg', avg.toFixed(1));
}

function submitRating() {
  const contractId = document.getElementById('rate-tenant')?.value;
  const month      = document.getElementById('rate-month')?.value;
  const msgEl      = document.getElementById('rate-msg');

  const showMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${type}`;
    msgEl.style.display = 'flex';
    const ico = type === 'success' ? '✅' : '❌';
    msgEl.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${text}</strong></div>`;
    setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
  };

  if (!contractId) { showMsg('danger', 'اختر المستأجر أولاً.'); return; }
  if (!month)      { showMsg('danger', 'اختر الشهر أولاً.');    return; }

  const contract = contractsList.find(c => c.id === contractId);
  if (!contract) { showMsg('danger', 'لم يُعثر على العقد.'); return; }

  const sliders = document.querySelectorAll('#rate-criteria input[type=range]');
  const vals    = Array.from(sliders).map(s => parseInt(s.value));
  const [schedule, cleanliness, brand, customerService, contractCompliance] = vals;
  const avgScore = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
  const notes    = document.getElementById('rate-notes')?.value.trim() || '';

  const rating = {
    id: genId(),
    contractId,
    tenantName: contract.tenantName,
    space: contract.spaceCode,
    month,
    scores: { schedule, cleanliness, brand, customerService, contractCompliance },
    avgScore,
    notes,
    createdAt: new Date().toISOString(),
  };

  ratingsList.push(rating);
  saveRatings();
  syncDataFromContracts();
  renderAll();

  /* reset form */
  document.getElementById('rate-tenant').value = '';
  document.getElementById('rate-month').value  = '';
  sliders.forEach((s, i) => { s.value = [7,8,6,9,10][i]; updateRVal(i, s.value); });
  if (document.getElementById('rate-notes')) document.getElementById('rate-notes').value = '';

  showMsg('success', `تم حفظ التقييم! المتوسط: ${avgScore}/10`);
}

/* ══════════════════════════════════════════
   ⚙️  SETTINGS
   ══════════════════════════════════════════ */
async function saveSettings() {
  const name  = document.getElementById('st-name')?.value.trim();
  const phone = document.getElementById('st-phone')?.value.trim();
  const msgEl = document.getElementById('settings-msg');

  const showSettingsMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${type}`;
    msgEl.style.display = 'flex';
    const ico = type === 'success' ? '✅' : '❌';
    msgEl.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${text}</strong></div>`;
    setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
  };

  if (!name) { showSettingsMsg('danger', 'الاسم الكامل مطلوب.'); return; }

  if (name)  { currentOwner.name  = name;  setTxt('sb-name', name); }
  if (phone)   currentOwner.phone = phone;

  sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));

  /* 🔗 DB-LINK: احفظ في جدول profiles في Supabase */
  const sb = getSB();
  if (sb && currentOwner.id) {
    const updateData = { full_name: name };
    if (phone) updateData.phone = phone;
    await sb.from('profiles').update(updateData).eq('id', currentOwner.id);
  }

  showSettingsMsg('success', 'تم حفظ البيانات بنجاح!');
}

/* ══════════════════════════════════════════
   🔔  NOTIFICATIONS — جلب من Supabase + badge
   ══════════════════════════════════════════ */

/* تنبيهات من Supabase (من جدول notifications لو موجود) */
let supabaseNotifications = [];
let bzImageDataUrl = null; /* بيانات صورة البازار (base64 مضغوطة) */

/* ── state لصفحة إضافة المساحة ── */
let asMainImgDataUrl   = null;  /* صورة رئيسية للمساحة */
let asExtraImgsData    = [];    /* [{dataUrl, name}] — صور إضافية */
let asSizeRowCount     = 0;     /* عداد صفوف الأحجام */
let asUnitCounter      = 0;     /* عداد الوحدات الفرعية */
let ownerPendingSpaces = [];    /* مساحات معلقة محفوظة محلياً */

async function loadNotifications() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;

  try {
    const { data, error } = await sb
      .from('notifications')
      .select('*')
      .eq('owner_id', currentOwner.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error && data) {
      supabaseNotifications = data;
      updateNotifBadge();
      renderAlerts(); /* أعد رسم التنبيهات مع البيانات الجديدة */
    }
  } catch {
    /* جدول notifications غير موجود بعد — التنبيهات المحلية تعمل */
  }
}

function updateNotifBadge() {
  /* احسب إجمالي التنبيهات: المحلية + Supabase */
  const localAlerts = countLocalAlerts();
  const sbCount     = supabaseNotifications.length;
  const total       = localAlerts + sbCount;

  const badge   = document.getElementById('notif-badge');
  const dot     = document.getElementById('notif-dot');
  const bellNav = document.getElementById('nb-alerts');

  if (badge) {
    if (total > 0) {
      badge.textContent = total > 99 ? '99+' : String(total);
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }

  /* إخفاء النقطة القديمة عند وجود الـ badge */
  if (dot) dot.style.display = total > 0 ? 'none' : 'block';

  /* تحديث الـ badge في السايدبار أيضاً */
  if (bellNav) bellNav.textContent = String(total || '');
}

function countLocalAlerts() {
  let count = 0;
  count += ownerSpaces.filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD).length;
  count += ownerTenants.filter(t => t.score < 5 && t.trend === 'down').length;
  count += ownerContracts.filter(c => c.daysLeft <= 30).length;
  if (!ownerSpaces.length) count += 1;
  return count;
}

/* ══════════════════════════════════════════
   🛠️  HELPERS
   ══════════════════════════════════════════ */
function setTxt(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

/* ══════════════════════════════════════════
   3️⃣  حماية الصفحة عند التحميل
   ══════════════════════════════════════════ */

/**
 * تشتغل فور تحميل الصفحة:
 * ① لو مفيش Supabase session → صفحة اللوجين
 * ② لو فيه session بس role مش owner → signOut + صفحة اللوجين
 * ③ لو owner ✅ → تفتح الداشبورد مباشرة
 */
async function checkSessionOnLoad() {
  if (ownerAuthChecked) return;
  ownerAuthChecked = true;

  const sb = getSB();

  if (!sb) {
    showOwnerAccessGate(
      'danger',
      'تعذّر الاتصال بنظام الحسابات',
      'لا يمكن فتح لوحة أصحاب المساحات بدون التحقق من حساب المنصة وصلاحية Owner.'
    );
    return;
  }

  /* ── تحقق من الـ Supabase session ── */
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    sessionStorage.removeItem('ms_owner');
    showOwnerAccessGate(
      'info',
      'ادخل من حسابك على منصة مكاني Spot',
      'لا توجد جلسة منصة نشطة في هذا المتصفح. سجل الدخول أو أنشئ حسابًا عاديًا من المنصة، ثم اطلب ترقية الحساب إلى Owner.'
    );
    return;
  }

  /* ── فيه session: تحقق من الـ role ── */
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')          /* select * لتجنب خطأ الأعمدة غير الموجودة */
    .eq('id', session.user.id)
    .single();

  if (error || !profile || profile.role !== 'owner') {
    sessionStorage.removeItem('ms_owner');
    showOwnerAccessGate(
      'danger',
      'لوحة أصحاب المساحات غير مفعّلة لهذا الحساب',
      `حسابك الحالي ${profile?.role ? `مسجل كـ "${profile.role}"` : 'لم يتم العثور على صلاحية Owner له'}. بعد تحويله إلى Owner ستدخل للوحة مباشرة من المنصة.`
    );
    return;
  }

  /* ✅ owner — افتح الداشبورد */
  const displayName = profile.full_name || session.user.email || 'صاحب المساحة';
  currentOwner = {
    id:       session.user.id,
    username: session.user.email,
    email:    session.user.email,
    name:     displayName,
    place:    profile.place || '',
    initial:  displayName.charAt(0).toUpperCase(),
    phone:    profile.phone || '',
    role:     'owner',
  };
  sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));
  initDashboard();
}

/* ══════════════════════════════════════════
   4️⃣  تغيير كلمة السر من جوه الداشبورد
   ══════════════════════════════════════════ */
async function changePassword() {
  const newPwd    = document.getElementById('pwd-new')?.value?.trim();
  const confirmPwd= document.getElementById('pwd-confirm')?.value?.trim();
  const msgEl     = document.getElementById('pwd-msg');

  const showMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${type}`;
    msgEl.style.display = 'flex';
    const ico = type === 'success' ? '✅' : '❌';
    msgEl.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${text}</strong></div>`;
    setTimeout(() => { msgEl.style.display = 'none'; }, 5000);
  };

  if (!newPwd || newPwd.length < 8) {
    showMsg('danger', 'كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل.');
    return;
  }
  if (newPwd !== confirmPwd) {
    showMsg('danger', 'كلمة المرور الجديدة وتأكيدها غير متطابقتين.');
    return;
  }

  const sb = getSB();
  if (!sb) { showMsg('danger', 'Supabase غير متاح — لا يمكن تغيير كلمة المرور.'); return; }

  const btn = document.getElementById('btn-change-pwd');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحديث…'; }

  const { error } = await sb.auth.updateUser({ password: newPwd });

  if (btn) { btn.disabled = false; btn.textContent = '🔑 تحديث كلمة المرور'; }

  if (error) {
    showMsg('danger', 'فشل التحديث: ' + error.message);
  } else {
    showMsg('success', 'تم تغيير كلمة المرور بنجاح! ✅');
    if (document.getElementById('pwd-new'))     document.getElementById('pwd-new').value = '';
    if (document.getElementById('pwd-confirm')) document.getElementById('pwd-confirm').value = '';
  }
}

/* ══════════════════════════════════════════
   🚀  BOOTSTRAP — يُشغَّل عند تحميل الصفحة
   ══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', checkSessionOnLoad);

/* ══════════════════════════════════════════
   🔄  INIT ON PAGE LOAD
   ══════════════════════════════════════════ */
window.addEventListener('load', () => checkSessionOnLoad());
