/* ================================================================
   📁 app.js — الطبقة الثالثة: السلوك والوظائف
   ================================================================
   🧠 هذا الملف مسؤول عن كل ما يتحرك في الموقع:
      - تحميل البيانات من Google Sheets
      - نظام تسجيل الدخول عبر Supabase
      - عرض الكروت والفلاتر
      - مودال الحجز وإرسال البيانات

   📌 كيف تعدّل؟
      - لتغيير رابط Google Sheet: غيّر SHEET_URL
      - لتغيير رابط استقبال الحجوزات: غيّر BOOKING_URL
      - لتغيير إعدادات Supabase: غيّر SUPABASE_URL و SUPABASE_KEY
   ================================================================ */


/* ================================================================
   ⚙️ القسم الأول: إعدادات وروابط المنصة
   (هنا كل الروابط المهمة — عدّلها من هنا فقط)
   ================================================================ */

/**
 * 📊 رابط Google Apps Script الذي يجيب بيانات المساحات والأنشطة
 * لو غيّرت الشيت أو أعدت نشر الـ Script، ضع الرابط الجديد هنا
 */
const SHEET_URL = "https://script.google.com/macros/s/AKfycbwpfHaeIG9UBYmO_QmchJCqnKgJcahvncYkS1gRRAD_RxIla9JvSQmPSO2soBwpuX6N2g/exec";

/**
 * 📬 رابط Google Apps Script الذي يستقبل طلبات الحجز ويحفظها في الشيت
 * لو غيّرت شيت الحجوزات، ضع الرابط الجديد هنا
 */
const BOOKING_URL = "https://script.google.com/macros/s/AKfycbyjhFQ_owlHoRibE5XLxh882fOQJg9A6RGwUfKeHOioYJWK6E43c51n7HsncRqXE0IP/exec";

/**
 * 🔐 إعدادات Supabase — قاعدة بيانات المستخدمين
 * هذه البيانات من لوحة تحكم Supabase الخاصة بك
 */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';


/* ================================================================
   🗄️ القسم الثاني: المتغيرات العامة
   (بيانات تُحفظ مؤقتاً أثناء تشغيل الصفحة)
   ================================================================ */

let SPACES      = [];   // قائمة المساحات المحمّلة من الشيت
let ACTIVITIES  = [];   // قائمة الأنشطة التجارية
let activeTab   = '';   // التبويب النشط حالياً (مول / نادي / مدرسة)
let selectedAct = '';   // النشاط المحدد في الفلتر
let sbClient    = null; // كائن Supabase يُهيَّأ عند التحميل


/* ================================================================
   🚀 القسم الثالث: نقطة البداية (تشغيل الموقع)
   ================================================================ */

/**
 * يُشغَّل هذا الكود فور انتهاء تحميل الصفحة
 * يهيّئ Supabase ويحمّل البيانات
 */
document.addEventListener('DOMContentLoaded', function() {
  // تهيئة Supabase
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (e) {
    console.warn('⚠️ Supabase غير محمّل بعد — تأكد من تضمين مكتبته قبل app.js');
  }

  // تحميل بيانات المساحات من Google Sheets
  loadData();

  // تحقق من حالة تسجيل الدخول
  initAuth();
});


/* ================================================================
   📊 القسم الرابع: تحميل البيانات من Google Sheets
   ================================================================ */

/**
 * يجيب المساحات والأنشطة من Google Sheets عبر Apps Script
 * يُعرض مؤشر تحميل أثناء الانتظار
 */
async function loadData() {
  showLoadingState();
  try {
    const res  = await fetch(SHEET_URL);
    const json = await res.json();

    if (json.status !== "ok") throw new Error(json.message || "خطأ في قراءة الشيت");

    ACTIVITIES = json.activities || [];
    SPACES     = json.spaces     || [];

    buildActivityFilters();     // ابنِ قائمة الأنشطة في الفلتر
    buildModalActivityPicker(); // ابنِ أزرار الأنشطة في المودال
    renderCards(SPACES);        // ارسم كروت المساحات

  } catch (err) {
    showErrorState(err.message);
  }
}

