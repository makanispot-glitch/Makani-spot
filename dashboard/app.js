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
let currentOwner      = null;
let ownerSpaces       = [];
let ownerSpacesFull   = [];   /* سجلات spaces الكاملة (active + paused) */
let ownerSpacesPaused = [];   /* المساحات الموقوفة مؤقتاً */
let ownerTenants      = [];
let ownerContracts = [];
let ownerAuthChecked = false;

/* wrapper آمن لـ sessionStorage — يمنع SecurityError في WebViews / وضع خاص */
const _ss = {
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
  rm(k)     { try { sessionStorage.removeItem(k); } catch {} },
};

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
let bookingsHasMore   = false;
let _bookingsOffset   = 0;
const BOOKINGS_BATCH  = 50;
let ownerSettings     = null;
let editingContractId = null;

/* ── حالة التحويل بوكينج → عقد ── */
let _pendingContractFromBooking = null;   /* الحجز المراد تحويله لعقد (يُملأ من convertBookingToContract) */
const _confirmingReject = new Set();     /* IDs الحجوزات التي ضُغط عليها "رفض" وتنتظر تأكيداً */

/* ── آخر دفعة مسجَّلة (لطباعة الإيصال فور الحفظ) ── */
let _lastSavedPaymentId = null;

/* ── حالة تجديد العقد ── */
let _renewingContractId = null;  /* العقد الذي يجري تجديده (null = وضع عادي) */

/* ── Space Edit (تعديل المساحة) ── */
let _editingSpaceId   = null;
let _esMainImgUrl     = null;    /* null = لم يتغيّر, '' = حُذفت, 'url' = جديدة */
let _esExtraImgUrls   = [];      /* مصفوفة [url|null] — null = حُذفت */
let _seDelMain        = false;   /* علامة: طُلب حذف الصورة الرئيسية */

/* ── أسباب رفض الحجز ── */
const REJECT_REASONS = [
  { code: 'no_answer',    label: 'المستأجر لم يرد على الاتصالات' },
  { code: 'wrong_phone',  label: 'رقم الهاتف غير صحيح أو تعذّر التواصل' },
  { code: 'no_show',      label: 'تحديد موعد ولم يلتزم بالحضور' },
  { code: 'no_agreement', label: 'لم يتم الاتفاق على الشروط' },
  { code: 'client_cancel',label: 'العميل ألغى بنفسه' },
  { code: 'other',        label: 'سبب آخر' },
];

