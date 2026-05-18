let myProfileData  = null;   // organizer_profiles row
let myUserProfile  = null;   // profiles row (email/phone/city)
/* ================================================================
   📁 bazaars/profile.js — صفحة الملف الشخصي للمنظم
   ================================================================
   - بدون URL param  → الملف الشخصي للمستخدم الحالي (أنا)
   - ?organizer=UUID  → البروفايل العام لمنظم آخر
   ================================================================ */

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';
const BAZAAR_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwb0eB118CzrlByCAn2ESbF-6md7h1E-pTJtIph8jfYfeZTkY7GAJNM5RPSNHxbFsqOcA/exec';

let sbClient    = null;
let currentUser = null;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await sbClient.auth.getSession();
    currentUser = session?.user || null;
  } catch (e) {
    console.warn('Supabase init:', e.message);
  }

  const urlParams    = new URLSearchParams(window.location.search);
  const organizerId  = urlParams.get('organizer');

  if (organizerId) {
    // عرض بروفايل منظم آخر (عام)
    await _loadPublicProfile(organizerId);
  } else {
    // عرض ملفي الشخصي
    if (!currentUser) {
      _renderLoginWall();
    } else {
      await _loadMyProfile();
    }
  }
});


/* ================================================================
   🔐 حالة: غير مسجّل
   ================================================================ */
function _renderLoginWall() {
  document.getElementById('op-content').innerHTML = `
    <div style="text-align:center;padding:80px 24px;max-width:480px;margin:0 auto">
      <div style="font-size:52px;margin-bottom:16px">🔐</div>
      <h2 style="font-size:22px;font-weight:900;margin-bottom:10px">سجّل دخولك أولاً</h2>
      <p style="font-size:14px;color:var(--ink3);margin-bottom:24px">
        لازم يكون عندك حساب على مكاني Spot عشان تشوف ملفك الشخصي.
      </p>
      <a href="/?p=login" class="btn btn-primary" style="padding:12px 32px;display:inline-block">
        دخول / تسجيل ←
      </a>
    </div>`;
}


/* ================================================================
   👤 ملفي الشخصي (أنا كمنظم)
   ================================================================ */
async function _loadMyProfile() {
  let profile     = null;   // organizer_profiles
  let userProfile = null;   // profiles (بيانات شخصية)
  let reviews     = [];
  let reqStatus   = null;

  try {
    const [orgProfileRes, userProfileRes, reviewsRes, reqRes] = await Promise.all([
      sbClient.from('organizer_profiles').select('*').eq('user_id', currentUser.id).single(),
      sbClient.from('profiles').select('*').eq('id', currentUser.id).single(),
      sbClient.from('organizer_reviews').select('*')
              .eq('organizer_id', currentUser.id).order('created_at', { ascending: false }),
      sbClient.from('organizer_requests').select('status')
              .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1).single(),
    ]);

    profile     = orgProfileRes.data  || null;
    myProfileData  = profile;
    userProfile = userProfileRes.data || null;
    myUserProfile  = userProfile;
    reviews     = reviewsRes.data     || [];
    reqStatus   = reqRes.data?.status || null;
  } catch (_) {}

  _renderMyProfile(profile, userProfile, reviews, reqStatus);
}

