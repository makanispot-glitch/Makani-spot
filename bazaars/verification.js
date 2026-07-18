/* ================================================================
   📁 bazaars/verification.js — صفحة طلب توثيق المنظم
   ================================================================ */

/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */

let sbClient  = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await sbClient.auth.getSession();
    currentUser = session?.user || null;
  } catch (e) {
    console.warn('Supabase init failed:', e.message);
  }

  if (!currentUser) {
    document.getElementById('vr-form-body').style.display = 'none';
    document.getElementById('vr-login-wall').style.display  = 'block';
    return;
  }

  /* إزالة زر تغيير اللغة القديم إذا كان مسجلاً */
  const langBtn = document.getElementById('langSwitchBtn');
  if (langBtn && currentUser) {
    langBtn.remove();
  }

  /* جرس الإشعارات الموحّد — نفس موقعه في كل صفحات البازارات */
  try { GN.init(sbClient, currentUser.id); GN.mount(document.querySelector('.bz-nav-right')); } catch (_) {}

  // Pre-fill name & phone from profile
  try {
    const { data } = await sbClient
      .from('profiles')
      .select('full_name, phone')
      .eq('id', currentUser.id)
      .single();
    if (data?.full_name) document.getElementById('vr-name').value  = data.full_name;
    if (data?.phone)     document.getElementById('vr-phone').value = data.phone;
  } catch (_) {}

  // Check if request already submitted
  try {
    const { data: existing } = await sbClient
      .from('organizer_requests')
      .select('status')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing) {
      _vrExistingStatus = existing.status;
      _showAlreadySubmitted(existing.status);
    }
  } catch (_) {}
});

/* 🌐 دعم اللغتين — إعادة رسم المحتوى الديناميكي عند تبديل اللغة */
let _vrExistingStatus = null;
document.addEventListener('makani:locale-changed', () => {
  if (_vrExistingStatus) _showAlreadySubmitted(_vrExistingStatus);
});


/* ── حالة: طلب مقدّم مسبقاً ── */
function _showAlreadySubmitted(status) {
  const statusMap = {
    pending:  { icon: '⏳', title: t('verification.alreadySubmitted.pendingTitle'),  sub: t('verification.alreadySubmitted.pendingDesc'),  color: '#d97706' },
    approved: { icon: '✅', title: t('verification.alreadySubmitted.approvedTitle'), sub: t('verification.alreadySubmitted.approvedDesc'), color: '#16a34a' },
    rejected: { icon: '❌', title: t('verification.alreadySubmitted.rejectedTitle'), sub: t('verification.alreadySubmitted.rejectedDesc'), color: '#dc2626' },
  };
  const s = statusMap[status] || statusMap.pending;

  if (status !== 'rejected') {
    document.getElementById('vr-form-body').style.display = 'none';
    document.getElementById('vr-success').style.display   = 'none';
  }

  let wall = document.getElementById('vr-status-wall');
  if (!wall) {
    wall = document.createElement('div');
    wall.id = 'vr-status-wall';
    wall.style.cssText = 'text-align:center;padding:60px 24px;background:var(--surface);border-radius:16px;border:1px solid var(--border);margin-bottom:20px';
    document.querySelector('.vr-form-wrap').prepend(wall);
  }
  wall.innerHTML = `
    <div style="font-size:52px;margin-bottom:16px">${s.icon}</div>
    <div style="font-size:20px;font-weight:900;color:${s.color};margin-bottom:10px">${s.title}</div>
    <div style="font-size:14px;color:var(--ink2);line-height:1.8;max-width:400px;margin:0 auto 24px">${s.sub}</div>
    <a href="/bazaars/profile.html" class="btn btn-primary" style="padding:12px 28px;display:inline-block">
      ${t('verification.success.profileBtn')}
    </a>`;
}


/* ── تبديل قسم الخبرة ── */
function setVrExperience(hasExp) {
  const yesBtn  = document.getElementById('vr-exp-yes-btn');
  const noBtn   = document.getElementById('vr-exp-no-btn');
  const details = document.getElementById('vr-exp-details');
  if (!yesBtn || !noBtn || !details) return;

  yesBtn.classList.toggle('active', hasExp);
  noBtn.classList.toggle('active', !hasExp);
  details.style.display = hasExp ? 'block' : 'none';

  yesBtn.dataset.selected = hasExp  ? '1' : '';
  noBtn.dataset.selected  = !hasExp ? '1' : '';
}


