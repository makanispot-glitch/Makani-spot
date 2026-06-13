/* ================================================================
   MAKANI SPOT — OWNER DASHBOARD APP LOGIC
   makani-dashboard-app.js | v1.0
   ملف منفصل عن المنصة الرئيسية (app.js)
   ================================================================ */

/* ══════════════════════════════════════════
   ⚙️  CONFIG
   ══════════════════════════════════════════ */
const BOOKING_URL    = "https://script.google.com/macros/s/AKfycbzZPnqZ4hjy8nzzGDcrQUpJK_pZn01lGIJXL-EfScxpGISLMjo6wL6xCLqNMviBpD69/exec";
const ADD_BAZAAR_URL = "https://script.google.com/macros/s/AKfycbwb0eB118CzrlByCAn2ESbF-6md7h1E-pTJtIph8jfYfeZTkY7GAJNM5RPSNHxbFsqOcA/exec";

let ABANDONED_THRESHOLD = 30; // يوم — بعده تُعتبر المساحة "مهملة" (تُحدَّث من إعدادات المالك)
let currentPeriod = 'month'; // نطاق الفترة في النظرة العامة: month | quarter | year

/* ملاحظة: لا توجد حسابات owner مبرمجة ولا بيانات تجريبية —
   كل الوصول عبر Supabase Auth (role=owner)، وكل البيانات من Supabase. */

/* ══════════════════════════════════════════
   🗂️  STATE
   ══════════════════════════════════════════ */
let currentOwner   = null;
let ownerSpaces    = [];
let ownerTenants   = [];
let ownerContracts = [];
let ownerAuthChecked = false;

/* ══════════════════════════════════════════
   📋  CONTRACTS / PAYMENTS / VIOLATIONS / RATINGS
   كل البيانات في Supabase — هذه مصفوفات كاش في الذاكرة
   تُملأ عبر loaders غير متزامنة وتُستخدم في دوال العرض كما هي.
   ══════════════════════════════════════════ */
let contractsList     = [];
let ratingsList       = [];
let paymentsList      = [];
let violationsList    = [];
let bookingsList      = [];   /* طلبات الحجز الواردة من الموقع العام */
let ownerSettings     = null;
let editingContractId = null;

/* ── mappers: صف قاعدة البيانات → شكل الذاكرة (يحافظ على شكل العروض القديم) ── */
function mapContractRow(r) {
  return enrichContract({
    id:          r.id,
    tenantName:  r.tenant_name,
    tenantPhone: r.tenant_phone || '',
    spaceCode:   r.space_code || '',
    unitId:      r.unit_id  || null,
    spaceId:     r.space_id || null,
    activity:    r.activity || '',
    rent:        r.rent || 0,
    startDate:   r.start_date || '',
    endDate:     r.end_date || '',
    notes:       r.notes || '',
    endedEarly:  !!r.ended_early,
    endedAt:     r.ended_at || null,
    createdAt:   r.created_at || '',
  });
}
function mapRatingRow(r) {
  return {
    id: r.id, contractId: r.contract_id, month: r.month,
    commitment: r.commitment || 0, cleanliness: r.cleanliness || 0,
    dealing: r.dealing || 0, payment: r.payment || 0, rules: r.rules || 0,
    avgScore: r.avg_score != null ? parseFloat(r.avg_score) : 0,
    comment: r.comment || '', createdAt: r.created_at || '',
  };
}
function mapPaymentRow(r) {
  return {
    id: r.id, contractId: r.contract_id, tenantName: r.tenant_name || '—',
    spaceCode: r.space_code || '—', amount: parseFloat(r.amount) || 0,
    month: r.month || '', paidDate: r.paid_date || '', status: r.status || 'paid',
    notes: r.notes || '', createdAt: r.created_at || '',
    invoiceNumber: r.invoice_number || '',
  };
}
function mapViolationRow(r) {
  return {
    id: r.id, contractId: r.contract_id, tenantName: r.tenant_name || '—',
    spaceCode: r.space_code || '—', type: r.type || '—', category: r.category || 'other',
    severity: r.severity || 'medium', date: r.vdate || '', notes: r.notes || '',
    createdAt: r.created_at || '',
  };
}

/* ── async loaders من Supabase ── */
async function loadContractsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { contractsList = []; return; }
  const { data, error } = await sb.from('owner_contracts').select('*')
    .eq('owner_id', currentOwner.id).order('created_at', { ascending: false });
  if (error) console.warn('[Makani] contracts load:', error.message);
  contractsList = (error || !data) ? [] : data.map(mapContractRow);
}
async function loadRatingsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { ratingsList = []; return; }
  const { data, error } = await sb.from('owner_tenant_ratings').select('*')
    .eq('owner_id', currentOwner.id).order('month', { ascending: false });
  if (error) console.warn('[Makani] ratings load:', error.message);
  ratingsList = (error || !data) ? [] : data.map(mapRatingRow);
}
async function loadPaymentsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { paymentsList = []; return; }
  const { data, error } = await sb.from('owner_payments').select('*')
    .eq('owner_id', currentOwner.id).order('created_at', { ascending: false });
  if (error) console.warn('[Makani] payments load:', error.message);
  paymentsList = (error || !data) ? [] : data.map(mapPaymentRow);
}
async function loadViolationsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { violationsList = []; return; }
  const { data, error } = await sb.from('owner_violations').select('*')
    .eq('owner_id', currentOwner.id).order('created_at', { ascending: false });
  if (error) console.warn('[Makani] violations load:', error.message);
  violationsList = (error || !data) ? [] : data.map(mapViolationRow);
}
async function loadOwnerSettings() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  try {
    const { data } = await sb.from('owner_settings').select('*')
      .eq('owner_id', currentOwner.id).maybeSingle();
    ownerSettings = data || null;
    if (ownerSettings?.abandoned_threshold) ABANDONED_THRESHOLD = ownerSettings.abandoned_threshold;
    applyNotifPrefsToUI();
  } catch { /* الجدول اختياري */ }
}

async function loadBookingsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { bookingsList = []; return; }
  try {
    /* نجلب الحجوزات النشطة (pending + confirmed + viewing_pending) مع بيانات الحاجز من profiles */
    const { data, error } = await sb
      .from('bookings')
      .select('*, profiles!bookings_user_id_fkey(full_name, phone, email)')
      .eq('owner_id', currentOwner.id)
      .in('status', ['pending', 'confirmed', 'viewing_pending'])
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    bookingsList = (data || []).map(b => ({
      id:         b.id,
      userId:     b.user_id,
      spaceId:    b.space_id,
      spaceName:  b.space_name  || '—',
      spaceLoc:   b.space_loc   || '—',
      price:      b.price       || '—',
      activity:   b.activity    || '—',
      size:       b.size        || '—',
      duration:   b.duration    || '—',
      startDate:  b.start_date  || '',
      notes:      b.notes       || '',
      status:     b.status      || 'pending',
      createdAt:  b.created_at  || '',
      isWaitlist:  !!b.is_waitlist,
      profileLink: b.profile_link || '',
      bookerName:  b.profiles?.full_name || '—',
      bookerPhone: b.profiles?.phone     || '—',
      bookerEmail: b.profiles?.email     || '—',
    }));
    updateBookingsBadge();
  } catch (e) {
    console.warn('[Makani] bookings load:', e.message);
    bookingsList = [];
  }
}