function _renderMyProfile(profile, userProfile, reviews, reqStatus) {

  const content    = document.getElementById('op-content');
  const isVerified = profile?.is_verified === true;
  const displayName = profile?.full_name || userProfile?.full_name || currentUser.email || '?';
  const initial    = displayName[0].toUpperCase();
  const joinDate   = (userProfile?.created_at || profile?.joined_at)
    ? new Date(userProfile?.created_at || profile?.joined_at).toLocaleDateString('ar-EG', { year:'numeric', month:'long' })
    : new Date().toLocaleDateString('ar-EG', { year:'numeric', month:'long' });

  const avatarUrl  = profile?.avatar_url || profile?.logo || profile?.image || '';
  const avatarHtml = avatarUrl
    ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="avatar" onerror="this.outerHTML='<span>${initial}</span>'">`
    : initial;

  // شارة التوثيق
  let badgeHtml = '';
  if (isVerified) {
    badgeHtml = `<span class="op-verified-badge">✓ منظم موثّق</span>`;
  } else if (reqStatus === 'pending') {
    badgeHtml = `<span class="op-pending-badge">⏳ طلبك قيد المراجعة</span>`;
  } else {
    badgeHtml = `<span class="op-unverified-badge">◌ غير موثّق بعد</span>`;
  }

  // متوسط التقييم
  const avgRating = reviews.length
    ? (reviews.reduce((s,r) => s + (r.rating||0), 0) / reviews.length).toFixed(1)
    : null;

  content.innerHTML = `
    <!-- بطاقة الهوية -->
    <div class="op-identity-card">
      <div class="op-avatar" style="position:relative;cursor:pointer" onclick="triggerAvatarUpload()" title="اضغط لتغيير الصورة الشخصية">
        <div id="avatar-container-inner" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${avatarHtml}</div>
        <div class="avatar-edit-overlay">تعديل</div>
      </div>
      <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="uploadAvatarImage(this)">
      <div class="op-identity-info">
        <div class="op-name">
          ${displayName}
          ${badgeHtml}
        </div>
        <div class="op-meta">
          ${profile?.region ? `<span>📍 ${profile.region}</span>` : ''}
          <span>🗓 عضو منذ ${joinDate}</span>
          ${avgRating ? `<span>⭐ ${avgRating}</span>` : ''}
        </div>
        ${profile?.whatsapp
          ? `<a href="https://wa.me/${profile.whatsapp.replace(/\D/g,'')}" target="_blank" class="op-wa-btn">واتساب 📲</a>`
          : ''}
        <div style="margin-top:12px">
          <button class="btn" onclick="openEditModal()"
                  style="padding:7px 18px;font-size:13px;border-radius:50px;
                         background:var(--surface2);border:1.5px solid var(--border);
                         font-family:Cairo;font-weight:700;cursor:pointer">
            ✍️ تعديل البيانات
          </button>
        </div>
      </div>
    </div>

    <!-- ======================== البيانات الشخصية ======================== -->
    <div class="op-section-card">
      <div class="op-section-title">👤 بياناتك الشخصية</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">الاسم الكامل</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark)">${displayName}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">البريد الإلكتروني</div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);direction:ltr;text-align:right">${currentUser.email || '—'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">رقم الموبايل</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark);direction:ltr;text-align:right">${userProfile?.phone || '—'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">المدينة</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark)">${userProfile?.city || '—'}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">تاريخ الانضمام</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark)">${joinDate}</div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">كلمة المرور</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark);letter-spacing:2px">••••••••</div>
        </div>
      </div>
    </div>

    <!-- ======================== بيانات المنظّم ======================== -->
    ${(profile?.whatsapp || profile?.region || isVerified || reqStatus === 'pending') ? `
    <div class="op-section-card">
      <div class="op-section-title">🎪 بيانات المنظّم</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">حالة التوثيق</div>
          <div>${badgeHtml}</div>
        </div>
        ${profile?.whatsapp ? `
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">الواتساب</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark);direction:ltr;text-align:right">${profile.whatsapp}</div>
        </div>` : ''}
        ${profile?.region ? `
        <div>
          <div style="font-size:11px;color:var(--ink3);font-weight:700;margin-bottom:4px">المنطقة</div>
          <div style="font-size:14px;font-weight:700;color:var(--dark)">${profile.region}</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <!-- ======================== التقييمات ======================== -->
    ${reviews.length ? `
    <div class="op-section-card">
      <div class="op-section-title">⭐ التقييمات (${reviews.length})</div>
      ${reviews.map(r => {
        const stars = '⭐'.repeat(Math.round(r.rating || 0));
        const rd    = r.created_at
          ? new Date(r.created_at).toLocaleDateString('ar-EG', { month:'short', day:'numeric', year:'numeric' })
          : '';
        return `
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span>${stars || '—'}</span>
              <span style="font-size:11px;color:var(--ink3)">${rd}</span>
            </div>
            ${r.comment ? `<p style="font-size:13px;color:var(--ink2);margin:0;line-height:1.7">${r.comment}</p>` : ''}
          </div>`;
      }).join('')}
    </div>` : ''}`;
}


/* ================================================================
   🌐 بروفايل عام لمنظم آخر
   ================================================================ */
async function _loadPublicProfile(organizerId) {
  let organizer  = null;
  let orgBazaars = [];
  let reviews    = [];

  try {
    const [profileRes, bazaarsRes, reviewsRes] = await Promise.all([
      sbClient.from('organizer_profiles').select('*').eq('user_id', organizerId).single(),
      sbClient.from('bazaars').select('id,name,date_start,date_end,location,image,total_slots')
              .eq('organizer_id', organizerId).order('date_start', { ascending: false }),
      sbClient.from('organizer_reviews').select('*')
              .eq('organizer_id', organizerId).order('created_at', { ascending: false }),
    ]);
    organizer  = profileRes.data  || null;
    orgBazaars = bazaarsRes.data  || [];
    reviews    = reviewsRes.data  || [];
  } catch (e) {
    console.warn('profile load error:', e.message);
  }

  _renderPublicProfile(organizer, orgBazaars, reviews);
}

function _renderPublicProfile(organizer, bazaars, reviews) {

  const avatarUrl  = organizer?.avatar_url || organizer?.logo || organizer?.image || '';
  const avatarHtml = avatarUrl
    ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="avatar" onerror="this.outerHTML='${initial}'">`
    : initial;

  const content = document.getElementById('op-content');

  if (!organizer) {
    content.innerHTML = `
      <div style="text-align:center;padding:80px 24px">
        <div style="font-size:40px;margin-bottom:12px">🔍</div>
        <div style="font-size:15px;color:var(--ink3)">لم يتم العثور على هذا البروفايل</div>
        <a href="/bazaars/" class="btn" style="margin-top:20px;display:inline-block;padding:10px 24px">← البازارات</a>
      </div>`;
    return;
  }

  const initial   = (organizer.full_name || '?')[0];
  const joinDate  = organizer.joined_at
    ? new Date(organizer.joined_at).toLocaleDateString('ar-EG', { year:'numeric', month:'long' })
    : '—';
  const avgRating = reviews.length
    ? (reviews.reduce((s,r) => s + (r.rating||0), 0) / reviews.length).toFixed(1)
    : '—';
  const pastCount   = bazaars.filter(b => b.date_start && b.date_start < new Date().toISOString().split('T')[0]).length;
  const totalVendors = bazaars.reduce((s,b) => s + (b.total_slots||0), 0);

  const badgeHtml = organizer.is_verified
    ? `<span class="op-verified-badge">✓ منظم موثّق</span>`
    : `<span class="op-unverified-badge">◌ غير موثّق</span>`;

  const bazaarsHtml = bazaars.length
    ? bazaars.map(b => {
        const ds = b.date_start
          ? new Date(b.date_start).toLocaleDateString('ar-EG', { year:'numeric', month:'long', day:'numeric' })
          : '—';
        const imgHtml = b.image
          ? `<img src="${_toDirectImgUrl(b.image)}" alt="${b.name}"
                  style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0"
                  onerror="this.style.display='none'">`
          : `<div style="width:48px;height:48px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:20px">🎪</div>`;
        return `
          <div class="op-bazaar-item" onclick="window.location.href='/bazaars/?bazaar=${b.id}'">
            ${imgHtml}
            <div style="flex:1;min-width:0;margin:0 12px">
              <div style="font-weight:700;font-size:14px">${b.name}</div>
              <div style="font-size:12px;color:var(--ink3)">📅 ${ds} · 📍 ${b.location||'—'}</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2" width="16" height="16">
              <path d="M15 18l-6-6 6-6"/></svg>
          </div>`;
      }).join('')
    : `<div class="op-empty">لا توجد بازارات مسجّلة</div>`;

  const reviewsHtml = reviews.length
    ? reviews.map(r => {
        const stars = '⭐'.repeat(Math.round(r.rating||0));
        const rd = r.created_at
          ? new Date(r.created_at).toLocaleDateString('ar-EG', { month:'short', day:'numeric', year:'numeric' })
          : '';
        return `
          <div style="padding:14px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span>${stars || '—'}</span>
              <span style="font-size:11px;color:var(--ink3)">${rd}</span>
            </div>
            ${r.comment ? `<p style="font-size:13px;color:var(--ink2);margin:0;line-height:1.7">${r.comment}</p>` : ''}
          </div>`;
      }).join('')
    : `<div class="op-empty">لا توجد تقييمات بعد</div>`;

  content.innerHTML = `
    <div class="op-identity-card">
      <div class="op-avatar">${avatarHtml}</div>
      <div class="op-identity-info">
        <div class="op-name">${organizer.full_name} ${badgeHtml}</div>
        <div class="op-meta">
          ${organizer.region ? `<span>📍 ${organizer.region}</span>` : ''}
          <span>🗓 عضو منذ ${joinDate}</span>
        </div>
        ${organizer.whatsapp
          ? `<a href="https://wa.me/${organizer.whatsapp.replace(/\D/g,'')}" target="_blank" class="op-wa-btn">واتساب 📲</a>`
          : ''}
      </div>
    </div>

    <div class="op-stats-grid">
      <div class="op-stat-card">
        <div class="op-stat-num">${pastCount}</div>
        <div class="op-stat-lbl">بازار سابق</div>
      </div>
      <div class="op-stat-card">
        <div class="op-stat-num">${avgRating === '—' ? '—' : avgRating + ' ⭐'}</div>
        <div class="op-stat-lbl">متوسط التقييم</div>
      </div>
      <div class="op-stat-card">
        <div class="op-stat-num">${totalVendors}</div>
        <div class="op-stat-lbl">عارض خدمهم</div>
      </div>
    </div>

    <div class="op-section-card">
      <div class="op-section-title">🎪 البازارات (${bazaars.length})</div>
      ${bazaarsHtml}
    </div>

    <div class="op-section-card">
      <div class="op-section-title">⭐ التقييمات (${reviews.length})</div>
      ${reviewsHtml}
    </div>`;
}


/* ── دالة مساعدة: تحويل رابط Drive ── */
function _toDirectImgUrl(url) {
  if (!url || typeof url !== 'string') return '';
  url = url.trim();
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^\/\?\s]+)/);
  if (m1) return `https://lh3.googleusercontent.com/d/${m1[1]}`;
  const m2 = url.match(/drive\.google\.com\/open\?id=([^&\s]+)/);
  if (m2) return `https://lh3.googleusercontent.com/d/${m2[1]}`;
  return url;
}


