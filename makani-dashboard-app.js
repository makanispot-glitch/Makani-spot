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
const ADD_SPACE_URL = BOOKING_URL; // مؤقت — غيّره لرابط Apps Script خاص بإضافة المساحات

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

/* ══════════════════════════════════════════
   🔐  SUPABASE — إعداد العميل
   ══════════════════════════════════════════ */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_otT0XEGfHw3LI2OyFIIMeQ_eXcrkWZ3';

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
  if (!sb) return;

  const { data: profile, error } = await sb
    .from('profiles')
    .select('role, full_name, place, phone')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    await sb.auth.signOut();
    showLoginError('⚠ تعذّر جلب بيانات الحساب — تواصل مع الإدارة.');
    setLoginLoading(false);
    return;
  }

  if (profile.role !== 'owner') {
    await sb.auth.signOut();
    showLoginError('⛔ هذا الحساب ليس حساب صاحب مساحة — اللوحة مخصصة للأونرز فقط.');
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
  hideLoginError();
  setLoginLoading(true);

  const email = document.getElementById('li-user').value.trim();
  const pass  = document.getElementById('li-pass').value;

  /* ── محاولة Supabase أولاً ── */
  const sb = getSB();
  if (sb) {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password: pass,
    });

    if (error) {
      const ar = {
        'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
        'Email not confirmed':       'البريد الإلكتروني لم يتم تأكيده بعد.',
        'Too many requests':         'كثير من المحاولات — انتظر قليلاً وأعد المحاولة.',
      };
      showLoginError('⚠ ' + (ar[error.message] || error.message));
      setLoginLoading(false);
      return;
    }

    await checkRoleAndProceed(data.user);
    return;
  }

  /* ── Fallback: Hardcoded OWNERS (للتطوير فقط) ── */
  const ownerKey = Object.keys(OWNERS).find(
    k => k.toLowerCase() === email.toLowerCase()
  );
  if (!ownerKey || OWNERS[ownerKey].password !== pass) {
    showLoginError('⚠ بيانات الدخول غير صحيحة.');
    setLoginLoading(false);
    return;
  }
  currentOwner = { ...OWNERS[ownerKey], username: ownerKey };
  sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));
  setLoginLoading(false);
  initDashboard();
}

document.addEventListener('keydown', e => {
  const loginPage = document.getElementById('login-page');
  if (e.key === 'Enter' && loginPage && loginPage.style.display !== 'none') doLogin();
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
  document.getElementById('login-page').style.display = 'flex';
}

/* ══════════════════════════════════════════
   🚀  INIT DASHBOARD
   ══════════════════════════════════════════ */
function initDashboard() {
  setTxt('sb-initial', currentOwner.initial);
  setTxt('sb-name',    currentOwner.name);
  setTxt('sb-place',   '📍 ' + currentOwner.place);

  const stName  = document.getElementById('st-name');
  const stPlace = document.getElementById('st-place');
  const stPhone = document.getElementById('st-phone');
  if (stName)  stName.value  = currentOwner.name;
  if (stPlace) stPlace.value = currentOwner.place;
  if (stPhone) stPhone.value = currentOwner.phone || '';

  loadOwnerData();

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
  ownerSpaces    = DEMO_SPACES[id]    || DEMO_SPACES[currentOwner.username] || [];
  ownerTenants   = DEMO_TENANTS[id]   || DEMO_TENANTS[currentOwner.username] || [];
  ownerContracts = DEMO_CONTRACTS[id] || DEMO_CONTRACTS[currentOwner.username] || [];
  renderAll();
}

function renderAll() {
  renderKPIs();
  renderSpaces();
  renderTenants();
  renderContracts();
  renderAlerts();
  populateSelects();
}

/* ══════════════════════════════════════════
   📈  KPIs
   ══════════════════════════════════════════ */
function renderKPIs() {
  const rented    = ownerSpaces.filter(s => s.status === 'rented');
  const avail     = ownerSpaces.filter(s => s.status === 'available');
  const maint     = ownerSpaces.filter(s => s.status === 'maintenance');
  const monthly   = rented.reduce((sum, s) => sum + (s.rent || 0), 0);
  const occ       = ownerSpaces.length ? Math.round((rented.length / ownerSpaces.length) * 100) : 0;
  const scored    = rented.filter(s => s.score);
  const avgScore  = scored.length
    ? (scored.reduce((s, sp) => s + sp.score, 0) / scored.length).toFixed(1)
    : '—';
  const abandoned = ownerSpaces.filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD);
  const expiring  = ownerContracts.filter(c => c.daysLeft <= 30);

  /* Overview KPIs */
  setTxt('kpi-revenue', monthly.toLocaleString('ar-EG'));
  setTxt('kpi-occ',     occ + '%');
  setTxt('kpi-tenants', String(rented.length));
  setTxt('kpi-score',   String(avgScore));

  const occBar = document.getElementById('kpi-occ-bar');
  if (occBar) occBar.style.width = occ + '%';

  /* Spaces view KPIs */
  setTxt('kpi-main',  String(rented.length));
  setTxt('kpi-avail', String(avail.length));
  setTxt('kpi-maint', String(maint.length));

  /* Sidebar badges */
  setTxt('nb-tenants',  String(rented.length));
  setTxt('nb-expiring', String(expiring.length));
  setTxt('nb-alerts',   String(abandoned.length + expiring.length));
}

