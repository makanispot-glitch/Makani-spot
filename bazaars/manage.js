/* ================================================================
   📁 bazaars/manage.js — إدارة بازارات المنظم بعد النشر
   ================================================================
   يغطي: M4 (قائمة البازارات) + M5 (تعديل المعلومات)
         M6 (الإلغاء) + M7 (تعديل عدد الأماكن)
         M8 (التأجيل) + M10 (إدارة خريطة الأماكن)
   ================================================================ */

/* SUPABASE_URL/SUPABASE_KEY أصبحت من shared/sb-config.js */
const R2_BASE = 'https://pub-df88163958eb4109a8f8f3b9c62a2d3e.r2.dev';

let sb                   = null;
let me                   = null;
let myBazaars            = [];
let activeBazaar         = null;
let activeSlots          = [];
let cancelSelectedReason = '';
let postponeSelectedReason = '';
let editCoverUrl         = null;
let editExtraUrls        = [];
let currentFilter        = 'all';
let activeSlotTab        = 'reserve';
let _logLoaded           = false;
let _bookingsLoaded      = false;
let _verificationLoaded  = false;
let _docsCurrentLinks    = [];

/* "اليوم" بتوقيت القاهرة — نفس المنطقة الزمنية التي يعتمدها الكرون في قاعدة البيانات
   (update_bazaar_statuses/auto_archive_expired_bazaars)، لتفادي أي تعارض قرب منتصف الليل
   بين تاريخ اليوم المحسوب هنا وحالة البازار الفعلية في القاعدة. راجع نفس الدالة في app.js */
function _cairoTodayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

/* ── status display — دالة بدل const ثابت، لازم تُستدعى وقت الرسم بعد جاهزية i18next ── */
function STATUS_LABEL_OF(status) {
  return t('manage.statusLabels.' + status, { defaultValue: status });
}

const MAX_POSTPONES      = 2;
const EDITABLE_STATUSES  = ['published', 'active', 'upcoming', 'postponed', 'pending_review', 'live'];
const CANCEL_ALLOWED     = ['published', 'active', 'upcoming', 'postponed', 'pending_review', 'live'];
const POSTPONE_ALLOWED   = ['published', 'active', 'upcoming'];
const SLOTS_EDIT_ALLOWED = ['published', 'active', 'upcoming', 'postponed', 'live'];
const DOCS_ALLOWED       = ['live', 'completed'];
const DOCS_NOT_HAPPENED  = ['cancelled', 'postponed'];
const MAX_DOCS_LINKS     = 15;

const KNOWN_DOMAINS = ['facebook.com', 'fb.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'snapchat.com', 'linkedin.com'];

/* دالة بدل const ثابت — لازم تُستدعى وقت الرسم بعد جاهزية i18next */
function CHANGE_LABEL_OF(changeType) {
  return t('manage.log.changeTypes.' + changeType, { defaultValue: changeType });
}

/* ════════════════════════════════════════════════════════
   LOCK WINDOW — 24h before event
════════════════════════════════════════════════════════ */
function _isEditLocked(b) {
  if (!b.start_date) return false;
  const startMs = new Date(b.start_date + 'T00:00:00').getTime();
  const diffH   = (startMs - Date.now()) / (1000 * 60 * 60);
  // Locked from 24h before start (including events already underway)
  return diffH <= 24;
}

function _applyLockWindow(b) {
  const locked = _isEditLocked(b);

  // Info tab banner + field locking
  const bannerInfo = document.getElementById('lock-banner-info');
  if (bannerInfo) bannerInfo.classList.toggle('show', locked);

  const LOCKED_FIELDS_INFO = ['e-title','e-start-date','e-end-date','e-location','e-location-url','e-working-hours'];
  LOCKED_FIELDS_INFO.forEach(id => {
    const el  = document.getElementById(id);
    const fg  = el?.closest('.mn-fg');
    if (!el || !fg) return;
    if (locked) {
      el.setAttribute('readonly', 'true');
      fg.classList.add('mn-field-locked');
    } else {
      el.removeAttribute('readonly');
      fg.classList.remove('mn-field-locked');
    }
  });

  // Edit save button label
  const editBtn = document.getElementById('edit-save-btn');
  if (editBtn && locked) {
    editBtn.title = t('manage.info.saveBtnLockedTitle');
  }

  // Slots tab banner + slot count locking
  const bannerSlots = document.getElementById('lock-banner-slots');
  if (bannerSlots) bannerSlots.classList.toggle('show', locked);

  const scBtn = document.getElementById('sc-save-btn');
  const scInp = document.getElementById('sc-new-total');
  if (scBtn) scBtn.disabled = locked;
  if (scInp) {
    if (locked) {
      scInp.setAttribute('disabled', 'true');
      scInp.style.cursor = 'not-allowed';
    } else {
      scInp.removeAttribute('disabled');
      scInp.style.cursor = '';
    }
  }

  // Premium tab locking (hide premium toggle when locked)
  const premiumTab = document.getElementById('smt-premium');
  if (premiumTab) premiumTab.style.opacity = locked ? '.4' : '';
  const premiumPanel = document.getElementById('smt-premium-panel');
  if (premiumPanel) premiumPanel.style.pointerEvents = locked ? 'none' : '';
}

/* ════════════════════════════════════════════════════════
   ACTIVITY FEED
════════════════════════════════════════════════════════ */
const FEED_ICONS = {
  edit_info:'✏️', info_updated:'✏️', edit_slots_count:'🔢', slots_count_updated:'🔢',
  booking_paused:'⏸️', booking_resumed:'▶️', postponed:'📅', postpone:'📅',
  cancelled:'🚫', cancel:'🚫', slot_reserved:'🔒', slot_unreserved:'🔓',
  slot_premium_set:'⭐', admin_delete:'🗑️', auto_expire_response:'⏰',
  admin_reactivate:'♻️', admin_force_close:'🔒', admin_restore_snapshot:'🕐',
  admin_cancel_postponement:'⏪', created:'🎉',
};

function _relTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return t('manage.activityFeed.timeAgo.now');
  if (m < 60) return t('manage.activityFeed.timeAgo.minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('manage.activityFeed.timeAgo.hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t('manage.activityFeed.timeAgo.yesterday');
  if (d < 7)  return t('manage.activityFeed.timeAgo.daysAgo', { count: d });
  return new Date(iso).toLocaleDateString(_mnLocale(), { day:'numeric', month:'short' });
}

async function loadActivityFeed(bazaarId) {
  const listEl = document.getElementById('activity-feed-list');
  if (!listEl) return;

  try {
    const [logRes, bkRes] = await Promise.all([
      sb.from('bazaar_change_log')
        .select('change_type,change_data,note,created_at,source')
        .eq('bazaar_id', bazaarId)
        .order('created_at', { ascending: false })
        .limit(6),
      sb.from('bazaar_bookings')
        .select('id,status,created_at,amount')
        .eq('bazaar_id', bazaarId)
        .in('status', ['confirmed','pending','pending_after_postponement'])
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    // Build unified event list
    const events = [];

    (logRes.data || []).forEach(e => {
      const dotClass = e.source === 'admin_panel' ? 'admin' : e.source === 'automatic_system' ? 'system' : 'log';
      events.push({
        date: e.created_at,
        ico:  FEED_ICONS[e.change_type] || '📋',
        text: CHANGE_LABEL_OF(e.change_type),
        sub:  e.note || '',
        dot:  dotClass,
        srcLabel: e.source === 'admin_panel' ? t('manage.log.sourceAdmin') : e.source === 'automatic_system' ? t('manage.log.sourceAutomatic') : '',
      });
    });

    // Group bookings
    const bks = bkRes.data || [];
    if (bks.length > 0) {
      const newest = bks[0];
      events.push({
        date: newest.created_at,
        ico:  '🎫',
        text: bks.length === 1
          ? (newest.amount ? t('manage.activityFeed.newBookingWithAmount', { amount: _num(newest.amount) }) : t('manage.activityFeed.newBooking'))
          : t('manage.activityFeed.newBookingsCount', { count: bks.length }),
        sub:  '',
        dot:  'booking',
        srcLabel: '',
        isNew: true,
      });
    }

    // Sort by date descending, take top 6
    events.sort((a, z) => new Date(z.date) - new Date(a.date));
    const top = events.slice(0, 6);

    if (!top.length) {
      listEl.innerHTML = `<div style="font-size:12px;color:var(--ink3);padding:8px 0;text-align:center">${t('manage.activityFeed.noActivity')}</div>`;
      return;
    }

    listEl.innerHTML = `<div class="mn-feed-list">${top.map(ev => `
      <div class="mn-feed-item">
        <div class="mn-feed-dot ${ev.dot}">${ev.ico}</div>
        <div class="mn-feed-body">
          <div class="mn-feed-text">
            ${ev.isNew ? `<span class="mn-feed-new">${t('manage.activityFeed.newBadge')}</span>` : ''}
            ${_esc(ev.text)}${ev.srcLabel ? `<span style="font-size:10px;color:var(--ink3)">${ev.srcLabel}</span>` : ''}
          </div>
          ${ev.sub ? `<div class="mn-feed-sub">${_esc(ev.sub)}</div>` : ''}
          <div class="mn-feed-time">${_relTime(ev.date)}</div>
        </div>
      </div>`).join('')}
    </div>`;
  } catch {
    listEl.innerHTML = `<div style="font-size:12px;color:var(--ink3);padding:8px 0">${t('manage.activityFeed.loadError')}</div>`;
  }
}

/* ════════════════════════════════════════════════════════
   🌐 دعم اللغتين — إعادة رسم المحتوى الديناميكي عند تبديل اللغة
   مسجَّل عند تحميل الملف (top-level)، قبل أي نداء t() — راجع feedback-i18n-gotchas نقطة 6
════════════════════════════════════════════════════════ */
let _activeGuard = null; // { ico, titleKey, descKey, actionsBuilder } — لإعادة رسم شاشة الحراسة عند تبديل اللغة

document.addEventListener('makani:locale-changed', () => {
  resolveBackNav();
  if (!activeBazaar) {
    const heroTitleEl = document.getElementById('hero-title');
    const heroSubEl   = document.getElementById('hero-sub');
    const navTitleEl  = document.getElementById('nav-title');
    if (heroTitleEl) heroTitleEl.innerHTML  = t('manage.heroTitle');
    if (heroSubEl)   heroSubEl.textContent  = t('manage.heroSub');
    if (navTitleEl)  navTitleEl.textContent = t('manage.navTitleDefault');
  }
  if (_activeGuard) { _activeGuard.rebuild(); return; }
  if (myBazaars.length) { renderCards(); renderOverview(); }
  if (activeBazaar) {
    _updateDetailHeader(activeBazaar);
    _populateInfoTab(activeBazaar);
    _populateSlotsCount(activeBazaar);
    if (activeSlots.length) switchSlotTab(activeSlotTab);
    _populateStatusTab(activeBazaar);
    _populateVerificationTab(activeBazaar);
    loadActivityFeed(activeBazaar.id);
    if (_logLoaded) loadBazaarLog();
    if (_bookingsLoaded) loadBazaarBookings();
  }
});

/* ════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  /* رجوع ذكي حسب المصدر — قبل الحراسة حتى يعمل على شاشة الحراسة أيضاً */
  resolveBackNav();

  const { data: { session } } = await sb.auth.getSession();
  me = session?.user || null;

  if (!me) {
    _activeGuard = { rebuild: () => showGuard('🔒', t('manage.guard.loginRequiredTitle'),
      t('manage.guard.loginRequiredDesc'),
      `<a href="/?p=login&redirect=/bazaars/manage.html" class="mn-btn primary" style="display:inline-flex;text-decoration:none;padding:10px 24px;font-size:14px;border-radius:50px">${t('manage.guard.loginBtn')}</a>`
    ) };
    _activeGuard.rebuild();
    return;
  }

  /* إزالة زر تغيير اللغة القديم إذا كان مسجلاً */
  const langBtn = document.getElementById('langSwitchBtn');
  if (langBtn && me) {
    langBtn.remove();
  }

  /* جرس الإشعارات الموحّد — نفس موقعه في كل صفحات البازارات */
  try { GN.init(sb, me.id); GN.mount(document.querySelector('.bz-nav-right')); } catch (_) {}

  const { data: prof } = await sb
    .from('organizer_profiles')
    .select('is_verified')
    .eq('user_id', me.id)
    .single();

  if (!prof?.is_verified) {
    _activeGuard = { rebuild: () => showGuard('🎪', t('manage.guard.notOrganizerTitle'),
      t('manage.guard.notOrganizerDesc'),
      `<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
         <a href="/bazaars/verification.html" class="mn-btn primary" style="display:inline-flex;text-decoration:none;padding:10px 24px;font-size:14px;border-radius:50px">${t('manage.guard.applyBtn')}</a>
         <a href="/bazaars/" class="mn-btn" style="display:inline-flex;text-decoration:none;padding:10px 24px;font-size:14px;border-radius:50px">${t('manage.guard.backBtn')}</a>
       </div>`
    ) };
    _activeGuard.rebuild();
    return;
  }

  _buildExtraGrid();
  await loadMyBazaars();

  /* deep-link: /manage.html?id=xxx يفتح البازار مباشرة */
  const _deepId = new URLSearchParams(window.location.search).get('id');
  if (_deepId) {
    const _found = myBazaars.find(x => x.id === _deepId);
    if (_found) openBazaarDetail(_deepId);
  }
});

/* ══════════════════════════════════════════
   رجوع ذكي حسب المصدر (Navigation State)
   يُحسَب هدف زر الرجوع من document.referrer (نفس الأصل) عبر قائمة بيضاء،
   مع fallback ثابت إلى قائمة البازارات — بلا اعتماد على history.back()
   الذي يعيد إنتاج مشكلة المرور بصفحات وسيطة.
   ══════════════════════════════════════════ */
function resolveBackNav() {
  const el = document.getElementById('bz-nav-back');
  if (!el) return;

  const MAP = {
    '/bazaars/':             { href: '/bazaars/',              label: t('manage.backToBazaars') },
    '/bazaars/index.html':   { href: '/bazaars/',              label: t('manage.backToBazaars') },
    '/bazaars/profile.html': { href: '/bazaars/profile.html', label: t('manage.backToProfile') },
  };
  const FALLBACK = { href: '/bazaars/', label: t('manage.backToBazaars') };

  let target = FALLBACK;
  try {
    const ref = document.referrer;
    if (ref) {
      const u = new URL(ref);
      /* نفس الأصل فقط، ونتجاهل الرجوع لصفحة manage نفسها (reload / deep-link ?id=) */
      if (u.origin === location.origin && !u.pathname.startsWith('/bazaars/manage')) {
        target = MAP[u.pathname] || FALLBACK;
      }
    }
  } catch (_) {}

  el.setAttribute('href', target.href);
  el.textContent = target.label;
}

/* ════════════════════════════════════════════════════════
   GUARD
════════════════════════════════════════════════════════ */
function showGuard(ico, title, desc, actionsHtml) {
  document.getElementById('mn-loading').style.display  = 'none';
  document.getElementById('view-list').style.display   = 'none';
  document.getElementById('view-detail').style.display = 'none';
  const g = document.getElementById('mn-guard');
  g.style.display = 'block';
  document.getElementById('mn-guard-ico').textContent   = ico;
  document.getElementById('mn-guard-title').textContent = title;
  document.getElementById('mn-guard-desc').textContent  = desc;
  document.getElementById('mn-guard-actions').innerHTML = actionsHtml || '';
}

/* ════════════════════════════════════════════════════════
   LOAD BAZAARS (M4)
════════════════════════════════════════════════════════ */
async function loadMyBazaars() {
  const { data, error } = await sb
    .from('bazaars')
    .select([
      'id',
      'title:name',
      'description',
      'venue_name',
      'location',
      'location_url:maps_link',
      'start_date:date_start',
      'end_date:date_end',
      'total_slots',
      'available_slots',
      'slot_price:price_per_slot',
      'premium_slots',
      'premium_price',
      'image',
      'extra_images',
      'status',
      'working_hours',
      'is_archived',
      'is_deleted',
      'deleted_at',
      'cancelled_at',
      'cancellation_reason',
      'postponed_count',
      'booking_paused',
      'booking_pause_reason',
      'event_links',
      'links_added_at',
      'links_last_updated_at',
      'links_deleted_at',
      'created_at',
      'updated_at',
      'included_amenities',
      'chair_count',
      'other_amenities_note',
      'ad_budget_tier',
      'will_have_photography',
      'will_have_social_coverage',
      'will_have_paid_ads',
    ].join(','))
    .eq('organizer_id', me.id)
    .eq('is_archived', false)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  document.getElementById('mn-loading').style.display = 'none';

  if (error) {
    document.getElementById('view-list').style.display = 'block';
    document.getElementById('mn-cards').innerHTML = `
      <div class="mn-empty" style="border-color:#fca5a5">
        <div class="mn-empty-ico">⚠️</div>
        <div class="mn-empty-title" style="color:#dc2626">${t('manage.empty.loadErrorTitle')}</div>
        <div class="mn-empty-desc">${t('manage.empty.loadErrorDesc')}</div>
        <button class="mn-btn primary" onclick="location.reload()" style="margin-top:12px">${t('manage.empty.reloadBtn')}</button>
      </div>`;
    return;
  }

  myBazaars = (data || []).map(b => ({
    ...b,
    images: [b.image, ...(b.extra_images || [])].filter(Boolean),
  }));

  document.getElementById('view-list').style.display = 'block';
  renderCards();
  renderOverview();
}

/* ════════════════════════════════════════════════════════
   RENDER (M4)
════════════════════════════════════════════════════════ */
function applyFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.mn-filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderCards();
}