/* ================================================================
   ✍️ دوال التعديل والصورة الشخصية (إضافات مكاني Spot)
   ================================================================ */

function openEditModal() {
  const modal = document.getElementById('edit-profile-modal');
  if (!modal) return;

  // البيانات الشخصية (profiles table)
  const nameVal = myProfileData?.full_name || myUserProfile?.full_name || '';
  document.getElementById('edit-name').value      = nameVal;
  document.getElementById('edit-phone').value     = myUserProfile?.phone    || '';
  const cityEl = document.getElementById('edit-city');
  if (cityEl) {
    const cityVal = myUserProfile?.city || '';
    // حاول تحديد الـ option الصحيح
    const opt = [...cityEl.options].find(o => o.value === cityVal || o.text === cityVal);
    cityEl.value = opt ? opt.value : '';
  }

  // بيانات المنظّم (organizer_profiles table)
  document.getElementById('edit-whatsapp').value  = myProfileData?.whatsapp || '';
  document.getElementById('edit-region').value    = myProfileData?.region   || '';

  // كلمة المرور — دائماً فارغة عند الفتح
  const pwdEl   = document.getElementById('edit-password');
  const cfmEl   = document.getElementById('edit-password-confirm');
  if (pwdEl) pwdEl.value = '';
  if (cfmEl) cfmEl.value = '';

  document.getElementById('edit-error').style.display = 'none';
  modal.classList.add('open');
}