/* ── mappers: صف قاعدة البيانات → شكل الذاكرة (يحافظ على شكل العروض القديم) ── */
function mapContractRow(r) {
  return enrichContract({
    id:              r.id,
    tenantName:      r.tenant_name,
    tenantPhone:     r.tenant_phone || '',
    tenantUserId:    r.tenant_user_id || null,
    livePhone:       '',
    liveEntityName:  '',
    spaceCode:       r.space_code || '',
    unitId:          r.unit_id  || null,
    spaceId:         r.space_id || null,
    activity:        r.activity || '',
    rent:            r.rent || 0,
    startDate:       r.start_date || '',
    endDate:         r.end_date || '',
    notes:           r.notes || '',
    endedEarly:      !!r.ended_early,
    endedAt:         r.ended_at || null,
    createdAt:       r.created_at || '',
    depositAmount:   parseFloat(r.deposit_amount) || 0,
    depositDate:     r.deposit_date || '',
    depositStatus:   r.deposit_status || 'held',
    depositDeducted: parseFloat(r.deposit_deducted) || 0,
    depositNotes:    r.deposit_notes || '',
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

  /* جلب البيانات الحية من profiles للعقود المرتبطة بحسابات */
  const linkedIds = [...new Set(contractsList.map(c => c.tenantUserId).filter(Boolean))];
  if (linkedIds.length) {
    const { data: profiles } = await sb.from('profiles')
      .select('id, phone, entity_name')
      .in('id', linkedIds);
    if (profiles?.length) {
      const profMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      contractsList = contractsList.map(c => {
        if (!c.tenantUserId || !profMap[c.tenantUserId]) return c;
        const p = profMap[c.tenantUserId];
        return { ...c, livePhone: p.phone || '', liveEntityName: p.entity_name || '' };
      });
    }
  }
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

/* الحقول الغنية لبروفايل الحاجز التي يراها صاحب المساحة (هوية البراند/المشروع) */
const BOOKER_PROFILE_FIELDS =
  'id, full_name, phone, email, avatar_url, entity_name, entity_type, city, bio, is_verified, created_at, role';

/* الحالات التي تُحمّل في صندوق الحجوزات (الطلبات النشطة + قوائم الانتظار) */
const BOOKING_LOAD_STATUSES = ['pending', 'confirmed', 'viewing_pending'];

/* يجلب بروفايلات الحاجزين دفعة واحدة عبر user_id.
   ملاحظة: سياسة RLS «profiles_public_read_basic» تسمح بقراءة البروفايلات العامة،
   لذا لا نعتمد على PostgREST embed (الذي يفشل لأن FK يشير إلى auth.users لا profiles). */
async function _fetchBookerProfiles(rows) {
  const sb = getSB();
  const ids = [...new Set((rows || []).map(r => r.user_id).filter(Boolean))];
  if (!sb || !ids.length) return {};
  try {
    const { data } = await sb.from('profiles').select(BOOKER_PROFILE_FIELDS).in('id', ids);
    const map = {};
    (data || []).forEach(p => { map[p.id] = p; });
    return map;
  } catch (e) {
    console.warn('[Makani] booker profiles load:', e.message);
    return {};
  }
}

/* يحوّل صف booking من Supabase إلى شكل الذاكرة + بيانات بروفايل الحاجز (#12) */
function _mapBookingRow(b, profilesMap) {
  const rawPrice = b.price;
  let priceDisplay, priceNum = null;
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') {
    priceDisplay = '—';
  } else {
    const num = Number(rawPrice);
    if (!isNaN(num) && String(rawPrice).replace(/[^\d.]/g, '') !== '') {
      priceDisplay = num.toLocaleString('ar-EG') + ' ج';
      priceNum = num;
    } else {
      priceDisplay = String(rawPrice);
    }
  }
  const prof  = (profilesMap && b.user_id && profilesMap[b.user_id]) || {};
  const brand = prof.entity_name || prof.full_name || '';
  return {
    id:          b.id,
    userId:      b.user_id,
    spaceId:     b.space_id,
    spaceName:   b.space_name   || '—',
    spaceLoc:    b.space_loc    || '—',
    price:       priceDisplay,
    priceRaw:    priceNum,
    activity:    b.activity     || '—',
    size:        b.size         || '—',
    duration:    b.duration     || '—',
    startDate:   b.start_date   || '',
    notes:       b.notes        || '',
    status:      b.status       || 'pending',
    createdAt:   b.created_at   || '',
    isWaitlist:  !!b.is_waitlist,
    profileLink: b.profile_link || '',
    /* ── هوية الحاجز (البراند/المشروع) ── */
    bookerName:       brand || '—',
    bookerPhone:      prof.phone || '—',
    bookerEmail:      prof.email || '—',
    bookerAvatar:     prof.avatar_url || '',
    bookerEntityType: prof.entity_type || '',
    bookerCity:       prof.city || '',
    bookerBio:        prof.bio || '',
    bookerVerified:   !!prof.is_verified,
    bookerCreatedAt:  prof.created_at || '',
    hasProfile:       !!(b.user_id && prof.id),
  };
}

async function loadBookingsRemote() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { bookingsList = []; return; }
  try {
    /* نجلب الحجوزات النشطة — 50 في المرة الأولى (#11) */
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .eq('owner_id', currentOwner.id)
      .in('status', BOOKING_LOAD_STATUSES)
      .order('created_at', { ascending: false })
      .range(0, BOOKINGS_BATCH - 1);
    if (error) throw error;
    /* بروفايلات الحاجزين دفعة واحدة (استعلام منفصل أكثر موثوقية من الـ embed) */
    const profilesMap = await _fetchBookerProfiles(data);
    _bookingsOffset = 0;
    bookingsHasMore = (data || []).length === BOOKINGS_BATCH;
    bookingsList = (data || []).map(b => _mapBookingRow(b, profilesMap));
    updateBookingsBadge();
    loadSpaceInterest();   /* تحليلات المهتمين لكل مساحة (غير حاجب) */
  } catch (e) {
    console.warn('[Makani] bookings load:', e.message);
    bookingsList = [];
  }
}

/* تحميل الدفعة التالية من الحجوزات (#11) */
async function loadMoreBookings() {
  const sb = getSB();
  if (!sb || !currentOwner?.id || !bookingsHasMore) return;
  const btn = document.getElementById('bk-load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري التحميل…'; }

  const nextOffset = _bookingsOffset + BOOKINGS_BATCH;
  try {
    const { data, error } = await sb
      .from('bookings')
      .select('*')
      .eq('owner_id', currentOwner.id)
      .in('status', BOOKING_LOAD_STATUSES)
      .order('created_at', { ascending: false })
      .range(nextOffset, nextOffset + BOOKINGS_BATCH - 1);
    if (error) throw error;
    const profilesMap = await _fetchBookerProfiles(data);
    _bookingsOffset = nextOffset;
    bookingsHasMore = (data || []).length === BOOKINGS_BATCH;
    bookingsList = [...bookingsList, ...(data || []).map(b => _mapBookingRow(b, profilesMap))];
    updateBookingsBadge();
    renderBookings();
  } catch (e) {
    console.warn('[Makani] load more bookings:', e.message);
    if (btn) { btn.disabled = false; btn.textContent = `⬇ تحميل ${BOOKINGS_BATCH} طلب إضافي`; }
  }
}

/* ── تحليلات المهتمين لكل مساحة (RPC owner_space_interest) ── */
let spaceInterestList = [];
async function loadSpaceInterest() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) { spaceInterestList = []; return; }
  try {
    const { data, error } = await sb.rpc('owner_space_interest');
    if (error) throw error;
    spaceInterestList = data || [];
    /* لو قسم الحجوزات معروض، أعد رسمه ليظهر شريط المهتمين المحدّث */
    const wrap = document.getElementById('bookings-list');
    if (wrap && document.getElementById('view-bookings')?.classList.contains('active')) {
      renderBookings();
    }
  } catch (e) {
    console.warn('[Makani] space interest load:', e.message);
    spaceInterestList = [];
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
  if (_guardWrite('إنشاء عقد')) return;
  const get = id => document.getElementById(id)?.value?.trim();
  const tenantName  = get('cf-tenant');
  const unitVal     = get('cf-space');     /* uuid للوحدة أو نص حر */
  const activity    = get('cf-activity');
  const rent        = parseFloat(get('cf-rent')) || 0;
  const startDate   = get('cf-start');
  const endDate     = get('cf-end');
  const notes       = get('cf-notes');
  const tenantPhone = get('cf-phone') || '';
  const tenantEmail = get('cf-email') || '';

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

  const depositAmount = parseFloat(document.getElementById('cf-deposit')?.value) || 0;
  const depositDate   = document.getElementById('cf-deposit-date')?.value || null;

  const basePayload = {
    owner_id:       currentOwner.id,
    space_id:       spaceId,
    unit_id:        unitId,
    space_code:     spaceCode || null,
    tenant_name:    tenantName,
    tenant_phone:   tenantPhone || null,
    activity:       activity || null,
    rent:           rent || null,
    start_date:     startDate || null,
    end_date:       endDate || null,
    /* يُضاف الإيميل إلى الملاحظات — لا يحتاج عموداً جديداً في الجدول */
    notes:          [notes, tenantEmail ? `📧 ${tenantEmail}` : ''].filter(Boolean).join('\n') || null,
    deposit_amount: depositAmount || null,
    deposit_date:   depositDate   || null,
  };

  const btn = document.getElementById('contract-submit-btn');
  if (btn) btn.disabled = true;
  const wasEditing = !!editingContractId;
  try {
    if (editingContractId) {
      /* عند التعديل: لا نُغيّر tenant_user_id حتى لا نكسر الربط الموجود */
      const { error } = await sb.from('owner_contracts').update(basePayload)
        .eq('id', editingContractId).eq('owner_id', currentOwner.id);
      if (error) throw error;
    } else {
      /* عند الإنشاء: نربط بحساب المستأجر إذا جاء من حجز */
      const payload = { ...basePayload, tenant_user_id: _pendingContractFromBooking?.userId || null };
      const { error } = await sb.from('owner_contracts').insert(payload);
      if (error) throw error;
    }
    await loadContractsRemote();
    syncDataFromContracts();
    renderAll();
    syncUnitStatusToSupabase(); /* مزامنة حالة الوحدة (non-blocking) */
    document.getElementById('contract-form')?.reset();
    _clearContractFromBookingBanner();
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
  set('cf-tenant',       c.tenantName);
  populateContractSpaceSelect();          /* تأكد من امتلاء القائمة قبل الاختيار */
  set('cf-space',        c.unitId || '');
  set('cf-phone',        c.tenantPhone);
  set('cf-activity',     c.activity);
  set('cf-rent',         c.rent);
  set('cf-start',        c.startDate);
  set('cf-end',          c.endDate);
  set('cf-notes',        c.notes);
  set('cf-deposit',      c.depositAmount || '');
  set('cf-deposit-date', c.depositDate   || '');
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
  _renewingContractId = null;
  const titleEl = document.getElementById('contract-form-title');
  if (titleEl) titleEl.textContent = '➕ إضافة عقد جديد';
  const submitBtn = document.getElementById('contract-submit-btn');
  if (submitBtn) submitBtn.textContent = '💾 حفظ العقد';
  const cancelBtn = document.getElementById('contract-cancel-btn');
  if (cancelBtn) cancelBtn.style.display = 'none';
  const renewBanner = document.getElementById('contract-renewal-banner');
  if (renewBanner) renewBanner.style.display = 'none';
}

/* ── تجديد عقد قائم (يحدّث نفس السجل بتاريخ نهاية جديد) ── */
function renewContract(contractId) {
  const c = contractsList.find(x => x.id === contractId);
  if (!c) return;

  _renewingContractId = contractId;
  startEditContract(contractId);   /* يملأ الحقول ويضبط editingContractId */

  /* اقتراح تاريخ انتهاء جديد: نفس مدة العقد الأصلية بعد تاريخ الانتهاء الحالي */
  const origEnd = c.endDate ? new Date(c.endDate) : new Date();
  const origStart = c.startDate ? new Date(c.startDate) : origEnd;
  const durationMs = Math.max(0, origEnd - origStart);
  const newEnd = new Date(origEnd.getTime() + durationMs);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setEl('cf-end', newEnd.toISOString().slice(0, 10));

  /* تحديث عنوان النموذج وزر الحفظ */
  const titleEl = document.getElementById('contract-form-title');
  if (titleEl) titleEl.textContent = '🔄 تجديد العقد — ' + c.tenantName;
  const submitBtn = document.getElementById('contract-submit-btn');
  if (submitBtn) submitBtn.textContent = '🔄 تجديد العقد';

  /* بانر التجديد */
  const renewBanner = document.getElementById('contract-renewal-banner');
  if (renewBanner) {
    renewBanner.style.display = 'flex';
    const nameEl = renewBanner.querySelector('.crb-name');
    const dateEl = renewBanner.querySelector('.crb-date');
    if (nameEl) nameEl.textContent = c.tenantName;
    if (dateEl) dateEl.textContent = formatDate(newEnd.toISOString().slice(0, 10));
  }

  document.getElementById('contract-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
   🔒  DEPOSIT — نظام التأمين
   ══════════════════════════════════════════ */

const _depositSettlingId = new Set(); /* IDs العقود المفتوح فيها نموذج التسوية */

function openDepositSettlement(contractId) {
  _depositSettlingId.add(contractId);
  renderContracts();
  /* تمرير للبطاقة */
  const el = document.getElementById('ccard-' + contractId);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function closeDepositSettlement(contractId) {
  _depositSettlingId.delete(contractId);
  renderContracts();
}

async function submitDepositSettlement(contractId) {
  const c = contractsList.find(x => x.id === contractId);
  if (!c) return;

  const type    = document.querySelector(`input[name="dep-type-${contractId}"]:checked`)?.value;
  const deducted = parseFloat(document.getElementById(`dep-deduct-${contractId}`)?.value) || 0;
  const notes   = document.getElementById(`dep-notes-${contractId}`)?.value?.trim() || '';
  if (!type) { alert('اختر نوع التسوية.'); return; }

  let status    = 'held';
  let finalDeducted = 0;
  if (type === 'full_return')    { status = 'returned_full';    finalDeducted = 0; }
  if (type === 'partial_deduct') { status = 'returned_partial'; finalDeducted = deducted; }
  if (type === 'full_keep')      { status = 'kept_full';        finalDeducted = c.depositAmount; }

  const sb = getSB();
  if (!sb || !currentOwner?.id) return;

  const { error } = await sb.from('owner_contracts')
    .update({ deposit_status: status, deposit_deducted: finalDeducted, deposit_notes: notes || null })
    .eq('id', contractId).eq('owner_id', currentOwner.id);

  if (error) { alert('تعذّر الحفظ: ' + error.message); return; }

  await loadContractsRemote();
  syncDataFromContracts();
  _depositSettlingId.delete(contractId);
  renderContracts();
}

/* HTML نموذج تسوية التأمين داخل البطاقة */
function _depositSettlementForm(c) {
  const kept    = c.depositAmount;
  const partial = kept > 0 ? Math.round(kept / 2) : 0;
  return `
    <div class="dep-settle-form">
      <div class="dep-settle-title">💰 تسوية التأمين — ${parseFloat(c.depositAmount).toLocaleString('ar-EG')} ج</div>
      <div class="dep-settle-options">
        <label class="dep-opt">
          <input type="radio" name="dep-type-${c.id}" value="full_return">
          <span>↩️ استرداد كامل — إرجاع ${parseFloat(c.depositAmount).toLocaleString('ar-EG')} ج للمستأجر</span>
        </label>
        <label class="dep-opt">
          <input type="radio" name="dep-type-${c.id}" value="partial_deduct">
          <span>✂️ خصم جزئي — خصم
            <input type="number" id="dep-deduct-${c.id}" value="${partial}" min="0" max="${kept}"
              style="width:80px;padding:2px 6px;border-radius:5px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-family:'Space Mono',monospace;font-size:12px;text-align:center"
              onclick="this.closest('label').querySelector('input[type=radio]').checked=true">
            ج، ورد المتبقي للمستأجر
          </span>
        </label>
        <label class="dep-opt">
          <input type="radio" name="dep-type-${c.id}" value="full_keep">
          <span>🔴 احتجاز كامل — استخدام التأمين بالكامل (${parseFloat(c.depositAmount).toLocaleString('ar-EG')} ج)</span>
        </label>
      </div>
      <input type="text" id="dep-notes-${c.id}" placeholder="ملاحظات المعاينة (تلفيات، سبب الخصم…)"
        style="width:100%;margin-top:10px;padding:7px 10px;border-radius:7px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:12px">
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn btn-primary btn-sm" onclick="submitDepositSettlement('${c.id}')">💾 حفظ التسوية</button>
        <button class="btn btn-sm" onclick="closeDepositSettlement('${c.id}')">إلغاء</button>
      </div>
    </div>`;
}

/* HTML حالة التأمين في بطاقة العقد */
function _depositBadge(c) {
  if (!c.depositAmount || c.depositAmount <= 0) return '';
  const dep = parseFloat(c.depositAmount);
  const ded = parseFloat(c.depositDeducted) || 0;

  if (c.depositStatus === 'returned_full') {
    return `<div class="dep-badge dep-returned">↩️ تأمين مُسترد بالكامل — ${dep.toLocaleString('ar-EG')} ج</div>`;
  }
  if (c.depositStatus === 'returned_partial') {
    const ret = dep - ded;
    return `<div class="dep-badge dep-partial">✂️ خصم ${ded.toLocaleString('ar-EG')} ج · رد ${ret.toLocaleString('ar-EG')} ج${c.depositNotes ? ' · ' + c.depositNotes : ''}</div>`;
  }
  if (c.depositStatus === 'kept_full') {
    return `<div class="dep-badge dep-kept">🔴 تأمين محتجز بالكامل — ${dep.toLocaleString('ar-EG')} ج</div>`;
  }
  /* held (محفوظ) */
  const settleBtn = _depositSettlingId.has(c.id) ? '' :
    `<button class="btn btn-sm dep-settle-btn" onclick="openDepositSettlement('${c.id}')">⚖️ تسوية</button>`;
  return `<div class="dep-badge dep-held">🔒 تأمين: ${dep.toLocaleString('ar-EG')} ج${c.depositDate ? ' · ' + formatDate(c.depositDate) : ''}${settleBtn}</div>`;
}

/* ══════════════════════════════════════════
   💰  PARTIAL PAYMENT HELPERS
   ══════════════════════════════════════════ */

/* يُستدعى عند تغيير العقد أو المبلغ في نموذج الدفع */
function _pfUpdateHint() {
  const contractId = document.getElementById('pf-contract')?.value;
  const amount     = parseFloat(document.getElementById('pf-amount')?.value) || 0;
  const hint       = document.getElementById('pf-hint');
  const statusSel  = document.getElementById('pf-status');
  if (!hint) return;

  const c = contractsList.find(x => x.id === contractId);
  if (!c || !c.rent) {
    hint.style.display = 'none';
    return;
  }

  const rent      = parseFloat(c.rent);
  const remaining = rent - amount;

  hint.style.display = 'flex';

  if (amount <= 0) {
    hint.innerHTML = `<span class="pf-hint-lbl">الإيجار المستحق:</span><span class="pf-hint-val">${rent.toLocaleString('ar-EG')} ج/شهر</span>`;
    return;
  }

  if (amount >= rent) {
    hint.innerHTML = `<span class="pf-hint-lbl">الإيجار المستحق:</span><span class="pf-hint-val">${rent.toLocaleString('ar-EG')} ج</span><span class="pf-hint-status ok">✅ مدفوع بالكامل</span>`;
    if (statusSel) statusSel.value = 'paid';
  } else {
    hint.innerHTML = `<span class="pf-hint-lbl">المستحق:</span><span class="pf-hint-val">${rent.toLocaleString('ar-EG')} ج</span><span class="pf-hint-rem">المتبقي: <strong>${remaining.toLocaleString('ar-EG')} ج</strong></span><span class="pf-hint-status warn">⚡ جزئي</span>`;
    if (statusSel) statusSel.value = 'partial';
  }
}

/* حساب الرصيد المتراكم لعقد (إجمالي مدفوع، متبقي، آخر دفعة) */
function _contractLedger(contractId) {
  const c = contractsList.find(x => x.id === contractId);
  if (!c) return null;
  const payments = paymentsList.filter(p => p.contractId === contractId && p.status !== 'deposit');
  const totalPaid = payments.reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  const lastPmt   = [...payments].sort((a,b) => b.paidDate.localeCompare(a.paidDate))[0];
  /* عدد أشهر العقد الكلية */
  const months = c.startDate && c.endDate
    ? Math.max(1, Math.round((new Date(c.endDate) - new Date(c.startDate)) / (30.44 * 86400000)))
    : 0;
  const totalExpected = months * (parseFloat(c.rent) || 0);
  return {
    totalPaid, totalExpected,
    remaining:  Math.max(0, totalExpected - totalPaid),
    lastDate:   lastPmt?.paidDate || null,
    count:      payments.length,
  };
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
   💎  PLAN GATING
   ══════════════════════════════════════════ */
function getPlan() { return currentOwner?.planTier || 'starter'; }
function _isReadOnly() {
  const s = currentOwner?.subscriptionStatus;
  return s === 'expired' || s === 'cancelled' || s === 'suspended';
}
function _guardWrite(label) {
  if (!_isReadOnly()) return false;
  const msg = document.getElementById('readonly-toast');
  if (msg) {
    msg.textContent = `⛔ وضع القراءة فقط — جدّد اشتراكك لـ ${label}`;
    msg.classList.add('show');
    clearTimeout(msg._t);
    msg._t = setTimeout(() => msg.classList.remove('show'), 3500);
  }
  return true;
}

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

function showOwnerAccessGate(type, title, body, ctaHtml = null) {
  const loginPage = document.getElementById('login-page');
  const app = document.getElementById('app');
  const titleEl = document.getElementById('access-title');
  const bodyEl = document.getElementById('access-body');
  const alertEl = document.getElementById('login-error');
  const ctaEl = document.getElementById('access-cta');

  if (app) app.classList.remove('visible');
  if (loginPage) loginPage.style.display = 'flex';
  if (titleEl) titleEl.textContent = title;
  if (bodyEl) bodyEl.textContent = body;
  if (alertEl) {
    alertEl.className = 'login-error ' + (type || 'info');
    alertEl.textContent = body;
    alertEl.style.display = 'block';
  }
  if (ctaEl && ctaHtml) ctaEl.innerHTML = ctaHtml;
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
      `لم نتمكن من قراءة بيانات حسابك. تواصل مع الإدارة لمراجعة الصلاحية. ${detail}`,
      `<a href="/" class="btn-login" style="text-decoration:none">الرجوع إلى منصة مكاني Spot ←</a>`
    );
    setLoginLoading(false);
    return;
  }

  if (profile.role !== 'owner') {
    showOwnerAccessGate(
      'danger',
      'لوحة أصحاب المساحات غير مفعّلة لهذا الحساب',
      `حسابك الحالي مسجل كـ "${profile.role || 'tenant'}". اطلب تفعيل الحساب من المنصة وبعد تحويله إلى Owner ستفتح هذه اللوحة مباشرة.`,
      `<div style="display:flex;flex-direction:column;gap:10px">
        <a href="/?p=dashboard" class="btn-login" style="text-decoration:none">اطلب تفعيل الحساب ←</a>
        <a href="/" style="color:var(--text2);font-size:13px;text-align:center;text-decoration:none;display:block;padding:4px 0">رجوع للمنصة</a>
      </div>`
    );
    setLoginLoading(false);
    return;
  }

  /* ❌ حساب موقوف من الأدمن */
  if (profile.is_suspended) {
    showOwnerAccessGate(
      'danger',
      'تم إيقاف هذا الحساب مؤقتاً',
      'حسابك موقوف حالياً من قِبل إدارة مكاني Spot. تواصل معنا على واتساب 01103467711 للاستفسار.',
      `<a href="/" class="btn-login" style="text-decoration:none">الرجوع إلى منصة مكاني Spot ←</a>`
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
    subscriptionStatus: profile.subscription_status || null,
    /* 🪪 حقول البروفايل العام الموحد */
    avatarUrl:  profile.avatar_url  || '',
    coverUrl:   profile.cover_url   || '',
    bio:        profile.bio         || '',
    entityName: profile.entity_name || '',
    entityType: profile.entity_type || '',
    isVerified: !!profile.is_verified,
    roles:      Array.isArray(profile.roles) ? profile.roles : [],
  };

  /* 🔒 تحقق من حالة الاشتراك */
  const _subStatus = currentOwner.subscriptionStatus;
  const _isExpiredSub = _subStatus === 'expired' || _subStatus === 'cancelled' || _subStatus === 'suspended';

  if (currentOwner.planTier === 'starter' && !_isExpiredSub) {
    /* مستخدم starter حقيقي لم يشترك قط → شاشة الترقية */
    setLoginLoading(false);
    showOwnerAccessGate(
      'warning',
      '🔒 لوحة التحكم متاحة من باقة Growth فما فوق',
      'باقتك الحالية هي Starter. قم بترقية حسابك إلى Growth أو Pro للوصول إلى لوحة التحكم وإدارة مساحاتك.',
      `<a href="/" class="btn-login" style="text-decoration:none">الرجوع إلى منصة مكاني Spot ←</a>`
    );
    return;
  }
  /* اشتراك منتهٍ/ملغى/موقوف → يدخل الداشبورد بوضع القراءة فقط (بانر يظهر في initDashboard) */

  _ss.set('ms_owner', JSON.stringify(currentOwner));
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

  _ss.rm('ms_owner');
  currentOwner   = null;
  ownerSpaces = []; ownerSpacesFull = []; ownerSpacesPaused = [];
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
  _applySidebarAvatar();   /* 🪪 توحيد صورة السايدبار من profiles.avatar_url */

  /* 🔒 بانر انتهاء الاشتراك */
  const _roBanner = document.getElementById('readonly-banner');
  if (_roBanner) {
    if (_isReadOnly()) {
      const _subS = currentOwner.subscriptionStatus;
      const _lblMap = { expired: 'منتهٍ', cancelled: 'ملغى', suspended: 'موقوف' };
      _roBanner.querySelector('.ro-status').textContent = _lblMap[_subS] || _subS;
      _roBanner.style.display = 'flex';
    } else {
      _roBanner.style.display = 'none';
    }
  }

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
  GN.init(getSB(), currentOwner.id);
  subscribeNotificationsRealtime();
  cleanupOldNotifications();       /* حذف الإشعارات الأقدم من 90 يوم */
  cleanupOldCancelledBookings();   /* حذف الحجوزات الملغاة الأقدم من 30 يوم (Soft Delete) */

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
    /* كل المساحات المعتمدة (active + paused) + وحداتها */
    const { data: spacesData, error: spacesErr } = await sb
      .from('spaces')
      .select(`id, name, type, region, sort_order, is_active,
               description, activities, amenities, image_url, extra_images,
               min_price, sizes_prices, all_acts, season, insight,
               badge, icon_emoji,
               space_units(id, unit_id, name, floor, size, price, status, location, notes, image_url, created_at)`)
      .eq('owner_id', currentOwner.id)
      .eq('status', 'approved')
      .order('sort_order');

    if (spacesErr) throw spacesErr;

    /* تخزين كامل البيانات لكل مساحة */
    ownerSpacesFull = (spacesData || []).map(s => ({
      id:          s.id,
      name:        s.name       || '',
      type:        s.type       || '',
      region:      s.region     || '',
      description: s.description || '',
      activities:  Array.isArray(s.activities) ? s.activities : [],
      amenities:   Array.isArray(s.amenities)  ? s.amenities  : [],
      imageUrl:    s.image_url   || null,
      extraImages: Array.isArray(s.extra_images) ? s.extra_images.filter(Boolean) : [],
      minPrice:    s.min_price   || 0,
      sizesStr:    s.sizes_prices || '',
      allActs:     !!s.all_acts,
      season:      s.season     || '',
      insight:     s.insight    || '',
      badge:       s.badge      || '',
      iconEmoji:   s.icon_emoji || '🏬',
      isActive:    s.is_active !== false,
      units:       s.space_units || [],
    }));

    ownerSpacesPaused = ownerSpacesFull.filter(s => !s.isActive);

    /* تحويل الوحدات من المساحات النشطة فقط لمصفوفة ownerSpaces */
    ownerSpaces = [];
    ownerSpacesFull.filter(s => s.isActive).forEach(space => {
      (space.units || []).forEach(u => {
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
        _ss.set('ms_owner', JSON.stringify(currentOwner));
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
  ownerSpaces = []; ownerSpacesFull = []; ownerSpacesPaused = []; ownerPendingSpaces = [];
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

/* ══════════════════════════════════════════
   📊  SPACE ANALYTICS
   إحصائيات أداء المساحات: مشاهدات + ضغطات + حجوزات + معدل تحويل
   ══════════════════════════════════════════ */
let spaceAnalyticsData = [];   /* نتائج RPC owner_get_space_analytics */
let _analyticsLoaded   = false;

async function loadSpaceAnalytics(forceRefresh) {
  if (_analyticsLoaded && !forceRefresh) return;
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;

  const tbody = document.getElementById('analytics-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:30px">⏳ جاري التحميل…</td></tr>';

  const { data, error } = await sb.rpc('owner_get_space_analytics');
  if (error) {
    console.warn('[Analytics] RPC error:', error.message);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--red);padding:30px">⚠️ تعذّر تحميل الإحصائيات</td></tr>';
    return;
  }
  spaceAnalyticsData = data || [];
  _analyticsLoaded   = true;
  renderSpaceAnalytics();
  _updateSpacesAnalyticsColumn();
}

function _perfScore(views, clicks, bookings) {
  if (!views && !clicks && !bookings) return null;
  const conv = views > 0 ? (bookings / views) * 100 : 0;
  if (conv >= 3 || bookings >= 5) return { lbl:'ممتاز',    cls:'badge-green',  ico:'🟢' };
  if (conv >= 1 || bookings >= 2) return { lbl:'جيّد',     cls:'badge-blue',   ico:'🔵' };
  if (views >= 20)                return { lbl:'يحتاج تحسين', cls:'badge-yellow', ico:'🟡' };
  return                               { lbl:'قليل البيانات', cls:'',  ico:'⚪' };
}

function renderSpaceAnalytics() {
  const tbody = document.getElementById('analytics-tbody');
  if (!tbody) return;

  /* KPIs */
  const totalViews    = spaceAnalyticsData.reduce((s, r) => s + Number(r.views_count    || 0), 0);
  const totalClicks   = spaceAnalyticsData.reduce((s, r) => s + Number(r.clicks_count   || 0), 0);
  const totalBookings = spaceAnalyticsData.reduce((s, r) => s + Number(r.bookings_count || 0), 0);
  const avgConv       = totalViews > 0 ? ((totalBookings / totalViews) * 100).toFixed(1) : '0.0';

  const _kv = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _kv('an-total-views',    totalViews.toLocaleString('ar-EG'));
  _kv('an-total-clicks',   totalClicks.toLocaleString('ar-EG'));
  _kv('an-total-bookings', totalBookings.toLocaleString('ar-EG'));
  _kv('an-avg-conversion', avgConv + '%');

  if (!spaceAnalyticsData.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:40px 20px">
      <div style="font-size:36px;margin-bottom:10px">📊</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:6px">لا توجد بيانات بعد</div>
      <div style="font-size:12px">ستظهر الإحصائيات تلقائياً بمجرد أن يشاهد أحد الزوار مساحاتك على المنصة</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = spaceAnalyticsData.map(r => {
    const views    = Number(r.views_count    || 0);
    const clicks   = Number(r.clicks_count   || 0);
    const bookings = Number(r.bookings_count || 0);
    const conv     = Number(r.conversion_rate || 0);
    const perf     = _perfScore(views, clicks, bookings);
    const convColor = conv >= 3 ? 'var(--green)' : conv >= 1 ? 'var(--blue)' : conv > 0 ? 'var(--yellow)' : 'var(--text3)';
    const viewsBar  = views > 0
      ? `<div style="width:100%;background:var(--border);border-radius:99px;height:4px;margin-top:4px"><div style="height:4px;border-radius:99px;background:var(--blue);width:${Math.min(100, (views/Math.max(...spaceAnalyticsData.map(x=>Number(x.views_count||0)),1))*100)}%"></div></div>`
      : '';

    return `<tr>
      <td style="font-weight:700">${r.space_name || '—'}</td>
      <td style="text-align:center">
        <span style="font-family:'Space Mono',monospace;font-size:13px">${views.toLocaleString('ar-EG')}</span>
        ${viewsBar}
      </td>
      <td style="text-align:center;font-family:'Space Mono',monospace;font-size:13px;color:var(--blue)">${clicks.toLocaleString('ar-EG')}</td>
      <td style="text-align:center;font-family:'Space Mono',monospace;font-size:13px;color:var(--green)">${bookings.toLocaleString('ar-EG')}</td>
      <td style="text-align:center">
        <span style="font-family:'Space Mono',monospace;font-weight:700;color:${convColor}">${conv.toFixed(1)}%</span>
      </td>
      <td style="text-align:center">
        ${perf ? `<span class="badge ${perf.cls}" style="font-size:11px">${perf.ico} ${perf.lbl}</span>` : '<span style="color:var(--text3);font-size:11px">—</span>'}
      </td>
    </tr>`;
  }).join('');
}

/* يُحدّث عمود "الأداء" في جدول المساحات بناءً على بيانات analytics */
function _updateSpacesAnalyticsColumn() {
  /* يُستدعى بعد loadSpaceAnalytics — يُضيف mini-stats لكل صف في spaces-tbody */
  renderSpaces();
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
  /* جلب analytics في الخلفية بعد البيانات الأساسية */
  loadSpaceAnalytics();
}

/* ══════════════════════════════════════════
   💰  REVENUE VIEW — ديناميكي من ownerSpaces
   ══════════════════════════════════════════ */
function renderRevenue() {
  const now       = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const active    = contractsList.filter(c => c.status !== 'expired');
  const expected  = active.reduce((sum, c) => sum + (parseFloat(c.rent) || 0), 0);

  const collectedFor = id => paymentsList
    .filter(p => p.contractId === id && p.month === thisMonth && (p.status === 'paid' || p.status === 'partial'))
    .reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  const hasLate = id => paymentsList.some(p => p.contractId === id && p.month === thisMonth && p.status === 'late');

  const collected  = active.reduce((s, c) => s + collectedFor(c.id), 0);
  const due        = Math.max(0, expected - collected);
  const rate       = expected > 0 ? Math.round((collected / expected) * 100) : 0;
  const paidFull   = active.filter(c => collectedFor(c.id) >= (parseFloat(c.rent) || 1) && (parseFloat(c.rent) || 0) > 0).length;
  const lateCount  = active.filter(c => hasLate(c.id)).length;

  const fmt = n => n ? Math.round(n).toLocaleString('ar-EG') + ' ج' : '—';
  setTxt('rev-expected',      fmt(expected));
  setTxt('rev-collected',     fmt(collected));
  setTxt('rev-rate',          rate + '%');
  setTxt('rev-due',           fmt(due));
  setTxt('rev-expected-sub',  `${active.length} عقد نشط`);
  setTxt('rev-collected-sub', paidFull > 0 ? `${paidFull} عقد مدفوع بالكامل` : 'في انتظار الدفعات');
  setTxt('rev-due-sub',       lateCount > 0 ? `${lateCount} عقد متأخر` : due > 0 ? 'في انتظار التحصيل' : '✓ لا مستحقات');

  const collectedEl = document.getElementById('rev-collected');
  if (collectedEl) collectedEl.style.color = collected > 0 ? 'var(--green)' : 'var(--text3)';
  const dueEl = document.getElementById('rev-due');
  if (dueEl) dueEl.style.color = due > 0 ? 'var(--red)' : 'var(--green)';
  const rateBar = document.getElementById('rev-rate-bar');
  if (rateBar) {
    rateBar.style.width = Math.min(100, rate) + '%';
    rateBar.className = 'prog-fill ' + (rate >= 80 ? 'green' : rate >= 40 ? 'yellow' : 'red');
  }

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

async function renderAddBazaarView() {
  if (!canAccess('pro')) {
    const viewEl = document.getElementById('view-add-bazaar');
    if (viewEl) viewEl.innerHTML = `<div class="section-label">🎪 إتاحة مساحتك لبازار</div>${planGateHtml('pro')}`;
    return;
  }
  await loadBazaarOpportunities();
  _bzSetupDraftListener();
  if (!_bzDraftLoaded) { _bzDraftLoaded = true; _bzRestoreDraft(); }
}

/* تبديل تبويبات قسم البازار */
function switchBzTab(tab) {
  const panelNew = document.getElementById('bz-panel-new');
  const panelMy  = document.getElementById('bz-panel-my');
  const tabNew   = document.getElementById('bzt-new');
  const tabMy    = document.getElementById('bzt-my');
  if (!panelNew || !panelMy) return;
  panelNew.style.display = tab === 'new' ? '' : 'none';
  panelMy.style.display  = tab === 'my'  ? '' : 'none';
  tabNew?.classList.toggle('active', tab === 'new');
  tabMy?.classList.toggle('active',  tab === 'my');
  if (tab === 'my') renderBazaarOpportunities();
}

/* حساب الأيام في فورم الفرصة الجديدة */
function updateBzOppDays() {
  const start = document.getElementById('bzopp-start')?.value;
  const end   = document.getElementById('bzopp-end')?.value;
  const dEl   = document.getElementById('bzopp-days-display');
  const vEl   = document.getElementById('bzopp-days-val');
  if (!start || !end || !dEl || !vEl) return;
  const days = Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1;
  if (days > 0) {
    vEl.textContent   = days;
    dEl.style.display = 'block';
  } else {
    dEl.style.display = 'none';
  }
}

/* تحميل فرص المالك من Supabase */
async function loadBazaarOpportunities() {
  try {
    const { data, error } = await sb.rpc('owner_get_bazaar_opportunities');
    if (error) throw error;
    bazaarOpportunities = data || [];
    const badge = document.getElementById('bz-opps-badge');
    if (badge) {
      if (bazaarOpportunities.length) {
        badge.textContent    = bazaarOpportunities.length;
        badge.style.display  = 'inline-flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('loadBazaarOpportunities:', e);
  }
}

const _BZ_VENUE_LABELS = {
  mall:'🏬 مول تجاري', club:'🏊 نادي', compound:'🏘️ كومباوند',
  company:'🏢 مبنى تجاري', outdoor:'🌳 فضاء خارجي', other:'📍 مكان آخر',
};
const _BZ_FOOTFALL_LABELS = { low:'🚶 منخفض', medium:'🚶🚶 متوسط', high:'🚶🚶🚶 عالٍ' };

/* عرض قائمة الفرص المنشورة */
function renderBazaarOpportunities() {
  const el = document.getElementById('bzopp-list');
  if (!el) return;

  if (!bazaarOpportunities.length) {
    el.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:12px">🎪</div>
        <div style="font-size:14px">لا توجد فرص منشورة بعد</div>
        <div style="font-size:12px;margin-top:8px">انشر أول فرصة من تبويب "نشر فرصة جديدة"</div>
      </div>`;
    return;
  }

  const STATUS_LABELS = {
    open:'مفتوحة', closed:'مغلقة', expired:'منتهية', organizer_selected:'تم الاختيار ✓'
  };
  const STATUS_COLORS = {
    open:'var(--green)', closed:'var(--text3)', expired:'var(--yellow)', organizer_selected:'var(--blue)'
  };

  const _today = new Date(); _today.setHours(0,0,0,0);

  el.innerHTML = bazaarOpportunities.map(opp => {
    const statusLbl = STATUS_LABELS[opp.status] || opp.status;
    const statusClr = STATUS_COLORS[opp.status] || 'var(--text3)';
    const cnt       = opp.proposals_count || 0;

    /* عداد الأيام المتبقية */
    const endDate  = new Date(opp.available_end);
    const daysLeft = Math.round((endDate - _today) / 86400000);
    const countdown = opp.status === 'open' && daysLeft >= 0
      ? `<span style="font-size:10px;background:${daysLeft <= 3 ? 'rgba(255,77,77,.12)' : 'rgba(255,184,0,.12)'};color:${daysLeft <= 3 ? 'var(--red)' : 'var(--yellow)'};border-radius:4px;padding:2px 7px;font-weight:700">
           ⏳ ${daysLeft === 0 ? 'اليوم آخر يوم!' : `${daysLeft} يوم متبقٍ`}
         </span>`
      : '';

    const propBadge = cnt > 0
      ? `<span style="background:rgba(77,159,255,0.18);color:var(--blue);border-radius:20px;padding:2px 10px;font-size:11px;font-weight:700">${cnt} عرض</span>`
      : `<span style="color:var(--text3);font-size:11px">لا توجد عروض بعد</span>`;

    /* أزرار الأكشن */
    const viewBtn = cnt > 0
      ? `<button class="btn btn-sm btn-primary" onclick="openOpportunityProposals('${opp.id}','${_escR(opp.place_name)}','${opp.status}')">👁️ عرض المقترحات (${cnt})</button>`
      : `<button class="btn btn-sm" disabled style="opacity:0.5;cursor:default">لا توجد عروض بعد</button>`;

    const closeBtn = opp.status === 'open'
      ? `<button class="btn btn-sm" style="border-color:rgba(255,77,77,.3);color:var(--red)" onclick="closeBazaarOpportunity('${opp.id}','${_escR(opp.place_name)}')">🔒 إغلاق</button>`
      : '';

    const canReopen = ['closed','organizer_selected'].includes(opp.status) && daysLeft >= 0;
    const reopenBtn = canReopen
      ? `<button class="btn btn-sm" style="border-color:rgba(77,159,255,.3);color:var(--blue)" onclick="reopenBazaarOpportunity('${opp.id}','${_escR(opp.place_name)}')">🔓 إعادة فتح</button>`
      : '';

    const dupBtn = `<button class="btn btn-sm" style="border-color:rgba(255,184,0,.3);color:var(--yellow)" onclick="duplicateBazaarOpportunity('${opp.id}')">📋 نسخ</button>`;

    return `
      <div class="bzopp-card">
        <div class="bzopp-card-head">
          <div>
            <div class="bzopp-card-title">${_escR(opp.place_name)}</div>
            <div class="bzopp-card-sub">${opp.city ? _escR(opp.city) + ' · ' : ''}${_BZ_VENUE_LABELS[opp.venue_type] || opp.venue_type || ''}</div>
          </div>
          <div style="text-align:left;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span style="color:${statusClr};font-size:12px;font-weight:700">● ${statusLbl}</span>
            ${propBadge}
          </div>
        </div>
        <div class="bzopp-card-meta">
          <span>📅 ${opp.available_start} → ${opp.available_end}</span>
          <span>${opp.days_count} يوم</span>
          ${opp.available_area ? `<span>📐 ${opp.available_area} م²</span>` : ''}
          <span>${opp.is_indoor ? '🏠 مغلق' : '🌳 مفتوح'}</span>
          ${opp.has_electricity ? '<span>⚡ كهرباء</span>' : ''}
          ${countdown}
        </div>
        <div class="bzopp-card-actions">
          ${viewBtn}${closeBtn}${reopenBtn}${dupBtn}
        </div>
      </div>`;
  }).join('');
}

/* إغلاق فرصة */
async function closeBazaarOpportunity(id, placeName) {
  if (!confirm(`إغلاق فرصة "${placeName}"؟\nلن يتمكن المنظمون من تقديم عروض جديدة بعدها.`)) return;
  const { error } = await sb.rpc('close_bazaar_opportunity', { p_request_id: id });
  if (error) { alert('تعذّر الإغلاق: ' + error.message); return; }
  await loadBazaarOpportunities();
  renderBazaarOpportunities();
}

/* إعادة فتح فرصة مُغلقة */
async function reopenBazaarOpportunity(id, placeName) {
  if (!confirm(`إعادة فتح فرصة "${placeName}"؟\nستعود لاستقبال عروض جديدة وسيُعاد تفعيل العروض المرفوضة.`)) return;
  const { error } = await sb.rpc('reopen_bazaar_opportunity', { p_request_id: id });
  if (error) { alert('تعذّر إعادة الفتح: ' + error.message); return; }
  await loadBazaarOpportunities();
  renderBazaarOpportunities();
}

/* ═══ state خاص بمودال المقترحات ═══ */
let _bzCurrentOppId     = null;
let _bzCurrentOppStatus = 'open';
let _bzAllProposals     = [];

/* فتح مودال عروض فرصة معيّنة */
async function openOpportunityProposals(requestId, placeName, oppStatus) {
  _bzCurrentOppId     = requestId;
  _bzCurrentOppStatus = oppStatus || 'open';

  const modal = document.getElementById('bzopp-proposals-modal');
  const body  = document.getElementById('bzopp-proposals-body');
  const title = document.getElementById('bzopp-modal-title');
  const sub   = document.getElementById('bzopp-modal-sub');
  if (!modal || !body) return;

  title.textContent = `عروض المنظمين — ${_escR(placeName)}`;
  sub.textContent   = 'يتم تحميل العروض…';
  body.innerHTML    = `<div style="text-align:center;padding:40px;color:var(--text3)">⏳ جاري التحميل…</div>`;
  modal.style.display = 'flex';

  const { data: proposals, error } = await sb.rpc('owner_get_opportunity_proposals', {
    p_request_id: requestId,
    p_sort_by:    'recent',
  });

  if (error) {
    body.innerHTML = `<div style="color:var(--red);padding:20px">خطأ: ${_escR(error.message)}</div>`;
    return;
  }

  _bzAllProposals = proposals || [];
  sub.textContent = `${_bzAllProposals.length} عرض مُستلم`;
  _renderBzProposalCards(_bzAllProposals, 'recent');
}

/* إعادة ترتيب المقترحات (يعمل على البيانات المحمّلة في الذاكرة) */
function sortBzProposals(sortBy, btnEl) {
  document.querySelectorAll('.bzopp-sort-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');

  const sorted = [..._bzAllProposals];
  if (sortBy === 'price_asc')    sorted.sort((a,b) => (a.proposed_rent ?? Infinity) - (b.proposed_rent ?? Infinity));
  if (sortBy === 'experience')   sorted.sort((a,b) => (b.org_bazaars_count ?? 0) - (a.org_bazaars_count ?? 0));
  if (sortBy === 'recent')       sorted.sort((a,b) => new Date(b.submitted_at) - new Date(a.submitted_at));

  _renderBzProposalCards(sorted, sortBy);
}

/* بناء الـ HTML للمقترحات */
function _renderBzProposalCards(proposals, activeSortBy) {
  const body = document.getElementById('bzopp-proposals-body');
  if (!body) return;

  const canSelect = _bzCurrentOppStatus === 'open';

  if (!proposals.length) {
    body.innerHTML = `<div style="text-align:center;padding:50px 20px;color:var(--text3)">
      <div style="font-size:32px;margin-bottom:10px">📭</div>
      <div>لا توجد عروض بعد — المنظمون يرون الفرصة ويمكنهم التقديم في أي وقت.</div>
    </div>`;
    return;
  }

  const sortBar = `
    <div class="bzopp-sort-bar">
      <span style="font-size:11px;color:var(--text3);font-weight:600">ترتيب:</span>
      <button class="bzopp-sort-btn${activeSortBy==='recent'?' active':''}" onclick="sortBzProposals('recent',this)">الأحدث</button>
      <button class="bzopp-sort-btn${activeSortBy==='price_asc'?' active':''}" onclick="sortBzProposals('price_asc',this)">💰 الأقل سعراً</button>
      <button class="bzopp-sort-btn${activeSortBy==='experience'?' active':''}" onclick="sortBzProposals('experience',this)">🏆 الأكثر خبرة</button>
    </div>`;

  const cards = proposals.map(p => {
    const avatarHtml = p.org_avatar_url
      ? `<img src="${_escR(p.org_avatar_url)}" class="bzopp-proposal-avatar" alt="">`
      : `<div class="bzopp-proposal-avatar">🎪</div>`;
    const verBadge = p.org_is_verified
      ? `<span style="background:rgba(77,159,255,0.18);color:var(--blue);font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700">✓ موثّق</span>`
      : '';
    const bazaarsLbl = p.org_bazaars_count > 0
      ? `<span style="font-size:11px;color:var(--text3)">${p.org_bazaars_count} بازار سابق</span>`
      : `<span style="font-size:11px;color:var(--text3)">منظم جديد</span>`;
    const socials = [
      p.org_whatsapp  ? `<a href="https://wa.me/${p.org_whatsapp.replace(/\D/g,'')}" target="_blank">💬 واتساب</a>` : '',
      p.org_instagram ? `<a href="${_escR(p.org_instagram)}" target="_blank">📸 Instagram</a>` : '',
      p.org_facebook  ? `<a href="${_escR(p.org_facebook)}" target="_blank">📘 Facebook</a>` : '',
    ].filter(Boolean).join('');

    /* حالة العرض */
    const isAccepted = p.proposal_status === 'accepted';
    const isRejected = p.proposal_status === 'rejected';
    const statusBanner = isAccepted
      ? `<div style="background:rgba(0,200,83,.12);border:1px solid rgba(0,200,83,.25);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--green);font-weight:700;margin-bottom:10px">✓ تم اختيار هذا المنظم</div>`
      : isRejected
        ? `<div style="background:rgba(255,77,77,.07);border:1px solid rgba(255,77,77,.2);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--text3);margin-bottom:10px">مرفوض (لم يُختر)</div>`
        : '';

    /* زر الاختيار — يظهر فقط إذا كانت الفرصة مفتوحة والعرض معلّق */
    const selectBtn = canSelect && p.proposal_status === 'pending'
      ? `<button class="btn btn-sm" style="background:rgba(0,200,83,.12);border-color:rgba(0,200,83,.3);color:var(--green);font-weight:700"
           onclick="selectBazaarOrganizer('${p.proposal_id}','${_escR(p.organizer_name || 'المنظم')}')">
           ✓ اختر هذا المنظم
         </button>`
      : '';

    return `
      <div class="bzopp-proposal-card" style="${isAccepted ? 'border-color:rgba(0,200,83,.4);' : ''}">
        <div class="bzopp-proposal-head">
          ${avatarHtml}
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px;color:var(--text)">${_escR(p.organizer_name || 'منظم بازار')}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:4px">${bazaarsLbl} ${verBadge}</div>
            ${p.org_bio ? `<div style="font-size:11px;color:var(--text2);margin-top:5px;line-height:1.5">${_escR(p.org_bio)}</div>` : ''}
          </div>
          <div style="text-align:left">
            <a href="tel:${_escR(p.organizer_phone)}"
               style="display:inline-flex;align-items:center;gap:6px;background:rgba(0,200,83,0.12);color:var(--green);border:1px solid rgba(0,200,83,0.25);border-radius:8px;padding:8px 14px;text-decoration:none;font-weight:700;font-size:13px">
              📞 ${_escR(p.organizer_phone)}
            </a>
          </div>
        </div>
        <div class="bzopp-proposal-body">
          ${statusBanner}
          <div class="bzopp-proposal-row">
            ${p.proposed_rent != null ? `
              <div class="bzopp-proposal-field">
                <div class="bzopp-proposal-label">السعر المقترح</div>
                <div class="bzopp-proposal-val" style="color:var(--green);font-family:'Space Mono',monospace">${Number(p.proposed_rent).toLocaleString('ar-EG')} ج.م.</div>
              </div>` : ''}
            ${p.proposed_start ? `
              <div class="bzopp-proposal-field">
                <div class="bzopp-proposal-label">التواريخ المقترحة</div>
                <div class="bzopp-proposal-val" style="font-size:12px">${p.proposed_start} → ${p.proposed_end || '؟'}</div>
              </div>` : ''}
            ${p.proposed_exhibitors_count ? `
              <div class="bzopp-proposal-field">
                <div class="bzopp-proposal-label">عدد العارضين</div>
                <div class="bzopp-proposal-val">${p.proposed_exhibitors_count} عارض</div>
              </div>` : ''}
          </div>
          ${p.concept_description ? `
            <div style="margin-bottom:10px">
              <div class="bzopp-proposal-label">مفهوم البازار</div>
              <div style="font-size:13px;color:var(--text);line-height:1.6;margin-top:4px">${_escR(p.concept_description)}</div>
            </div>` : ''}
          ${p.notes ? `
            <div style="margin-bottom:10px">
              <div class="bzopp-proposal-label">ملاحظات</div>
              <div style="font-size:12px;color:var(--text2);line-height:1.6;margin-top:4px">${_escR(p.notes)}</div>
            </div>` : ''}
          ${socials ? `<div class="bzopp-org-socials">${socials}</div>` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px">
            <span style="font-size:10px;color:var(--text3)">استلم ${new Date(p.submitted_at).toLocaleDateString('ar-EG')}</span>
            ${selectBtn}
          </div>
        </div>
      </div>`;
  }).join('');

  body.innerHTML = sortBar + cards;
}

/* اختيار منظم — Atomic Transaction */
async function selectBazaarOrganizer(proposalId, orgName) {
  if (!confirm(`اختيار "${orgName}" لتنظيم البازار؟\nسيتم رفض باقي العروض تلقائياً وإشعار المنظم المختار.`)) return;

  const { error } = await sb.rpc('select_bazaar_organizer', {
    p_request_id:  _bzCurrentOppId,
    p_proposal_id: proposalId,
  });

  if (error) { alert('تعذّر الاختيار: ' + error.message); return; }

  const body = document.getElementById('bzopp-proposals-body');
  if (body) body.innerHTML = `
    <div style="text-align:center;padding:50px 20px">
      <div style="font-size:40px;margin-bottom:14px">🎉</div>
      <div style="font-size:16px;font-weight:700;color:var(--text)">تم اختيار "${_escR(orgName)}" بنجاح!</div>
      <div style="font-size:13px;color:var(--text3);margin-top:8px;line-height:1.7">
        تم إشعاره تلقائياً — تواصل معه مباشرةً عبر رقمه.<br>
        العروض الأخرى تم رفضها تلقائياً.
      </div>
    </div>`;

  /* تحديث القائمة في الخلفية */
  setTimeout(async () => {
    closeBzProposalsModal();
    await loadBazaarOpportunities();
    renderBazaarOpportunities();
  }, 2500);
}

function closeBzProposalsModal() {
  const m = document.getElementById('bzopp-proposals-modal');
  if (m) m.style.display = 'none';
}

/* ════════════════════════════════════════
   B: حفظ المسودة تلقائياً (localStorage)
   ════════════════════════════════════════ */
let _bzDraftListenerAdded = false;
let _bzDraftLoaded        = false;
const _BZ_DRAFT_KEY = () => `msp_bzopp_${currentUser?.id || 'x'}`;

function _bzSaveDraft() {
  const g = id => document.getElementById(id);
  const draft = {
    place:    g('bzopp-place')?.value     || '',
    type:     g('bzopp-type')?.value      || '',
    city:     g('bzopp-city')?.value      || '',
    area:     g('bzopp-area')?.value      || '',
    indoor:   !!g('bzopp-indoor')?.checked,
    electric: !!g('bzopp-electric')?.checked,
    setup:    !!g('bzopp-setup')?.checked,
    footfall: g('bzopp-footfall')?.value  || '',
    start:    g('bzopp-start')?.value     || '',
    end:      g('bzopp-end')?.value       || '',
    image:    g('bzopp-image')?.value     || '',
    notes:    g('bzopp-notes')?.value     || '',
    ts:       Date.now(),
  };
  try { localStorage.setItem(_BZ_DRAFT_KEY(), JSON.stringify(draft)); } catch {}
  _bzRefreshDraftBadge(draft);
}

function _bzRestoreDraft() {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(_BZ_DRAFT_KEY())); } catch {}
  if (!draft || (!draft.place && !draft.type && !draft.city)) return;

  const g = id => document.getElementById(id);
  if (g('bzopp-place'))    g('bzopp-place').value       = draft.place    || '';
  if (g('bzopp-type'))     g('bzopp-type').value        = draft.type     || '';
  if (g('bzopp-city'))     g('bzopp-city').value        = draft.city     || '';
  if (g('bzopp-area'))     g('bzopp-area').value        = draft.area     || '';
  if (g('bzopp-indoor'))   g('bzopp-indoor').checked    = !!draft.indoor;
  if (g('bzopp-electric')) g('bzopp-electric').checked  = !!draft.electric;
  if (g('bzopp-setup'))    g('bzopp-setup').checked     = !!draft.setup;
  if (g('bzopp-footfall')) g('bzopp-footfall').value    = draft.footfall || '';
  if (g('bzopp-start'))    g('bzopp-start').value       = draft.start    || '';
  if (g('bzopp-end'))      g('bzopp-end').value         = draft.end      || '';
  if (g('bzopp-image'))    g('bzopp-image').value       = draft.image    || '';
  if (g('bzopp-notes'))    g('bzopp-notes').value       = draft.notes    || '';
  updateBzOppDays();
  _bzRefreshDraftBadge(draft);
}

function _bzClearDraft() {
  try { localStorage.removeItem(_BZ_DRAFT_KEY()); } catch {}
  _bzRefreshDraftBadge(null);
}

function _bzRefreshDraftBadge(draft) {
  const el = document.getElementById('bzopp-draft-badge');
  if (!el) return;
  const hasContent = draft && (draft.place || draft.type || draft.city);
  if (!hasContent) { el.style.display = 'none'; return; }
  const d = new Date(draft.ts || 0);
  const timeStr = isNaN(d) ? '' : d.toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit' });
  el.style.display = 'flex';
  el.innerHTML = `
    <span style="display:flex;align-items:center;gap:6px">
      <span>💾</span>
      <span>مسودة محفوظة تلقائياً${timeStr ? ' الساعة ' + timeStr : ''}</span>
    </span>
    <button type="button" onclick="_bzClearDraft()"
      style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:11px;padding:0;line-height:1">
      ✕ مسح
    </button>`;
}

function _bzSetupDraftListener() {
  if (_bzDraftListenerAdded) return;
  _bzDraftListenerAdded = true;
  const save = e => { if (e.target.closest('#bzopp-form')) _bzSaveDraft(); };
  document.addEventListener('input',  save);
  document.addEventListener('change', save);
}

/* ════════════════════════════════════════
   C: نسخ فرصة موجودة → ملء فورم جديد
   ════════════════════════════════════════ */
function duplicateBazaarOpportunity(id) {
  const opp = bazaarOpportunities.find(o => o.id === id);
  if (!opp) return;

  switchBzTab('new');

  const g   = id => document.getElementById(id);
  const set = (elId, val) => { const el = g(elId); if (el) el.value = val ?? ''; };

  set('bzopp-place',    opp.place_name);
  set('bzopp-type',     opp.venue_type);
  set('bzopp-city',     opp.city);
  set('bzopp-area',     opp.available_area ?? '');
  if (g('bzopp-indoor'))   g('bzopp-indoor').checked   = !!opp.is_indoor;
  if (g('bzopp-electric')) g('bzopp-electric').checked = !!opp.has_electricity;
  if (g('bzopp-setup'))    g('bzopp-setup').checked    = !!opp.has_setup;
  set('bzopp-footfall', opp.expected_footfall ?? '');
  set('bzopp-start',    ''); /* التواريخ يحدّدها المستخدم */
  set('bzopp-end',      '');
  set('bzopp-image',    opp.image_url  ?? '');
  set('bzopp-notes',    opp.notes      ?? '');

  updateBzOppDays();
  _bzSaveDraft();

  /* تمييز تاريخ البداية */
  const startEl = g('bzopp-start');
  if (startEl) {
    startEl.style.outline = '2px solid var(--yellow)';
    startEl.focus();
    setTimeout(() => { startEl.style.outline = ''; }, 3000);
  }

  /* رسالة تأكيد مؤقتة */
  const msg = g('bzopp-msg');
  if (msg) {
    msg.className     = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">📋</span><div class="alert-text"><strong>تم نسخ بيانات الفرصة!</strong><br>أضف التواريخ الجديدة ثم اضغط نشر.</div>`;
    setTimeout(() => { msg.style.display = 'none'; }, 4000);
  }

  g('bz-panel-new')?.scrollIntoView({ behavior:'smooth', block:'start' });
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

  const MONTHS_AR_PAY = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                         'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const fmt = n => n ? n.toLocaleString('ar-EG') + ' ج' : '—';

  const sortedPayments = [...paymentsList].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const stMap = {
    paid:    { cls:'badge-green',  lbl:'مدفوع ✅' },
    partial: { cls:'badge-yellow', lbl:'جزئي ⚡' },
    late:    { cls:'badge-red',    lbl:'متأخر ⏰' },
  };

  /* ── كشف حساب لكل عقد نشط ── */
  const activeC = contractsList.filter(c => c.status !== 'expired' && parseFloat(c.rent) > 0);
  const ledgerHtml = activeC.length ? `
    <div class="pcard" style="margin-bottom:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">📊 كشف حساب المستأجرين</div><div class="pcard-sub">مستحق × مدفوع × متبقي لكل عقد نشط</div></div>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>الإيجار/شهر</th><th>إجمالي المدفوع</th><th>إجمالي المستحق</th><th>المتبقي</th><th>آخر دفعة</th><th>الحالة</th></tr></thead>
          <tbody>
            ${activeC.map(c => {
              const lg = _contractLedger(c.id);
              if (!lg) return '';
              const rem = lg.remaining;
              const pct = lg.totalExpected > 0 ? Math.min(100, Math.round((lg.totalPaid / lg.totalExpected)*100)) : 0;
              const stCls = rem <= 0 ? 'badge-green' : lg.totalPaid > 0 ? 'badge-yellow' : 'badge-red';
              const stLbl = rem <= 0 ? 'مسوّى ✅' : lg.totalPaid > 0 ? 'جزئي ⚡' : 'لا دفعات ⏰';
              return `<tr>
                <td style="font-weight:800">${c.tenantName}</td>
                <td style="font-family:'Space Mono',monospace;color:var(--orange)">${c.spaceCode}</td>
                <td style="font-family:'Space Mono',monospace">${parseFloat(c.rent).toLocaleString('ar-EG')} ج</td>
                <td style="font-family:'Space Mono',monospace;color:var(--green);font-weight:700">${lg.totalPaid.toLocaleString('ar-EG')} ج</td>
                <td style="font-family:'Space Mono',monospace;color:var(--text2)">${lg.totalExpected.toLocaleString('ar-EG')} ج</td>
                <td style="font-family:'Space Mono',monospace;font-weight:800;color:${rem>0?'var(--red)':'var(--green)'}">${rem>0?rem.toLocaleString('ar-EG')+' ج':'—'}</td>
                <td style="font-size:11px;color:var(--text3)">${lg.lastDate?formatDate(lg.lastDate):'—'}</td>
                <td><span class="badge ${stCls}">${stLbl}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '';

  const tableHtml = `
    ${ledgerHtml}
    <div class="pcard" style="margin-bottom:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">💰 سجل الدفعات</div><div class="pcard-sub">جميع المبالغ المحصّلة من المستأجرين</div></div>
        <span class="db-tag">DB: payments</span>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>الشهر</th><th>المبلغ</th><th>المتبقي</th><th>تاريخ الدفع</th><th>الحالة</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody>
            ${!sortedPayments.length
              ? `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:30px">لا توجد دفعات مسجّلة بعد — أضف أول دفعة من النموذج أدناه</td></tr>`
              : sortedPayments.map(p => {
                  const st = stMap[p.status] || { cls:'badge-blue', lbl:p.status };
                  const [yr,mo] = (p.month||'--').split('-');
                  const mLbl = (MONTHS_AR_PAY[parseInt(mo,10)-1]||mo) + (yr?' '+yr:'');
                  /* حساب المتبقي للدفعات الجزئية */
                  const contract = contractsList.find(c => c.id === p.contractId);
                  const rent = contract ? parseFloat(contract.rent) : 0;
                  const paid = parseFloat(p.amount);
                  const remaining = (p.status === 'partial' && rent > 0) ? Math.max(0, rent - paid) : 0;
                  return `<tr${p.status==='partial'?' class="tr-partial"':''}>
                    <td style="font-weight:700">${p.tenantName}</td>
                    <td style="font-family:'Space Mono',monospace;color:var(--orange)">${p.spaceCode}</td>
                    <td style="font-size:11px;color:var(--text2)">${mLbl}</td>
                    <td style="font-family:'Space Mono',monospace;font-weight:700">${paid.toLocaleString('ar-EG')} ج</td>
                    <td style="font-family:'Space Mono',monospace;font-size:12px;${remaining>0?'color:var(--red);font-weight:700':'color:var(--text3)'}">${remaining>0?remaining.toLocaleString('ar-EG')+' ج':'—'}</td>
                    <td style="font-size:11px;color:var(--text3)">${formatDate(p.paidDate)}</td>
                    <td><span class="badge ${st.cls}">${st.lbl}</span></td>
                    <td style="font-size:11px;color:var(--text3);max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.notes||'—'}</td>
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
        <div class="pcard-sub">النظام يكتشف تلقائياً إذا كانت الدفعة جزئية أو كاملة</div>
      </div>
      <div class="pcard-body">
        <div id="payment-msg" class="alert-item" style="display:none;margin-bottom:14px"></div>
        <div id="pf-hint" style="display:none" class="pf-hint-bar"></div>
        <form id="payment-form" onsubmit="submitPayment(event)">
          <div class="form-row">
            <div class="form-group" style="margin:0">
              <label>المستأجر / العقد <span style="color:var(--red)">*</span></label>
              <select id="pf-contract" required onchange="_pfUpdateHint()">
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
              <input type="number" id="pf-amount" placeholder="مثال: 4200" min="0" required
                style="font-family:'Space Mono',monospace" oninput="_pfUpdateHint()">
            </div>
            <div class="form-group" style="margin:0">
              <label>تاريخ الاستلام</label>
              <input type="date" id="pf-date">
            </div>
          </div>
          <div class="form-row" style="margin-top:12px">
            <div class="form-group" style="margin:0">
              <label>حالة الدفع <span style="font-size:10px;color:var(--text3)">(تُحدَّث تلقائياً)</span></label>
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

  container.innerHTML = tableHtml + formHtml;
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
  if (_guardWrite('تسجيل دفعة')) return;
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
  /* اكتشاف تلقائي: إذا المبلغ أقل من الإيجار → جزئي دون ما يحتاج المالك يختار */
  const rent = contract ? parseFloat(contract.rent) : 0;
  let finalStatus = status;
  if (rent > 0 && amount < rent && status === 'paid') finalStatus = 'partial';
  if (rent > 0 && amount >= rent && status === 'partial') finalStatus = 'paid';

  const payload = {
    owner_id:    currentOwner.id,
    contract_id: contractId,
    tenant_name: contract?.tenantName || '—',
    space_code:  contract?.spaceCode  || '—',
    amount, month, paid_date: paidDate || null, status: finalStatus, notes: notes || null,
  };
  (async () => {
    try {
      const { data: inserted, error } = await sb.from('owner_payments').insert(payload).select('id').single();
      if (error) throw error;
      _lastSavedPaymentId = inserted?.id || null;
      await loadPaymentsRemote();
      renderPayments();
      renderKPIs();
      document.getElementById('payment-form')?.reset();
      /* عرض زر طباعة الإيصال فوراً */
      const printBtnHtml = _lastSavedPaymentId
        ? `<button type="button" class="pay-print-btn" onclick="printInvoice('${_lastSavedPaymentId}')">🖨️ طباعة الإيصال</button>`
        : '';
      if (msgEl) {
        msgEl.className = 'alert-item success';
        msgEl.style.display = 'flex';
        msgEl.innerHTML = `<span class="alert-ico">✅</span><div class="alert-text" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><strong>تم تسجيل دفعة ${amount.toLocaleString('ar-EG')} ج بنجاح</strong>${printBtnHtml}</div>`;
        setTimeout(() => { if (msgEl) msgEl.style.display='none'; }, 8000);
      }
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
    <div class="kpi-row kpi-row--3" style="margin-bottom:20px">
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
  if (_guardWrite('تسجيل مخالفة')) return;
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
/* ══════════════════════════════════════════
   📊  REPORTS — نظام التقارير المالية الديناميكي
   ══════════════════════════════════════════ */
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                   'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

/* حساب نطاق التاريخ من نوع الفترة */
function _rptPeriodRange(period) {
  const now  = new Date();
  const yr   = now.getFullYear();
  const mo   = now.getMonth();
  const fmt  = d => d.toISOString().slice(0, 10);
  const last = (y, m) => new Date(y, m + 1, 0);
  if (period === 'month')   return { from: fmt(new Date(yr, mo, 1)),    to: fmt(last(yr, mo)) };
  if (period === 'quarter') { const q = Math.floor(mo/3)*3; return { from: fmt(new Date(yr, q, 1)), to: fmt(last(yr, q+2)) }; }
  if (period === 'half')    return { from: fmt(new Date(yr, 0, 1)),     to: fmt(last(yr, 5)) };
  if (period === 'year')    return { from: fmt(new Date(yr, 0, 1)),     to: fmt(new Date(yr, 11, 31)) };
  return { from: '', to: '' };
}

/* حساب بيانات التقرير بناءً على نطاق زمني */
function _buildReportData(from, to) {
  const fromDate = from ? new Date(from)               : new Date(0);
  const toDate   = to   ? new Date(to + 'T23:59:59')   : new Date();

  const inRange = (dateStr) => {
    const d = dateStr ? new Date(dateStr) : null;
    return d && d >= fromDate && d <= toDate;
  };

  const filteredPayments = paymentsList.filter(p => inRange(p.paidDate || p.createdAt));
  const paidPayments     = filteredPayments.filter(p => p.status === 'paid' || p.status === 'partial');
  const latePayments     = filteredPayments.filter(p => p.status === 'late');
  const totalRevenue     = filteredPayments.reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const paidTotal        = paidPayments.reduce((s,p) => s + parseFloat(p.amount||0), 0);
  const lateTotal        = latePayments.reduce((s,p) => s + parseFloat(p.amount||0), 0);

  const activeInPeriod = contractsList.filter(c => {
    if (!c.startDate) return false;
    const start = new Date(c.startDate);
    const end   = c.endDate ? new Date(c.endDate) : new Date(9999,0,1);
    return start <= toDate && end >= fromDate;
  });
  const expiredInPeriod = contractsList.filter(c => c.endDate && inRange(c.endDate) && c.status === 'expired');
  const expiringSoon    = contractsList.filter(c => c.status === 'expiring' || c.status === 'renewal');
  const avgRent         = activeInPeriod.length
    ? Math.round(activeInPeriod.reduce((s,c) => s + parseFloat(c.rent||0), 0) / activeInPeriod.length)
    : 0;

  /* إيرادات شهرية للمخطط */
  const monthly = {};
  filteredPayments.forEach(p => {
    const mk = (p.paidDate || p.createdAt || '').slice(0, 7);
    if (mk) monthly[mk] = (monthly[mk] || 0) + parseFloat(p.amount||0);
  });
  const monthKeys = Object.keys(monthly).sort();

  /* أفضل مساحات حسب الإيرادات */
  const spaceRev = {};
  filteredPayments.forEach(p => {
    if (p.spaceCode) spaceRev[p.spaceCode] = (spaceRev[p.spaceCode] || 0) + parseFloat(p.amount||0);
  });
  const topSpaces = Object.entries(spaceRev).sort((a,b) => b[1]-a[1]).slice(0,5);

  const rented = ownerSpaces.filter(s => s.status === 'rented');
  const occ    = ownerSpaces.length ? Math.round((rented.length / ownerSpaces.length) * 100) : 0;

  return {
    from, to, fromDate, toDate,
    totalRevenue, paidTotal, lateTotal,
    filteredPayments, paidPayments, latePayments,
    activeInPeriod, expiredInPeriod, expiringSoon,
    avgRent, monthly, monthKeys, topSpaces,
    rented, occ,
  };
}

/* مخطط الأعمدة الشهري (CSS فقط) */
function _rptBarChart(monthly, monthKeys) {
  if (!monthKeys.length) return `<div style="text-align:center;padding:30px;color:var(--text3);font-size:12px">لا توجد دفعات في هذه الفترة لعرضها</div>`;
  const maxVal = Math.max(...monthKeys.map(k => monthly[k]), 1);
  const fmtK   = v => v >= 1000 ? (v/1000).toFixed(1)+'ك' : String(Math.round(v));
  return `<div class="rpt-chart" dir="ltr">
    ${monthKeys.map(k => {
      const val = monthly[k];
      const pct = Math.max(4, Math.round((val / maxVal) * 100));
      const [yr, mo] = k.split('-');
      const lbl = MONTHS_AR[parseInt(mo,10)-1] || mo;
      return `<div class="rpt-bar-col">
        <div class="rpt-bar-val">${fmtK(val)}</div>
        <div class="rpt-bar-wrap"><div class="rpt-bar-fill" style="height:${pct}%"></div></div>
        <div class="rpt-bar-lbl">${lbl}</div>
      </div>`;
    }).join('')}
  </div>`;
}

/* تفعيل زر الفترة */
function _rptPreset(btn, period) {
  document.querySelectorAll('.rpt-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const customEl = document.getElementById('rpt-custom-row');
  if (period === 'custom') {
    if (customEl) customEl.style.display = 'flex';
    return;
  }
  if (customEl) customEl.style.display = 'none';
  const { from, to } = _rptPeriodRange(period);
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setVal('rpt-from', from);
  setVal('rpt-to',   to);
  _generateReport();
}

/* توليد وعرض التقرير */
function _generateReport() {
  const out   = document.getElementById('rpt-output');
  const from  = document.getElementById('rpt-from')?.value || '';
  const to    = document.getElementById('rpt-to')?.value   || '';
  if (!out) return;

  const d = _buildReportData(from, to);
  const fmt = n => n ? Math.round(n).toLocaleString('ar-EG') + ' ج' : '—';

  /* وصف الفترة */
  const labelFrom = from ? new Date(from).toLocaleDateString('ar-EG-u-nu-latn', { day:'2-digit', month:'long', year:'numeric' }) : '—';
  const labelTo   = to   ? new Date(to).toLocaleDateString('ar-EG-u-nu-latn',   { day:'2-digit', month:'long', year:'numeric' }) : '—';
  const periodLbl = from && to ? `${labelFrom} — ${labelTo}` : 'كل الفترات';

  out.innerHTML = `
    <!-- رأس التقرير -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <div class="section-label">تقرير مالي شامل</div>
        <div style="font-size:18px;font-weight:900;color:var(--text);margin:4px 0">${periodLbl}</div>
        <div style="font-size:11px;color:var(--text3);font-family:'Space Mono',monospace">
          📍 ${currentOwner?.place||'مكاني Spot'} · ${currentOwner?.name||''}
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="_exportReportPDF()" style="background:var(--panel2);font-size:12px">🖨️ طباعة PDF</button>
        <button class="btn" onclick="exportToExcel('full',{from:document.getElementById('rpt-from')?.value,to:document.getElementById('rpt-to')?.value})" style="background:var(--panel2);font-size:12px">📊 Excel</button>
      </div>
    </div>

    <!-- KPIs الإيرادات -->
    <div class="kpi-row" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-ico">💰</div>
        <div class="kpi-label">إجمالي المحصّل</div>
        <div class="kpi-value">${fmt(d.totalRevenue)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">${d.filteredPayments.length} دفعة</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">✅</div>
        <div class="kpi-label">مدفوع بالكامل</div>
        <div class="kpi-value" style="color:var(--green)">${fmt(d.paidTotal)}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">${d.paidPayments.length} دفعة</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">⏰</div>
        <div class="kpi-label">مبالغ متأخرة</div>
        <div class="kpi-value" style="color:${d.lateTotal>0?'var(--red)':'var(--text)'}">${d.lateTotal>0?fmt(d.lateTotal):'لا شيء'}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">${d.latePayments.length} دفعة</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">📄</div>
        <div class="kpi-label">متوسط قيمة العقد</div>
        <div class="kpi-value">${d.avgRent?fmt(d.avgRent):'—'}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:4px">ج/شهر</div>
      </div>
    </div>

    <!-- KPIs العقود والإشغال -->
    <div class="kpi-row" style="margin-bottom:24px">
      <div class="kpi-card">
        <div class="kpi-ico">🏠</div>
        <div class="kpi-label">عقود نشطة في الفترة</div>
        <div class="kpi-value">${d.activeInPeriod.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">📦</div>
        <div class="kpi-label">عقود انتهت</div>
        <div class="kpi-value">${d.expiredInPeriod.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">⚠️</div>
        <div class="kpi-label">تنتهي قريباً</div>
        <div class="kpi-value" style="color:${d.expiringSoon.length?'var(--yellow)':'var(--text)'}">${d.expiringSoon.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-ico">📍</div>
        <div class="kpi-label">نسبة الإشغال</div>
        <div class="kpi-value">${d.occ}%</div>
        <div style="margin-top:7px"><div class="prog-bar"><div class="prog-fill ${d.occ>=70?'green':d.occ>=40?'yellow':'red'}" style="width:${d.occ}%"></div></div></div>
      </div>
    </div>

    <!-- مخطط الإيرادات الشهرية -->
    ${d.monthKeys.length ? `
    <div class="pcard" style="margin-bottom:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">📈 الإيرادات الشهرية</div><div class="pcard-sub">توزيع المدفوعات المستلمة خلال الفترة</div></div>
      </div>
      <div class="pcard-body">
        <div class="rpt-chart-wrap">${_rptBarChart(d.monthly, d.monthKeys)}</div>
      </div>
    </div>` : ''}

    <div class="grid-2">
      <!-- أفضل مساحات حسب الإيرادات -->
      <div class="pcard">
        <div class="pcard-head"><div><div class="pcard-title">🏆 أفضل مساحات بالإيرادات</div></div></div>
        <div class="pcard-body" style="padding:0">
          ${!d.topSpaces.length
            ? `<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px">لا توجد بيانات في هذه الفترة</div>`
            : d.topSpaces.map(([code, amount], i) => {
                const pct = Math.round((amount / d.topSpaces[0][1]) * 100);
                return `<div style="padding:12px 18px;border-bottom:1px solid var(--border)">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                    <span style="font-size:12px;font-weight:700;font-family:'Space Mono',monospace;color:var(--orange)">${code}</span>
                    <span style="font-size:12px;font-family:'Space Mono',monospace;font-weight:700">${Math.round(amount).toLocaleString('ar-EG')} ج</span>
                  </div>
                  <div class="prog-bar"><div class="prog-fill green" style="width:${pct}%"></div></div>
                </div>`;
              }).join('')
          }
        </div>
      </div>

      <!-- العقود النشطة خلال الفترة -->
      <div class="pcard">
        <div class="pcard-head"><div><div class="pcard-title">📄 العقود النشطة في الفترة</div><div class="pcard-sub">${d.activeInPeriod.length} عقد</div></div></div>
        <div class="pcard-body" style="padding:0">
          ${!d.activeInPeriod.length
            ? `<div style="text-align:center;padding:24px;color:var(--text3);font-size:12px">لا توجد عقود في هذه الفترة</div>`
            : d.activeInPeriod.slice(0,8).map(c => {
                const bCls = c.status==='active'?'badge-green':c.status==='expiring'?'badge-yellow':'badge-red';
                const lbl  = c.status==='active'?'سارية':c.status==='expiring'?'تنتهي قريباً':c.status==='renewal'?'للتجديد':'منتهية';
                return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 18px;border-bottom:1px solid var(--border)">
                  <div>
                    <div style="font-size:12px;font-weight:800">${c.tenantName}</div>
                    <div style="font-size:10px;color:var(--text3)">${c.spaceCode}${c.rent?' · '+parseFloat(c.rent).toLocaleString('ar-EG')+' ج/شهر':''}</div>
                  </div>
                  <span class="badge ${bCls}" style="flex-shrink:0">${lbl}</span>
                </div>`;
              }).join('') + (d.activeInPeriod.length>8?`<div style="text-align:center;padding:8px;font-size:11px;color:var(--text3)">+ ${d.activeInPeriod.length-8} عقود أخرى</div>`:'')
          }
        </div>
      </div>
    </div>

    <!-- جدول الدفعات التفصيلي -->
    ${d.filteredPayments.length ? `
    <div class="pcard" style="margin-top:20px">
      <div class="pcard-head">
        <div><div class="pcard-title">💰 تفاصيل الدفعات</div><div class="pcard-sub">جميع الدفعات في الفترة المحددة — ${d.filteredPayments.length} دفعة</div></div>
      </div>
      <div class="pcard-body" style="padding:0">
        <table class="data-table">
          <thead><tr><th>المستأجر</th><th>المساحة</th><th>الشهر</th><th>المبلغ</th><th>الحالة</th><th>تاريخ الاستلام</th><th></th></tr></thead>
          <tbody>
            ${[...d.filteredPayments].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(p => {
              const stMap = {paid:'badge-green مدفوع',partial:'badge-yellow جزئي',late:'badge-red متأخر'};
              const [cls,lbl] = (stMap[p.status]||'badge-blue —').split(' ');
              const [yr,mo] = (p.month||'').split('-');
              const mLbl = mo ? (MONTHS_AR[parseInt(mo,10)-1]||mo)+' '+yr : '—';
              return `<tr>
                <td style="font-weight:700">${p.tenantName}</td>
                <td style="font-family:'Space Mono',monospace;color:var(--orange)">${p.spaceCode}</td>
                <td style="font-size:11px;color:var(--text2)">${mLbl}</td>
                <td style="font-family:'Space Mono',monospace;font-weight:700">${parseFloat(p.amount).toLocaleString('ar-EG')} ج</td>
                <td><span class="badge ${cls}">${lbl}</span></td>
                <td style="font-size:11px;color:var(--text3)">${formatDate(p.paidDate)}</td>
                <td><button class="btn btn-sm" style="font-size:10px;padding:2px 8px" onclick="printInvoice('${p.id}')">🖨️</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : `
    <div class="pcard" style="margin-top:20px">
      <div class="pcard-body" style="text-align:center;padding:40px 20px;color:var(--text3)">
        <div style="font-size:40px;margin-bottom:10px">💸</div>
        <div style="font-size:13px;font-weight:700">لا توجد دفعات مسجّلة في هذه الفترة</div>
      </div>
    </div>`}

    <!-- تذييل التقرير -->
    <div style="margin-top:28px;padding-top:14px;border-top:1px solid var(--border2);display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text3)">
      <span>🏢 مكاني Spot — نظام إدارة المساحات</span>
      <span style="font-family:'Space Mono',monospace">تم الإنشاء: ${new Date().toLocaleDateString('ar-EG')}</span>
    </div>`;
}

/* تصدير التقرير كـ PDF (نافذة طباعة مستقلة) */
function _exportReportPDF() {
  const from = document.getElementById('rpt-from')?.value || '';
  const to   = document.getElementById('rpt-to')?.value   || '';
  const d    = _buildReportData(from, to);
  const fmt  = n => n ? Math.round(n).toLocaleString('ar-EG') + ' ج.م.' : '—';
  const ow   = currentOwner || {};

  const labelFrom = from ? new Date(from).toLocaleDateString('ar-EG-u-nu-latn', { day:'2-digit', month:'long', year:'numeric' }) : '—';
  const labelTo   = to   ? new Date(to).toLocaleDateString('ar-EG-u-nu-latn',   { day:'2-digit', month:'long', year:'numeric' }) : '—';
  const issueDate = new Date().toLocaleDateString('ar-EG-u-nu-latn', { day:'2-digit', month:'long', year:'numeric' });

  const paymentsTableRows = [...d.filteredPayments]
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
    .map(p => {
      const [yr,mo] = (p.month||'').split('-');
      const mLbl = mo ? (MONTHS_AR[parseInt(mo,10)-1]||mo)+' '+yr : '—';
      const stLbl = {paid:'مدفوع',partial:'جزئي',late:'متأخر'}[p.status]||p.status;
      return `<tr>
        <td>${p.tenantName}</td><td>${p.spaceCode}</td><td>${mLbl}</td>
        <td><strong>${parseFloat(p.amount).toLocaleString('ar-EG')}</strong></td>
        <td>${stLbl}</td><td>${formatDate(p.paidDate)}</td>
      </tr>`;
    }).join('');

  const contractsTableRows = d.activeInPeriod.map(c => {
    const stLbl = c.status==='active'?'سارية':c.status==='expiring'?'تنتهي قريباً':c.status==='renewal'?'للتجديد':'منتهية';
    return `<tr>
      <td>${c.tenantName}</td><td>${c.spaceCode}</td>
      <td>${formatDate(c.startDate)}</td><td>${formatDate(c.endDate)}</td>
      <td>${c.rent?parseFloat(c.rent).toLocaleString('ar-EG')+' ج':'—'}</td><td>${stLbl}</td>
    </tr>`;
  }).join('');

  _openPrintWindow(`<!DOCTYPE html><html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>تقرير مالي — مكاني Spot</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Cairo','Segoe UI',Arial,sans-serif; font-size:12px; color:#1a1a1a; background:#fff; padding:30px; }
  .rpt-hdr { display:flex; justify-content:space-between; align-items:center; padding-bottom:18px; border-bottom:3px solid #ff6b00; margin-bottom:22px; }
  .rpt-brand { font-size:22px; font-weight:900; color:#ff6b00; }
  .rpt-brand sub { font-size:11px; color:#666; display:block; font-weight:400; }
  .rpt-title { text-align:left; }
  .rpt-title h1 { font-size:16px; font-weight:900; }
  .rpt-title p  { font-size:11px; color:#666; margin-top:3px; }
  .kpi-strip { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin:18px 0; }
  .kpi-box { border:1px solid #e8e8e8; border-radius:8px; padding:12px 14px; }
  .kpi-box .lbl { font-size:10px; color:#888; margin-bottom:5px; }
  .kpi-box .val { font-size:18px; font-weight:900; color:#ff6b00; font-family:monospace; }
  .kpi-box.green .val { color:#00a651; }
  .kpi-box.red   .val { color:#e53e3e; }
  .kpi-box.blue  .val { color:#2b6cb0; }
  .sec-ttl { font-size:13px; font-weight:900; border-bottom:2px solid #ff6b00; padding-bottom:5px; margin:22px 0 10px; color:#333; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  thead th { background:#ff6b00; color:#fff; padding:7px 10px; text-align:right; font-weight:700; }
  tbody tr:nth-child(even) { background:#fafafa; }
  tbody td { padding:7px 10px; border-bottom:1px solid #f0f0f0; }
  .footer { margin-top:30px; padding-top:12px; border-top:1px solid #e0e0e0; display:flex; justify-content:space-between; font-size:10px; color:#999; }
  @media print {
    body { padding:20px; }
    .rpt-hdr { border-bottom-color:#ff6b00; }
  }
</style></head>
<body>
  <div class="rpt-hdr">
    <div class="rpt-brand">مكاني Spot<sub>نظام إدارة المساحات</sub></div>
    <div class="rpt-title">
      <h1>تقرير مالي شامل</h1>
      <p>الفترة: ${labelFrom} — ${labelTo}</p>
      <p>تاريخ الإصدار: ${issueDate} · ${ow.name||''} · ${ow.place||''}</p>
    </div>
  </div>

  <div class="kpi-strip">
    <div class="kpi-box">
      <div class="lbl">إجمالي الإيرادات</div>
      <div class="val">${fmt(d.totalRevenue)}</div>
    </div>
    <div class="kpi-box green">
      <div class="lbl">مدفوع بالكامل</div>
      <div class="val">${fmt(d.paidTotal)}</div>
    </div>
    <div class="kpi-box${d.lateTotal>0?' red':''}">
      <div class="lbl">مبالغ متأخرة</div>
      <div class="val">${d.lateTotal>0?fmt(d.lateTotal):'لا شيء'}</div>
    </div>
    <div class="kpi-box blue">
      <div class="lbl">متوسط قيمة العقد</div>
      <div class="val">${d.avgRent?fmt(d.avgRent):'—'}</div>
    </div>
  </div>
  <div class="kpi-strip">
    <div class="kpi-box"><div class="lbl">عدد العقود النشطة</div><div class="val" style="color:#333">${d.activeInPeriod.length}</div></div>
    <div class="kpi-box"><div class="lbl">عقود انتهت</div><div class="val" style="color:#333">${d.expiredInPeriod.length}</div></div>
    <div class="kpi-box"><div class="lbl">تنتهي قريباً</div><div class="val" style="color:#333">${d.expiringSoon.length}</div></div>
    <div class="kpi-box"><div class="lbl">نسبة الإشغال</div><div class="val" style="color:#333">${d.occ}%</div></div>
  </div>

  ${d.filteredPayments.length ? `
  <div class="sec-ttl">💰 سجل الدفعات التفصيلي (${d.filteredPayments.length} دفعة)</div>
  <table>
    <thead><tr><th>المستأجر</th><th>المساحة</th><th>الشهر</th><th>المبلغ (ج.م.)</th><th>الحالة</th><th>تاريخ الاستلام</th></tr></thead>
    <tbody>${paymentsTableRows}</tbody>
    <tfoot><tr style="background:#fff7f0">
      <td colspan="3" style="font-weight:900;padding:8px 10px">الإجمالي</td>
      <td style="font-weight:900;color:#ff6b00;font-family:monospace;padding:8px 10px">${Math.round(d.totalRevenue).toLocaleString('ar-EG')} ج.م.</td>
      <td colspan="2"></td>
    </tr></tfoot>
  </table>` : ''}

  ${d.activeInPeriod.length ? `
  <div class="sec-ttl">📄 العقود النشطة خلال الفترة (${d.activeInPeriod.length} عقد)</div>
  <table>
    <thead><tr><th>المستأجر</th><th>المساحة</th><th>بداية العقد</th><th>نهاية العقد</th><th>قيمة الإيجار</th><th>الحالة</th></tr></thead>
    <tbody>${contractsTableRows}</tbody>
  </table>` : ''}

  <div class="footer">
    <span>🏢 مكاني Spot — نظام إدارة المساحات الصغيرة — makanispot.com</span>
    <span>تم الإنشاء آلياً في ${issueDate}</span>
  </div>
<script>window.onload=function(){window.print();}<\/script>
</body></html>`);
}

function renderReports() {
  const container = document.getElementById('reports-content');
  if (!container) return;

  if (!canAccess('pro')) {
    container.innerHTML = planGateHtml('pro');
    return;
  }

  const now = new Date();
  const { from: defFrom, to: defTo } = _rptPeriodRange('month');
  const now_mo  = now.getMonth();
  const now_yr  = now.getFullYear();
  /* تسميات الربع الحالي */
  const qStart  = Math.floor(now_mo/3)*3;
  const qLbl    = `${MONTHS_AR[qStart]} — ${MONTHS_AR[Math.min(qStart+2,11)]}`;

  /* هيكل الصفحة: شريط الفترة + منطقة الإخراج */
  container.innerHTML = `
    <div class="rpt-period-bar">
      <div style="font-size:15px;font-weight:900;color:var(--text);margin-bottom:12px">📊 التقارير المالية</div>
      <div class="rpt-presets">
        <button class="rpt-preset active" onclick="_rptPreset(this,'month')">هذا الشهر</button>
        <button class="rpt-preset" onclick="_rptPreset(this,'quarter')">الربع الحالي</button>
        <button class="rpt-preset" onclick="_rptPreset(this,'half')">النصف الأول</button>
        <button class="rpt-preset" onclick="_rptPreset(this,'year')">هذه السنة</button>
        <button class="rpt-preset" onclick="_rptPreset(this,'custom')">مخصص ▾</button>
      </div>
      <div id="rpt-custom-row" style="display:none;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-top:10px">
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--text3)">من تاريخ</label>
          <input type="date" id="rpt-from" style="font-size:12px;padding:6px 10px">
        </div>
        <div class="form-group" style="margin:0">
          <label style="font-size:11px;color:var(--text3)">إلى تاريخ</label>
          <input type="date" id="rpt-to" style="font-size:12px;padding:6px 10px">
        </div>
        <button class="btn btn-primary btn-sm" onclick="_generateReport()">📊 إنشاء</button>
      </div>
    </div>

    <!-- إخراج التقرير -->
    <div id="rpt-output"></div>

    <!-- تصدير Excel بفلتر -->
    <div class="pcard" style="margin-top:20px;border-color:rgba(255,107,0,0.20)">
      <div class="pcard-head" style="background:rgba(255,107,0,0.03)">
        <div>
          <div class="pcard-title">📊 تصدير Excel</div>
          <div class="pcard-sub">ملف XLSX متعدد الـ sheets — عقود + مدفوعات + مخالفات</div>
        </div>
        <span class="db-tag">XLSX</span>
      </div>
      <div class="pcard-body">
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:14px">
          <div class="form-group" style="margin:0">
            <label style="font-size:11px;color:var(--text3)">من</label>
            <input type="date" id="exp-from" style="font-size:12px;padding:6px 10px">
          </div>
          <div class="form-group" style="margin:0">
            <label style="font-size:11px;color:var(--text3)">إلى</label>
            <input type="date" id="exp-to" style="font-size:12px;padding:6px 10px">
          </div>
          <button class="btn btn-sm" onclick="document.getElementById('exp-from').value='';document.getElementById('exp-to').value=''" style="font-size:11px;color:var(--text3)">✖ مسح</button>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" onclick="exportToExcel('contracts',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);font-size:12px">⬇️ عقود</button>
          <button class="btn" onclick="exportToExcel('payments',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);font-size:12px">⬇️ مدفوعات</button>
          <button class="btn" onclick="exportToExcel('violations',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="background:var(--panel2);font-size:12px">⬇️ مخالفات</button>
          <button class="btn btn-primary" onclick="exportToExcel('full',{from:document.getElementById('exp-from')?.value,to:document.getElementById('exp-to')?.value})" style="font-size:12px">⬇️ تصدير كامل (3 sheets)</button>
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text3)">💡 الفلتر اختياري — بدونه يُصدَّر كل السجلات.</div>
      </div>
    </div>`;

  /* ضبط قيم الحقول المخفية وتوليد التقرير الأولي */
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  /* rpt-from وrpt-to موجودان داخل #rpt-custom-row المخفي — نضيفهما مخفيَّين عبر JS */
  const fromInput = Object.assign(document.createElement('input'), { type:'hidden', id:'rpt-from', value: defFrom });
  const toInput   = Object.assign(document.createElement('input'), { type:'hidden', id:'rpt-to',   value: defTo   });
  container.appendChild(fromInput);
  container.appendChild(toInput);

  _generateReport();
}

/* ── (تم تنظيف الكود القديم لـ renderReports) ── */


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
  'ratings':    'التقييمات والمخالفات',
  'revenue':    'الإدارة المالية',
  'payments':   'الإدارة المالية',
  'violations': 'التقييمات والمخالفات',
  'analytics':  'إحصائيات الأداء',
  'insights':   'الرؤى والتوصيات',
  'reports':    'التقارير الشهرية',
  'add-space':  'إضافة مساحة جديدة',
  'add-bazaar': 'تنظيم بازار',
  'alerts':     'التنبيهات',
  'public-profile': 'البروفايل العام',
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
  if (viewId === 'alerts')        { renderAlerts(); setTimeout(markNotificationsRead, 1500); }
  if (viewId === 'add-bazaar')    renderAddBazaarView();
  if (viewId === 'ratings')       loadOwnerRatings();
  if (viewId === 'bookings')      { loadBookingsRemote().then(renderBookings); }
  if (viewId === 'public-profile') renderProfileView();
  if (viewId === 'analytics')     loadSpaceAnalytics();
  if (viewId === 'add-space')     initAddSpaceForm();
  if (viewId === 'contracts') {
    populateContractSpaceSelect();
    if (_pendingContractFromBooking) {
      _fillContractFromBooking(_pendingContractFromBooking);
      _pendingContractFromBooking = null;
    }
  }
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
/* ══════════════════════════════════════════
   🏢  SPACE LIFECYCLE MANAGEMENT
   Edit · Pause · Resume · Delete
   ══════════════════════════════════════════ */

const SE_AMENITIES = [
  { id:'wifi',    val:'واي فاي',   ico:'📶' },
  { id:'elec',    val:'كهرباء',    ico:'⚡' },
  { id:'sec',     val:'أمن',       ico:'🔒' },
  { id:'clean',   val:'نظافة',     ico:'🧹' },
  { id:'table',   val:'ترابيزات',  ico:'🪑' },
  { id:'storage', val:'مخزن',      ico:'📦' },
  { id:'cam',     val:'كاميرات',   ico:'📷' },
  { id:'ac',      val:'تبريد',     ico:'❄️' },
  { id:'light',   val:'إضاءة',     ico:'💡' },
];

function openSpaceEdit(spaceId) {
  const s = ownerSpacesFull.find(x => x.id === spaceId);
  if (!s) return;
  _editingSpaceId = spaceId;
  _seDelMain      = false;
  _esMainImgUrl   = null;
  _esExtraImgUrls = [...s.extraImages];

  const set = (id, val) => { const el=document.getElementById(id); if(el) el.value=(val??''); };
  const setChk = (id, v) => { const el=document.getElementById(id); if(el) el.checked=!!v; };

  set('se-id',     spaceId);
  set('se-name',   s.name);
  set('se-region', s.region);
  set('se-desc',   s.description);
  set('se-price',  s.minPrice || '');
  set('se-sizes',  s.sizesStr);
  set('se-season', s.season);
  set('se-insight',s.insight);
  set('se-acts',   s.activities.join(' · '));
  setChk('se-all-acts', s.allActs);

  document.getElementById('se-title').textContent = '✏️ تعديل: ' + s.name;

  /* مرافق */
  const amenSet = new Set(s.amenities);
  SE_AMENITIES.forEach(a => {
    const el = document.getElementById('se-amen-' + a.id);
    if (el) el.checked = amenSet.has(a.val);
  });

  /* الصورة الرئيسية */
  _renderSeMainImg(s.imageUrl);

  /* الصور الإضافية */
  _renderSeExtraImgs();

  /* إخفاء رسالة خطأ قديمة */
  const msg = document.getElementById('se-msg'); if(msg) msg.style.display='none';

  const modal = document.getElementById('se-modal');
  if (modal) { modal.style.display='flex'; modal.scrollTop=0; }
}

function _renderSeMainImg(url) {
  const wrap = document.getElementById('se-main-img-wrap');
  if (!wrap) return;
  if (!url) {
    wrap.innerHTML = '<span style="font-size:11px;color:var(--text3)">لا توجد صورة رئيسية حالياً</span>';
  } else {
    const disp = url.replace('_f.webp','_d.webp');
    wrap.innerHTML = `
      <div style="position:relative;display:inline-block">
        <img src="${disp}" style="height:100px;border-radius:8px;object-fit:cover;border:1px solid var(--border2)">
        <button type="button" onclick="_seDeleteMain()"
          style="position:absolute;top:4px;left:4px;background:rgba(220,0,0,0.8);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:22px;text-align:center">✕</button>
      </div>`;
  }
}

function _seDeleteMain() {
  _seDelMain = true;
  _renderSeMainImg(null);
}

function _renderSeExtraImgs() {
  const container = document.getElementById('se-extra-imgs');
  if (!container) return;
  container.innerHTML = _esExtraImgUrls.filter(Boolean).map((url, i) => {
    const disp = url.replace('_f.webp','_d.webp');
    return `<div style="position:relative;flex-shrink:0">
      <img src="${disp}" style="height:80px;width:100px;object-fit:cover;border-radius:7px;border:1px solid var(--border2)">
      <button type="button" onclick="_seDeleteExtra(${i})"
        style="position:absolute;top:3px;left:3px;background:rgba(220,0,0,0.8);color:#fff;border:none;border-radius:50%;width:19px;height:19px;cursor:pointer;font-size:10px;line-height:19px;text-align:center">✕</button>
    </div>`;
  }).join('') || '<span style="font-size:11px;color:var(--text3)">لا توجد صور إضافية</span>';
}

function _seDeleteExtra(idx) {
  _esExtraImgUrls[idx] = null;
  _renderSeExtraImgs();
}

async function handleSeMainImg(input) {
  const file = input.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById('se-main-img-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--orange)">⏳ جاري الرفع…</span>';
  try {
    const sb = getSB();
    const { data:{ session } } = sb ? await sb.auth.getSession() : {data:{session:null}};
    const token  = session?.access_token || SUPABASE_KEY;
    const folder = `owner-spaces/${currentOwner.id}`;
    const [url]  = await uploadImages([file], folder, null, token);
    _esMainImgUrl = url;
    _seDelMain = false;
    _renderSeMainImg(url);
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✅ تم الرفع</span>';
  } catch {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">❌ فشل الرفع</span>';
  }
  input.value = '';
}

async function handleSeExtraImgs(input) {
  const current = _esExtraImgUrls.filter(Boolean).length;
  const files   = Array.from(input.files).slice(0, Math.max(0, 5 - current));
  if (!files.length) return;
  try {
    const sb = getSB();
    const { data:{ session } } = sb ? await sb.auth.getSession() : {data:{session:null}};
    const token  = session?.access_token || SUPABASE_KEY;
    const folder = `owner-spaces/${currentOwner.id}`;
    const urls   = await uploadImages(files, folder, null, token);
    _esExtraImgUrls.push(...urls.filter(Boolean));
    _renderSeExtraImgs();
  } catch { /* silent */ }
  input.value = '';
}

function closeSpaceEdit() {
  const modal = document.getElementById('se-modal');
  if (modal) modal.style.display = 'none';
  _editingSpaceId = null;
}

async function submitSpaceEdit() {
  if (_guardWrite('إضافة مساحة')) return;
  const get    = id => document.getElementById(id)?.value?.trim() || '';
  const getChk = id => !!document.getElementById(id)?.checked;
  const spaceId = get('se-id') || _editingSpaceId;
  if (!spaceId) return;

  const btn = document.getElementById('se-save-btn');
  const msg = document.getElementById('se-msg');
  const showMsg = (type, text) => {
    if (!msg) return;
    msg.className = `alert-item ${type}`;
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">${type==='success'?'✅':'❌'}</span><div class="alert-text"><strong>${text}</strong></div>`;
  };

  const name   = get('se-name');
  const region = get('se-region');
  if (!name || !region) { showMsg('danger', 'اسم المساحة والمنطقة مطلوبان.'); return; }

  const sb = getSB();
  if (!sb || !currentOwner?.id) { showMsg('danger', 'تعذّر الاتصال.'); return; }

  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ…'; }

  /* الصور */
  const origSpace  = ownerSpacesFull.find(x => x.id === spaceId);
  const finalMain  = _seDelMain ? null : (_esMainImgUrl || origSpace?.imageUrl || null);
  const finalExtra = _esExtraImgUrls.filter(Boolean);

  /* المرافق */
  const amenArr = SE_AMENITIES.filter(a => document.getElementById('se-amen-'+a.id)?.checked).map(a => a.val);
  const customAmen = get('se-amen-custom');
  if (customAmen) amenArr.push(customAmen);

  const actsRaw = get('se-acts');
  const actsArr = actsRaw ? actsRaw.split('·').map(x=>x.trim()).filter(Boolean) : [];

  const payload = {
    name:         name,
    region:       region,
    description:  get('se-desc')   || null,
    min_price:    parseInt(get('se-price')) || 0,
    sizes_prices: get('se-sizes')  || null,
    season:       get('se-season') || null,
    insight:      get('se-insight')|| null,
    activities:   actsArr,
    all_acts:     getChk('se-all-acts'),
    amenities:    amenArr,
    image_url:    finalMain,
    extra_images: finalExtra,
  };

  try {
    const { error } = await sb.from('spaces').update(payload).eq('id', spaceId).eq('owner_id', currentOwner.id);
    if (error) throw error;
    showMsg('success', 'تم حفظ التعديلات ✅');
    await loadOwnerData();
    setTimeout(() => closeSpaceEdit(), 900);
  } catch (err) {
    showMsg('danger', 'خطأ في الحفظ: ' + err.message);
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='💾 حفظ التعديلات'; }
  }
}

/* ── إيقاف / إعادة تفعيل المساحة ── */
async function togglePauseSpace(spaceId) {
  const s  = ownerSpacesFull.find(x => x.id === spaceId);
  if (!s) return;
  const willPause = s.isActive;
  const label     = willPause ? 'إيقاف مؤقت' : 'إعادة التفعيل';
  const confirm   = willPause
    ? `سيُخفى إعلان المساحة "${s.name}" مؤقتاً من الموقع. يمكنك إعادة تفعيله في أي وقت.\nهل تريد المتابعة؟`
    : `سيعود إعلان "${s.name}" للظهور على الموقع.\nهل تريد المتابعة؟`;
  if (!window.confirm(confirm)) return;

  const sb = getSB();
  if (!sb || !currentOwner?.id) { alert('تعذّر الاتصال.'); return; }

  const { error } = await sb.from('spaces')
    .update({ is_active: !willPause })
    .eq('id', spaceId).eq('owner_id', currentOwner.id);

  if (error) { alert('تعذّر ' + label + ': ' + error.message); return; }
  await loadOwnerData();
}

/* ── حذف نهائي ── */
async function deleteSpaceConfirmed(spaceId) {
  const s = ownerSpacesFull.find(x => x.id === spaceId);
  if (!s) return;
  const ok = window.confirm(
    `⚠️ حذف نهائي: "${s.name}"\n\nسيتم حذف المساحة وجميع وحداتها من قاعدة البيانات.\nلا يمكن استعادتها بعد الحذف.\n\nهل أنت متأكد تماماً؟`
  );
  if (!ok) return;

  const sb = getSB();
  if (!sb || !currentOwner?.id) { alert('تعذّر الاتصال.'); return; }

  /* حذف الوحدات أولاً ثم المساحة */
  await sb.from('space_units').delete().eq('space_id', spaceId);
  const { error } = await sb.from('spaces').delete().eq('id', spaceId).eq('owner_id', currentOwner.id);
  if (error) { alert('تعذّر الحذف: ' + error.message); return; }
  await loadOwnerData();
}

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
              <div class="pcard-title" style="color:var(--orange)">📋 المساحات المضافة حديثاً (${ownerPendingSpaces.length})</div>
              <div class="pcard-sub">المساحات المنشورة تظهر للزوار مباشرةً — يمكن لفريق مكاني إيقافها عند الحاجة</div>
            </div>
          </div>
          <div class="pcard-body" style="padding:0">
            <table class="data-table">
              <thead><tr><th>اسم المساحة</th><th>النوع</th><th>المنطقة</th><th>الأحجام</th><th>السعر</th><th>الوحدات</th><th>الحالة</th><th>تاريخ الإضافة</th><th></th></tr></thead>
              <tbody>
                ${ownerPendingSpaces.map(p => {
                  const typeLabels = { mall:'🏬 مول', club:'🏊 نادي', school:'🏫 مدرسة', hotel:'🏨 فندق' };
                  const sentDate   = p.submittedAt ? new Date(p.submittedAt).toLocaleDateString('ar-EG') : '—';
                  const isRejected = p.status === 'rejected';
                  const isActive   = p.status === 'active';
                  const statusBadge = isRejected
                    ? `<span class="badge badge-red">❌ مرفوض</span>`
                    : isActive
                    ? `<span class="badge badge-green">✅ منشور</span>`
                    : `<span class="badge badge-yellow">⏳ قيد المراجعة</span>`;
                  return `<tr style="background:${isRejected ? 'rgba(255,77,77,0.03)' : isActive ? 'rgba(0,200,100,0.02)' : 'rgba(255,184,0,0.03)'}">
                    <td style="font-weight:700">${p.name}</td>
                    <td>${typeLabels[p.type] || p.type || '—'}</td>
                    <td>${p.loc}</td>
                    <td style="font-size:11px;color:var(--text3)">${p.sizes || '—'}</td>
                    <td style="font-family:'Space Mono',monospace">${p.price ? p.price.toLocaleString('ar-EG')+' ج' : '—'}</td>
                    <td style="text-align:center">${p.subCount > 0 ? `<span class="badge badge-blue">${p.subCount} وحدة</span>` : '—'}</td>
                    <td>${statusBadge}</td>
                    <td style="font-size:11px;color:var(--text3)">${sentDate}</td>
                    <td>${!isRejected ? `<button class="btn btn-sm" style="background:none;border:1px solid var(--red);color:var(--red);font-size:11px" onclick="removePendingSpace('${p.id}')">حذف</button>` : ''}</td>
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

  const spacesCont     = document.getElementById('spaces-container');
  const abandonedSec   = document.getElementById('abandoned-section');
  const abandonedTbody = document.getElementById('abandoned-tbody');

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

  if (!spacesCont) return;

  /* ── بطاقات المساحات ── */
  if (!ownerSpacesFull.length) {
    spacesCont.innerHTML = `<div style="text-align:center;color:var(--text3);padding:40px;font-size:13px">
      لم تُضَف أي مساحات بعد —
      <button class="btn btn-primary btn-sm" onclick="goTo('add-space',document.querySelector('[data-view=add-space]'))">أضف الآن ➕</button>
    </div>`;
    return;
  }

  const unitStMap = {
    rented:      { cls:'badge-green',  lbl:'مؤجّرة' },
    available:   { cls:'badge-yellow', lbl:'متاحة' },
    reserved:    { cls:'badge-blue',   lbl:'محجوزة' },
    maintenance: { cls:'badge-red',    lbl:'صيانة' },
  };

  spacesCont.innerHTML = ownerSpacesFull.map(space => {
    const isPaused    = !space.isActive;
    const imgThumb    = space.imageUrl
      ? `<img src="${space.imageUrl.replace('_f.webp','_d.webp')}" class="sc-thumb">`
      : `<div class="sc-thumb-ph">${space.iconEmoji || '🏬'}</div>`;
    const pauseBadge  = isPaused
      ? `<span class="badge badge-red" style="font-size:10px">⏸ موقوفة</span>`
      : `<span class="badge badge-green" style="font-size:10px">● نشطة</span>`;
    const pauseBtn = isPaused
      ? `<button class="btn btn-sm sc-btn-resume" onclick="togglePauseSpace('${space.id}')">▶ إعادة التفعيل</button>`
      : `<button class="btn btn-sm sc-btn-pause"  onclick="togglePauseSpace('${space.id}')">⏸ إيقاف مؤقت</button>`;

    /* وحدات المساحة */
    const unitsHtml = space.units.length ? `
      <div class="sc-units-wrap">
        <table class="data-table" style="margin:0">
          <thead><tr><th>الكود</th><th>الحجم</th><th>السعر/شهر</th><th>الحالة</th><th></th></tr></thead>
          <tbody>${space.units.map(u => {
            const st = unitStMap[u.status] || { cls:'badge-blue', lbl:u.status };
            const isAbandonedUnit = ownerSpaces.find(os => os.unitDbId===u.id)?.daysEmpty >= ABANDONED_THRESHOLD;
            return `<tr ${isPaused?'style="opacity:.6"':''}>
              <td style="font-family:'Space Mono',monospace;color:${isAbandonedUnit?'var(--red)':'var(--orange)'};font-weight:700">${u.unit_id||'—'}</td>
              <td style="font-size:12px">${u.size||'—'}</td>
              <td style="font-family:'Space Mono',monospace">${u.price?u.price.toLocaleString('ar-EG')+' ج':'—'}</td>
              <td><span class="badge ${st.cls}">${st.lbl}</span>${isAbandonedUnit?`<span style="font-size:10px;color:var(--red);margin-right:4px">⚠</span>`:''}</td>
              <td>${u.id?`<button class="btn btn-sm" style="font-size:11px;padding:2px 7px" onclick="openUnitEdit('${u.id}')">✏️</button>`:''}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>` : `<div class="sc-no-units">لا توجد وحدات مضافة لهذه المساحة بعد</div>`;

    /* ── mini analytics strip ── */
    const an = spaceAnalyticsData.find(r => r.space_id === space.id);
    const anHtml = an ? (() => {
      const v = Number(an.views_count || 0);
      const c = Number(an.clicks_count || 0);
      const b = Number(an.bookings_count || 0);
      const conv = Number(an.conversion_rate || 0);
      const perf = _perfScore(v, c, b);
      const convCol = conv >= 2 ? 'var(--green)' : conv >= 1 ? 'var(--yellow)' : 'var(--text3)';
      return `<div class="sc-analytics-strip">
        <span class="sc-an-item">👁️ <b>${v.toLocaleString('ar-EG')}</b> مشاهدة</span>
        <span class="sc-an-sep">·</span>
        <span class="sc-an-item">🔍 <b>${c.toLocaleString('ar-EG')}</b> ضغطة</span>
        <span class="sc-an-sep">·</span>
        <span class="sc-an-item">📬 <b>${b}</b> حجز</span>
        <span class="sc-an-sep">·</span>
        <span class="sc-an-item" style="color:${convCol}">📈 <b>${conv.toFixed(1)}%</b> تحويل</span>
        ${perf ? `<span class="sc-an-sep">·</span><span class="badge ${perf.cls}" style="font-size:10px;padding:2px 7px">${perf.ico} ${perf.lbl}</span>` : ''}
        <button class="btn btn-sm" style="margin-right:auto;font-size:10px;padding:2px 8px;background:none;border:1px solid var(--border2);color:var(--orange)" onclick="_goToAnalytics()">عرض التفاصيل →</button>
      </div>`;
    })() : '';

    return `
      <div class="space-card${isPaused?' space-card--paused':''}">
        <div class="sc-header">
          <div class="sc-meta">
            ${imgThumb}
            <div class="sc-info">
              <div class="sc-name">${space.name}</div>
              <div class="sc-region">📍 ${space.region}${space.type?' · '+space.type:''}</div>
              <div class="sc-stats">
                ${pauseBadge}
                <span style="font-size:11px;color:var(--text3)">${space.units.length} وحدة${space.minPrice?` · من ${space.minPrice.toLocaleString('ar-EG')} ج/شهر`:''}</span>
              </div>
            </div>
          </div>
          <div class="sc-actions">
            <button class="btn btn-sm sc-btn-edit" onclick="openSpaceEdit('${space.id}')">✏️ تعديل</button>
            ${pauseBtn}
            <button class="btn btn-sm sc-btn-delete" onclick="deleteSpaceConfirmed('${space.id}')">🗑️ حذف</button>
          </div>
        </div>
        ${anHtml}
        ${unitsHtml}
      </div>`;
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
function _renderContractCard(c, isArchived) {
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

  /* للأرشيف: مجموع ما استُوفي من دفعات */
  const totalPaid = isArchived
    ? paymentsList.filter(p => p.contractId === c.id && p.status === 'paid')
        .reduce((s, p) => s + parseFloat(p.amount || 0), 0)
    : 0;
  const durationDays = Math.max(0, Math.ceil((new Date(c.endDate) - new Date(c.startDate)) / 86400000));

  /* زر التجديد — يظهر فقط لعقود تنتهي قريباً أو بحاجة للتجديد */
  const renewBtn = (c.status === 'expiring' || c.status === 'renewal') ? `
    <button class="btn btn-sm btn-renew" onclick="renewContract('${c.id}')">🔄 تجديد العقد</button>` : '';

  const displayPhone     = c.tenantUserId ? (c.livePhone || c.tenantPhone) : c.tenantPhone;
  const phoneIsUpdated   = c.tenantUserId && c.livePhone && c.livePhone !== c.tenantPhone;
  const displayEntity    = c.tenantUserId ? c.liveEntityName : '';

  return `
    <div class="contract-card${isArchived ? ' ccard-archived' : ''}" id="ccard-${c.id}">
      <div class="contract-head">
        <div>
          <div class="contract-name">
            ${c.tenantName}
            ${displayEntity ? `<span class="ccard-entity">· ${displayEntity}</span>` : ''}
          </div>
          <div class="contract-space">📍 ${c.spaceCode}${c.activity ? ' · ' + c.activity : ''}</div>
          ${displayPhone ? `<div class="ccard-phone">
            📞 ${displayPhone}
            ${phoneIsUpdated ? '<span class="ccard-live-tag">مُحدَّث</span>' : ''}
          </div>` : ''}
        </div>
        <div style="text-align:left">
          <span class="badge ${bCls}">${statusLbl}</span>
          ${c.tenantUserId ? `<div class="ccard-linked-badge">🔗 مرتبط</div>` : ''}
          <div style="font-size:10px;color:var(--text3);margin-top:4px;font-family:'Space Mono',monospace">
            ${c.daysLeft > 0 ? c.daysLeft + ' يوم متبقي' : isArchived ? 'منتهي' : 'منتهي'}
          </div>
        </div>
      </div>
      <div class="contract-meta">
        <span>📅 البداية: ${formatDate(c.startDate)}</span>
        <span>📅 النهاية: ${formatDate(c.endDate)}</span>
        ${isArchived
          ? `<span>⏱️ مدة: ${durationDays} يوم</span><span>💰 مستوفى: ${totalPaid.toLocaleString('ar-EG')} ج</span>`
          : `<span>💰 ${c.rent ? c.rent.toLocaleString('ar-EG') : '—'} ج/شهر</span>${avgScore ? `<span>⭐ تقييم: ${avgScore}/10</span>` : ''}`
        }
      </div>
      ${!isArchived ? `<div class="contract-bar">
        <div class="contract-bar-top">
          <span>تقدم العقد</span>
          <span style="font-family:'Space Mono',monospace">${progPct}%</span>
        </div>
        <div class="prog-bar"><div class="prog-fill ${fCls}" style="width:${progPct}%"></div></div>
      </div>` : ''}
      ${c.notes ? `<div style="font-size:11px;color:var(--text3);margin-top:8px;padding:8px 10px;background:var(--bg3);border-radius:6px">📝 ${c.notes}</div>` : ''}
      ${_depositBadge(c)}
      ${_depositSettlingId.has(c.id) ? _depositSettlementForm(c) : ''}
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        ${renewBtn}
        <button class="btn btn-sm" onclick="startEditContract('${c.id}')">✏️ تعديل</button>
        <button class="btn btn-sm" style="color:var(--orange);border-color:rgba(255,107,0,0.25)" onclick="printContractStatement('${c.id}')">📋 كشف</button>
        <button class="btn btn-sm" style="color:var(--red);border-color:rgba(255,77,77,0.25)" onclick="deleteContract('${c.id}')">🗑️ حذف</button>
      </div>
    </div>`;
}

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

  const activeContracts  = contractsList.filter(c => c.status !== 'expired');
  const expiredContracts = contractsList.filter(c => c.status === 'expired');

  const activeHtml = activeContracts.map(c => _renderContractCard(c, false)).join('');

  const archiveHtml = expiredContracts.length ? `
    <div class="contract-archive-section" id="contract-archive">
      <div class="archive-toggle" onclick="document.getElementById('contract-archive').classList.toggle('open')">
        <span style="font-size:16px">🗃️</span>
        <span style="font-weight:700;color:var(--text2)">أرشيف العقود المنتهية</span>
        <span class="badge badge-blue" style="margin-right:4px">${expiredContracts.length}</span>
        <span class="archive-chevron" style="margin-right:auto;color:var(--text3);font-size:12px">▾</span>
      </div>
      <div class="archive-body">
        ${expiredContracts.map(c => _renderContractCard(c, true)).join('')}
      </div>
    </div>` : '';

  cont.innerHTML = activeHtml + archiveHtml;
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

  /* 📬 طلبات حجز جديدة + قائمة انتظار — تنبيهات الحجوزات */
  const newBookings = bookingsList.filter(b =>
    !b.isWaitlist && (b.status === 'pending' || b.status === 'viewing_pending')).length;
  const waitingCount = bookingsList.filter(b => b.isWaitlist).length;
  /* المفتاح يحمل العدد ليُعاد ظهور التنبيه تلقائياً عند وصول طلبات جديدة */
  if (newBookings > 0) {
    push({
      key: 'bk-pending:' + newBookings, type: 'info', ico: '📬',
      title: `${newBookings} ${newBookings === 1 ? 'طلب حجز جديد' : 'طلبات حجز جديدة'} بانتظار قرارك`,
      body:  'راجعها في صندوق طلبات الحجز — اقبل أو ارفض أو انقلها لقائمة الانتظار.',
      action: 'goToBookingsView()',
    });
  }
  if (waitingCount > 0) {
    push({
      key: 'bk-waitlist:' + waitingCount, type: 'warning', ico: '⏳',
      title: `${waitingCount} طلب في قائمة الانتظار`,
      body:  'مهتمون بمساحاتك ينتظرون توفّر وحدة — تابعهم من تبويب قائمة الانتظار.',
      action: 'goToBookingsView()',
    });
  }

  /* لا مساحات مضافة */
  if (!ownerSpaces.length && !dismissed.has('no-spaces')) {
    out.push({ key: 'no-spaces', type: 'info', ico: '💡', title: 'لم تُضَف مساحات بعد', body: 'ابدأ بإضافة مساحاتك ليراها المستأجرون على المنصة.' });
  }
  return out;
}

/* انتقال سريع إلى صندوق طلبات الحجز (من التنبيهات) */
function goToBookingsView() {
  const nav = document.querySelector('[onclick*="bookings"]');
  goTo('bookings', nav);
}

/* انتقال سريع إلى إحصائيات الأداء */
function _goToAnalytics() {
  const nav = Array.from(document.querySelectorAll('.nav-item')).find(el => el.textContent.includes('إحصائيات'));
  goTo('analytics', nav || null);
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
    `<button title="حذف التنبيه" onclick="event.stopPropagation();${handler}" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;line-height:1;padding:2px 6px;margin-inline-start:auto;flex-shrink:0">✕</button>`;

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
    <div class="alert-item ${a.type}" style="display:flex;align-items:flex-start;gap:10px${a.action ? ';cursor:pointer' : ''}"${a.action ? ` onclick="${a.action}"` : ''}>
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
    try { await sb.from('notifications').delete().eq('id', nid).eq('user_id', currentOwner.id); }
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
      try { await sb.from('notifications').delete().in('id', ids).eq('user_id', currentOwner.id); }
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
  /* شريط تحليلات المهتمين + دليل Workflow + التبويبات */
  const head = _bkWorkflowGuide() + _bkInterestPanel() + tabsHtml;

  if (!bookingsList.length) {
    wrap.innerHTML = `
      ${head}
      <div class="empty-hint">
        <div style="font-size:36px;margin-bottom:12px">📬</div>
        <div style="font-weight:700;margin-bottom:6px">لا توجد طلبات حجز حالياً</div>
        <div style="font-size:12px;color:var(--text3)">عندما يحجز أحدهم مساحتك من الموقع ستجد الطلب هنا فوراً.</div>
      </div>`;
    return;
  }

  /* بطاقات قائمة الانتظار لها شكل وإجراءات مختلفة */
  if (activeFilter === 'waitlist') {
    wrap.innerHTML = head + renderWaitlistCards(waitlist);
    return;
  }

  const rows = filtered.length
    ? filtered.map(b => {
        const st = statusMap[b.status] || { lbl: b.status, cls: 'badge-gray' };
        const isPending = b.status === 'pending' || b.status === 'viewing_pending';
        const dateStr = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' }) : '—';
        const startStr = b.startDate || '—';
        return `
        <div class="bk-card${isPending && _confirmingReject.has(b.id) ? ' bk-card--rejecting' : ''}">
          <div class="bk-card-head">
            <div>
              <div class="bk-card-space">${_escBk(b.spaceName)}</div>
              <div class="bk-card-loc">📍 ${_escBk(b.spaceLoc)} ${b.size !== '—' ? '· ' + _escBk(b.size) : ''}</div>
            </div>
            <span class="badge ${st.cls}">${st.lbl}</span>
          </div>
          ${_bkBookerBlock(b)}
          ${_bkContactStrip(b)}
          <div class="bk-card-body">
            <div class="bk-info-grid">
              <span class="bk-lbl">🏷️ النشاط</span><span class="bk-val">${_escBk(b.activity)}</span>
              <span class="bk-lbl">📅 التاريخ المطلوب</span><span class="bk-val">${_escBk(startStr)}</span>
              <span class="bk-lbl">⏱ المدة</span><span class="bk-val">${_escBk(b.duration)}</span>
              <span class="bk-lbl">💰 السعر</span><span class="bk-val">${_escBk(b.price)}</span>
              ${b.notes ? `<span class="bk-lbl">📝 ملاحظات</span><span class="bk-val">${_escBk(b.notes)}</span>` : ''}
              <span class="bk-lbl">🕐 استلمنا الطلب</span><span class="bk-val">${dateStr}</span>
            </div>
          </div>

          <!-- أزرار الإجراءات — تُخفى عند فتح فورم الرفض للطلبات المعلقة -->
          ${!(isPending && _confirmingReject.has(b.id)) ? `
          <div class="bk-card-actions">
            ${isPending ? `
              <button class="btn btn-primary btn-sm" onclick="acceptBooking('${b.id}')">✅ قبول</button>
              <button class="btn btn-sm bk-btn-reject" onclick="rejectBooking('${b.id}')">❌ رفض</button>
              <button class="btn btn-ghost btn-sm" onclick="setBookingWaitlist('${b.id}', true)" title="نقل الطلب إلى قائمة الانتظار">⏳ قائمة الانتظار</button>` : ''}
            ${b.status === 'confirmed' ? `
              <button class="btn btn-primary btn-sm" onclick="convertBookingToContract('${b.id}')"
                      style="background:linear-gradient(135deg,var(--orange),#e8650a);border:none;box-shadow:0 2px 10px rgba(255,107,0,0.30)">
                📄 إنشاء عقد
              </button>
              ${_confirmingReject.has(b.id) ? `
                <span style="display:flex;align-items:center;gap:6px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.25);border-radius:var(--r);padding:4px 8px">
                  <span style="font-size:11px;color:var(--red,#e53e3e)">تأكيد إلغاء الحجز المؤكد؟</span>
                  <button class="btn btn-sm" style="background:var(--red,#e53e3e);color:#fff;border:none;font-size:11px;padding:3px 10px" onclick="rejectBooking('${b.id}')">نعم، ألغِ</button>
                  <button class="btn btn-ghost btn-sm" style="font-size:11px;padding:3px 8px" onclick="_cancelReject('${b.id}')">لا</button>
                </span>` : `
                <button class="btn btn-ghost btn-sm" style="font-size:11px" onclick="rejectBooking('${b.id}')">🚫 إلغاء الحجز</button>`}` : ''}
          </div>` : ''}

          <!-- فورم سبب الرفض — يظهر فقط للحجوزات المعلقة عند الضغط على "رفض" -->
          ${isPending && _confirmingReject.has(b.id) ? _bkRejectForm(b.id) : ''}
        </div>`;
      }).join('')
    : `<div class="empty-hint" style="padding:24px">لا توجد طلبات بهذا الفلتر.</div>`;

  /* زر تحميل المزيد — يظهر فقط لو في حجوزات إضافية من الخادم (#11) */
  const loadMoreHtml = bookingsHasMore && activeFilter !== 'waitlist'
    ? `<div style="text-align:center;padding:16px 0">
         <button id="bk-load-more-btn" class="btn" style="min-width:220px"
                 onclick="loadMoreBookings()">
           ⬇ تحميل ${BOOKINGS_BATCH} طلب إضافي
         </button>
       </div>`
    : '';
  wrap.innerHTML = head + `<div class="bk-cards">${rows}</div>` + loadMoreHtml;
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
  /* رأس قائمة الانتظار: عدد المهتمين الكلي */
  const head = `<div class="bk-wl-banner">⏳ <b>${list.length}</b> ${list.length === 1 ? 'طلب' : 'طلب'} في قائمة الانتظار — رتّبهم حسب الأولوية وتواصل معهم فور توفّر وحدة.</div>`;
  const cards = list.map((b, i) => {
    const dateStr  = b.createdAt ? new Date(b.createdAt).toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const phoneOk  = b.bookerPhone && b.bookerPhone !== '—';
    return `
    <div class="bk-card bk-card--wl">
      <div class="bk-card-head">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="bk-wl-order" title="ترتيب الطلب في الانتظار">#${i + 1}</span>
          <div>
            <div class="bk-card-space">${_escBk(b.spaceName)}</div>
            <div class="bk-card-loc">📍 ${_escBk(b.spaceLoc)} ${b.size !== '—' ? '· ' + _escBk(b.size) : ''}</div>
          </div>
        </div>
        <span class="badge badge-yellow">⏳ قائمة انتظار</span>
      </div>
      ${_bkBookerBlock(b)}
      <div class="bk-card-body">
        <div class="bk-info-grid">
          <span class="bk-lbl">📞 الهاتف</span><span class="bk-val">${phoneOk ? `<a href="tel:${_escBk(b.bookerPhone)}" style="color:var(--orange)">${_escBk(b.bookerPhone)}</a>` : '—'}</span>
          <span class="bk-lbl">🏷️ النشاط</span><span class="bk-val">${_escBk(b.activity)}</span>
          ${b.notes ? `<span class="bk-lbl">📝 ملاحظات</span><span class="bk-val">${_escBk(b.notes)}</span>` : ''}
          <span class="bk-lbl">🕐 انضم بتاريخ</span><span class="bk-val">${dateStr}</span>
        </div>
      </div>
      <div class="bk-card-actions">
        <button class="btn btn-primary btn-sm" onclick="approveWaitlist('${b.id}')" title="تأكيد توفّر وحدة وقبول الطلب">✅ توفّرت وحدة — قبول</button>
        <button class="btn btn-ghost btn-sm" onclick="promoteWaitlist('${b.id}')" title="إنشاء عقد مباشرة">📄 تحويل لعقد</button>
        <button class="btn btn-ghost btn-sm" onclick="setBookingWaitlist('${b.id}', false)" title="إرجاع الطلب إلى الطلبات المعلّقة">↩ إرجاع للطلبات</button>
        <button class="btn btn-sm bk-btn-reject" onclick="rejectWaitlist('${b.id}')">❌ إزالة</button>
        ${phoneOk ? `<a href="https://wa.me/2${b.bookerPhone.replace(/\D/g,'')}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm" style="text-decoration:none">💬 واتساب</a>` : ''}
      </div>
    </div>`;
  }).join('');
  return head + `<div class="bk-cards">${cards}</div>`;
}

/* مساعد escape لـ bookings */
function _escBk(str) {
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* صياغة «عضو منذ …» بالعربية من تاريخ التسجيل */
function _sinceLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 0) return '';
  if (days < 7)  return 'هذا الأسبوع';
  if (days < 30) return 'منذ ' + Math.max(1, Math.floor(days / 7)) + (Math.floor(days / 7) <= 1 ? ' أسبوع' : ' أسابيع');
  const months = Math.floor(days / 30);
  if (months < 12) return 'منذ ' + (months === 1 ? 'شهر' : months === 2 ? 'شهرين' : months + ' شهور');
  const years = Math.floor(months / 12);
  return 'منذ ' + (years === 1 ? 'سنة' : years === 2 ? 'سنتين' : years + ' سنوات');
}

/* بطاقة هوية مقدّم الطلب (الأفاتار + البراند + نوع النشاط + المدينة + زر البروفايل) */
function _bkBookerBlock(b) {
  const nameClean = (b.bookerName && b.bookerName !== '—') ? b.bookerName.trim() : '';
  const initial   = nameClean ? nameClean[0] : '👤';
  const avatar = b.bookerAvatar
    ? `<div class="bk-avatar" style="background-image:url('${_escBk(b.bookerAvatar)}')"></div>`
    : `<div class="bk-avatar bk-avatar--ph">${_escBk(initial)}</div>`;
  const verified = b.bookerVerified ? ` <span class="bk-verified" title="حساب موثّق">✔</span>` : '';

  const metaParts = [];
  if (b.bookerEntityType) metaParts.push('🏷️ ' + _escBk(b.bookerEntityType));
  if (b.bookerCity)       metaParts.push('📍 ' + _escBk(b.bookerCity));
  const since = _sinceLabel(b.bookerCreatedAt);
  if (since) metaParts.push('🗓 عضو ' + since);
  const meta = metaParts.length
    ? `<div class="bk-booker-meta">${metaParts.join(' · ')}</div>`
    : `<div class="bk-booker-meta" style="color:var(--text3)">مستخدم على المنصة</div>`;

  const viewBtn = (b.hasProfile && b.userId)
    ? `<button class="bk-profile-btn" onclick="openBookerProfile('${b.userId}')" title="عرض ملف مقدّم الطلب">عرض البروفايل ↗</button>`
    : '';

  const clickAttr = (b.hasProfile && b.userId)
    ? ` style="cursor:pointer" onclick="openBookerProfile('${b.userId}')" title="عرض ملف مقدّم الطلب"`
    : '';

  return `
    <div class="bk-booker">
      <div${clickAttr}>${avatar}</div>
      <div class="bk-booker-id">
        <div class="bk-booker-name"${clickAttr}>${_escBk(b.bookerName)}${verified}</div>
        ${meta}
      </div>
      ${viewBtn}
    </div>`;
}

/* دليل Workflow للحجوزات — قابل للطي */
function _bkWorkflowGuide() {
  const steps = [
    { num:'1', title:'طلب يصلك',            sub:'المستأجر يقدم طلباً من الموقع',                   hi: false },
    { num:'2', title:'تواصل خارجياً',        sub:'اتصل أو راسل بالواتساب من البيانات في البطاقة',   hi: true  },
    { num:'3', title:'اتفق على الشروط',      sub:'ناقش السعر والتفاصيل خارج المنصة',                hi: false },
    { num:'4', title:'قبول أو رفض',          sub:'حدّث حالة الطلب داخل اللوحة',                     hi: false },
    { num:'5', title:'وثّق العقد',           sub:'بعد التأكيد — أنشئ سجل عقد داخل النظام',          hi: true  },
  ];
  const stepsHtml = steps.map((s, i) => `
    <div class="wf-step${s.hi ? ' wf-highlight' : ''}">
      <div class="wf-step-inner">
        <div class="wf-step-num">${s.num}</div>
        <div class="wf-step-title">${s.title}</div>
        <div class="wf-step-sub">${s.sub}</div>
      </div>
      ${i < steps.length - 1 ? '<div class="wf-arrow"></div>' : ''}
    </div>`).join('');

  return `
    <details class="bk-workflow-guide">
      <summary>
        <span>🗺️</span>
        <span>كيف يعمل نظام الحجز؟</span>
        <span style="margin-right:auto;font-size:10px;color:var(--text3);font-weight:400">اضغط للعرض</span>
        <span style="font-size:10px;color:var(--text3)">▾</span>
      </summary>
      <div class="wf-body">
        <div class="wf-steps">${stepsHtml}</div>
        <div class="wf-note">
          💡 <strong>التواصل يتم خارج المنصة</strong> — عبر الهاتف أو الواتساب أو البريد.
          بيانات التواصل موجودة في كل بطاقة حجز مباشرةً.
          المنصة تُوثّق الاتفاق فقط في قسم <strong>العقود</strong>.
        </div>
      </div>
    </details>`;
}

/* شريط التواصل الخارجي — يظهر في كل بطاقة حجز */
function _bkContactStrip(b) {
  const hasPhone = b.bookerPhone && b.bookerPhone !== '—';
  const hasEmail = b.bookerEmail && b.bookerEmail !== '—';
  if (!hasPhone && !hasEmail) return '';

  const phoneClean = hasPhone ? b.bookerPhone.replace(/\D/g, '') : '';
  const phoneDisplay = hasPhone ? b.bookerPhone : '';
  const emailDisplay = hasEmail ? b.bookerEmail : '';

  const copyBtn = (text) =>
    `<button class="bk-contact-btn bk-contact-btn--copy" title="نسخ" data-copy="${_escBk(text)}"
       onclick="navigator.clipboard?.writeText(this.dataset.copy);this.textContent='✔';setTimeout(()=>this.textContent='📋',1200)">📋</button>`;

  return `
    <div class="bk-contact-strip">
      <span class="bk-contact-label">تواصل مع المستأجر خارج المنصة</span>
      <div class="bk-contact-actions">
        ${hasPhone ? `
          <a href="tel:${_escBk(b.bookerPhone)}" class="bk-contact-btn" title="اتصال هاتفي">📞 ${_escBk(phoneDisplay)}</a>
          <a href="https://wa.me/2${phoneClean}" target="_blank" rel="noopener" class="bk-contact-btn bk-contact-btn--wa">💬 واتساب</a>
          ${copyBtn(phoneDisplay)}` : ''}
        ${hasEmail ? `
          <a href="mailto:${_escBk(b.bookerEmail)}" class="bk-contact-btn bk-contact-btn--mail" title="إرسال إيميل">📧 ${_escBk(emailDisplay)}</a>
          ${copyBtn(emailDisplay)}` : ''}
      </div>
    </div>`;
}

/* فتح البروفايل العام لمقدّم الطلب في تبويب جديد */
function openBookerProfile(userId) {
  if (!userId) return;
  window.open(`/?p=owner-profile&id=${encodeURIComponent(userId)}`, '_blank', 'noopener');
}

/* شريط «المهتمون بمساحاتك» — يعرض عدد الطلبات/المهتمين وقائمة الانتظار لكل مساحة */
function _bkInterestPanel() {
  const list = (spaceInterestList || []).filter(s => Number(s.total) > 0);
  if (!list.length) return '';
  const rows = list.slice(0, 10).map(s => {
    const total = Number(s.total)     || 0;
    const wait  = Number(s.waitlist)  || 0;
    const pend  = Number(s.pending)   || 0;
    const conf  = Number(s.confirmed) || 0;
    return `
      <div class="bk-int-row">
        <div class="bk-int-name" title="${_escBk(s.space_name)}">${_escBk(s.space_name)}</div>
        <div class="bk-int-stats">
          <span class="bk-int-chip bk-int-chip--total" title="إجمالي المهتمين بهذه المساحة">👥 ${total} مهتم</span>
          ${pend ? `<span class="bk-int-chip bk-int-chip--p" title="طلبات معلّقة تنتظر قرارك">⏳ ${pend} معلّق</span>` : ''}
          ${wait ? `<span class="bk-int-chip bk-int-chip--w" title="عدد الطلبات في قائمة الانتظار">📋 ${wait} انتظار</span>` : ''}
          ${conf ? `<span class="bk-int-chip bk-int-chip--c" title="طلبات مؤكدة">✅ ${conf} مؤكد</span>` : ''}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="bk-interest">
      <div class="bk-interest-head">📊 المهتمون بمساحاتك</div>
      <div class="bk-interest-body">${rows}</div>
    </div>`;
}

/* تغيير فلتر الحجوزات */
function setBkFilter(val) {
  const wrap = document.getElementById('bookings-list');
  if (wrap) { wrap.dataset.filter = val; renderBookings(); }
}

/* نقل طلب إلى/من قائمة الانتظار (RPC owner_set_booking_waitlist) */
async function setBookingWaitlist(bookingId, on) {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const btn = event?.currentTarget;
  if (btn) btn.disabled = true;
  try {
    const { error } = await sb.rpc('owner_set_booking_waitlist', {
      p_booking_id: bookingId,
      p_on:         !!on,
    });
    if (error) throw error;
    const bk = bookingsList.find(b => b.id === bookingId);
    if (bk) {
      bk.isWaitlist = !!on;
      if (on && (bk.status === 'cancelled' || bk.status === 'completed')) bk.status = 'pending';
    }
    loadSpaceInterest();       /* حدّث شريط المهتمين */
    renderBookings();
    updateBookingsBadge();
  } catch (e) {
    alert('تعذّر تحديث الطلب: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

/* قبول الحجز */
async function acceptBooking(bookingId) {
  if (_guardWrite('قبول حجز')) return;
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
    loadSpaceInterest();
  } catch (e) {
    console.warn('[Makani] acceptBooking:', e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✅ قبول'; }
  }
}

/* رفض الحجز — ضغطة أولى تفتح فورم الأسباب (pending) أو تأكيد بسيط (confirmed) */
function rejectBooking(bookingId) {
  const bk = bookingsList.find(b => b.id === bookingId);
  if (!bk) return;

  if (bk.status === 'confirmed' && _confirmingReject.has(bookingId)) {
    /* الضغطة الثانية للحجوزات المؤكدة — تنفّذ الإلغاء مباشرة */
    _doRejectBooking(bookingId, null);
    return;
  }

  if (!_confirmingReject.has(bookingId)) {
    _confirmingReject.add(bookingId);
    renderBookings();
    /* للحجوزات المعلقة: الإرسال الفعلي عبر submitRejectBooking من الفورم */
  }
}

/* قراءة الأسباب من الفورم وإرسالها — يُستدعى من زر "تأكيد الرفض" في الفورم */
async function submitRejectBooking(bookingId) {
  const reasonEl = document.querySelector(`input[name="rj-${bookingId}"]:checked`);
  const code  = reasonEl?.value || 'other';
  const label = REJECT_REASONS.find(r => r.code === code)?.label || '';
  const other = document.getElementById(`rj-other-${bookingId}`)?.value?.trim() || '';
  const finalReason = code === 'other' ? (other || 'سبب غير محدد') : label;
  await _doRejectBooking(bookingId, finalReason);
}

/* التنفيذ الفعلي للرفض/الإلغاء — مشترك بين pending (بسبب) وconfirmed (بدون سبب) */
async function _doRejectBooking(bookingId, reason) {
  _confirmingReject.delete(bookingId);
  const bk = bookingsList.find(b => b.id === bookingId);
  const sb  = getSB();
  if (!sb || !currentOwner?.id) return;
  try {
    const { error } = await sb.rpc('owner_update_booking_status', {
      p_booking_id: bookingId,
      p_status:     'cancelled',
    });
    if (error) throw error;

    /* حفظ سبب الرفض في ملاحظات الطلب (غير حرج) */
    if (reason && bk) {
      const existing = (bk.notes && bk.notes !== '—') ? bk.notes : '';
      const date     = new Date().toLocaleDateString('ar-EG', { day:'numeric', month:'short', year:'numeric' });
      const newNotes = [existing, `[سبب الرفض – ${date}]: ${reason}`].filter(Boolean).join('\n');
      try {
        await sb.from('bookings')
          .update({ notes: newNotes })
          .eq('id', bookingId)
          .eq('owner_id', currentOwner.id);
      } catch { /* non-critical */ }
    }

    bookingsList = bookingsList.filter(b => b.id !== bookingId);
    renderBookings();
    updateBookingsBadge();
    loadSpaceInterest();

    if (reason) _showBkRejectionToast(reason);
  } catch (e) {
    console.warn('[Makani] _doRejectBooking:', e.message);
    _confirmingReject.add(bookingId);
    renderBookings();
  }
}

/* Toast إعلام بنتيجة الرفض */
function _showBkRejectionToast(reason) {
  const wrap = document.getElementById('bookings-list');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'bk-reject-toast';
  el.innerHTML = `<strong>✖ تم رفض الطلب</strong> — ${reason}
    <br><span style="font-size:10px;opacity:0.65">الطلب سيُحذف تلقائياً من قاعدة البيانات بعد 30 يوماً</span>`;
  wrap.prepend(el);
  setTimeout(() => el.remove(), 5500);
}

/* فورم أسباب الرفض — يُعرض داخل بطاقة الحجز عند الضغط على "رفض" */
function _bkRejectForm(bookingId) {
  const opts = REJECT_REASONS.map((r, i) => `
    <label class="bk-reject-option">
      <input type="radio" name="rj-${bookingId}" value="${r.code}" ${i === 0 ? 'checked' : ''}
        onchange="document.getElementById('rj-other-wrap-${bookingId}').style.display=this.value==='other'?'block':'none'">
      <span class="bk-reject-opt-text">${r.label}</span>
    </label>`).join('');

  return `
    <div class="bk-reject-form">
      <div class="bk-reject-title">
        📋 سبب الرفض
        <span style="font-size:10px;color:var(--text3);font-weight:400">(للتوثيق الداخلي فقط)</span>
      </div>
      <div class="bk-reject-reasons">${opts}</div>
      <div id="rj-other-wrap-${bookingId}" style="display:none">
        <input type="text" id="rj-other-${bookingId}" class="rj-other-input"
               placeholder="اكتب سبب الرفض بالتفصيل…" maxlength="250">
      </div>
      <div class="bk-reject-submit-row">
        <button class="bk-btn-confirm-reject" onclick="submitRejectBooking('${bookingId}')">
          ✖ تأكيد رفض الطلب
        </button>
        <button class="btn btn-ghost btn-sm" onclick="_cancelReject('${bookingId}')">إلغاء</button>
      </div>
    </div>`;
}

/* تنظيف الحجوزات الملغاة الأقدم من 30 يوم (Soft Delete) */
async function cleanupOldCancelledBookings() {
  const sb = getSB();
  if (!sb || !currentOwner?.id) return;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await sb.from('bookings')
      .delete()
      .eq('owner_id', currentOwner.id)
      .eq('status', 'cancelled')
      .lt('updated_at', cutoff);
  } catch { /* صامت — التنظيف غير حرج */ }
}

/* ── قائمة الانتظار: قبول (توفّرت وحدة) ── */
async function approveWaitlist(bookingId) {
  if (_guardWrite('قبول حجز')) return;
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
    loadSpaceInterest();
  } catch (e) {
    alert('تعذّر قبول الطلب: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

/* ── قائمة الانتظار: إزالة / إلغاء ── */
async function rejectWaitlist(bookingId) {
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
    loadSpaceInterest();
  } catch (e) {
    console.warn('[Makani] rejectWaitlist:', e.message);
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

/* تحويل الحجز لعقد — يخزّن البيانات ثم ينتقل لصفحة العقود التي تملأ الفورم تلقائياً */
function convertBookingToContract(bookingId) {
  if (_guardWrite('إنشاء عقد')) return;
  const bk = bookingsList.find(b => b.id === bookingId);
  if (!bk) return;
  _pendingContractFromBooking = bk;
  const contractsNav = document.querySelector('[onclick*="\'contracts\'"]') ||
                       document.querySelector('[data-view="contracts"]');
  goTo('contracts', contractsNav);
}

/* ملء فورم العقد من بيانات الحجز */
function _fillContractFromBooking(bk) {
  const set = (id, val) => {
    if (!val && val !== 0) return;
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  set('cf-tenant',   bk.bookerName  !== '—' ? bk.bookerName  : '');
  set('cf-phone',    bk.bookerPhone !== '—' ? bk.bookerPhone : '');
  set('cf-email',    bk.bookerEmail !== '—' ? bk.bookerEmail : '');
  set('cf-activity', bk.activity    !== '—' ? bk.activity    : '');
  set('cf-start',    bk.startDate   || '');
  if (bk.priceRaw)  set('cf-rent', String(bk.priceRaw));

  /* الوحدة المطابقة */
  if (bk.spaceId) {
    const matchingUnit = ownerSpaces.find(s => s.spaceId === bk.spaceId);
    const spaceEl = document.getElementById('cf-space');
    if (spaceEl && matchingUnit) spaceEl.value = matchingUnit.unitDbId || '';
  }

  /* ملاحظة مرجعية */
  const notesEl = document.getElementById('cf-notes');
  if (notesEl && !notesEl.value) {
    notesEl.value = `محوَّل من طلب حجز — ${bk.spaceName}`;
  }

  /* بانر "تم الملء التلقائي" */
  const banner = document.getElementById('contract-from-booking-banner');
  if (banner) {
    banner.style.display = 'flex';
    const nameEl  = banner.querySelector('.cfb-name');
    const spaceEl = banner.querySelector('.cfb-space');
    if (nameEl)  nameEl.textContent  = bk.bookerName !== '—' ? bk.bookerName : 'الحاجز';
    if (spaceEl) spaceEl.textContent = bk.spaceName  !== '—' ? bk.spaceName  : '';
  }

  /* تمرير تلقائي لنموذج العقد */
  document.getElementById('contract-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('cf-tenant')?.focus();
}

/* إخفاء بانر الملء التلقائي */
function _clearContractFromBookingBanner() {
  const banner = document.getElementById('contract-from-booking-banner');
  if (banner) banner.style.display = 'none';
}

/* إلغاء تأكيد رفض الحجز */
function _cancelReject(bookingId) {
  _confirmingReject.delete(bookingId);
  renderBookings();
}

/* حذف الإشعارات المقروءة الأقدم من 30 يوم */
async function cleanupOldNotifications() {
  const sb = getSB();
  if (!sb) return;
  try {
    await sb.rpc('cleanup_old_notifications', { p_days: 90 });
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

/* ── map profile entityType (Arabic string) → space type code ── */
function entityTypeToSpaceType(entityType) {
  const t = (entityType || '').toLowerCase();
  if (t.includes('مول') || t.includes('mall') || t.includes('تجار')) return 'mall';
  if (t.includes('نادي') || t.includes('club') || t.includes('رياض') || t.includes('sport')) return 'club';
  if (t.includes('مدرسة') || t.includes('school')) return 'school';
  if (t.includes('فندق') || t.includes('hotel')) return 'hotel';
  return 'mall';
}

/* ── تهيئة فورم إضافة المساحة عند فتح الصفحة ── */
function initAddSpaceForm() {
  if (!currentOwner) return;

  /* نوع المكان — من البروفايل */
  const spaceType = entityTypeToSpaceType(currentOwner.entityType);
  const typeInput = document.getElementById('as-type');
  const typeChip  = document.getElementById('as-type-chip');
  if (typeInput) typeInput.value = spaceType;
  if (typeChip) {
    const labels = { mall:'🏬 مول تجاري', club:'🏊 نادي رياضي', school:'🏫 مدرسة', hotel:'🏨 فندق' };
    const display = labels[spaceType] || (currentOwner.entityType ? `🏢 ${currentOwner.entityType}` : '🏢 كيان تجاري');
    typeChip.textContent = display;
    typeChip.style.color = 'var(--text1)';
  }
  updateSpaceIcon();

  /* المنطقة/المدينة — من البروفايل (بدون تغيير لو الحقل فيه قيمة بالفعل) */
  const locEl = document.getElementById('as-loc');
  if (locEl && !locEl.value && currentOwner.place) locEl.value = currentOwner.place;

  /* بانر السياق: اسم المنشأة ونوعها */
  const ctx = document.getElementById('as-venue-context');
  if (ctx && currentOwner.entityName) {
    ctx.style.display = 'flex';
    const nameEl = document.getElementById('as-ctx-name');
    const typeEl = document.getElementById('as-ctx-type');
    if (nameEl) nameEl.textContent = currentOwner.entityName;
    if (typeEl) typeEl.textContent = currentOwner.entityType ? `(${currentOwner.entityType})` : '';
  }

  /* أضف صفاً واحداً افتراضياً في الأحجام لو لا يوجد شيء */
  const sizesCont = document.getElementById('as-sizes-container');
  if (sizesCont && !sizesCont.children.length) addSizeRow();
}

/* ── إخفاء حقل الأنشطة عند تفعيل "يصلح لجميع الأنشطة" ── */
function toggleAllActs() {
  const allActs = document.getElementById('as-all-acts')?.checked;
  const section = document.getElementById('as-acts-section');
  if (section) section.style.display = allActs ? 'none' : 'block';
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

  /* نوع المكان يُكمَّل تلقائياً من البروفايل لو لم يُحدد */
  const resolvedType = spaceType || entityTypeToSpaceType(currentOwner?.entityType || '');

  if (!spaceName || !spaceLoc) {
    msg.className = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML = `<span class="alert-ico">❌</span><div class="alert-text"><strong>اسم المساحة ومنطقتها مطلوبان.</strong></div>`;
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
      hotel:  { badge:'متاح', badgeClass:'badge-blue',  thumbClass:'thumb-mall' },
      other:  { badge:'متاح', badgeClass:'badge-avail', thumbClass:'thumb-mall' },
    };
    const tm = typeMap[resolvedType] || typeMap.mall;

    const actsRaw = get('as-acts');
    const actsArr = actsRaw ? actsRaw.split('·').map(s => s.trim()).filter(Boolean) : [];
    const amenStr = getAmenitiesString();
    const amenArr = amenStr ? amenStr.split('·').map(s => s.trim()).filter(Boolean) : [];

    const spacePayload = {
      owner_id:     currentOwner.id,
      name:         spaceName,
      type:         resolvedType,
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
      status:       'active',
      is_active:    true,
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
        user_id:  currentOwner.id,
        type:     'space_submitted',
        source:   'spaces',
        title:    'مساحة جديدة مُنشورة',
        body:     `تم نشر مساحتك "${spaceName}" على منصة مكاني Spot مباشرةً.`,
      });
    } catch { /* notifications table optional */ }

    /* تحديث الحالة المحلية */
    ownerPendingSpaces.push({
      id:          newSpace.id,
      name:        spaceName,
      type:        resolvedType,
      loc:         spaceLoc,
      sizes:       getSizesString(),
      price:       parseInt(get('as-default-price')) || 0,
      subCount:    subUnits.length,
      status:      'active',
      submittedAt: new Date().toISOString(),
    });
    renderSpaces();

    msg.className     = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">⚡</span>
      <div class="alert-text">
        <strong>تم نشر المساحة على المنصة!</strong><br>
        "<em>${spaceName}</em>" منشورة الآن وتظهر للزوار ومتاحة للحجز مباشرةً.<br>
        <div style="margin-top:6px;font-size:11px;color:var(--text3)">فريق مكاني Spot يتابع جميع المساحات من لوحة الأدمن. للمساعدة: واتساب 01103467711</div>
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
  btn.innerHTML = '<span style="font-size:20px">⚡</span> نشر المساحة على المنصة الآن';
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

/* حساب الأيام في فورم البازار القديم (محتفظ به للتوافق — لا يُستخدم) */
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

async function submitBazaarOpportunity(e) {
  e.preventDefault();
  if (_guardWrite('نشر فرصة بازار')) return;

  const btn = document.getElementById('bzopp-btn');
  const msg = document.getElementById('bzopp-msg');
  const get = id => document.getElementById(id)?.value?.trim() || '';

  const startDate = get('bzopp-start');
  const endDate   = get('bzopp-end');

  if (endDate < startDate) {
    msg.className     = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">❌</span><div class="alert-text"><strong>تاريخ النهاية يجب أن يكون بعد أو يساوي تاريخ البداية.</strong></div>`;
    return;
  }

  btn.disabled     = true;
  btn.innerHTML    = '⏳ جاري النشر وإشعار المنظمين…';
  msg.style.display = 'none';

  try {
    const { data: requestId, error } = await sb.rpc('submit_bazaar_opportunity', {
      p_place_name:         get('bzopp-place'),
      p_venue_type:         get('bzopp-type'),
      p_city:               get('bzopp-city'),
      p_available_area:     parseFloat(document.getElementById('bzopp-area')?.value) || null,
      p_is_indoor:          document.getElementById('bzopp-indoor')?.checked  || false,
      p_has_electricity:    document.getElementById('bzopp-electric')?.checked || false,
      p_has_setup:          document.getElementById('bzopp-setup')?.checked    || false,
      p_expected_footfall:  get('bzopp-footfall') || null,
      p_available_start:    startDate,
      p_available_end:      endDate,
      p_image_url:          get('bzopp-image') || null,
      p_notes:              get('bzopp-notes') || null,
    });

    if (error) throw error;

    msg.className     = 'alert-item success';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">✅</span>
      <div class="alert-text">
        <strong>تم نشر الفرصة وإخطار المنظمين فوراً!</strong><br>
        تابع العروض من تبويب <strong>فرصي المنشورة</strong> — ستجد هنا كل المقترحات فور وصولها.
      </div>`;

    document.getElementById('bzopp-form')?.reset();
    const dEl = document.getElementById('bzopp-days-display');
    if (dEl) dEl.style.display = 'none';
    _bzClearDraft();

    await loadBazaarOpportunities();

  } catch (err) {
    msg.className     = 'alert-item danger';
    msg.style.display = 'flex';
    msg.innerHTML     = `<span class="alert-ico">❌</span><div class="alert-text"><strong>تعذّر نشر الفرصة</strong><br>${_escR(err.message || 'حاول مرة أخرى')}</div>`;
  }

  btn.disabled  = false;
  btn.innerHTML = '📢 نشر الفرصة وإشعار المنظمين فوراً';
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

  _ss.set('ms_owner', JSON.stringify(currentOwner));

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
   🪪  البروفايل العام الموحّد — profiles
   ══════════════════════════════════════════ */
let _entityTypesLoaded = false;

/* تحميل أنواع الكيانات من قاعدة البيانات (قابلة للتوسع من الأدمن) */
async function loadEntityTypes(selected) {
  const sel = document.getElementById('pp-entity-type');
  if (!sel) return;
  if (!_entityTypesLoaded) {
    const sb = getSB();
    let types = [];
    if (sb) {
      const { data } = await sb.from('entity_types')
        .select('name').eq('is_active', true).order('sort_order', { ascending: true });
      types = (data || []).map(r => r.name);
    }
    sel.innerHTML = '<option value="">— اختر النوع —</option>' +
      types.map(t => `<option value="${_escAttr(t)}">${t}</option>`).join('');
    _entityTypesLoaded = true;
  }
  if (selected != null) sel.value = selected;
}

function _escAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

/* ملء قسم البروفايل العام بالبيانات الحالية */
async function renderProfileView() {
  if (!currentOwner) return;
  await loadEntityTypes(currentOwner.entityType || '');

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
  setVal('pp-entity-name', currentOwner.entityName);
  setVal('pp-bio',         currentOwner.bio);

  /* صورة الأفاتار */
  const av = document.getElementById('pp-avatar');
  if (av) {
    if (currentOwner.avatarUrl) {
      av.style.backgroundImage = `url("${currentOwner.avatarUrl}")`;
      av.textContent = '';
    } else {
      av.style.backgroundImage = '';
      av.textContent = currentOwner.initial || 'م';
    }
  }
  /* صورة الغلاف */
  const cv = document.getElementById('pp-cover-wrap');
  if (cv) cv.style.backgroundImage = currentOwner.coverUrl ? `url("${currentOwner.coverUrl}")` : '';

  /* رابط الصفحة العامة */
  const link = document.getElementById('pp-public-link');
  if (link) link.href = `/?p=owner-profile&id=${currentOwner.id}`;

  /* badges الأدوار */
  const badgesEl = document.getElementById('pp-roles-badges');
  if (badgesEl) {
    const map = {
      space_owner:      { ico: '🏢', label: 'صاحب مساحات' },
      bazaar_organizer: { ico: '🎪', label: 'منظم فعاليات' },
    };
    const roles = (currentOwner.roles && currentOwner.roles.length) ? currentOwner.roles : ['space_owner'];
    badgesEl.innerHTML = roles.map(r => {
      const m = map[r]; if (!m) return '';
      return `<span class="badge" style="background:var(--orange-pale);color:var(--orange);border:1px solid var(--border2)">${m.ico} ${m.label}</span>`;
    }).join('');
  }

  ppSyncPreview();
}

/* تحديث المعاينة الحية للاسم/النوع/التوثيق */
function ppSyncPreview() {
  const name = document.getElementById('pp-entity-name')?.value.trim();
  const type = document.getElementById('pp-entity-type')?.value;
  const nameEl = document.getElementById('pp-preview-name');
  const typeEl = document.getElementById('pp-preview-type');
  const verEl  = document.getElementById('pp-preview-verified');
  if (nameEl) nameEl.textContent = name || currentOwner?.name || '—';
  if (typeEl) typeEl.textContent = type || 'لم يُحدّد نوع الكيان';
  if (verEl)  verEl.style.display = currentOwner?.isVerified ? 'inline' : 'none';
}

function _ppMsg(type, text) {
  const msgEl = document.getElementById('pp-msg');
  if (!msgEl) return;
  msgEl.className = `alert-item ${type}`;
  msgEl.style.display = 'flex';
  const ico = type === 'success' ? '✅' : '❌';
  msgEl.innerHTML = `<span class="alert-ico">${ico}</span><div class="alert-text"><strong>${text}</strong></div>`;
  setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
}

/* رفع صورة البروفايل (avatar) — يُحفظ في profiles.avatar_url */
async function uploadProfileAvatar(input) {
  const file = input.files?.[0];
  if (!file || !currentOwner) return;
  if (file.size > 20 * 1024 * 1024) { _ppMsg('danger', 'الصورة أكبر من 20 ميجا.'); input.value = ''; return; }

  const av = document.getElementById('pp-avatar');
  const prevImg = av ? av.style.backgroundImage : '';
  if (av) { av.style.backgroundImage = `url("${URL.createObjectURL(file)}")`; av.textContent = ''; av.style.opacity = '0.55'; }

  try {
    const sb = getSB();
    const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = session?.access_token || SUPABASE_KEY;
    const r2Path = `avatars/${currentOwner.id}/avatar-${Date.now()}.webp`;
    const url = await uploadSingleImageToR2(file, r2Path, token);

    await sb.from('profiles').update({ avatar_url: url }).eq('id', currentOwner.id);
    /* 🪪 مزامنة organizer_profiles (تحديث فقط إن كان الحساب منظم بازار أيضاً — لا ينشئ صفاً) */
    sb.from('organizer_profiles').update({ avatar_url: url }).eq('user_id', currentOwner.id).then(null, () => {});
    currentOwner.avatarUrl = url;
    _ss.set('ms_owner', JSON.stringify(currentOwner));

    if (av) { av.style.backgroundImage = `url("${url}")`; av.style.opacity = '1'; }
    /* توحيد: حدّث أفاتار السايدبار أيضاً */
    _applySidebarAvatar();
    _ppMsg('success', 'تم تحديث صورة البروفايل بنجاح.');
  } catch (err) {
    if (av) { av.style.backgroundImage = prevImg; av.style.opacity = '1'; if (!prevImg) av.textContent = currentOwner.initial || 'م'; }
    _ppMsg('danger', 'فشل رفع الصورة: ' + err.message);
  } finally { input.value = ''; }
}

/* رفع صورة الغلاف — يُحفظ في profiles.cover_url */
async function uploadProfileCover(input) {
  const file = input.files?.[0];
  if (!file || !currentOwner) return;
  if (file.size > 20 * 1024 * 1024) { _ppMsg('danger', 'الصورة أكبر من 20 ميجا.'); input.value = ''; return; }

  const cv = document.getElementById('pp-cover-wrap');
  const prev = cv ? cv.style.backgroundImage : '';
  const lbl = document.getElementById('pp-cover-label');
  if (lbl) lbl.textContent = 'جاري الرفع…';
  if (cv) cv.style.backgroundImage = `url("${URL.createObjectURL(file)}")`;

  try {
    const sb = getSB();
    const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
    const token = session?.access_token || SUPABASE_KEY;
    const r2Path = `covers/${currentOwner.id}/cover-${Date.now()}.webp`;
    const url = await uploadSingleImageToR2(file, r2Path, token);

    await sb.from('profiles').update({ cover_url: url }).eq('id', currentOwner.id);
    /* 🪪 مزامنة organizer_profiles إن وُجد */
    sb.from('organizer_profiles').update({ cover_url: url }).eq('user_id', currentOwner.id).then(null, () => {});
    currentOwner.coverUrl = url;
    _ss.set('ms_owner', JSON.stringify(currentOwner));

    if (cv) cv.style.backgroundImage = `url("${url}")`;
    _ppMsg('success', 'تم تحديث صورة الغلاف بنجاح.');
  } catch (err) {
    if (cv) cv.style.backgroundImage = prev;
    _ppMsg('danger', 'فشل رفع الغلاف: ' + err.message);
  } finally { if (lbl) lbl.textContent = 'تغيير الغلاف'; input.value = ''; }
}

/* حفظ بيانات الجهة (الاسم، النوع، الوصف) في profiles */
async function saveProfileForm() {
  if (!currentOwner) return;
  const entityName = document.getElementById('pp-entity-name')?.value.trim() || null;
  const entityType = document.getElementById('pp-entity-type')?.value || null;
  const bio        = document.getElementById('pp-bio')?.value.trim() || null;
  const btn = document.getElementById('pp-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ…'; }

  try {
    const sb = getSB();
    if (sb && currentOwner.id) {
      const { error } = await sb.from('profiles')
        .update({ entity_name: entityName, entity_type: entityType, bio })
        .eq('id', currentOwner.id);
      if (error) throw error;
      /* 🪪 مزامنة الوصف مع organizer_profiles إن كان الحساب منظم بازار أيضاً */
      sb.from('organizer_profiles').update({ bio }).eq('user_id', currentOwner.id).then(null, () => {});
    }
    currentOwner.entityName = entityName || '';
    currentOwner.entityType = entityType || '';
    currentOwner.bio        = bio || '';
    _ss.set('ms_owner', JSON.stringify(currentOwner));
    ppSyncPreview();
    _ppMsg('success', 'تم حفظ البروفايل بنجاح.');
  } catch (err) {
    _ppMsg('danger', 'تعذّر الحفظ: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 حفظ البروفايل'; }
  }
}

/* توحيد صورة السايدبار من profiles.avatar_url */
function _applySidebarAvatar() {
  const el = document.getElementById('sb-initial');
  if (!el || !currentOwner) return;
  if (currentOwner.avatarUrl) {
    el.style.backgroundImage   = `url("${currentOwner.avatarUrl}")`;
    el.style.backgroundSize     = 'cover';
    el.style.backgroundPosition = 'center';
    el.textContent = '';
  } else {
    el.style.backgroundImage = '';
    el.textContent = currentOwner.initial || 'م';
  }
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
let bazaarOpportunities   = []; /* فرص البازار التي نشرها المالك */

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
      .eq('user_id', currentOwner.id)
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
        filter: `user_id=eq.${currentOwner.id}`,
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
      .eq('user_id', currentOwner.id);
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
      'لا يمكن فتح لوحة أصحاب المساحات بدون التحقق من حساب المنصة وصلاحية Owner.',
      `<a href="/" class="btn-login" style="text-decoration:none">الرجوع إلى منصة مكاني Spot ←</a>`
    );
    return;
  }

  /* ── تحقق من الـ Supabase session ── */
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    _ss.rm('ms_owner');
    showOwnerAccessGate(
      'info',
      'ادخل من حسابك على منصة مكاني Spot',
      'لا توجد جلسة نشطة في هذا المتصفح. سجّل الدخول من المنصة، وإذا كان لديك صلاحية Owner ستنتقل للوحتك مباشرة.',
      `<a href="/?p=login" class="btn-login" style="text-decoration:none">تسجيل الدخول ←</a>`
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
    _ss.rm('ms_owner');
    showOwnerAccessGate(
      'danger',
      'لوحة أصحاب المساحات غير مفعّلة لهذا الحساب',
      `حسابك الحالي ${profile?.role ? `مسجل كـ "${profile.role}"` : 'لم يتم العثور على صلاحية Owner له'}. اطلب تفعيل الحساب وبعد تحويله إلى Owner ستدخل للوحة مباشرة.`,
      `<div style="display:flex;flex-direction:column;gap:10px">
        <a href="/?p=dashboard" class="btn-login" style="text-decoration:none">اطلب تفعيل الحساب ←</a>
        <a href="/" style="color:var(--text2);font-size:13px;text-align:center;text-decoration:none;display:block;padding:4px 0">رجوع للمنصة</a>
      </div>`
    );
    return;
  }

  /* ❌ حساب موقوف من الأدمن */
  if (profile.is_suspended) {
    _ss.rm('ms_owner');
    showOwnerAccessGate(
      'danger',
      'تم إيقاف هذا الحساب مؤقتاً',
      'حسابك موقوف حالياً من قِبل إدارة مكاني Spot. تواصل معنا على واتساب 01103467711 للاستفسار.',
      `<a href="/" class="btn-login" style="text-decoration:none">الرجوع إلى منصة مكاني Spot ←</a>`
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
    subscriptionStatus: profile.subscription_status || null,
    /* 🪪 حقول البروفايل العام الموحد */
    avatarUrl:  profile.avatar_url  || '',
    coverUrl:   profile.cover_url   || '',
    bio:        profile.bio         || '',
    entityName: profile.entity_name || '',
    entityType: profile.entity_type || '',
    isVerified: !!profile.is_verified,
    roles:      Array.isArray(profile.roles) ? profile.roles : [],
  };
  const _subSt = currentOwner.subscriptionStatus;
  const _expSub = _subSt === 'expired' || _subSt === 'cancelled' || _subSt === 'suspended';
  if (currentOwner.planTier === 'starter' && !_expSub) return; /* starter حقيقي — لا تفتح الداشبورد */
  _ss.set('ms_owner', JSON.stringify(currentOwner));
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
