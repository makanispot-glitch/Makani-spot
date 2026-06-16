/* ================================================================
   📁 bazaars/manage.js — إدارة بازارات المنظم بعد النشر
   ================================================================
   يغطي: M4 (قائمة البازارات) + M5 (تعديل المعلومات)
         M6 (الإلغاء) + M7 (تعديل عدد الأماكن)
         M8 (التأجيل) + M10 (إدارة خريطة الأماكن)
   ================================================================ */

const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';
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

/* ── status display ── */
const STATUS_LABEL = {
  published:      '🟢 منشور',
  active:         '🟢 نشط',
  upcoming:       '🔵 قادم',
  postponed:      '🟠 مؤجّل',
  cancelled:      '🔴 ملغي',
  closed:         '⚫ منتهي',
  pending_review: '⏳ قيد المراجعة',
};

const EDITABLE_STATUSES  = ['published', 'active', 'upcoming', 'postponed', 'pending_review'];
const CANCEL_ALLOWED     = ['published', 'active', 'upcoming', 'postponed', 'pending_review'];
const POSTPONE_ALLOWED   = ['published', 'active', 'upcoming'];
const SLOTS_EDIT_ALLOWED = ['published', 'active', 'upcoming', 'postponed'];

const CHANGE_LABELS = {
  /* m6b */
  edit_info:           'تعديل معلومات البازار',
  edit_slots_count:    'تعديل عدد الأماكن',
  booking_paused:      'إيقاف الحجوزات مؤقتاً',
  booking_resumed:     'استئناف الحجوزات',
  admin_delete:        'حذف البازار من الأدمن',
  /* m6c */
  auto_expire_response: 'انتهاء مهلة الرد التلقائي',
  /* أنواع أقدم */
  info_updated:        'تعديل معلومات البازار',
  slots_count_updated: 'تعديل عدد الأماكن',
  slot_reserved:       'حجز مكان داخلياً',
  slot_unreserved:     'تحرير مكان داخلي',
  slot_premium_set:    'تحويل مكان إلى مميّز',
  slot_premium_unset:  'تحويل مكان إلى عادي',
  postponed:           'تأجيل البازار',
  postpone:            'تأجيل البازار',
  cancelled:           'إلغاء البازار',
  cancel:              'إلغاء البازار',
  status_changed:      'تغيير الحالة',
  created:             'إنشاء البازار',
  /* أنواع قديمة قبل m5a — للتوافق مع السجلات السابقة */
  reserve_slot:        'حجز مكان داخلياً',
  unreserve_slot:      'تحرير مكان داخلي',
};

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
    editBtn.title = 'فقط الوصف والصور قابلة للتعديل حالياً';
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
  if (m < 1)  return 'الآن';
  if (m < 60) return `منذ ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h < 24) return `منذ ${h} ساعة`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'أمس';
  if (d < 7)  return `منذ ${d} أيام`;
  return new Date(iso).toLocaleDateString('ar-EG', { day:'numeric', month:'short' });
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
        .select('id,status,booked_at,total_price')
        .eq('bazaar_id', bazaarId)
        .in('status', ['confirmed','pending','pending_after_postponement'])
        .order('booked_at', { ascending: false })
        .limit(5),
    ]);

    // Build unified event list
    const events = [];

    (logRes.data || []).forEach(e => {
      const dotClass = e.source === 'admin_panel' ? 'admin' : e.source === 'automatic_system' ? 'system' : 'log';
      events.push({
        date: e.created_at,
        ico:  FEED_ICONS[e.change_type] || '📋',
        text: CHANGE_LABELS[e.change_type] || e.change_type,
        sub:  e.note || '',
        dot:  dotClass,
        srcLabel: e.source === 'admin_panel' ? ' · 🛡️ أدمن' : e.source === 'automatic_system' ? ' · 🤖 تلقائي' : '',
      });
    });

    // Group bookings
    const bks = bkRes.data || [];
    if (bks.length > 0) {
      const newest = bks[0];
      events.push({
        date: newest.booked_at,
        ico:  '🎫',
        text: bks.length === 1
          ? `حجز جديد${newest.total_price ? ' · ' + _num(newest.total_price) + ' ج' : ''}`
          : `${bks.length} حجوزات حديثة`,
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
      listEl.innerHTML = '<div style="font-size:12px;color:var(--ink3);padding:8px 0;text-align:center">لا يوجد نشاط مسجّل بعد</div>';
      return;
    }

    listEl.innerHTML = `<div class="mn-feed-list">${top.map(ev => `
      <div class="mn-feed-item">
        <div class="mn-feed-dot ${ev.dot}">${ev.ico}</div>
        <div class="mn-feed-body">
          <div class="mn-feed-text">
            ${ev.isNew ? '<span class="mn-feed-new">جديد</span>' : ''}
            ${_esc(ev.text)}${ev.srcLabel ? `<span style="font-size:10px;color:var(--ink3)">${ev.srcLabel}</span>` : ''}
          </div>
          ${ev.sub ? `<div class="mn-feed-sub">${_esc(ev.sub)}</div>` : ''}
          <div class="mn-feed-time">${_relTime(ev.date)}</div>
        </div>
      </div>`).join('')}
    </div>`;
  } catch {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--ink3);padding:8px 0">تعذّر تحميل النشاط</div>';
  }
}

/* ════════════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: { session } } = await sb.auth.getSession();
  me = session?.user || null;

  if (!me) {
    showGuard('🔒', 'يجب تسجيل الدخول أولاً',
      'هذه الصفحة مخصصة للمنظمين الموثّقين. سجّل الدخول للمتابعة.',
      `<a href="/?p=login&redirect=/bazaars/manage.html" class="mn-btn primary" style="display:inline-flex;text-decoration:none;padding:10px 24px;font-size:14px;border-radius:50px">تسجيل الدخول</a>`
    );
    return;
  }

  const { data: prof } = await sb
    .from('organizer_profiles')
    .select('is_verified')
    .eq('user_id', me.id)
    .single();

  if (!prof?.is_verified) {
    showGuard('⭐', 'مخصوص للمنظمين الموثّقين',
      'يجب أن يكون حسابك موثّقاً كمنظم بازارات لاستخدام هذه الصفحة.',
      `<a href="/bazaars/verification.html" class="mn-btn primary" style="display:inline-flex;text-decoration:none;padding:10px 24px;font-size:14px;border-radius:50px">طلب التوثيق</a>`
    );
    return;
  }

  _buildExtraGrid();
  await loadMyBazaars();
});

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
      'name as title',
      'description',
      'location',
      'maps_link as location_url',
      'date_start as start_date',
      'date_end as end_date',
      'total_slots',
      'available_slots',
      'price_per_slot as slot_price',
      'premium_slots',
      'premium_price',
      'image',
      'extra_images',
      'status',
      'is_archived',
      'is_deleted',
      'deleted_at',
      'cancelled_at',
      'cancellation_reason',
      'postponed_count',
      'booking_paused',
      'booking_pause_reason',
      'created_at',
      'updated_at',
    ].join(','))
    .eq('organizer_id', me.id)
    .eq('is_archived', false)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });

  document.getElementById('mn-loading').style.display = 'none';

  if (error) {
    document.getElementById('view-list').style.display = 'block';
    showToast('خطأ في تحميل البازارات: ' + error.message, true);
    return;
  }

  myBazaars = (data || []).map(b => ({
    ...b,
    images: [b.image, ...(b.extra_images || [])].filter(Boolean),
  }));

  document.getElementById('view-list').style.display = 'block';
  renderCards();
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
  const statusLabel = STATUS_LABEL[b.status] || b.status;

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
        <span>🎫 ${bookedCount}/${b.total_slots || 0} محجوز</span>
        ${b.postponed_count > 0 ? `<span style="color:var(--orange)">⏩ أُجّل ${b.postponed_count} مرة</span>` : ''}
      </div>
      <div class="mn-card-badges">
        <span class="mn-status ${statusClass}">${statusLabel}</span>
        ${b.premium_slots > 0 ? `<span class="mn-status" style="background:#fefce8;color:#a16207;border-color:#fde047">⭐ ${b.premium_slots} مميز</span>` : ''}
        ${b.slot_price > 0 ? `<span class="mn-status" style="background:var(--surface2);color:var(--ink2);border-color:var(--border)">${_num(b.slot_price)} ج</span>` : ''}
      </div>
      ${b.cancellation_reason ? `<div style="font-size:11px;color:#dc2626;margin-top:6px">سبب الإلغاء: ${_esc(b.cancellation_reason)}</div>` : ''}
    </div>
  </div>
  <div class="mn-card-actions">
    <a class="mn-btn" href="/bazaars/?id=${b.id}" target="_blank">↗ عرض</a>
    <button class="mn-btn primary" onclick="openBazaarDetail('${b.id}')">⚙️ إدارة</button>
  </div>
</div>`;
}