function closeEditModal() {
  const modal = document.getElementById('edit-profile-modal');
  if (modal) modal.classList.remove('open');
}

async function saveProfileDetails() {
  const name     = document.getElementById('edit-name').value.trim();
  const phone    = document.getElementById('edit-phone')?.value.trim() || '';
  const city     = document.getElementById('edit-city')?.value         || '';
  const whatsapp = document.getElementById('edit-whatsapp').value.trim();
  const region   = document.getElementById('edit-region').value.trim();
  const newPwd   = document.getElementById('edit-password')?.value      || '';
  const cfmPwd   = document.getElementById('edit-password-confirm')?.value || '';
  const errorEl  = document.getElementById('edit-error');
  const saveBtn  = document.getElementById('edit-save-btn');

  const showErr = (msg) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
  };

  if (!name) { showErr('الاسم الكامل مطلوب'); return; }
  if (newPwd) {
    if (newPwd.length < 8) { showErr('كلمة المرور يجب أن تكون ٨ أحرف على الأقل'); return; }
    if (newPwd !== cfmPwd) { showErr('كلمة المرور وتأكيدها غير متطابقتين'); return; }
  }

  if (errorEl) errorEl.style.display = 'none';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ جاري الحفظ...'; }

  try {
    // 1. حفظ البيانات الشخصية في جدول profiles
    const profilesPayload = { id: currentUser.id, full_name: name, phone: phone || null, city: city || null };
    const { error: profilesErr } = await sbClient
      .from('profiles')
      .upsert(profilesPayload, { onConflict: 'id' });
    if (profilesErr) throw new Error('خطأ في حفظ البيانات الشخصية: ' + profilesErr.message);

    // 2. حفظ بيانات المنظّم في جدول organizer_profiles
    const orgPayload = { user_id: currentUser.id, full_name: name };
    if (myProfileData) {
      if ('whatsapp' in myProfileData || whatsapp) orgPayload.whatsapp = whatsapp || null;
      if ('region'   in myProfileData || region)   orgPayload.region   = region   || null;
    } else {
      if (whatsapp) orgPayload.whatsapp = whatsapp;
      if (region)   orgPayload.region   = region;
    }
    const { error: orgErr } = await sbClient
      .from('organizer_profiles')
      .upsert(orgPayload);
    if (orgErr) throw new Error('خطأ في حفظ بيانات المنظّم: ' + orgErr.message);

    // 3. تغيير كلمة المرور إن وُجدت
    if (newPwd) {
      const { error: pwdErr } = await sbClient.auth.updateUser({ password: newPwd });
      if (pwdErr) throw new Error('تم حفظ البيانات لكن فشل تغيير كلمة المرور: ' + pwdErr.message);
    }

    closeEditModal();
    await _loadMyProfile();
  } catch (err) {
    showErr(err.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'حفظ التعديلات'; }
  }
}

