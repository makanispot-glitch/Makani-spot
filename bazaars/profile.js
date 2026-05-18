let myProfileData = null;
/* ================================================================
   📁 bazaars/profile.js — صفحة الملف الشخصي للمنظم
   ================================================================
   - بدون URL param  → الملف الشخصي للمستخدم الحالي (أنا)
   - ?organizer=UUID  → البروفايل العام لمنظم آخر
   ================================================================ */

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';
const BAZAAR_SHEET_URL = 'https://script.google.com/macros/s/AKfycby3adz7kud__ds_rVxZHyzEr6DS5SfdcdT7hUblmKwl1yvbEtlL7NpnpaWrrh7PLpjQPQ/exec';

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
  let profile     = null;
  let orgBazaars  = [];
  let reviews     = [];
  let reqStatus   = null;   // حالة طلب التوثيق

  try {
    const [profileRes, bazaarsRes, reviewsRes, reqRes] = await Promise.all([
      sbClient.from('organizer_profiles').select('*').eq('user_id', currentUser.id).single(),
      sbClient.from('bazaars').select('id,name,date_start,location,image,status')
              .eq('organizer_id', currentUser.id).order('date_start', { ascending: false }),
      sbClient.from('organizer_reviews').select('*')
              .eq('organizer_id', currentUser.id).order('created_at', { ascending: false }),
      sbClient.from('organizer_requests').select('status')
              .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(1).single(),
    ]);

    profile    = profileRes.data  || null;
    myProfileData = profile;
    orgBazaars = bazaarsRes.data  || [];
    reviews    = reviewsRes.data  || [];
    reqStatus  = reqRes.data?.status || null;
  } catch (_) {}

  _renderMyProfile(profile, orgBazaars, reviews, reqStatus);
}