function renderCards() {
  const list = currentFilter === 'all'
    ? myBazaars
    : myBazaars.filter(b => b.status === currentFilter);

  const container = document.getElementById('mn-cards');
  const empty     = document.getElementById('mn-empty');

  if (list.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = list.map(b => _cardHTML(b)).join('');
}

function _cardHTML(b) {
  const cover  = _coverUrl(b.images);
  const imgEl  = cover
    ? `<img src="${cover}" alt="${_esc(b.title)}" loading="lazy">`
    : '🎪';
  const statusClass = b.status || 'pending_review';
  const statusLabel = STATUS_LABEL_OF(b.status);

  const bookedCount = (b.total_slots || 0) - (b.available_slots || 0);
  const dateStr     = _formatDateRange(b.start_date, b.end_date);

  return `
<div class="mn-card" id="mn-card-${b.id}">
  <div class="mn-card-top">
    <div class="mn-card-img">${imgEl}</div>
    <div class="mn-card-body">
      <div class="mn-card-title">${_esc(b.title)}</div>
      <div class="mn-card-meta">
        ${b.location ? `<span>📍 ${_esc(b.location)}</span>` : ''}
        ${dateStr ? `<span>📅 ${dateStr}</span>` : ''}
        <span>${t('manage.card.bookedOf', { booked: bookedCount, total: b.total_slots || 0 })}</span>
        ${b.postponed_count > 0 ? `<span style="color:var(--orange)">${t('manage.card.postponedTimes', { count: b.postponed_count })}</span>` : ''}
      </div>
      <div class="mn-card-badges">
        <span class="mn-status ${statusClass}">${statusLabel}</span>
        ${(b.status === 'completed' || b.status === 'live') ? ((b.event_links && b.event_links.length > 0) ? `<span class="mn-status documented" title="${t('manage.card.documentedTooltip')}">${t('manage.card.documented')}</span>` : `<span class="mn-status" style="background:#fefce8;color:#92400e;border-color:#fde047">${t('manage.card.noLinks')}</span>`) : ''}
        ${b.premium_slots > 0 ? `<span class="mn-status" style="background:#fefce8;color:#a16207;border-color:#fde047">${t('manage.card.premiumCount', { count: b.premium_slots })}</span>` : ''}
        ${b.slot_price > 0 ? `<span class="mn-status" style="background:var(--surface2);color:var(--ink2);border-color:var(--border)">${_num(b.slot_price)} ${t('card.currency')}</span>` : ''}
      </div>
      ${b.cancellation_reason ? `<div style="font-size:11px;color:#dc2626;margin-top:6px">${t('manage.card.cancellationReason', { reason: t('manage.cancelReasons.' + b.cancellation_reason, { defaultValue: _esc(b.cancellation_reason) }) })}</div>` : ''}
    </div>
  </div>
  <div class="mn-card-actions">
    <a class="mn-btn" href="/bazaars/?id=${b.id}" target="_blank">${t('manage.card.viewBtn')}</a>
    <button class="mn-btn primary" onclick="openBazaarDetail('${b.id}')">${t('manage.card.manageBtn')}</button>
  </div>
  ${(b.status === 'completed' && !(b.event_links && b.event_links.length > 0)) ? `
  <div class="mn-card-docs-cta" onclick="event.stopPropagation();openBazaarDetail('${b.id}');setTimeout(()=>switchTab('docs'),350)">
    ${t('manage.card.docsCta')}
  </div>` : ''}
</div>`;
}

/* ════════════════════════════════════════════════════════
   OVERVIEW / COMMAND CENTER (لوحة القيادة — تحسين تدريجي)
   يُدرَج أعلى قائمة البازارات: مركز إجراءات (تنبيهات قابلة للتنفيذ)
   + بطاقة البازار النشط بمؤشرات + أعداد على شارات الفلاتر.
   يعتمد كلياً على myBazaars المحمّلة، عدا استعلام خفيف واحد
   لعدّ الحجوزات الجديدة لبازار التركيز فقط.
════════════════════════════════════════════════════════ */
let _newBk = { today: 0, week: 0, loaded: false };

function renderOverview() {
  const host = document.getElementById('mn-overview');
  if (!host) return;

  if (!myBazaars.length) { host.innerHTML = ''; return; }

  const focus = _pickFocusBazaar(myBazaars);
  host.innerHTML = _renderActionCenter() + (focus ? _renderSpotlight(focus) : '');
  _renderFilterCounts();

  if (focus) {
    _newBk = { today: 0, week: 0, loaded: false };
    _loadFocusNewBookings(focus.id);
  }
}

/* اختيار «بازار التركيز»: النشط الآن ← الأقرب بدءاً (قادم) ← مؤجّل ← الأحدث */
function _pickFocusBazaar(list) {
  const byStart = (a, b) => (a.start_date || '').localeCompare(b.start_date || '');
  return list.find(b => b.status === 'live')
    || list.filter(b => ['upcoming', 'published', 'active'].includes(b.status)).sort(byStart)[0]
    || list.filter(b => b.status === 'postponed').sort(byStart)[0]
    || list[0]
    || null;
}

/* مركز الإجراءات — v1: روابط التوثيق الناقصة (live/completed فقط) */
function _renderActionCenter() {
  const need = myBazaars.filter(b =>
    ['live', 'completed'].includes(b.status) &&
    !(b.event_links && b.event_links.length));
  if (!need.length) return '';

  const shown = need.slice(0, 3);
  const cards = shown.map(b => `
    <div class="mn-alert">
      <div class="mn-alert-ico">🔗</div>
      <div class="mn-alert-body">
        <div class="mn-alert-title">${t('manage.overview.actionNeedsLinksTitle', { name: _esc(b.title) })}</div>
        <div class="mn-alert-desc">${t('manage.overview.actionNeedsLinksDesc')}</div>
      </div>
      <button class="mn-alert-cta" onclick="openBazaarDetail('${b.id}');setTimeout(()=>switchTab('docs'),350)">${t('manage.overview.actionAddLinksBtn')}</button>
    </div>`).join('');
  const more = need.length > 3
    ? `<div class="mn-alert-more">${t('manage.overview.actionMoreNeedLinks', { count: need.length - 3 })}</div>`
    : '';
  return `<div class="mn-action-center">${cards}${more}</div>`;
}

/* بطاقة البازار النشط — «ماذا يحدث الآن؟» */
function _renderSpotlight(b) {
  const total   = b.total_slots || 0;
  const avail   = b.available_slots || 0;
  const booked  = Math.max(0, total - avail);
  const occ     = total > 0 ? Math.round(booked / total * 100) : 0;
  const dateStr = _formatDateRange(b.start_date, b.end_date);
  const eyebrow = b.status === 'live'
    ? t('manage.overview.spotlightLiveEyebrow')
    : (['upcoming', 'published', 'active'].includes(b.status) ? t('manage.overview.spotlightUpcomingEyebrow') : t('manage.overview.spotlightLastEyebrow'));

  return `
  <div class="mn-spotlight">
    <div class="mn-spot-eyebrow">${eyebrow}</div>
    <div class="mn-spot-name">${_esc(b.title)}</div>
    <div class="mn-spot-meta">
      ${dateStr ? `<span>📅 ${dateStr}</span>` : ''}
      ${b.location ? `<span>📍 ${_esc(b.location)}</span>` : ''}
    </div>
    <div class="mn-kpis">
      <div class="mn-kpi">
        <div class="mn-kpi-lbl">${t('manage.overview.kpiBooked')}</div>
        <div class="mn-kpi-val">${booked}<small>/${total}</small></div>
      </div>
      <div class="mn-kpi">
        <div class="mn-kpi-lbl">${t('manage.overview.kpiRemaining')}</div>
        <div class="mn-kpi-val">${avail}<small>${t('manage.overview.kpiRemainingUnit')}</small></div>
      </div>
      <div class="mn-kpi">
        <div class="mn-kpi-lbl">${t('manage.overview.kpiOccupancy')}</div>
        <div class="mn-kpi-val">${occ}<small>%</small></div>
        <div class="mn-occ-bar"><div class="mn-occ-fill" style="width:${occ}%"></div></div>
      </div>
      <div class="mn-kpi">
        <div class="mn-kpi-lbl">
          <span>${t('manage.overview.kpiNew')}</span>
          <span class="mn-newbk-toggle">
            <button id="nbk-today" class="active" onclick="toggleNewBookings('today')">${t('manage.overview.todayBtn')}</button>
            <button id="nbk-week" onclick="toggleNewBookings('week')">${t('manage.overview.weekBtn')}</button>
          </span>
        </div>
        <div class="mn-kpi-val" id="nbk-val">…</div>
      </div>
    </div>
    <button class="mn-spot-cta" onclick="openBazaarDetail('${b.id}')">${t('manage.overview.manageBtn')}</button>
  </div>`;
}

/* استعلام خفيف واحد: حجوزات آخر ٧ أيام لبازار التركيز (RLS يسمح للمنظم) */
async function _loadFocusNewBookings(focusId) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data } = await sb
      .from('bazaar_bookings')
      .select('created_at,status')
      .eq('bazaar_id', focusId)
      .gte('created_at', weekAgo)
      .in('status', ['pending', 'confirmed', 'pending_after_postponement']);
    const today = _cairoTodayStr();
    const rows  = data || [];
    _newBk = {
      today:  rows.filter(r => _cairoDateOf(r.created_at) === today).length,
      week:   rows.length,
      loaded: true,
    };
  } catch (_) {
    _newBk = { today: 0, week: 0, loaded: true };
  }
  const mode = document.getElementById('nbk-week')?.classList.contains('active') ? 'week' : 'today';
  _applyNewBk(mode);
}

