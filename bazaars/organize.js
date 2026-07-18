/* ================================================================
   📁 bazaars/organize.js — منطق صفحة تنظيم البازار
   ================================================================
   صفحة من 3 خطوات للمنظمين الموثّقين لتقديم طلب تنظيم بازار.
   الطلب يُرسَل إلى Supabase بـ status = 'pending_review'
   ثم يراجعه الفريق من لوحة تحكم البازارات.
   ================================================================ */

/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */

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
    _activeGuard = { rebuild: () => _showGuard('lock',
      t('organize.guard.loginTitle'),
      t('organize.guard.loginDesc'),
      `<a href="/?p=login&redirect=/bazaars/organize.html" class="org-nav-next" style="display:inline-block;text-decoration:none;padding:11px 28px">${t('organize.guard.loginBtn')}</a>`
    ) };
    _activeGuard.rebuild();
    return;
  }

  /* إزالة زر تغيير اللغة القديم إذا كان مسجلاً */
  const langBtn = document.getElementById('langSwitchBtn');
  if (langBtn && currentUser) {
    langBtn.remove();
  }

  /* جرس الإشعارات الموحّد — نفس موقعه في كل صفحات البازارات */
  try { GN.init(sbClient, currentUser.id); GN.mount(document.querySelector('.bz-nav-right')); } catch (_) {}

  const { data: prof } = await sbClient
    .from('organizer_profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  orgProfile = prof;

  if (!prof?.is_verified) {
    _activeGuard = { rebuild: () => _showGuard('star',
      t('organize.guard.verifiedOnlyTitle'),
      t('organize.guard.verifiedOnlyDesc'),
      `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
         <a href="/bazaars/verification.html" class="org-nav-next" style="display:inline-block;text-decoration:none;padding:11px 28px">${t('organize.guard.verifyBtn')}</a>
         <a href="/bazaars/profile.html" class="org-nav-back" style="display:inline-block;text-decoration:none;padding:11px 22px">${t('organize.guard.profileBtn')}</a>
       </div>`
    ) };
    _activeGuard.rebuild();
    return;
  }

  _showForm();

  const phoneEl = document.getElementById('o-phone');
  if (phoneEl && prof.whatsapp) phoneEl.value = prof.whatsapp;
});

