/* ================================================================
   📁 bazaars/profile.js — الملف الشخصي الشامل للمنصة
   ================================================================
   الوضعان:
   • بدون URL param        → ملفي الشخصي (مسجّل دخوله)
   • ?user=UUID            → بروفايل عام لأي مستخدم آخر
   • ?organizer=UUID       → بروفايل عام (backward-compat)

   ربط البيانات:
   • profiles              → الاسم، الإيميل، الهاتف، المدينة، الدور
   • organizer_profiles    → بيانات المنظّم، صورة الأفاتار
   • organizer_reviews     → التقييمات
   • organizer_requests    → حالة طلب التوثيق
   • bazaars               → بازارات المستخدم
   • listings              → إعلانات السوق + مزامنة الهاتف
   • upgrade_requests      → حالة طلب صاحب المساحة
   ================================================================ */

/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */

let sbClient    = null;
let currentUser = null;

/* حفظ البيانات المحملة (يستخدمها modal التعديل) */
let myProfileData  = null;   // organizer_profiles row
let myUserProfile  = null;   // profiles row
let myMergedPhone  = null;   // هاتف مدمج من مصادر متعددة
let myMergedCity   = null;   // مدينة مدمجة من مصادر متعددة

/* بازارات المنظّم المعروض بروفايله حاليًا — تُحفَظ هنا لأن نافذة "روابط التوثيق"
   (openOrgDocsShowcase) تُفتَح لاحقًا من onclick، بعيدًا عن نطاق _renderPublicProfile */
let _profOrgBazaars = [];

/* ── تقييم المشاركين (المنظم → المستأجر) — نظام أحادي الاتجاه ──
   المنظم يقيّم العارضين الذين حجزوا/شاركوا فعلياً في بازاراته فقط. */
let bzRateableParticipants = [];   // من organizer_list_rateable_participants()
let bzOrganizerRatings     = [];   // user_ratings حيث rater_id = المنظم & context_type='bazaar'
let bzRateVals             = { commitment: 0, cleanliness: 0, dealing: 0, payment: 0, rules: 0 };
/* دالة بدل const ثابت — لازم تُستدعى وقت الرسم بعد جاهزية i18next */
function _bzRateCriteria() {
  return [
    { key: 'commitment',  label: t('profile.rateSection.criteria.commitment') },
    { key: 'cleanliness', label: t('profile.rateSection.criteria.cleanliness') },
    { key: 'dealing',     label: t('profile.rateSection.criteria.dealing') },
    { key: 'payment',     label: t('profile.rateSection.criteria.payment') },
    { key: 'rules',       label: t('profile.rateSection.criteria.rules') },
  ];
}

/* ================================================================
   🚀 بدء التشغيل
   ================================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data: { session } } = await sbClient.auth.getSession();
    currentUser = session?.user || null;
  } catch (e) {
    console.warn('[profile] Supabase init:', e.message);
  }

  /* إزالة زر تغيير اللغة القديم إذا كان مسجلاً */
  const langBtn = document.getElementById('langSwitchBtn');
  if (langBtn && currentUser) {
    langBtn.remove();
  }

  /* جرس الإشعارات الموحّد — نفس موقعه في كل صفحات البازارات */
  if (currentUser) {
    try { GN.init(sbClient, currentUser.id); GN.mount(document.querySelector('.bz-nav-right')); } catch (_) {}
  }

  const params  = new URLSearchParams(window.location.search);
  const userId  = params.get('user') || params.get('organizer');

  if (userId) {
    await _loadPublicProfile(userId);
  } else {
    if (!currentUser) {
      _renderLoginWall();
    } else {
      await _loadMyProfile();
    }
  }
});

/* 🌐 دعم اللغتين — إعادة رسم المحتوى الديناميكي عند تبديل اللغة */
document.addEventListener('makani:locale-changed', () => {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get('user') || params.get('organizer');
  if (userId) {
    _loadPublicProfile(userId);
  } else if (!currentUser) {
    _renderLoginWall();
  } else {
    _loadMyProfile();
  }
});


/* ================================================================
   🔐 جدار تسجيل الدخول
   ================================================================ */
function _renderLoginWall() {
  document.getElementById('op-content').innerHTML = `
    <div style="text-align:center;padding:80px 24px;max-width:460px;margin:0 auto">
      <div style="font-size:52px;margin-bottom:16px">🔐</div>
      <h2 style="font-size:22px;font-weight:900;margin-bottom:10px">${t('profile.loginWall.title')}</h2>
      <p style="font-size:14px;color:var(--ink3);margin-bottom:24px;line-height:1.7">
        ${t('profile.loginWall.desc')}
      </p>
      <a href="/?p=login" class="btn btn-primary" style="padding:12px 32px;display:inline-block">
        ${t('profile.loginWall.loginBtn')}
      </a>
    </div>`;
}


function _profLocale() { return getLocale() === 'en' ? 'en-US' : 'ar-EG'; }

/* ================================================================
   👤 ملفي الشخصي — تحميل البيانات
   ================================================================ */
async function _loadMyProfile() {
  let profile      = null;
  let userProfile  = null;
  let reviews      = [];
  let reqStatus    = null;
  let bazaars      = [];
  let listings     = [];
  let isSpaceOwner = false;
  let bazaarRating = { total: 0, avg_rating: 0 }; // متوسط تقييمي كمنظم — من bazaar_reviews
  let reputation   = null; // get_user_reputation — سمعتي الشخصية (كمستأجر/مشارك)، خاصة بهذه الصفحة الذاتية فقط
  let recvRatings  = [];   // user_ratings المستلمة من أصحاب المساحات/المنظمين

  try {
    const [
      orgProfileRes, userProfileRes, reviewsRes,
      reqRes, bazaarsRes, listingsRes, upgradeRes,
      rateableRes, bzRatingsRes, bazaarRatingRes,
      reputationRes, recvRatingsRes
    ] = await Promise.all([
      sbClient.from('organizer_profiles').select('*')
              .eq('user_id', currentUser.id).single(),
      sbClient.from('profiles').select('*')
              .eq('id', currentUser.id).single(),
      sbClient.from('organizer_reviews').select('*')
              .eq('organizer_id', currentUser.id)
              .order('created_at', { ascending: false }),
      sbClient.from('organizer_requests').select('status')
              .eq('user_id', currentUser.id)
              .order('created_at', { ascending: false }).limit(1).single(),
      sbClient.from('bazaars').select('id,name,date_start,date_end,status')
              .eq('organizer_id', currentUser.id).eq('is_deleted', false),
      sbClient.from('listings')
              .select('id,title,category,price,cover_image,status,expires_at,created_at,phone,region')
              .eq('user_id', currentUser.id)
              .neq('status', 'deleted')
              .order('created_at', { ascending: false })
              .limit(6),
      sbClient.from('upgrade_requests').select('status')
              .eq('user_id', currentUser.id)
              .order('created_at', { ascending: false }).limit(1).single(),
      /* 🔗 تقييم المشاركين: المشاركون القابلون للتقييم + سجل تقييماتي كمنظم */
      sbClient.rpc('organizer_list_rateable_participants'),
      sbClient.from('user_ratings').select('*')
              .eq('rater_id', currentUser.id).eq('context_type', 'bazaar')
              .order('created_at', { ascending: false }),
      /* ⭐ متوسط تقييمي كمنظم — مبني على تقييمات كل بازاراتي (bazaar_reviews) */
      sbClient.rpc('get_organizer_overall_rating', { p_organizer_id: currentUser.id }),
      /* 🛡️ سمعتي الشخصية — نفس مصدر البيانات المستخدم أصلاً بالعرض العام، لكن هنا للاستخدام الذاتي الخاص فقط */
      sbClient.rpc('get_user_reputation', { p_user_id: currentUser.id }),
      sbClient.from('user_ratings').select('*')
              .eq('ratee_id', currentUser.id).eq('status', 'visible')
              .order('created_at', { ascending: false }),
    ]);

    profile     = orgProfileRes.data  || null;
    userProfile = userProfileRes.data || null;
    reviews     = reviewsRes.data     || [];
    reqStatus   = reqRes.data?.status || null;
    bazaars     = bazaarsRes.data     || [];
    listings    = listingsRes.data    || [];
    bazaarRating = bazaarRatingRes.data || bazaarRating;
    reputation  = reputationRes.data  || null;
    recvRatings = recvRatingsRes.data || [];

    /* تقييم المشاركين (حالة وحدات الوحدة على مستوى الموديول) */
    bzRateableParticipants = rateableRes.data || [];
    bzOrganizerRatings     = bzRatingsRes.data || [];
    if (rateableRes.error) console.warn('[profile] rateable participants:', rateableRes.error.message);

    /* ── تحقق من صاحب المساحة عبر upgrade_requests أو role ──
       upgrade_requests.status==='approved' إشارة إضافية خاصة بهذه الصفحة وحدها
       (تُظهر قسم المساحات فور الموافقة قبل أي reload يُحدّث profiles.role) —
       تبقى محلية هنا عمدًا، لا تُدمَج داخل getAccountCapabilities المشتركة. */
    const upgradeStatus = upgradeRes.data?.status || null;
    isSpaceOwner = upgradeStatus === 'approved'
                || getAccountCapabilities(userProfile, profile).isOwner;

  } catch (_) {}

  /* ── حفظ للاستخدام في modal التعديل ── */
  myProfileData = profile;
  myUserProfile = userProfile;

  /* ── مزامنة ذكية: الهاتف والمدينة من مصادر متعددة ── */
  myMergedPhone = userProfile?.phone || null;
  myMergedCity  = userProfile?.city  || null;

  /* إذا الهاتف مش في profiles، جرّب listing */
  if (!myMergedPhone && listings.length) {
    const lWithPhone = listings.find(l => l.phone);
    if (lWithPhone) myMergedPhone = lWithPhone.phone;
  }
  /* إذا المدينة مش في profiles، جرّب region من listing أو organizer_profiles */
  if (!myMergedCity && listings.length) {
    const lWithRegion = listings.find(l => l.region);
    if (lWithRegion) myMergedCity = lWithRegion.region;
  }
  if (!myMergedCity && profile?.region) {
    myMergedCity = profile.region;
  }

  /* ── مزامنة تلقائية إلى profiles إن وجد بيانات ناقصة ── */
  const syncPayload = {};
  if (myMergedPhone && !userProfile?.phone) syncPayload.phone = myMergedPhone;
  if (myMergedCity  && !userProfile?.city)  syncPayload.city  = myMergedCity;
  if (Object.keys(syncPayload).length > 0) {
    sbClient.from('profiles')
            .upsert({ id: currentUser.id, ...syncPayload }, { onConflict: 'id' })
            .then(() => {}).catch(() => {});
    /* حدّث النسخة المحلية أيضاً */
    myUserProfile = { ...(myUserProfile || {}), ...syncPayload };
  }

  _renderMyProfile(profile, userProfile, reviews, reqStatus, bazaars, listings, isSpaceOwner, bazaarRating, reputation, recvRatings);
}


/* ================================================================
   🎯 كارت اكتمال الملف الشخصي
   ================================================================ */