function _renderMyProfile(profile, bazaars, reviews, reqStatus) {

  const content    = document.getElementById('op-content');
  const isVerified = profile?.is_verified === true;
  const initial    = (profile?.full_name || currentUser.email || '?')[0].toUpperCase();
  const joinDate   = profile?.joined_at
    ? new Date(profile.joined_at).toLocaleDateString('ar-EG', { year:'numeric', month:'long' })
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

  // CTA تنظيم بازار — تظهر فقط لو مش موثّق ومفيش طلب pending
  const organizeCTA = (!isVerified && reqStatus !== 'pending') ? `
    <div class="op-organize-cta">
      <div style="font-size:40px;margin-bottom:12px">🎪</div>
      <h3>هل تريد تنظيم بازار؟</h3>
      <p>
        وثّق حسابك كمنظّم وابدأ في نشر بازاراتك على مكاني Spot —
        شارة ✓ بتظهر عندك وبتكسب ثقة العارضين.
      </p>
      <a href="/bazaars/verification.html" class="btn btn-primary" style="padding:13px 32px;display:inline-block;font-size:15px">
        🎪 اطلب التوثيق الآن ←
      </a>
    </div>` : '';

  // إحصائيات
  const avgRating   = reviews.length
    ? (reviews.reduce((s,r) => s + (r.rating||0), 0) / reviews.length).toFixed(1)
    : '—';
  const pastCount   = bazaars.filter(b => b.date_start && b.date_start < new Date().toISOString().split('T')[0]).length;

  const statsHtml = (isVerified || bazaars.length) ? `
    <div class="op-stats-grid">
      <div class="op-stat-card">
        <div class="op-stat-num">${bazaars.length}</div>
        <div class="op-stat-lbl">إجمالي البازارات</div>
      </div>
      <div class="op-stat-card">
        <div class="op-stat-num">${pastCount}</div>
        <div class="op-stat-lbl">بازار منتهي</div>
      </div>
      <div class="op-stat-card">
        <div class="op-stat-num">${avgRating === '—' ? '—' : avgRating + ' ⭐'}</div>
        <div class="op-stat-lbl">متوسط التقييم</div>
      </div>
    </div>` : '';

  // قائمة البازارات
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
              <div style="font-size:12px;color:var(--ink3)">📅 ${ds} · 📍 ${b.location || '—'}</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2"
                 width="16" height="16"><path d="M15 18l-6-6 6-6"/></svg>
          </div>`;
      }).join('')
    : `<div class="op-empty">لم تنشر أي بازار بعد</div>`;

  content.innerHTML = `
    <!-- بطاقة الهوية -->
    <div class="op-identity-card">
      
    <div class="op-avatar" style="position:relative;cursor:pointer" onclick="triggerAvatarUpload()" title="اضغط لتغيير الصورة الشخصية">
      <div id="avatar-container-inner" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${avatarHtml}</div>
      <div class="avatar-edit-overlay">تعديل</div>
    </div>
    <input type="file" id="avatar-file-input" accept="image/*" style="display:none" onchange="uploadAvatarImage(this)">

      
        <div style="float:left;margin-top:10px">
          <button class="btn" onclick="openEditModal()" style="padding:6px 16px;font-size:12px;border-radius:50px;background:var(--surface2);border:1.5px solid var(--border);font-family:Cairo;font-weight:700">✍️ تعديل الحساب</button>
        </div>
        <div class="op-identity-info">

        <div class="op-name">
          ${profile?.full_name || currentUser.email}
          ${badgeHtml}
        </div>
        <div class="op-meta">
          ${profile?.region ? `<span>📍 ${profile.region}</span>` : ''}
          <span>🗓 عضو منذ ${joinDate}</span>
        </div>
        ${profile?.whatsapp
          ? `<a href="https://wa.me/${profile.whatsapp.replace(/\D/g,'')}" target="_blank" class="op-wa-btn">واتساب 📲</a>`
          : ''}
      </div>
    </div>

    <!-- CTA: تنظيم بازار (للمستخدم غير الموثّق) -->
    ${organizeCTA}

    <!-- إحصائيات (لو موثّق أو عنده بازارات) -->
    ${statsHtml}

    <!-- بازاراتي -->
    <div class="op-section-card">
      <div class="op-section-title">🎪 بازاراتي (${bazaars.length})</div>
      ${bazaarsHtml}
    </div>

    <!-- التقييمات -->
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
  
  document.getElementById('edit-name').value = myProfileData?.full_name || '';
  document.getElementById('edit-whatsapp').value = myProfileData?.whatsapp || '';
  document.getElementById('edit-region').value = myProfileData?.region || '';
  document.getElementById('edit-error').style.display = 'none';
  
  modal.classList.add('open');
}

function closeEditModal() {
  const modal = document.getElementById('edit-profile-modal');
  if (modal) modal.classList.remove('open');
}

async function saveProfileDetails() {
  const name = document.getElementById('edit-name').value.trim();
  const whatsapp = document.getElementById('edit-whatsapp').value.trim();
  const region = document.getElementById('edit-region').value.trim();
  const errorEl = document.getElementById('edit-error');
  const saveBtn = document.getElementById('edit-save-btn');
  
  if (!name) {
    if (errorEl) {
      errorEl.textContent = 'الاسم الكامل مطلوب';
      errorEl.style.display = 'block';
    }
    return;
  }
  
  if (errorEl) errorEl.style.display = 'none';
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ جاري الحفظ...'; }
  
  try {
    const updateData = {
      user_id: currentUser.id,
      full_name: name,
      whatsapp: whatsapp || null,
      region: region || null
    };
    
    // فلترة الأعمدة للتوافق مع قاعدة البيانات
    if (myProfileData) {
      if (!('whatsapp' in myProfileData)) delete updateData.whatsapp;
      if (!('region' in myProfileData)) delete updateData.region;
    }
    
    const { error } = await sbClient
      .from('organizer_profiles')
      .upsert(updateData);
      
    if (error) throw new Error(error.message);
    
    closeEditModal();
    await _loadMyProfile();
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'تعذر الحفظ: ' + err.message;
      errorEl.style.display = 'block';
    }
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