function _cairoDateOf(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ts));
}

function _applyNewBk(mode) {
  const el = document.getElementById('nbk-val');
  if (!el) return;
  el.textContent = _newBk.loaded ? String(mode === 'week' ? _newBk.week : _newBk.today) : '…';
}

function toggleNewBookings(mode) {
  document.getElementById('nbk-today')?.classList.toggle('active', mode === 'today');
  document.getElementById('nbk-week')?.classList.toggle('active', mode === 'week');
  _applyNewBk(mode);
}

/* أعداد حيّة على شارات الفلاتر — نظرة محفظة بلا مكوّن جديد */
function _renderFilterCounts() {
  const counts = { all: myBazaars.length };
  myBazaars.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
  document.querySelectorAll('.mn-filter-btn[data-status]').forEach(btn => {
    const st   = btn.getAttribute('data-status');
    const span = btn.querySelector('.mn-filter-count');
    if (!span) return;
    const n = counts[st] || 0;
    span.textContent = (st === 'all' || n > 0) ? String(n) : '';
  });
}

/* ════════════════════════════════════════════════════════
   VIEW NAVIGATION
════════════════════════════════════════════════════════ */
async function openBazaarDetail(id) {
  const b = myBazaars.find(x => x.id === id);
  if (!b) return;

  activeBazaar         = b;
  _logLoaded           = false;
  _bookingsLoaded      = false;
  _verificationLoaded  = false;

  /* populate all eager tabs */
  _populateInfoTab(b);
  _populateSlotsCount(b);
  _populateStatusTab(b);
  _populateVerificationTab(b);

  /* docs tab badge */
  const docsBadge = document.getElementById('docs-badge');
  if (docsBadge) docsBadge.textContent = (b.event_links && b.event_links.length > 0) ? b.event_links.length : '';

  /* update header + hero */
  _updateDetailHeader(b);

  /* switch views */
  document.getElementById('view-list').style.display   = 'none';
  document.getElementById('view-detail').style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });

  /* default to info tab */
  switchTab('info');

  /* load activity feed + slot map in background */
  loadActivityFeed(id);
  _loadSlots(id);
}