/* ══════════════════════════════════════════
   🗺️  NAVIGATION
   ══════════════════════════════════════════ */
const VIEW_TITLES = {
  'overview':    'نظرة عامة',
  'tenants':     'المستأجرون',
  'spaces':      'المساحات',
  'contracts':   'العقود',
  'ratings':     'التقييمات',
  'revenue':     'الإيرادات',
  'insights':    'الرؤى والتوصيات',
  'experiments': 'وضع التجربة',
  'add-space':   'إضافة مساحة جديدة',
  'alerts':      'التنبيهات',
  'settings':    'الإعدادات',
};

function goTo(viewId, navEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');
  if (navEl)  navEl.classList.add('active');

  setTxt('topbar-title', VIEW_TITLES[viewId] || viewId);
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
   📄  CONTRACTS VIEW
   ══════════════════════════════════════════ */
function renderContracts() {
  const cont = document.getElementById('contracts-list');
  if (!cont) return;

  if (!ownerContracts.length) {
    cont.innerHTML = '<div style="text-align:center;color:var(--text3);padding:30px">لا توجد عقود بعد</div>';
    return;
  }

  cont.innerHTML = ownerContracts.map(c => {
    const progPct = Math.round(100 - (c.daysLeft / 180) * 100);
    const bCls    = c.status === 'سارية' ? 'badge-green' : c.status === 'تنتهي قريباً' ? 'badge-yellow' : 'badge-red';
    const fCls    = c.daysLeft < 30 ? 'red' : c.daysLeft < 60 ? 'yellow' : 'green';

    return `
      <div class="contract-card">
        <div class="contract-head">
          <div>
            <div class="contract-name">${c.name}</div>
            <div class="contract-space">📍 مساحة ${c.space}</div>
          </div>
          <div style="text-align:left">
            <span class="badge ${bCls}">${c.status}</span>
            <div style="font-size:10px;color:var(--text3);margin-top:4px;font-family:'Space Mono',monospace">${c.daysLeft} يوم متبقي</div>
          </div>
        </div>
        <div class="contract-meta">
          <span>📅 البداية: ${c.start}</span>
          <span>📅 النهاية: ${c.end}</span>
          <span>💰 ${c.rent} ج/شهر</span>
        </div>
        <div class="contract-bar">
          <div class="contract-bar-top">
            <span>تقدم العقد</span>
            <span style="font-family:'Space Mono',monospace">${progPct}%</span>
          </div>
          <div class="prog-bar"><div class="prog-fill ${fCls}" style="width:${progPct}%"></div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary btn-sm">🔄 تجديد</button>
          <button class="btn btn-sm">📄 تفاصيل</button>
        </div>
      </div>`;
  }).join('');
}

/* ══════════════════════════════════════════
   🚨  ALERTS — محسوبة من البيانات
   ══════════════════════════════════════════ */
function renderAlerts() {
  const list = document.getElementById('alerts-list');
  if (!list) return;

  const alerts = [];

  /* مساحات مهملة */
  ownerSpaces
    .filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD)
    .forEach(s => alerts.push({
      type:  'danger',
      ico:   '🏚️',
      title: `المساحة ${s.code} مهملة منذ ${s.daysEmpty} يوم`,
      body:  `${s.loc} (${s.size}) — لم تُؤجَّر منذ فترة. مكاني Spot تستطيع مساعدتك في إيجاد مستأجر مناسب.`,
    }));

  /* تقييمات منخفضة ومتراجعة */
  ownerTenants
    .filter(t => t.score < 5 && t.trend === 'down')
    .forEach(t => alerts.push({
      type:  'danger',
      ico:   '📉',
      title: `تقييم ${t.name} منخفض باستمرار`,
      body:  `التقييم الحالي ${t.score}/10 ومتراجع. العقد ينتهي بعد ${t.daysLeft} يوم — يُنصح بمراجعة الوضع.`,
    }));

  /* عقود تنتهي قريباً */
  ownerContracts
    .filter(c => c.daysLeft <= 30)
    .forEach(c => alerts.push({
      type:  'warning',
      ico:   '📅',
      title: `عقد ${c.name} ينتهي خلال ${c.daysLeft} يوم`,
      body:  `المساحة ${c.space} — تواصل مع المستأجر للتجديد أو ابدأ البحث عن بديل.`,
    }));

  /* دفعات متأخرة (demo) */
  ownerTenants
    .filter(t => t.score < 5)
    .forEach(t => alerts.push({
      type:  'warning',
      ico:   '💳',
      title: `تحقق من دفعات ${t.name}`,
      body:  `المستأجر يعاني من أداء ضعيف — تأكد من انتظام الدفع.`,
    }));

  /* لا مساحات مضافة */
  if (!ownerSpaces.length) {
    alerts.push({ type:'info', ico:'💡', title:'لم تُضَف مساحات بعد', body:'ابدأ بإضافة مساحاتك ليراها المستأجرون على المنصة.' });
  }

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
   ➕  ADD SPACE FORM
   🔗 DB-LINK: يرسل للـ Apps Script → يحفظ في الشيت
   ══════════════════════════════════════════ */
function populateSelects() {
  const available = ownerSpaces.filter(s => s.status === 'available');

  /* قائمة المساحات الفارغة في نموذج العقد */
  document.querySelectorAll('.select-available-space').forEach(sel => {
    sel.innerHTML = available.map(s => `<option value="${s.code}">${s.code} — ${s.loc}</option>`).join('');
  });

  /* قائمة المستأجرين في نموذج التقييم */
  document.querySelectorAll('.select-tenant').forEach(sel => {
    sel.innerHTML = '<option value="">اختر المستأجر</option>' +
      ownerTenants.map(t => `<option value="${t.id}">${t.name} — ${t.act}</option>`).join('');
  });
}

async function submitAddSpace(e) {
  e.preventDefault();
  const btn = document.getElementById('add-space-btn');
  const msg = document.getElementById('add-space-msg');
  if (!btn || !msg) return;

  btn.disabled    = true;
  btn.textContent = '⏳ جاري الإرسال…';

  const payload = {
    action:      'addSpace',
    ownerId:     currentOwner.id,
    ownerName:   currentOwner.name,
    place:       currentOwner.place,
    code:        document.getElementById('as-code')?.value.trim(),
    location:    document.getElementById('as-location')?.value.trim(),
    floor:       document.getElementById('as-floor')?.value,
    size:        document.getElementById('as-size')?.value.trim(),
    activities:  document.getElementById('as-activities')?.value.trim(),
    price:       document.getElementById('as-price')?.value,
    description: document.getElementById('as-description')?.value.trim(),
    timestamp:   new Date().toISOString(),
  };

  try {
    /* 🔗 DB-LINK: يُرسَل لـ Apps Script الذي يحفظ في Google Sheets */
    await fetch(ADD_SPACE_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    msg.className = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">✅</span>
      <div class="alert-text"><strong>تم إرسال طلب الإضافة بنجاح!</strong>
      سيراجع فريق مكاني Spot المساحة ويضيفها للمنصة خلال 24 ساعة.</div>`;

    document.getElementById('add-space-form')?.reset();
    document.getElementById('img-preview').innerHTML = '';
  } catch {
    msg.className = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">❌</span>
      <div class="alert-text"><strong>تعذّر الإرسال</strong>تأكد من الاتصال بالإنترنت وأعد المحاولة.</div>`;
  }

  btn.disabled    = false;
  btn.textContent = '🚀 إرسال طلب الإضافة';
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
  const tenantId = document.getElementById('rate-tenant')?.value;
  const month    = document.getElementById('rate-month')?.value;
  if (!tenantId || !month) {
    alert('اختر المستأجر والشهر أولاً');
    return;
  }

  const sliders = document.querySelectorAll('#rate-criteria input[type=range]');
  const scores  = Array.from(sliders).map(s => parseInt(s.value));
  const avg     = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);

  /* 🔗 DB-LINK: أرسل لـ Apps Script / Supabase ratings table */
  alert(`✅ تم حفظ التقييم!\nالمتوسط: ${avg}/10`);
}

/* ══════════════════════════════════════════
   ⚙️  SETTINGS
   ══════════════════════════════════════════ */
function saveSettings() {
  const name  = document.getElementById('st-name')?.value.trim();
  const place = document.getElementById('st-place')?.value.trim();
  const phone = document.getElementById('st-phone')?.value.trim();

  if (name)  { currentOwner.name  = name;  setTxt('sb-name', name); }
  if (place) { currentOwner.place = place; setTxt('sb-place', '📍 ' + place); }
  if (phone)   currentOwner.phone = phone;

  sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));
  /* 🔗 DB-LINK: احفظ في جدول owners */
  alert('✅ تم حفظ الإعدادات!');
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
  const sb = getSB();

  /* ── بدون Supabase: fallback للـ sessionStorage ── */
  if (!sb) {
    const saved = sessionStorage.getItem('ms_owner');
    if (saved) {
      try { currentOwner = JSON.parse(saved); initDashboard(); } catch { sessionStorage.removeItem('ms_owner'); }
    }
    return;
  }

  /* ── تحقق من الـ Supabase session ── */
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    /* لا يوجد session — تحقق من الـ sessionStorage كـ fallback */
    const saved = sessionStorage.getItem('ms_owner');
    if (saved) {
      try { currentOwner = JSON.parse(saved); initDashboard(); return; } catch { sessionStorage.removeItem('ms_owner'); }
    }
    /* لا session ولا cached owner → صفحة اللوجين (هي الافتراضية) */
    return;
  }

  /* ── فيه session: تحقق من الـ role ── */
  const { data: profile, error } = await sb
    .from('profiles')
    .select('role, full_name, place, phone')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || profile.role !== 'owner') {
    /* مش owner → اطرد وارجع للوجين */
    await sb.auth.signOut();
    sessionStorage.removeItem('ms_owner');
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
   🔄  INIT ON PAGE LOAD
   ══════════════════════════════════════════ */
window.addEventListener('load', () => checkSessionOnLoad());