function triggerAvatarUpload() {
  const fileInput = document.getElementById('avatar-file-input');
  if (fileInput) fileInput.click();
}

async function uploadAvatarImage(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  
  const innerContainer = document.getElementById('avatar-container-inner');
  if (innerContainer) {
    innerContainer.innerHTML = `<span style="font-size:12px;color:#fff;animation:spin 1s linear infinite">⏳</span>`;
  }
  
  try {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${currentUser.id}/avatar-${Date.now()}.${ext}`;
    
    // الرفع لـ Supabase docs storage
    const { error: uploadErr } = await sbClient.storage
      .from('organizer-docs')
      .upload(path, file, { upsert: true, contentType: file.type });
      
    if (uploadErr) throw new Error(uploadErr.message);
    
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/organizer-docs/${path}`;
    
    const updateData = {
      user_id: currentUser.id,
      full_name: myProfileData?.full_name || currentUser.email.split('@')[0],
      avatar_url: publicUrl,
      logo: publicUrl,
      image: publicUrl
    };
    
    if (myProfileData) {
      if (!('avatar_url' in myProfileData)) delete updateData.avatar_url;
      if (!('logo' in myProfileData)) delete updateData.logo;
      if (!('image' in myProfileData)) delete updateData.image;
    }
    
    const { error: dbErr } = await sbClient
      .from('organizer_profiles')
      .upsert(updateData);
      
    if (dbErr) throw new Error(dbErr.message);
    
    await _loadMyProfile();
  } catch (err) {
    alert('تعذر رفع الصورة الشخصية: ' + err.message);
    await _loadMyProfile();
  }
}