function backToList() {
  activeBazaar    = null;
  activeSlots     = [];
  _logLoaded      = false;
  _bookingsLoaded = false;

  document.getElementById('view-detail').style.display = 'none';
  document.getElementById('view-list').style.display   = 'block';

  /* restore hero */
  document.getElementById('hero-title').innerHTML = t('manage.heroTitle');
  document.getElementById('hero-sub').textContent  = t('manage.heroSub');
  document.getElementById('nav-title').textContent = t('manage.navTitleDefault');

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(tab) {
  /* tab buttons */
  document.querySelectorAll('.mn-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-btn-${tab}`)?.classList.add('active');

  /* panels */
  document.querySelectorAll('.mn-tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tab}`)?.classList.add('active');

  /* lazy load */
  if (tab === 'log' && !_logLoaded) {
    _logLoaded = true;
    loadBazaarLog();
  }
  if (tab === 'bookings' && !_bookingsLoaded) {
    _bookingsLoaded = true;
    loadBazaarBookings();
  }
}

function _updateDetailHeader(b) {
  document.getElementById('detail-name').textContent = b.title || '—';

  const badge = document.getElementById('detail-status-badge');
  badge.textContent = STATUS_LABEL_OF(b.status);
  badge.className   = 'mn-status ' + (b.status || 'pending_review');

  document.getElementById('detail-view-link').href = `/bazaars/?id=${b.id}`;

  /* hero */
  document.getElementById('hero-title').innerHTML  = t('manage.heroTitleWithName', { name: _esc(b.title || t('manage.heroDefaultName')) });
  document.getElementById('hero-sub').textContent  =
    [_formatDateRange(b.start_date, b.end_date), b.location].filter(Boolean).join(' | ');
  document.getElementById('nav-title').textContent = b.title ? t('manage.navTitleWithName', { name: b.title }) : t('manage.navTitleFallback');
}

/* خريطة مفاتيح التجهيزات (id الشيك بوكس ← التسمية العربية المخزَّنة) — نفس الترتيب المستخدم في organize.js */
const MN_AMENITY_MAP = [
  ['e-amen-table',        'ترابيزة'],
  ['e-amen-chair',        'كرسي'],
  ['e-amen-pergola',      'برجولة'],
  ['e-amen-canopy',       'مظلة'],
  ['e-amen-electricity',  'كهرباء'],
  ['e-amen-lighting',     'إنارة'],
  ['e-amen-wifi',         'واي فاي'],
  ['e-amen-water',        'مصدر مياه'],
  ['e-amen-other_services','خدمات أخرى'],
];

function mnToggleChairCount() {
  const checked = document.getElementById('e-amen-chair')?.checked;
  const row     = document.getElementById('e-chair-count-row');
  if (row) row.style.display = checked ? '' : 'none';
  if (!checked) document.getElementById('e-chair-count').value = '';
}

/* ════════════════════════════════════════════════════════
   TAB 1: INFO (M5 — تعديل المعلومات)
════════════════════════════════════════════════════════ */
function _populateInfoTab(b) {
  _val('e-title',         b.title || '');
  _val('e-location',      b.venue_name || b.location || '');
  _val('e-location-url',  b.location_url || '');
  _val('e-start-date',    b.start_date || '');
  _val('e-end-date',      b.end_date || '');
  _val('e-working-hours', b.working_hours || '');
  _val('e-description',   b.description || '');

  /* ما الذي يشمله الحجز */
  const includedAmenities = Array.isArray(b.included_amenities) ? b.included_amenities : [];
  MN_AMENITY_MAP.forEach(([id, label]) => {
    const el = document.getElementById(id);
    if (el) el.checked = includedAmenities.includes(label);
  });
  _val('e-chair-count',      b.chair_count || '');
  _val('e-amen-other-note',  b.other_amenities_note || '');
  mnToggleChairCount();

  /* الدعاية والتغطية الإعلامية */
  _val('e-ad-budget', b.ad_budget_tier || '');
  const photoEl = document.getElementById('e-ad-photography');
  if (photoEl) photoEl.checked = !!b.will_have_photography;
  const socialEl = document.getElementById('e-ad-social');
  if (socialEl) socialEl.checked = !!b.will_have_social_coverage;
  const paidAdsEl = document.getElementById('e-ad-paidads');
  if (paidAdsEl) paidAdsEl.checked = !!b.will_have_paid_ads;

  /* cover preview */
  editCoverUrl = null;
  const coverEl = document.getElementById('e-cover-box');
  const prevEl  = document.getElementById('e-cover-preview');
  const cover   = _coverUrl(b.images);
  if (cover) {
    prevEl.src = cover;
    coverEl.classList.add('has-img');
    document.getElementById('e-cover-placeholder').style.display = 'none';
  } else {
    prevEl.src = '';
    coverEl.classList.remove('has-img');
    document.getElementById('e-cover-placeholder').style.display = 'flex';
  }
  document.getElementById('e-cover-status').textContent = '';

  /* extra images */
  const extras = Array.isArray(b.images) ? b.images.slice(1, 5) : [];
  editExtraUrls = [...extras, null, null, null, null].slice(0, 4);
  _renderExtraGrid();

  _hide('edit-msg');

  /* completed/cancelled = full read-only (نفس القفل الذي تطبّقه بقية التبويبات على هذه الحالات) */
  const isCompleted = b.status === 'completed';
  const isCancelled = b.status === 'cancelled';
  const isLocked    = isCompleted || isCancelled;
  const saveBtn = document.getElementById('edit-save-btn');
  if (saveBtn) {
    saveBtn.style.display = isLocked ? 'none' : '';
  }

  const completedNotice = document.getElementById('edit-completed-notice');
  if (completedNotice) {
    completedNotice.style.display = isLocked ? 'block' : 'none';
    const noticeText = completedNotice.querySelector('.mn-warn-text');
    if (noticeText) {
      noticeText.innerHTML = isCancelled
        ? t('manage.info.completedNoticeCancelled')
        : t('manage.info.completedNoticeEnded');
    }
  }

  if (isLocked) {
    ['e-title','e-start-date','e-end-date','e-location','e-location-url','e-working-hours','e-description'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.setAttribute('readonly', 'true');
    });
    if (coverEl) coverEl.style.pointerEvents = 'none';
    return;
  } else {
    if (coverEl) coverEl.style.pointerEvents = '';
  }

  _setBtnState('edit-save-btn', false, t('manage.info.saveBtn'));
  _applyLockWindow(b);
}

function _buildExtraGrid() {
  const grid = document.getElementById('e-extras-grid');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: 4 }, (_, i) => `
    <div class="mn-img-slot" id="e-extra-${i}-slot" onclick="document.getElementById('e-extra-${i}-file').click()">
      <img id="e-extra-${i}-img" alt="" style="display:none">
      <span id="e-extra-${i}-ph">+</span>
      <button class="mn-img-remove" id="e-extra-${i}-rm" onclick="removeExtraEdit(${i},event)" style="display:none">×</button>
      <input type="file" id="e-extra-${i}-file" accept="image/*" style="display:none" onchange="handleEditExtra(${i},this)">
    </div>`).join('');
}

function _renderExtraGrid() {
  for (let i = 0; i < 4; i++) {
    const url  = editExtraUrls[i];
    const slot = document.getElementById(`e-extra-${i}-slot`);
    const img  = document.getElementById(`e-extra-${i}-img`);
    const ph   = document.getElementById(`e-extra-${i}-ph`);
    const rm   = document.getElementById(`e-extra-${i}-rm`);
    if (!slot) continue;
    if (url) {
      img.src = url; img.style.display = 'block';
      ph.style.display = 'none'; rm.style.display = 'flex';
      slot.classList.add('has-img');
    } else {
      img.src = ''; img.style.display = 'none';
      ph.style.display = 'block'; rm.style.display = 'none';
      slot.classList.remove('has-img');
    }
  }
}

function removeExtraEdit(i, e) {
  e.stopPropagation();
  editExtraUrls[i] = null;
  _renderExtraGrid();
}

async function handleEditCover(input) {
  if (!input.files[0]) return;
  const file  = input.files[0];
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const box   = document.getElementById('e-cover-box');
  const stat  = document.getElementById('e-cover-status');
  box.classList.add('uploading');
  stat.textContent = t('manage.info.uploading');
  try {
    const path = `bazaars/${me.id}/cover_${Date.now()}.webp`;
    const url  = await uploadSingleImageToR2(file, path, token);
    editCoverUrl = url;
    const prevEl = document.getElementById('e-cover-preview');
    prevEl.src = url;
    box.classList.remove('uploading');
    box.classList.add('has-img');
    document.getElementById('e-cover-placeholder').style.display = 'none';
    stat.textContent = t('manage.info.uploadSuccess');
  } catch {
    box.classList.remove('uploading');
    stat.textContent = t('manage.info.uploadFailed');
  }
}

async function handleEditExtra(i, input) {
  if (!input.files[0]) return;
  const file  = input.files[0];
  const token = (await sb.auth.getSession()).data.session?.access_token;
  const slot  = document.getElementById(`e-extra-${i}-slot`);
  slot.classList.add('uploading');
  try {
    const path = `bazaars/${me.id}/extra_${i}_${Date.now()}.webp`;
    const url  = await uploadSingleImageToR2(file, path, token);
    editExtraUrls[i] = url;
    slot.classList.remove('uploading');
    _renderExtraGrid();
  } catch {
    slot.classList.remove('uploading');
    showToast(t('manage.info.uploadImageFailed'), true);
  }
}

async function saveEditInfo() {
  if (!activeBazaar) return;

  if (activeBazaar.status === 'completed') {
    _showMsg('edit-msg', t('manage.info.validation.cannotEditCompleted'), 'error');
    return;
  }
  if (activeBazaar.status === 'cancelled') {
    _showMsg('edit-msg', t('manage.info.validation.cannotEditCancelled'), 'error');
    return;
  }

  const locked = _isEditLocked(activeBazaar);
  const title  = _val('e-title').trim();
  const startD = _val('e-start-date');
  const endD   = _val('e-end-date');

  if (!locked) {
    if (!title) { _showMsg('edit-msg', t('manage.info.validation.titleRequired'), 'error'); return; }
    if (startD && endD && startD >= endD) {
      _showMsg('edit-msg', t('manage.info.validation.datesInvalid'), 'error');
      return;
    }
  }

  const currentImages = Array.isArray(activeBazaar.images) ? activeBazaar.images : [];
  const newCover      = editCoverUrl || currentImages[0] || null;
  const newExtras     = editExtraUrls.filter(Boolean);
  const newImages     = [newCover, ...newExtras].filter(Boolean);

  // If within lock window, only allow description + images
  const updates = locked
    ? {
        description: _val('e-description').trim() || null,
        images:      newImages.length ? newImages : currentImages,
      }
    : {
        title:         title,
        venue_name:    _val('e-location').trim()     || null,
        location_url:  _val('e-location-url').trim() || null,
        working_hours: _val('e-working-hours').trim() || null,
        description:   _val('e-description').trim()  || null,
        images:        newImages.length ? newImages : currentImages,
      };
  if (!locked && startD) updates.start_date = startD;
  if (!locked && endD)   updates.end_date   = endD;

  // ما الذي يشمله الحجز + الدعاية والتغطية الإعلامية — قابلة للتعديل دائماً (لا تتأثر بنافذة القفل)
  updates.included_amenities = MN_AMENITY_MAP
    .filter(([id]) => document.getElementById(id)?.checked)
    .map(([, label]) => label);
  updates.chair_count = document.getElementById('e-amen-chair')?.checked
    ? (Number(_val('e-chair-count')) || null)
    : null;
  updates.other_amenities_note      = _val('e-amen-other-note').trim() || null;
  updates.ad_budget_tier            = _val('e-ad-budget') || null;
  updates.will_have_photography     = !!document.getElementById('e-ad-photography')?.checked;
  updates.will_have_social_coverage = !!document.getElementById('e-ad-social')?.checked;
  updates.will_have_paid_ads        = !!document.getElementById('e-ad-paidads')?.checked;

  _setBtnState('edit-save-btn', true, t('manage.info.saving'));
  _hide('edit-msg');

  const { data, error } = await sb.rpc('update_bazaar_info', {
    p_bazaar_id: activeBazaar.id,
    p_updates:   updates,
  });

  _setBtnState('edit-save-btn', false, t('manage.info.saveBtn'));

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.info.errors.generic');
    const msgs = {
      bazaar_not_found:      t('manage.info.errors.bazaar_not_found'),
      not_authorized:        t('manage.info.errors.not_authorized'),
      cannot_edit_cancelled: t('manage.info.errors.cannot_edit_cancelled'),
      rate_limit_exceeded:   t('manage.info.errors.rate_limit_exceeded'),
      edit_locked_24h:       t('manage.info.errors.edit_locked_24h'),
    };
    _showMsg('edit-msg', msgs[err] || err, 'error');
    if (err === 'edit_locked_24h') _applyLockWindow(activeBazaar);
    return;
  }

  /* update local state */
  Object.assign(activeBazaar, updates);
  activeBazaar.image        = newImages[0] || null;
  activeBazaar.extra_images = newImages.slice(1);
  activeBazaar.images       = newImages.length ? newImages : currentImages;
  if (startD) activeBazaar.start_date = startD;
  if (endD)   activeBazaar.end_date   = endD;

  _updateDetailHeader(activeBazaar);
  renderCards();
  _showMsg('edit-msg', t('manage.info.savedSuccess'), 'ok');
  showToast(t('manage.info.savedSuccess'));
}