/* 🌐 دعم اللغتين — إعادة رسم المحتوى الديناميكي عند تبديل اللغة */
let _activeGuard = null;
document.addEventListener('makani:locale-changed', () => {
  if (_activeGuard) { _activeGuard.rebuild(); return; }
  if (document.getElementById('org-draft-banner')?.style.display === 'flex') _orgUpdateDraftBannerText();
  if (document.getElementById('org-panel-3')?.classList.contains('active')) _buildSummary();
  orgUpdatePrice();
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
  _activeGuard = null;
  document.getElementById('org-guard').style.display = 'none';
  document.getElementById('org-steps').style.display = 'flex';
  document.querySelectorAll('.org-panel').forEach(p => p.style.display = '');
  _setStep(1);
  setTimeout(() => { _fillOrganizerInfo(); _orgRestoreDraft(); _attachDraftListeners(); }, 60);
}

/* ──────────────────────────────────────────────────────
   معلومات المنظم — تعبئة البطاقة تلقائياً من البروفايل
────────────────────────────────────────────────────── */
function _fillOrganizerInfo() {
  if (!currentUser) return;

  const name = orgProfile?.full_name || currentUser.email?.split('@')[0] || '—';

  const nameEl = document.getElementById('oi-name');
  if (nameEl) nameEl.textContent = name;

  const emailEl = document.getElementById('oi-email');
  if (emailEl) emailEl.textContent = currentUser.email || '';

  const avatarEl = document.getElementById('oi-avatar');
  if (avatarEl) {
    const initial = name[0]?.toUpperCase() || '?';
    if (orgProfile?.avatar_url) {
      avatarEl.innerHTML = `<img src="${orgProfile.avatar_url}" alt="${name}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='${initial}'">`;
    } else {
      avatarEl.textContent = initial;
    }
  }

  const verifiedEl = document.getElementById('oi-verified');
  if (verifiedEl) verifiedEl.style.display = orgProfile?.is_verified ? 'inline-flex' : 'none';

  /* روابط التواصل — تُعبَّأ من البروفايل (يطغى عليها الدرافت لاحقاً في _orgRestoreDraft) */
  const fbEl = document.getElementById('oi-facebook');
  const igEl = document.getElementById('oi-instagram');
  const ttEl = document.getElementById('oi-tiktok');
  if (fbEl) fbEl.value = orgProfile?.facebook_url  || '';
  if (igEl) igEl.value = orgProfile?.instagram_url || '';
  if (ttEl) ttEl.value = orgProfile?.tiktok_url    || '';
}

/* ──────────────────────────────────────────────────────
   التحقق من بيانات المنظم (خطوة 0)
────────────────────────────────────────────────────── */
function _validateStep0() {
  const fb = document.getElementById('oi-facebook')?.value.trim()  || '';
  const ig = document.getElementById('oi-instagram')?.value.trim() || '';
  const tt = document.getElementById('oi-tiktok')?.value.trim()    || '';

  if (!fb && !ig && !tt) {
    alert(t('organize.step1.socialRequired'));
    document.getElementById('oi-facebook')?.focus();
    return false;
  }

  const urlRx = /^https?:\/\/.+/i;
  if (fb && !urlRx.test(fb)) { _focusErr('oi-facebook',  t('organize.step1.facebookInvalid')); return false; }
  if (ig && !urlRx.test(ig)) { _focusErr('oi-instagram', t('organize.step1.instagramInvalid')); return false; }
  if (tt && !urlRx.test(tt)) { _focusErr('oi-tiktok',    t('organize.step1.tiktokInvalid')); return false; }

  return true;
}

/* ──────────────────────────────────────────────────────
   حفظ روابط التواصل في organizer_profiles
────────────────────────────────────────────────────── */
async function _saveOrganizerInfo() {
  if (!currentUser || !sbClient) return;

  const facebook  = document.getElementById('oi-facebook')?.value.trim()  || null;
  const instagram = document.getElementById('oi-instagram')?.value.trim() || null;
  const tiktok    = document.getElementById('oi-tiktok')?.value.trim()    || null;

  /* لا ترسل طلب إذا لم تتغيّر القيم */
  if (
    facebook  === (orgProfile?.facebook_url  || null) &&
    instagram === (orgProfile?.instagram_url || null) &&
    tiktok    === (orgProfile?.tiktok_url    || null)
  ) return;

  const { error } = await sbClient
    .from('organizer_profiles')
    .update({ facebook_url: facebook, instagram_url: instagram, tiktok_url: tiktok })
    .eq('user_id', currentUser.id);

  if (!error && orgProfile) {
    orgProfile.facebook_url  = facebook;
    orgProfile.instagram_url = instagram;
    orgProfile.tiktok_url    = tiktok;
  }
}

/* ──────────────────────────────────────────────────────
   التنقل بين الخطوات
────────────────────────────────────────────────────── */
function orgNext(fromStep) {
  if (fromStep === 1) {
    if (!_validateStep0()) return;
    _saveOrganizerInfo().catch(() => {});
  }
  if (fromStep === 2 && !_validateStep1()) return;
  if (fromStep === 3 && !_validateStep2()) return;
  _setStep(fromStep + 1);
  if (fromStep + 1 === 4) _buildSummary();
}

function orgBack(fromStep) {
  _setStep(fromStep - 1);
}

function _setStep(n) {
  currentStep = n;
  document.querySelectorAll('.org-panel').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === n);
  });
  for (let i = 1; i <= 4; i++) {
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

  if (!name)  { _focusErr('o-name',  t('organize.step2.nameRequired')); return false; }
  if (!venue) { _focusErr('o-venue', t('organize.step2.venueRequired')); return false; }
  if (!ds)    { _focusErr('o-ds',    t('organize.step2.startDateRequired')); return false; }
  if (!de)    { _focusErr('o-de',    t('organize.step2.endDateRequired')); return false; }
  if (de < ds) { _focusErr('o-de',  t('organize.step2.endBeforeStart')); return false; }
  if (ds < new Date().toISOString().slice(0, 10)) {
    _focusErr('o-ds', t('organize.step2.startInPast')); return false;
  }
  return true;
}