/** شاشة التحميل */
function showLoadingState() {
  const grid = document.getElementById('spaces-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px;display:inline-block;animation:spin 1.2s linear infinite">⏳</div>
      <div style="font-size:16px;font-weight:700;color:var(--ink2);margin-bottom:6px">جاري تحميل المساحات…</div>
      <div style="font-size:13px;color:var(--ink3)">بنجيب أحدث البيانات من الشيت</div>
    </div>`;
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = 'جاري التحميل…';
}

/** شاشة الخطأ */
function showErrorState(msg) {
  const grid = document.getElementById('spaces-grid');
  if (!grid) return;
  grid.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:80px 20px">
      <div style="font-size:52px;margin-bottom:18px">⚠️</div>
      <div style="font-size:16px;font-weight:700;color:var(--red);margin-bottom:8px">في مشكلة في تحميل البيانات</div>
      <div style="font-size:13px;color:var(--ink2);margin-bottom:22px;max-width:400px;margin-left:auto;margin-right:auto">${msg}</div>
      <button class="btn btn-primary" onclick="loadData()">🔄 حاول تاني</button>
    </div>`;
  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = 'خطأ في التحميل';
}


/* ================================================================
   🏷️ القسم الخامس: بناء فلاتر الأنشطة
   ================================================================ */

/** يملأ قائمة الأنشطة في صندوق البحث */
function buildActivityFilters() {
  const sel = document.getElementById('f-act');
  if (!sel) return;
  sel.innerHTML = '<option value="">— كل الأنشطة —</option>' +
    ACTIVITIES.map(a => `<option value="${a.id}">${a.label}</option>`).join('');
}

/** يُشغَّل عند اختيار نشاط من القائمة */
function onActDropdown(id) {
  selectedAct = id;
  filterAndRender();
  showSearchChips();
}

/** يملأ أزرار الأنشطة في مودال الحجز */
function buildModalActivityPicker() {
  const picker = document.getElementById('modal-act-picker');
  if (!picker) return;
  picker.innerHTML = ACTIVITIES.map(a =>
    `<button class="act-pick-btn" data-id="${a.id}" onclick="toggleModalAct('${a.id}',this)">${a.label}</button>`
  ).join('');
}

/** تحديد/إلغاء نشاط في مودال الحجز */
function toggleModalAct(id, el) {
  document.querySelectorAll('.act-pick-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  const wrap = document.getElementById('other-act-wrap');
  if (wrap) wrap.style.display = (id === 'other') ? 'block' : 'none';
}


/* ================================================================
   🃏 القسم السادس: رسم كروت المساحات
   ================================================================ */

/**
 * يرسم كروت المساحات في الصفحة
 * @param {Array} data — قائمة المساحات المراد عرضها
 */
function renderCards(data) {
  const grid = document.getElementById('spaces-grid');
  if (!grid) return;

  const counter = document.getElementById('res-count');
  if (counter) counter.textContent = data.length + ' مساحات';

  // رسالة "لا توجد نتائج"
  if (!data.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:70px 20px;color:var(--ink2)">
        <div style="font-size:48px;margin-bottom:16px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">مش لاقيين مساحات بالمعايير دي</div>
        <div style="font-size:14px">جرب تغيير النشاط أو المنطقة أو السعر</div>
      </div>`;
    return;
  }

  grid.innerHTML = data.map(s => {
    // ── بناء صورة الكارد (أو الإيموجي البديل) ──
    const thumbHtml = s.image
      ? `<img src="${s.image}" alt="${s.name}" loading="lazy"
             onerror="this.parentElement.innerHTML='<div class=\\'card-thumb-placeholder ${s.thumbClass}\\'>${s.icon}</div>'">`
      : `<div class="card-thumb-placeholder ${s.thumbClass}">${s.icon}</div>`;

    // ── بناء أزرار الأنشطة ──
    const actsHtml = s.allActs
      ? '<span class="act-tag act-tag-all">✓ يصلح لجميع الأنشطة</span>'
      : (s.acts || []).slice(0, 5).map(id => {
          const a = ACTIVITIES.find(x => x.id === id);
          return a ? `<span class="act-tag">${a.label}</span>` : '';
        }).join('') + (s.acts && s.acts.length > 5 ? `<span class="act-tag">+${s.acts.length - 5}</span>` : '');

    // ── نظام التسعير حسب الحجم ──
    // كل حجم عنده سعره الخاص — مثال: "١×١ م:1900"
    const sizePrices = {};
    const sizesClean = [];
    (s.sizes || []).forEach(sz => {
      const parts = sz.split(':');
      const label = parts[0].trim();
      const price = parts[1] ? parseInt(parts[1]) : s.price;
      sizePrices[label] = price;
      sizesClean.push(label);
    });

    const defaultSize  = sizesClean[0] || '';
    const defaultPrice = sizePrices[defaultSize] || s.price;

    // ── بناء أزرار الأحجام (كل زرار يغيّر السعر) ──
    const sizesHtml = sizesClean.map((sz, i) =>
      `<span class="size-chip${i === 0 ? ' on' : ''}"
        data-price="${sizePrices[sz]}"
        data-size="${sz}"
        onclick="event.stopPropagation();
                 var card=this.closest('.space-card');
                 card.querySelectorAll('.size-chip').forEach(c=>c.classList.remove('on'));
                 this.classList.add('on');
                 card.querySelector('.price-main').innerHTML=
                   Number(this.dataset.price).toLocaleString('ar-EG')+' ج <span style=\\'font-size:12px;font-weight:400;color:var(--ink2)\\'>/شهر</span>';">
        ${sz}
      </span>`
    ).join('');

    return `
    <div class="space-card">
      <div class="card-thumb">
        ${thumbHtml}
        <span class="card-badge ${s.badgeClass}">${s.badge}</span>
      </div>
      <div class="card-body">
        <div class="card-name">${s.name}</div>
        <div class="card-loc">📍 ${s.loc}</div>
        <div class="card-acts">${actsHtml}</div>
        <div class="card-sizes">${sizesHtml}</div>
        <div class="card-footer">
          <div class="price-main">${Number(defaultPrice).toLocaleString('ar-EG')} ج <span>/ شهر</span></div>
          <button class="btn btn-primary" style="font-size:12px;padding:7px 16px"
                  onclick="openBooking(${s.id})">احجز دلوقتي ←</button>
        </div>
        <div class="card-tip">
          <div class="tip-dot"></div>
          <div><strong>موسم البيع:</strong> ${s.season}<br>${s.insight}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}


/* ================================================================
   🔍 القسم السابع: الفلترة والبحث
   ================================================================ */

/** تغيير التبويب (كل / مولات / نوادي / مدارس) */
function setTab(el, type) {
  document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  activeTab = type;
  filterAndRender();
}

/** تشغيل البحث عند الضغط على زرار "بحث" */
function doSearch() {
  filterAndRender();
  showSearchChips();
}

/** تصفية المساحات وإعادة رسمها */
function filterAndRender() {
  let data = [...SPACES];
  const reg  = document.getElementById('f-region')?.value || '';
  const type = document.getElementById('f-type')?.value || activeTab;
  const mn   = parseInt(document.getElementById('f-min')?.value) || 0;
  const mx   = parseInt(document.getElementById('f-max')?.value) || 999999;

  if (reg)  data = data.filter(s => s.loc === reg);
  if (type) data = data.filter(s => s.type === type);
  data = data.filter(s => s.price >= mn && s.price <= mx);
  if (selectedAct) data = data.filter(s => s.allActs || (s.acts && s.acts.includes(selectedAct)));

  renderCards(data);
}

/** عرض الفلاتر المحددة كـ chips قابلة للحذف */
function showSearchChips() {
  const chips = [];
  const r  = document.getElementById('f-region')?.value;
  const d  = document.getElementById('f-dur')?.value;
  const mn = document.getElementById('f-min')?.value;
  const mx = document.getElementById('f-max')?.value;

  if (r)       chips.push(r);
  if (d)       chips.push(d);
  if (mn || mx) chips.push(`${mn || '٠'} – ${mx || '∞'} ج`);
  if (selectedAct) {
    const a = ACTIVITIES.find(x => x.id === selectedAct);
    if (a) chips.push(a.label);
  }

  const chipsEl = document.getElementById('active-chips');
  if (chipsEl) {
    chipsEl.innerHTML = chips.map(ch =>
      `<span class="chip" onclick="clearAllFilters()">${ch} ×</span>`
    ).join('');
  }
}

/** مسح كل الفلاتر */
function clearAllFilters() {
  const chipsEl = document.getElementById('active-chips');
  if (chipsEl) chipsEl.innerHTML = '';
  ['f-region', 'f-dur', 'f-min', 'f-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const actSel = document.getElementById('f-act');
  if (actSel) actSel.value = '';
  selectedAct = '';
  renderCards(SPACES);
}


/* ================================================================
   🗺️ القسم الثامن: التنقل بين الصفحات
   ================================================================ */

/**
 * يُظهر صفحة ويُخفي باقي الصفحات
 * @param {string} p — اسم الصفحة (home / how / owner / login / signup / dashboard / confirm)
 */
function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById('pg-' + p);
  if (target) target.classList.add('active');

  // تحديث الرابط النشط في الـ Nav
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const links = document.querySelectorAll('.nav-links a');
  if (p === 'home')  links[0]?.classList.add('active');
  if (p === 'how')   links[1]?.classList.add('active');
  if (p === 'owner') links[2]?.classList.add('active');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** الانتقال للصفحة الرئيسية وتمرير صندوق البحث */
function scrollToSearch() {
  showPage('home');
  setTimeout(() => {
    document.getElementById('search-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 150);
}

/** الانتقال لصفحة تسجيل الدخول */
function goToLogin() { showPage('login'); }

/** الانتقال للوحة التحكم */
function goToDashboard() {
  closeUserDropdown();
  showPage('dashboard');
}


/* ================================================================
   📋 القسم التاسع: مودال الحجز
   ================================================================ */

/**
 * يفتح مودال الحجز لمساحة معينة
 * @param {number} spaceId — رقم المساحة
 */
function openBooking(spaceId) {
  const s = SPACES.find(x => x.id === spaceId);
  if (!s) return;

  // استخرج الأحجام والأسعار
  const sizePrices = {};
  const sizesClean = [];
  (s.sizes || []).forEach(sz => {
    const parts = sz.split(':');
    const label = parts[0].trim();
    const price = parts[1] ? parseInt(parts[1]) : s.price;
    sizePrices[label] = price;
    sizesClean.push(label);
  });

  // اقرأ الحجم المختار من الكارد (لو الشخص اختار حجم قبل ما يضغط احجز)
  const activeChip = document.querySelector('.space-card .size-chip.on[data-price]');
  const selSize    = activeChip ? activeChip.dataset.size  : sizesClean[0] || '';
  const selPrice   = activeChip ? activeChip.dataset.price : (sizePrices[sizesClean[0]] || s.price);

  // اعرض معلومات المساحة في المودال
  document.getElementById('msi-name').textContent = s.name;
  document.getElementById('msi-meta').innerHTML =
    `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(selPrice).toLocaleString('ar-EG')} ج/شهر</strong>`;

  // ملّي select الحجم
  const sizeSelect = document.getElementById('bk-size');
  sizeSelect.innerHTML = '<option value="">اختر الحجم</option>' +
    sizesClean.map(sz =>
      `<option value="${sz}" ${sz === selSize ? 'selected' : ''}>${sz}</option>`
    ).join('') +
    '<option value="مخصص">مخصص — هحدده لاحقاً</option>';

  // لما يغير الحجم يتغير السعر في المعلومات
  sizeSelect.onchange = function() {
    const p = sizePrices[this.value] || s.price;
    document.getElementById('msi-meta').innerHTML =
      `📍 ${s.loc} · <strong style="color:var(--orange)">${Number(p).toLocaleString('ar-EG')} ج/شهر</strong>`;
  };

  // إعادة ضبط الفورم
  document.getElementById('modal-form-wrap').style.display = 'block';
  document.getElementById('modal-success').style.display   = 'none';
  document.getElementById('bk-error').style.display        = 'none';
  ['bk-name','bk-phone','bk-email','bk-other-act','bk-notes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const durEl = document.getElementById('bk-dur');
  if (durEl) durEl.value = '';
  const otherWrap = document.getElementById('other-act-wrap');
  if (otherWrap) otherWrap.style.display = 'none';
  document.querySelectorAll('.act-pick-btn').forEach(b => b.classList.remove('on'));

  // لو الشخص اختار نشاط في الفلتر، حدده تلقائياً في المودال
  if (selectedAct) {
    const btn = document.querySelector(`.act-pick-btn[data-id="${selectedAct}"]`);
    if (btn) {
      btn.classList.add('on');
      if (otherWrap) otherWrap.style.display = (selectedAct === 'other') ? 'block' : 'none';
    }
  }

  document.getElementById('booking-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** إغلاق المودال */
function closeModal() {
  document.getElementById('booking-modal').classList.remove('open');
  document.body.style.overflow = '';
}

/** إغلاق المودال لو ضغط على الخلفية */
function closeModalOnBg(e) {
  if (e.target === document.getElementById('booking-modal')) closeModal();
}


/* ================================================================
   📬 القسم العاشر: إرسال طلب الحجز لـ Google Sheets
   ================================================================ */

/** إرسال بيانات الحجز */
async function submitBooking() {
  const name     = document.getElementById('bk-name').value.trim();
  const phone    = document.getElementById('bk-phone').value.trim();
  const email    = document.getElementById('bk-email').value.trim();
  const actBtn   = document.querySelector('.act-pick-btn.on');
  const otherAct = document.getElementById('bk-other-act').value.trim();
  const size     = document.getElementById('bk-size').value;
  const dur      = document.getElementById('bk-dur').value;
  const date     = document.getElementById('bk-date').value;
  const notes    = document.getElementById('bk-notes').value.trim();

  // التحقق من صحة البيانات
  if (!name)  { showFormError('من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    showFormError('من فضلك ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!actBtn) { showFormError('من فضلك اختار نوع نشاطك التجاري'); return; }

  document.getElementById('bk-error').style.display = 'none';

  // تعطيل زرار الإرسال أثناء الانتظار
  const submitBtn     = document.querySelector('#modal-form-wrap .btn-primary');
  const origText      = submitBtn.innerHTML;
  submitBtn.innerHTML = '⏳ جاري الإرسال…';
  submitBtn.disabled  = true;
  submitBtn.style.opacity = '0.7';

  // استخرج معلومات المساحة من المودال
  const spaceName  = document.getElementById('msi-name').textContent;
  const metaText   = document.getElementById('msi-meta').textContent;
  const locMatch   = metaText.match(/📍\s*([^·]+)/);
  const priceMatch = metaText.match(/([\d,٠-٩]+\s*ج)/);
  const spaceLoc   = locMatch   ? locMatch[1].trim()   : '';
  const spacePrice = priceMatch ? priceMatch[1].trim() : '';

  // البيانات التي ستُرسَل للشيت
  const payload = {
    name, phone, email,
    spaceName, spaceLoc, spacePrice,
    activity: actBtn ? actBtn.textContent : '',
    otherAct, size,
    duration: dur,
    startDate: date,
    notes,
  };

  try {
    // إرسال البيانات لـ Google Apps Script
    // no-cors: لأن Apps Script لا يدعم CORS الكامل
    await fetch(BOOKING_URL, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    // نجاح الإرسال — أظهر رسالة النجاح
    document.getElementById('modal-form-wrap').style.display = 'none';
    document.getElementById('modal-success').style.display   = 'block';

  } catch (fetchErr) {
    // فشل الإرسال — أعِد تفعيل الزرار وأظهر رسالة الخطأ
    submitBtn.innerHTML     = origText;
    submitBtn.disabled      = false;
    submitBtn.style.opacity = '1';
    showFormError('في مشكلة في إرسال الطلب — تأكد من الاتصال بالإنترنت وحاول تاني');
  }
}

/** عرض رسالة خطأ في المودال */
function showFormError(msg) {
  const el = document.getElementById('bk-error');
  if (!el) return;
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


/* ================================================================
   🔐 القسم الحادي عشر: نظام تسجيل الدخول (Supabase Auth)
   ================================================================ */

/**
 * يُهيّئ نظام المصادقة عند فتح الصفحة
 * يتحقق من وجود جلسة مستخدم مسجّل
 */
async function initAuth() {
  if (!sbClient) return;

  try {
    // تحقق من الجلسة الحالية
    const { data: { session } } = await sbClient.auth.getSession();

    if (session?.user) {
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      setNavUser(session.user, profile);
    } else {
      setNavUser(null, null);
    }
  } catch (_) {
    setNavUser(null, null);
  }

  // استمع لأي تغيير في حالة تسجيل الدخول
  // (مثلاً لو سجّل من نافذة ثانية، أو بعد Google OAuth)
  sbClient.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      const { data: profile } = await sbClient
        .from('profiles').select('*').eq('id', session.user.id).single();
      setNavUser(session.user, profile);

      // لو رجع من Google OAuth — ابعته للداشبورد
      if (document.getElementById('pg-login')?.classList.contains('active') ||
          document.getElementById('pg-signup')?.classList.contains('active')) {
        await loadDashboardData(session.user);
        showPage('dashboard');
      }
    } else if (event === 'SIGNED_OUT') {
      setNavUser(null, null);
    }
  });
}

/**
 * يحدّث شريط التنقل حسب حالة المستخدم
 * @param {object|null} user — بيانات المستخدم أو null لو زائر
 * @param {object|null} profile — بيانات الـ profile من قاعدة البيانات
 */
function setNavUser(user, profile) {
  const guestEl  = document.getElementById('nav-guest');
  const loggedEl = document.getElementById('nav-logged');
  if (!guestEl || !loggedEl) return;

  if (!user) {
    // زائر غير مسجّل
    guestEl.style.display  = 'flex';
    loggedEl.style.display = 'none';
    return;
  }

  const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const email     = user.email || '';
  const initial   = name.trim()[0] || '؟';
  const roleMap   = { tenant: 'مستأجر', owner: 'صاحب مساحة' };
  const roleLabel = roleMap[profile?.role] || 'مستخدم';

  // أخفِ زرار "دخول" وأظهر الأفاتار
  guestEl.style.display  = 'none';
  loggedEl.style.display = 'flex';

  // بيانات الأفاتار في الـ Navbar
  const circleEl = document.getElementById('nav-av-circle');
  const nameEl   = document.getElementById('nav-av-name');
  const emailEl  = document.getElementById('nav-av-email');
  if (circleEl) circleEl.textContent = initial;
  if (nameEl)   nameEl.textContent   = name;
  if (emailEl)  emailEl.textContent  = email;

  // بيانات القائمة المنسدلة
  const ddName  = document.getElementById('dd-name');
  const ddEmail = document.getElementById('dd-email');
  const ddRole  = document.getElementById('dd-role');
  if (ddName)  ddName.textContent  = name;
  if (ddEmail) ddEmail.textContent = email;
  if (ddRole)  ddRole.textContent  = roleLabel;
}


/* ================================================================
   🔽 القسم الثاني عشر: القائمة المنسدلة للمستخدم
   ================================================================ */

/** فتح أو إغلاق القائمة المنسدلة */
function toggleUserDropdown() {
  const btn = document.getElementById('nav-avatar-btn');
  const dd  = document.getElementById('nav-dropdown');
  if (!btn || !dd) return;
  const isOpen = dd.classList.contains('open');
  isOpen ? closeUserDropdown() : (btn.classList.add('open'), dd.classList.add('open'));
}

/** إغلاق القائمة المنسدلة */
function closeUserDropdown() {
  document.getElementById('nav-avatar-btn')?.classList.remove('open');
  document.getElementById('nav-dropdown')?.classList.remove('open');
}

// إغلاق القائمة لو ضغط المستخدم في أي مكان آخر
document.addEventListener('click', e => {
  const area = document.getElementById('nav-avatar-btn');
  if (area && !area.contains(e.target)) closeUserDropdown();
});


/* ================================================================
   📧 القسم الثالث عشر: تسجيل الدخول بالبريد الإلكتروني
   ================================================================ */

/** تسجيل دخول بالبريد وكلمة المرور */
async function doEmailLogin() {
  if (!sbClient) return;
  clearAuthAlert('login-alert');

  const email = document.getElementById('li-email')?.value.trim();
  const pass  = document.getElementById('li-pass')?.value;

  if (!email) { showAuthAlert('login-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass)  { showAuthAlert('login-alert', 'error', 'من فضلك ادخل كلمة المرور'); return; }

  setBtnLoading('btn-login-submit', true);
  const { data, error } = await sbClient.auth.signInWithPassword({ email, password: pass });
  setBtnLoading('btn-login-submit', false, 'تسجيل الدخول ←');

  if (error) {
    // ترجمة رسائل الخطأ للعربية
    const msgs = {
      'Invalid login credentials': 'البريد الإلكتروني أو كلمة المرور غلط',
      'Email not confirmed':       'لازم تأكد بريدك الإلكتروني الأول — فتش في الـ Inbox',
      'Too many requests':         'كتر طلبات تسجيل الدخول — انتظر قليلاً وحاول تاني',
    };
    showAuthAlert('login-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  await loadDashboardData(data.user);
  showPage('dashboard');
}


/* ================================================================
   ✍️ القسم الرابع عشر: إنشاء حساب جديد
   ================================================================ */

/** إنشاء حساب جديد بالبريد وكلمة المرور */
async function doEmailSignup() {
  if (!sbClient) return;
  clearAuthAlert('signup-alert');

  const name  = document.getElementById('su-name')?.value.trim();
  const phone = document.getElementById('su-phone')?.value.trim();
  const email = document.getElementById('su-email')?.value.trim();
  const pass  = document.getElementById('su-pass')?.value;
  const role  = document.getElementById('su-role')?.value;
  const city  = document.getElementById('su-city')?.value;

  // التحقق من صحة البيانات
  if (!name)  { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل اسمك الكريم'); return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    showAuthAlert('signup-alert', 'error', 'ادخل رقم موبايل صحيح (١٠ أرقام على الأقل)'); return;
  }
  if (!email) { showAuthAlert('signup-alert', 'error', 'من فضلك ادخل البريد الإلكتروني'); return; }
  if (!pass || pass.length < 8) {
    showAuthAlert('signup-alert', 'error', 'كلمة المرور لازم تكون ٨ أحرف على الأقل'); return;
  }
  if (!role)  { showAuthAlert('signup-alert', 'error', 'من فضلك اختار نوع حسابك'); return; }

  setBtnLoading('btn-signup-submit', true);

  // إنشاء المستخدم في Supabase Auth
  const { data, error } = await sbClient.auth.signUp({
    email,
    password: pass,
    options: {
      // رابط التأكيد الذي يُرسَل بالبريد
      emailRedirectTo: window.location.origin,
      // بيانات إضافية تُحفظ مع المستخدم
      data: { full_name: name, phone, role, city }
    }
  });

  setBtnLoading('btn-signup-submit', false, 'إنشاء حساب ←');

  if (error) {
    const msgs = {
      'User already registered': 'البريد ده مسجّل بالفعل — سجّل دخولك',
      'Password should be at least 6 characters': 'كلمة المرور قصيرة — لازم ٦ أحرف على الأقل',
    };
    showAuthAlert('signup-alert', 'error', msgs[error.message] || error.message);
    return;
  }

  // حفظ بيانات المستخدم في جدول profiles
  // (يحدث تلقائياً إذا كان عندك Trigger في Supabase، لكن نعمله يدوياً كاحتياط)
  if (data.user) {
    await sbClient.from('profiles').upsert({
      id:         data.user.id,
      full_name:  name,
      phone:      phone,
      role:       role,
      city:       city,
      created_at: new Date().toISOString()
    }, { onConflict: 'id' });
  }

  // أظهر صفحة "اتحقق من بريدك"
  const addrEl = document.getElementById('confirm-em-addr');
  if (addrEl) addrEl.textContent = email;
  showPage('confirm');
}


/* ================================================================
   🌐 القسم الخامس عشر: تسجيل الدخول بـ Google
   ================================================================ */

/** تسجيل الدخول أو إنشاء حساب عبر Google OAuth */
async function authWithGoogle() {
  if (!sbClient) return;
  const { error } = await sbClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      // بعد تسجيل الدخول، يرجع المستخدم لنفس الموقع
      redirectTo: window.location.origin
    }
  });
  if (error) {
    showAuthAlert('login-alert', 'error', 'في مشكلة مع Google: ' + error.message);
  }
}


/* ================================================================
   🚪 القسم السادس عشر: تسجيل الخروج
   ================================================================ */

/** تسجيل الخروج وإعادة الـ Navbar للحالة الأصلية */
async function doLogout() {
  if (!sbClient) return;
  closeUserDropdown();
  await sbClient.auth.signOut();
  setNavUser(null, null);
  showPage('home'); // رجّعه للصفحة الرئيسية
}


/* ================================================================
   🏠 القسم السابع عشر: لوحة التحكم (Dashboard)
   ================================================================ */

/**
 * يحمّل بيانات المستخدم ويملأ لوحة التحكم
 * @param {object} user — بيانات المستخدم من Supabase
 */
async function loadDashboardData(user) {
  if (!sbClient) return;

  // جيب الـ profile من قاعدة البيانات
  const { data: profile } = await sbClient
    .from('profiles').select('*').eq('id', user.id).single();

  const name      = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'مستخدم';
  const firstName = name.split(' ')[0];
  const roleMap   = { tenant: 'مستأجر — صاحب مشروع', owner: 'صاحب مساحة' };
  const roleLabel = roleMap[profile?.role] || 'مستخدم';
  const dateStr   = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
    : '—';

  // ملّي عناصر الصفحة بالبيانات
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('dash-firstname', firstName);
  set('dpf-name',       name);
  set('dpf-email',      user.email || '—');
  set('dpf-phone',      profile?.phone || '—');
  set('dpf-city',       profile?.city  || '—');
  set('dpf-role',       roleLabel);
  set('dpf-date',       dateStr);

  const badge = document.getElementById('dash-role-badge');
  if (badge) {
    badge.textContent = roleLabel;
    badge.className   = 'dash-role-badge' + (profile?.role === 'owner' ? ' owner' : '');
  }

  // حدّث الـ Navbar أيضاً
  setNavUser(user, profile);
}


/* ================================================================
   🛠️ القسم الثامن عشر: دوال مساعدة مشتركة
   ================================================================ */

/** عرض رسالة تنبيه في صفحات Auth */
function showAuthAlert(containerId, type, msg) {
  const icons = { error: '⚠️', success: '✅', info: '💡' };
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="auth-alert auth-alert-${type}"><span>${icons[type] || '💡'}</span><span>${msg}</span></div>`;
}

/** مسح رسالة التنبيه */
function clearAuthAlert(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

/** تعطيل / تفعيل زرار مع إظهار حالة التحميل */
function setBtnLoading(id, on, orig) {
  const b = document.getElementById(id);
  if (!b) return;
  b.disabled = on;
  if (on)         b.innerHTML = `<span class="spin-sm"></span> جاري التحميل…`;
  else if (orig)  b.innerHTML = orig;
}

/** إظهار / إخفاء كلمة المرور */
function togglePassVis(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}