/* ════════════════════════════════════════════════════════
   TAB 2: SLOTS (M7 + M10 — الأماكن)
════════════════════════════════════════════════════════ */
function _populateSlotsCount(b) {
  const booked = (b.total_slots || 0) - (b.available_slots || 0);
  _setText('sc-total',     b.total_slots || 0);
  _setText('sc-booked',    booked);
  _setText('sc-available', b.available_slots || 0);
  _setText('sc-hint', t('manage.slots.hintWithBooked', { count: booked }));

  const inp = document.getElementById('sc-new-total');
  if (inp) { inp.value = b.total_slots || ''; inp.min = booked || 1; }

  _setText('sm-premium-price-display',
    b.premium_price ? t('manage.slots.premiumPriceLabel', { price: _num(b.premium_price) }) : t('manage.slots.premiumPriceUndefined'));

  /* reset slot grids + reservation fields */
  _val('sm-reserved-for', '');
  _val('sm-note', '');
  _setText('sm-grid-reserve', '');
  _setText('sm-grid-premium', '');
  activeSlots   = [];
  activeSlotTab = 'reserve';
  document.getElementById('smt-reserve')?.classList.add('active');
  document.getElementById('smt-premium')?.classList.remove('active');
  document.getElementById('smt-reserve-panel').style.display = 'block';
  document.getElementById('smt-premium-panel').style.display = 'none';

  const canSlotEdit = SLOTS_EDIT_ALLOWED.includes(b.status);
  const slotsSection = document.getElementById('tab-slots');
  if (slotsSection) slotsSection.style.pointerEvents = canSlotEdit ? '' : 'none';

  _hide('sc-msg');
  _hide('sm-msg');
  _setBtnState('sc-save-btn', false, t('manage.slots.saveBtn'));
  _applyLockWindow(b);
}

async function _loadSlots(bazaarId) {
  const { data: slots, error } = await sb
    .from('bazaar_slots')
    .select('id,slot_number,row,col,status,is_featured,internal_note,reserved_at')
    .eq('bazaar_id', bazaarId)
    .order('row').order('col');

  if (error || !slots) return;

  activeSlots = slots;
  switchSlotTab('reserve');
}

async function saveSlotsCount() {
  if (!activeBazaar) return;

  if (_isEditLocked(activeBazaar)) {
    _showMsg('sc-msg', t('manage.slots.errors.locked_24h'), 'error');
    return;
  }

  const newTotal = parseInt(document.getElementById('sc-new-total').value, 10);
  if (!newTotal || newTotal < 1) { _showMsg('sc-msg', t('manage.slots.validation.invalidNumber'), 'error'); return; }

  _setBtnState('sc-save-btn', true, t('manage.slots.saving'));
  _hide('sc-msg');

  const { data, error } = await sb.rpc('update_bazaar_slots_count', {
    p_bazaar_id: activeBazaar.id,
    p_new_total: newTotal,
  });

  _setBtnState('sc-save-btn', false, t('manage.slots.saveBtn'));

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.slots.errors.generic');
    if (err === 'below_booked_count') {
      _showMsg('sc-msg', t('manage.slots.errors.below_booked_count', { count: data.booked_count, min: data.minimum }), 'error');
    } else if (err === 'rate_limit_exceeded') {
      _showMsg('sc-msg', t('manage.slots.errors.rate_limit_exceeded'), 'error');
    } else {
      _showMsg('sc-msg', err, 'error');
    }
    return;
  }

  /* update local */
  activeBazaar.total_slots     = data.new_total;
  activeBazaar.available_slots = data.available;

  _setText('sc-total',     data.new_total);
  _setText('sc-booked',    data.booked_count);
  _setText('sc-available', data.available);
  const inp = document.getElementById('sc-new-total');
  if (inp) inp.min = data.booked_count || 1;

  renderCards();
  _showMsg('sc-msg', t('manage.slots.savedSuccess', { count: data.new_total }), 'ok');
  showToast(t('manage.slots.savedSuccess', { count: data.new_total }));
}

function switchSlotTab(tab) {
  activeSlotTab = tab;
  document.getElementById('smt-reserve')?.classList.toggle('active', tab === 'reserve');
  document.getElementById('smt-premium')?.classList.toggle('active', tab === 'premium');
  document.getElementById('smt-reserve-panel').style.display = tab === 'reserve' ? 'block' : 'none';
  document.getElementById('smt-premium-panel').style.display = tab === 'premium' ? 'block' : 'none';
  _renderSlotGrid(tab === 'reserve' ? 'sm-grid-reserve' : 'sm-grid-premium', tab);
}

function _renderSlotGrid(gridId, mode) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!activeSlots.length) {
    grid.innerHTML = `<div style="font-size:13px;color:var(--ink3);padding:20px;text-align:center">${t('manage.slots.emptySlots')}</div>`;
    return;
  }

  const rows = {};
  activeSlots.forEach(s => {
    const r = s.row || 'A';
    if (!rows[r]) rows[r] = [];
    rows[r].push(s);
  });

  grid.innerHTML = Object.entries(rows).map(([rowLbl, slots]) => `
    <div class="sm-row">
      <div class="sm-row-lbl">${rowLbl}</div>
      ${slots.map(s => _slotHTML(s, mode)).join('')}
    </div>`).join('');
}

function _slotHTML(s, mode) {
  const isBooked   = ['booked', 'pending'].includes(s.status);
  const isReserved = s.status === 'reserved_by_organizer';
  const isAvail    = s.status === 'available';
  const isPremium  = s.is_featured;

  let cls = s.status;
  if (isPremium) cls += ' premium';

  let onclick = '';
  if (mode === 'reserve') {
    if (isAvail)    onclick = `onclick="toggleReserveSlot('${s.id}', 'reserve')"`;
    if (isReserved) onclick = `onclick="toggleReserveSlot('${s.id}', 'unreserve')"`;
  } else if (mode === 'premium') {
    if (!isBooked)  onclick = `onclick="togglePremiumSlot('${s.id}', ${!isPremium})"`;
  }

  const tooltip = isBooked   ? t('manage.slots.tooltipBooked')
    : isReserved             ? (s.internal_note ? t('manage.slots.tooltipReservedByOrganizerNote', { note: s.internal_note }) : t('manage.slots.tooltipReservedByOrganizer'))
    : isPremium              ? t('manage.slots.tooltipPremium')
    :                          t('manage.slots.tooltipAvailable');

  return `
<div class="sm-slot ${cls}" ${onclick} title="${_esc(tooltip)}">
  ${isPremium ? '<span class="sm-star">⭐</span>' : ''}
  <span class="sm-num">${s.slot_number || ''}</span>
</div>`;
}

async function toggleReserveSlot(slotId, action) {
  const rpcName     = action === 'reserve' ? 'reserve_slot_internally' : 'unreserve_slot_internally';
  const note        = action === 'reserve' ? (_val('sm-note').trim()        || null) : undefined;
  const reservedFor = action === 'reserve' ? (_val('sm-reserved-for').trim() || null) : undefined;

  const params = { p_slot_id: slotId };
  if (note        !== undefined) params.p_note         = note;
  if (reservedFor !== undefined) params.p_reserved_for = reservedFor;

  const { data, error } = await sb.rpc(rpcName, params);

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.slots.errors.generic');
    const msgs = {
      slot_not_found:               t('manage.slots.errors.slot_not_found'),
      not_authorized:               t('manage.slots.errors.not_authorized'),
      slot_not_available:           t('manage.slots.errors.slot_not_available', { status: data?.status || '' }),
      slot_not_internally_reserved: t('manage.slots.errors.slot_not_internally_reserved'),
    };
    _showSlotMsg(msgs[err] || err, true);
    return;
  }

  const slot = activeSlots.find(s => s.id === slotId);
  if (slot) {
    slot.status        = action === 'reserve' ? 'reserved_by_organizer' : 'available';
    slot.reserved_at   = action === 'reserve' ? new Date().toISOString() : null;
    slot.internal_note = action === 'reserve' ? note : null;
  }

  if (activeBazaar) {
    activeBazaar.available_slots = (activeBazaar.available_slots || 0) + (action === 'reserve' ? -1 : 1);
    _setText('sc-available', activeBazaar.available_slots);
    const booked = (activeBazaar.total_slots || 0) - activeBazaar.available_slots;
    _setText('sc-booked', booked);
    renderCards();
  }

  _renderSlotGrid('sm-grid-reserve', 'reserve');
  _showSlotMsg(action === 'reserve' ? t('manage.slots.reservedSuccess') : t('manage.slots.unreservedSuccess'), false);
}

async function togglePremiumSlot(slotId, makePremium) {
  const { data, error } = await sb
    .from('bazaar_slots')
    .update({ is_featured: makePremium })
    .eq('id', slotId)
    .eq('bazaar_id', activeBazaar.id)
    .select('id');

  if (error) { _showSlotMsg(t('manage.slots.errors.premium_toggle_failed', { error: error.message }), true); return; }
  if (!data || data.length === 0) {
    _showSlotMsg(t('manage.slots.errors.premium_toggle_notfound'), true);
    return;
  }

  const slot = activeSlots.find(s => s.id === slotId);
  if (slot) slot.is_featured = makePremium;

  _renderSlotGrid('sm-grid-premium', 'premium');
  _showSlotMsg(makePremium ? t('manage.slots.premiumSetSuccess') : t('manage.slots.premiumUnsetSuccess'), false);
}

function _showSlotMsg(text, isErr) {
  const el = document.getElementById('sm-msg');
  if (!el) return;
  el.className     = 'mn-msg ' + (isErr ? 'error' : 'ok');
  el.style.display = 'block';
  el.textContent   = text;
  if (!isErr) setTimeout(() => { el.style.display = 'none'; }, 3000);
}

/* ════════════════════════════════════════════════════════
   TAB 3: STATUS (M6 + M8 — الحالة)
════════════════════════════════════════════════════════ */
function _populateStatusTab(b) {
  const today          = _cairoTodayStr();
  const alreadyStarted = b.start_date && b.start_date <= today;
  const atPostponeLimit = (b.postponed_count || 0) >= MAX_POSTPONES;
  const canPostpone    = POSTPONE_ALLOWED.includes(b.status) && !alreadyStarted && !atPostponeLimit;
  const canCancel      = CANCEL_ALLOWED.includes(b.status);

  /* booking pause section */
  _populateBookingPauseSection(b);

  /* postpone section */
  const pSection = document.getElementById('postpone-section');
  const pNote    = document.getElementById('postpone-disabled-note');
  if (pSection) pSection.classList.toggle('disabled', !canPostpone);
  if (pNote) {
    pNote.style.display = canPostpone ? 'none' : 'block';
    if (!canPostpone) {
      pNote.textContent = atPostponeLimit
        ? t('manage.statusTab.postponeLimitReached', { max: MAX_POSTPONES })
        : alreadyStarted
        ? t('manage.statusTab.postponeAlreadyStarted', { date: _formatDate(b.start_date) })
        : b.status === 'cancelled' ? t('manage.statusTab.postponeNotAllowedCancelled')
        : b.status === 'closed'    ? t('manage.statusTab.postponeNotAllowedClosed')
        : b.status === 'live' || b.status === 'completed' ? t('manage.statusTab.postponeNotAllowedLiveCompleted')
        : t('manage.statusTab.postponeNotAllowedGeneric');
    }
  }
  postponeSelectedReason = '';
  _setText('postpone-current-dates', `${_formatDate(b.start_date)} — ${_formatDate(b.end_date)}`);
  _val('p-new-start', '');
  _val('p-new-end', '');
  const ps = document.getElementById('p-new-start');
  const pe = document.getElementById('p-new-end');
  if (ps) ps.min = today;
  if (pe) pe.min = today;
  document.querySelectorAll('#postpone-reason-chips .mn-reason-chip').forEach(c => c.classList.remove('selected'));
  _hide('postpone-custom-wrap');
  _val('postpone-custom-reason', '');
  _hide('postpone-msg');
  _setBtnState('postpone-confirm-btn', false, t('manage.statusTab.confirmPostponeBtn'));

  /* cancel section */
  const cSection = document.getElementById('cancel-section');
  const cNote    = document.getElementById('cancel-disabled-note');
  if (cSection) cSection.classList.toggle('disabled', !canCancel);
  if (cNote) {
    cNote.style.display = canCancel ? 'none' : 'block';
    if (!canCancel) cNote.textContent = t('manage.statusTab.cancelNotAllowed');
  }
  cancelSelectedReason = '';
  const bookedCount = (b.total_slots || 0) - (b.available_slots || 0);
  const cwt = document.getElementById('cancel-warning-text');
  if (cwt) {
    cwt.innerHTML = bookedCount > 0
      ? t('manage.statusTab.cancelWarnWithBookings', { count: bookedCount })
      : t('manage.statusTab.cancelWarnNoBookings');
  }
  document.querySelectorAll('#cancel-reason-chips .mn-reason-chip').forEach(c => c.classList.remove('selected'));
  _hide('cancel-custom-wrap');
  _val('cancel-custom-reason', '');
  _hide('cancel-msg');
  _setBtnState('cancel-confirm-btn', false, t('manage.statusTab.confirmCancelBtn'));
}