function _validateStep2() {
  const slots = Number(document.getElementById('o-slots').value);
  const price = Number(document.getElementById('o-price').value);
  if (!slots || slots < 1) { _focusErr('o-slots', t('organize.step3.slotsRequired')); return false; }
  if (!price || price < 0) { _focusErr('o-price', t('organize.step3.priceRequired')); return false; }

  const hasPremium = document.getElementById('o-has-premium')?.checked;
  if (hasPremium) {
    const premiumSlots = Number(document.getElementById('o-premium-slots').value) || 0;
    const premiumPrice = Number(document.getElementById('o-premium-price').value) || 0;
    if (premiumSlots < 1) { _focusErr('o-premium-slots', t('organize.step3.premiumSlotsRequired')); return false; }
    if (premiumSlots >= slots) { _focusErr('o-premium-slots', t('organize.step3.premiumSlotsMustBeLess', { premium: premiumSlots, total: slots })); return false; }
    if (premiumPrice <= 0) { _focusErr('o-premium-price', t('organize.step3.premiumPriceRequired')); return false; }
    if (premiumPrice <= price) { _focusErr('o-premium-price', t('organize.step3.premiumPriceMustBeHigher', { premium: premiumPrice, regular: price })); return false; }
  }

  const hasShared = document.getElementById('o-has-shared')?.checked;
  if (hasShared) {
    const premiumSlots = hasPremium ? (Number(document.getElementById('o-premium-slots').value) || 0) : 0;
    const regularSlots = Math.max(0, slots - premiumSlots);
    const sharedSlots  = Number(document.getElementById('o-shared-slots').value) || 0;
    if (sharedSlots < 1) { _focusErr('o-shared-slots', t('organize.step3.sharedSlotsRequired')); return false; }
    if (sharedSlots > regularSlots) { _focusErr('o-shared-slots', t('organize.step3.sharedSlotsMustBeLess', { shared: sharedSlots, regular: regularSlots })); return false; }
  }
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
   التحقق من صلاحية ملف الصورة قبل الرفع
────────────────────────────────────────────────────── */
const _IMG_MAX_BYTES  = 8 * 1024 * 1024; // 8 ميجابايت
const _IMG_ALLOWED    = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];

function _validateImgFile(file, statusElId) {
  const statusEl = statusElId ? document.getElementById(statusElId) : null;
  const showErr  = msg => {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red);font-size:12px">❌ ${msg}</span>`;
    else alert(msg);
  };

  if (!_IMG_ALLOWED.includes((file.type || '').toLowerCase())) {
    showErr(t('organize.upload.fileTypeError'));
    return false;
  }
  if (file.size > _IMG_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    showErr(t('organize.upload.fileSizeError', { mb }));
    return false;
  }
  return true;
}

/* ──────────────────────────────────────────────────────
   رفع صورة الغلاف
────────────────────────────────────────────────────── */
async function handleCoverImageUpload(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  if (!_validateImgFile(file, 'o-cover-status')) { inputEl.value = ''; return; }
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
  if (!_validateImgFile(file, 'o-sketch-status')) { inputEl.value = ''; return; }
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
  if (!_validateImgFile(file, `o-extra-${idx}-status`)) { inputEl.value = ''; return; }
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
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">${t('organize.upload.loginRequired')}</span>`;
    return;
  }

  if (previewEl) { previewEl.src = URL.createObjectURL(file); previewEl.style.display = 'block'; }
  if (boxEl) { boxEl.classList.add('has-img'); boxEl.classList.add('uploading'); }
  if (icoEl) icoEl.style.display = 'none';
  if (lblEl) lblEl.textContent = t('organize.upload.compressingLabel');
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--orange)">${t('organize.upload.compressingStatus')}</span>`;

  const uploadPromise = _uploadBazaarImage(file, r2Kind)
    .then(url => {
      stateObj.url = url;
      if (boxEl) boxEl.classList.remove('uploading');
      if (lblEl) lblEl.textContent = t('organize.upload.doneLabel');
      if (statusEl) statusEl.innerHTML = `<span style="color:#15803d">${t('organize.upload.doneStatus')}</span>`;
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
      if (lblEl) lblEl.textContent = t('organize.upload.failedLabel');
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">${t('organize.upload.failedStatus', { msg: err.message })}</span>`;
      throw err;
    })
    .finally(() => { stateObj.promise = null; });

  stateObj.promise = uploadPromise;
}