/* ════════════════════════════════════════════════════════
   VIEW NAVIGATION
════════════════════════════════════════════════════════ */
async function openBazaarDetail(id) {
  const b = myBazaars.find(x => x.id === id);
  if (!b) return;

  activeBazaar    = b;
  _logLoaded      = false;
  _bookingsLoaded = false;

  /* populate all eager tabs */
  _populateInfoTab(b);
  _populateSlotsCount(b);
  _populateStatusTab(b);

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
  document.getElementById('hero-title').innerHTML = 'إدارة <span>بازاراتي</span>';
  document.getElementById('hero-sub').textContent  = 'تعديل التفاصيل، الإلغاء، التأجيل، وإدارة الأماكن بعد النشر';
  document.getElementById('nav-title').textContent = '⚙️ إدارة البازارات';

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
  badge.textContent = STATUS_LABEL[b.status] || b.status;
  badge.className   = 'mn-status ' + (b.status || 'pending_review');

  document.getElementById('detail-view-link').href = `/bazaars/?id=${b.id}`;

  /* hero */
  document.getElementById('hero-title').innerHTML  = `إدارة <span>${_esc(b.title || 'البازار')}</span>`;
  document.getElementById('hero-sub').textContent  =
    [_formatDateRange(b.start_date, b.end_date), b.location].filter(Boolean).join(' | ');
  document.getElementById('nav-title').textContent = `⚙️ ${b.title || 'إدارة البازار'}`;
}