function _populateBookingPauseSection(b) {
  const isPaused  = !!b.booking_paused;
  const reason    = b.booking_pause_reason || '';
  const isCancelled = b.status === 'cancelled';

  const section   = document.getElementById('pause-section');
  const activeNote = document.getElementById('pause-active-note');
  const reasonDisp = document.getElementById('pause-reason-display');
  const formWrap  = document.getElementById('pause-form-wrap');
  const btn       = document.getElementById('pause-toggle-btn');

  if (!section) return;

  section.classList.toggle('disabled', isCancelled);

  if (isPaused) {
    activeNote.style.display  = 'block';
    reasonDisp.textContent    = reason || t('manage.statusTab.pauseNoReason');
    formWrap.style.display    = 'none';
    btn.textContent           = t('manage.statusTab.resumeBtn');
    btn.className             = 'mn-btn primary';
  } else {
    activeNote.style.display  = 'none';
    formWrap.style.display    = 'block';
    _val('pause-reason-input', '');
    btn.textContent           = t('manage.statusTab.pauseBtn');
    btn.className             = 'mn-btn warn';
  }

  _hide('pause-msg');
  _setBtnState('pause-toggle-btn', false);
}

async function toggleBookingPause() {
  if (!activeBazaar) return;

  const isPaused = !!activeBazaar.booking_paused;
  const newPaused = !isPaused;
  const reason   = newPaused ? (_val('pause-reason-input').trim() || null) : null;

  _setBtnState('pause-toggle-btn', true, t('manage.statusTab.pausing'));
  _hide('pause-msg');

  const { data, error } = await sb.rpc('toggle_booking_pause', {
    p_bazaar_id: activeBazaar.id,
    p_paused:    newPaused,
    p_reason:    reason,
  });

  _setBtnState('pause-toggle-btn', false);

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.statusTab.errors.generic');
    const msgs = {
      bazaar_not_found:    t('manage.statusTab.errors.bazaar_not_found'),
      not_authorized:      t('manage.statusTab.errors.not_authorized'),
      bazaar_cancelled:    t('manage.statusTab.errors.bazaar_cancelled'),
      already_paused:      t('manage.statusTab.errors.already_paused'),
      already_active:      t('manage.statusTab.errors.already_active'),
      rate_limit_exceeded: t('manage.statusTab.errors.rate_limit_exceeded'),
    };
    _showMsg('pause-msg', msgs[err] || err, 'error');
    return;
  }

  activeBazaar.booking_paused       = newPaused;
  activeBazaar.booking_pause_reason = newPaused ? reason : null;

  _populateBookingPauseSection(activeBazaar);
  const msg = newPaused ? t('manage.statusTab.pausedSuccess') : t('manage.statusTab.resumedSuccess');
  _showMsg('pause-msg', msg, 'ok');
  showToast(msg);
}

function selectPostponeReason(reason) {
  postponeSelectedReason = reason;
  document.querySelectorAll('#postpone-reason-chips .mn-reason-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.reason === reason);
  });
  document.getElementById('postpone-custom-wrap').style.display = reason === 'other' ? 'flex' : 'none';
}

async function confirmPostpone() {
  if (!activeBazaar) return;

  /* guard: postpone limit */
  if ((activeBazaar.postponed_count || 0) >= MAX_POSTPONES) {
    _showMsg('postpone-msg', t('manage.statusTab.validation.postponeLimitReached', { max: MAX_POSTPONES }), 'error');
    return;
  }

  const newStart = _val('p-new-start');
  const newEnd   = _val('p-new-end');

  if (!newStart || !newEnd) { _showMsg('postpone-msg', t('manage.statusTab.validation.datesRequired'), 'error'); return; }
  if (newStart >= newEnd)   { _showMsg('postpone-msg', t('manage.statusTab.validation.datesInvalid'), 'error'); return; }

  /* client-side: لا يمكن التأجيل إذا بدأ البازار بالفعل */
  const today      = _cairoTodayStr();
  const bazaarStart = activeBazaar.start_date || '';
  if (bazaarStart && bazaarStart <= today) {
    _showMsg('postpone-msg', t('manage.statusTab.validation.alreadyStarted', { date: _formatDate(bazaarStart) }), 'error');
    return;
  }

  let reason = postponeSelectedReason;
  if (!reason) { _showMsg('postpone-msg', t('manage.statusTab.validation.reasonRequired'), 'error'); return; }
  if (reason === 'other') {
    reason = _val('postpone-custom-reason').trim();
    if (!reason) { _showMsg('postpone-msg', t('manage.statusTab.validation.customReasonRequired'), 'error'); return; }
  }

  _setBtnState('postpone-confirm-btn', true, t('manage.statusTab.postponing'));
  _hide('postpone-msg');

  const { data, error } = await sb.rpc('postpone_bazaar', {
    p_bazaar_id: activeBazaar.id,
    p_new_start: newStart,
    p_new_end:   newEnd,
    p_reason:    reason,
  });

  _setBtnState('postpone-confirm-btn', false, t('manage.statusTab.confirmPostponeBtn'));

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.statusTab.errors.generic');
    const msgs = {
      bazaar_not_found:          t('manage.statusTab.errors.bazaar_not_found'),
      not_authorized:            t('manage.statusTab.errors.not_authorized'),
      cannot_postpone_cancelled: t('manage.statusTab.errors.cannot_postpone_cancelled'),
      max_postponements_reached: t('manage.statusTab.errors.max_postponements_reached', { max: MAX_POSTPONES }),
      invalid_dates:             t('manage.statusTab.errors.invalid_dates'),
      bazaar_already_started:    t('manage.statusTab.errors.bazaar_already_started'),
    };
    _showMsg('postpone-msg', msgs[err] || err, 'error');
    return;
  }

  /* update local */
  activeBazaar.start_date      = newStart;
  activeBazaar.end_date        = newEnd;
  activeBazaar.status          = 'postponed';
  activeBazaar.postponed_count = (activeBazaar.postponed_count || 0) + 1;

  /* refresh UI */
  _setText('postpone-current-dates', `${_formatDate(newStart)} — ${_formatDate(newEnd)}`);
  _updateDetailHeader(activeBazaar);
  renderCards();

  /* disable postpone section now that status = postponed */
  const pSection = document.getElementById('postpone-section');
  const pNote    = document.getElementById('postpone-disabled-note');
  if (pSection) pSection.classList.add('disabled');
  if (pNote) { pNote.style.display = 'block'; pNote.textContent = t('manage.statusTab.postponeDisabledAfterSuccess'); }

  const n = data.notified_count || 0;
  const msg = n > 0 ? t('manage.statusTab.postponeSuccessNotified', { count: n }) : t('manage.statusTab.postponeSuccess');
  _showMsg('postpone-msg', msg, 'ok');
  showToast(msg);
}

function selectCancelReason(reason) {
  cancelSelectedReason = reason;
  document.querySelectorAll('#cancel-reason-chips .mn-reason-chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.reason === reason);
  });
  document.getElementById('cancel-custom-wrap').style.display = reason === 'other' ? 'flex' : 'none';
}

async function confirmCancel() {
  if (!activeBazaar) return;

  let reason = cancelSelectedReason;
  if (!reason) { _showMsg('cancel-msg', t('manage.statusTab.validation.reasonRequiredCancel'), 'error'); return; }
  if (reason === 'other') {
    reason = _val('cancel-custom-reason').trim();
    if (!reason) { _showMsg('cancel-msg', t('manage.statusTab.validation.customReasonRequiredCancel'), 'error'); return; }
  }

  _setBtnState('cancel-confirm-btn', true, t('manage.statusTab.cancelling'));
  _hide('cancel-msg');

  const { data, error } = await sb.rpc('cancel_bazaar', {
    p_bazaar_id: activeBazaar.id,
    p_reason:    reason,
  });

  _setBtnState('cancel-confirm-btn', false, t('manage.statusTab.confirmCancelBtn'));

  if (error || !data?.success) {
    const err = data?.error || error?.message || t('manage.statusTab.errors.generic');
    const msgs = {
      bazaar_not_found:  t('manage.statusTab.errors.bazaar_not_found'),
      not_authorized:    t('manage.statusTab.errors.not_authorized'),
      already_cancelled: t('manage.statusTab.errors.already_cancelled'),
    };
    _showMsg('cancel-msg', msgs[err] || err, 'error');
    return;
  }

  /* update local */
  activeBazaar.status              = 'cancelled';
  activeBazaar.cancellation_reason = reason;
  activeBazaar.cancelled_at        = new Date().toISOString();

  _updateDetailHeader(activeBazaar);
  renderCards();

  /* disable both sections */
  const pSection = document.getElementById('postpone-section');
  const cSection = document.getElementById('cancel-section');
  if (pSection) pSection.classList.add('disabled');
  if (cSection) cSection.classList.add('disabled');
  const cNote = document.getElementById('cancel-disabled-note');
  if (cNote) { cNote.style.display = 'block'; cNote.textContent = t('manage.statusTab.cancelDisabledAfterSuccess'); }

  const affected = data.affected_bookings || 0;
  const msg = affected > 0 ? t('manage.statusTab.cancelSuccessNotified', { count: affected }) : t('manage.statusTab.cancelSuccess');
  _showMsg('cancel-msg', msg, 'ok');
  showToast(msg);
}

