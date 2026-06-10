/* ================================================================
   📁 bazaars/organize.js — منطق صفحة تنظيم البازار
   ================================================================
   صفحة من 3 خطوات للمنظمين الموثّقين لتقديم طلب تنظيم بازار.
   الطلب يُرسَل إلى Supabase بـ status = 'pending_review'
   ثم يراجعه الفريق من لوحة تحكم البازارات.
   ================================================================ */

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';

const MAX_EXTRA_IMAGES = 4;

let sbClient    = null;
let currentUser = null;
let orgProfile  = null;
let currentStep = 1;

// حالة رفع الصور
let coverUpload = { url: null, promise: null };
let sketchUpload = { url: null, promise: null };
let extraUploads = Array.from({ length: MAX_EXTRA_IMAGES }, () => ({ url: null, promise: null }));

document.addEventListener('DOMContentLoaded', async () => {
  sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: { session } } = await sbClient.auth.getSession();
  currentUser = session?.user || null;

  if (!currentUser) {
    _showGuard('lock',
      'يجب تسجيل الدخول أولاً',
      'هذه الصفحة مخصصة للمنظمين الموثّقين فقط. سجّل الدخول للمتابعة.',
      `<a href="/?p=login&redirect=/bazaars/organize.html" class="org-nav-next" style="display:inline-block;text-decoration:none;padding:11px 28px">تسجيل الدخول</a>`
    );
    return;
  }

  const { data: prof } = await sbClient
    .from('organizer_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  orgProfile = prof;

  if (!prof?.is_verified) {
    _showGuard('star',
      'مخصوص للمنظمين الموثّقين',
      'يجب أن يكون حسابك موثّقاً كمنظم بازارات على مكاني Spot لتتمكن من تقديم طلب تنظيم. قدّم طلب التوثيق أولاً.',
      `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
         <a href="/bazaars/verification.html" class="org-nav-next" style="display:inline-block;text-decoration:none;padding:11px 28px">طلب التوثيق</a>
         <a href="/bazaars/profile.html" class="org-nav-back" style="display:inline-block;text-decoration:none;padding:11px 22px">ملفي الشخصي</a>
       </div>`
    );
    return;
  }

  _showForm();

  const phoneEl = document.getElementById('o-phone');
  if (phoneEl && prof.whatsapp) phoneEl.value = prof.whatsapp;
});

/* ──────────────────────────────────────────────────────
   حراسة الوصول
────────────────────────────────────────────────────── */
function _showGuard(ico, title, desc, actionsHtml) {
  const icoMap = { lock: '🔒', star: '⭐', ok: '✅' };
  document.getElementById('guard-ico').textContent   = icoMap[ico] || '🔒';
  document.getElementById('guard-title').textContent = title;
  document.getElementById('guard-desc').textContent  = desc;
  document.getElementById('guard-actions').innerHTML = actionsHtml || '';

  document.getElementById('org-guard').style.display  = 'block';
  const steps = document.getElementById('org-steps');
  if (steps) steps.style.display = 'none';
  document.querySelectorAll('.org-panel').forEach(p => p.style.display = 'none');
}

function _showForm() {
  document.getElementById('org-guard').style.display = 'none';
  document.getElementById('org-steps').style.display = 'flex';
  document.getElementById('org-panel-1').classList.add('active');
}

/* ──────────────────────────────────────────────────────
   التنقل بين الخطوات
────────────────────────────────────────────────────── */
function orgNext(fromStep) {
  if (fromStep === 1 && !_validateStep1()) return;
  if (fromStep === 2 && !_validateStep2()) return;
  _setStep(fromStep + 1);
  if (fromStep + 1 === 3) _buildSummary();
}

function orgBack(fromStep) {
  _setStep(fromStep - 1);
}

function _setStep(n) {
  currentStep = n;
  document.querySelectorAll('.org-panel').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === n);
  });
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`step-dot-${i}`);
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i < n) dot.classList.add('done');
    if (i === n) dot.classList.add('active');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ──────────────────────────────────────────────────────
   التحقق من المدخلات
