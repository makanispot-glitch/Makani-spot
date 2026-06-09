/* ================================================================
   📁 bazaars/organize.js — منطق صفحة تنظيم البازار
   ================================================================
   صفحة من 3 خطوات للمنظمين الموثّقين لتقديم طلب تنظيم بازار.
   الطلب يُرسَل إلى Supabase بـ status = 'pending_review'
   ثم يراجعه الفريق من لوحة تحكم البازارات.
   ================================================================ */

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';

let sbClient    = null;
let currentUser = null;
let orgProfile  = null;   // organizer_profiles row
let currentStep = 1;
let orgVisualUploads = {
  sketch: { url: null, promise: null },
  event:  { url: null, promise: null },
};

document.addEventListener('DOMContentLoaded', async () => {
  sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // تحقق من تسجيل الدخول والتوثيق
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

  // جلب بيانات organizer_profiles للتحقق من is_verified
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

  // المستخدم موثّق — اعرض النموذج
  _showForm();

  // تعبئة تليفون من البروفايل إن وُجد
  const phoneEl = document.getElementById('o-phone');
  if (phoneEl && prof.whatsapp) {
    phoneEl.value = prof.whatsapp;
  }
});

/* ──────────────────────────────────────────────────────
   حراسة الوصول
────────────────────────────────────────────────────── */
function _showGuard(ico, title, desc, actionsHtml) {
  const guard   = document.getElementById('org-guard');
  const steps   = document.getElementById('org-steps');
  const panels  = document.querySelectorAll('.org-panel');
  const icoMap  = { lock: '🔒', star: '⭐', ok: '✅' };

  document.getElementById('guard-ico').textContent   = icoMap[ico] || '🔒';
  document.getElementById('guard-title').textContent = title;
  document.getElementById('guard-desc').textContent  = desc;
  document.getElementById('guard-actions').innerHTML = actionsHtml || '';

  guard.style.display  = 'block';
  if (steps) steps.style.display = 'none';
  panels.forEach(p => p.style.display = 'none');
}

function _showForm() {
  document.getElementById('org-guard').style.display   = 'none';
  document.getElementById('org-steps').style.display   = 'flex';
  document.getElementById('org-panel-1').classList.add('active');
}

/* ──────────────────────────────────────────────────────
   التنقل بين الخطوات
────────────────────────────────────────────────────── */
function orgNext(fromStep) {
  if (fromStep === 1 && !_validateStep1()) return;
  if (fromStep === 2 && !_validateStep2()) return;

  _setStep(fromStep + 1);

  if (fromStep + 1 === 3) {
    _buildSummary();
  }
}

function orgBack(fromStep) {
  _setStep(fromStep - 1);
}

function _setStep(n) {
  currentStep = n;

  // panels
  document.querySelectorAll('.org-panel').forEach((p, i) => {
    p.classList.toggle('active', i + 1 === n);
  });

  // step dots
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById(`step-dot-${i}`);
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i < n)  dot.classList.add('done');
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

async function handleOrgImageUpload(kind, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const ids = _orgVisualIds(kind);
  const statusEl = document.getElementById(ids.status);
  const previewEl = document.getElementById(ids.preview);
  const boxEl = document.getElementById(ids.box);
  const labelEl = document.getElementById(ids.label);
  const iconEl = document.getElementById(ids.icon);
  const urlEl = document.getElementById(ids.urlInput);

  if (!currentUser || !sbClient) {
    if (statusEl) statusEl.innerHTML = '<span style="color:var(--red)">يجب تسجيل الدخول قبل رفع الصورة</span>';
    return;
  }

  if (previewEl) {
    previewEl.src = URL.createObjectURL(file);
    previewEl.style.display = 'block';
  }
  if (boxEl) boxEl.classList.add('has-img');
  if (iconEl) iconEl.style.display = 'none';
  if (labelEl) labelEl.textContent = 'جارٍ الضغط والرفع إلى Cloudflare R2...';
  if (statusEl) statusEl.innerHTML = '<span style="color:var(--orange)">⏳ ضغط ورفع الصورة...</span>';

  const uploadPromise = _uploadOrgVisual(file, kind)
    .then(url => {
      orgVisualUploads[kind].url = url;
      if (urlEl) urlEl.value = url;
      if (labelEl) labelEl.textContent = 'تم الرفع بنجاح — اضغط لتغيير الصورة';
      if (statusEl) statusEl.innerHTML = '<span style="color:#15803d">✅ تم الضغط والرفع إلى R2</span>';
      return url;
    })
    .catch(err => {
      orgVisualUploads[kind].url = null;
      if (labelEl) labelEl.textContent = 'تعذّر الرفع — اضغط للمحاولة مرة أخرى';
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">❌ ${err.message}</span>`;
      throw err;
    })
    .finally(() => {
      orgVisualUploads[kind].promise = null;
    });

  orgVisualUploads[kind].promise = uploadPromise;
}

function _orgVisualIds(kind) {
  const prefix = kind === 'sketch' ? 'o-sketch' : 'o-event-image';
  return {
    box: `${prefix}-box`,
    icon: `${prefix}-ico`,
    label: `${prefix}-lbl`,
    preview: `${prefix}-preview`,
    status: `${prefix}-status`,
    fileInput: `${prefix}-file`,
    urlInput: prefix,
  };
}