async function _uploadBazaarImage(file, kind) {
  if (typeof uploadSingleImageToR2 !== 'function') {
    throw new Error(t('organize.upload.serviceNotLoaded'));
  }
  const { data: { session } } = await sbClient.auth.getSession();
  const authToken = session?.access_token;
  if (!authToken) throw new Error(t('organize.upload.sessionExpired'));
  const path = `bazaars/${currentUser.id}/${kind}-${Date.now()}.webp`;
  return uploadSingleImageToR2(file, path, authToken);
}

async function _resolveUploadUrl(stateObj) {
  if (stateObj.promise) return stateObj.promise;
  return stateObj.url || null;
}

/* ──────────────────────────────────────────────────────
   ما الذي يشمله الحجز — تبديل حقل عدد الكراسي
────────────────────────────────────────────────────── */
function orgToggleChairCount() {
  const checked = document.getElementById('o-amen-chair')?.checked;
  const row     = document.getElementById('o-chair-count-row');
  if (row) row.style.display = checked ? '' : 'none';
  if (!checked) document.getElementById('o-chair-count').value = '';
}

/* خريطة مفاتيح التجهيزات (id الشيك بوكس ← التسمية العربية المخزَّنة) */
const AMENITY_MAP = [
  ['o-amen-table',        'ترابيزة'],
  ['o-amen-chair',        'كرسي'],
  ['o-amen-pergola',      'برجولة'],
  ['o-amen-canopy',       'مظلة'],
  ['o-amen-electricity',  'كهرباء'],
  ['o-amen-lighting',     'إنارة'],
  ['o-amen-wifi',         'واي فاي'],
  ['o-amen-water',        'مصدر مياه'],
  ['o-amen-other_services','خدمات أخرى'],
];