────────────────────────────────────────────────────── */
function _validateStep1() {
  const name  = document.getElementById('o-name').value.trim();
  const venue = document.getElementById('o-venue').value.trim();
  const ds    = document.getElementById('o-ds').value;
  const de    = document.getElementById('o-de').value;

  if (!name)  { _focusErr('o-name',  'يجب إدخال اسم البازار'); return false; }
  if (!venue) { _focusErr('o-venue', 'يجب إدخال اسم المكان'); return false; }
  if (!ds)    { _focusErr('o-ds',    'يجب تحديد تاريخ البداية'); return false; }
  if (!de)    { _focusErr('o-de',    'يجب تحديد تاريخ النهاية'); return false; }
  if (de < ds) { _focusErr('o-de',  'تاريخ النهاية يجب أن يكون بعد تاريخ البداية'); return false; }
  if (ds < new Date().toISOString().slice(0, 10)) {
    _focusErr('o-ds', 'تاريخ البداية يجب أن يكون في المستقبل'); return false;
  }
  return true;
}

function _validateStep2() {
  const slots = Number(document.getElementById('o-slots').value);
  const price = Number(document.getElementById('o-price').value);
  if (!slots || slots < 1) { _focusErr('o-slots', 'يجب إدخال عدد الوحدات (1 على الأقل)'); return false; }
  if (!price || price < 0) { _focusErr('o-price', 'يجب إدخال سعر الوحدة'); return false; }
  return true;
}

function _focusErr(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  el.style.borderColor = 'var(--red)';
  el.addEventListener('input', () => el.style.borderColor = '', { once: true });
  alert(msg);
}

/* ──────────────────────────────────────────────────────
   رفع صورة الغلاف
────────────────────────────────────────────────────── */
async function handleCoverImageUpload(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  await _handleSingleUpload(file, 'cover', {
    box:     'o-cover-box',
    ico:     'o-cover-ico',
    lbl:     'o-cover-lbl',
    preview: 'o-cover-preview',
    status:  'o-cover-status',
  }, coverUpload, 'cover');
}

/* ──────────────────────────────────────────────────────
   رفع اسكتش البازار
────────────────────────────────────────────────────── */
async function handleSketchImageUpload(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  await _handleSingleUpload(file, 'sketch', {
    box:     'o-sketch-box',
    ico:     'o-sketch-ico',
    lbl:     'o-sketch-lbl',
    preview: 'o-sketch-preview',
    status:  'o-sketch-status',
  }, sketchUpload, 'sketch');
}

/* ──────────────────────────────────────────────────────
   رفع صورة إضافية (0..MAX_EXTRA_IMAGES-1)
────────────────────────────────────────────────────── */
async function handleExtraImageUpload(idx, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  await _handleSingleUpload(file, `extra-${idx}`, {
    box:     `o-extra-${idx}-box`,
    ico:     `o-extra-${idx}-ico`,
    lbl:     null,
    preview: `o-extra-${idx}-preview`,
    status:  `o-extra-${idx}-status`,
  }, extraUploads[idx], `extra${idx}`);
  // تحديث المرجع في الـ state
  // (لأن extraUploads[idx] object يتشارك المرجع، التعديل عليه مباشرة صحيح)
}

function removeExtraImage(idx) {
  extraUploads[idx] = { url: null, promise: null };
  const box     = document.getElementById(`o-extra-${idx}-box`);
  const preview = document.getElementById(`o-extra-${idx}-preview`);
  const status  = document.getElementById(`o-extra-${idx}-status`);
  const ico     = document.getElementById(`o-extra-${idx}-ico`);
  const rmBtn   = document.getElementById(`o-extra-${idx}-remove`);
  const fileInp = document.getElementById(`o-extra-${idx}-file`);

  if (box) { box.classList.remove('has-img'); box.classList.remove('uploading'); }
  if (preview) { preview.src = ''; preview.style.display = 'none'; }
  if (status) status.innerHTML = '';
  if (ico) ico.style.display = '';
  if (rmBtn) rmBtn.style.display = 'none';
  if (fileInp) fileInp.value = '';
}