/* ════════════════════════════════════════════════════════
   TAB 4: DOCS — التوثيق (روابط الحدث)
════════════════════════════════════════════════════════ */

function _populateVerificationTab(b) {
  _docsCurrentLinks = Array.isArray(b.event_links) ? [...b.event_links] : [];
  _renderDocsLinks();

  /* تنبيه بارز: البازار انتهى دون إضافة روابط توثيق
     _expiredByDate بتوقيت القاهرة (وليس UTC) لتفادي تعارضه مع status الفعلية في القاعدة قرب
     منتصف الليل — البازارات الملغاة/المؤجلة مستثناة لأن الحدث لم يقع بصورته الحالية، فتاريخ
     نهايتها القديم لا يعني أنها "انتهت" فعلياً وتحتاج توثيقاً */
  const _today_docs    = _cairoTodayStr();
  const _endD_docs     = b.date_end || b.end_date;
  const _expiredByDate = !DOCS_NOT_HAPPENED.includes(b.status) && !!_endD_docs && _endD_docs < _today_docs;
  const _isEnded       = _expiredByDate || b.status === 'completed';
  document.getElementById('docs-ended-alert')?.remove();
  if (_isEnded && !_docsCurrentLinks.length) {
    const _refEl = document.getElementById('docs-banner');
    const _alertHtml = `<div id="docs-ended-alert"
      style="background:#fef2f2;border:2px solid #fca5a5;border-radius:14px;padding:16px 18px;margin-bottom:16px;display:flex;gap:12px;align-items:flex-start">
      <span style="font-size:26px;flex-shrink:0">⚠️</span>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:900;color:#b91c1c;margin-bottom:4px">${t('manage.docsEndedAlert.title')}</div>
        <div style="font-size:12.5px;color:#dc2626;line-height:1.65;margin-bottom:12px">${t('manage.docsEndedAlert.desc')}</div>
        <button onclick="document.getElementById('docs-add-btn')?.click()"
                style="padding:9px 18px;background:#dc2626;color:#fff;border:none;border-radius:var(--radius-pill);font-family:var(--font-display);font-size:13px;font-weight:800;cursor:pointer">
          ${t('manage.docsEndedAlert.btn')}
        </button>
      </div>
    </div>`;
    if (_refEl) _refEl.insertAdjacentHTML('afterend', _alertHtml);
    else document.getElementById('docs-status-content')?.insertAdjacentHTML('beforebegin', _alertHtml);
  }

  /* 7-day banner */
  const banner   = document.getElementById('docs-banner');
  const deadline = document.getElementById('docs-banner-deadline');
  if (!banner) return;

  const showBanner = (b.status === 'completed' || b.status === 'live') && b.end_date;
  if (showBanner) {
    const endMs  = new Date(b.end_date).getTime();
    const daysAgo = Math.floor((Date.now() - endMs) / 86400000);
    if (daysAgo >= 0 && daysAgo <= 7) {
      banner.classList.add('show');
      const remaining = 7 - daysAgo;
      if (deadline) deadline.textContent = remaining > 0
        ? t('manage.docsBanner.deadlineDays', { count: remaining })
        : t('manage.docsBanner.deadlineExpired');
    } else {
      banner.classList.remove('show');
    }
  } else {
    banner.classList.remove('show');
  }

  /* status card */
  const sc = document.getElementById('docs-status-content');
  if (!sc) return;
  if (_docsCurrentLinks.length > 0) {
    const addedAt   = b.links_added_at   ? new Date(b.links_added_at).toLocaleDateString(_mnLocale())   : '—';
    const updatedAt = b.links_last_updated_at ? new Date(b.links_last_updated_at).toLocaleDateString(_mnLocale()) : null;
    sc.innerHTML = `<div class="mn-docs-status-pill green">${t('manage.docs.statusAdded', { count: _docsCurrentLinks.length })}</div>
      <div style="font-size:11.5px;color:var(--ink3)">${t('manage.docs.firstAddedOn', { date: addedAt })}${updatedAt ? t('manage.docs.lastUpdatedOn', { date: updatedAt }) : ''}</div>`;
  } else if (DOCS_ALLOWED.includes(b.status) || _expiredByDate) {
    const wasDeleted = b.links_deleted_at;
    sc.innerHTML = `<div class="mn-docs-status-pill yellow">${wasDeleted ? t('manage.docs.statusWasDeleted') : t('manage.docs.statusNoneYet')}</div>
      <div style="font-size:11.5px;color:var(--ink3);margin-top:4px">${wasDeleted ? t('manage.docs.deletedOn', { date: new Date(wasDeleted).toLocaleDateString(_mnLocale()) }) : t('manage.docs.optionalHint')}</div>`;
  } else if (DOCS_NOT_HAPPENED.includes(b.status)) {
    sc.innerHTML = `<div class="mn-docs-status-pill gray">${b.status === 'cancelled' ? t('manage.docs.notHappenedCancelled') : t('manage.docs.notHappenedPostponed')}</div>`;
  } else {
    sc.innerHTML = `<div class="mn-docs-status-pill gray">${t('manage.docs.notYetAvailable')}</div>`;
  }

  /* hide save button if docs not yet meaningful */
  const saveBtn = document.getElementById('docs-save-btn');
  const addBtn  = document.getElementById('docs-add-btn');
  const canDoc  = DOCS_ALLOWED.includes(b.status) || _expiredByDate;
  if (saveBtn) saveBtn.style.display = canDoc ? '' : 'none';
  if (addBtn)  addBtn.style.display  = canDoc ? '' : 'none';
}