/* ════════════════════════════════════════════════════════
   TAB 1: INFO (M5 — تعديل المعلومات)
════════════════════════════════════════════════════════ */
function _populateInfoTab(b) {
  _val('e-title',         b.title || '');
  _val('e-location',      b.location || '');
  _val('e-location-url',  b.location_url || '');
  _val('e-start-date',    b.start_date || '');
  _val('e-end-date',      b.end_date || '');
  _val('e-working-hours', b.working_hours || '');
  _val('e-description',   b.description || '');

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
  _setBtnState('edit-save-btn', false, '💾 حفظ التعديلات');
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
  stat.textContent = 'جارٍ الرفع…';
  try {
    const path = `bazaars/${me.id}/cover_${Date.now()}.webp`;
    const url  = await uploadSingleImageToR2(file, path, token);
    editCoverUrl = url;
    const prevEl = document.getElementById('e-cover-preview');
    prevEl.src = url;
    box.classList.remove('uploading');
    box.classList.add('has-img');
    document.getElementById('e-cover-placeholder').style.display = 'none';
    stat.textContent = '✅ تم رفع الغلاف';
  } catch {
    box.classList.remove('uploading');
    stat.textContent = '❌ فشل الرفع';
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
    showToast('فشل رفع الصورة', true);
  }
}