/* ──────────────────────────────────────────────────────
   معالج رفع موحّد
────────────────────────────────────────────────────── */
async function _handleSingleUpload(file, kind, ids, stateObj, r2Kind) {
  const boxEl     = ids.box     ? document.getElementById(ids.box)     : null;
  const icoEl     = ids.ico     ? document.getElementById(ids.ico)     : null;
  const lblEl     = ids.lbl     ? document.getElementById(ids.lbl)     : null;
  const previewEl = ids.preview ? document.getElementById(ids.preview) : null;
  const statusEl  = ids.status  ? document.getElementById(ids.status)  : null;

  if (!currentUser || !sbClient) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">يجب تسجيل الدخول قبل رفع الصورة</span>';
    return;
  }

  if (previewEl) { previewEl.src = URL.createObjectURL(file); previewEl.style.display = 'block'; }
  if (boxEl) { boxEl.classList.add('has-img'); boxEl.classList.add('uploading'); }
  if (icoEl) icoEl.style.display = 'none';
  if (lblEl) lblEl.textContent = '⏳ جارٍ الضغط والرفع…';
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--orange)">⏳ ضغط ورفع الصورة…</span>';

  const uploadPromise = _uploadBazaarImage(file, r2Kind)
    .then(url => {
      stateObj.url = url;
      if (boxEl) boxEl.classList.remove('uploading');
      if (lblEl) lblEl.textContent = '✅ تم — اضغط لتغيير الصورة';
      if (statusEl) statusEl.innerHTML = '<span style="color:#15803d">✅ تم الرفع إلى R2</span>';
      // إظهار زر الحذف للصور الإضافية
      const match = kind.match(/^extra-(\d+)$/);
      if (match) {
        const rmBtnEl = document.getElementById(`o-extra-${match[1]}-remove`);
        if (rmBtnEl) rmBtnEl.style.display = 'flex';
      }
      return url;
    })
    .catch(err => {
      stateObj.url = null;
      if (boxEl) boxEl.classList.remove('has-img', 'uploading');
      if (lblEl) lblEl.textContent = '❌ فشل — اضغط للمحاولة مرة أخرى';
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ ${err.message}</span>`;
      throw err;
    })
    .finally(() => { stateObj.promise = null; });

  stateObj.promise = uploadPromise;
}

async function _uploadBazaarImage(file, kind) {
  if (typeof uploadSingleImageToR2 !== 'function') {
    throw new Error('خدمة رفع الصور غير محملة — حدّث الصفحة وحاول مرة أخرى');
  }
  const { data: { session } } = await sbClient.auth.getSession();
  const authToken = session?.access_token;
  if (!authToken) throw new Error('انتهت الجلسة، أعد تسجيل الدخول');
  const path = `bazaars/${currentUser.id}/${kind}-${Date.now()}.webp`;
  return uploadSingleImageToR2(file, path, authToken);
}

async function _resolveUploadUrl(stateObj) {
  if (stateObj.promise) return stateObj.promise;
  return stateObj.url || null;
}

/* ──────────────────────────────────────────────────────
   ملخص التسعير (خطوة 2)
────────────────────────────────────────────────────── */
function orgTogglePremium() {
  const checked = document.getElementById('o-has-premium').checked;
  document.getElementById('org-premium-fields').style.display = checked ? '' : 'none';
  if (!checked) {
    document.getElementById('o-premium-slots').value = '';
    document.getElementById('o-premium-price').value = '';
  }
  orgUpdatePrice();
}

function orgUpdatePrice() {
  const slots        = Number(document.getElementById('o-slots').value) || 0;
  const price        = Number(document.getElementById('o-price').value) || 0;
  const hasPremium   = document.getElementById('o-has-premium')?.checked;
  const premiumSlots = hasPremium ? (Number(document.getElementById('o-premium-slots').value) || 0) : 0;
  const premiumPrice = hasPremium ? (Number(document.getElementById('o-premium-price').value) || 0) : 0;
  const box          = document.getElementById('org-price-preview');

  if (slots > 0 && price > 0) {
    const regularSlots = Math.max(0, slots - premiumSlots);
    const totalRev     = (regularSlots * price) + (premiumSlots * premiumPrice);

    document.getElementById('pp-slots').textContent = regularSlots + ' وحدة';
    document.getElementById('pp-price').textContent = price.toLocaleString('ar-EG') + ' جنيه';
    document.getElementById('pp-total').textContent = totalRev.toLocaleString('ar-EG') + ' جنيه';

    const premRow  = document.getElementById('pp-premium-row');
    const premPRow = document.getElementById('pp-premium-price-row');
    if (hasPremium && premiumSlots > 0 && premiumPrice > 0) {
      if (premRow)  { premRow.style.display  = '';  document.getElementById('pp-premium-slots').textContent = premiumSlots + ' وحدة مميزة ⭐'; }
      if (premPRow) { premPRow.style.display = '';  document.getElementById('pp-premium-price').textContent = premiumPrice.toLocaleString('ar-EG') + ' جنيه'; }
    } else {
      if (premRow)  premRow.style.display  = 'none';
      if (premPRow) premPRow.style.display = 'none';
    }
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

/* ──────────────────────────────────────────────────────
   بناء ملخص البيانات (خطوة 3)
────────────────────────────────────────────────────── */
function _buildSummary() {
  const ds    = document.getElementById('o-ds').value;
  const de    = document.getElementById('o-de').value;
  const slots = Number(document.getElementById('o-slots').value);
  const price = Number(document.getElementById('o-price').value);
  const dep1  = Number(document.getElementById('o-dep1').value) || 0;
  const dep2  = Number(document.getElementById('o-dep2').value) || 0;

  const hasCover   = !!coverUpload.url;
  const hasSketch  = !!(sketchUpload.url || document.getElementById('o-sketch-url')?.value.trim());
  const extraCount = extraUploads.filter(u => u.url).length;

  const fmtDate = d => d ? new Date(d).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : '—';
  const fmtNum  = n => n ? n.toLocaleString('ar-EG') + ' جنيه' : '—';

  const hasPremium   = document.getElementById('o-has-premium')?.checked;
  const premiumSlots = hasPremium ? (Number(document.getElementById('o-premium-slots').value) || 0) : 0;
  const premiumPrice = hasPremium ? (Number(document.getElementById('o-premium-price').value) || 0) : 0;
  const regularSlots = Math.max(0, slots - premiumSlots);
  const totalRev     = (regularSlots * price) + (premiumSlots * premiumPrice);

  const rows = [
    ['اسم البازار',        document.getElementById('o-name').value.trim()],
    ['المكان',             document.getElementById('o-venue').value.trim()],
    ['العنوان',            document.getElementById('o-addr').value.trim() || '—'],
    ['تاريخ البداية',      fmtDate(ds)],
    ['تاريخ النهاية',      fmtDate(de)],
    ['وحدات عادية',        regularSlots + ' وحدة'],
    ['سعر الوحدة',         fmtNum(price)],
    ...(hasPremium && premiumSlots > 0 ? [
      ['وحدات مميزة ⭐',   premiumSlots + ' وحدة'],
      ['سعر المميزة',      fmtNum(premiumPrice)],
    ] : []),
    ['إجمالي الوحدات',     slots + ' وحدة'],
    ['الإيراد المتوقع',    fmtNum(totalRev)],
    ...(dep1 > 0 ? [['العربون الأولي',  fmtNum(dep1)]] : []),
    ...(dep2 > 0 ? [['العربون النهائي', fmtNum(dep2)]] : []),
    ['صورة الغلاف',        hasCover  ? '✅ تم الرفع' : '—'],
    ['خريطة / اسكتش',      hasSketch ? '✅ مضاف'     : '—'],
    ...(extraCount > 0 ? [[`صور إضافية`, `${extraCount} صورة`]] : []),
  ];

  document.getElementById('org-summary-box').innerHTML = `
    <div class="org-summary-title">📋 ملخص طلبك</div>
    ${rows.map(([lbl, val]) => `
      <div class="org-sum-row">
        <span class="org-sum-lbl">${lbl}</span>
        <span class="org-sum-val">${val}</span>
      </div>`).join('')}
  `;
}

/* ──────────────────────────────────────────────────────
   إرسال الطلب
────────────────────────────────────────────────────── */
async function orgSubmit() {
  const phone   = document.getElementById('o-phone').value.trim();
  const consent = document.getElementById('o-consent').checked;

  if (!phone)   { _focusErr('o-phone', 'يجب إدخال رقم التليفون'); return; }
  if (!consent) { alert('يجب الموافقة على شروط العرض العلني للإحصائيات'); return; }

  const btn = document.getElementById('org-submit-btn');
  btn.disabled = true;
  btn.textContent = '⏳ جارٍ الإرسال…';

  try {
    const name     = document.getElementById('o-name').value.trim();
    const venue    = document.getElementById('o-venue').value.trim();
    const addr     = document.getElementById('o-addr').value.trim() || null;
    const ds       = document.getElementById('o-ds').value;
    const de       = document.getElementById('o-de').value;
    const maps     = document.getElementById('o-maps').value.trim() || null;
    const desc     = document.getElementById('o-desc').value.trim() || null;
    const slots    = Number(document.getElementById('o-slots').value);
    const price    = Number(document.getElementById('o-price').value);
    const dep1     = Number(document.getElementById('o-dep1').value) || 0;
    const dep2     = Number(document.getElementById('o-dep2').value) || 0;
    const contract = Number(document.getElementById('o-contract').value) || 0;
    const notes        = document.getElementById('o-notes').value.trim() || null;
    const hasPremium   = document.getElementById('o-has-premium')?.checked;
    const premiumSlots = hasPremium ? (Number(document.getElementById('o-premium-slots').value) || 0) : 0;
    const premiumPrice = hasPremium ? (Number(document.getElementById('o-premium-price').value) || 0) : 0;

    // جمع روابط الصور مع انتظار أي رفع جارٍ
    const [coverUrl, sketchUrl, ...extraUrls] = await Promise.all([
      _resolveUploadUrl(coverUpload),
      _resolveUploadUrl(sketchUpload),
      ...extraUploads.map(_resolveUploadUrl),
    ]);

    // الصور الإضافية (بدون null)
    const validExtras = extraUrls.filter(Boolean);
    // رابط اسكتش يدوي كـ fallback
    const manualSketch = document.getElementById('o-sketch-url')?.value.trim() || null;
    const finalSketch  = sketchUrl || manualSketch;

    const displayName = orgProfile?.full_name
      || (await sbClient.from('profiles').select('full_name').eq('id', currentUser.id).single()).data?.full_name
      || currentUser.email;

    const payload = {
      name,
      organizer:             displayName,
      organizer_id:          currentUser.id,
      is_organizer_verified: true,
      venue_name:            venue,
      venue_address:         addr,
      date_start:            ds,
      date_end:              de,
      maps_link:             maps,
      description:           desc,
      total_slots:           slots,
      price_per_slot:        price,
      deposit_initial:       dep1,
      deposit_final:         dep2,
      total_contract_price:  contract || null,
      contact_phone:         phone,
      organizer_notes:       _buildNotes(notes, finalSketch),
      image:                 coverUrl,
      event_image_url:       coverUrl,
      extra_images:          validExtras.length > 0 ? validExtras : null,
      premium_slots:         premiumSlots || null,
      premium_price:         premiumPrice || null,
      status:                'pending_review',
    };

    const { error } = await sbClient.from('bazaars').insert(payload);
    if (error) throw new Error(error.message);

    document.getElementById('org-result').innerHTML = `
      <div class="org-ok">
        <div class="org-ok-ico">🎉</div>
        <div class="org-ok-title">تم إرسال الطلب بنجاح!</div>
        <div class="org-ok-desc">
          سيراجع فريق مكاني Spot طلبك خلال 48 ساعة وسيتواصل معك على الرقم <strong>${phone}</strong>.
          يمكنك متابعة حالة طلبك من <a href="/bazaars/profile.html" style="color:var(--orange)">ملفك الشخصي</a>.
        </div>
      </div>`;
    btn.style.display = 'none';
    document.querySelector('#org-panel-3 .org-nav-back').style.display = 'none';

  } catch (err) {
    document.getElementById('org-result').innerHTML = `
      <div class="org-err">❌ تعذّر إرسال الطلب: ${_fmtErr(err)}</div>`;
    btn.disabled = false;
    btn.textContent = 'إعادة المحاولة';
  }
}

function _fmtErr(err) {
  const msg = err?.message || String(err || '');
  if (msg.includes('schema cache') || msg.includes('Could not find')) {
    return 'تعذّر مطابقة حقول النموذج — يرجى تحديث الصفحة والمحاولة مرة أخرى.';
  }
  return msg;
}

function _buildNotes(notes, sketchUrl) {
  const parts = [];
  if (notes) parts.push(notes);
  if (sketchUrl) parts.push(`رابط خريطة / اسكتش البازار: ${sketchUrl}`);
  return parts.length ? parts.join('\n\n') : null;
}