function _buildCompletionCard(profile, userProfile, bazaars, showOrganizerSection) {
  const hasSocial = !!(profile?.facebook_url || profile?.instagram_url || profile?.tiktok_url);
  const checks = [
    { done: !!(profile?.avatar_url),                       pts: 20, label: t('profile.completion.checkAvatarLabel'), tip: t('profile.completion.checkAvatarTip') },
    { done: !!(profile?.cover_url),                        pts: 15, label: t('profile.completion.checkCoverLabel'),  tip: t('profile.completion.checkCoverTip') },
    { done: !!(profile?.bio?.trim()),                      pts: 25, label: t('profile.completion.checkBioLabel'),    tip: t('profile.completion.checkBioTip') },
    { done: hasSocial,                                     pts: 25, label: t('profile.completion.checkSocialLabel'), tip: t('profile.completion.checkSocialTip') },
    { done: !!(profile?.region || userProfile?.city),      pts: 15, label: t('profile.completion.checkRegionLabel'), tip: t('profile.completion.checkRegionTip') },
  ];

  const pct     = checks.reduce((s, c) => s + (c.done ? c.pts : 0), 0);
  const missing = checks.filter(c => !c.done);

  if (missing.length === 0) return '';

  const color = pct >= 75 ? '#059669' : pct >= 50 ? '#D97706' : '#F36418';

  return `
  <div class="op-completion-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div style="font-size:13.5px;font-weight:900;color:var(--ink)">${showOrganizerSection ? t('profile.completion.titleOrganizer') : t('profile.completion.titlePersonal')}</div>
      <div style="font-size:20px;font-weight:900;color:${color};font-family:var(--font-display)">${pct}%</div>
    </div>
    <div style="font-size:11.5px;color:var(--ink3);margin-bottom:8px">
      ${pct < 50 ? t('profile.completion.lowMsg') :
        pct < 80 ? t('profile.completion.midMsg') :
                   t('profile.completion.highMsg')}
    </div>
    <div class="op-completion-bar-bg">
      <div class="op-completion-bar-fill" style="width:${pct}%;background:${color}"></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${missing.slice(0, 3).map(c => `
      <div class="op-completion-tip" onclick="openEditModal()">
        <div class="op-completion-pts" style="background:${color}18;color:${color}">+${c.pts}</div>
        <div style="flex:1">
          <span style="font-weight:700;color:var(--ink);font-size:12.5px">${c.label}</span>
          <span style="color:var(--ink3);font-size:11px"> — ${c.tip}</span>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2" width="13" height="13"><path d="M15 18l-6-6 6-6"/></svg>
      </div>`).join('')}
    </div>
  </div>`;
}


/* ================================================================
   🎨 عرض ملفي الشخصي
   ================================================================ */