async function saveEditInfo() {
  if (!activeBazaar) return;

  const locked = _isEditLocked(activeBazaar);
  const title  = _val('e-title').trim();
  const startD = _val('e-start-date');
  const endD   = _val('e-end-date');

  if (!locked) {
    if (!title) { _showMsg('edit-msg', 'اسم البازار مطلوب', 'error'); return; }
    if (startD && endD && startD >= endD) {
      _showMsg('edit-msg', 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'error');
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
        location:      _val('e-location').trim()     || null,
        location_url:  _val('e-location-url').trim() || null,
        working_hours: _val('e-working-hours').trim() || null,
        description:   _val('e-description').trim()  || null,
        images:        newImages.length ? newImages : currentImages,
      };
  if (!locked && startD) updates.start_date = startD;
  if (!locked && endD)   updates.end_date   = endD;

  _setBtnState('edit-save-btn', true, '⏳ جارٍ الحفظ…');
  _hide('edit-msg');

  const { data, error } = await sb.rpc('update_bazaar_info', {
    p_bazaar_id: activeBazaar.id,
    p_updates:   updates,
  });

  _setBtnState('edit-save-btn', false, '💾 حفظ التعديلات');

  if (error || !data?.success) {
    const err = data?.error || error?.message || 'خطأ غير معروف';
    const msgs = {
      bazaar_not_found:      'البازار غير موجود',
      not_authorized:        'غير مصرح لك بهذا الإجراء',
      cannot_edit_cancelled: 'لا يمكن تعديل بازار ملغي',
      rate_limit_exceeded:   '⏳ تجاوزت الحد المسموح من التعديلات. يُرجى الانتظار 10 دقائق',
      edit_locked_24h:       '🔒 التعديل مقيّد — لا يمكن تغيير هذه الحقول قبل 24 ساعة من البدء',
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
  _showMsg('edit-msg', '✅ تم حفظ التعديلات بنجاح', 'ok');
  showToast('✅ تم حفظ التعديلات بنجاح');
}

/* ════════════════════════════════════════════════════════
   TAB 2: SLOTS (M7 + M10 — الأماكن)
════════════════════════════════════════════════════════ */
function _populateSlotsCount(b) {
  const booked = (b.total_slots || 0) - (b.available_slots || 0);
  _setText('sc-total',     b.total_slots || 0);
  _setText('sc-booked',    booked);
  _setText('sc-available', b.available_slots || 0);
  _setText('sc-hint',      `الحجوزات الفعلية: ${booked} — الحد الأدنى المسموح به: ${booked}`);

  const inp = document.getElementById('sc-new-total');
  if (inp) { inp.value = b.total_slots || ''; inp.min = booked || 1; }

  _setText('sm-premium-price-display',
    b.premium_price ? `${_num(b.premium_price)} جنيه` : 'غير محدد');

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
  _setBtnState('sc-save-btn', false, '✅ حفظ العدد');
  _applyLockWindow(b);
}

async function _loadSlots(bazaarId) {
  const { data: slots, error } = await sb
    .from('bazaar_slots')
    .select('id,slot_number,row,col,status,is_premium,internal_note,reserved_at')
    .eq('bazaar_id', bazaarId)
    .order('row').order('col');

  if (error || !slots) return;

  activeSlots = slots;
  switchSlotTab('reserve');
}

async function saveSlotsCount() {
  if (!activeBazaar) return;

  if (_isEditLocked(activeBazaar)) {
    _showMsg('sc-msg', '🔒 التعديل مقيّد — لا يمكن تغيير عدد الأماكن قبل 24 ساعة من بدء البازار', 'error');
    return;
  }

  const newTotal = parseInt(document.getElementById('sc-new-total').value, 10);
  if (!newTotal || newTotal < 1) { _showMsg('sc-msg', 'أدخل عدداً صحيحاً', 'error'); return; }

  _setBtnState('sc-save-btn', true, '⏳ جارٍ الحفظ…');
  _hide('sc-msg');

  const { data, error } = await sb.rpc('update_bazaar_slots_count', {
    p_bazaar_id: activeBazaar.id,
    p_new_total: newTotal,
  });

  _setBtnState('sc-save-btn', false, '✅ حفظ العدد');

  if (error || !data?.success) {
    const err = data?.error || error?.message || 'خطأ';
    if (err === 'below_booked_count') {
      _showMsg('sc-msg', `لا يمكن التقليل — هناك ${data.booked_count} حجز فعلي (الحد الأدنى: ${data.minimum})`, 'error');
    } else if (err === 'rate_limit_exceeded') {
      _showMsg('sc-msg', '⏳ تجاوزت الحد المسموح من التعديلات. يُرجى الانتظار 10 دقائق', 'error');
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
  _showMsg('sc-msg', `✅ تم تحديث عدد الأماكن إلى ${data.new_total}`, 'ok');
  showToast(`✅ تم تحديث عدد الأماكن إلى ${data.new_total}`);
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
    grid.innerHTML = '<div style="font-size:13px;color:var(--ink3);padding:20px;text-align:center">لا توجد مقاعد لهذا البازار</div>';
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
  const isPremium  = s.is_premium;

  let cls = s.status;
  if (isPremium) cls += ' premium';

  let onclick = '';
  if (mode === 'reserve') {
    if (isAvail)    onclick = `onclick="toggleReserveSlot('${s.id}', 'reserve')"`;
    if (isReserved) onclick = `onclick="toggleReserveSlot('${s.id}', 'unreserve')"`;
  } else if (mode === 'premium') {
    if (!isBooked)  onclick = `onclick="togglePremiumSlot('${s.id}', ${!isPremium})"`;
  }

  const tooltip = isBooked   ? 'محجوز'
    : isReserved             ? `محجوز بالمنظم${s.internal_note ? ': ' + s.internal_note : ''}`
    : isPremium              ? '⭐ مميز'
    :                          'متاح';

  return `
<div class="sm-slot ${cls}" ${onclick} title="${_esc(tooltip)}">
  ${isPremium ? '<span class="sm-star">⭐</span>' : ''}
  <span class="sm-num">${s.slot_number || ''}</span>
  <div class="sm-slot-tooltip">${_esc(tooltip)}</div>
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
    const err = data?.error || error?.message || 'خطأ';
    const msgs = {
      slot_not_found:               'المقعد غير موجود',
      not_authorized:               'غير مصرح',
      slot_not_available:           `المقعد غير متاح (الحالة: ${data?.status || ''})`,
      slot_not_internally_reserved: 'المقعد ليس محجوزاً داخلياً',
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
  _showSlotMsg(action === 'reserve' ? '✅ تم حجز المقعد داخلياً' : '✅ تم تحرير المقعد', false);
}

async function togglePremiumSlot(slotId, makePremium) {
  const { error } = await sb
    .from('bazaar_slots')
    .update({ is_premium: makePremium })
    .eq('id', slotId)
    .eq('bazaar_id', activeBazaar.id);

  if (error) { _showSlotMsg('فشل تحديث نوع المقعد: ' + error.message, true); return; }

  const slot = activeSlots.find(s => s.id === slotId);
  if (slot) slot.is_premium = makePremium;

  _renderSlotGrid('sm-grid-premium', 'premium');
  _showSlotMsg(makePremium ? '⭐ تم تحويل المقعد إلى مميّز' : '✅ تم تحويل المقعد إلى عادي', false);
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
  const today          = new Date().toISOString().split('T')[0];
  const alreadyStarted = b.start_date && b.start_date <= today;
  const canPostpone    = POSTPONE_ALLOWED.includes(b.status) && !alreadyStarted;
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
      pNote.textContent = alreadyStarted
        ? `⛔ البازار بدأ بالفعل في ${_formatDate(b.start_date)} — التأجيل غير مسموح`
        : b.status === 'cancelled' ? 'البازار ملغي — لا يمكن التأجيل'
        : b.status === 'closed'    ? 'البازار منتهي — لا يمكن التأجيل'
        : 'الحالة الحالية لا تسمح بالتأجيل';
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
  _setBtnState('postpone-confirm-btn', false, '📅 تأكيد التأجيل');

  /* cancel section */
  const cSection = document.getElementById('cancel-section');
  const cNote    = document.getElementById('cancel-disabled-note');
  if (cSection) cSection.classList.toggle('disabled', !canCancel);
  if (cNote) {
    cNote.style.display = canCancel ? 'none' : 'block';
    if (!canCancel) cNote.textContent = 'الحالة الحالية لا تسمح بالإلغاء';
  }
  cancelSelectedReason = '';
  const bookedCount = (b.total_slots || 0) - (b.available_slots || 0);
  const cwt = document.getElementById('cancel-warning-text');
  if (cwt) {
    cwt.innerHTML = bookedCount > 0
      ? `سيتم إلغاء البازار <strong style="color:#dc2626">وإشعار ${bookedCount} صاحب حجز</strong>. هذا الإجراء لا يمكن التراجع عنه.`
      : 'سيتم إلغاء البازار. لا توجد حجوزات نشطة حالياً.';
  }
  document.querySelectorAll('#cancel-reason-chips .mn-reason-chip').forEach(c => c.classList.remove('selected'));
  _hide('cancel-custom-wrap');
  _val('cancel-custom-reason', '');
  _hide('cancel-msg');
  _setBtnState('cancel-confirm-btn', false, '🚫 تأكيد الإلغاء');
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
    reasonDisp.textContent    = reason || 'لا يوجد سبب محدد';
    formWrap.style.display    = 'none';
    btn.textContent           = '▶️ استئناف الحجوزات';
    btn.className             = 'mn-btn primary';
  } else {
    activeNote.style.display  = 'none';
    formWrap.style.display    = 'block';
    _val('pause-reason-input', '');
    btn.textContent           = '⏸️ إيقاف الحجوزات';
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

  _setBtnState('pause-toggle-btn', true, '⏳ جارٍ…');
  _hide('pause-msg');

  const { data, error } = await sb.rpc('toggle_booking_pause', {
    p_bazaar_id: activeBazaar.id,
    p_paused:    newPaused,
    p_reason:    reason,
  });

  _setBtnState('pause-toggle-btn', false);

  if (error || !data?.success) {
    const err = data?.error || error?.message || 'خطأ غير معروف';
    const msgs = {
      bazaar_not_found:    'البازار غير موجود',
      not_authorized:      'غير مصرح لك',
      bazaar_cancelled:    'البازار ملغي — لا يمكن التعديل',
      already_paused:      'الحجوزات موقوفة بالفعل',
      already_active:      'الحجوزات نشطة بالفعل',
      rate_limit_exceeded: `⏳ تجاوزت الحد المسموح من التعديلات. يُرجى الانتظار 10 دقائق`,
    };
    _showMsg('pause-msg', msgs[err] || err, 'error');
    return;
  }

  activeBazaar.booking_paused       = newPaused;
  activeBazaar.booking_pause_reason = newPaused ? reason : null;

  _populateBookingPauseSection(activeBazaar);
  const msg = newPaused ? '⏸️ تم إيقاف الحجوزات مؤقتاً' : '▶️ تم استئناف الحجوزات';
  _showMsg('pause-msg', msg, 'ok');
  showToast(msg);
}

function selectPostponeReason(reason) {
  postponeSelectedReason = reason;
  document.querySelectorAll('#postpone-reason-chips .mn-reason-chip').forEach(c => {
    c.classList.toggle('selected',
      c.textContent.trim() === reason || (reason === 'other' && c.textContent.includes('آخر')));
  });
  document.getElementById('postpone-custom-wrap').style.display = reason === 'other' ? 'flex' : 'none';
}

async function confirmPostpone() {
  if (!activeBazaar) return;

  const newStart = _val('p-new-start');
  const newEnd   = _val('p-new-end');

  if (!newStart || !newEnd) { _showMsg('postpone-msg', 'يرجى تحديد الموعد الجديد', 'error'); return; }
  if (newStart >= newEnd)   { _showMsg('postpone-msg', 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية', 'error'); return; }

  /* client-side: لا يمكن التأجيل إذا بدأ البازار بالفعل */
  const today      = new Date().toISOString().split('T')[0];
  const bazaarStart = activeBazaar.start_date || '';
  if (bazaarStart && bazaarStart <= today) {
    _showMsg('postpone-msg', '⛔ لا يمكن التأجيل — البازار بدأ بالفعل في ' + _formatDate(bazaarStart), 'error');
    return;
  }

  let reason = postponeSelectedReason;
  if (!reason) { _showMsg('postpone-msg', 'يرجى اختيار سبب التأجيل', 'error'); return; }
  if (reason === 'other') {
    reason = _val('postpone-custom-reason').trim();
    if (!reason) { _showMsg('postpone-msg', 'يرجى كتابة سبب التأجيل', 'error'); return; }
  }

  _setBtnState('postpone-confirm-btn', true, '⏳ جارٍ التأجيل…');
  _hide('postpone-msg');

  const { data, error } = await sb.rpc('postpone_bazaar', {
    p_bazaar_id: activeBazaar.id,
    p_new_start: newStart,
    p_new_end:   newEnd,
    p_reason:    reason,
  });

  _setBtnState('postpone-confirm-btn', false, '📅 تأكيد التأجيل');

  if (error || !data?.success) {
    const err = data?.error || error?.message || 'خطأ غير معروف';
    const msgs = {
      bazaar_not_found:          'البازار غير موجود',
      not_authorized:            'غير مصرح لك',
      cannot_postpone_cancelled: 'لا يمكن تأجيل بازار ملغي',
      invalid_dates:             'تواريخ غير صالحة',
      bazaar_already_started:    '⛔ لا يمكن التأجيل — البازار بدأ بالفعل',
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
  if (pNote) { pNote.style.display = 'block'; pNote.textContent = 'تم التأجيل — لا يمكن التأجيل مجدداً حتى يُعاد تفعيل البازار'; }

  const n = data.notified_count || 0;
  _showMsg('postpone-msg', `📅 تم التأجيل بنجاح${n > 0 ? ` — أُشعر ${n} حاجز` : ''}`, 'ok');
  showToast(`📅 تم التأجيل بنجاح${n > 0 ? ` — أُشعر ${n} حاجز` : ''}`);
}

function selectCancelReason(reason) {
  cancelSelectedReason = reason;
  document.querySelectorAll('#cancel-reason-chips .mn-reason-chip').forEach(c => {
    c.classList.toggle('selected',
      c.textContent.trim() === reason || (reason === 'other' && c.textContent.includes('آخر')));
  });
  document.getElementById('cancel-custom-wrap').style.display = reason === 'other' ? 'flex' : 'none';
}

async function confirmCancel() {
  if (!activeBazaar) return;

  let reason = cancelSelectedReason;
  if (!reason) { _showMsg('cancel-msg', 'يرجى اختيار سبب الإلغاء', 'error'); return; }
  if (reason === 'other') {
    reason = _val('cancel-custom-reason').trim();
    if (!reason) { _showMsg('cancel-msg', 'يرجى كتابة سبب الإلغاء', 'error'); return; }
  }

  _setBtnState('cancel-confirm-btn', true, '⏳ جارٍ الإلغاء…');
  _hide('cancel-msg');

  const { data, error } = await sb.rpc('cancel_bazaar', {
    p_bazaar_id: activeBazaar.id,
    p_reason:    reason,
  });

  _setBtnState('cancel-confirm-btn', false, '🚫 تأكيد الإلغاء');

  if (error || !data?.success) {
    const err = data?.error || error?.message || 'خطأ غير معروف';
    const msgs = {
      bazaar_not_found:  'البازار غير موجود',
      not_authorized:    'غير مصرح لك',
      already_cancelled: 'البازار ملغي بالفعل',
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
  if (cNote) { cNote.style.display = 'block'; cNote.textContent = 'البازار ملغي — لا يمكن اتخاذ إجراء آخر'; }

  const affected = data.affected_bookings || 0;
  const msg = `🚫 تم إلغاء البازار${affected > 0 ? ` — أُشعر ${affected} حاجز` : ''}`;
  _showMsg('cancel-msg', msg, 'ok');
  showToast(msg);
}

/* ════════════════════════════════════════════════════════
   TAB 4: LOG — سجل التغييرات
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
    logEl.innerHTML = '<div style="font-size:13px;color:var(--ink3);padding:20px 0;text-align:center">لا توجد سجلات تغييرات</div>';
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
    const SOURCE_LABEL = { admin_panel: '🛡️ أدمن', automatic_system: '🤖 تلقائي' };
    logEl.innerHTML = `<div class="mn-log-list">${logRes.data.map(e => `
      <div class="mn-log-item">
        <div class="mn-log-dot">${ICONS[e.change_type] || '📋'}</div>
        <div class="mn-log-body">
          <div class="mn-log-type">${CHANGE_LABELS[e.change_type] || e.change_type}${e.source && e.source !== 'organizer_panel' ? ` <span style="font-size:10px;color:var(--ink3)">${SOURCE_LABEL[e.source] || e.source}</span>` : ''}</div>
          ${e.note ? `<div class="mn-log-note">${_esc(e.note)}</div>` : ''}
          <div class="mn-log-date">${_formatDateTime(e.created_at)}</div>
        </div>
      </div>`).join('')}</div>`;
  }

  /* postponement history */
  if (!postRes.data?.length) {
    postEl.innerHTML = '<div style="font-size:13px;color:var(--ink3);padding:20px 0;text-align:center">لا توجد تأجيلات سابقة</div>';
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
          ${p.reason ? `<div class="mn-log-note">${_esc(p.reason)}</div>` : ''}
          <div class="mn-log-note" style="color:var(--orange)">
            ✅ ${p.accepted_count || 0} قبل &nbsp;|&nbsp; 🚫 ${p.cancelled_count || 0} ألغى
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
    .select('id,status,booked_at,total_price,notes,bazaar_slots(slot_number,row,col)')
    .eq('bazaar_id', activeBazaar.id)
    .order('booked_at', { ascending: false });

  /* update badge */
  const badge = document.getElementById('bk-badge');
  if (badge) {
    const count = data?.length || 0;
    badge.textContent = count;
    badge.classList.toggle('show', count > 0);
  }

  if (error) {
    container.innerHTML = '<div style="color:#dc2626;padding:20px;font-size:13px">خطأ في تحميل الحجوزات</div>';
    return;
  }

  if (!data?.length) {
    container.innerHTML = `
      <div class="mn-empty" style="margin:0">
        <div class="mn-empty-ico">🎫</div>
        <div class="mn-empty-title">لا توجد حجوزات</div>
        <div class="mn-empty-desc">لم يتم حجز أي مكان في هذا البازار بعد</div>
      </div>`;
    return;
  }

  const BK_STATUS = {
    pending:   { label: '⏳ معلّق',  bg: '#fef3c7', color: '#92400e' },
    confirmed: { label: '✅ مؤكّد',  bg: '#ecfdf5', color: '#047857' },
    cancelled: { label: '🚫 ملغي',   bg: '#fef2f2', color: '#dc2626' },
    completed: { label: '🏁 مكتمل', bg: 'var(--surface2)', color: 'var(--ink3)' },
  };

  container.innerHTML = `
    <div class="mn-bk-wrap">
      <table class="mn-bk-table">
        <thead>
          <tr>
            <th>المكان</th>
            <th>الحالة</th>
            <th>السعر</th>
            <th>ملاحظات</th>
            <th>تاريخ الحجز</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(bk => {
            const s   = BK_STATUS[bk.status] || { label: bk.status, bg: '', color: '' };
            const sl  = bk.bazaar_slots;
            const loc = sl ? `${sl.row || ''}${sl.col || ''} — ${sl.slot_number || ''}` : '—';
            return `<tr>
              <td>${_esc(loc)}</td>
              <td><span class="mn-bk-status" style="background:${s.bg};color:${s.color}">${s.label}</span></td>
              <td>${bk.total_price ? _num(bk.total_price) + ' ج' : '—'}</td>
              <td style="color:var(--ink3)">${_esc(bk.notes || '—')}</td>
              <td>${_formatDateTime(bk.booked_at)}</td>
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
  return Number(n).toLocaleString('ar-EG');
}

function _formatDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  return `${parseInt(day)} ${months[parseInt(m) - 1]} ${y}`;
}

function _formatDateRange(s, e) {
  if (!s && !e) return null;
  return `${_formatDate(s)} — ${_formatDate(e)}`;
}

function _formatDateTime(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                  'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const day  = dt.getDate();
  const mon  = months[dt.getMonth()];
  const year = dt.getFullYear();
  const hh   = String(dt.getHours()).padStart(2, '0');
  const mm   = String(dt.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${year}، ${hh}:${mm}`;
}