function _collectIncludedAmenities() {
  return AMENITY_MAP
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
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

function orgToggleShared() {
  const checked = document.getElementById('o-has-shared').checked;
  document.getElementById('org-shared-fields').style.display = checked ? '' : 'none';
  if (!checked) {
    document.getElementById('o-shared-slots').value = '';
  }
}

function _orgLocale() { return getLocale() === 'en' ? 'en-US' : 'ar-EG'; }
function _orgFmtPrice(n) { return n.toLocaleString(_orgLocale()) + ' ' + t('organize.step3.egp'); }

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

    document.getElementById('pp-slots').textContent = t('organize.step3.unitSuffix', { count: regularSlots });
    document.getElementById('pp-price').textContent = _orgFmtPrice(price);
    document.getElementById('pp-total').textContent = _orgFmtPrice(totalRev);

    const premRow  = document.getElementById('pp-premium-row');
    const premPRow = document.getElementById('pp-premium-price-row');
    if (hasPremium && premiumSlots > 0 && premiumPrice > 0) {
      if (premRow)  { premRow.style.display  = '';  document.getElementById('pp-premium-slots').textContent = t('organize.step3.premiumUnitSuffix', { count: premiumSlots }); }
      if (premPRow) { premPRow.style.display = '';  document.getElementById('pp-premium-price').textContent = _orgFmtPrice(premiumPrice); }
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

  const fmtDate = d => d ? new Date(d).toLocaleDateString(_orgLocale(), { year:'numeric', month:'long', day:'numeric' }) : t('organize.step4.dash');
  const fmtNum  = n => n ? _orgFmtPrice(n) : t('organize.step4.dash');
  const listSep = getLocale() === 'en' ? ', ' : '، ';

  const hasPremium   = document.getElementById('o-has-premium')?.checked;
  const premiumSlots = hasPremium ? (Number(document.getElementById('o-premium-slots').value) || 0) : 0;
  const premiumPrice = hasPremium ? (Number(document.getElementById('o-premium-price').value) || 0) : 0;
  const regularSlots = Math.max(0, slots - premiumSlots);
  const totalRev     = (regularSlots * price) + (premiumSlots * premiumPrice);

  const amenities   = _collectIncludedAmenities();
  const chairCount  = document.getElementById('o-amen-chair')?.checked ? (Number(document.getElementById('o-chair-count').value) || 0) : 0;
  const otherAmen   = document.getElementById('o-amen-other-note')?.value.trim() || '';
  const amenitiesLbl = amenities.length
    ? amenities.map(a => t('amenities.' + a, { defaultValue: a }) + (a === 'كرسي' && chairCount > 1 ? ` (×${chairCount})` : '')).join(listSep) + (otherAmen ? `${listSep}${otherAmen}` : '')
    : (otherAmen || t('organize.step4.dash'));

  const adBudgetSel  = document.getElementById('o-ad-budget');
  const adBudgetLbl  = adBudgetSel?.value ? adBudgetSel.options[adBudgetSel.selectedIndex].text : t('organize.step4.dash');
  const coverageBits = [
    document.getElementById('o-ad-photography')?.checked ? t('manage.info.photographyTitle') : null,
    document.getElementById('o-ad-social')?.checked       ? t('manage.info.socialTitle') : null,
    document.getElementById('o-ad-paidads')?.checked      ? t('manage.info.paidAdsTitle') : null,
  ].filter(Boolean);

  const rows = [
    [t('organize.step4.rowName'),  document.getElementById('o-name').value.trim()],
    [t('organize.step4.rowVenue'), document.getElementById('o-venue').value.trim()],
    [t('organize.step4.rowAddr'),  document.getElementById('o-addr').value.trim() || t('organize.step4.dash')],
    [t('organize.step4.rowStart'), fmtDate(ds)],
    [t('organize.step4.rowEnd'),   fmtDate(de)],
    [t('organize.step3.regularUnitsLabel'), t('organize.step3.unitSuffix', { count: regularSlots })],
    [t('organize.step4.rowUnitPrice'), fmtNum(price)],
    ...(hasPremium && premiumSlots > 0 ? [
      [t('organize.step3.premiumUnitsLabel'), t('organize.step3.unitSuffix', { count: premiumSlots })],
      [t('organize.step4.rowPremiumPrice'),   fmtNum(premiumPrice)],
    ] : []),
    [t('organize.step4.rowTotalUnits'),       t('organize.step3.unitSuffix', { count: slots })],
    [t('organize.step4.rowExpectedRevenue'),  fmtNum(totalRev)],
    ...(dep1 > 0 ? [[t('organize.step4.rowDeposit1'), fmtNum(dep1)]] : []),
    ...(dep2 > 0 ? [[t('organize.step4.rowDeposit2'), fmtNum(dep2)]] : []),
    [t('organize.step4.rowCover'),  hasCover  ? t('organize.step4.uploadedYes') : t('organize.step4.dash')],
    [t('organize.step4.rowSketch'), hasSketch ? t('organize.step4.addedYes')   : t('organize.step4.dash')],
    ...(extraCount > 0 ? [[t('organize.step4.rowExtraImages'), t('organize.step4.imagesCountSuffix', { count: extraCount })]] : []),
    [t('organize.step4.rowAmenities'), amenitiesLbl],
    ...(adBudgetSel?.value ? [[t('organize.step4.rowAdBudget'), adBudgetLbl]] : []),
    ...(coverageBits.length ? [[t('organize.step4.rowCoverage'), coverageBits.join(listSep)]] : []),
  ];

  document.getElementById('org-summary-box').innerHTML = `
    <div class="org-summary-title">${t('organize.step4.summaryBoxTitle')}</div>
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

  if (!phone)   { _focusErr('o-phone', t('organize.step4.phoneRequired')); return; }
  if (!consent) { alert(t('organize.step4.consentRequired')); return; }

  const btn = document.getElementById('org-submit-btn');
  btn.disabled = true;
  btn.textContent = t('organize.step4.submitting');

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
    const hasShared    = document.getElementById('o-has-shared')?.checked;
    const sharedSlots  = hasShared ? (Number(document.getElementById('o-shared-slots').value) || 0) : 0;

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

    // ما الذي يشمله الحجز (التجهيزات)
    const includedAmenities = _collectIncludedAmenities();
    const chairCount = document.getElementById('o-amen-chair')?.checked
      ? (Number(document.getElementById('o-chair-count').value) || null)
      : null;
    const otherAmenitiesNote = document.getElementById('o-amen-other-note')?.value.trim() || null;

    // الدعاية والتغطية الإعلامية
    const adBudgetTier = document.getElementById('o-ad-budget')?.value || null;
    const willHavePhotography    = !!document.getElementById('o-ad-photography')?.checked;
    const willHaveSocialCoverage = !!document.getElementById('o-ad-social')?.checked;
    const willHavePaidAds        = !!document.getElementById('o-ad-paidads')?.checked;

    const payload = {
      name,
      organizer:             displayName,
      organizer_id:          currentUser.id,
      organizer_avatar_url:  orgProfile?.avatar_url || null,
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
      sketch_url:            finalSketch,
      image:                 coverUrl,
      event_image_url:       coverUrl,
      extra_images:          validExtras.length > 0 ? validExtras : null,
      premium_slots:         premiumSlots || null,
      premium_price:         premiumPrice || null,
      shared_slots_allowed:  !!hasShared,
      shared_slots_count:    sharedSlots || 0,
      included_amenities:    includedAmenities,
      chair_count:           chairCount,
      other_amenities_note:  otherAmenitiesNote,
      ad_budget_tier:        adBudgetTier,
      will_have_photography:     willHavePhotography,
      will_have_social_coverage: willHaveSocialCoverage,
      will_have_paid_ads:        willHavePaidAds,
      status:                'pending_review',
    };

    const { error } = await sbClient.from('bazaars').insert(payload);
    if (error) throw new Error(error.message);

    _orgClearDraft();

    document.getElementById('org-result').innerHTML = `
      <div class="org-ok">
        <div class="org-ok-ico">🎉</div>
        <div class="org-ok-title">${t('organize.step4.successTitle')}</div>
        <div class="org-ok-desc">${t('organize.step4.successDesc', { phone })}</div>
      </div>`;
    btn.style.display = 'none';
    document.querySelector('#org-panel-3 .org-nav-back').style.display = 'none';
    document.getElementById('org-result')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  } catch (err) {
    document.getElementById('org-result').innerHTML = `
      <div class="org-err">${t('organize.step4.errorPrefix', { msg: _fmtErr(err) })}</div>`;
    btn.disabled = false;
    btn.textContent = t('organize.step4.retryBtn');
  }
}

function _fmtErr(err) {
  const msg = err?.message || String(err || '');
  if (msg.includes('schema cache') || msg.includes('Could not find')) {
    return t('organize.step4.errorSchemaCache');
  }
  return msg;
}

function _buildNotes(notes, sketchUrl) {
  const parts = [];
  if (notes) parts.push(notes);
  if (sketchUrl) parts.push(`رابط خريطة / اسكتش البازار: ${sketchUrl}`);
  return parts.length ? parts.join('\n\n') : null;
}


/* ══════════════════════════════════════════════════════
   💾 حفظ المسودة تلقائياً في localStorage
══════════════════════════════════════════════════════ */

const _ORG_DRAFT_FIELDS = [
  'oi-facebook','oi-instagram','oi-tiktok',
  'o-name','o-venue','o-addr','o-ds','o-de','o-maps','o-desc',
  'o-slots','o-price','o-dep1','o-dep2','o-contract',
  'o-premium-slots','o-premium-price','o-shared-slots',
  'o-chair-count','o-amen-other-note','o-ad-budget',
  'o-phone','o-notes','o-sketch-url',
];

/* حقول checkbox — تُحفظ/تُستعاد عبر .checked لا .value */
const _ORG_DRAFT_CHECKBOXES = [
  'o-has-premium','o-has-shared',
  ...AMENITY_MAP.map(([id]) => id),
  'o-ad-photography','o-ad-social','o-ad-paidads',
];

function _orgDraftKey() {
  return `mkspot:org-draft:${currentUser?.id || 'anon'}`;
}

function _orgSaveDraft() {
  if (!currentUser) return;
  const data = {};
  _ORG_DRAFT_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  _ORG_DRAFT_CHECKBOXES.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.checked;
  });
  try {
    localStorage.setItem(_orgDraftKey(), JSON.stringify({ ...data, _ts: Date.now() }));
  } catch(_) {}
}

function _orgRestoreDraft() {
  if (!currentUser) return;
  let draft;
  try {
    const raw = localStorage.getItem(_orgDraftKey());
    draft = raw ? JSON.parse(raw) : null;
  } catch(_) { return; }
  if (!draft) return;

  _ORG_DRAFT_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el && draft[id] !== undefined) el.value = draft[id];
  });
  _ORG_DRAFT_CHECKBOXES.forEach(id => {
    const el = document.getElementById(id);
    if (el && draft[id] !== undefined) el.checked = !!draft[id];
  });
  orgToggleChairCount();

  const prem = document.getElementById('o-has-premium');
  if (prem && draft['o-has-premium'] !== undefined) {
    prem.checked = !!draft['o-has-premium'];
    const premSection = document.getElementById('org-premium-fields');
    if (premSection) premSection.style.display = prem.checked ? '' : 'none';
  }

  const shared = document.getElementById('o-has-shared');
  if (shared && draft['o-has-shared'] !== undefined) {
    shared.checked = !!draft['o-has-shared'];
    const sharedSection = document.getElementById('org-shared-fields');
    if (sharedSection) sharedSection.style.display = shared.checked ? '' : 'none';
  }

  const banner = document.getElementById('org-draft-banner');
  if (banner) {
    _draftTs = draft._ts || 0;
    _orgUpdateDraftBannerText();
    banner.style.display = 'flex';
  }
}

let _draftTs = 0;
function _orgUpdateDraftBannerText() {
  const txtEl = document.getElementById('org-draft-banner-txt');
  if (!txtEl) return;
  const mins = Math.round((Date.now() - _draftTs) / 60000);
  const age = mins < 1 ? t('organize.draft.ageJustNow')
    : mins < 60 ? t('organize.draft.ageMinutesAgo', { count: mins })
    : t('organize.draft.agePreviously');
  txtEl.textContent = t('organize.draft.restored', { age });
}

function _orgClearDraft() {
  try { localStorage.removeItem(_orgDraftKey()); } catch(_) {}
  const banner = document.getElementById('org-draft-banner');
  if (banner) banner.style.display = 'none';
}

function orgDiscardDraft() {
  _orgClearDraft();
  _ORG_DRAFT_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  _ORG_DRAFT_CHECKBOXES.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  const premSection = document.getElementById('org-premium-fields');
  if (premSection) premSection.style.display = 'none';
  orgToggleChairCount();
}

let _draftListenersAttached = false;
function _attachDraftListeners() {
  if (_draftListenersAttached) return;
  _draftListenersAttached = true;
  _ORG_DRAFT_FIELDS.forEach(id => {
    document.getElementById(id)?.addEventListener('input', _orgSaveDraft);
  });
  _ORG_DRAFT_CHECKBOXES.forEach(id => {
    document.getElementById(id)?.addEventListener('change', _orgSaveDraft);
  });
}