/* ── معاينة صورة البطاقة ── */
function handleIdUpload(type, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const previewEl = document.getElementById(`vr-${type}-preview`);
  const boxEl     = document.getElementById(`vr-${type}-box`);
  if (!previewEl || !boxEl) return;

  const reader = new FileReader();
  reader.onload = e => {
    previewEl.src           = e.target.result;
    previewEl.style.display = 'block';
    boxEl.classList.add('has-img');
    const ico = boxEl.querySelector('.vr-upload-ico');
    const lbl = boxEl.querySelector('.vr-upload-lbl');
    if (ico) ico.style.display = 'none';
    if (lbl) lbl.textContent   = t('verification.upload.doneLabel');
  };
  reader.readAsDataURL(file);
}


/* ── رفع صورة الهوية على R2 بعد ضغطها إلى WebP ── */
async function uploadIdImage(file, side) {
  if (!currentUser) throw new Error(t('profile.upload.loginRequired'));
  const { data: { session } } = await sbClient.auth.getSession();
  const authToken = session?.access_token;
  if (!authToken) throw new Error(t('organize.upload.sessionExpired'));

  const path = `id-cards/${currentUser.id}/${side}-${Date.now()}.webp`;
  return uploadSingleImageToR2(file, path, authToken);
}


/* ── إرسال طلب التوثيق ── */
async function submitVerificationRequest() {
  const errorEl   = document.getElementById('vr-error');
  const submitBtn = document.getElementById('vr-submit-btn');
  const showErr   = msg => {
    if (!errorEl) return;
    errorEl.textContent   = '⚠ ' + msg;
    errorEl.style.display = 'block';
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  if (errorEl) errorEl.style.display = 'none';

  const name      = document.getElementById('vr-name')?.value.trim()   || '';
  const phone     = document.getElementById('vr-phone')?.value.trim()  || '';
  const region    = document.getElementById('vr-region')?.value.trim() || '';
  const frontFile = document.getElementById('vr-front-input')?.files?.[0];
  const backFile  = document.getElementById('vr-back-input')?.files?.[0];
  const tradeReg  = document.getElementById('vr-trade-reg')?.value.trim()    || '';
  const hasExp    = document.getElementById('vr-exp-yes-btn')?.dataset.selected === '1';
  const expCount  = document.getElementById('vr-exp-count')?.value.trim()     || '';
  const expLoc    = document.getElementById('vr-exp-locations')?.value.trim() || '';
  const expDesc   = document.getElementById('vr-latest-desc')?.value.trim()   || '';
  const termsCk   = document.getElementById('vr-terms')?.checked;
  const escrowCk  = document.getElementById('vr-escrow')?.checked;

  if (!name)                                          { showErr(t('verification.errors.nameRequired'));   return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) { showErr(t('verification.errors.phoneInvalid'));   return; }
  if (!region)                                        { showErr(t('verification.errors.regionRequired')); return; }
  if (!frontFile)                                     { showErr(t('verification.errors.frontRequired'));  return; }
  if (!backFile)                                      { showErr(t('verification.errors.backRequired'));   return; }
  if (!termsCk)                                       { showErr(t('verification.errors.termsRequired'));  return; }
  if (!escrowCk)                                      { showErr(t('verification.errors.escrowRequired')); return; }

  if (!currentUser) { window.location.href = '/?p=login'; return; }

  if (submitBtn) { submitBtn.textContent = t('verification.submitting'); submitBtn.disabled = true; }

  try {
    const [frontUrl, backUrl] = await Promise.all([
      uploadIdImage(frontFile, 'front'),
      uploadIdImage(backFile,  'back'),
    ]);

    const { error } = await sbClient.from('organizer_requests').insert({
      user_id:         currentUser.id,
      full_name:       name,
      phone,
      region,
      id_front_path:   frontUrl,
      id_back_path:    backUrl,
      trade_reg:       tradeReg || null,
      has_experience:  hasExp,
      exp_count:       hasExp ? expCount : null,
      exp_locations:   hasExp ? expLoc   : null,
      latest_exp_desc: hasExp ? expDesc  : null,
      status:          'pending',
    });

    if (error) throw new Error(error.message);

    document.getElementById('vr-form-body').style.display = 'none';
    document.getElementById('vr-success').style.display   = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    showErr(t('verification.errors.generic', { msg: err.message }));
    if (submitBtn) { submitBtn.textContent = t('verification.submitBtn'); submitBtn.disabled = false; }
  }
}