/* ── إثراء العقد بالحقول المحسوبة ── */
function enrichContract(c) {
  const now      = new Date(); now.setHours(0, 0, 0, 0);
  const end      = c.endDate ? new Date(c.endDate) : null;
  const daysLeft = end ? Math.ceil((end - now) / 86400000) : 0;
  let status = 'active';
  if (c.endedEarly)         { return { ...c, daysLeft: 0, status: 'expired' }; }
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
/* تداخل فترتين زمنيتين (تاريخ مفقود = مفتوح) */
function _datesOverlap(aStart, aEnd, bStart, bEnd) {
  const s1 = aStart ? new Date(aStart) : new Date(-8640000000000000);
  const e1 = aEnd   ? new Date(aEnd)   : new Date( 8640000000000000);
  const s2 = bStart ? new Date(bStart) : new Date(-8640000000000000);
  const e2 = bEnd   ? new Date(bEnd)   : new Date( 8640000000000000);
  return s1 <= e2 && s2 <= e1;
}

async function submitContract(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim();
  const tenantName  = get('cf-tenant');
  const unitVal     = get('cf-space');     /* uuid للوحدة أو نص حر */
  const activity    = get('cf-activity');
  const rent        = parseFloat(get('cf-rent')) || 0;
  const startDate   = get('cf-start');
  const endDate     = get('cf-end');
  const notes       = get('cf-notes');
  const tenantPhone = get('cf-phone') || '';

  if (!tenantName) { showContractMsg('danger', 'اسم المستأجر مطلوب.'); return; }
  if (endDate && startDate && endDate < startDate) {
    showContractMsg('danger', 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية.');
    return;
  }

  /* حلّ الوحدة المختارة من المساحات الحقيقية */
  const unit      = ownerSpaces.find(s => s.unitDbId && s.unitDbId === unitVal);
  const unitId    = unit ? unit.unitDbId : null;
  const spaceId   = unit ? (unit.spaceId || null) : null;
  const spaceCode = unit ? unit.code : (unitVal || '');

  /* تحقق من تعارض الوحدة — منع عقدين فعّالين على نفس الوحدة بفترة متداخلة */
  if (unitId) {
    const conflict = contractsList.find(c =>
      c.id !== editingContractId && c.unitId === unitId && c.status !== 'expired' &&
      _datesOverlap(startDate, endDate, c.startDate, c.endDate));
    if (conflict) {
      showContractMsg('danger', `الوحدة ${spaceCode} مرتبطة بعقد فعّال آخر (${conflict.tenantName}) في نفس الفترة.`);
      return;
    }
  }

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showContractMsg('danger', 'تعذّر الاتصال — أعد تحميل الصفحة.'); return; }

  const payload = {
    owner_id:     currentOwner.id,
    space_id:     spaceId,
    unit_id:      unitId,
    space_code:   spaceCode || null,
    tenant_name:  tenantName,
    tenant_phone: tenantPhone || null,
    activity:     activity || null,
    rent:         rent || null,
    start_date:   startDate || null,
    end_date:     endDate || null,
    notes:        notes || null,
  };

  const btn = document.getElementById('contract-submit-btn');
  if (btn) btn.disabled = true;
  const wasEditing = !!editingContractId;
  try {
    if (editingContractId) {
      const { error } = await sb.from('owner_contracts').update(payload)
        .eq('id', editingContractId).eq('owner_id', currentOwner.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('owner_contracts').insert(payload);
      if (error) throw error;
    }
    await loadContractsRemote();
    syncDataFromContracts();
    renderAll();
    syncUnitStatusToSupabase(); /* مزامنة حالة الوحدة (non-blocking) */
    document.getElementById('contract-form')?.reset();
    cancelEditContract();
    showContractMsg('success', wasEditing
      ? '✅ تم تحديث العقد بنجاح.'
      : '✅ تمت إضافة العقد — يظهر المستأجر الآن في القائمة.');
    updateNotifBadge();
  } catch (err) {
    const msg = err.message || '';
    /* DB trigger يرفع استثناء يبدأ بـ unit_overlap */
    const userMsg = msg.startsWith('unit_overlap')
      ? `الوحدة ${spaceCode} مرتبطة بعقد فعّال في نفس الفترة — لا يمكن إضافة عقد متداخل.`
      : 'تعذّر حفظ العقد: ' + (msg || 'خطأ غير معروف');
    showContractMsg('danger', userMsg);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteContract(id) {
  if (!confirm('هل تريد حذف هذا العقد؟\nسيُزال المستأجر من القوائم وتُحذف معه مدفوعاته ومخالفاته وتقييماته. لا يمكن التراجع.')) return;
  const sb = getSB();
  if (sb && currentOwner?.id) {
    const { error } = await sb.from('owner_contracts').delete()
      .eq('id', id).eq('owner_id', currentOwner.id);   /* cascade يحذف المدفوعات/المخالفات/التقييمات */
    if (error) { alert('تعذّر حذف العقد: ' + error.message); return; }
  }
  contractsList  = contractsList.filter(c => c.id !== id);
  ratingsList    = ratingsList.filter(r => r.contractId !== id);
  paymentsList   = paymentsList.filter(p => p.contractId !== id);
  violationsList = violationsList.filter(v => v.contractId !== id);
  syncDataFromContracts();
  renderAll();
  syncUnitStatusToSupabase(); /* الوحدة المُحرَّرة → available في Supabase (non-blocking) */
}

function startEditContract(id) {
  const c = contractsList.find(x => x.id === id);
  if (!c) return;
  editingContractId = id;
  const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
  set('cf-tenant',   c.tenantName);
  populateContractSpaceSelect();          /* تأكد من امتلاء القائمة قبل الاختيار */
  set('cf-space',    c.unitId || '');
  set('cf-phone',    c.tenantPhone);
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

/* ملاحظة: deleteRating مُعرّفة في قسم التقييمات (Supabase) أسفل الملف. */

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
   💎  PLAN GATING
   ══════════════════════════════════════════ */
function getPlan() { return currentOwner?.planTier || 'starter'; }

const PLAN_LEVELS = { starter: 0, growth: 1, pro: 2 };
function canAccess(minPlan) {
  return (PLAN_LEVELS[getPlan()] ?? 0) >= (PLAN_LEVELS[minPlan] ?? 0);
}

function planGateHtml(requiredPlan) {
  const names = {
    growth: 'Growth — ٣,٠٠٠ ج/شهر',
    pro:    'Pro — ٤,٥٠٠ ج/شهر',
  };
  return `
    <div class="pcard">
      <div class="pcard-body" style="text-align:center;padding:60px 20px">
        <div style="font-size:60px;margin-bottom:16px">🔒</div>
        <div style="font-size:17px;font-weight:900;color:var(--text);margin-bottom:10px">
          هذه الميزة متاحة في باقة ${names[requiredPlan] || requiredPlan}
        </div>
        <div style="font-size:13px;color:var(--text2);max-width:400px;margin:0 auto 28px;line-height:1.8">
          قم بترقية حسابك للوصول إلى هذه الأداة وكل مميزات الإدارة المتقدمة في منصة مكاني Spot.
        </div>
        <a href="/" class="btn btn-primary" style="font-size:14px;padding:13px 30px;text-decoration:none;display:inline-flex;gap:8px">
          🚀 ترقية الحساب الآن ←
        </a>
        <div style="margin-top:14px;font-size:11px;color:var(--text3)">
          باقتك الحالية: <strong style="color:var(--orange)">${getPlan().charAt(0).toUpperCase() + getPlan().slice(1)}</strong>
        </div>
      </div>
    </div>`;
}

function _planBadgeHtml(tier) {
  if (tier === 'pro')    return `<span style="background:rgba(245,197,24,0.14);border:1px solid rgba(245,197,24,0.40);color:#F5C518;padding:2px 10px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:.03em">🏆 Pro</span>`;
  if (tier === 'growth') return `<span style="background:rgba(34,212,110,0.12);border:1px solid rgba(34,212,110,0.28);color:var(--green);padding:2px 10px;border-radius:20px;font-size:10px;font-weight:800;letter-spacing:.03em">✓ Growth</span>`;
  return `<span style="background:var(--bg3);border:1px solid var(--border);color:var(--text3);padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700">Starter</span>`;
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

  /* ❌ حساب موقوف من الأدمن */
  if (profile.is_suspended) {
    showOwnerAccessGate(
      'danger',
      'تم إيقاف هذا الحساب مؤقتاً',
      'حسابك موقوف حالياً من قِبل إدارة مكاني Spot. تواصل معنا على واتساب 01103467711 للاستفسار.'
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
    planTier: (profile.plan_tier || profile.planTier || 'starter').toLowerCase().trim() || 'starter',
  };

  /* 🔒 باقة Starter — لوحة التحكم تتطلب Growth فما فوق */
  if (currentOwner.planTier === 'starter') {
    setLoginLoading(false);
    showOwnerAccessGate(
      'warning',
      '🔒 لوحة التحكم متاحة من باقة Growth فما فوق',
      'باقتك الحالية هي Starter. قم بترقية حسابك إلى Growth أو Pro للوصول إلى لوحة التحكم وإدارة مساحاتك.'
    );
    return;
  }

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

  /* عرض بادج الباقة في السايدبار */
  const planBadgeEl = document.getElementById('sb-plan-badge');
  if (planBadgeEl) {
    planBadgeEl.style.display = 'block';
    planBadgeEl.innerHTML = _planBadgeHtml(getPlan());
  }

  /* قفل/فتح عناصر التنقل بناءً على الباقة */
  const _lockNav = (id, minPlan) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!canAccess(minPlan)) {
      el.style.opacity = '0.55';
      const lockSpan = el.querySelector('.nav-lock');
      if (lockSpan) lockSpan.style.display = 'inline';
    }
  };
  _lockNav('nav-payments',   'growth');
  _lockNav('nav-violations', 'growth');
  _lockNav('nav-bazaar',     'pro');
  _lockNav('nav-reports',    'pro');

  /* كل البيانات من Supabase: loadOwnerData يحمّل المساحات + العقود + المدفوعات
     + المخالفات + التقييمات + الإعدادات + الحجوزات، ثم يحسب الفراغ ويرسم كل شيء. */
  loadOwnerData().then(() => loadOwnerRatings());
  loadNotifications();
  subscribeNotificationsRealtime();
  cleanupOldNotifications(); /* حذف الإشعارات المقروءة الأقدم من 30 يوم */

  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app').classList.add('visible');

  const firstNav = document.querySelector('[onclick*="overview"]');
  goTo('overview', firstNav);
}

/* ══════════════════════════════════════════
   📊  DATA LOADING — Supabase
   ══════════════════════════════════════════ */
async function loadOwnerData() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { applyEmptyData(); return; }

  try {
    /* مساحات مفعّلة + وحداتها */
    const { data: spacesData, error: spacesErr } = await sb
      .from('spaces')
      .select('id, name, type, region, sort_order, space_units(id, unit_id, name, floor, size, price, status, location, notes, image_url, created_at)')
      .eq('owner_id', currentOwner.id)
      .eq('status', 'approved')
      .eq('is_active', true)
      .order('sort_order');

    if (spacesErr) throw spacesErr;

    /* تحويل الوحدات لمصفوفة ownerSpaces */
    ownerSpaces = [];
    (spacesData || []).forEach(space => {
      (space.space_units || []).forEach(u => {
        ownerSpaces.push({
          unitDbId:  u.id,
          code:      u.unit_id || '—',
          uname:     u.name || '',
          unitNotes: u.notes || '',
          unitLoc:   u.location || '',
          loc:       u.location || space.region || '—',
          size:      u.size || '—',
          act:       null,
          rent:      u.price || null,
          status:    u.status || 'available',
          baseStatus: u.status || 'available',
          basePrice:  u.price || null,
          tenant:    null,
          score:     null,
          daysEmpty: 0,
          floor:     u.floor || '',
          spaceId:   space.id,
          spaceName: space.name,
          createdAt: u.created_at || null,
        });
      });
    });

    /* مساحات معلقة / مرفوضة */
    const { data: pendingData } = await sb
      .from('spaces')
      .select('id, name, type, region, min_price, sizes_prices, status, reject_reason, created_at')
      .eq('owner_id', currentOwner.id)
      .in('status', ['pending', 'rejected'])
      .order('created_at', { ascending: false });

    ownerPendingSpaces = (pendingData || []).map(s => ({
      id:          s.id,
      name:        s.name || '—',
      type:        s.type || '',
      loc:         s.region || '—',
      sizes:       s.sizes_prices || '',
      price:       s.min_price || 0,
      subCount:    0,
      status:      s.status,
      rejectReason: s.reject_reason || '',
      submittedAt: s.created_at,
    }));

    /* كل البيانات التشغيلية من Supabase */
    await Promise.all([
      loadContractsRemote(),
      loadPaymentsRemote(),
      loadViolationsRemote(),
      loadRatingsRemote(),
      loadOwnerSettings(),
      loadBookingsRemote(),
    ]);

    /* 🔒 تحقق من انتهاء الاشتراك — حتى لو لم يعمل auto_expire_subscriptions بعد */
    try {
      const { data: effectivePlan } = await sb.rpc('get_my_effective_plan');
      if (effectivePlan && effectivePlan !== currentOwner.planTier) {
        currentOwner.planTier = effectivePlan;
        sessionStorage.setItem('ms_owner', JSON.stringify(currentOwner));
        const badge = document.getElementById('sb-plan-badge');
        if (badge) badge.innerHTML = _planBadgeHtml(effectivePlan);
      }
    } catch { /* silent — إذا لم تكن الدالة موجودة بعد نكمل بالقيمة الحالية */ }

    computeDaysEmpty();        /* مدة الفراغ الحقيقية + ربط العقود بالوحدات */
    syncDataFromContracts();
    renderAll();
    syncUnitStatusToSupabase(); /* مزامنة available↔rented إلى Supabase (non-blocking) */
  } catch (err) {
    console.warn('[Makani] loadOwnerData error:', err.message);
    applyEmptyData();
  }
}

/* حالة فارغة نظيفة عند تعذّر الاتصال — لا بيانات وهمية */
function applyEmptyData() {
  ownerSpaces = []; ownerPendingSpaces = [];
  contractsList = []; paymentsList = []; violationsList = []; ratingsList = [];
  bookingsList = [];
  syncDataFromContracts();
  renderAll();
}

/* حساب مدة الفراغ الحقيقية لكل وحدة + ربط الإشغال بالعقود الفعلية */
function computeDaysEmpty() {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const daysSince = d => d ? Math.max(0, Math.round((now - new Date(d)) / 86400000)) : 0;

  ownerSpaces.forEach(u => {
    /* أعد الضبط من الحالة الأصلية في كل تشغيل (idempotent) */
    u.status    = u.baseStatus || u.status || 'available';
    u.rent      = u.basePrice;
    u.tenant    = null;
    u.score     = null;
    u.act       = null;
    u.isNew     = false;
    u.daysEmpty = 0;

    const unitContracts = contractsList.filter(c => c.unitId && c.unitId === u.unitDbId);
    const activeOnUnit  = unitContracts.find(c => c.status !== 'expired');

    if (activeOnUnit) {
      u.daysEmpty = 0;
      u.status    = 'rented';                 /* مؤجَّرة فعلياً بعقد نشط */
      u.tenant    = activeOnUnit.tenantName;
      u.act       = activeOnUnit.activity || u.act;
      if (activeOnUnit.rent) u.rent = activeOnUnit.rent;
      const trs   = ratingsList.filter(r => r.contractId === activeOnUnit.id);
      u.score     = trs.length ? parseFloat((trs.reduce((s, r) => s + r.avgScore, 0) / trs.length).toFixed(1)) : null;
      return;
    }

    /* لا يوجد عقد نشط — لو كانت الوحدة مسجّلة في DB كـ 'rented' فهي فعلياً متاحة الآن */
    if (u.baseStatus === 'rented') {
      u.status = 'available';
    }

    if (u.status !== 'available') { u.daysEmpty = 0; return; }

    /* آخر عقد منتهٍ على الوحدة → الفراغ منذ نهايته، وإلا منذ إنشاء الوحدة */
    const ended = unitContracts
      .filter(c => c.endDate)
      .sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
    if (ended) {
      u.daysEmpty = daysSince(ended.endDate);
    } else {
      u.daysEmpty = daysSince(u.createdAt);
      if (u.daysEmpty <= 14) u.isNew = true;
    }
  });
}

/* ═══════════════════════════════════════════════════
   🔄  SYNC UNIT STATUS — مزامنة حالة الوحدات إلى Supabase
   يُشغَّل بعد computeDaysEmpty() فقط عند تغيُّر حقيقي
   (available ↔ rented) لتجنّب طلبات غير ضرورية.
   لا يمسّ حالة 'maintenance' أو أي حالة يدوية أخرى.
   ═══════════════════════════════════════════════════ */
async function syncUnitStatusToSupabase() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;

  /* فقط الوحدات التي تغيّرت بين الحالتين التلقائيتين */
  const toUpdate = ownerSpaces.filter(u =>
    u.unitDbId &&
    u.status !== u.baseStatus &&
    (u.status === 'available'   || u.status === 'rented') &&
    (u.baseStatus === 'available' || u.baseStatus === 'rented')
  );

  if (!toUpdate.length) return;

  await Promise.all(toUpdate.map(async u => {
    const { error } = await sb
      .from('space_units')
      .update({ status: u.status })
      .eq('id', u.unitDbId);
    if (!error) {
      u.baseStatus = u.status; /* تحديث الـ cache المحلي — يمنع إعادة الـ sync في renderAll() التالي */
    } else {
      console.warn('[Makani] syncUnitStatus:', u.code, error.message);
    }
  }));
}

function renderAll() {
  computeDaysEmpty();   /* يُحدّث إشغال الوحدات ومدة الفراغ من أحدث العقود/التقييمات */
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
  renderPayments();
  renderViolations();
  renderReports();
  renderBookings();
  populateSelects();
}

/* ══════════════════════════════════════════
   💰  REVENUE VIEW — ديناميكي من ownerSpaces
   ══════════════════════════════════════════ */
function renderRevenue() {
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const active    = contractsList.filter(c => c.status !== 'expired');
  const expected  = active.reduce((sum, c) => sum + (parseFloat(c.rent) || 0), 0);

  /* المحصّل الفعلي هذا الشهر لكل عقد (من جدول المدفوعات) */
  const collectedFor = id => paymentsList
    .filter(p => p.contractId === id && p.month === thisMonth && (p.status === 'paid' || p.status === 'partial'))
    .reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const hasLate = id => paymentsList.some(p => p.contractId === id && p.month === thisMonth && p.status === 'late');

  const collected = active.reduce((s, c) => s + collectedFor(c.id), 0);
  const due       = Math.max(0, expected - collected);
  const rate      = expected > 0 ? Math.round((collected / expected) * 100) : 0;

  const fmt = n => n ? Math.round(n).toLocaleString('ar-EG') + ' ج' : '—';
  setTxt('rev-expected',  fmt(expected));
  setTxt('rev-collected', fmt(collected));
  setTxt('rev-rate',      rate + '%');
  setTxt('rev-due',       fmt(due));
  setTxt('rev-expected-sub', `${active.length} عقد نشط`);
  const rateBar = document.getElementById('rev-rate-bar');
  if (rateBar) {
    rateBar.style.width = Math.min(100, rate) + '%';
    rateBar.className = 'prog-fill ' + (rate >= 80 ? 'green' : rate >= 40 ? 'yellow' : 'red');
  }
  const dueEl = document.getElementById('rev-due');
  if (dueEl) dueEl.style.color = due > 0 ? 'var(--red)' : 'var(--green)';

  const tbody = document.getElementById('revenue-tbody');
  if (!tbody) return;

  if (!active.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px">
      لا توجد عقود نشطة بعد — <button class="btn btn-primary btn-sm" onclick="goTo('contracts',document.querySelector('[onclick*=contracts]'))">أضف عقداً ➕</button>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = active.map(c => {
    const rent = parseFloat(c.rent) || 0;
    const got  = collectedFor(c.id);
    let badge;
    if (got >= rent && rent > 0)  badge = `<span class="badge badge-green">مدفوع بالكامل</span>`;
    else if (got > 0)             badge = `<span class="badge badge-yellow">جزئي (${Math.round((got/(rent||1))*100)}%)</span>`;
    else if (hasLate(c.id))       badge = `<span class="badge badge-red">متأخر</span>`;
    else                          badge = `<span class="badge" style="background:var(--bg3);color:var(--text3)">غير محصّل</span>`;
    return `
      <tr>
        <td style="font-family:'Space Mono',monospace;color:var(--orange)">${c.spaceCode || '—'}</td>
        <td>${c.tenantName}</td>
        <td style="font-family:'Space Mono',monospace">${rent.toLocaleString('ar-EG')} ج</td>
        <td style="font-family:'Space Mono',monospace;color:${got>=rent&&rent>0?'var(--green)':got>0?'var(--yellow)':'var(--text3)'}">${got ? got.toLocaleString('ar-EG')+' ج' : '—'}</td>
        <td>${badge}</td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════
   🧠  INSIGHTS VIEW — محسوبة من البيانات
   ══════════════════════════════════════════ */
function renderInsights() {
  if (!canAccess('pro')) {
    const viewEl = document.getElementById('view-insights');
    if (viewEl) viewEl.innerHTML = `<div class="section-label">الرؤى والتوصيات الذكية</div>${planGateHtml('pro')}`;
    return;
  }

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

function renderAddBazaarView() {
  if (!canAccess('pro')) {
    const viewEl = document.getElementById('view-add-bazaar');
    if (viewEl) viewEl.innerHTML = `<div class="section-label">🎪 تنظيم بازار جديد</div>${planGateHtml('pro')}`;
  }
}

/* ══════════════════════════════════════════
   📋  RATINGS HISTORY — ديناميكي من ownerTenants
   ══════════════════════════════════════════ */
function renderRatingsHistory() {
  const tbody = document.getElementById('ratings-history-tbody');
  if (!tbody) return;

  if (!ratingsList.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:30px">لا توجد تقييمات بعد — قيّم أول مستأجر من النموذج المجاور</td></tr>`;
    return;
  }

  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const cMap = {};
  contractsList.forEach(c => { cMap[c.id] = c; });

  tbody.innerHTML = ratingsList.map(r => {
    const c      = cMap[r.contractId] || {};
    const name   = _escR(c.tenantName || 'مستأجر');
    const space  = _escR(c.spaceCode || '—');
    const sc     = r.avgScore || 0;                       /* 0-10 */
    const col    = sc >= 8 ? 'var(--green)' : sc >= 6 ? 'var(--yellow)' : 'var(--red)';
    const fullStars = Math.round(sc / 2);
    const stars  = '★'.repeat(fullStars) + '☆'.repeat(Math.max(0, 5 - fullStars));
    const [yr, mo] = (r.month || '').split('-');
    const mLbl   = mo ? `${MONTHS_AR[parseInt(mo,10)-1] || mo} ${yr}` : '—';
    return `
      <tr>
        <td style="font-weight:700">${name}</td>
        <td style="font-size:12px;color:var(--text3)">${space}</td>
        <td><span style="color:${col};letter-spacing:2px">${stars}</span> <strong style="color:${col};font-family:'Space Mono',monospace">${sc}</strong></td>
        <td style="font-size:11px;color:var(--text3);max-width:220px">${r.comment ? _escR(r.comment) : '—'}</td>
        <td style="font-size:11px;color:var(--text3)">${mLbl} <button class="btn btn-sm" style="background:none;border:1px solid rgba(255,77,77,.25);color:var(--red);font-size:10px;padding:2px 7px;margin-right:6px" onclick="deleteRating('${r.id}')">🗑️</button></td>
      </tr>`;
  }).join('');
}

/* ══════════════════════════════════════════
   💰  PAYMENTS VIEW — تسجيل الدفعات
   ══════════════════════════════════════════ */
function renderPayments() {
  const container = document.getElementById('payments-content');
  if (!container) return;

  if (!canAccess('growth')) {
    container.innerHTML = planGateHtml('growth');
    return;
  }

  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const activeContracts = contractsList.filter(c => c.status !== 'expired');
  const expectedMonthly = activeContracts.reduce((s,c) => s + (parseFloat(c.rent)||0), 0);
  const collectedThisMonth = paymentsList
    .filter(p => p.month === thisMonth && p.status === 'paid')
    .reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const partialThisMonth = paymentsList
    .filter(p => p.month === thisMonth && p.status === 'partial')
    .reduce((s,p) => s + (parseFloat(p.amount)||0), 0);
  const remaining = Math.max(0, expectedMonthly - collectedThisMonth - partialThisMonth);
  const fmt = n => n ? n.toLocaleString('ar-EG') + ' ج' : '—';

  const kpiHtml = `
    <div class="kpi-row" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-ico">📅</div>
        <div class="kpi-label">المتوقع هذا الشهر</div>
        <div class="kpi-value" style="font-size:20px">${fmt(expectedMonthly)}</div>
        <div style="margin-top:6px;font-size:10px;color:var(--text3)">${activeContracts.length} عقد نشط</div>
      </div>
      <div class="kpi-card" style="${collectedThisMonth>=expectedMonthly&&expectedMonthly>0?'border-color:rgba(34,212,110,0.35)':''}">
        <div class="kpi-ico">✅</div>
        <div class="kpi-label">محصّل بالكامل</div>
        <div class="kpi-value" style="font-size:20px;color:var(--green)">${fmt(collectedThisMonth)}</div>
        <div style="margin-top:6px;font-size:10px;color:var(--text3)">${expectedMonthly>0?Math.round((collectedThisMonth/expectedMonthly)*100):0}% من المتوقع</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">⚡</div>
        <div class="kpi-label">دفع جزئي</div>
        <div class="kpi-value" style="font-size:20px;color:var(--yellow)">${fmt(partialThisMonth)}</div>
      </div>
      <div class="kpi-card" style="${remaining>0?'border-color:rgba(255,77,77,0.30)':''}">
        <div class="kpi-ico">⏳</div>
        <div class="kpi-label">متبقي / غير محصّل</div>
        <div class="kpi-value" style="font-size:20px;color:${remaining>0?'var(--red)':'var(--green)'}">${fmt(remaining)}</div>
      </div>
    </div>`;

  const sortedPayments = [...paymentsList].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const stMap = {
    paid:    { cls:'badge-green',  lbl:'مدفوع ✅' },
    partial: { cls:'badge-yellow', lbl:'جزئي ⚡' },
    late:    { cls:'badge-red',    lbl:'متأخر ⏰' },
  };

  const tableHtml = `
    <div class="pcard" style="margin-bottom:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">💰 سجل الدفعات</div><div class="pcard-sub">جميع المبالغ المحصّلة من المستأجرين</div></div>
        <span class="db-tag">DB: payments</span>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>الشهر</th><th>المبلغ</th><th>تاريخ الدفع</th><th>الحالة</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody>
            ${!sortedPayments.length
              ? `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:30px">لا توجد دفعات مسجّلة بعد — أضف أول دفعة من النموذج أدناه</td></tr>`
              : sortedPayments.map(p => {
                  const st = stMap[p.status] || { cls:'badge-blue', lbl:p.status };
                  const [yr,mo] = p.month.split('-');
                  const mLbl = (MONTHS_AR[parseInt(mo,10)-1]||mo) + ' ' + yr;
                  return `<tr>
                    <td style="font-weight:700">${p.tenantName}</td>
                    <td style="font-family:'Space Mono',monospace;color:var(--orange)">${p.spaceCode}</td>
                    <td style="font-size:11px;color:var(--text2)">${mLbl}</td>
                    <td style="font-family:'Space Mono',monospace;font-weight:700">${parseFloat(p.amount).toLocaleString('ar-EG')} ج</td>
                    <td style="font-size:11px;color:var(--text3)">${formatDate(p.paidDate)}</td>
                    <td><span class="badge ${st.cls}">${st.lbl}</span></td>
                    <td style="font-size:11px;color:var(--text3);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.notes||'—'}</td>
                    <td style="white-space:nowrap">
                      <button class="btn btn-sm" style="font-size:11px;padding:3px 8px;margin-left:4px;color:var(--text2)" onclick="printInvoice('${p.id}')" title="طباعة فاتورة">🖨️</button>
                      <button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:11px;padding:3px 10px" onclick="deletePayment('${p.id}')">🗑️</button>
                    </td>
                  </tr>`;
                }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;

  /* عقود نشطة + منتهية حديثاً (آخر 90 يوم) — للسماح بتسجيل دفعة متأخرة */
  const _expCutoff = new Date(); _expCutoff.setDate(_expCutoff.getDate() - 90);
  const activeForSelect = contractsList.filter(c =>
    c.status !== 'expired' || (c.endDate && new Date(c.endDate) >= _expCutoff));
  const formHtml = `
    <div class="pcard">
      <div class="pcard-head">
        <div class="pcard-title">➕ تسجيل دفعة جديدة</div>
        <div class="pcard-sub">كل دفعة تُضاف فوراً في السجل أعلاه وتُحتسب في التقارير</div>
      </div>
      <div class="pcard-body">
        <div id="payment-msg" class="alert-item" style="display:none;margin-bottom:14px"></div>
        <form id="payment-form" onsubmit="submitPayment(event)">
          <div class="form-row">
            <div class="form-group" style="margin:0">
              <label>المستأجر / العقد <span style="color:var(--red)">*</span></label>
              <select id="pf-contract" required>
                <option value="">اختر العقد</option>
                ${activeForSelect.map(c=>`<option value="${c.id}">${c.tenantName} — ${c.spaceCode}${c.rent?' ('+parseFloat(c.rent).toLocaleString('ar-EG')+' ج)':''}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>شهر الدفعة <span style="color:var(--red)">*</span></label>
              <input type="month" id="pf-month" required>
            </div>
          </div>
          <div class="form-row" style="margin-top:12px">
            <div class="form-group" style="margin:0">
              <label>المبلغ المدفوع (ج.م.) <span style="color:var(--red)">*</span></label>
              <input type="number" id="pf-amount" placeholder="مثال: 4200" min="0" required style="font-family:'Space Mono',monospace">
            </div>
            <div class="form-group" style="margin:0">
              <label>تاريخ الاستلام</label>
              <input type="date" id="pf-date">
            </div>
          </div>
          <div class="form-row" style="margin-top:12px">
            <div class="form-group" style="margin:0">
              <label>حالة الدفع</label>
              <select id="pf-status">
                <option value="paid">✅ مدفوع بالكامل</option>
                <option value="partial">⚡ دفع جزئي</option>
                <option value="late">⏰ متأخر / مؤجّل</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>ملاحظات</label>
              <input type="text" id="pf-notes" placeholder="مثال: دفع نقداً، المتبقي الأسبوع القادم…">
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:14px">💰 تسجيل الدفعة</button>
        </form>
      </div>
    </div>`;

  container.innerHTML = kpiHtml + tableHtml + formHtml;
}

/* ══════════════════════════════════════════
   🖨️  INVOICES — فواتير وإيصالات الإيجار
   طباعة من المتصفح، بدون تخزين PDF في DB
   ══════════════════════════════════════════ */

/* CSS مشترك لنافذة الطباعة */
function _invoiceCss() {
  return `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Segoe UI',Tahoma,Arial,sans-serif; background:#f2f2f2; color:#1a1a1a; }
    .page { width:210mm; min-height:297mm; margin:10mm auto; background:#fff; padding:16mm 14mm; position:relative; }
    .inv-hdr { display:flex; justify-content:space-between; align-items:flex-start; padding-bottom:14px; margin-bottom:18px; border-bottom:3px solid #ff6b00; }
    .inv-logo-wrap { display:flex; align-items:center; gap:12px; }
    .inv-logo { width:46px; height:46px; background:#ff6b00; border-radius:11px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:21px; font-weight:900; }
    .inv-brand-name { font-size:19px; font-weight:900; color:#ff6b00; line-height:1; }
    .inv-brand-sub  { font-size:10px; color:#999; direction:ltr; margin-top:2px; }
    .inv-hdr-right  { text-align:left; }
    .inv-doc-title  { font-size:22px; font-weight:900; line-height:1; }
    .inv-doc-num    { font-family:monospace; font-size:13px; color:#ff6b00; font-weight:700; margin-top:4px; direction:ltr; }
    .inv-doc-date   { font-size:11px; color:#888; margin-top:3px; direction:ltr; }
    .inv-info-grid  { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:18px; }
    .inv-info-box   { background:#f8f8f8; border:1px solid #ebebeb; border-radius:8px; padding:12px 14px; }
    .inv-info-box.owner  { border-right:4px solid #ff6b00; }
    .inv-info-box.tenant { border-right:4px solid #3b82f6; }
    .inv-info-ttl   { font-size:10px; font-weight:700; color:#aaa; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; }
    .inv-irow       { display:flex; gap:8px; margin-bottom:5px; font-size:12.5px; }
    .inv-ilbl       { color:#999; min-width:62px; flex-shrink:0; }
    .inv-ival       { font-weight:600; }
    .inv-sec-ttl    { font-size:12px; font-weight:800; padding:7px 11px; background:#fff5ed; border-radius:6px; border-right:3px solid #ff6b00; margin-bottom:10px; }
    .inv-table      { width:100%; border-collapse:collapse; margin-bottom:18px; font-size:12px; }
    .inv-table thead th { background:#1a1a1a; color:#fff; padding:9px 11px; text-align:right; font-weight:700; }
    .inv-table tbody td { padding:9px 11px; border-bottom:1px solid #f0f0f0; vertical-align:middle; }
    .inv-table tbody tr:nth-child(even) { background:#fafafa; }
    .sbadge         { display:inline-block; padding:2px 9px; border-radius:20px; font-size:10.5px; font-weight:700; }
    .sbadge.paid    { background:#dcfce7; color:#15803d; }
    .sbadge.partial { background:#fef9c3; color:#854d0e; }
    .sbadge.late    { background:#fee2e2; color:#991b1b; }
    .inv-totals     { margin-bottom:22px; }
    .inv-totals-box { background:#fff5ed; border:2px solid #ff6b00; border-radius:10px; padding:14px 22px; display:inline-block; min-width:250px; }
    .inv-trow       { display:flex; justify-content:space-between; align-items:center; gap:32px; font-size:12.5px; margin-bottom:7px; }
    .inv-trow.grand { font-size:17px; font-weight:900; color:#ff6b00; padding-top:8px; border-top:2px solid #ffcca0; margin-top:3px; }
    .inv-tlbl       { color:#666; }
    .inv-tval       { font-family:monospace; font-weight:700; }
    .inv-sig-grid   { display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-bottom:22px; }
    .inv-sig-box    { border:1px dashed #d0d0d0; border-radius:8px; padding:14px; text-align:center; min-height:84px; display:flex; flex-direction:column; }
    .inv-sig-ttl    { font-size:11px; color:#aaa; font-weight:700; margin-bottom:auto; }
    .inv-sig-line   { border-top:2px solid #d0d0d0; margin:16px 10px 0; padding-top:5px; font-size:11px; color:#777; }
    .inv-footer     { text-align:center; font-size:10px; color:#bbb; border-top:1px solid #eee; padding-top:12px; }
    .inv-wm         { position:absolute; bottom:25mm; left:50%; transform:translateX(-50%) rotate(-25deg); font-size:72px; font-weight:900; color:rgba(255,107,0,0.035); white-space:nowrap; pointer-events:none; user-select:none; }
    @media print { body { background:#fff; } .page { margin:0; padding:12mm 13mm; box-shadow:none; } }`;
}

/* رقم فاتورة: يستخدم DB column إن وُجد، وإلا يُولِّد client-side */
function _buildInvoiceNumber(payment) {
  if (payment.invoiceNumber) return payment.invoiceNumber;
  const dateStr = payment.createdAt || payment.paidDate || new Date().toISOString();
  const ym      = dateStr.substring(0, 7).replace('-', '');
  const shortId = payment.id ? payment.id.replace(/-/g, '').substring(0, 6).toUpperCase() : '000000';
  return `INV-${ym}-${shortId}`;
}

/* فتح نافذة الطباعة */
function _openPrintWindow(html) {
  const win = window.open('', '_blank', 'width=920,height=750');
  if (!win) { alert('تم حجب النافذة المنبثقة — الرجاء السماح بها من إعدادات المتصفح.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* ── طباعة فاتورة دفعة واحدة ── */
function printInvoice(paymentId) {
  const payment = paymentsList.find(p => p.id === paymentId);
  if (!payment) { alert('لم يتم العثور على بيانات الدفعة.'); return; }
  _openPrintWindow(_generateSingleInvoiceHTML(payment));
}

function _generateSingleInvoiceHTML(payment) {
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const contract  = contractsList.find(c => c.id === payment.contractId);
  const invNum    = _buildInvoiceNumber(payment);
  const issueDate = new Date().toLocaleDateString('ar-EG-u-nu-latn', { day:'2-digit', month:'long', year:'numeric' });
  const [yr, mo]  = (payment.month || '').split('-');
  const monthLabel = MONTHS_AR[parseInt(mo, 10) - 1]
    ? `${MONTHS_AR[parseInt(mo, 10) - 1]} ${yr}` : (payment.month || '—');
  const stLbl = { paid:'مدفوع بالكامل', partial:'دفع جزئي', late:'متأخر' }[payment.status] || payment.status;
  const ow = currentOwner || {};

  return `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>فاتورة ${invNum}</title>
<style>${_invoiceCss()}</style></head>
<body><div class="page">
  <div class="inv-hdr">
    <div class="inv-logo-wrap">
      <div class="inv-logo">م</div>
      <div><div class="inv-brand-name">مكاني Spot</div><div class="inv-brand-sub">makanispot.com</div></div>
    </div>
    <div class="inv-hdr-right">
      <div class="inv-doc-title">فاتورة إيجار</div>
      <div class="inv-doc-num">${invNum}</div>
      <div class="inv-doc-date">تاريخ الإصدار: ${issueDate}</div>
    </div>
  </div>
  <div class="inv-info-grid">
    <div class="inv-info-box owner">
      <div class="inv-info-ttl">المؤجّر</div>
      ${ow.name  ? '<div class="inv-irow"><span class="inv-ilbl">الاسم</span><span class="inv-ival">' + ow.name  + '</span></div>' : ''}
      ${ow.phone ? '<div class="inv-irow"><span class="inv-ilbl">الهاتف</span><span class="inv-ival" dir="ltr">' + ow.phone + '</span></div>' : ''}
      ${ow.email ? '<div class="inv-irow"><span class="inv-ilbl">البريد</span><span class="inv-ival" dir="ltr" style="font-size:11px">' + ow.email + '</span></div>' : ''}
      ${ow.place ? '<div class="inv-irow"><span class="inv-ilbl">الموقع</span><span class="inv-ival">' + ow.place + '</span></div>' : ''}
    </div>
    <div class="inv-info-box tenant">
      <div class="inv-info-ttl">المستأجر</div>
      <div class="inv-irow"><span class="inv-ilbl">الاسم</span><span class="inv-ival">${payment.tenantName}</span></div>
      ${(contract && contract.tenantPhone) ? '<div class="inv-irow"><span class="inv-ilbl">الهاتف</span><span class="inv-ival" dir="ltr">' + contract.tenantPhone + '</span></div>' : ''}
      <div class="inv-irow"><span class="inv-ilbl">المساحة</span><span class="inv-ival" style="color:#ff6b00;font-family:monospace">${payment.spaceCode}</span></div>
      ${(contract && contract.activity) ? '<div class="inv-irow"><span class="inv-ilbl">النشاط</span><span class="inv-ival">' + contract.activity + '</span></div>' : ''}
      ${contract ? '<div class="inv-irow"><span class="inv-ilbl">فترة العقد</span><span class="inv-ival" style="font-size:11px">' + formatDate(contract.startDate) + ' — ' + formatDate(contract.endDate) + '</span></div>' : ''}
    </div>
  </div>
  <div class="inv-sec-ttl">تفاصيل الدفعة</div>
  <table class="inv-table">
    <thead><tr><th>البند</th><th>الشهر</th><th>تاريخ الدفع</th><th>الحالة</th><th>المبلغ (ج.م.)</th></tr></thead>
    <tbody>
      <tr>
        <td>إيجار ${(contract && contract.activity) ? contract.activity : 'مساحة'} — ${payment.spaceCode}</td>
        <td style="font-weight:700">${monthLabel}</td>
        <td style="font-size:11px">${formatDate(payment.paidDate)}</td>
        <td><span class="sbadge ${payment.status}">${stLbl}</span></td>
        <td style="font-family:monospace;font-weight:800;font-size:14px">${parseFloat(payment.amount).toLocaleString('ar-EG')}</td>
      </tr>
      ${payment.notes ? '<tr><td colspan="5" style="font-size:11px;color:#999;background:#fafafa;font-style:italic">ملاحظة: ' + payment.notes + '</td></tr>' : ''}
    </tbody>
  </table>
  <div class="inv-totals">
    <div class="inv-totals-box">
      ${(contract && contract.rent) ? '<div class="inv-trow"><span class="inv-tlbl">الإيجار الشهري المتفق عليه</span><span class="inv-tval">' + parseFloat(contract.rent).toLocaleString('ar-EG') + ' ج</span></div>' : ''}
      <div class="inv-trow grand"><span class="inv-tlbl">إجمالي المدفوع</span><span class="inv-tval">${parseFloat(payment.amount).toLocaleString('ar-EG')} ج.م.</span></div>
    </div>
  </div>
  <div class="inv-sig-grid">
    <div class="inv-sig-box">
      <div class="inv-sig-ttl">توقيع وختم المؤجّر</div>
      <div class="inv-sig-line">${ow.name || ''}</div>
    </div>
    <div class="inv-sig-box">
      <div class="inv-sig-ttl">توقيع المستأجر</div>
      <div class="inv-sig-line">${payment.tenantName}</div>
    </div>
  </div>
  <div class="inv-footer">صدرت هذه الفاتورة إلكترونياً عبر منصة مكاني Spot · ${issueDate} · جميع المبالغ بالجنيه المصري (ج.م.)</div>
  <div class="inv-wm">مكاني Spot</div>
</div>
<script>window.onload = function() { window.print(); };<\/script>
</body></html>`;
}

/* ── طباعة كشف حساب عقد كامل ── */
function printContractStatement(contractId) {
  const contract = contractsList.find(c => c.id === contractId);
  if (!contract) return;
  const payments = [...paymentsList]
    .filter(p => p.contractId === contractId)
    .sort((a, b) => a.month.localeCompare(b.month));
  _openPrintWindow(_generateStatementHTML(contract, payments));
}

function _generateStatementHTML(contract, payments) {
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const mLbl = function(m) {
    const parts = (m || '').split('-');
    return (MONTHS_AR[parseInt(parts[1], 10) - 1] || parts[1]) + ' ' + parts[0];
  };
  const total     = payments.reduce(function(s, p) { return s + parseFloat(p.amount || 0); }, 0);
  const expected  = payments.length * parseFloat(contract.rent || 0);
  const remaining = Math.max(0, expected - total);
  const issueDate = new Date().toLocaleDateString('ar-EG-u-nu-latn', { day:'2-digit', month:'long', year:'numeric' });
  const ow = currentOwner || {};
  const stData = {
    paid:    ['مدفوع ✅', '#dcfce7', '#15803d'],
    partial: ['جزئي ⚡',  '#fef9c3', '#854d0e'],
    late:    ['متأخر ⏰', '#fee2e2', '#991b1b'],
  };

  const rowsHtml = payments.map(function(p, i) {
    const sd = stData[p.status] || ['—', '#f0f0f0', '#555'];
    return '<tr>'
      + '<td style="color:#bbb;font-size:11px">' + (i + 1) + '</td>'
      + '<td style="font-weight:700">' + mLbl(p.month) + '</td>'
      + '<td style="font-family:monospace;font-size:10.5px;color:#aaa">' + _buildInvoiceNumber(p) + '</td>'
      + '<td style="font-size:11px;color:#888">' + formatDate(p.paidDate) + '</td>'
      + '<td><span class="sbadge" style="background:' + sd[1] + ';color:' + sd[2] + '">' + sd[0] + '</span></td>'
      + '<td style="font-size:11px;color:#aaa;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (p.notes || '—') + '</td>'
      + '<td style="font-family:monospace;font-weight:700;text-align:left">' + parseFloat(p.amount).toLocaleString('ar-EG') + '</td>'
      + '</tr>';
  }).join('');

  return `<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>كشف حساب — ${contract.tenantName}</title>
<style>${_invoiceCss()}</style></head>
<body><div class="page">
  <div class="inv-hdr">
    <div class="inv-logo-wrap">
      <div class="inv-logo">م</div>
      <div><div class="inv-brand-name">مكاني Spot</div><div class="inv-brand-sub">makanispot.com</div></div>
    </div>
    <div class="inv-hdr-right">
      <div class="inv-doc-title">كشف حساب — سجل الدفعات</div>
      <div class="inv-doc-date">تاريخ الإصدار: ${issueDate}</div>
    </div>
  </div>
  <div class="inv-info-grid">
    <div class="inv-info-box owner">
      <div class="inv-info-ttl">المؤجّر</div>
      ${ow.name  ? '<div class="inv-irow"><span class="inv-ilbl">الاسم</span><span class="inv-ival">' + ow.name  + '</span></div>' : ''}
      ${ow.phone ? '<div class="inv-irow"><span class="inv-ilbl">الهاتف</span><span class="inv-ival" dir="ltr">' + ow.phone + '</span></div>' : ''}
      ${ow.place ? '<div class="inv-irow"><span class="inv-ilbl">الموقع</span><span class="inv-ival">' + ow.place + '</span></div>' : ''}
    </div>
    <div class="inv-info-box tenant">
      <div class="inv-info-ttl">المستأجر</div>
      <div class="inv-irow"><span class="inv-ilbl">الاسم</span><span class="inv-ival">${contract.tenantName}</span></div>
      ${contract.tenantPhone ? '<div class="inv-irow"><span class="inv-ilbl">الهاتف</span><span class="inv-ival" dir="ltr">' + contract.tenantPhone + '</span></div>' : ''}
      <div class="inv-irow"><span class="inv-ilbl">المساحة</span><span class="inv-ival" style="color:#ff6b00;font-family:monospace">${contract.spaceCode}</span></div>
      ${contract.activity ? '<div class="inv-irow"><span class="inv-ilbl">النشاط</span><span class="inv-ival">' + contract.activity + '</span></div>' : ''}
      <div class="inv-irow"><span class="inv-ilbl">فترة العقد</span><span class="inv-ival" style="font-size:11px">${formatDate(contract.startDate)} — ${formatDate(contract.endDate)}</span></div>
      ${contract.rent ? '<div class="inv-irow"><span class="inv-ilbl">الإيجار</span><span class="inv-ival" style="font-family:monospace">' + parseFloat(contract.rent).toLocaleString('ar-EG') + ' ج/شهر</span></div>' : ''}
    </div>
  </div>
  <div class="inv-sec-ttl">سجل الدفعات الكامل</div>
  ${!payments.length
    ? '<div style="text-align:center;padding:28px;color:#aaa;font-size:13px">لم تُسجَّل أي دفعات لهذا العقد بعد</div>'
    : '<table class="inv-table"><thead><tr><th>#</th><th>الشهر</th><th>رقم الفاتورة</th><th>تاريخ الدفع</th><th>الحالة</th><th>ملاحظات</th><th>المبلغ (ج.م.)</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>'
  }
  <div class="inv-totals">
    <div class="inv-totals-box">
      <div class="inv-trow"><span class="inv-tlbl">عدد الدفعات المسجّلة</span><span class="inv-tval">${payments.length} دفعة</span></div>
      ${(contract.rent && payments.length) ? '<div class="inv-trow"><span class="inv-tlbl">إجمالي المتوقع (' + payments.length + ' × ' + parseFloat(contract.rent).toLocaleString('ar-EG') + ' ج)</span><span class="inv-tval">' + expected.toLocaleString('ar-EG') + ' ج</span></div>' : ''}
      ${remaining > 0 ? '<div class="inv-trow" style="color:#dc2626"><span class="inv-tlbl">متبقي غير محصّل</span><span class="inv-tval">' + remaining.toLocaleString('ar-EG') + ' ج</span></div>' : ''}
      <div class="inv-trow grand"><span class="inv-tlbl">إجمالي المحصّل</span><span class="inv-tval">${total.toLocaleString('ar-EG')} ج.م.</span></div>
    </div>
  </div>
  <div class="inv-sig-grid">
    <div class="inv-sig-box">
      <div class="inv-sig-ttl">توقيع وختم المؤجّر</div>
      <div class="inv-sig-line">${ow.name || ''}</div>
    </div>
    <div class="inv-sig-box">
      <div class="inv-sig-ttl">توقيع المستأجر</div>
      <div class="inv-sig-line">${contract.tenantName}</div>
    </div>
  </div>
  <div class="inv-footer">صدر هذا الكشف إلكترونياً عبر منصة مكاني Spot · ${issueDate} · جميع المبالغ بالجنيه المصري (ج.م.)</div>
  <div class="inv-wm">مكاني Spot</div>
</div>
<script>window.onload = function() { window.print(); };<\/script>
</body></html>`;
}

function submitPayment(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim();
  const contractId = get('pf-contract');
  const month      = get('pf-month');
  const amount     = parseFloat(get('pf-amount'));
  const paidDate   = get('pf-date') || new Date().toISOString().slice(0,10);
  const status     = get('pf-status') || 'paid';
  const notes      = get('pf-notes');
  const msgEl      = document.getElementById('payment-msg');

  const showMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${type}`;
    msgEl.style.display = 'flex';
    msgEl.innerHTML = `<span class="alert-ico">${type==='success'?'✅':'❌'}</span><div class="alert-text"><strong>${text}</strong></div>`;
    setTimeout(() => { if (msgEl) msgEl.style.display='none'; }, 4000);
  };

  if (!contractId) { showMsg('danger','اختر العقد أولاً.'); return; }
  if (!month)      { showMsg('danger','حدد الشهر أولاً.'); return; }
  if (!amount||amount<=0) { showMsg('danger','أدخل مبلغاً صحيحاً.'); return; }

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showMsg('danger','تعذّر الاتصال — أعد تحميل الصفحة.'); return; }

  const contract = contractsList.find(c => c.id === contractId);
  const payload = {
    owner_id:    currentOwner.id,
    contract_id: contractId,
    tenant_name: contract?.tenantName || '—',
    space_code:  contract?.spaceCode  || '—',
    amount, month, paid_date: paidDate || null, status, notes: notes || null,
  };
  (async () => {
    try {
      const { error } = await sb.from('owner_payments').insert(payload);
      if (error) throw error;
      await loadPaymentsRemote();
      renderPayments();
      renderKPIs();
      document.getElementById('payment-form')?.reset();
      showMsg('success', `تم تسجيل دفعة ${amount.toLocaleString('ar-EG')} ج بنجاح ✅`);
    } catch (err) {
      showMsg('danger', 'تعذّر تسجيل الدفعة: ' + (err.message || 'خطأ'));
    }
  })();
}

async function deletePayment(id) {
  if (!confirm('هل تريد حذف هذه الدفعة؟')) return;
  const sb = getSB();
  if (sb && currentOwner?.id) {
    const { error } = await sb.from('owner_payments').delete().eq('id', id).eq('owner_id', currentOwner.id);
    if (error) { alert('تعذّر الحذف: ' + error.message); return; }
  }
  paymentsList = paymentsList.filter(p => p.id !== id);
  renderPayments();
  renderKPIs();
}

/* ══════════════════════════════════════════
   🚨  VIOLATIONS VIEW — سجل المخالفات
   ══════════════════════════════════════════ */
function renderViolations() {
  const container = document.getElementById('violations-content');
  if (!container) return;

  if (!canAccess('growth')) {
    container.innerHTML = planGateHtml('growth');
    return;
  }

  const sortedV = [...violationsList].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  /* عقود نشطة + منتهية حديثاً (آخر 90 يوم) — للسماح بتسجيل مخالفة على عقد انتهى قريباً */
  const _vExpCutoff = new Date(); _vExpCutoff.setDate(_vExpCutoff.getDate() - 90);
  const activeContracts = contractsList.filter(c =>
    c.status !== 'expired' || (c.endDate && new Date(c.endDate) >= _vExpCutoff));

  const sevCounts = { high:0, medium:0, low:0 };
  violationsList.forEach(v => { if (sevCounts[v.severity] !== undefined) sevCounts[v.severity]++; });

  const sevMap = {
    high:   { cls:'badge-red',    lbl:'خطير',  ico:'🚨' },
    medium: { cls:'badge-yellow', lbl:'متوسط', ico:'⚠️' },
    low:    { cls:'badge-blue',   lbl:'خفيف',  ico:'📋' },
  };

  const kpiHtml = `
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="kpi-card" style="${sevCounts.high>0?'border-color:rgba(255,77,77,0.35)':''}">
        <div class="kpi-ico">🚨</div>
        <div class="kpi-label">مخالفات خطيرة</div>
        <div class="kpi-value" style="color:${sevCounts.high?'var(--red)':'var(--text)'}">${sevCounts.high}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">تتطلب إجراءً فورياً</div>
      </div>
      <div class="kpi-card" style="${sevCounts.medium>0?'border-color:rgba(255,184,0,0.35)':''}">
        <div class="kpi-ico">⚠️</div>
        <div class="kpi-label">تحذيرات رسمية</div>
        <div class="kpi-value" style="color:${sevCounts.medium?'var(--yellow)':'var(--text)'}">${sevCounts.medium}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">متوسطة الخطورة</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">📋</div>
        <div class="kpi-label">ملاحظات خفيفة</div>
        <div class="kpi-value">${sevCounts.low}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">للمتابعة فقط</div>
      </div>
    </div>`;

  const tableHtml = `
    <div class="pcard" style="margin-bottom:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">🚨 سجل المخالفات والتحذيرات</div><div class="pcard-sub">كل مخالفة مسجّلة تُحتسب عند تجديد العقد</div></div>
        <span class="db-tag">DB: violations</span>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>نوع المخالفة</th><th>الخطورة</th><th>التاريخ</th><th>التفاصيل</th><th></th></tr></thead>
          <tbody>
            ${!sortedV.length
              ? `<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:30px">لا توجد مخالفات مسجّلة — هذا شيء جيد! 👍</td></tr>`
              : sortedV.map(v => {
                  const sev = sevMap[v.severity] || sevMap.low;
                  return `<tr style="${v.severity==='high'?'background:rgba(255,77,77,0.04)':''}">
                    <td style="font-weight:700">${v.tenantName}</td>
                    <td style="font-family:'Space Mono',monospace;color:var(--orange)">${v.spaceCode}</td>
                    <td>${v.type}</td>
                    <td><span class="badge ${sev.cls}">${sev.ico} ${sev.lbl}</span></td>
                    <td style="font-size:11px;color:var(--text3)">${formatDate(v.date)}</td>
                    <td style="font-size:11px;color:var(--text3);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.notes||'—'}</td>
                    <td><button class="btn btn-sm" style="background:var(--red);color:#fff;font-size:11px;padding:3px 10px" onclick="deleteViolation('${v.id}')">🗑️</button></td>
                  </tr>`;
                }).join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;

  const formHtml = `
    <div class="pcard">
      <div class="pcard-head">
        <div class="pcard-title">➕ تسجيل مخالفة / تحذير جديد</div>
      </div>
      <div class="pcard-body">
        <div id="violation-msg" class="alert-item" style="display:none;margin-bottom:14px"></div>
        <form id="violation-form" onsubmit="submitViolation(event)">
          <div class="form-row">
            <div class="form-group" style="margin:0">
              <label>المستأجر / العقد <span style="color:var(--red)">*</span></label>
              <select id="vf-contract" required>
                <option value="">اختر العقد</option>
                ${activeContracts.map(c=>`<option value="${c.id}">${c.tenantName} — ${c.spaceCode}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>تاريخ المخالفة <span style="color:var(--red)">*</span></label>
              <input type="date" id="vf-date" required>
            </div>
          </div>
          <div class="form-row" style="margin-top:12px">
            <div class="form-group" style="margin:0">
              <label>نوع المخالفة <span style="color:var(--red)">*</span></label>
              <select id="vf-type" required>
                <option value="">اختر النوع</option>
                <option value="تأخر الدفع">💳 تأخر الدفع</option>
                <option value="مخالفة النظافة">🧹 مخالفة النظافة</option>
                <option value="انتهاك شروط العقد">📄 انتهاك شروط العقد</option>
                <option value="ضوضاء وإزعاج">🔊 ضوضاء وإزعاج</option>
                <option value="تجاوز حدود المساحة">📐 تجاوز حدود المساحة</option>
                <option value="بضاعة منتهية الصلاحية">⚠️ بضاعة منتهية الصلاحية</option>
                <option value="سلوك غير لائق مع العملاء">🤝 سلوك غير لائق مع العملاء</option>
                <option value="أخرى">📋 أخرى</option>
              </select>
            </div>
            <div class="form-group" style="margin:0">
              <label>درجة الخطورة</label>
              <select id="vf-severity">
                <option value="low">📋 خفيفة — ملاحظة فقط</option>
                <option value="medium" selected>⚠️ متوسطة — تحذير رسمي</option>
                <option value="high">🚨 خطيرة — إجراء فوري مطلوب</option>
              </select>
            </div>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>تصنيف المخالفة</label>
            <select id="vf-category">
              <option value="financial">💳 مالية</option>
              <option value="behavioral">🧹 سلوكية</option>
              <option value="contractual" selected>📄 عقدية</option>
              <option value="other">📋 أخرى</option>
            </select>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>تفاصيل وملاحظات</label>
            <textarea id="vf-notes" placeholder="اشرح المخالفة بالتفصيل للتوثيق الرسمي…" style="min-height:68px"></textarea>
          </div>
          <button type="submit" class="btn btn-primary" style="margin-top:10px;background:var(--red);border-color:var(--red)">⚠️ تسجيل المخالفة</button>
        </form>
      </div>
    </div>`;

  container.innerHTML = kpiHtml + tableHtml + formHtml;
}

function submitViolation(e) {
  e.preventDefault();
  const get = id => document.getElementById(id)?.value?.trim();
  const contractId = get('vf-contract');
  const date       = get('vf-date');
  const type       = get('vf-type');
  const severity   = get('vf-severity') || 'medium';
  const category   = get('vf-category') || 'other';
  const notes      = get('vf-notes');
  const msgEl      = document.getElementById('violation-msg');

  const showMsg = (t, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${t}`;
    msgEl.style.display = 'flex';
    msgEl.innerHTML = `<span class="alert-ico">${t==='success'?'✅':'❌'}</span><div class="alert-text"><strong>${text}</strong></div>`;
    setTimeout(() => { if (msgEl) msgEl.style.display='none'; }, 4000);
  };

  if (!contractId) { showMsg('danger','اختر العقد أولاً.'); return; }
  if (!date)       { showMsg('danger','حدد تاريخ المخالفة.'); return; }
  if (!type)       { showMsg('danger','اختر نوع المخالفة.'); return; }

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showMsg('danger','تعذّر الاتصال — أعد تحميل الصفحة.'); return; }

  const contract = contractsList.find(c => c.id === contractId);
  const payload = {
    owner_id:    currentOwner.id,
    contract_id: contractId,
    tenant_name: contract?.tenantName || '—',
    space_code:  contract?.spaceCode  || '—',
    type, category, severity, vdate: date, notes: notes || null,
  };
  (async () => {
    try {
      const { error } = await sb.from('owner_violations').insert(payload);
      if (error) throw error;
      await loadViolationsRemote();
      renderViolations();
      document.getElementById('violation-form')?.reset();
      showMsg('success','تم تسجيل المخالفة بنجاح في سجل التوثيق.');
    } catch (err) {
      showMsg('danger', 'تعذّر تسجيل المخالفة: ' + (err.message || 'خطأ'));
    }
  })();
}

async function deleteViolation(id) {
  if (!confirm('هل تريد حذف هذه المخالفة من السجل؟')) return;
  const sb = getSB();
  if (sb && currentOwner?.id) {
    const { error } = await sb.from('owner_violations').delete().eq('id', id).eq('owner_id', currentOwner.id);
    if (error) { alert('تعذّر الحذف: ' + error.message); return; }
  }
  violationsList = violationsList.filter(v => v.id !== id);
  renderViolations();
}

/* ══════════════════════════════════════════
   📊  REPORTS VIEW — التقارير الشهرية (Pro)
   ══════════════════════════════════════════ */
function renderReports() {
  const container = document.getElementById('reports-content');
  if (!container) return;

  if (!canAccess('pro')) {
    container.innerHTML = planGateHtml('pro');
    return;
  }

  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const now        = new Date();
  const thisMonth  = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthLabel = MONTHS_AR[now.getMonth()] + ' ' + now.getFullYear();

  const activeContracts = contractsList.filter(c => c.status !== 'expired');
  const expiring  = activeContracts.filter(c => c.status==='expiring'||c.status==='renewal');
  const monthly   = activeContracts.reduce((s,c)=>s+(parseFloat(c.rent)||0),0);
  const collected = paymentsList.filter(p=>p.month===thisMonth&&(p.status==='paid'||p.status==='partial')).reduce((s,p)=>s+(parseFloat(p.amount)||0),0);
  const rented    = ownerSpaces.filter(s=>s.status==='rented');
  const occ       = ownerSpaces.length ? Math.round((rented.length/ownerSpaces.length)*100) : 0;
  const scoredT   = ownerTenants.filter(t=>t.score!==null);
  const avgScore  = scoredT.length ? (scoredT.reduce((s,t)=>s+t.score,0)/scoredT.length).toFixed(1) : '—';
  const fmt = n => n ? n.toLocaleString('ar-EG') + ' ج' : '—';

  /* --- Tenant violations count per tenant --- */
  const violationsByTenant = {};
  violationsList.forEach(v => {
    violationsByTenant[v.tenantName] = (violationsByTenant[v.tenantName]||0) + 1;
  });

  container.innerHTML = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:12px">
      <div>
        <div class="section-label">التقرير الشهري الكامل</div>
        <div style="font-size:20px;font-weight:900;color:var(--text)">${monthLabel}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px;font-family:'Space Mono',monospace">
          📍 ${currentOwner.place || 'مكاني Spot'} · ${currentOwner.name}
        </div>
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn" onclick="window.print()" style="gap:6px;background:var(--panel2)">🖨️ طباعة PDF</button>
        <button class="btn" onclick="exportToExcel('full')" style="gap:6px;background:var(--panel2)">📊 تصدير Excel</button>
        <button class="btn btn-primary btn-sm" onclick="renderReports()">🔄 تحديث</button>
      </div>
    </div>

    <!-- KPIs -->
    <div class="kpi-row" style="margin-bottom:22px">
      <div class="kpi-card">
        <div class="kpi-ico">💰</div>
        <div class="kpi-label">الإيجارات المتوقعة</div>
        <div class="kpi-value" style="font-size:22px">${fmt(monthly)}</div>
        <div style="margin-top:4px;font-size:10px;color:var(--text3)">${activeContracts.length} عقد نشط</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">✅</div>
        <div class="kpi-label">المحصّل هذا الشهر</div>
        <div class="kpi-value" style="font-size:22px;color:var(--green)">${fmt(collected)}</div>
        <div style="margin-top:4px;font-size:10px;color:var(--text3)">${monthly>0?Math.round((collected/monthly)*100):0}% تحصيل</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">📍</div>
        <div class="kpi-label">نسبة الإشغال</div>
        <div class="kpi-value" style="font-size:22px">${occ}%</div>
        <div style="margin-top:7px"><div class="prog-bar"><div class="prog-fill ${occ>=70?'green':occ>=40?'yellow':'red'}" style="width:${occ}%"></div></div></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">⭐</div>
        <div class="kpi-label">متوسط تقييم المستأجرين</div>
        <div class="kpi-value" style="font-size:22px">${avgScore}</div>
        <div style="margin-top:4px;font-size:10px;color:var(--text3)">${scoredT.length} مستأجر مقيّم</div>
      </div>
    </div>

    <div class="grid-2">
      <!-- Contract status -->
      <div class="pcard">
        <div class="pcard-head"><div><div class="pcard-title">📄 حالة العقود</div><div class="pcard-sub">${expiring.length>0?`⚠ ${expiring.length} تنتهي قريباً`:'كل العقود سارية ✅'}</div></div></div>
        <div class="pcard-body" style="padding:0">
          ${!activeContracts.length
            ? `<div style="text-align:center;padding:24px;color:var(--text3)">لا توجد عقود نشطة حالياً</div>`
            : activeContracts.map(c=>{
                const bCls = c.status==='active'?'badge-green':c.status==='expiring'?'badge-yellow':'badge-red';
                const lbl  = c.status==='active'?'سارية':c.status==='expiring'?'تنتهي قريباً':'للتجديد';
                const vCount = violationsByTenant[c.tenantName] || 0;
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border)">
                  <div>
                    <div style="font-size:13px;font-weight:800">${c.tenantName}</div>
                    <div style="font-size:10px;color:var(--text3);font-family:'Space Mono',monospace">${c.spaceCode}${c.rent?' · '+parseFloat(c.rent).toLocaleString('ar-EG')+' ج/شهر':''}</div>
                  </div>
                  <div style="text-align:left;flex-shrink:0">
                    <span class="badge ${bCls}">${lbl}</span>
                    ${vCount>0?`<div style="font-size:10px;color:var(--red);margin-top:3px">⚠ ${vCount} مخالفة</div>`:''}
                    <div style="font-size:10px;color:var(--text3);margin-top:2px">${c.daysLeft>0?c.daysLeft+' يوم متبقٍ':'منتهي'}</div>
                  </div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- Tenant performance -->
      <div class="pcard">
        <div class="pcard-head"><div><div class="pcard-title">⭐ أداء المستأجرين</div><div class="pcard-sub">مرتّبون حسب التقييم</div></div></div>
        <div class="pcard-body" style="padding:0">
          ${!ownerTenants.length
            ? `<div style="text-align:center;padding:24px;color:var(--text3)">لا توجد بيانات تقييم حتى الآن</div>`
            : [...ownerTenants].sort((a,b)=>(b.score||0)-(a.score||0)).map((t,i)=>{
                const col = t.score>=8?'var(--green)':t.score>=6?'var(--yellow)':'var(--red)';
                const trend = t.trend==='up'?'↑':t.trend==='down'?'↓':'→';
                const trendCls = t.trend==='up'?'up':t.trend==='down'?'down':'flat';
                return `<div style="display:flex;align-items:center;gap:12px;padding:12px 18px;border-bottom:1px solid var(--border)">
                  <div style="font-size:22px">${i===0?'🥇':i===1?'🥈':i===2?'🥉':t.icon}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:700">${t.name}</div>
                    <div style="font-size:10px;color:var(--text3)">${t.space} · ${t.act}</div>
                  </div>
                  <div style="text-align:left;flex-shrink:0">
                    <div style="font-size:16px;font-weight:900;color:${col};font-family:'Space Mono',monospace">${t.score||'—'}/10</div>
                    <span class="kpi-delta ${trendCls}" style="font-size:10px">${trend}</span>
                  </div>
                </div>`;
              }).join('')
          }
        </div>
      </div>
    </div>

    <!-- Payments summary -->
    ${paymentsList.length ? `
    <div class="pcard" style="margin-top:20px">
      <div class="pcard-head"><div class="pcard-title">💰 ملخص الدفعات — ${monthLabel}</div></div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>المبلغ</th><th>الحالة</th><th>تاريخ الاستلام</th></tr></thead>
          <tbody>
            ${paymentsList.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,10).map(p=>{
              const stMap={paid:'badge-green مدفوع',partial:'badge-yellow جزئي',late:'badge-red متأخر'};
              const [cls,lbl]=(stMap[p.status]||'badge-blue —').split(' ');
              return `<tr>
                <td style="font-weight:700">${p.tenantName}</td>
                <td style="font-family:'Space Mono',monospace;color:var(--orange)">${p.spaceCode}</td>
                <td style="font-family:'Space Mono',monospace">${parseFloat(p.amount).toLocaleString('ar-EG')} ج</td>
                <td><span class="badge ${cls}">${lbl}</span></td>
                <td style="font-size:11px;color:var(--text3)">${formatDate(p.paidDate)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- Violations this period -->
    ${violationsList.length ? `
    <div class="pcard" style="margin-top:20px;border-color:rgba(255,77,77,0.20)">
      <div class="pcard-head" style="background:rgba(255,77,77,0.04)">
        <div class="pcard-title" style="color:var(--red)">🚨 المخالفات المسجّلة (${violationsList.length})</div>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>المخالفة</th><th>الخطورة</th><th>التاريخ</th></tr></thead>
          <tbody>
            ${violationsList.slice(0,8).map(v=>{
              const sevCol=v.severity==='high'?'var(--red)':v.severity==='medium'?'var(--yellow)':'var(--text3)';
              const sevIco=v.severity==='high'?'🚨':v.severity==='medium'?'⚠️':'📋';
              return `<tr>
                <td style="font-weight:700">${v.tenantName}</td>
                <td style="font-family:'Space Mono',monospace;color:var(--orange)">${v.spaceCode}</td>
                <td>${v.type}</td>
                <td style="color:${sevCol}">${sevIco} ${v.severity==='high'?'خطير':v.severity==='medium'?'متوسط':'خفيف'}</td>
                <td style="font-size:11px;color:var(--text3)">${formatDate(v.date)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}

    <!-- بطاقة تصدير البيانات -->
    <div class="pcard" style="margin-top:20px;border-color:rgba(255,107,0,0.20)">
      <div class="pcard-head" style="background:rgba(255,107,0,0.03)">
        <div>
          <div class="pcard-title">⬇️ تصدير البيانات</div>
          <div class="pcard-sub">Excel حقيقي متعدد الـ sheets — عربي Unicode بدون مشاكل ترميز</div>
        </div>
        <span class="db-tag">XLSX</span>
      </div>
      <div class="pcard-body">
        <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px">
          <div class="form-group" style="margin:0;min-width:150px">
            <label style="font-size:11px;color:var(--text3)">من تاريخ</label>
            <input type="date" id="exp-from" style="font-size:12px;padding:6px 10px">
          </div>
          <div class="form-group" style="margin:0;min-width:150px">
            <label style="font-size:11px;color:var(--text3)">إلى تاريخ</label>
            <input type="date" id="exp-to" style="font-size:12px;padding:6px 10px">
          </div>
          <button class="btn btn-sm" onclick="document.getElementById('exp-from').value='';document.getElementById('exp-to').value=''" style="padding:6px 12px;font-size:11px;color:var(--text3)">✖ مسح الفلتر</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" onclick="exportToExcel('contracts',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);gap:6px">⬇️ عقود</button>
          <button class="btn" onclick="exportToExcel('payments',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);gap:6px">⬇️ مدفوعات</button>
          <button class="btn" onclick="exportToExcel('violations',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);gap:6px">⬇️ مخالفات</button>
          <button class="btn btn-primary" onclick="exportToExcel('full',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="gap:6px">⬇️ تصدير كامل (3 sheets)</button>
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--text3);line-height:1.6">
          💡 الفلتر اختياري — بدونه يُصدَّر كل السجلات. العقود تُفلتر بتاريخ البداية، المدفوعات بتاريخ الاستلام، المخالفات بتاريخ التسجيل.
        </div>
      </div>
    </div>

    <!-- Print footer -->
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text3)">
      <span>🏢 مكاني Spot — نظام إدارة المساحات الصغيرة</span>
      <span>${monthLabel} · تم الإنشاء: ${new Date().toLocaleDateString('ar-EG')}</span>
    </div>`;
}

/* ══════════════════════════════════════════
   📊  تصدير البيانات — Excel حقيقي متعدد الـ sheets
   SheetJS (XLSX) — عربي Unicode بدون مشاكل encoding
   ══════════════════════════════════════════ */

/* نقطة الدخول الوحيدة: type = 'contracts' | 'payments' | 'violations' | 'full' */
function exportToExcel(type, opts) {
  if (typeof XLSX === 'undefined') {
    alert('مكتبة Excel لم تُحمَّل بعد — انتظر ثوانٍ ثم حاول مجدداً.');
    return;
  }
  opts = opts || {};
  const dateFrom = opts.from ? new Date(opts.from) : null;
  const dateTo   = opts.to   ? new Date(opts.to + 'T23:59:59') : null;

  /* فلتر التاريخ العام */
  function filterDates(list, field) {
    if (!dateFrom && !dateTo) return list;
    return list.filter(function(item) {
      const d = item[field] ? new Date(item[field]) : null;
      if (!d) return true;
      if (dateFrom && d < dateFrom) return false;
      if (dateTo   && d > dateTo)   return false;
      return true;
    });
  }

  const wb = XLSX.utils.book_new();

  if (type === 'contracts' || type === 'full') {
    const ws = XLSX.utils.aoa_to_sheet(_buildContractsSheet(filterDates(contractsList, 'startDate')));
    _styleExcelSheet(ws, 10);
    XLSX.utils.book_append_sheet(wb, ws, 'العقود');
  }
  if (type === 'payments' || type === 'full') {
    const ws = XLSX.utils.aoa_to_sheet(_buildPaymentsSheet(filterDates(paymentsList, 'paidDate')));
    _styleExcelSheet(ws, 7);
    XLSX.utils.book_append_sheet(wb, ws, 'المدفوعات');
  }
  if (type === 'violations' || type === 'full') {
    const ws = XLSX.utils.aoa_to_sheet(_buildViolationsSheet(filterDates(violationsList, 'date')));
    _styleExcelSheet(ws, 7);
    XLSX.utils.book_append_sheet(wb, ws, 'المخالفات');
  }

  const now = new Date();
  const dateStr  = now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
  const typeName = { contracts:'عقود', payments:'مدفوعات', violations:'مخالفات', full:'كامل' }[type] || type;
  XLSX.writeFile(wb, 'makani-' + typeName + '-' + dateStr + '.xlsx');
}

/* ضبط عرض الأعمدة تلقائياً */
function _styleExcelSheet(ws, colCount) {
  const cols = [];
  for (let i = 0; i < colCount; i++) cols.push({ wch: 22 });
  ws['!cols'] = cols;
}

/* ── sheet العقود ── */
function _buildContractsSheet(list) {
  const stLbl = function(s) {
    return s === 'active' ? 'سارية' : s === 'expiring' ? 'تنتهي قريباً' : s === 'renewal' ? 'للتجديد' : 'منتهية';
  };
  const headers = ['رقم الوحدة','اسم المستأجر','الهاتف','النشاط','الإيجار الشهري (ج)','تاريخ البداية','تاريخ النهاية','الأيام المتبقية','الحالة','ملاحظات'];
  const rows = list.map(function(c) {
    return [
      c.spaceCode,
      c.tenantName,
      c.tenantPhone || '—',
      c.activity    || '—',
      parseFloat(c.rent) || 0,
      c.startDate,
      c.endDate,
      c.daysLeft > 0 ? c.daysLeft : 0,
      stLbl(c.status),
      c.notes || '',
    ];
  });
  return [headers].concat(rows);
}

/* ── sheet المدفوعات ── */
function _buildPaymentsSheet(list) {
  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const stLbl = { paid:'مدفوع', partial:'دفع جزئي', late:'متأخر' };
  const mLbl = function(m) {
    const parts = (m || '').split('-');
    return (MONTHS_AR[parseInt(parts[1], 10) - 1] || parts[1] || '') + ' ' + (parts[0] || '');
  };
  const headers = ['رقم الوحدة','اسم المستأجر','شهر الإيجار','المبلغ (ج)','الحالة','تاريخ الاستلام','ملاحظات'];
  const rows = list.map(function(p) {
    return [
      p.spaceCode,
      p.tenantName,
      mLbl(p.month),
      parseFloat(p.amount) || 0,
      stLbl[p.status] || p.status,
      p.paidDate || '',
      p.notes    || '',
    ];
  });
  return [headers].concat(rows);
}

/* ── sheet المخالفات ── */
function _buildViolationsSheet(list) {
  const sevLbl = { high:'خطيرة', medium:'متوسطة', low:'خفيفة' };
  const catLbl = { financial:'مالية', behavioral:'سلوكية', contractual:'عقدية', other:'أخرى' };
  const headers = ['رقم الوحدة','اسم المستأجر','تاريخ المخالفة','نوع المخالفة','التصنيف','الخطورة','ملاحظات'];
  const rows = list.map(function(v) {
    return [
      v.spaceCode,
      v.tenantName,
      v.date   || '',
      v.type   || '—',
      catLbl[v.category] || v.category || '—',
      sevLbl[v.severity] || v.severity || '—',
      v.notes  || '',
    ];
  });
  return [headers].concat(rows);
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

  /* ── 3. التنبيهات المختصرة (أحدث 3 — مع احترام الإخفاء والتفضيلات) */
  const alertsList = document.getElementById('overview-alerts-list');
  if (alertsList) {
    const previewAlerts = _buildLocalAlerts().slice(0, 3);
    if (!previewAlerts.length) {
      alertsList.innerHTML = `
        <div class="alert-item success">
          <span class="alert-ico">✅</span>
          <div class="alert-text"><strong>لا توجد تنبيهات عاجلة حالياً</strong>كل شيء يسير بشكل جيد.</div>
        </div>`;
    } else {
      alertsList.innerHTML = previewAlerts.map(a => `
        <div class="alert-item ${a.type}">
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
    /* عدد الأشهر حسب الفترة المختارة: شهري=٦ · ربع=٣ · سنوي=١٢ */
    const monthsCount = currentPeriod === 'year' ? 12 : currentPeriod === 'quarter' ? 3 : 6;
    for (let i = monthsCount - 1; i >= 0; i--) {
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
      /* لا توجد عقود — عرض أعمدة placeholder بنمط ثابت */
      const pHts = [40, 55, 35, 70, 50, 80, 45, 60, 38, 72, 52, 66];
      chartEl.innerHTML = months.map((m, i) => `
        <div class="bar${i === lastIdx ? ' high' : ''}" style="height:${pHts[i % pHts.length]}%;opacity:0.18">
          <span class="bar-label">${m.label}</span>
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
  'overview':   'نظرة عامة',
  'tenants':    'المستأجرون',
  'spaces':     'المساحات',
  'bookings':   'طلبات الحجز',
  'contracts':  'العقود',
  'ratings':    'التقييمات',
  'revenue':    'الإيرادات',
  'payments':   'تسجيل الدفعات',
  'violations': 'سجل المخالفات',
  'insights':   'الرؤى والتوصيات',
  'reports':    'التقارير الشهرية',
  'add-space':  'إضافة مساحة جديدة',
  'add-bazaar': 'تنظيم بازار',
  'alerts':     'التنبيهات',
  'settings':   'الإعدادات',
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

  /* عند فتح التنبيهات: أعد رسمها ثم اعتبرها مقروءة */
  if (viewId === 'alerts')     { renderAlerts(); setTimeout(markNotificationsRead, 1500); }
  if (viewId === 'add-bazaar') renderAddBazaarView();
  if (viewId === 'ratings')    loadOwnerRatings();   /* تحديث القائمة والسجل من Supabase */
  if (viewId === 'bookings')   { loadBookingsRemote().then(renderBookings); }
}

function setPeriod(p, btn) {
  document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  currentPeriod = p || 'month';
  /* الفترة تتحكّم في نافذة الرسم البياني في النظرة العامة وتعيد الحساب */
  renderOverview();
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
              <div class="pcard-title" style="color:var(--yellow)">⏳ طلبات المساحات المُرسلة (${ownerPendingSpaces.length})</div>
              <div class="pcard-sub">فريق مكاني Spot سيراجعها ويضيفها خلال 24 ساعة</div>
            </div>
          </div>
          <div class="pcard-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>اسم المساحة</th><th>النوع</th><th>المنطقة</th><th>الأحجام</th><th>السعر</th><th>الوحدات</th><th>الحالة</th><th>تاريخ الإرسال</th><th></th></tr></thead>
              <tbody>
                ${ownerPendingSpaces.map(p => {
                  const typeLabels = { mall:'🏬 مول', club:'🏊 نادي', school:'🏫 مدرسة' };
                  const sentDate   = p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('ar-EG') : '—';
                  const isRejected = p.status === 'rejected';
                  const statusBadge = isRejected
                    ? `<span class="badge badge-red">❌ مرفوض</span>`
                    : `<span class="badge badge-yellow">⏳ قيد المراجعة</span>`;
                  return `<tr style="background:${isRejected ? 'rgba(255,77,77,0.03)' : 'rgba(255,184,0,0.03)'}">
                    <td style="font-weight:700">${p.name}</td>
                    <td>${typeLabels[p.type] || p.type}</td>
                    <td>${p.loc}</td>
                    <td style="font-size:11px;color:var(--text3)">${p.sizes || '—'}</td>
                    <td style="font-family:'Space Mono',monospace">${p.price ? p.price.toLocaleString('ar-EG')+' ج' : '—'}</td>
                    <td style="text-align:center">${p.subCount > 0 ? `<span class="badge badge-blue">${p.subCount} وحدة</span>` : '—'}</td>
                    <td>${statusBadge}</td>
                    <td style="font-size:11px;color:var(--text3)">${sentDate}</td>
                    <td>${!isRejected ? `<button class="btn btn-sm" style="background:none;border:1px solid var(--red);color:var(--red);font-size:11px" onclick="removePendingSpace('${p.id}')">إلغاء</button>` : ''}</td>
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
      reserved:    { cls:'badge-blue',   lbl:'محجوزة' },
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
          <div style="display:flex;align-items:center;gap:8px">
            ${s.score
              ? `<div class="prog-bar" style="width:64px"><div class="prog-fill ${progCls}" style="width:${progPct}%"></div></div>`
              : '<span style="color:var(--text3);font-size:11px">—</span>'}
            ${s.unitDbId ? `<button class="btn btn-sm" style="font-size:11px;padding:3px 9px" onclick="openUnitEdit('${s.unitDbId}')">✏️ تعديل</button>` : ''}
          </div>
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:30px">لا يوجد مستأجرون حتى الآن — أضف عقداً من صفحة العقود</td></tr>';
    return;
  }

  /* فرز حسب اختيار المستخدم */
  const sorted = [...ownerTenants];
  if (_tenantSort === 'score-asc')       sorted.sort((a, b) => (a.score ?? 99) - (b.score ?? 99));
  else if (_tenantSort === 'recent')     sorted.sort((a, b) => (b.daysLeft ?? 0) - (a.daysLeft ?? 0));
  else                                   sorted.sort((a, b) => (b.score ?? -1) - (a.score ?? -1)); /* score-desc */

  tbody.innerHTML = sorted.map(t => {
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

let _currentTenantDetailId = null;

function showTenantDetail(id) {
  const t = ownerTenants.find(x => x.id === id);
  if (!t) return;
  _currentTenantDetailId = id;

  setTxt('td-name',  t.name + (t.act && t.act !== '—' ? ' — ' + t.act : ''));
  setTxt('td-space', 'المساحة: ' + t.space + ' · العقد حتى: ' + t.contract);

  const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                     'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  /* التقييمات الحقيقية لهذا العقد مرتّبة بالشهر */
  const ratings = ratingsList.filter(r => r.contractId === id)
    .sort((a, b) => (a.month || '').localeCompare(b.month || ''));
  const latest = ratings[ratings.length - 1];

  /* تفصيل المعايير من آخر تقييم فعلي (لا أرقام عشوائية) */
  const scoresEl = document.getElementById('td-scores');
  if (scoresEl) {
    if (!latest) {
      scoresEl.innerHTML = `<div style="color:var(--text3);font-size:12px;padding:8px 0">لا يوجد تقييم بعد لهذا المستأجر — قيّمه من صفحة التقييمات.</div>`;
    } else {
      const crit = [
        { label:'⏰ الالتزام بالمواعيد', v: latest.commitment },
        { label:'🧹 نظافة المكان',        v: latest.cleanliness },
        { label:'🤝 حسن التعامل',         v: latest.dealing },
        { label:'💳 الالتزام المالي',     v: latest.payment },
        { label:'📋 احترام الشروط',       v: latest.rules },
      ];
      scoresEl.innerHTML = crit.map(c => {
        const s10 = (c.v || 0) * 2;          /* نجوم ١-٥ → مقياس ١٠ */
        const cls = s10 >= 8 ? 'green' : s10 >= 6 ? 'yellow' : 'red';
        return `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text2);margin-bottom:4px">
              <span>${c.label}</span><strong style="font-family:'Space Mono',monospace">${c.v ? s10 + '/10' : '—'}</strong>
            </div>
            <div class="prog-bar"><div class="prog-fill ${cls}" style="width:${s10*10}%"></div></div>
          </div>`;
      }).join('');
    }
  }

  /* تطور التقييم شهرياً — من التقييمات الفعلية */
  const chartEl = document.getElementById('td-chart');
  if (chartEl) {
    const last = ratings.slice(-5);
    if (!last.length) {
      chartEl.innerHTML = `<div style="color:var(--text3);font-size:11px;padding:8px 0">لا توجد بيانات شهرية بعد</div>`;
    } else {
      const maxS = Math.max(...last.map(r => r.avgScore || 0), 1);
      chartEl.innerHTML = last.map((r, i) => {
        const s   = r.avgScore || 0;
        const h   = Math.max(8, Math.round((s / maxS) * 100));
        const mo  = (r.month || '').split('-')[1];
        const lbl = MONTHS_AR[parseInt(mo, 10) - 1]?.slice(0, 3) || (r.month || '');
        const cls = i === last.length - 1 ? 'high' : '';
        return `<div class="bar ${cls}" style="height:${h}%"><span class="bar-label">${lbl}</span><span class="bar-val">${s.toFixed(1)}</span></div>`;
      }).join('');
    }
  }

  /* ملاحظات المستأجر = ملاحظات العقد */
  const notesEl = document.getElementById('td-notes');
  if (notesEl) {
    const contract = contractsList.find(c => c.id === id);
    notesEl.value = contract?.notes || '';
  }

  const detail = document.getElementById('tenant-detail');
  if (detail) {
    detail.style.display = 'block';
    detail.scrollIntoView({ behavior:'smooth', block:'start' });
  }
}

/* حفظ ملاحظات المستأجر في العقد (Supabase) */
async function saveTenantNotes() {
  if (!_currentTenantDetailId) { alert('اختر مستأجراً أولاً.'); return; }
  const notes = document.getElementById('td-notes')?.value.trim() || '';
  const sb = getSB();
  if (!sb || !currentOwner?.id) { alert('تعذّر الاتصال.'); return; }
  const btn = document.getElementById('td-save-notes-btn');
  if (btn) btn.disabled = true;
  const { error } = await sb.from('owner_contracts').update({ notes })
    .eq('id', _currentTenantDetailId).eq('owner_id', currentOwner.id);
  if (btn) btn.disabled = false;
  if (error) { alert('تعذّر حفظ الملاحظات: ' + error.message); return; }
  const c = contractsList.find(x => x.id === _currentTenantDetailId);
  if (c) c.notes = notes;
  if (btn) { btn.textContent = '✅ تم الحفظ'; setTimeout(() => { btn.textContent = '💾 حفظ الملاحظات'; }, 2000); }
  renderContracts();
}

/* فتح صفحة العقود لإضافة مستأجر جديد (المستأجر = عقد) */
function addTenant() {
  cancelEditContract();
  const nav = document.querySelector('[onclick*="contracts"]');
  goTo('contracts', nav);
  setTimeout(() => {
    document.getElementById('contract-form')?.scrollIntoView({ behavior:'smooth', block:'start' });
    document.getElementById('cf-tenant')?.focus();
  }, 200);
}

/* فرز المستأجرين */
let _tenantSort = 'score-desc';
function sortTenants(mode) {
  _tenantSort = mode || 'score-desc';
  renderTenants();
}

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
          <button class="btn btn-sm" style="color:var(--orange);border-color:rgba(255,107,0,0.25)" onclick="printContractStatement('${c.id}')">📋 كشف</button>
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
/* تفضيل تنبيه (افتراضياً مفعّل) */
function _notifPref(key) {
  if (!ownerSettings) return true;
  return ownerSettings[key] !== false;
}
/* مجموعة التنبيهات المحلية المُستبعَدة (محفوظة في owner_settings.extra) */
function _dismissedSet() {
  return new Set((ownerSettings?.extra?.dismissed_alerts) || []);
}
async function _persistDismissed(set) {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const extra = { ...(ownerSettings?.extra || {}), dismissed_alerts: [...set] };
  ownerSettings = { ...(ownerSettings || { owner_id: currentOwner.id }), extra };
  try { await sb.from('owner_settings').upsert({ owner_id: currentOwner.id, extra }, { onConflict: 'owner_id' }); }
  catch (e) { console.warn('[Makani] persist dismissed:', e.message); }
}

/* يبني التنبيهات المحلية (المحسوبة) مع مفاتيح ثابتة + احترام التفضيلات + استبعاد المُلغاة */
function _buildLocalAlerts() {
  const out = [];
  const dismissed = _dismissedSet();
  const push = a => { if (!dismissed.has(a.key)) out.push(a); };

  /* مساحات مهملة */
  if (_notifPref('notify_abandoned_space')) {
    ownerSpaces
      .filter(s => s.status === 'available' && s.daysEmpty >= ABANDONED_THRESHOLD)
      .forEach(s => push({
        key: 'sp:' + (s.unitDbId || s.code), type: 'danger', ico: '🏚️',
        title: `المساحة ${s.code} مهملة منذ ${s.daysEmpty} يوم`,
        body:  `${s.loc} (${s.size}) — لم تُؤجَّر منذ فترة. راجع السعر أو وسّع الأنشطة المسموحة.`,
      }));
  }

  /* تقييمات منخفضة ومتراجعة */
  if (_notifPref('notify_low_rating')) {
    ownerTenants
      .filter(t => t.score !== null && t.score < 5 && t.trend === 'down')
      .forEach(t => push({
        key: 'lr:' + t.id, type: 'danger', ico: '📉',
        title: `تقييم ${t.name} منخفض باستمرار`,
        body:  `التقييم الحالي ${t.score}/10 ومتراجع. العقد ينتهي بعد ${t.daysLeft} يوم — يُنصح بمراجعة الوضع.`,
      }));
  }

  /* عقود تنتهي قريباً — مستويا ٧ و ٣٠ يوم */
  if (_notifPref('notify_contract_expiry')) {
    contractsList
      .filter(c => c.status !== 'expired' && c.daysLeft >= 0 && c.daysLeft <= 30)
      .forEach(c => {
        const urgent = c.daysLeft <= 7;
        push({
          key: 'ce:' + c.id, type: urgent ? 'danger' : 'warning', ico: urgent ? '⏰' : '📅',
          title: `عقد ${c.tenantName} ينتهي خلال ${c.daysLeft} يوم${urgent ? ' — عاجل' : ''}`,
          body:  `المساحة ${c.spaceCode || '—'} — ${urgent ? 'تواصل فوراً مع المستأجر للتجديد.' : 'ابدأ ترتيب التجديد أو ابحث عن بديل.'}`,
        });
      });
  }

  /* دفعات متأخرة فعلية (من سجل المدفوعات) */
  if (_notifPref('notify_payment_due')) {
    paymentsList
      .filter(p => p.status === 'late')
      .forEach(p => push({
        key: 'pl:' + p.id, type: 'warning', ico: '💳',
        title: `دفعة متأخرة — ${p.tenantName}`,
        body:  `المساحة ${p.spaceCode} — دفعة شهر ${p.month} مسجّلة كمتأخرة. تابع التحصيل.`,
      }));
  }

  /* لا مساحات مضافة */
  if (!ownerSpaces.length && !dismissed.has('no-spaces')) {
    out.push({ key: 'no-spaces', type: 'info', ico: '💡', title: 'لم تُضَف مساحات بعد', body: 'ابدأ بإضافة مساحاتك ليراها المستأجرون على المنصة.' });
  }
  return out;
}

let _lastLocalAlertKeys = [];

function renderAlerts() {
  const list = document.getElementById('alerts-list');
  if (!list) return;

  const NOTIF_MAP = {
    'space_submitted': { type:'info',    ico:'📋', title:'طلب إضافة مساحة جديدة',      body:'تم إرسال طلب إضافة المساحة — في انتظار المراجعة.' },
    'space_approved':  { type:'success', ico:'✅', title:'تمت الموافقة على المساحة',    body:'تمت الموافقة على مساحتك وهي الآن قيد الإعداد للنشر.' },
    'space_published': { type:'success', ico:'🚀', title:'تم نشر المساحة على المنصة',  body:'مساحتك أصبحت مرئية للمستأجرين على منصة مكاني Spot.' },
    'space_rejected':  { type:'danger',  ico:'❌', title:'تم رفض طلب المساحة',         body:'راجع بيانات المساحة وأعد تقديم الطلب.' },
    'bazaar_submitted':{ type:'info',    ico:'🎪', title:'طلب تنظيم بازار قيد المراجعة',body:'تم استلام طلب البازار وسيتم الرد خلال 24 ساعة.' },
    'bazaar_approved': { type:'success', ico:'🎉', title:'تمت الموافقة على البازار',     body:'تمت الموافقة على بازارك وسيُنشر على المنصة قريباً.' },
    'bazaar_rejected': { type:'danger',  ico:'⚠️', title:'مراجعة مطلوبة على طلب البازار', body:'يوجد ملاحظات على طلب البازار — تواصل مع الإدارة.' },
    'bazaar_updated':  { type:'warning', ico:'🔄', title:'تحديث على حالة البازار',       body:'حدث تغيير في حالة طلب البازار — راجع التفاصيل.' },
    'booking_request': { type:'info',    ico:'📬', title:'طلب حجز جديد',                 body:'وصلك طلب حجز جديد — راجعه في صندوق طلبات الحجز.' },
    'waitlist_request':{ type:'warning', ico:'⏳', title:'طلب قائمة انتظار جديد',         body:'انضم عميل لقائمة انتظار إحدى مساحاتك — راجعه في تبويب قائمة الانتظار.' },
  };

  /* تنبيهات Supabase (قابلة للحذف الفعلي) */
  const sbAlerts = supabaseNotifications.map(n => {
    const m = NOTIF_MAP[n.type] || { type:'info', ico:'🔔', title: n.title || 'إشعار جديد', body: n.body || '' };
    return { nid: n.id, type: m.type, ico: m.ico, title: n.title || m.title, body: n.body || m.body };
  });

  /* تنبيهات محلية محسوبة (قابلة للإخفاء/المسح) */
  const localAlerts = _buildLocalAlerts();
  _lastLocalAlertKeys = localAlerts.map(a => a.key);

  updateNotifBadge();

  const total = sbAlerts.length + localAlerts.length;
  if (!total) {
    list.innerHTML = `<div class="alert-item success">
      <span class="alert-ico">✅</span>
      <div class="alert-text"><strong>لا توجد تنبيهات حالياً</strong>كل شيء يسير بشكل ممتاز.</div>
    </div>`;
    return;
  }

  const closeBtn = (handler) =>
    `<button title="حذف التنبيه" onclick="${handler}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;margin-inline-start:auto;flex-shrink:0">✕</button>`;

  const toolbar = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-size:12px;color:var(--text3)">${total} تنبيه</span>
      <button class="btn btn-ghost btn-sm" onclick="clearAllAlerts()" style="font-size:12px">🗑️ مسح الكل</button>
    </div>`;

  const rowsSb = sbAlerts.map(a => `
    <div class="alert-item ${a.type}" style="display:flex;align-items:flex-start;gap:10px">
      <span class="alert-ico">${a.ico}</span>
      <div class="alert-text" style="flex:1"><strong>${a.title}</strong>${a.body}</div>
      ${closeBtn(`deleteNotification('${a.nid}')`)}
    </div>`).join('');

  const rowsLocal = localAlerts.map(a => `
    <div class="alert-item ${a.type}" style="display:flex;align-items:flex-start;gap:10px">
      <span class="alert-ico">${a.ico}</span>
      <div class="alert-text" style="flex:1"><strong>${a.title}</strong>${a.body}</div>
      ${closeBtn(`dismissAlert('${a.key}')`)}
    </div>`).join('');

  list.innerHTML = toolbar + rowsSb + rowsLocal;
}

/* حذف تنبيه Supabase فعلياً */
async function deleteNotification(nid) {
  const sb = getSB();
  if (sb && currentOwner?.id) {
    try { await sb.from('notifications').delete().eq('id', nid).eq('owner_id', currentOwner.id); }
    catch (e) { console.warn('[Makani] delete notif:', e.message); }
  }
  supabaseNotifications = supabaseNotifications.filter(n => n.id !== nid);
  renderAlerts();
  updateNotifBadge();
}

/* إخفاء تنبيه محلي محسوب (يُحفظ في الإعدادات) */
async function dismissAlert(key) {
  const set = _dismissedSet();
  set.add(key);
  await _persistDismissed(set);
  renderAlerts();
  updateNotifBadge();
}

/* مسح كل التنبيهات: حذف إشعارات Supabase + إخفاء كل المحلية الظاهرة */
async function clearAllAlerts() {
  if (!confirm('مسح كل التنبيهات الحالية؟')) return;
  const sb = getSB();
  if (sb && currentOwner?.id && supabaseNotifications.length) {
    const ids = supabaseNotifications.map(n => n.id).filter(Boolean);
    if (ids.length) {
      try { await sb.from('notifications').delete().in('id', ids).eq('owner_id', currentOwner.id); }
      catch (e) { console.warn('[Makani] clear notifs:', e.message); }
    }
    supabaseNotifications = [];
  }
  const set = _dismissedSet();
  _lastLocalAlertKeys.forEach(k => set.add(k));
  await _persistDismissed(set);
  renderAlerts();
  updateNotifBadge();
}

/* ══════════════════════════════════════════
   📬  BOOKINGS — طلبات الحجز الواردة
   ══════════════════════════════════════════ */

/* تحديث بادج "طلبات الحجز" في السايدبار */
function updateBookingsBadge() {
  /* العدّاد = الطلبات المعلّقة (عدا قوائم الانتظار، لها تبويبها الخاص) + قوائم الانتظار */
  const pending = bookingsList.filter(b =>
    (b.status === 'pending' || b.status === 'viewing_pending') || b.isWaitlist).length;
  const badge = document.getElementById('nb-bookings');
  if (!badge) return;
  if (pending > 0) {
    badge.textContent = String(pending);
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

/* عرض قسم طلبات الحجز */
function renderBookings() {
  const wrap = document.getElementById('bookings-list');
  if (!wrap) return;
  updateBookingsBadge();

  /* فصل قوائم الانتظار عن الحجوزات العادية */
  const waitlist = bookingsList.filter(b => b.isWaitlist);
  const normal   = bookingsList.filter(b => !b.isWaitlist);

  /* KPI cards في رأس الصفحة — عن الحجوزات العادية */
  const pending   = normal.filter(b => b.status === 'pending' || b.status === 'viewing_pending').length;
  const confirmed = normal.filter(b => b.status === 'confirmed').length;
  const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setKpi('bk-kpi-pending',   pending);
  setKpi('bk-kpi-confirmed', confirmed);
  setKpi('bk-kpi-total',     normal.length);

  const statusMap = {
    pending:         { lbl: '⏳ معلق',    cls: 'badge-yellow' },
    viewing_pending: { lbl: '👁 معاينة',  cls: 'badge-purple' },
    confirmed:       { lbl: '✅ مؤكد',    cls: 'badge-green'  },
    cancelled:       { lbl: '❌ ملغي',    cls: 'badge-red'    },
    completed:       { lbl: '🏁 مكتمل',   cls: 'badge-blue'   },
  };

  /* filter tab — نُخزّن الاختيار في العنصر نفسه */
  const activeFilter = wrap.dataset.filter || 'pending';

  /* تبويب قائمة الانتظار منفصل تماماً عن باقي التبويبات */
  const filtered = activeFilter === 'waitlist'
    ? waitlist
    : activeFilter === 'all'
      ? normal
      : normal.filter(b => {
          if (activeFilter === 'pending') return b.status === 'pending' || b.status === 'viewing_pending';
          return b.status === activeFilter;
        });

  const pendingCount   = normal.filter(b => b.status === 'pending' || b.status === 'viewing_pending').length;
  const confirmedCount = normal.filter(b => b.status === 'confirmed').length;
  const waitlistCount  = waitlist.length;

  const tabBtn = (val, label, count) => {
    const on = activeFilter === val ? ' bk-tab-on' : '';
    return `<button class="bk-tab${on}" onclick="setBkFilter('${val}')">${label}${count ? ` <span class="bk-tab-cnt">${count}</span>` : ''}</button>`;
  };

  const tabsHtml = `
    <div class="bk-tabs">
      ${tabBtn('pending',   'معلقة',         pendingCount)}
      ${tabBtn('confirmed', 'مؤكدة',         confirmedCount)}
      ${tabBtn('waitlist',  '⏳ قائمة الانتظار', waitlistCount)}
      ${tabBtn('all',       'الكل',          normal.length)}
    </div>`;

  if (!bookingsList.length) {
    wrap.innerHTML = `
      ${tabsHtml}
      <div class="empty-hint">
        <div style="font-size:36px;margin-bottom:12px">📬</div>
        <div style="font-weight:700;margin-bottom:6px">لا توجد طلبات حجز حالياً</div>
        <div style="font-size:12px;color:var(--text3)">عندما يحجز أحدهم مساحتك من الموقع ستجد الطلب هنا فوراً.</div>
      </div>`;
    return;
  }

  /* بطاقات قائمة الانتظار لها شكل وإجراءات مختلفة */
  if (activeFilter === 'waitlist') {
    wrap.innerHTML = tabsHtml + renderWaitlistCards(waitlist);
    return;
  }

  const rows = filtered.length
    ? filtered.map(b => {
        const st = statusMap[b.status] || { lbl: b.status, cls: 'badge-gray' };
        const isPending = b.status === 'pending' || b.status === 'viewing_pending';
        const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' }) : '—';
        const startStr = b.startDate || '—';
        return `
        <div class="bk-card">
          <div class="bk-card-head">
            <div>
              <div class="bk-card-space">${_escBk(b.spaceName)}</div>
              <div class="bk-card-loc">📍 ${_escBk(b.spaceLoc)} ${b.size !== '—' ? '· ' + _escBk(b.size) : ''}</div>
            </div>
            <span class="badge ${st.cls}">${st.lbl}</span>
          </div>
          <div class="bk-card-body">
            <div class="bk-info-grid">
              <span class="bk-lbl">👤 الحاجز</span><span class="bk-val">${_escBk(b.bookerName)}</span>
              <span class="bk-lbl">📞 الهاتف</span><span class="bk-val">${b.bookerPhone !== '—' ? `<a href="tel:${_escBk(b.bookerPhone)}" style="color:var(--accent)">${_escBk(b.bookerPhone)}</a>` : '—'}</span>
              <span class="bk-lbl">🏷️ النشاط</span><span class="bk-val">${_escBk(b.activity)}</span>
              <span class="bk-lbl">📅 التاريخ المطلوب</span><span class="bk-val">${_escBk(startStr)}</span>
              <span class="bk-lbl">⏱ المدة</span><span class="bk-val">${_escBk(b.duration)}</span>
              <span class="bk-lbl">💰 السعر</span><span class="bk-val">${_escBk(b.price)}</span>
              ${b.notes ? `<span class="bk-lbl">📝 ملاحظات</span><span class="bk-val">${_escBk(b.notes)}</span>` : ''}
              <span class="bk-lbl">🕐 استلمنا الطلب</span><span class="bk-val">${dateStr}</span>
            </div>
          </div>
          <div class="bk-card-actions">
            ${isPending ? `
              <button class="btn btn-primary btn-sm" onclick="acceptBooking('${b.id}')">✅ قبول</button>
              <button class="btn btn-sm" style="background:rgba(255,77,77,.15);color:var(--red);border-color:rgba(255,77,77,.3)" onclick="rejectBooking('${b.id}')">❌ رفض</button>
              <button class="btn btn-ghost btn-sm" onclick="convertBookingToContract('${b.id}')">📄 تحويل لعقد</button>` : ''}
            ${b.status === 'confirmed' ? `
              <button class="btn btn-ghost btn-sm" onclick="convertBookingToContract('${b.id}')">📄 إنشاء عقد</button>
              <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="rejectBooking('${b.id}')">🚫 إلغاء</button>` : ''}
            ${b.bookerPhone && b.bookerPhone !== '—' ? `
              <a href="https://wa.me/2${b.bookerPhone.replace(/\D/g,'')}" target="_blank" rel="noopener"
                 class="btn btn-ghost btn-sm" style="text-decoration:none">💬 واتساب</a>` : ''}
          </div>
        </div>`;
      }).join('')
    : `<div class="empty-hint" style="padding:24px">لا توجد طلبات بهذا الفلتر.</div>`;

  wrap.innerHTML = tabsHtml + `<div class="bk-cards">${rows}</div>`;
}

/* بطاقات قائمة الانتظار — تعرض رابط البروفايل وإجراءات خاصة */
function renderWaitlistCards(list) {
  if (!list.length) {
    return `<div class="empty-hint" style="padding:32px">
      <div style="font-size:32px;margin-bottom:8px">⏳</div>
      <div style="font-weight:700;margin-bottom:6px">لا أحد في قائمة الانتظار حالياً</div>
      <div style="font-size:12px;color:var(--text3)">عند امتلاء كل وحداتك، من يطلب الحجز يدخل هنا تلقائياً.</div>
    </div>`;
  }
  const cards = list.map(b => {
    const dateStr  = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const phoneOk  = b.bookerPhone && b.bookerPhone !== '—';
    const profileLink = b.profileLink
      ? `<span class="bk-lbl">📁 البروفايل</span><span class="bk-val"><a href="${_escBk(b.profileLink)}" target="_blank" rel="noopener" style="color:var(--orange);text-decoration:underline">فتح ملف النشاط ↗</a></span>`
      : `<span class="bk-lbl">📁 البروفايل</span><span class="bk-val" style="color:var(--text3)">لم يُرفق</span>`;
    return `
    <div class="bk-card" style="border-color:rgba(255,184,0,.30)">
      <div class="bk-card-head">
        <div>
          <div class="bk-card-space">${_escBk(b.spaceName)}</div>
          <div class="bk-card-loc">📍 ${_escBk(b.spaceLoc)} ${b.size !== '—' ? '· ' + _escBk(b.size) : ''}</div>
        </div>
        <span class="badge badge-yellow">⏳ قائمة انتظار</span>
      </div>
      <div class="bk-card-body">
        <div class="bk-info-grid">
          <span class="bk-lbl">👤 المهتم</span><span class="bk-val">${_escBk(b.bookerName)}</span>
          <span class="bk-lbl">📞 الهاتف</span><span class="bk-val">${phoneOk ? `<a href="tel:${_escBk(b.bookerPhone)}" style="color:var(--orange)">${_escBk(b.bookerPhone)}</a>` : '—'}</span>
          <span class="bk-lbl">🏷️ النشاط</span><span class="bk-val">${_escBk(b.activity)}</span>
          ${profileLink}
          ${b.notes ? `<span class="bk-lbl">📝 ملاحظات</span><span class="bk-val">${_escBk(b.notes)}</span>` : ''}
          <span class="bk-lbl">🕐 انضم بتاريخ</span><span class="bk-val">${dateStr}</span>
        </div>
      </div>
      <div class="bk-card-actions">
        <button class="btn btn-primary btn-sm" onclick="approveWaitlist('${b.id}')" title="تأكيد توفّر وحدة وقبول الطلب">✅ توفّرت وحدة — قبول</button>
        <button class="btn btn-ghost btn-sm" onclick="promoteWaitlist('${b.id}')" title="إنشاء عقد مباشرة">📄 تحويل لعقد</button>
        <button class="btn btn-sm" style="background:rgba(255,77,77,.15);color:var(--red);border-color:rgba(255,77,77,.3)" onclick="rejectWaitlist('${b.id}')">❌ إزالة</button>
        ${phoneOk ? `<a href="https://wa.me/2${b.bookerPhone.replace(/\D/g,'')}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none">💬 واتساب</a>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="bk-cards">${cards}</div>`;
}

/* مساعد escape لـ bookings */
function _escBk(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* تغيير فلتر الحجوزات */
function setBkFilter(val) {
  const wrap = document.getElementById('bookings-list');
  if (wrap) { wrap.dataset.filter = val; renderBookings(); }
}

/* قبول الحجز */
async function acceptBooking(bookingId) {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const btn = event?.currentTarget;
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.rpc('owner_update_booking_status', {
      p_booking_id: bookingId,
      p_status:     'confirmed',
    });
    if (error) throw error;
    /* تحديث محلي فوري */
    const bk = bookingsList.find(b => b.id === bookingId);
    if (bk) bk.status = 'confirmed';
    renderBookings();
    updateBookingsBadge();
  } catch (e) {
    alert('تعذّر قبول الحجز: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

/* رفض / إلغاء الحجز */
async function rejectBooking(bookingId) {
  if (!confirm('هل تريد رفض هذا الطلب؟')) return;
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  try {
    const { error } = await sb.rpc('owner_update_booking_status', {
      p_booking_id: bookingId,
      p_status:     'cancelled',
    });
    if (error) throw error;
    bookingsList = bookingsList.filter(b => b.id !== bookingId);
    renderBookings();
    updateBookingsBadge();
  } catch (e) {
    alert('تعذّر رفض الحجز: ' + e.message);
  }
}

/* ── قائمة الانتظار: قبول (توفّرت وحدة) ── */
async function approveWaitlist(bookingId) {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const btn = event?.currentTarget;
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.rpc('owner_promote_waitlist', { p_booking_id: bookingId });
    if (error) throw error;
    /* صار حجزاً مؤكداً عادياً */
    const bk = bookingsList.find(b => b.id === bookingId);
    if (bk) { bk.isWaitlist = false; bk.status = 'confirmed'; }
    renderBookings();
    updateBookingsBadge();
  } catch (e) {
    alert('تعذّر قبول الطلب: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

/* ── قائمة الانتظار: إزالة / إلغاء ── */
async function rejectWaitlist(bookingId) {
  if (!confirm('هل تريد إزالة هذا الطلب من قائمة الانتظار؟')) return;
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  try {
    const { error } = await sb.rpc('owner_update_booking_status', {
      p_booking_id: bookingId,
      p_status:     'cancelled',
    });
    if (error) throw error;
    bookingsList = bookingsList.filter(b => b.id !== bookingId);
    renderBookings();
    updateBookingsBadge();
  } catch (e) {
    alert('تعذّر إزالة الطلب: ' + e.message);
  }
}

/* ── قائمة الانتظار: تحويل مباشر لعقد ── */
async function promoteWaitlist(bookingId) {
  const sb = getSB();
  const bk = bookingsList.find(b => b.id === bookingId);
  if (!bk) return;
  /* أخرِجه من قائمة الانتظار أولاً (يصبح حجزاً مؤكداً) ثم افتح نموذج العقد */
  if (sb && currentOwner?.id) {
    try {
      await sb.rpc('owner_promote_waitlist', { p_booking_id: bookingId });
      bk.isWaitlist = false; bk.status = 'confirmed';
    } catch (e) {
      alert('تعذّر تحويل الطلب: ' + e.message);
      return;
    }
  }
  updateBookingsBadge();
  convertBookingToContract(bookingId);
}

/* تحويل الحجز لعقد — ينتقل لصفحة العقود مع ملء البيانات مسبقاً */
function convertBookingToContract(bookingId) {
  const bk = bookingsList.find(b => b.id === bookingId);
  if (!bk) return;

  /* انتقل لصفحة العقود أولاً */
  const contractsNav = document.querySelector('[onclick*="contracts"]');
  goTo('contracts', contractsNav);

  /* أعطِ الـ DOM ثانية لتحميل الصفحة ثم املأ البيانات */
  setTimeout(() => {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
    set('cf-tenant',   bk.bookerName !== '—' ? bk.bookerName : '');
    set('cf-phone',    bk.bookerPhone !== '—' ? bk.bookerPhone : '');
    set('cf-activity', bk.activity !== '—' ? bk.activity : '');
    set('cf-start',    bk.startDate || '');
    /* اختر الوحدة المطابقة لو وُجدت */
    populateContractSpaceSelect();
    if (bk.spaceId) {
      const spaceSelect = document.getElementById('cf-space');
      if (spaceSelect) {
        const matchingUnit = ownerSpaces.find(s => s.spaceId === bk.spaceId);
        if (matchingUnit) spaceSelect.value = matchingUnit.unitDbId || '';
      }
    }
    /* أضف ملاحظة تربطه بالحجز */
    const notesEl = document.getElementById('cf-notes');
    if (notesEl && !notesEl.value) {
      notesEl.value = `محوَّل من طلب حجز — ${bk.spaceName}`;
    }
  }, 300);
}

/* حذف الإشعارات المقروءة الأقدم من 30 يوم */
async function cleanupOldNotifications() {
  const sb = getSB();
  if (!sb) return;
  try {
    await sb.rpc('cleanup_old_notifications', { p_days: 30 });
  } catch { /* صامت — الدالة اختيارية */ }
}

/* ══════════════════════════════════════════
   📦  PENDING SPACES — Supabase
   ══════════════════════════════════════════ */
function loadPendingSpaces() { /* loaded from Supabase in loadOwnerData() */ }
function savePendingSpaces() { /* deprecated — stored in Supabase */ }

async function removePendingSpace(id) {
  if (!confirm('هل تريد إلغاء هذا الطلب؟')) return;
  const sb = getSB();
  if (sb && currentOwner?.id) {
    await sb.from('spaces').delete()
      .eq('id', id)
      .eq('owner_id', currentOwner.id)
      .eq('status', 'pending');
  }
  ownerPendingSpaces = ownerPendingSpaces.filter(p => p.id !== id);
  renderSpaces();
}

/* ══════════════════════════════════════════
   ✏️  تعديل وحدة مساحة معتمدة (UPDATE space_units)
   ══════════════════════════════════════════ */
function openUnitEdit(unitDbId) {
  const u = ownerSpaces.find(s => s.unitDbId === unitDbId);
  if (!u) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = (val ?? ''); };
  set('ue-id',     u.unitDbId);
  set('ue-code',   u.code && u.code !== '—' ? u.code : '');
  set('ue-name',   u.uname);
  set('ue-floor',  u.floor);
  set('ue-size',   u.size && u.size !== '—' ? u.size : '');
  set('ue-price',  u.basePrice ?? '');
  set('ue-status', u.baseStatus || 'available');
  set('ue-loc',    u.unitLoc);
  set('ue-notes',  u.unitNotes);
  setTxt('ue-title', `✏️ تعديل الوحدة ${u.code || ''}`);
  if (u.spaceName) setTxt('ue-sub', `داخل: ${u.spaceName} — تُحفظ مباشرة دون إعادة مراجعة`);
  const msg = document.getElementById('ue-msg'); if (msg) msg.style.display = 'none';
  const modal = document.getElementById('unit-edit-modal');
  if (modal) modal.style.display = 'flex';
}

function closeUnitEdit() {
  const modal = document.getElementById('unit-edit-modal');
  if (modal) modal.style.display = 'none';
}

async function submitUnitEdit() {
  const get = id => document.getElementById(id)?.value?.trim();
  const id   = get('ue-id');
  const code = get('ue-code');
  const msg  = document.getElementById('ue-msg');
  const showMsg = (type, text) => {
    if (!msg) return;
    msg.className = `alert-item ${type}`;
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">${type==='success'?'✅':'❌'}</span><div class="alert-text"><strong>${text}</strong></div>`;
  };
  if (!id)   { showMsg('danger', 'تعذّر تحديد الوحدة.'); return; }
  if (!code) { showMsg('danger', 'كود الوحدة مطلوب.'); return; }

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showMsg('danger', 'تعذّر الاتصال — أعد تحميل الصفحة.'); return; }

  const payload = {
    unit_id:  code,
    name:     get('ue-name') || null,
    floor:    get('ue-floor') || null,
    size:     get('ue-size') || null,
    price:    parseInt(get('ue-price')) || null,
    status:   get('ue-status') || 'available',
    location: get('ue-loc') || null,
    notes:    get('ue-notes') || null,
  };

  const btn = document.getElementById('ue-save-btn');
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.from('space_units').update(payload).eq('id', id);
    if (error) throw error;
    await loadOwnerData();          /* إعادة تحميل المساحات + إعادة الحساب */
    closeUnitEdit();
  } catch (err) {
    showMsg('danger', 'تعذّر حفظ التعديلات: ' + (err.message || 'خطأ'));
  } finally {
    if (btn) btn.disabled = false;
  }
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
  if (file.size > 20 * 1024 * 1024) {
    alert('الصورة أكبر من 20 ميجا — اختر صورة أصغر.');
    input.value = ''; return;
  }

  const preview = document.getElementById('as-unit-img-preview-' + idx);
  const zone    = document.getElementById('as-unit-img-zone-' + idx);

  /* معاينة فورية */
  const previewUrl = URL.createObjectURL(file);
  if (preview) {
    preview.innerHTML = `
      <div style="position:relative">
        <img src="${previewUrl}" style="width:100%;max-height:130px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border);opacity:0.6">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;background:rgba(0,0,0,0.45);border-radius:var(--r)">⏳ جاري الرفع…</div>
      </div>`;
    if (zone) zone.style.display = 'none';
  }

  try {
    const sb = getSB();
    const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = session?.access_token || SUPABASE_KEY;

    const ts   = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const r2Path = `owner-spaces/${currentOwner.id}/units/${ts}_${rand}.webp`;
    const url = await uploadSingleImageToR2(file, r2Path, token);
    asUnitImgUrls[idx] = url;

    if (preview) {
      preview.innerHTML = `
        <div style="position:relative">
          <img src="${url}" style="width:100%;max-height:130px;object-fit:cover;border-radius:var(--r);border:2px solid rgba(0,200,83,0.35)">
          <button type="button" onclick="clearUnitImage(${idx})"
                  style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:22px;text-align:center">✕</button>
        </div>`;
    }
  } catch (err) {
    delete asUnitImgUrls[idx];
    if (preview) preview.innerHTML = '';
    if (zone)    zone.style.display = 'block';
    alert('فشل رفع صورة الوحدة: ' + err.message);
  }
}

function clearUnitImage(idx) {
  const input   = document.getElementById('as-unit-img-' + idx);
  const preview = document.getElementById('as-unit-img-preview-' + idx);
  const zone    = document.getElementById('as-unit-img-zone-' + idx);
  if (input)  input.value = '';
  delete asUnitImgUrls[idx];
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
  if (file.size > 20 * 1024 * 1024) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">❌ أكبر من 20 ميجا</span>';
    input.value = ''; return;
  }

  /* معاينة فورية */
  const previewUrl = URL.createObjectURL(file);
  if (preview) {
    preview.innerHTML = `
      <div style="position:relative;margin-top:8px">
        <img src="${previewUrl}" style="width:100%;border-radius:var(--r);max-height:180px;object-fit:cover;border:2px solid rgba(255,107,0,0.30);opacity:0.7">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;background:rgba(0,0,0,0.45);border-radius:var(--r)">⏳ جاري الضغط والرفع…</div>
      </div>`;
  }
  if (statusEl)  statusEl.innerHTML   = '<span style="color:var(--orange)">⏳ جاري الرفع…</span>';
  if (uploadIco) uploadIco.textContent = '⏳';

  try {
    const sb = getSB();
    const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = session?.access_token || SUPABASE_KEY;

    const folder = `owner-spaces/${currentOwner.id}`;
    const [url] = await uploadImages([file], folder, null, token);
    asMainImgUrl = url;

    if (preview) {
      preview.innerHTML = `
        <div style="position:relative;margin-top:8px">
          <img src="${url.replace('_f.webp', '_d.webp')}" style="width:100%;border-radius:var(--r);max-height:180px;object-fit:cover;border:2px solid rgba(0,200,83,0.35)">
          <button type="button" onclick="clearMainSpaceImage()"
                  style="position:absolute;top:5px;left:5px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:24px;height:24px;cursor:pointer;font-size:12px;line-height:24px;text-align:center">✕</button>
        </div>`;
    }
    if (statusEl)  statusEl.innerHTML   = '<span style="color:var(--green)">✅ تم الرفع</span>';
    if (uploadIco) uploadIco.textContent = '✅';
  } catch (err) {
    asMainImgUrl = null;
    if (preview)   preview.innerHTML    = '';
    if (statusEl)  statusEl.innerHTML   = `<span style="color:var(--red)">❌ فشل الرفع</span>`;
    if (uploadIco) uploadIco.textContent = '📤';
  }
}

function clearMainSpaceImage() {
  asMainImgUrl = null;
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
  const maxExtra  = 5;
  const remaining = maxExtra - asExtraImgUrls.filter(Boolean).length;
  const files     = Array.from(input.files).slice(0, remaining);
  const container = document.getElementById('as-extra-imgs-container');
  if (!files.length || !container) return;

  const sb = getSB();
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  const token  = session?.access_token || SUPABASE_KEY;
  const folder = `owner-spaces/${currentOwner.id}`;

  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) continue;
    const idx = asExtraImgUrls.length;
    asExtraImgUrls.push(null);

    const previewUrl = URL.createObjectURL(file);
    const div = document.createElement('div');
    div.id = 'as-extra-img-' + idx;
    div.style.cssText = 'position:relative;width:calc(50% - 4px);flex-shrink:0';
    div.innerHTML = `
      <img src="${previewUrl}" style="width:100%;height:90px;object-fit:cover;border-radius:var(--r);border:1px solid var(--border);opacity:0.6">
      <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.4);border-radius:var(--r)">⏳</div>`;
    container.appendChild(div);

    try {
      const [url] = await uploadImages([file], folder, null, token);
      asExtraImgUrls[idx] = url;
      div.innerHTML = `
        <img src="${url.replace('_f.webp', '_c.webp')}" style="width:100%;height:90px;object-fit:cover;border-radius:var(--r);border:1px solid rgba(0,200,83,0.35)">
        <button type="button" onclick="removeExtraSpaceImage(${idx})"
                style="position:absolute;top:3px;left:3px;background:rgba(0,0,0,0.65);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:20px;text-align:center">✕</button>`;
    } catch {
      asExtraImgUrls[idx] = null;
      div.remove();
    }
  }
  input.value = '';
}

function removeExtraSpaceImage(idx) {
  asExtraImgUrls[idx] = null;
  const el = document.getElementById('as-extra-img-' + idx);
  if (el) el.remove();
}

function collectSubUnits() {
  const units = [];
  document.querySelectorAll('[id^="as-unit-row-"]').forEach(div => {
    const idx  = div.dataset.idx;
    const uid  = document.getElementById('as-unit-uid-' + idx)?.value.trim()  || '';
    const name = document.getElementById('as-unit-name-' + idx)?.value.trim() || '';
    if (!uid && !name) return;
    units.push({
      unitId:   uid || ('U' + (units.length + 1)),
      name:     name,
      floor:    document.getElementById('as-unit-floor-' + idx)?.value || '',
      size:     document.getElementById('as-unit-size-' + idx)?.value.trim() || '',
      price:    parseFloat(document.getElementById('as-unit-price-' + idx)?.value) || 0,
      status:   document.getElementById('as-unit-status-' + idx)?.value || 'available',
      location: document.getElementById('as-unit-loc-' + idx)?.value.trim() || '',
      notes:    document.getElementById('as-unit-notes-' + idx)?.value.trim() || '',
      imageUrl: asUnitImgUrls[idx] || null,
    });
  });
  return units;
}

/* ══════════════════════════════════════════
   ➕  ADD SPACE FORM
   🔗 DB-LINK: يرسل للـ Apps Script → يحفظ في الشيت
   ══════════════════════════════════════════ */
function populateSelects() {
  populateContractSpaceSelect();
}

/* قائمة وحدات المالك الحقيقية في نموذج العقد (مرتبطة بـ space_units) */
function populateContractSpaceSelect() {
  let el = document.getElementById('cf-space');
  if (!el) return;

  if (!ownerSpaces.length) {
    /* لا توجد وحدات معتمدة — اعرض حقل نصي للإدخال اليدوي */
    if (el.tagName === 'SELECT') {
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = 'cf-space'; inp.required = true;
      inp.placeholder = 'رمز الوحدة أو المساحة (يدوي — مساحتك قيد المراجعة)';
      el.parentNode.replaceChild(inp, el);
    }
    return;
  }

  /* توجد وحدات معتمدة — تأكد أن العنصر select */
  if (el.tagName !== 'SELECT') {
    const sel = document.createElement('select');
    sel.id = 'cf-space'; sel.required = true;
    el.parentNode.replaceChild(sel, el);
    el = sel;
  }

  const prev = el.value;
  const stLbl = { rented: '🔴 مؤجّرة', available: '🟢 متاحة', reserved: '🟡 محجوزة', maintenance: '🔧 صيانة' };
  el.innerHTML = '<option value="">اختر الوحدة</option>' +
    ownerSpaces.map(s => {
      const label = `${s.code}${s.loc && s.loc !== '—' ? ' — ' + s.loc : ''}${s.spaceName ? ' (' + s.spaceName + ')' : ''} · ${stLbl[s.status] || s.status}`;
      return `<option value="${s.unitDbId || ''}">${label}</option>`;
    }).join('');
  if (prev) el.value = prev;
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
    msg.className = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">❌</span><div class="alert-text"><strong>اسم المساحة ونوعها ومنطقتها مطلوبة.</strong></div>`;
    return;
  }

  const sb = getSB();
  if (!sb || !currentOwner?.id) {
    msg.className = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">❌</span><div class="alert-text"><strong>خطأ في الاتصال — أعد تحميل الصفحة.</strong></div>`;
    return;
  }

  /* 🔒 حد ٨ مساحات لباقة Growth */
  if (getPlan() === 'growth') {
    const { count, error: countErr } = await sb
      .from('spaces')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', currentOwner.id)
      .neq('status', 'rejected');

    if (!countErr && count >= 8) {
      msg.className = 'alert-item danger';
      msg.style.display = 'flex';
      msg.innerHTML = `<span class="alert-ico">🔒</span><div class="alert-text"><strong>وصلت إلى الحد الأقصى لباقة Growth (٨ مساحات).</strong><br>قم بالترقية إلى Pro للإضافة بلا حدود. <a href="/" style="color:var(--orange);font-weight:700">ترقية الآن ←</a></div>`;
      return;
    }
  }

  btn.disabled  = true;
  btn.innerHTML = '⏳ جاري الحفظ…';
  msg.style.display = 'none';

  const subUnits = collectSubUnits();

  try {
    const typeMap = {
      mall:   { badge:'متاح', badgeClass:'badge-avail', thumbClass:'thumb-mall' },
      club:   { badge:'متاح', badgeClass:'badge-info',  thumbClass:'thumb-club' },
      school: { badge:'متاح', badgeClass:'badge-warn',  thumbClass:'thumb-school' },
    };
    const tm = typeMap[spaceType] || typeMap.mall;

    const actsRaw = get('as-acts');
    const actsArr = actsRaw ? actsRaw.split('·').map(s => s.trim()).filter(Boolean) : [];
    const amenStr = getAmenitiesString();
    const amenArr = amenStr ? amenStr.split('·').map(s => s.trim()).filter(Boolean) : [];

    const spacePayload = {
      owner_id:     currentOwner.id,
      name:         spaceName,
      type:         spaceType,
      region:       spaceLoc,
      badge:        get('as-badge') || tm.badge,
      badge_class:  tm.badgeClass,
      icon_emoji:   get('as-icon') || '🏬',
      thumb_color:  tm.thumbClass,
      sizes_prices: getSizesString(),
      min_price:    parseInt(get('as-default-price')) || 0,
      all_acts:     document.getElementById('as-all-acts')?.checked || false,
      activities:   actsArr,
      season:       get('as-season') || null,
      insight:      get('as-insight') || null,
      description:  get('as-desc') || null,
      amenities:    amenArr,
      sort_order:   parseInt(get('as-order')) || 99,
      status:       'pending',
      is_active:    false,
      image_url:    asMainImgUrl || null,
      extra_images: asExtraImgUrls.filter(Boolean),
    };

    const { data: newSpace, error: spaceErr } = await sb
      .from('spaces')
      .insert(spacePayload)
      .select('id')
      .single();

    if (spaceErr) throw spaceErr;

    /* إضافة الوحدات الفرعية */
    if (subUnits.length > 0 && newSpace?.id) {
      const unitsPayload = subUnits.map((u, i) => ({
        space_id:  newSpace.id,
        unit_id:   u.unitId,
        name:      u.name || null,
        floor:     u.floor || null,
        size:      u.size || null,
        price:     u.price ? Math.round(u.price) : null,
        status:    u.status || 'available',
        location:  u.location || null,
        notes:     u.notes || null,
        image_url: u.imageUrl || null,
      }));
      const { error: unitsErr } = await sb.from('space_units').insert(unitsPayload);
      if (unitsErr) console.warn('[Makani] space_units insert:', unitsErr.message);
    }

    /* إشعار لصاحب المساحة */
    try {
      await sb.from('notifications').insert({
        owner_id: currentOwner.id,
        type:     'space_submitted',
        title:    'طلب إضافة مساحة جديدة',
        body:     `تم إرسال طلب إضافة المساحة "${spaceName}" — في انتظار المراجعة.`,
      });
    } catch { /* notifications table optional */ }

    /* تحديث الحالة المحلية */
    ownerPendingSpaces.push({
      id:          newSpace.id,
      name:        spaceName,
      type:        spaceType,
      loc:         spaceLoc,
      sizes:       getSizesString(),
      price:       parseInt(get('as-default-price')) || 0,
      subCount:    subUnits.length,
      status:      'pending',
      submittedAt: new Date().toISOString(),
    });
    renderSpaces();

    msg.className     = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">✅</span>
      <div class="alert-text">
        <strong>تم إرسال طلب إضافة المساحة بنجاح!</strong><br>
        المساحة في قائمة الانتظار — فريق مكاني Spot سيراجعها خلال 24 ساعة.<br>
        <div style="margin-top:6px;font-size:11px;color:var(--text3)">للمتابعة: واتساب 01103467711</div>
      </div>`;

    /* إعادة ضبط النموذج */
    document.getElementById('add-space-form')?.reset();
    clearMainSpaceImage();
    asExtraImgUrls = []; asUnitImgUrls = {};
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

  } catch (err) {
    msg.className     = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">❌</span>
      <div class="alert-text"><strong>تعذّر حفظ المساحة</strong><br>${err.message || 'تأكد من الاتصال وأعد المحاولة.'}</div>`;
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
   ⭐  RATINGS — متصل بـ Supabase (المالك → المستأجر)
   نظام أحادي الاتجاه: صاحب المساحة يقيّم المستأجرين الذين
   حجزوا فعلياً عبر المنصة. لا تقييم بدون حجز حقيقي.
   ══════════════════════════════════════════ */
const AR_NUMS = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩','١٠'];

function _escR(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RATE_CRITERIA = [
  { key: 'commitment',  label: '⏰ الالتزام بالمواعيد' },
  { key: 'cleanliness', label: '🧹 نظافة المكان' },
  { key: 'dealing',     label: '🤝 حسن التعامل' },
  { key: 'payment',     label: '💳 الالتزام المالي' },
  { key: 'rules',       label: '📋 احترام الشروط' },
];

let sbRateableTenants = [];   /* من owner_list_rateable_tenants() */
let sbOwnerRatings    = [];    /* من user_ratings حيث rater_id = المالك الحالي */
let rateVals          = { commitment: 0, cleanliness: 0, dealing: 0, payment: 0, rules: 0 };

/* بناء نجوم تفاعلية (١-٥) لكل معيار */
function renderRateStars() {
  const wrap = document.getElementById('rate-criteria');
  if (!wrap) return;
  wrap.innerHTML = RATE_CRITERIA.map(c => {
    const v = rateVals[c.key] || 0;
    const stars = [1, 2, 3, 4, 5].map(i =>
      `<button type="button" class="si-star${i <= v ? ' on' : ''}" onclick="setRateStar('${c.key}',${i})">★</button>`
    ).join('');
    return `
      <div class="rate-crit">
        <div class="rate-crit-head">
          <span class="rate-crit-label">${c.label}</span>
          <span class="rate-crit-val">${v ? AR_NUMS[v] : '—'}</span>
        </div>
        <div class="star-input">${stars}</div>
      </div>`;
  }).join('');
}

function setRateStar(key, val) {
  rateVals[key] = val;
  renderRateStars();
  updateAvgRating();
}

function _rateValsArray() {
  return RATE_CRITERIA.map(c => rateVals[c.key]).filter(v => v > 0);
}

function updateAvgRating() {
  const set = _rateValsArray();
  const avg = set.length ? set.reduce((a, b) => a + b, 0) / set.length : 0;
  setTxt('rate-avg', avg ? avg.toFixed(1) : '٠.٠');
}

/* القديمة — لم تعد مستخدمة (نتركها للتوافق مع أي استدعاء قديم) */
function updateRVal() { updateAvgRating(); }

/* الشهر الحالي بصيغة YYYY-MM */
function _currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* تحميل تقييمات المالك (owner_tenant_ratings) + تعبئة الفورم والسجل */
async function loadOwnerRatings() {
  await loadRatingsRemote();
  const monthEl = document.getElementById('rate-month');
  if (monthEl && !monthEl.value) monthEl.value = _currentMonth();
  populateRateTenantSelect();
  renderRateStars();
  renderRatingsHistory();
}

/* قائمة المستأجرين = العقود الفعّالة (مصدر موحّد مع باقي اللوحة) */
function populateRateTenantSelect() {
  const sel = document.getElementById('rate-tenant');
  if (!sel) return;
  const prev   = sel.value;
  const active = contractsList.filter(c => c.status !== 'expired');
  if (!active.length) {
    sel.innerHTML = '<option value="">لا توجد عقود — أضف عقداً أولاً من صفحة العقود</option>';
    return;
  }
  sel.innerHTML = '<option value="">اختر المستأجر</option>' +
    active.map(c => `<option value="${c.id}">${_escR(c.tenantName)} — ${_escR(c.spaceCode || 'مساحة')}</option>`).join('');
  if (prev) sel.value = prev;
}

/* عند اختيار مستأجر/شهر: اعرض السياق + عبّئ تقييماً سابقاً إن وُجد (تعديل) */
function onRateTenantChange() {
  const sel        = document.getElementById('rate-tenant');
  const contractId = sel?.value;
  const ctxEl      = document.getElementById('rate-context');
  const month      = document.getElementById('rate-month')?.value || _currentMonth();
  const c          = contractsList.find(x => x.id === contractId);

  if (ctxEl) {
    ctxEl.textContent = c
      ? `🏬 ${c.spaceCode || 'مساحة'}${c.activity ? ' · ' + c.activity : ''}`
      : '';
  }

  const prev = ratingsList.find(r => r.contractId === contractId && r.month === month);
  rateVals = {
    commitment:  prev?.commitment  || 0,
    cleanliness: prev?.cleanliness || 0,
    dealing:     prev?.dealing     || 0,
    payment:     prev?.payment     || 0,
    rules:       prev?.rules       || 0,
  };
  const notesEl = document.getElementById('rate-notes');
  if (notesEl) notesEl.value = prev?.comment || '';
  renderRateStars();
  updateAvgRating();
}

async function submitRating() {
  const sel        = document.getElementById('rate-tenant');
  const contractId = sel?.value;
  const msgEl      = document.getElementById('rate-msg');
  const btn        = document.getElementById('btn-submit-rating');
  const month      = document.getElementById('rate-month')?.value || _currentMonth();

  const showMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = `alert-item ${type}`;
    msgEl.style.display = 'flex';
    const ico = type === 'success' ? '✅' : '❌';
    msgEl.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${_escR(text)}</strong></div>`;
    if (type === 'success') setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
  };

  if (!contractId) { showMsg('danger', 'اختر المستأجر أولاً.'); return; }

  const set = _rateValsArray();
  if (!set.length) { showMsg('danger', 'قيّم معياراً واحداً على الأقل بالنجوم.'); return; }

  /* المتوسط على مقياس ١٠ = متوسط النجوم (١-٥) × ٢ */
  const avg10 = parseFloat((set.reduce((a, b) => a + b, 0) / set.length * 2).toFixed(1));
  const notes = document.getElementById('rate-notes')?.value.trim() || '';
  const nn    = v => (v && v > 0 ? v : null);

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showMsg('danger', 'تعذّر الاتصال بالخادم.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…'; }
  try {
    const payload = {
      owner_id:    currentOwner.id,
      contract_id: contractId,
      month,
      commitment:  nn(rateVals.commitment),
      cleanliness: nn(rateVals.cleanliness),
      dealing:     nn(rateVals.dealing),
      payment:     nn(rateVals.payment),
      rules:       nn(rateVals.rules),
      avg_score:   avg10,
      comment:     notes || null,
    };
    const { error } = await sb.from('owner_tenant_ratings')
      .upsert(payload, { onConflict: 'contract_id,month' });
    if (error) throw error;

    showMsg('success', `تم حفظ التقييم! المتوسط: ${avg10}/10 ⭐`);
    await loadRatingsRemote();
    syncDataFromContracts();
    renderAll();

    if (sel) sel.value = '';
    rateVals = { commitment: 0, cleanliness: 0, dealing: 0, payment: 0, rules: 0 };
    const ctxEl = document.getElementById('rate-context'); if (ctxEl) ctxEl.textContent = '';
    const notesEl = document.getElementById('rate-notes'); if (notesEl) notesEl.value = '';
    renderRateStars();
    updateAvgRating();
  } catch (e) {
    showMsg('danger', 'تعذّر حفظ التقييم: ' + (e?.message || 'خطأ غير معروف'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⭐ حفظ التقييم'; }
  }
}

/* حذف تقييم */
async function deleteRating(id) {
  if (!confirm('هل تريد حذف هذا التقييم؟')) return;
  const sb = getSB();
  if (sb && currentOwner?.id) {
    const { error } = await sb.from('owner_tenant_ratings').delete().eq('id', id).eq('owner_id', currentOwner.id);
    if (error) { alert('تعذّر الحذف: ' + error.message); return; }
  }
  ratingsList = ratingsList.filter(r => r.id !== id);
  syncDataFromContracts();
  renderAll();
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
   🔔  تفضيلات التنبيهات — owner_settings
   ══════════════════════════════════════════ */
function applyNotifPrefsToUI() {
  if (!ownerSettings) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set('st-notif-expiry',    ownerSettings.notify_contract_expiry);
  set('st-notif-rating',    ownerSettings.notify_low_rating);
  set('st-notif-abandoned', ownerSettings.notify_abandoned_space);
  set('st-notif-report',    ownerSettings.extra && ownerSettings.extra.monthly_report);
}

async function saveNotifPrefs() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const get = id => document.getElementById(id)?.checked || false;
  const payload = {
    owner_id:               currentOwner.id,
    notify_contract_expiry: get('st-notif-expiry'),
    notify_low_rating:      get('st-notif-rating'),
    notify_abandoned_space: get('st-notif-abandoned'),
    extra:                  { monthly_report: get('st-notif-report') },
  };
  ownerSettings = { ...(ownerSettings || {}), ...payload };
  const { error } = await sb.from('owner_settings').upsert(payload, { onConflict: 'owner_id' });
  if (error) console.warn('[Makani] notif prefs save:', error.message);
  const hint = document.getElementById('notif-prefs-hint');
  if (hint) { hint.textContent = '✅ تم الحفظ'; setTimeout(() => { hint.textContent = ''; }, 2000); }
}

/* ══════════════════════════════════════════
   🗑️  آلية التفريغ — حذف بيانات المالك التشغيلية
   ══════════════════════════════════════════ */
async function clearMyData() {
  if (!confirm('⚠️ سيتم حذف جميع العقود والمدفوعات والمخالفات والتقييمات نهائياً.\nالمساحات وبياناتك الشخصية لن تتأثر.\n\nهل أنت متأكد؟')) return;
  const sb = getSB();
  if (!sb || !currentOwner?.id) { alert('تعذّر الاتصال — أعد تحميل الصفحة.'); return; }
  const btn = document.getElementById('btn-clear-data');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التفريغ…'; }
  const { data, error } = await sb.rpc('clear_owner_data');
  if (btn) { btn.disabled = false; btn.textContent = '🗑️ تفريغ بياناتي'; }
  if (error) { alert('تعذّر التفريغ: ' + error.message); return; }
  await loadOwnerData();
  loadOwnerRatings();
  const d = data || {};
  alert(`تم التفريغ بنجاح ✅\nعقود: ${d.contracts||0} · مدفوعات: ${d.payments||0} · مخالفات: ${d.violations||0} · تقييمات: ${d.ratings||0}`);
}

/* ══════════════════════════════════════════
   🔔  NOTIFICATIONS — جلب من Supabase + badge
   ══════════════════════════════════════════ */

/* تنبيهات من Supabase (من جدول notifications لو موجود) */
let supabaseNotifications = [];
let bzImageDataUrl = null; /* بيانات صورة البازار (base64 مضغوطة) */

/* ── state لصفحة إضافة المساحة ── */
let asMainImgUrl     = null;  /* R2 URL للصورة الرئيسية بعد الرفع */
let asExtraImgUrls   = [];    /* [r2Url] — R2 URLs للصور الإضافية */
let asUnitImgUrls    = {};    /* { idx: r2Url } — R2 URLs لصور الوحدات الفرعية */
let asSizeRowCount   = 0;     /* عداد صفوف الأحجام */
let asUnitCounter    = 0;     /* عداد الوحدات الفرعية */
let ownerPendingSpaces = [];  /* مساحات معلقة — تُجلب من Supabase */

/* ملاحظة: paymentsList / violationsList معرّفة أعلى الملف وتُحمَّل من Supabase. */

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

/* ── Supabase Realtime — تنبيهات + حجوزات فورية ── */
let _notifChannel   = null;
let _bookingChannel = null;
let _notifInterval  = null;

function subscribeNotificationsRealtime() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;

  /* ── قناة التنبيهات ── */
  if (!_notifChannel) {
    _notifChannel = sb.channel('notif-live-' + currentOwner.id.slice(0, 8))
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `owner_id=eq.${currentOwner.id}`,
      }, payload => {
        if (!payload.new) return;
        supabaseNotifications.unshift(payload.new);
        updateNotifBadge();
        renderAlerts();
        if (['space_approved', 'space_rejected'].includes(payload.new.type)) {
          loadOwnerData();
        }
        /* حجز جديد أو طلب قائمة انتظار → أعد تحميل صندوق الحجوزات */
        if (payload.new.type === 'booking_request' || payload.new.type === 'waitlist_request') {
          loadBookingsRemote().then(renderBookings);
        }
      })
      .subscribe();
  }

  /* ── قناة الحجوزات (INSERT مباشر) ── */
  if (!_bookingChannel) {
    _bookingChannel = sb.channel('bookings-live-' + currentOwner.id.slice(0, 8))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'bookings',
        filter: `owner_id=eq.${currentOwner.id}`,
      }, () => {
        /* أي تغيير على حجوزات هذا المالك → أعد التحميل */
        loadBookingsRemote().then(renderBookings);
      })
      .subscribe();
  }

  /* Fallback: استعلام دوري كل دقيقتين لو انقطع الـ Realtime — guard يمنع تراكم الـ intervals */
  if (!_notifInterval) {
    _notifInterval = setInterval(() => { if (!document.hidden) loadNotifications(); }, 120000);
  }
}

/* ── تعليم التنبيهات كمقروءة ── */
async function markNotificationsRead() {
  const sb = getSB();
  if (!sb || !currentOwner?.id || !supabaseNotifications.length) return;
  const ids = supabaseNotifications.map(n => n.id).filter(Boolean);
  if (!ids.length) return;
  try {
    await sb.from('notifications')
      .update({ is_read: true })
      .in('id', ids)
      .eq('owner_id', currentOwner.id);
    supabaseNotifications = [];
    updateNotifBadge();
  } catch { /* silent */ }
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
  return _buildLocalAlerts().length;
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

  /* ❌ حساب موقوف من الأدمن */
  if (profile.is_suspended) {
    sessionStorage.removeItem('ms_owner');
    showOwnerAccessGate(
      'danger',
      'تم إيقاف هذا الحساب مؤقتاً',
      'حسابك موقوف حالياً من قِبل إدارة مكاني Spot. تواصل معنا على واتساب 01103467711 للاستفسار.'
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
    planTier: (profile.plan_tier || profile.planTier || 'starter').toLowerCase().trim() || 'starter',
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