function _renderMyProfile(profile, userProfile, reviews, reqStatus, bazaars, listings, isSpaceOwner, bazaarRating, reputation, recvRatings) {
  const content = document.getElementById('op-content');

  const caps        = getAccountCapabilities(userProfile, profile);
  const isVerified   = caps.organizerVerified;
  const displayName = profile?.full_name || userProfile?.full_name
                   || currentUser.email?.split('@')[0] || '?';
  const initial     = displayName[0]?.toUpperCase() || '؟';
  const joinDate    = (userProfile?.created_at || profile?.joined_at)
    ? new Date(userProfile?.created_at || profile?.joined_at)
        .toLocaleDateString(_profLocale(), { year:'numeric', month:'long' })
    : '—';

  const avatarUrl  = profile?.avatar_url || profile?.logo || profile?.image || '';
  const avatarHtml = avatarUrl
    ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="avatar" onerror="this.outerHTML='<span>${initial}</span>'">`
    : `<span>${initial}</span>`;

  /* ── Cover / Banner ── */
  const coverUrl  = _toDirectImgUrl(profile?.cover_url || '');
  const coverHtml = `
    <div class="op-cover-section">
      ${coverUrl ? `<img id="op-cover-img-el" src="${coverUrl}" alt="cover">` : `<img id="op-cover-img-el" style="display:none">`}
      <button class="op-cover-upload-btn" id="op-cover-upload-btn" onclick="triggerCoverUpload()" title="${t('profile.editModal.changeCoverTooltip')}">
        ${coverUrl ? t('profile.upload.coverChangeBtn') : t('profile.hero.addCoverBtn')}
      </button>
    </div>`;

  /* ── Bio ── */
  const bioHtml = profile?.bio
    ? `<div class="op-bio">${profile.bio}</div>`
    : '';

  /* ── Social Links ── */
  const socialLinks = [
    { key: 'facebook_url',  cls: 'fb', title: 'Facebook',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>` },
    { key: 'instagram_url', cls: 'ig', title: 'Instagram',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>` },
    { key: 'tiktok_url',   cls: 'tt', title: 'TikTok',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.15 8.15 0 0 0 4.77 1.52V6.75a4.86 4.86 0 0 1-1-.06z"/></svg>` },
  ];
  const socialHtml = (() => {
    const links = socialLinks
      .filter(s => profile?.[s.key])
      .map(s => `<a href="${profile[s.key]}" target="_blank" rel="noopener noreferrer" class="op-social-link ${s.cls}" title="${s.title}">${s.icon}</a>`)
      .join('');
    return links ? `<div class="op-social-links">${links}</div>` : '';
  })();

  /* ── إحصائيات ── */
  const today          = new Date().toISOString().split('T')[0];
  const totalBaz       = bazaars.length;
  const endedBaz       = bazaars.filter(b => b.date_end && b.date_end < today).length;
  const now            = new Date().toISOString();
  const activeListings = listings.filter(l =>
    l.status !== 'sold' && l.status !== 'expired' &&
    !(l.expires_at && l.expires_at < now)
  ).length;
  const avgRating = bazaarRating?.total
    ? Number(bazaarRating.avg_rating).toFixed(1)
    : null;

  /* ── هل هذا الحساب "منظم" فعليًا (نشاط حقيقي/توثيق/طلب قيد المراجعة)، وليس مجرد تينانت؟
     يحكم أي قسم إداري خاص بالمنظّم يظهر في هذه الصفحة الذاتية — لا يُبنى قالب منظم افتراضيًا. ── */
  const showOrganizerSection = caps.isOrganizer || isVerified || totalBaz > 0 || reqStatus === 'pending';

  /* ── أوسمة ── */
  const { primary: primaryBadges, secondary: secBadges } = _computeBadges({
    isVerified, isSpaceOwner,
    hasBazaars: totalBaz > 0,
    listings, avgRating: avgRating ? parseFloat(avgRating) : 0,
    reviewsCount: bazaarRating?.total || 0,
  });

  /* ── شارة التوثيق (صغيرة في الاسم) ── */
  let nameBadge = '';
  if (isVerified)               nameBadge = `<span class="op-verified-badge">${t('profile.orgBadge.verified')}</span>`;
  else if (reqStatus==='pending') nameBadge = `<span class="op-pending-badge">${t('profile.orgBadge.pending')}</span>`;

  /* ── هل نعرض CTA للمنظم وصاحب المساحة؟ ── */
  const showOrgCta   = !isVerified && reqStatus !== 'pending' && !primaryBadges.find(b=>b.id==='organizer');
  const showSpaceCta = !isSpaceOwner;

  content.innerHTML = `

  <!-- ═══════ HERO ═══════ -->
  <div class="op-hero">

    ${coverHtml}

    <div class="op-hero-top">

      <!-- أفاتار -->
      <div class="op-avatar-wrap">
        <div class="op-avatar" onclick="triggerAvatarUpload()" title="${t('profile.hero.changePhotoTooltip')}">
          <div id="avatar-container-inner" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center">${avatarHtml}</div>
        </div>
        <div class="avatar-edit-btn" onclick="triggerAvatarUpload()" title="${t('profile.hero.changePhotoTooltipShort')}">✏️</div>
      </div>

      <!-- معلومات -->
      <div class="op-hero-info">
        <div class="op-name">
          ${displayName}
          ${nameBadge}
        </div>
        <div class="op-hero-meta">
          <span>${t('profile.hero.memberSince', { date: joinDate })}</span>
          ${myMergedCity  ? `<span>📍 ${myMergedCity}</span>` : ''}
          ${currentUser.email ? `<span style="direction:ltr;unicode-bidi:embed">✉️ ${currentUser.email}</span>` : ''}
        </div>
        ${bioHtml}
        ${socialHtml}
        <div class="op-hero-actions" style="margin-top:10px">
          <button class="op-qn-btn primary" onclick="openEditModal()">${t('profile.hero.editBtn')}</button>
          ${primaryBadges.length ? `<button class="op-qn-btn" onclick="shareMyOrganizerProfile()">${t('profile.hero.shareBtn')}</button>` : ''}
        </div>

        <!-- الأوسمة الرئيسية -->
        ${primaryBadges.length ? `
        <div class="op-primary-badges">
          ${primaryBadges.map(b => `
            <div class="op-badge-primary ${b.id}">
              <span class="op-badge-icon">${b.emoji}</span>
              <div>
                <div class="op-badge-label">${b.label}</div>
                <div class="op-badge-desc">${b.desc}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}

        <!-- الأوسمة الثانوية -->
        ${secBadges.length ? `
        <div class="op-sec-badges">
          ${secBadges.map(b => `<span class="op-sec-badge ${b.tier==='gold'?'gold':''}">${b.emoji} ${b.label}</span>`).join('')}
        </div>` : ''}

        <!-- CTA cards للتقديم -->
        ${(showOrgCta || showSpaceCta) ? `
        <div class="op-cta-wrap">

          ${showOrgCta ? `
          <a href="/?p=dashboard" class="op-cta-card">
            <span class="op-cta-emoji">🎪</span>
            <div class="op-cta-body">
              <div class="op-cta-title">${t('profile.cta.becomeOrganizerTitle')}</div>
              <div class="op-cta-desc">${t('profile.cta.becomeOrganizerDesc')}</div>
            </div>
            <span class="op-cta-arrow">←</span>
          </a>` : ''}

          ${showSpaceCta ? `
          <a href="/?p=owner" class="op-cta-card blue">
            <span class="op-cta-emoji">🏪</span>
            <div class="op-cta-body">
              <div class="op-cta-title">${t('profile.cta.becomeOwnerTitle')}</div>
              <div class="op-cta-desc">${t('profile.cta.becomeOwnerDesc')}</div>
            </div>
            <span class="op-cta-arrow" style="color:#3b82f6">←</span>
          </a>` : ''}

        </div>` : ''}
      </div>
    </div>

    <!-- روابط سريعة -->
    <div class="op-quick-nav">
      <a class="op-qn-btn" href="/bazaars/">${t('profile.quickNav.bazaars')}</a>
      <a class="op-qn-btn" href="/market/">${t('profile.quickNav.market')}</a>
      <a class="op-qn-btn" href="/?p=dashboard">${t('profile.quickNav.dashboard')}</a>
      ${isVerified ? `<a class="op-qn-btn primary" href="/bazaars/organize.html">${t('profile.quickNav.newBazaar')}</a>` : ''}
      ${showOrganizerSection ? `<a class="op-qn-btn" href="/bazaars/profile.html?user=${currentUser.id}" target="_blank">${t('profile.quickNav.publicProfile')}</a>` : ''}
    </div>
  </div>

  <!-- ═══════ الإحصائيات ═══════ -->
  <div class="op-stats-grid">
    ${showOrganizerSection ? `
    <div class="op-stat-card">
      <div class="op-stat-num">${totalBaz}</div>
      <div class="op-stat-lbl">${t('profile.stats.bazaarsOrganized')}</div>
    </div>
    <div class="op-stat-card">
      <div class="op-stat-num">${endedBaz}</div>
      <div class="op-stat-lbl">${t('profile.stats.bazaarsEnded')}</div>
    </div>
    <div class="op-stat-card">
      <div class="op-stat-num">${avgRating ? avgRating + ' ⭐' : '—'}</div>
      <div class="op-stat-lbl">${t('profile.stats.avgRating')}</div>
      ${bazaarRating?.total > 0 ? `<div class="op-stat-note">${t('profile.stats.basedOnReviews', { count: bazaarRating.total })}</div>` : ''}
    </div>` : ''}
    <div class="op-stat-card">
      <div class="op-stat-num">${activeListings}</div>
      <div class="op-stat-lbl">${t('profile.stats.activeListings')}</div>
    </div>
  </div>

  <!-- ═══════ سمعتي — خاصة بهذه الصفحة الذاتية فقط، لا تُعرض على أي بروفايل عام ═══════ -->
  ${_pubRepPanelHtml(reputation, recvRatings)}

  <!-- ═══════ كارت اكتمال الملف الشخصي ═══════ -->
  ${_buildCompletionCard(profile, userProfile, bazaars, showOrganizerSection)}

  <!-- ═══════ عمودان: البيانات الشخصية + الإعلانات ═══════ -->
  <div class="op-two-col">

    <!-- البيانات الشخصية -->
    <div class="op-section-card">
      <div class="op-section-title">
        <span>${t('profile.dataSection.title')}</span>
        <a href="#" onclick="openEditModal();return false">${t('profile.dataSection.editLink')}</a>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.fullName')}</div>
        <div class="op-data-val">${displayName}</div>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.email')}</div>
        <div class="op-data-val" style="direction:ltr;text-align:right;font-size:12px">${currentUser.email || '—'}</div>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.mobile')}</div>
        <div class="op-data-val" style="direction:ltr;text-align:right">
          ${myMergedPhone || '—'}
          ${(myMergedPhone && !userProfile?.phone) ? `<div class="op-data-synced">${t('profile.dataSection.syncedFromListings')}</div>` : ''}
        </div>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.city')}</div>
        <div class="op-data-val">
          ${myMergedCity || '—'}
          ${(myMergedCity && !userProfile?.city) ? `<div class="op-data-synced">${t('profile.dataSection.syncedFromListings')}</div>` : ''}
        </div>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.joinDate')}</div>
        <div class="op-data-val">${joinDate}</div>
      </div>
      <div class="op-data-row">
        <div class="op-data-lbl">${t('profile.dataSection.password')}</div>
        <div class="op-data-val" style="letter-spacing:3px">••••••••</div>
      </div>

      ${(profile?.whatsapp || profile?.region || isVerified || reqStatus || isSpaceOwner) ? `
      <div style="margin-top:14px;padding-top:12px;border-top:1.5px solid var(--border)">
        <div style="font-size:11px;font-weight:900;color:var(--dark);margin-bottom:10px">${showOrganizerSection ? t('profile.dataSection.organizerDataTitle') : t('profile.dataSection.extraDataTitle')}</div>
        ${showOrganizerSection ? `
        <div class="op-data-row">
          <div class="op-data-lbl">${t('profile.dataSection.organizerVerification')}</div>
          <div class="op-data-val">${
            isVerified
              ? `<span class="op-verified-badge" style="font-size:10px;padding:3px 8px">${t('profile.dataSection.verifiedShort')}</span>`
              : reqStatus==='pending'
                ? `<span class="op-pending-badge" style="font-size:10px;padding:3px 8px">${t('profile.orgBadge.pending')}</span>`
                : `<span class="op-unverified-badge" style="font-size:10px;padding:3px 8px">${t('profile.dataSection.unverifiedShort')}</span>`
          }</div>
        </div>` : ''}
        ${profile?.whatsapp ? `
        <div class="op-data-row">
          <div class="op-data-lbl">${t('profile.dataSection.whatsapp')}</div>
          <div class="op-data-val" style="direction:ltr;text-align:right">${profile.whatsapp}</div>
        </div>` : ''}
        ${profile?.region ? `
        <div class="op-data-row">
          <div class="op-data-lbl">${t('profile.dataSection.region')}</div>
          <div class="op-data-val">${profile.region}</div>
        </div>` : ''}
        ${isSpaceOwner ? `
        <div class="op-data-row">
          <div class="op-data-lbl">${t('profile.dataSection.spaceOwnerLabel')}</div>
          <div class="op-data-val"><span class="op-badge-primary space-owner" style="padding:4px 10px;border-radius:10px;display:inline-flex;gap:6px;align-items:center"><span>🏪</span> ${t('profile.dataSection.spaceOwnerVerified')}</span></div>
        </div>` : ''}
      </div>` : ''}
    </div>

    <!-- إعلاناتي -->
    <div class="op-section-card">
      <div class="op-section-title">
        <span>${t('profile.listingsSection.title')}</span>
        <a href="/market/?myListings=1" target="_blank">${t('profile.listingsSection.manageAll')}</a>
      </div>
      ${_renderListingsGrid(listings)}
    </div>

  </div>

  <!-- ═══════ بازاراتي — تظهر فقط لمن طابق تعريف المنظّم فعلاً، لا لكل تينانت ═══════ -->
  ${showOrganizerSection ? `
  <div class="op-section-card" style="margin-top:16px">
    <div class="op-section-title">
      <span>${t('profile.myBazaarsSection.title', { count: totalBaz })}</span>
      <div style="display:flex;gap:8px;align-items:center">
        ${isVerified ? `<a href="/bazaars/manage.html" style="font-size:11px;font-weight:700;color:var(--ink2);text-decoration:none;padding:3px 10px;border:1px solid var(--border);border-radius:50px;background:var(--surface2)">${t('profile.myBazaarsSection.manageBazaarsBtn')}</a>` : ''}
        ${isVerified ? `<a href="/bazaars/organize.html" style="color:var(--orange);font-weight:900;font-size:13px;text-decoration:none">${t('profile.myBazaarsSection.newBazaarBtn')}</a>` : ''}
      </div>
    </div>
    ${totalBaz ? bazaars.map(b => {
      const ds = b.date_start ? new Date(b.date_start).toLocaleDateString(_profLocale(), { month:'short', day:'numeric', year:'numeric' }) : '—';
      const statusMap = {
        published: t('profile.myBazaarsSection.statusPublished'), active: t('profile.myBazaarsSection.statusActive'), upcoming: t('profile.myBazaarsSection.statusUpcoming'),
        postponed: t('profile.myBazaarsSection.statusPostponed'), closed: t('profile.myBazaarsSection.statusClosed'), cancelled: t('profile.myBazaarsSection.statusCancelled'),
        pending_review: t('profile.myBazaarsSection.statusPendingReview')
      };
      const st = statusMap[b.status] || b.status;
      const canManage = ['published','active','upcoming','postponed','pending_review'].includes(b.status);
      return `<div class="op-data-row" style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--dark);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:2px">${ds} · ${st}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          <a href="/bazaars/?bazaar=${b.id}"
             style="font-size:10px;font-weight:700;color:var(--orange);text-decoration:none;padding:3px 9px;border:1px solid rgba(243,100,24,.3);border-radius:50px;background:var(--orange-ultra)">
            ${t('profile.myBazaarsSection.viewBtn')}
          </a>
          ${canManage ? `<a href="/bazaars/manage.html?id=${b.id}"
             style="font-size:10px;font-weight:700;color:var(--ink2);text-decoration:none;padding:3px 9px;border:1px solid var(--border);border-radius:50px;background:var(--surface2)">
            ${t('profile.myBazaarsSection.manageBtn')}
          </a>` : ''}
        </div>
      </div>`;
    }).join('') : `<div style="text-align:center;padding:20px;color:var(--ink3);font-size:13px">
      ${t('profile.myBazaarsSection.emptyTitle')}
      ${isVerified ? `<br><a href="/bazaars/organize.html" style="color:var(--orange);font-weight:700">${t('profile.myBazaarsSection.emptyCta')}</a>` : ''}
    </div>`}
  </div>` : ''}

  <!-- ═══════ تقييم المشاركين في بازاراتك (المنظم → المستأجر) ═══════ -->
  ${totalBaz > 0 ? `
  <div class="op-section-card op-rate-card" style="margin-top:16px">
    <div class="op-section-title">
      <span>${t('profile.rateSection.title')}</span>
      <span class="op-rate-count" id="bz-rate-count">${t('profile.rateSection.countBadge', { count: bzRateableParticipants.length })}</span>
    </div>

    <p class="op-rate-intro">${t('profile.rateSection.intro')}</p>

    ${bzRateableParticipants.length ? `
    <div class="op-rate-form">
      <div class="vr-fg">
        <label>${t('profile.rateSection.selectParticipantLabel')}</label>
        <select id="bz-rate-participant" onchange="bzOnParticipantChange()">
          <option value="">${t('profile.rateSection.selectPlaceholder')}</option>
          ${bzRateableParticipants.map(p => {
            const mark = p.rating_id ? t('profile.rateSection.ratedMark') : '';
            const who  = _escR(p.business_name || p.tenant_name || t('profile.rateSection.defaultParticipantName'));
            return `<option value="${p.booking_id}">${who} — ${_escR(p.bazaar_name || t('profile.rateSection.defaultBazaarName'))}${mark}</option>`;
          }).join('')}
        </select>
      </div>

      <div id="bz-rate-context" class="op-rate-context"></div>

      <div id="bz-rate-criteria" class="op-rate-criteria"></div>

      <div class="op-rate-avg-row">
        <span>${t('profile.rateSection.avgLabel')}</span>
        <span><strong id="bz-rate-avg">${(0).toLocaleString(_profLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</strong> / ${(5).toLocaleString(_profLocale())} ⭐</span>
      </div>

      <div class="vr-fg">
        <label>${t('profile.rateSection.notesLabel')}</label>
        <textarea id="bz-rate-notes" rows="3" class="op-rate-notes"
          placeholder="${t('profile.rateSection.notesPlaceholder')}"></textarea>
      </div>

      <div id="bz-rate-msg" class="op-rate-msg" style="display:none"></div>

      <button id="bz-btn-submit-rating" class="op-rate-submit" onclick="submitBazaarRating()">${t('profile.rateSection.submitBtn')}</button>
    </div>` : `
    <div class="op-empty">
      <div style="font-size:26px;margin-bottom:8px">🪑</div>
      <div>${t('profile.rateSection.emptyTitle')}</div>
      <div style="font-size:11px;margin-top:6px;color:var(--ink3)">
        ${t('profile.rateSection.emptyDesc')}
      </div>
    </div>`}

    <!-- سجل التقييمات التي منحتها -->
    <div id="bz-rate-history" class="op-rate-history" style="${bzOrganizerRatings.length ? '' : 'display:none'}">
      <div class="op-rate-history-title">${t('profile.rateSection.historyTitlePrefix')} (<span id="bz-rate-hist-count">${bzOrganizerRatings.length}</span>)</div>
      <div id="bz-rate-history-rows">${_bzHistoryRowsHtml()}</div>
    </div>
  </div>` : ''}

  <!-- ═══════ التقييمات ═══════ -->
  ${reviews.length ? `
  <div class="op-section-card" style="margin-top:16px">
    <div class="op-section-title">
      <span>${t('profile.reviewsSection.titleMy', { count: reviews.length })}</span>
    </div>
    ${reviews.map(r => {
      const stars = '⭐'.repeat(Math.min(5, Math.round(r.rating || 0)));
      const rd = r.created_at
        ? new Date(r.created_at).toLocaleDateString(_profLocale(), { month:'short', day:'numeric', year:'numeric' })
        : '';
      return `
        <div class="op-review-item">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:14px">${stars || '—'}</span>
            <span style="font-size:11px;color:var(--ink3)">${rd}</span>
          </div>
          ${r.comment ? `<p style="font-size:13px;color:var(--ink2);margin:0;line-height:1.7">${r.comment}</p>` : ''}
        </div>`;
    }).join('')}
  </div>` : ''}`;

  /* بعد بناء الـ DOM: ارسم نجوم معايير التقييم التفاعلية */
  if (totalBaz > 0) bzRenderRateStars();
}


/* ================================================================
   ⭐ تقييم المشاركين في البازار (المنظم → المستأجر)
   نظام أحادي الاتجاه — يعتمد على حجز حقيقي عبر rate_tenant(context='bazaar')
   ================================================================ */
function _escR(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* بناء نجوم تفاعلية (١-٥) لكل معيار */
function bzRenderRateStars() {
  const wrap = document.getElementById('bz-rate-criteria');
  if (!wrap) return;
  wrap.innerHTML = _bzRateCriteria().map(c => {
    const v = bzRateVals[c.key] || 0;
    const stars = [1, 2, 3, 4, 5].map(i =>
      `<button type="button" class="op-si-star${i <= v ? ' on' : ''}" onclick="bzSetRateStar('${c.key}',${i})">★</button>`
    ).join('');
    return `
      <div class="op-rate-crit">
        <div class="op-rate-crit-head">
          <span class="op-rate-crit-label">${c.label}</span>
          <span class="op-rate-crit-val">${v ? v.toLocaleString(_profLocale()) : '—'}</span>
        </div>
        <div class="op-star-input">${stars}</div>
      </div>`;
  }).join('');
}

function bzSetRateStar(key, val) {
  bzRateVals[key] = val;
  bzRenderRateStars();
  bzUpdateAvg();
}

function _bzRateValsArray() {
  return _bzRateCriteria().map(c => bzRateVals[c.key]).filter(v => v > 0);
}

function bzUpdateAvg() {
  const set = _bzRateValsArray();
  const avg = set.length ? set.reduce((a, b) => a + b, 0) / set.length : 0;
  const el  = document.getElementById('bz-rate-avg');
  if (el) el.textContent = avg ? avg.toLocaleString(_profLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : (0).toLocaleString(_profLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/* صفوف سجل التقييمات التي منحها المنظّم */
function _bzHistoryRowsHtml() {
  if (!bzOrganizerRatings.length) return '';
  /* خريطة الاسم من القائمة القابلة للتقييم (booking_id → اسم المشارك) */
  const nameByBooking = {};
  bzRateableParticipants.forEach(p => {
    nameByBooking[p.booking_id] = p.business_name || p.tenant_name || t('profile.rateSection.defaultParticipantName');
  });
  return bzOrganizerRatings.map(r => {
    const who   = _escR(nameByBooking[r.booking_id] || t('profile.rateSection.defaultParticipantName'));
    const bz    = _escR(r.context_name || t('profile.rateSection.defaultBazaarName'));
    const stars = '⭐'.repeat(Math.max(0, Math.min(5, r.overall || 0)));
    const rd    = r.created_at
      ? new Date(r.created_at).toLocaleDateString(_profLocale(), { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    return `
      <div class="op-rate-hrow">
        <div class="op-rate-hrow-top">
          <span class="op-rate-hrow-who">${who}</span>
          <span class="op-rate-hrow-stars">${stars || '—'}</span>
        </div>
        <div class="op-rate-hrow-meta">🎪 ${bz} · ${rd}</div>
        ${r.comment ? `<div class="op-rate-hrow-note">${_escR(r.comment)}</div>` : ''}
      </div>`;
  }).join('');
}

/* عند اختيار مشارك: اعرض سياق البازار + عبّئ تقييماً سابقاً إن وُجد (تعديل) */
function bzOnParticipantChange() {
  const sel       = document.getElementById('bz-rate-participant');
  const bookingId = sel?.value;
  const ctxEl     = document.getElementById('bz-rate-context');
  const p         = bzRateableParticipants.find(x => x.booking_id === bookingId);

  if (ctxEl) {
    if (p) {
      const act = p.activity ? ' · ' + _escR(p.activity) : '';
      ctxEl.innerHTML   = `🎪 ${_escR(p.bazaar_name || t('profile.rateSection.defaultBazaarName'))}${act}`;
      ctxEl.style.display = 'block';
    } else {
      ctxEl.style.display = 'none';
      ctxEl.innerHTML = '';
    }
  }

  const prev = bzOrganizerRatings.find(r => r.booking_id === bookingId);
  bzRateVals = {
    commitment:  prev?.commitment  || 0,
    cleanliness: prev?.cleanliness || 0,
    dealing:     prev?.dealing     || 0,
    payment:     prev?.payment     || 0,
    rules:       prev?.rules       || 0,
  };
  const notesEl = document.getElementById('bz-rate-notes');
  if (notesEl) notesEl.value = prev?.comment || '';
  bzRenderRateStars();
  bzUpdateAvg();
}

async function submitBazaarRating() {
  const sel       = document.getElementById('bz-rate-participant');
  const bookingId = sel?.value;
  const msgEl     = document.getElementById('bz-rate-msg');
  const btn       = document.getElementById('bz-btn-submit-rating');

  const showMsg = (type, text) => {
    if (!msgEl) return;
    msgEl.className = 'op-rate-msg ' + type;
    msgEl.style.display = 'block';
    msgEl.textContent = (type === 'success' ? '✅ ' : '❌ ') + text;
    if (type === 'success') setTimeout(() => { msgEl.style.display = 'none'; }, 4000);
  };

  if (!bookingId) { showMsg('error', t('profile.rateSection.selectFirstErr')); return; }

  const set = _bzRateValsArray();
  if (!set.length) { showMsg('error', t('profile.rateSection.rateOneErr')); return; }

  const overall = Math.max(1, Math.min(5, Math.round(set.reduce((a, b) => a + b, 0) / set.length)));
  const notes   = document.getElementById('bz-rate-notes')?.value.trim() || '';
  const nn      = v => (v && v > 0 ? v : null);

  if (!sbClient) { showMsg('error', t('profile.rateSection.connectionErr')); return; }
  if (btn) { btn.disabled = true; btn.textContent = t('profile.rateSection.savingBtn'); }

  try {
    const { error } = await sbClient.rpc('rate_tenant', {
      p_booking_id:   bookingId,
      p_context_type: 'bazaar',
      p_overall:      overall,
      p_commitment:   nn(bzRateVals.commitment),
      p_cleanliness:  nn(bzRateVals.cleanliness),
      p_dealing:      nn(bzRateVals.dealing),
      p_payment:      nn(bzRateVals.payment),
      p_rules:        nn(bzRateVals.rules),
      p_comment:      notes || null,
    });
    if (error) throw error;

    showMsg('success', t('profile.rateSection.successMsg', { overall }));
    await _reloadBazaarRatings();
  } catch (e) {
    const map = {
      not_authorized_booking:     t('profile.rateSection.errors.not_authorized_booking'),
      cannot_rate_self:           t('profile.rateSection.errors.cannot_rate_self'),
      invalid_overall:            t('profile.rateSection.errors.invalid_overall'),
      no_registered_user:         t('profile.rateSection.errors.no_registered_user'),
      participant_not_registered: t('profile.rateSection.errors.participant_not_registered'),
      invalid_context:            t('profile.rateSection.errors.invalid_context'),
      unauthorized:                t('profile.rateSection.errors.unauthorized'),
    };
    showMsg('error', map[e?.message] || t('profile.rateSection.errors.generic', { msg: e?.message || t('profile.rateSection.errors.genericUnknown') }));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('profile.rateSection.submitBtn'); }
  }
}

/* أعد جلب القوائم وحدّث الودجة دون إعادة رسم الصفحة كاملة */
async function _reloadBazaarRatings() {
  try {
    const [rateableRes, ratingsRes] = await Promise.all([
      sbClient.rpc('organizer_list_rateable_participants'),
      sbClient.from('user_ratings').select('*')
        .eq('rater_id', currentUser.id).eq('context_type', 'bazaar')
        .order('created_at', { ascending: false }),
    ]);
    bzRateableParticipants = rateableRes.data || [];
    bzOrganizerRatings     = ratingsRes.data || [];
  } catch (_) {}

  /* أعد بناء القائمة المنسدلة (مع علامة ✓ للمُقيَّمين) */
  const sel = document.getElementById('bz-rate-participant');
  if (sel) {
    sel.innerHTML = `<option value="">${t('profile.rateSection.selectPlaceholder')}</option>` +
      bzRateableParticipants.map(p => {
        const mark = p.rating_id ? t('profile.rateSection.ratedMark') : '';
        const who  = _escR(p.business_name || p.tenant_name || t('profile.rateSection.defaultParticipantName'));
        return `<option value="${p.booking_id}">${who} — ${_escR(p.bazaar_name || t('profile.rateSection.defaultBazaarName'))}${mark}</option>`;
      }).join('');
    sel.value = '';
  }

  /* صفّر الفورم */
  bzRateVals = { commitment: 0, cleanliness: 0, dealing: 0, payment: 0, rules: 0 };
  const ctxEl   = document.getElementById('bz-rate-context');
  if (ctxEl) { ctxEl.style.display = 'none'; ctxEl.innerHTML = ''; }
  const notesEl = document.getElementById('bz-rate-notes');
  if (notesEl) notesEl.value = '';
  bzRenderRateStars();
  bzUpdateAvg();

  /* حدّث عدّاد المشاركين + سجل التقييمات */
  const cntEl = document.getElementById('bz-rate-count');
  if (cntEl) cntEl.textContent = t('profile.rateSection.countBadge', { count: bzRateableParticipants.length });

  const histWrap  = document.getElementById('bz-rate-history');
  const histRows  = document.getElementById('bz-rate-history-rows');
  const histCount = document.getElementById('bz-rate-hist-count');
  if (histRows)  histRows.innerHTML  = _bzHistoryRowsHtml();
  if (histCount) histCount.textContent = bzOrganizerRatings.length;
  if (histWrap)  histWrap.style.display = bzOrganizerRatings.length ? '' : 'none';
}


/* ================================================================
   🎖️ حساب الأوسمة (Badges)
   ================================================================ */
function _computeBadges({ isVerified, isSpaceOwner, hasBazaars, listings, avgRating, reviewsCount }) {
  const primary   = [];
  const secondary = [];

  /* الأوسمة الرئيسية — بارزة */
  if (isVerified || hasBazaars) {
    primary.push({
      id: 'organizer', emoji: '🎪',
      label: t('profile.badges.organizerLabel'),
      desc:  isVerified ? t('profile.badges.organizerDescVerified') : t('profile.badges.organizerDescUnverified'),
    });
  }
  if (isSpaceOwner) {
    primary.push({
      id: 'space-owner', emoji: '🏪',
      label: t('profile.badges.spaceOwnerLabel'),
      desc:  t('profile.badges.spaceOwnerDesc'),
    });
  }

  /* الأوسمة الثانوية */
  const activeCnt = listings.filter(l => l.status !== 'sold' && l.status !== 'expired').length;
  if (activeCnt >= 2) {
    secondary.push({ id: 'active-seller', emoji: '🛍️', label: t('profile.badges.activeSeller'), tier: 'silver' });
  }
  if (avgRating >= 4.5 && reviewsCount >= 3) {
    secondary.push({ id: 'top-rated', emoji: '⭐', label: t('profile.badges.topRated'), tier: 'gold' });
  }
  if (listings.length >= 5) {
    secondary.push({ id: 'prolific', emoji: '📦', label: t('profile.badges.prolific'), tier: 'gold' });
  }

  return { primary, secondary };
}


/* ================================================================
   🛍️ عرض شبكة الإعلانات
   ================================================================ */
function _renderListingsGrid(listings) {
  if (!listings || !listings.length) {
    return `<div class="op-empty">
      <div style="font-size:26px;margin-bottom:8px">🛍️</div>
      <div>${t('profile.listingsSection.empty')}</div>
      <a href="/post-ad/" style="display:inline-block;margin-top:10px;font-size:12px;color:var(--orange);font-weight:700;text-decoration:none">${t('profile.listingsSection.addNew')}</a>
    </div>`;
  }

  const now = new Date().toISOString();
  return `<div class="op-listing-grid">` +
    listings.map(l => {
      const isExpired = l.expires_at && l.expires_at < now;
      const isSold    = l.status === 'sold';
      const isPending = l.status === 'pending';
      let sc = '', sl = t('profile.listingsSection.statusActive');
      if (isSold)    { sc = 'sold';    sl = t('profile.listingsSection.statusSold'); }
      if (isExpired) { sc = 'expired'; sl = t('profile.listingsSection.statusExpired'); }
      if (isPending) { sc = 'pending'; sl = t('profile.listingsSection.statusPending'); }

      const imgHtml = l.cover_image
        ? `<img src="${_toDirectImgUrl(l.cover_image)}" alt="${l.title}" onerror="this.parentElement.innerHTML='🛍️'">`
        : `<span>🛍️</span>`;

      return `
        <div class="op-listing-card" onclick="window.open('/market/?manage=${l.id}','_blank')" title="${t('profile.listingsSection.manageTitle', { title: l.title })}">
          <div class="op-listing-img">${imgHtml}</div>
          <div class="op-listing-info">
            <div class="op-listing-title">${l.title || t('profile.listingsSection.untitled')}</div>
            <div class="op-listing-meta">
              <span class="op-listing-price">${l.price ? Number(l.price).toLocaleString(_profLocale()) + ' ' + t('card.currency') : '—'}</span>
              <span class="op-listing-status ${sc}">${sl}</span>
            </div>
          </div>
        </div>`;
    }).join('') +
    `</div>`;
}


/* ================================================================
   🌐 بروفايل عام — تحميل البيانات
   ================================================================ */
async function _loadPublicProfile(userId) {
  let publicUser = null;   // profiles
  let organizer  = null;   // organizer_profiles
  let reviews    = [];
  let bazaars    = [];
  let totalExhibitors = 0; // إجمالي الحجوزات المؤكدة في كل بازارات هذا المنظم
  let bazaarRating = { total: 0, avg_rating: 0 }; // متوسط تقييمه كمنظم — من bazaar_reviews

  /* ⚠️ لا تُجلب هنا "السمعة كمستأجر" (get_user_reputation/user_ratings) عمدًا —
     هذه بيانات شخصية عن التينانت الكامن خلف الحساب ولا يجوز عرضها على أي صفحة
     عامة قابلة للمشاركة، حتى لو كان صاحبها أيضًا منظم بازارات موثّق. تبقى حصرًا
     في _loadMyProfile للعرض الذاتي الخاص. */
  try {
    const [profileRes, orgProfileRes, reviewsRes, bazaarsRes, exhibitorsRes, bazaarRatingRes] = await Promise.all([
      sbClient.from('public_profiles').select('full_name,created_at,roles,city').eq('id', userId).single(),
      sbClient.from('organizer_profiles').select('*').eq('user_id', userId).single(),
      sbClient.from('organizer_reviews').select('*')
              .eq('organizer_id', userId).order('created_at', { ascending: false }),
      sbClient.from('bazaars').select('id,name,date_start,date_end,location,image,total_slots,available_slots,status,is_archived,event_links')
              .eq('organizer_id', userId).eq('is_deleted', false).order('date_start', { ascending: false }),
      sbClient.rpc('get_organizer_total_exhibitors', { p_organizer_id: userId }),
      sbClient.rpc('get_organizer_overall_rating', { p_organizer_id: userId }),
    ]);

    publicUser  = profileRes.data  || null;
    organizer   = orgProfileRes.data || null;
    reviews     = reviewsRes.data   || [];
    bazaars     = bazaarsRes.data   || [];
    totalExhibitors = exhibitorsRes.data || 0;
    bazaarRating = bazaarRatingRes.data || bazaarRating;
  } catch (e) {
    console.warn('[profile] public load error:', e.message);
  }

  _renderPublicProfile(userId, publicUser, organizer, reviews, bazaars, totalExhibitors, bazaarRating);
}

function _renderPublicProfile(userId, publicUser, organizer, reviews, bazaars, totalExhibitors, bazaarRating) {
  const content = document.getElementById('op-content');

  /* اسم المستخدم — من profiles أو organizer_profiles */
  const displayName = organizer?.full_name || publicUser?.full_name || t('profile.unknownUser');

  if (!publicUser && !organizer) {
    content.innerHTML = `
      <div style="text-align:center;padding:80px 24px">
        <div style="font-size:40px;margin-bottom:12px">🔍</div>
        <div style="font-size:15px;color:var(--ink3)">${t('profile.notFound')}</div>
        <a href="/" class="btn" style="margin-top:20px;display:inline-block;padding:10px 24px">${t('profile.nav.backHome')}</a>
      </div>`;
    return;
  }

  const initial    = displayName[0]?.toUpperCase() || '؟';
  const avatarUrl  = organizer?.avatar_url || organizer?.logo || organizer?.image || '';
  const avatarHtml = avatarUrl
    ? `<img src="${_toDirectImgUrl(avatarUrl)}" alt="avatar" onerror="this.outerHTML='<span>${initial}</span>'">`
    : `<span>${initial}</span>`;

  /* ── Cover ── */
  const pubCoverUrl  = _toDirectImgUrl(organizer?.cover_url || '');
  const pubCoverHtml = `
    <div class="op-cover-section">
      ${pubCoverUrl ? `<img src="${pubCoverUrl}" alt="cover">` : ''}
    </div>`;

  /* ── Bio ── */
  const pubBioHtml = organizer?.bio
    ? `<div class="op-bio">${organizer.bio}</div>`
    : '';

  /* ── Social Links ── */
  const pubSocialLinks = [
    { key: 'facebook_url',  cls: 'fb', title: 'Facebook',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>` },
    { key: 'instagram_url', cls: 'ig', title: 'Instagram',
      icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>` },
    { key: 'tiktok_url',   cls: 'tt', title: 'TikTok',
      icon: `<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.32 6.32 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.15 8.15 0 0 0 4.77 1.52V6.75a4.86 4.86 0 0 1-1-.06z"/></svg>` },
  ];
  const pubSocialHtml = (() => {
    const links = pubSocialLinks
      .filter(s => organizer?.[s.key])
      .map(s => `<a href="${organizer[s.key]}" target="_blank" rel="noopener noreferrer" class="op-social-link ${s.cls}" title="${s.title}">${s.icon}</a>`)
      .join('');
    return links ? `<div class="op-social-links">${links}</div>` : '';
  })();

  /* تاريخ الانضمام */
  const joinDate = (publicUser?.created_at || organizer?.joined_at)
    ? new Date(publicUser?.created_at || organizer?.joined_at)
        .toLocaleDateString(_profLocale(), { year:'numeric', month:'long' })
    : '—';

  /* إحصائيات */
  const today        = new Date().toISOString().split('T')[0];
  const activeBazaars = bazaars.filter(b =>
    !b.is_archived && b.status !== 'archived' &&
    (!b.date_end || b.date_end >= today)
  );
  const pastBazaars   = bazaars.filter(b =>
    b.is_archived || b.status === 'archived' ||
    (b.date_end && b.date_end < today)
  );
  const pastCount      = pastBazaars.length;
  const totalVendors   = totalExhibitors || 0;
  const avgRating      = bazaarRating?.total
    ? Number(bazaarRating.avg_rating).toFixed(1)
    : null;

  _profOrgBazaars = bazaars;

  /* إحصائيات الأداء */
  const completedBazaars = bazaars.filter(b => b.status === 'completed');
  const docsCount        = completedBazaars.filter(b => Array.isArray(b.event_links) && b.event_links.filter(u => u).length > 0).length;
  const totalBooked      = bazaars.reduce((s, b) => s + ((b.total_slots || 0) - (typeof b.available_slots === 'number' ? b.available_slots : (b.total_slots || 0))), 0);
  const cancelledCount   = bazaars.filter(b => b.status === 'cancelled').length;
  const hasPerf          = completedBazaars.length > 0 || totalBooked > 0;

  /* معدل نجاح التنظيم */
  const totalFinalized  = completedBazaars.length + cancelledCount;
  const successRate     = totalFinalized >= 2 ? Math.round((completedBazaars.length / totalFinalized) * 100) : null;

  /* تحذير الإلغاء الحديث — آخر 60 يوم */
  const _cancelThreshold    = new Date(Date.now() - 60 * 86400000).toISOString().split('T')[0];
  const recentCancelWarning = bazaars.some(b => b.status === 'cancelled' && b.date_start && b.date_start >= _cancelThreshold);

  /* أوسمة عامة */
  const isVerified    = organizer?.is_verified === true;
  const isSpaceOwner  = !!publicUser?.roles?.includes('space_owner');
  const { primary: primaryBadges, secondary: secBadges } = _computeBadges({
    isVerified, isSpaceOwner,
    hasBazaars: bazaars.length > 0,
    listings: [], avgRating: avgRating ? parseFloat(avgRating) : 0,
    reviewsCount: bazaarRating?.total || 0,
  });

  /* ⚠️ حارس المبدأ: بروفايل التينانت ليس عامًا ولا يدعم المشاركة — إن لم يطابق هذا
     الحساب أي دور عام (لا توثيق منظم، لا بازارات فعلية، لا وسم صاحب مساحة) فلا يوجد
     "بروفايل عام" له أصلاً، بصرف النظر عمّن يملك المعرّف أو كيف وصل لهذا الرابط
     (مثال حقيقي: لوحة الأدمن كانت تفتح هذا الرابط لأي تينانت مُقيَّم). نفس معيار
     ظهور زر "مشاركة البروفايل" أدناه — لا حارس جديد منفصل، إعادة استخدام كاملة. */
  if (!primaryBadges.length) {
    content.innerHTML = `
      <div style="text-align:center;padding:80px 24px">
        <div style="font-size:40px;margin-bottom:12px">🔒</div>
        <div style="font-size:15px;color:var(--ink3)">${t('profile.noPublicProfile')}</div>
        <a href="/" class="btn" style="margin-top:20px;display:inline-block;padding:10px 24px">${t('profile.nav.backHome')}</a>
      </div>`;
    return;
  }

  /* شارة أداء المنظم (🥉/🥈/🥇) */
  if (completedBazaars.length >= 6 && successRate !== null && successRate >= 90 && avgRating && parseFloat(avgRating) >= 4.0) {
    secBadges.unshift({ id: 'top-org', emoji: '🥇', label: t('profile.badges.topOrg'), tier: 'gold' });
  } else if (completedBazaars.length >= 3 && successRate !== null && successRate >= 75) {
    secBadges.unshift({ id: 'reliable-org', emoji: '🥈', label: t('profile.badges.reliableOrg'), tier: 'silver' });
  } else if (completedBazaars.length >= 1) {
    secBadges.unshift({ id: 'active-org', emoji: '🥉', label: t('profile.badges.activeOrg'), tier: '' });
  }

  /* شارة الاسم */
  const nameBadge = isVerified ? `<span class="op-verified-badge">${t('profile.orgBadge.verified')}</span>` : '';

  /* ── بناء بطاقة بازار واحدة ── */
  function _buildBazaarRow(b) {
    const ds = b.date_start
      ? new Date(b.date_start).toLocaleDateString(_profLocale(), { year:'numeric', month:'short', day:'numeric' })
      : '—';
    const de = b.date_end
      ? new Date(b.date_end).toLocaleDateString(_profLocale(), { month:'short', day:'numeric' })
      : null;
    const dateLabel = de && de !== ds ? `${ds} ${getLocale() === 'en' ? '→' : '←'} ${de}` : ds;
    const imgHtml = b.image
      ? `<img src="${_toDirectImgUrl(b.image)}" alt="${b.name}"
             style="width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0"
             onerror="this.style.display='none'">`
      : `<div style="width:44px;height:44px;border-radius:8px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🎪</div>`;

    /* إحصائيات الأداء */
    const booked   = (b.total_slots || 0) - (b.available_slots ?? b.total_slots ?? 0);
    const fillRate = b.total_slots > 0 ? Math.round((booked / b.total_slots) * 100) : null;
    const hasLinks = Array.isArray(b.event_links) && b.event_links.filter(u => u).length > 0;
    const isCompleted = b.status === 'completed';

    const statsBadges = [
      fillRate !== null ? `<span style="font-size:10px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;border-radius:50px;padding:1px 7px">${t('profile.publicSections.fillRateBadge', { pct: fillRate })}</span>` : '',
      isCompleted && hasLinks  ? `<span style="font-size:10px;font-weight:700;color:#047857;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:50px;padding:1px 7px">${t('profile.publicSections.docVerified')}</span>` : '',
      isCompleted && !hasLinks ? `<span style="font-size:10px;color:#92400e;background:#fefce8;border:1px solid #fde68a;border-radius:50px;padding:1px 7px">${t('profile.publicSections.docMissing')}</span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="op-bazaar-item" onclick="window.location.href='/bazaars/?id=${b.id}'">
        ${imgHtml}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${b.name}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:2px">📅 ${dateLabel} · 📍 ${b.location||'—'}</div>
          ${statsBadges ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">${statsBadges}</div>` : ''}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2" width="14" height="14" style="flex-shrink:0"><path d="M15 18l-6-6 6-6"/></svg>
      </div>`;
  }

  /* قائمة البازارات مقسّمة */
  const activeBazaarsHtml = activeBazaars.length
    ? activeBazaars.map(_buildBazaarRow).join('')
    : `<div class="op-empty">${t('profile.publicSections.emptyActiveBazaars')}</div>`;
  const pastBazaarsHtml = pastBazaars.length
    ? pastBazaars.map(_buildBazaarRow).join('')
    : `<div class="op-empty">${t('profile.publicSections.emptyPastBazaars')}</div>`;

  const reviewsHtml = reviews.length
    ? reviews.map(r => {
        const stars = '⭐'.repeat(Math.min(5, Math.round(r.rating||0)));
        const rd = r.created_at
          ? new Date(r.created_at).toLocaleDateString(_profLocale(), { month:'short', day:'numeric', year:'numeric' })
          : '';
        return `
          <div class="op-review-item">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
              <span>${stars || '—'}</span>
              <span style="font-size:11px;color:var(--ink3)">${rd}</span>
            </div>
            ${r.comment ? `<p style="font-size:13px;color:var(--ink2);margin:0;line-height:1.7">${r.comment}</p>` : ''}
          </div>`;
      }).join('')
    : `<div class="op-empty">${t('profile.reviewsSection.empty')}</div>`;

  content.innerHTML = `

  <!-- ═══════ HERO ═══════ -->
  <div class="op-hero">

    ${pubCoverHtml}

    <div class="op-hero-top">
      <div class="op-avatar-wrap">
        <div class="op-avatar">${avatarHtml}</div>
      </div>
      <div class="op-hero-info">
        <div class="op-name">${displayName} ${nameBadge}</div>
        <div class="op-hero-meta">
          <span>${t('profile.hero.memberSince', { date: joinDate })}</span>
          ${organizer?.region ? `<span>📍 ${organizer.region}</span>` : ''}
        </div>
        ${pubBioHtml}
        ${pubSocialHtml}
        <div class="op-hero-actions" style="margin-top:${pubBioHtml || pubSocialHtml ? '10px' : '0'}">
          ${primaryBadges.length ? `<button class="op-qn-btn" onclick="sharePublicOrganizerProfile()">${t('profile.hero.shareBtn')}</button>` : ''}
        </div>

        <!-- الأوسمة الرئيسية -->
        ${primaryBadges.length ? `
        <div class="op-primary-badges">
          ${primaryBadges.map(b => `
            <div class="op-badge-primary ${b.id}">
              <span class="op-badge-icon">${b.emoji}</span>
              <div>
                <div class="op-badge-label">${b.label}</div>
                <div class="op-badge-desc">${b.desc}</div>
              </div>
            </div>`).join('')}
        </div>` : ''}

        ${secBadges.length ? `
        <div class="op-sec-badges">
          ${secBadges.map(b => `<span class="op-sec-badge ${b.tier==='gold'?'gold':''}">${b.emoji} ${b.label}</span>`).join('')}
        </div>` : ''}
      </div>
    </div>
  </div>

  <!-- ═══════ الإحصائيات (عامة فقط) ═══════ -->
  <div class="op-stats-grid">
    <div class="op-stat-card">
      <div class="op-stat-num">${activeBazaars.length}</div>
      <div class="op-stat-lbl">${t('profile.stats.activeBazaars')}</div>
    </div>
    <div class="op-stat-card">
      <div class="op-stat-num">${pastCount}</div>
      <div class="op-stat-lbl">${t('profile.stats.pastBazaars')}</div>
    </div>
    <div class="op-stat-card">
      <div class="op-stat-num">${avgRating ? avgRating + ' ⭐' : '—'}</div>
      <div class="op-stat-lbl">${t('profile.stats.avgRating')}</div>
    </div>
    <div class="op-stat-card">
      <div class="op-stat-num">${totalVendors}</div>
      <div class="op-stat-lbl">${t('profile.stats.totalVendors')}</div>
    </div>
  </div>

  <!-- ملاحظة: لا قسم "سمعة كمستأجر" هنا عمدًا — بيانات شخصية عن التينانت، تبقى حصرًا
       في الصفحة الذاتية الخاصة (_renderMyProfile)، لا تُعرض على أي بروفايل عام. -->

  <!-- ═══════ سجل الأداء ═══════ -->
  ${hasPerf ? `
  <div class="op-section-card" style="margin-bottom:16px">
    <div class="op-section-title"><span>${t('profile.publicSections.performanceTitle')}</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px">
      ${completedBazaars.length > 0 ? `
      <div style="text-align:center;background:var(--surface2);border-radius:12px;padding:12px 8px;border:1px solid var(--border)">
        <div style="font-size:22px;font-weight:900;color:#1d4ed8">📅 ${completedBazaars.length}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600">${t('profile.publicSections.completedCount')}</div>
      </div>` : ''}
      ${totalBooked > 0 ? `
      <div style="text-align:center;background:var(--surface2);border-radius:12px;padding:12px 8px;border:1px solid var(--border)">
        <div style="font-size:22px;font-weight:900;color:#047857">✅ ${totalBooked}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600">${t('profile.publicSections.bookedCount')}</div>
      </div>` : ''}
      ${docsCount > 0 ? `
      <div class="op-stat-clickable" style="text-align:center;background:var(--surface2);border-radius:12px;padding:12px 8px;border:1px solid var(--border);cursor:pointer" onclick="openOrgDocsShowcase()">
        <div style="font-size:22px;font-weight:900;color:#059669">📎 ${docsCount}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600">${t('profile.publicSections.viewDocsLinksCta')}</div>
      </div>` : ''}
      ${cancelledCount > 0 ? `
      <div style="text-align:center;background:var(--surface2);border-radius:12px;padding:12px 8px;border:1px solid var(--border)">
        <div style="font-size:22px;font-weight:900;color:#dc2626">❌ ${cancelledCount}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600">${t('profile.publicSections.cancelledCount')}</div>
      </div>` : ''}
      ${successRate !== null ? `
      <div style="text-align:center;background:${successRate >= 80 ? '#f0fdf4' : successRate >= 60 ? '#fefce8' : '#fef2f2'};border-radius:12px;padding:12px 8px;border:1px solid ${successRate >= 80 ? '#86efac' : successRate >= 60 ? '#fde68a' : '#fecaca'}">
        <div style="font-size:22px;font-weight:900;color:${successRate >= 80 ? '#047857' : successRate >= 60 ? '#92400e' : '#dc2626'}">${successRate >= 80 ? '🎯' : successRate >= 60 ? '📊' : '⚠️'} ${successRate}%</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px;font-weight:600">${t('profile.publicSections.successRateLabel')}</div>
      </div>` : ''}
    </div>
  </div>` : ''}

  <!-- ═══════ تحذير الإلغاء الحديث ═══════ -->
  ${recentCancelWarning ? `
  <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;gap:10px;align-items:flex-start">
    <span style="font-size:18px;flex-shrink:0">⚠️</span>
    <div>
      <div style="font-size:13px;font-weight:700;color:#b91c1c">${t('profile.publicSections.reliabilityWarningTitle')}</div>
      <div style="font-size:12px;color:#dc2626;margin-top:3px;line-height:1.6">${t('profile.publicSections.reliabilityWarningDesc')}</div>
    </div>
  </div>` : ''}

  <!-- ═══════ البازارات النشطة/القادمة ═══════ -->
  <div class="op-section-card" style="margin-bottom:16px">
    <div class="op-section-title">
      <span>${t('profile.publicSections.activeBazaarsTitle', { count: activeBazaars.length })}</span>
    </div>
    ${activeBazaarsHtml}
  </div>

  <!-- ═══════ البازارات السابقة ═══════ -->
  ${pastBazaars.length ? `
  <div class="op-section-card" style="margin-bottom:16px">
    <div class="op-section-title">
      <span style="color:var(--ink3)">${t('profile.publicSections.pastBazaarsTitle', { count: pastBazaars.length })}</span>
    </div>
    ${pastBazaarsHtml}
  </div>` : ''}

  <!-- ═══════ تقييماته ═══════ -->
  <div class="op-section-card">
    <div class="op-section-title"><span>${t('profile.reviewsSection.titlePublic', { count: reviews.length })}</span></div>
    ${reviewsHtml}
  </div>`;
}

/* ════════════════════════════════════════════════════════
   📎 نافذة "روابط التوثيق" — أحدث 5 بازارات موثَّقة لهذا المنظم
   مكرَّرة عمداً من bazaars/app.js's _eventLinkMeta/_safeEventLinkHref (لا استيراد بين
   الصفحات) — تستخدم نفس مفاتيح الترجمة 'info.linkAction.*' لأن هذه الصفحة تحمّل
   بالفعل namespace 'bazaars' نفسه (initI18n(['bazaars','common']))
════════════════════════════════════════════════════════ */
const _PROF_LINK_PLATFORMS = [
  { test: d => d.includes('tiktok.com'),                            icon: '🎵', key: 'tiktok' },
  { test: d => d.includes('facebook.com') || d.includes('fb.com'),  icon: '📘', key: 'facebook' },
  { test: d => d.includes('instagram.com'),                         icon: '📸', key: 'instagram' },
  { test: d => d.includes('youtube.com') || d.includes('youtu.be'), icon: '▶️', key: 'youtube' },
  { test: d => d.includes('drive.google.com') || d.includes('docs.google.com'), icon: '📁', key: 'googleDrive' },
  { test: d => d.includes('x.com') || d.includes('twitter.com'),    icon: '🐦', key: 'x' },
  { test: d => d.includes('snapchat.com'),                          icon: '👻', key: 'snapchat' },
  { test: d => d.includes('linkedin.com'),                          icon: '💼', key: 'linkedin' },
];
function _profLinkMeta(u) {
  let domain = '';
  try { domain = new URL(u).hostname.replace('www.', ''); } catch {}
  const m = _PROF_LINK_PLATFORMS.find(p => p.test(domain));
  return { icon: m ? m.icon : '🔗', label: t('info.linkAction.' + (m ? m.key : 'generic')) };
}

function _profSafeLinkHref(u) {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return null;
    return _escR(u);
  } catch { return null; }
}

function openOrgDocsShowcase() {
  const modal = document.getElementById('org-docs-modal');
  const body  = document.getElementById('org-docs-modal-body');
  if (!modal || !body) return;

  const documented = _profOrgBazaars
    .filter(b => Array.isArray(b.event_links) && b.event_links.filter(u => u).length > 0)
    .sort((a, b) => (b.date_end || b.date_start || '').localeCompare(a.date_end || a.date_start || ''))
    .slice(0, 5);

  body.innerHTML = documented.map(b => {
    const dateStr = b.date_start
      ? new Date(b.date_start).toLocaleDateString(_profLocale(), { year: 'numeric', month: 'short', day: 'numeric' })
      : '—';
    const links = b.event_links.filter(u => u);
    const linksHtml = links.map(u => {
      const safeHref = _profSafeLinkHref(u);
      if (!safeHref) return '';
      const meta = _profLinkMeta(u);
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="bz-doclink-btn">
        <span class="bz-doclink-ico">${meta.icon}</span>
        <span class="bz-doclink-label">${meta.label}</span>
        <span class="bz-doclink-arrow">↗</span>
      </a>`;
    }).join('');
    return `
      <div class="org-docs-bazaar-group">
        <div class="org-docs-bazaar-hd">
          <span class="org-docs-bazaar-name">${_escR(b.name)}</span>
          <span class="org-docs-bazaar-date">📅 ${dateStr}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">${linksHtml}</div>
      </div>`;
  }).join('');

  modal.classList.add('open');
}

function closeOrgDocsShowcase() {
  document.getElementById('org-docs-modal')?.classList.remove('open');
}

/* ── السمعة كمستأجر: شارة + معايير + تقييمات مستلمة (للملف العام) ──
   دالة بدل const ثابت — لازم تُستدعى وقت الرسم بعد جاهزية i18next */
function _pubRepBadges() {
  return {
    excellent: { label: t('profile.reputation.excellent'), emoji: '🏆', cls: 'rep-excellent' },
    trusted:   { label: t('profile.reputation.trusted'),   emoji: '✅', cls: 'rep-trusted' },
    good:      { label: t('profile.reputation.good'),      emoji: '👍', cls: 'rep-good' },
    weak:      { label: t('profile.reputation.weak'),      emoji: '⚠️', cls: 'rep-weak' },
    new:       { label: t('profile.reputation.new'),       emoji: '✨', cls: 'rep-new' },
  };
}

function _pubRepStars(val, size) {
  const v = Math.round(Number(val) || 0);
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span style="color:${i <= v ? '#F36418' : '#d9d9d9'};font-size:${size || 14}px">★</span>`;
  }
  return s;
}

function _pubRepPanelHtml(reputation, recvRatings) {
  const total = reputation?.total || 0;
  if (!total) return '';   // لا نعرض القسم إن لم توجد تقييمات مستلمة

  const avg   = Number(reputation?.avg_overall || 0);
  const repBadges = _pubRepBadges();
  const badge = repBadges[reputation?.badge] || repBadges.new;

  const critRows = [
    [t('profile.rateSection.criteria.commitment'), reputation.avg_commitment],
    [t('profile.reputation.criteria.cleanliness'), reputation.avg_cleanliness],
    [t('profile.rateSection.criteria.dealing'),    reputation.avg_dealing],
    [t('profile.rateSection.criteria.payment'),    reputation.avg_payment],
    [t('profile.reputation.criteria.rules'),       reputation.avg_rules],
  ].filter(r => r[1] != null);

  const panel = `
    <div class="rep-panel">
      <div class="rep-badge ${badge.cls}">
        <div class="rep-badge-emoji">${badge.emoji}</div>
        <div class="rep-score">${avg.toFixed(1)}</div>
        <div class="rep-stars">${_pubRepStars(avg, 16)}</div>
        <div class="rep-badge-label">${badge.label}</div>
        <div class="rep-count">${t('profile.reputation.countSuffix', { count: total, positive: reputation.positive || 0, negative: reputation.negative || 0 })}</div>
      </div>
      ${critRows.length ? `<div class="rep-criteria">
        ${critRows.map(([label, val]) => `
          <div class="rep-crit-row">
            <span class="rep-crit-label">${label}</span>
            <span class="rep-crit-bar"><span class="rep-crit-fill" style="width:${(Number(val) / 5 * 100)}%"></span></span>
            <span class="rep-crit-val">${Number(val).toFixed(1)}</span>
          </div>`).join('')}
      </div>` : ''}
    </div>`;

  const list = (recvRatings || []).map(r => {
    const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString(_profLocale()) : '';
    const ctxIcon = r.context_type === 'bazaar' ? '🎪' : '🏬';
    const roleLbl = r.rater_role === 'organizer' ? t('profile.reputation.roleOrganizer') : t('profile.reputation.roleOwner');
    return `
      <div class="recv-rating-card">
        <div class="recv-rating-head">
          <div>
            <div class="recv-rater">${ctxIcon} ${_escR(r.rater_name || roleLbl)}</div>
            <div class="recv-context">${roleLbl}${r.context_name ? ' · ' + _escR(r.context_name) : ''}</div>
          </div>
          <div class="recv-rating-stars">${_pubRepStars(r.overall, 14)}<span class="recv-date">${dateStr}</span></div>
        </div>
        ${r.comment ? `<div class="recv-comment">"${_escR(r.comment)}"</div>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="op-section-card" style="margin-bottom:16px">
      <div class="op-section-title"><span>${t('profile.reputation.sectionTitle', { count: total })}</span></div>
      <p style="font-size:12.5px;color:var(--ink3);line-height:1.7;margin:0 0 14px">
        ${t('profile.reputation.sectionDesc')}
      </p>
      ${panel}
      ${list ? `<div class="recv-ratings-list">${list}</div>` : ''}
    </div>`;
}


/* ================================================================
   ── دوال مساعدة
   ================================================================ */
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
   ✍️ نافذة التعديل
   ================================================================ */
function openEditModal() {
  const modal = document.getElementById('edit-profile-modal');
  if (!modal) return;

  document.getElementById('edit-name').value      = myProfileData?.full_name || myUserProfile?.full_name || '';
  document.getElementById('edit-phone').value     = myMergedPhone || '';
  document.getElementById('edit-region').value    = myProfileData?.region   || '';
  document.getElementById('edit-bio').value       = myProfileData?.bio      || '';
  document.getElementById('edit-facebook').value  = myProfileData?.facebook_url  || '';
  document.getElementById('edit-instagram').value = myProfileData?.instagram_url || '';
  document.getElementById('edit-tiktok').value    = myProfileData?.tiktok_url    || '';

  const cityEl = document.getElementById('edit-city');
  if (cityEl) {
    const cityVal = myMergedCity || '';
    const opt = [...cityEl.options].find(o => o.value === cityVal || o.text === cityVal);
    cityEl.value = opt ? opt.value : '';
  }

  const pwdEl = document.getElementById('edit-password');
  const cfmEl = document.getElementById('edit-password-confirm');
  if (pwdEl) pwdEl.value = '';
  if (cfmEl) cfmEl.value = '';

  /* ── معاينة صورة الغلاف داخل المودال ── */
  const cvThumb = document.getElementById('edit-cover-thumb-inner');
  if (cvThumb) {
    const cv = _toDirectImgUrl(myProfileData?.cover_url || '');
    cvThumb.innerHTML = cv
      ? `<img src="${cv}" style="width:100%;height:100%;object-fit:cover;border-radius:9px" onerror="this.style.display='none'">`
      : '';
  }

  /* ── معاينة الأفاتار داخل المودال ── */
  const avThumb = document.getElementById('edit-avatar-thumb-inner');
  if (avThumb) {
    const av = _toDirectImgUrl(myProfileData?.avatar_url || '');
    const initial = (myProfileData?.full_name || myUserProfile?.full_name || currentUser?.email || '?')[0].toUpperCase();
    avThumb.innerHTML = av
      ? `<img src="${av}" style="width:100%;height:100%;object-fit:cover" onerror="this.outerHTML='<div class=\\'edit-avatar-thumb-init\\'>${initial}</div>'">`
      : `<div class="edit-avatar-thumb-init">${initial}</div>`;
  }

  /* ── عداد البيو ── */
  const bioEl      = document.getElementById('edit-bio');
  const bioCountEl = document.getElementById('edit-bio-count');
  if (bioEl && bioCountEl) bioCountEl.textContent = bioEl.value.length + ' / 200';

  document.getElementById('edit-error').style.display = 'none';
  modal.classList.add('open');
}

function closeEditModal() {
  const modal = document.getElementById('edit-profile-modal');
  if (modal) modal.classList.remove('open');
}

async function saveProfileDetails() {
  const name      = document.getElementById('edit-name').value.trim();
  const phone     = document.getElementById('edit-phone')?.value.trim()     || '';
  const city      = document.getElementById('edit-city')?.value             || '';
  const region    = document.getElementById('edit-region').value.trim();
  const bio       = document.getElementById('edit-bio')?.value.trim()       || '';
  const facebook  = document.getElementById('edit-facebook')?.value.trim()  || '';
  const instagram = document.getElementById('edit-instagram')?.value.trim() || '';
  const tiktok    = document.getElementById('edit-tiktok')?.value.trim()    || '';
  const newPwd    = document.getElementById('edit-password')?.value         || '';
  const cfmPwd    = document.getElementById('edit-password-confirm')?.value || '';
  const errorEl   = document.getElementById('edit-error');
  const saveBtn   = document.getElementById('edit-save-btn');

  const showErr = (msg) => {
    if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
  };

  if (!name) { showErr(t('profile.errors.nameRequired')); return; }
  if (newPwd) {
    if (newPwd.length < 8) { showErr(t('profile.errors.passwordTooShort')); return; }
    if (newPwd !== cfmPwd) { showErr(t('profile.errors.passwordMismatch')); return; }
  }

  if (errorEl) errorEl.style.display = 'none';

  /* ── حالة التحميل ── */
  if (saveBtn) {
    saveBtn.disabled = true;
    const lbl = document.getElementById('edit-save-label');
    const spn = document.getElementById('edit-save-spinner');
    if (lbl) lbl.textContent = t('profile.editModal.savingBtn');
    if (spn) spn.style.display = 'inline-block';
  }
  document.querySelectorAll('#edit-profile-modal input, #edit-profile-modal textarea, #edit-profile-modal select')
    .forEach(el => { el.disabled = true; });

  try {
    /* 1. حفظ في profiles (المصدر الرئيسي) */
    const { error: profilesErr } = await sbClient
      .from('profiles')
      .upsert(
        { id: currentUser.id, full_name: name, phone: phone||null, city: city||null },
        { onConflict: 'id' }
      );
    if (profilesErr) throw new Error(t('profile.errors.savingProfileErr', { msg: profilesErr.message }));

    /* 2. حفظ/تحديث organizer_profiles */
    const orgPayload = {
      user_id:       currentUser.id,
      full_name:     name,
      region:        region  || null,
      bio:           bio     || null,
      facebook_url:  facebook  || null,
      instagram_url: instagram || null,
      tiktok_url:    tiktok    || null,
    };

    const { error: orgErr } = await sbClient.from('organizer_profiles').upsert(orgPayload, { onConflict: 'user_id' });
    if (orgErr) throw new Error(t('profile.errors.savingOrgErr', { msg: orgErr.message }));

    /* 3. تغيير كلمة المرور إن وُجدت */
    if (newPwd) {
      const { error: pwdErr } = await sbClient.auth.updateUser({ password: newPwd });
      if (pwdErr) throw new Error(t('profile.errors.passwordChangeErr', { msg: pwdErr.message }));
    }

    /* 4. مزامنة الاسم الجديد في جميع بازارات المستخدم (طبقة أمان ثانية — الـ Trigger في DB هو الأول) */
    sbClient.rpc('sync_my_profile_to_bazaars').then(null, () => {});

    closeEditModal();
    showSuccessToast(t('profile.editModal.successToast'));
    await _loadMyProfile();
  } catch (err) {
    showErr(err.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      const lbl = document.getElementById('edit-save-label');
      const spn = document.getElementById('edit-save-spinner');
      if (lbl) lbl.textContent = t('profile.editModal.saveBtn');
      if (spn) spn.style.display = 'none';
    }
    document.querySelectorAll('#edit-profile-modal input, #edit-profile-modal textarea, #edit-profile-modal select')
      .forEach(el => { el.disabled = false; });
  }
}

function showSuccessToast(msg, isErr = false) {
  const toast = document.getElementById('edit-success-toast');
  if (!toast) return;
  const bg  = isErr ? '#dc2626' : '#059669';
  const shd = isErr ? 'rgba(220,38,38,.35)' : 'rgba(5,150,105,.35)';
  toast.textContent = msg;
  toast.style.cssText = `display:block;position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:${bg};color:#fff;font-weight:800;font-size:14px;font-family:var(--font-display);padding:13px 30px;border-radius:50px;z-index:9999;box-shadow:0 6px 28px ${shd};animation:toastIn .3s ease`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

/* ── مشاركة رابط البروفايل — Web Share API أو نسخ للحافظة ── */
function _shareOrganizerLink(url, shareText) {
  if (navigator.share) {
    navigator.share({ title: 'مكاني Spot', text: shareText, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => showSuccessToast(t('profile.share.linkCopied')))
      .catch(() => showSuccessToast(t('profile.share.linkFallback', { url })));
  }
}

/* مشاركة بروفايلي (ملفي الشخصي كمنظم) — الرابط العام دائمًا ?organizer=معرّفي */
function shareMyOrganizerProfile() {
  if (!currentUser) return;
  const url = `${window.location.origin}/bazaars/profile.html?organizer=${currentUser.id}`;
  _shareOrganizerLink(url, t('profile.share.myProfileText'));
}

/* مشاركة بروفايل منظم عام (من صفحة الزيارة) — الرابط الحالي أصلاً ?organizer=/?user= */
function sharePublicOrganizerProfile() {
  const url = window.location.href;
  const name = document.querySelector('.op-name')?.childNodes[0]?.textContent?.trim() || t('profile.share.defaultOrganizerName');
  _shareOrganizerLink(url, t('profile.share.publicProfileText', { name }));
}


/* ================================================================
   📸 رفع الصورة الشخصية
   ================================================================ */
function triggerAvatarUpload() {
  if (!currentUser) return;
  const fileInput = document.getElementById('avatar-file-input');
  if (fileInput) fileInput.click();
}

/* ================================================================
   🖼️ رفع صورة الغلاف (Cover/Banner)
   ================================================================ */
function triggerCoverUpload() {
  if (!currentUser) return;
  document.getElementById('cover-file-input')?.click();
}

async function uploadCoverImage(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const coverEl = document.getElementById('op-cover-img-el');
  const uploadBtn = document.getElementById('op-cover-upload-btn');
  if (uploadBtn) uploadBtn.textContent = t('profile.upload.coverUploading');

  try {
    const { data: { session } } = await sbClient.auth.getSession();
    const authToken = session?.access_token;
    if (!authToken) throw new Error(t('profile.upload.loginRequired'));

    const r2Path    = `covers/${currentUser.id}/cover-${Date.now()}.webp`;
    const publicUrl = await uploadSingleImageToR2(file, r2Path, authToken);

    /* معاينة فورية */
    if (coverEl) { coverEl.src = publicUrl; coverEl.style.display = 'block'; }
    if (uploadBtn) uploadBtn.textContent = t('profile.upload.coverChangeBtn');

    const { error: dbErr } = await sbClient.from('organizer_profiles').upsert({
      user_id:   currentUser.id,
      full_name: myProfileData?.full_name || myUserProfile?.full_name || currentUser.email.split('@')[0],
      cover_url: publicUrl,
    }, { onConflict: 'user_id' });
    if (dbErr) throw new Error(dbErr.message);

    /* 🪪 توحيد: حدّث المصدر الموحّد profiles.cover_url */
    sbClient.from('profiles').update({ cover_url: publicUrl }).eq('id', currentUser.id).then(null, () => {});

    showSuccessToast(t('profile.upload.coverSuccess'));
    await _loadMyProfile();
  } catch (err) {
    showSuccessToast(t('profile.upload.coverFailed', { msg: err.message }), true);
    if (uploadBtn) uploadBtn.textContent = t('profile.upload.coverChangeBtn');
    await _loadMyProfile();
  }
}

async function uploadAvatarImage(inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const inner = document.getElementById('avatar-container-inner');
  if (inner) inner.innerHTML = `<span style="font-size:12px;animation:spin 1s linear infinite">⏳</span>`;

  try {
    const { data: { session } } = await sbClient.auth.getSession();
    const authToken = session?.access_token;
    if (!authToken) throw new Error(t('profile.upload.loginRequired'));

    const r2Path    = `avatars/${currentUser.id}/avatar-${Date.now()}.webp`;
    const publicUrl = await uploadSingleImageToR2(file, r2Path, authToken);

    /* معاينة فورية — تحديث الأفاتار في الصفحة قبل إعادة التحميل */
    const avatarImgStyle = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
    if (inner) inner.innerHTML = `<img src="${publicUrl}" style="${avatarImgStyle}" alt="avatar">`;
    document.querySelectorAll('.op-avatar').forEach(el => {
      el.innerHTML = `<img src="${publicUrl}" style="${avatarImgStyle}" alt="avatar">`;
    });

    const { error: dbErr } = await sbClient.from('organizer_profiles').upsert({
      user_id:    currentUser.id,
      full_name:  myProfileData?.full_name || myUserProfile?.full_name || currentUser.email.split('@')[0],
      avatar_url: publicUrl,
    }, { onConflict: 'user_id' });
    if (dbErr) throw new Error(dbErr.message);

    /* 🪪 توحيد: حدّث المصدر الموحّد profiles.avatar_url ليظهر في كل المنصة */
    sbClient.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUser.id).then(null, () => {});

    /* مزامنة في بازارات المستخدم (الـ Trigger يفعلها تلقائياً، هذا احتياط) */
    sbClient.rpc('sync_my_profile_to_bazaars').then(null, () => {});

    showSuccessToast(t('profile.upload.avatarSuccess'));
    await _loadMyProfile();
  } catch (err) {
    showSuccessToast(t('profile.upload.avatarFailed', { msg: err.message }), true);
    await _loadMyProfile();
  }
}