function _docsGetDomain(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

function _docsGetIcon(domain) {
  if (domain.includes('facebook') || domain.includes('fb.com')) return '📘';
  if (domain.includes('instagram')) return '📸';
  if (domain.includes('tiktok'))    return '🎵';
  if (domain.includes('youtube') || domain.includes('youtu.be')) return '▶️';
  if (domain.includes('x.com') || domain.includes('twitter'))    return '🐦';
  if (domain.includes('snapchat'))  return '👻';
  if (domain.includes('linkedin'))  return '💼';
  return '🔗';
}

function _renderDocsLinks() {
  const container = document.getElementById('docs-links-container');
  if (!container) return;
  const hadSaved = !!(activeBazaar?.links_added_at);

  if (_docsCurrentLinks.length === 0) {
    container.innerHTML = `<div style="font-size:12px;color:var(--ink3);text-align:center;padding:14px 0">${t('manage.docs.noLinks')}</div>`;
    return;
  }

  container.innerHTML = _docsCurrentLinks.map((url, i) => {
    const domain  = _docsGetDomain(url);
    const isKnown = KNOWN_DOMAINS.some(d => domain.includes(d));
    const icon    = _docsGetIcon(domain);
    return `<div class="mn-docs-link-item">
      <span class="mn-docs-link-icon">${icon}</span>
      <input type="url" class="mn-docs-link-input${isKnown ? '' : ' warn'}" dir="ltr"
        value="${_esc(url)}" placeholder="https://..."
        oninput="_docsCurrentLinks[${i}]=this.value">
      ${!isKnown && url ? `<span class="mn-docs-warn-icon" title="${t('manage.docs.unknownDomainTooltip')}">⚠️</span>` : ''}
      <button class="mn-docs-link-remove" onclick="docsRemoveLink(${i})">🗑</button>
    </div>`;
  }).join('');
}

function docsAddLink() {
  if (_docsCurrentLinks.length >= MAX_DOCS_LINKS) {
    showToast(t('manage.docs.tooManyLinksSimple', { max: MAX_DOCS_LINKS }));
    return;
  }
  _docsCurrentLinks.push('');
  _renderDocsLinks();
  /* focus new input */
  const inputs = document.querySelectorAll('.mn-docs-link-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function docsRemoveLink(i) {
  _docsCurrentLinks.splice(i, 1);
  _renderDocsLinks();
}

/* شكل نطاق صالح فقط (label.label.tld) — يرفض النصوص العشوائية التي يقبلها new URL() بصمت
   عبر ترميزها كـ %20 داخل الـ hostname بدل رفضها (مثال: "not a url at all") */
const _VALID_HOSTNAME_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;

function _normalizeDocsLinks(rawLinks) {
  const normalized = [];
  const invalid    = [];
  for (const u of rawLinks) {
    let candidate = u;
    if (!/^https?:\/\//i.test(candidate)) candidate = 'https://' + candidate;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { invalid.push(u); continue; }
      if (!_VALID_HOSTNAME_RE.test(parsed.hostname)) { invalid.push(u); continue; }
      normalized.push(candidate);
    } catch { invalid.push(u); }
  }
  /* إزالة التكرار — بلا حساسية لحالة الأحرف أو / بالنهاية أو اختلاف http/https */
  const seen = new Set();
  const deduped = [];
  let dupCount = 0;
  for (const u of normalized) {
    const key = u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (seen.has(key)) { dupCount++; continue; }
    seen.add(key);
    deduped.push(u);
  }
  return { links: deduped, invalid, dupCount };
}

async function docsSaveLinks() {
  if (!activeBazaar) return;

  /* collect current values from inputs */
  document.querySelectorAll('.mn-docs-link-input').forEach((el, i) => {
    _docsCurrentLinks[i] = el.value.trim();
  });

  const rawLinks = _docsCurrentLinks.filter(u => u.length > 0);

  if (rawLinks.length === 0 && activeBazaar.links_added_at) {
    if (!confirm(t('manage.docs.confirmDeleteAll'))) return;
  }

  /* تطبيع (إضافة https:// تلقائياً لو ناقصة) + التحقق من صحة الروابط + إزالة التكرار */
  const { links, invalid, dupCount } = _normalizeDocsLinks(rawLinks);
  if (invalid.length > 0) {
    _showMsg('docs-msg', t('manage.docs.invalidLink', { count: invalid.length, links: invalid.join('، ') }), 'error');
    return;
  }
  if (links.length > MAX_DOCS_LINKS) {
    _showMsg('docs-msg', t('manage.docs.tooManyLinks', { max: MAX_DOCS_LINKS, count: links.length }), 'error');
    return;
  }

  /* تحديث الحقول المعروضة بالنسخة المُطبَّعة (https:// + بدون تكرار) */
  _docsCurrentLinks = [...links];
  _renderDocsLinks();

  /* warn about unknown domains */
  const unknown = links.filter(u => {
    const d = _docsGetDomain(u);
    return d && !KNOWN_DOMAINS.some(k => d.includes(k));
  });
  const warn = document.getElementById('docs-domain-warn');
  const warnText = document.getElementById('docs-domain-warn-text');
  if (unknown.length > 0) {
    if (warn) warn.style.display = 'block';
    if (warnText) warnText.textContent = t('manage.docs.unknownDomainWarn', { count: unknown.length, domains: unknown.map(_docsGetDomain).join('، ') });
  } else {
    if (warn) warn.style.display = 'none';
  }

  _setBtnState('docs-save-btn', true, t('manage.docs.saving'));
  _hide('docs-msg');

  const { data, error } = await sb.rpc('add_bazaar_event_links', {
    p_bazaar_id: activeBazaar.id,
    p_links:     links,
  });

  _setBtnState('docs-save-btn', false, t('manage.docs.saveBtn'));

  if (error || !data?.ok) {
    const err = data?.error || error?.message || t('manage.docs.errors.generic');
    const msgs = {
      bazaar_not_found:        t('manage.docs.errors.bazaar_not_found'),
      not_authorized:          t('manage.docs.errors.not_authorized'),
      cannot_remove_all_links: t('manage.docs.errors.cannot_remove_all_links'),
      bazaar_not_active:       t('manage.docs.errors.bazaar_not_active'),
      invalid_link_format:     t('manage.docs.errors.invalid_link_format'),
      too_many_links:          t('manage.docs.errors.too_many_links', { max: MAX_DOCS_LINKS }),
    };
    _showMsg('docs-msg', msgs[err] || err, 'error');
    return;
  }

  /* update local state */
  const isSoftDelete = data?.soft_delete === true;
  activeBazaar.event_links           = links;
  activeBazaar.links_added_at        = links.length > 0 ? (activeBazaar.links_added_at || new Date().toISOString()) : activeBazaar.links_added_at;
  activeBazaar.links_last_updated_at = links.length > 0 ? new Date().toISOString() : activeBazaar.links_last_updated_at;
  activeBazaar.links_deleted_at      = isSoftDelete ? new Date().toISOString() : null;
  _docsCurrentLinks                  = [...links];

  /* refresh badge in card list */
  const card = document.getElementById(`mn-card-${activeBazaar.id}`);
  if (card) {
    const bIdx = myBazaars.findIndex(x => x.id === activeBazaar.id);
    if (bIdx >= 0) {
      myBazaars[bIdx].event_links    = links;
      myBazaars[bIdx].links_added_at = activeBazaar.links_added_at;
    }
    renderCards();
  }

  /* refresh docs tab status card */
  _populateVerificationTab(activeBazaar);

  /* update badge in tab */
  const badge = document.getElementById('docs-badge');
  if (badge) badge.textContent = links.length > 0 ? links.length : '';

  const msg = isSoftDelete
    ? t('manage.docs.deletedAllSuccess')
    : t('manage.docs.savedSuccess', { count: links.length }) + (dupCount > 0 ? t('manage.docs.savedWithDupes', { count: dupCount }) : '');
  _showMsg('docs-msg', msg, isSoftDelete ? 'warn' : 'ok');
  showToast(msg);
}

/* ════════════════════════════════════════════════════════
   TAB 5: LOG — سجل التغييرات
════════════════════════════════════════════════════════ */
async function loadBazaarLog() {
  if (!activeBazaar) return;

  const logEl  = document.getElementById('log-list-container');
  const postEl = document.getElementById('postpone-history-container');

  logEl.innerHTML  = '<div class="mn-loading" style="padding:30px 0"><div class="mn-spin" style="font-size:22px">⏳</div></div>';
  postEl.innerHTML = '<div class="mn-loading" style="padding:20px 0"><div class="mn-spin" style="font-size:20px">⏳</div></div>';

  const [logRes, postRes] = await Promise.all([
    sb.from('bazaar_change_log')
      .select('id,change_type,created_at,note,source')
      .eq('bazaar_id', activeBazaar.id)
      .order('created_at', { ascending: false })
      .limit(60),
    sb.from('bazaar_postponements')
      .select('id,old_start,old_end,new_start,new_end,reason,created_at,accepted_count,cancelled_count')
      .eq('bazaar_id', activeBazaar.id)
      .order('created_at', { ascending: false }),
  ]);

  /* change log */
  if (!logRes.data?.length) {
    logEl.innerHTML = `<div style="font-size:13px;color:var(--ink3);padding:20px 0;text-align:center">${t('manage.log.noChanges')}</div>`;
  } else {
    const ICONS = {
      edit_info: '✏️', edit_slots_count: '🔢',
      booking_paused: '⏸️', booking_resumed: '▶️',
      admin_delete: '🗑️', auto_expire_response: '⏰',
      info_updated: '✏️', slots_count_updated: '🔢',
      slot_reserved: '🔒', slot_unreserved: '🔓',
      reserve_slot: '🔒', unreserve_slot: '🔓',
      slot_premium_set: '⭐', slot_premium_unset: '☆',
      postponed: '📅', postpone: '📅',
      cancelled: '🚫', cancel: '🚫',
      status_changed: '🔄', created: '🎪',
    };
    const SOURCE_LABEL = { admin_panel: t('manage.log.sourceAdmin'), automatic_system: t('manage.log.sourceAutomatic') };
    logEl.innerHTML = `<div class="mn-log-list">${logRes.data.map(e => `
      <div class="mn-log-item">
        <div class="mn-log-dot">${ICONS[e.change_type] || '📋'}</div>
        <div class="mn-log-body">
          <div class="mn-log-type">${CHANGE_LABEL_OF(e.change_type)}${e.source && e.source !== 'organizer_panel' ? ` <span style="font-size:10px;color:var(--ink3)">${SOURCE_LABEL[e.source] || e.source}</span>` : ''}</div>
          ${e.note ? `<div class="mn-log-note">${_esc(e.note)}</div>` : ''}
          <div class="mn-log-date">${_formatDateTime(e.created_at)}</div>
        </div>
      </div>`).join('')}</div>`;
  }

  /* postponement history */
  if (!postRes.data?.length) {
    postEl.innerHTML = `<div style="font-size:13px;color:var(--ink3);padding:20px 0;text-align:center">${t('manage.log.noPostponements')}</div>`;
  } else {
    postEl.innerHTML = postRes.data.map(p => `
      <div class="mn-log-item">
        <div class="mn-log-dot">📅</div>
        <div class="mn-log-body">
          <div class="mn-log-type">
            ${_formatDate(p.old_start)}–${_formatDate(p.old_end)}
            &nbsp;→&nbsp;
            ${_formatDate(p.new_start)}–${_formatDate(p.new_end)}
          </div>
          ${p.reason ? `<div class="mn-log-note">${_esc(t('manage.postponeReasons.' + p.reason, { defaultValue: p.reason }))}</div>` : ''}
          <div class="mn-log-note" style="color:var(--orange)">
            ${t('manage.log.acceptedCount', { count: p.accepted_count || 0 })} &nbsp;|&nbsp; ${t('manage.log.cancelledCount', { count: p.cancelled_count || 0 })}
          </div>
          <div class="mn-log-date">${_formatDateTime(p.created_at)}</div>
        </div>
      </div>`).join('');
  }
}

/* ════════════════════════════════════════════════════════
   TAB 5: BOOKINGS — الحجوزات
════════════════════════════════════════════════════════ */
async function loadBazaarBookings() {
  if (!activeBazaar) return;

  const container = document.getElementById('bookings-container');
  container.innerHTML = '<div class="mn-loading" style="padding:40px 0"><div class="mn-spin">⏳</div></div>';

  const { data, error } = await sb
    .from('bazaar_bookings')
    .select('id,status,created_at,amount,notes,user_name,bazaar_slots(row_label,slot_number)')
    .eq('bazaar_id', activeBazaar.id)
    .order('created_at', { ascending: false });

  /* update badge */
  const badge = document.getElementById('bk-badge');
  if (badge) {
    const count = data?.length || 0;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }

  if (error) {
    container.innerHTML = `<div style="color:#dc2626;padding:20px;font-size:13px">${t('manage.bookings.loadError')}</div>`;
    return;
  }

  if (!data?.length) {
    container.innerHTML = `
      <div class="mn-empty" style="margin:0">
        <div class="mn-empty-ico">🎫</div>
        <div class="mn-empty-title">${t('manage.bookings.emptyTitle')}</div>
        <div class="mn-empty-desc">${t('manage.bookings.emptyDesc')}</div>
      </div>`;
    return;
  }

  const BK_STATUS = {
    pending:   { label: t('manage.bookings.status.pending'),   bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: t('manage.bookings.status.confirmed'), bg: '#ecfdf5', color: '#047857' },
    cancelled: { label: t('manage.bookings.status.cancelled'), bg: '#fef2f2', color: '#dc2626' },
    completed: { label: t('manage.bookings.status.completed'), bg: 'var(--surface2)', color: 'var(--ink3)' },
  };

  container.innerHTML = `
    <div class="mn-bk-wrap">
      <table class="mn-bk-table">
        <thead>
          <tr>
            <th>${t('manage.bookings.colPlace')}</th>
            <th>${t('manage.bookings.colStatus')}</th>
            <th>${t('manage.bookings.colPrice')}</th>
            <th>${t('manage.bookings.colNotes')}</th>
            <th>${t('manage.bookings.colDate')}</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(bk => {
            const s   = BK_STATUS[bk.status] || { label: bk.status, bg: '', color: '' };
            const sl  = bk.bazaar_slots;
            const loc = sl ? `${sl.row_label || ''}${sl.slot_number || ''}` : '—';
            return `<tr>
              <td>${_esc(loc)}</td>
              <td><span class="mn-bk-status" style="background:${s.bg};color:${s.color}">${s.label}</span></td>
              <td>${bk.amount ? _num(bk.amount) + ' ' + t('card.currency') : '—'}</td>
              <td style="color:var(--ink3)">${_esc(bk.notes || '—')}</td>
              <td>${_formatDateTime(bk.created_at)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

/* ════════════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════════════ */
let _toastTimer = null;
function showToast(msg, isErr = false) {
  const el = document.getElementById('mn-toast');
  el.textContent = msg;
  el.className   = 'show' + (isErr ? ' error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

/* ════════════════════════════════════════════════════════
   UTILS
════════════════════════════════════════════════════════ */
function _val(id, set) {
  const el = document.getElementById(id);
  if (!el) return '';
  if (set !== undefined) { el.value = set; return set; }
  return el.value;
}

function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _hide(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function _showMsg(id, text, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className     = 'mn-msg ' + (type === 'error' ? 'error' : 'ok');
  el.style.display = 'block';
  el.textContent   = text;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _setBtnState(id, disabled, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = disabled;
  if (label !== undefined) btn.textContent = label;
}

function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _coverUrl(images) {
  if (!images) return null;
  if (Array.isArray(images) && images[0]) return images[0];
  if (typeof images === 'string') {
    try { const a = JSON.parse(images); return a[0] || null; } catch { return null; }
  }
  return null;
}

function _num(n) {
  return Number(n).toLocaleString(_mnLocale());
}

function _mnLocale() { return getLocale() === 'en' ? 'en-US' : 'ar-EG'; }

function _formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(_mnLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function _formatDateRange(s, e) {
  if (!s && !e) return null;
  return `${_formatDate(s)} — ${_formatDate(e)}`;
}

function _formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(_mnLocale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