async function _uploadOrgVisual(file, kind) {
  if (typeof uploadSingleImageToR2 !== 'function') {
    throw new Error('خدمة رفع الصور غير محملة. حدّث الصفحة وحاول مرة أخرى.');
  }

  const { data: { session } } = await sbClient.auth.getSession();
  const authToken = session?.access_token;
  if (!authToken) throw new Error('انتهت الجلسة، أعد تسجيل الدخول');

  const safeKind = kind === 'sketch' ? 'sketch' : 'event';
  const path = `bazaars/${currentUser.id}/${safeKind}-${Date.now()}.webp`;
  return uploadSingleImageToR2(file, path, authToken);
}

async function _getOrgVisualUrl(kind) {
  const state = orgVisualUploads[kind];
  if (state?.promise) {
    return await state.promise;
  }
  if (state?.url) return state.url;

  const ids = _orgVisualIds(kind);
  return document.getElementById(ids.urlInput)?.value.trim() || null;
}

/* ──────────────────────────────────────────────────────
   ملخص التسعير (خطوة 2)
────────────────────────────────────────────────────── */
function orgUpdatePrice() {
  const slots = Number(document.getElementById('o-slots').value) || 0;
  const price = Number(document.getElementById('o-price').value) || 0;
  const box   = document.getElementById('org-price-preview');

  if (slots > 0 && price > 0) {
    document.getElementById('pp-slots').textContent = slots + ' وحدة';
    document.getElementById('pp-price').textContent = price.toLocaleString('ar-EG') + ' جنيه';
    document.getElementById('pp-total').textContent = (slots * price).toLocaleString('ar-EG') + ' جنيه';
    box.style.display = 'block';
  } else {
    box.style.display = 'none';
  }
}

/* ──────────────────────────────────────────────────────
   بناء ملخص البيانات (خطوة 3)
────────────────────────────────────────────────────── */
function _buildSummary() {
  const ds       = document.getElementById('o-ds').value;
  const de       = document.getElementById('o-de').value;
  const slots    = Number(document.getElementById('o-slots').value);
  const price    = Number(document.getElementById('o-price').value);
  const dep1     = Number(document.getElementById('o-dep1').value) || 0;
  const dep2     = Number(document.getElementById('o-dep2').value) || 0;
  const sketch   = document.getElementById('o-sketch')?.value.trim() || '';
  const eventImg = document.getElementById('o-event-image')?.value.trim() || '';

  const fmtDate = d => d ? new Date(d).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' }) : '—';
  const fmtNum  = n => n ? n.toLocaleString('ar-EG') + ' جنيه' : '—';

  const rows = [
    ['اسم البازار',    document.getElementById('o-name').value.trim()],
    ['المكان',         document.getElementById('o-venue').value.trim()],
    ['العنوان',        document.getElementById('o-addr').value.trim() || '—'],
    ['تاريخ البداية',  fmtDate(ds)],
    ['تاريخ النهاية',  fmtDate(de)],
    ['عدد الوحدات',    slots + ' وحدة'],
    ['سعر الوحدة',     fmtNum(price)],
    ['الإيراد المتوقع', fmtNum(slots * price)],
    ['العربون الأولي', dep1 > 0 ? fmtNum(dep1) : '—'],
    ['العربون النهائي', dep2 > 0 ? fmtNum(dep2) : '—'],
    ...(sketch   ? [['خريطة / اسكتش', '✅ رابط مضاف']] : []),
    ...(eventImg ? [['صورة واقعية',   '✅ رابط مضاف']] : []),
  ];

  const box = document.getElementById('org-summary-box');
  box.innerHTML = `
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
    const notes    = document.getElementById('o-notes').value.trim() || null;
    const sketch   = await _getOrgVisualUrl('sketch');
    const eventImg = await _getOrgVisualUrl('event');

    const displayName = orgProfile?.full_name
      || (await sbClient.from('profiles').select('full_name').eq('id', currentUser.id).single()).data?.full_name
      || currentUser.email;

    const payload = {
      name,
      organizer:              displayName,
      organizer_id:           currentUser.id,
      is_organizer_verified:  true,
      venue_name:             venue,
      venue_address:          addr,
      date_start:             ds,
      date_end:               de,
      maps_link:              maps,
      description:            desc,
      total_slots:            slots,
      price_per_slot:         price,
      deposit_initial:        dep1,
      deposit_final:          dep2,
      total_contract_price:   contract || null,
      contact_phone:          phone,
      organizer_notes:        _combineOrganizerNotes(notes, sketch),
      image:                  eventImg,
      status:                 'pending_review',
    };

    const { error } = await sbClient.from('bazaars').insert(payload);
    if (error) throw new Error(error.message);

    // نجح الإرسال
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
    const msg = _formatSubmitError(err);
    document.getElementById('org-result').innerHTML = `
      <div class="org-err">❌ تعذّر إرسال الطلب: ${msg}</div>`;
    btn.disabled = false;
    btn.textContent = 'إعادة المحاولة';
  }
}

function _formatSubmitError(err) {
  const message = err?.message || String(err || '');
  if (message.includes('schema cache') || message.includes('Could not find')) {
    return 'حدث عدم تطابق بين حقول النموذج وجدول Supabase. حدّث الصفحة وحاول مرة أخرى.';
  }
  return message;
}

function _combineOrganizerNotes(notes, sketchUrl) {
  const parts = [];
  if (notes) parts.push(notes);
  if (sketchUrl) parts.push(`رابط خريطة / اسكتش البازار: ${sketchUrl}`);
  return parts.length ? parts.join('\n\n') : null;
}
