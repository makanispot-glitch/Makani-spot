/* Extracted from app.js: one booking implementation for the account and legacy dashboard. */
function _bookingLocale(){ return getLocale()==='en' ? 'en-US' : 'ar-EG'; }
function _bookingEsc(value){ return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function _bookingsPageActive(){const panel=document.getElementById('account-panel-bookings');return !!document.getElementById('pg-dashboard')?.classList.contains('active') || !!panel && !panel.hidden;}
const _bookingWithdrawals = new Set();
let SERVICE_REQUESTS = [];   // آخر ما جُلب من get_my_service_requests

/* الحالات الثلاث (طلب/معاينة/نقل) بتتحوّل لمفتاح واحد يحدّد النص واللون.
   الترتيب من الأخصّ للأعمّ. كل حالة ليها مفتاح مستقل عمدًا: تجميع حالات
   النقل الأربعة تحت مفتاح واحد كان بيخفي أهم لحظتين في الرحلة — اللحظتين
   اللي الدور فيهما على العميل (الموافقة والسداد) — ويعرض «جاري الترتيب»
   حتى بعد ما المشروع يتسلّم فعلاً. */
function _svcDerivedStatus(s) {
  if (s.status === 'cancelled') return 'cancelled';
  if (s.status === 'completed') return s.transport_status === 'delivered' ? 'svc_delivered' : 'completed';

  /* النقل: كل حالة بمفردها */
  if (s.transport_status === 'delivered')         return 'svc_delivered';
  if (s.transport_status === 'in_transit')        return 'svc_in_transit';
  if (s.transport_status === 'awaiting_payment')  return 'svc_transport_pay';
  if (s.transport_status === 'awaiting_customer') return 'svc_transport_ok';
  if (s.transport_status === 'cancelled')         return 'svc_report';

  /* المعاينة */
  if (s.inspection_status === 'done')         return 'svc_insp_done';
  if (s.inspection_status === 'report_ready') return 'svc_report';
  if (s.inspection_status === 'in_progress')  return 'svc_inspecting';
  if (s.inspection_status === 'scheduled')    return 'svc_scheduled';

  /* مظلة الطلب — in_progress هنا معناها «دفع ولسه محدّدناش موعد»،
     وكانت بتقع على 'pending' فيشوف «طلب جديد» بعد ما يكون دفع فعلاً */
  if (s.status === 'in_progress')                 return 'svc_paid';
  if (s.status === 'awaiting_inspection_payment') return 'svc_awaiting_pay';
  if (s.status === 'verifying')                   return 'svc_verifying';
  return 'pending';
}

/* نبرة اللون — دلالية لا تزيينية:
   wait   = الكرة في ملعبنا، استنى علينا
   action = الكرة في ملعبك، محتاجين منك حاجة  ← أهم نبرة في الشاشة
   live   = شغل جارٍ دلوقتي
   done   = تم بنجاح
   closed = مقفول */
const BOOKING_TONES = {
  pending: 'wait', viewing_pending: 'wait', waitlist: 'action',
  confirmed: 'done', completed: 'done', cancelled: 'closed',
  svc_verifying: 'wait', svc_awaiting_pay: 'action', svc_paid: 'wait',
  svc_scheduled: 'live', svc_inspecting: 'live', svc_report: 'done',
  svc_insp_done: 'done', svc_transport_ok: 'action', svc_transport_pay: 'action',
  svc_in_transit: 'live', svc_delivered: 'done',
};

/* أيقونة نوع الطلب — تبان قبل ما تقرا أي كلمة */
const BOOKING_TYPE_ICON = {
  space:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h20l-2 4H4Z"/><path d="M4 11v9h16v-9"/><path d="M9 20v-6h6v6"/></svg>',
  bazaar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  service:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h11v9H1z"/><path d="M12 10h4.5l2.5 3v3h-7z"/><circle cx="5" cy="18.5" r="1.8"/><circle cx="16" cy="18.5" r="1.8"/></svg>',
};

/* جملة واحدة تشرح «إحنا فين دلوقتي؟» — بديل عرض ٣ حالات خام للمستخدم */
function _svcStageLabel(s) {
  const k = _svcDerivedStatus(s);
  return t('home:tenantDash.bookings.svcStage_' + k, {
    defaultValue: t('home:tenantDash.bookings.svcStage_pending'),
  });
}

let _bookingsLoadSequence = 0;
async function loadUserBookings(userId) {
  if (!sbClient || currentUser?.id !== userId) return;
  const loadSequence = ++_bookingsLoadSequence;

  const contEl = document.getElementById('dash-bookings');
  const cntEl = document.getElementById('dash-booking-count');

  try {
    const [spacesResult, bazaarsResult] = await Promise.all([
      sbClient.from('bookings').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(250),
      sbClient.from('bazaar_bookings').select('*').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(250),
    ]);
    if (loadSequence !== _bookingsLoadSequence || currentUser?.id !== userId) return;
    const spaceBookings = spacesResult.data;
    const bazaarBookings = bazaarsResult.data;
    if (spacesResult.error || bazaarsResult.error) throw spacesResult.error || bazaarsResult.error;

    /* حجوزات "نصف" مشتركة نشطة — نحتاج حالة المكان الفعلية (half_booked/booked) لمعرفة هل اكتمل الحجز */
    const halfSlotIds = [...new Set((bazaarBookings || [])
      .filter(b => b.booking_kind === 'half' && b.slot_id)
      .map(b => b.slot_id))];
    let halfSlotStatusMap = {};
    if (halfSlotIds.length) {
      const { data: halfSlots } = await sbClient
        .from('bazaar_slots').select('id,status').in('id', halfSlotIds);
      (halfSlots || []).forEach(s => { halfSlotStatusMap[s.id] = s.status; });
    }

    const localBazaarBookings = _loadLocalBazaarBookings(userId);
    const bazaarIds = [...new Set([...(bazaarBookings || []), ...localBazaarBookings].map(b=>b.bazaar_id).filter(Boolean))];
    const labels = bazaarIds.length ? await sbClient.from('bazaars').select('id,name,location,region,price_per_slot,date_start').in('id',bazaarIds) : {data:[]};
    const BAZAARS = labels.data || [];
    const bazaarById = new Map();
    const slotOwned = new Set(); // tracks "bazaar_id:slot_id" pairs already covered by DB
    /* DB records take priority — add first */
    (bazaarBookings || []).forEach(b => {
      const key = b.id || `${b.bazaar_id}:${b.slot_id}`;
      bazaarById.set(key, b);
      if (b.bazaar_id && b.slot_id) slotOwned.add(`${b.bazaar_id}:${b.slot_id}`);
    });
    /* Local cache: skip entries already covered by a DB record for the same slot */
    localBazaarBookings.forEach(b => {
      const compositeKey = `${b.bazaar_id}:${b.slot_id}`;
      if (slotOwned.has(compositeKey)) return; // DB record exists — use it (has updated status)
      const key = b.id || compositeKey;
      if (!bazaarById.has(key)) {
        bazaarById.set(key, b);
        if (b.bazaar_id && b.slot_id) slotOwned.add(compositeKey);
      }
    });

    const normalizedSpaces = (spaceBookings || []).map(b => ({
      kind: 'space',
      id: b.id,
      isWaitlist: !!b.is_waitlist,
      title: b.space_name || '—',
      loc: b.space_loc || '—',
      price: MakaniSpacePricing.quoteText(b),
      status: b.status || 'pending',
      activity: b.activity || '—',
      size: b.size || '—',
      duration: b.duration || '—',
      created_at: b.created_at,
    }));

    const normalizedBazaars = [...bazaarById.values()].filter(b => b.booking_mode !== 'managed_request').map(b => {
      const bazaar = BAZAARS.find(x => String(x.id) === String(b.bazaar_id));
      const isHalf = b.booking_kind === 'half';
      const halfComplete = isHalf && halfSlotStatusMap[b.slot_id] === 'booked';
      const price = bazaar?.price_per_slot
        ? Number(bazaar.price_per_slot).toLocaleString(_bookingLocale()) + ' ' + t('home:tenantDash.bookings.perSlot')
        : t('home:tenantDash.bookings.kindBazaar');
      return {
        kind: 'bazaar',
        bookingKind: isHalf ? 'half' : 'full',
        halfComplete,
        title: bazaar?.name || b.bazaar_name || t('home:tenantDash.bookings.bazaarBookingDefault'),
        loc: bazaar?.location || bazaar?.region || '—',
        price,
        status: b.status || 'confirmed',
        activity: b.business_name || b.activity || '—',
        size: b.slot_id ? t('home:tenantDash.bookings.spotNumPrefix') + ' ' + b.slot_id : t('home:tenantDash.bookings.bazaarSpot'),
        duration: bazaar?.date_start || '—',
        created_at: b.created_at,
      };
    });

    /* ── المصدر الثالث: طلبات خدمات شراء المشاريع ──
       «حجوزاتك» هو المكان الطبيعي اللي المستخدم بيدوّر فيه على «أنا قدّمت إيه؟»،
       فبدل صفحة «طلباتي» منفصلة، الطلبات دي بتنضم لنفس القائمة بشارة مميّزة. */
    let normalizedServices = [];
    let serviceLoadFailed = false;
    try {
      const { data: svc, error: serviceError } = await sbClient.rpc('get_my_service_requests');
      if (serviceError) throw serviceError;
      if (loadSequence !== _bookingsLoadSequence || currentUser?.id !== userId) return;
      SERVICE_REQUESTS = Array.isArray(svc) ? svc : [];
      normalizedServices = SERVICE_REQUESTS.map(s => ({
        kind: 'service',
        id: s.id,
        ref: s.ref,
        title: s.listing_title || t('home:tenantDash.bookings.serviceDefault'),
        loc: s.deliver_region || '—',
        price: s.listing_price
          ? Number(s.listing_price).toLocaleString(_bookingLocale()) + ' ' + t('home:tenantDash.bookings.currency')
          : '—',
        status: _svcDerivedStatus(s),
        activity: t('home:tenantDash.bookings.serviceActivity'),
        size: s.ref,
        duration: _svcStageLabel(s),
        created_at: s.created_at,
      }));
    } catch (e) { serviceLoadFailed = true; }

    const bookings = [...normalizedSpaces, ...normalizedBazaars, ...normalizedServices]
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    if (!contEl) return;
    // Slow refreshes and a previous account must never replace a newer view.
    if (loadSequence !== _bookingsLoadSequence || currentUser?.id !== userId) return;
    const legacyEl = MakaniManaged.prepareBookingList(contEl, userId);
    contEl.querySelector('[data-booking-error]')?.remove();
    if(serviceLoadFailed){const notice=document.createElement('p');notice.dataset.bookingError='';notice.className='mb-error';notice.textContent=t('home:tenantDash.bookings.serviceLoadFailed');contEl.append(notice);}
    if (cntEl) {
      cntEl.dataset.legacyCount = String(bookings.length);
      cntEl.textContent = bookings.length + Number(contEl.querySelector('[data-managed-requests]')?.dataset.managedCount || 0);
    }

    if (!bookings.length) {
      /* مساران لا مسار واحد: الحجز في المنصة إمّا مساحة ثابتة أو مكان في بازار،
         وكانت الحالة الفارغة تعرض المساحات فقط فتُخفي نصف المنتج عن مستخدم
         لم يجرّب أيًّا منهما بعد. */
      legacyEl.innerHTML = `
        <div class="no-bookings">
          <div style="margin-bottom:14px">${t('home:tenantDash.bookings.emptyText')}</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <a href="/spaces/"
               style="color:var(--orange);cursor:pointer;font-weight:800">
              ${t('home:tenantDash.bookings.emptyCta')}
            </a>
            <span style="opacity:.4">·</span>
            <a href="/bazaars/" style="color:var(--orange);font-weight:800;text-decoration:none">
              ${t('home:tenantDash.bookings.emptyCtaBazaars')}
            </a>
          </div>
        </div>`;
      legacyEl.querySelector('.no-bookings').hidden = Number(contEl.querySelector('[data-managed-requests]')?.dataset.managedCount || 0) > 0;
      await MakaniManaged.mountMyRequests(sbClient, userId, contEl, cntEl);
      return;
    }

    const statusMap = {
      pending:         { label: t('home:tenantDash.bookings.statusPending'),        cls: 'status-pending'   },
      viewing_pending: { label: t('home:tenantDash.bookings.statusViewingPending'), cls: 'status-pending'   },
      waitlist:        { label: t('home:tenantDash.bookings.statusWaitlist'),       cls: 'status-waitlist'  },
      confirmed:       { label: t('home:tenantDash.bookings.statusConfirmed'),      cls: 'status-confirmed' },
      cancelled:       { label: t('home:tenantDash.bookings.statusCancelled'),      cls: 'status-cancelled' },
      completed:       { label: t('home:tenantDash.bookings.statusCompleted'),      cls: 'status-confirmed' },
      /* حالات طلبات الخدمة — كل حالة بنصّها الصادق، لا تجميع */
      svc_verifying:     { label: t('home:tenantDash.bookings.svcVerifying'),     cls: 'status-pending'   },
      svc_awaiting_pay:  { label: t('home:tenantDash.bookings.svcAwaitingPay'),   cls: 'status-waitlist'  },
      svc_paid:          { label: t('home:tenantDash.bookings.svcPaid'),          cls: 'status-pending'   },
      svc_scheduled:     { label: t('home:tenantDash.bookings.svcScheduled'),     cls: 'status-pending'   },
      svc_inspecting:    { label: t('home:tenantDash.bookings.svcInspecting'),    cls: 'status-pending'   },
      svc_report:        { label: t('home:tenantDash.bookings.svcReport'),        cls: 'status-confirmed' },
      svc_insp_done:     { label: t('home:tenantDash.bookings.svcInspDone'),      cls: 'status-confirmed' },
      svc_transport_ok:  { label: t('home:tenantDash.bookings.svcTransportOk'),   cls: 'status-waitlist'  },
      svc_transport_pay: { label: t('home:tenantDash.bookings.svcTransportPay'),  cls: 'status-waitlist'  },
      svc_in_transit:    { label: t('home:tenantDash.bookings.svcInTransit'),     cls: 'status-pending'   },
      svc_delivered:     { label: t('home:tenantDash.bookings.svcDelivered'),     cls: 'status-confirmed' },
    };

    const buildCard = raw => {
      const b = Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,typeof value === 'string' ? _bookingEsc(value) : value]));
      const statusKey = (b.kind === 'space' && b.isWaitlist) ? 'waitlist' : b.status;
      const st   = statusMap[statusKey] || statusMap.pending;
      const tone = BOOKING_TONES[statusKey] || 'wait';
      const dateStr = b.created_at
        ? new Date(b.created_at).toLocaleDateString(_bookingLocale(), { year: 'numeric', month: 'short', day: 'numeric' })
        : '—';
      const kindLabel = b.kind === 'service'
        ? t('home:tenantDash.bookings.kindService')
        : b.kind === 'bazaar'
          ? (b.bookingKind === 'half'
              ? (b.halfComplete ? t('home:tenantDash.bookings.kindSharedComplete') : t('home:tenantDash.bookings.kindSharedPending'))
              : t('home:tenantDash.bookings.kindBazaar'))
          : t('home:tenantDash.bookings.kindSpace');
      const canWithdraw = b.kind === 'space' && b.id &&
        (b.isWaitlist || b.status === 'pending' || b.status === 'viewing_pending');
      const isService = b.kind === 'service';

      /* بيانات ثانوية كشرائح هادئة بدل صف إيموجي — الإيموجي كان بياخد
         وزن بصري أعلى من القيمة نفسها */
      const chips = [b.activity, b.size, b.duration]
        .filter(v => v && v !== '—')
        .map(v => `<span class="bk-chip">${v}</span>`).join('');

      return `
      <div class="bk-card bk-${b.kind}${b.bookingKind === 'half' ? ' bk-shared' : ''}"
           ${isService ? `role="button" tabindex="0" onclick="openServiceRequest('${b.id}')"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openServiceRequest('${b.id}')}"` : ''}>
        <span class="bk-ico">${BOOKING_TYPE_ICON[b.kind] || ''}</span>
        <div class="bk-main">
          <div class="bk-top">
            <span class="bk-kind">${kindLabel}</span>
            <span class="bk-status tone-${tone}"><i></i>${st.label}</span>
          </div>
          <div class="bk-title">${b.title}</div>
          <div class="bk-sub">${b.loc}${b.price && b.price !== '—' ? ` · <b>${b.price}</b>` : ''}</div>
          ${chips ? `<div class="bk-chips">${chips}</div>` : ''}
          <div class="bk-foot">
            <span class="bk-date">${dateStr}</span>
            ${isService ? `<span class="bk-more">${t('home:tenantDash.bookings.serviceDetailsBtn')} ‹</span>` : ''}
            ${canWithdraw ? `<button class="btn-withdraw" data-withdraw="${b.id}" onclick="event.stopPropagation();withdrawBooking('${b.id}')">${t('home:tenantDash.bookings.withdrawBtn')}</button>` : ''}
          </div>
        </div>
      </div>`;
    };

    /* فصل الشغّال عن المنتهي: الطلب النشط لازم يفضل ظاهر مهما كان عدد
       الطلبات القديمة، وكان ممكن يتخفي تحت «عرض الكل» لو ٣ طلبات أحدث منه
       اتقفلوا. المنتهي بيتجمّع تحت في قسم مطوي. */
    const isDone = b => b.status === 'completed' || b.status === 'cancelled' || b.status === 'svc_delivered' ||
                        (b.kind === 'service' && ['completed', 'cancelled'].includes(b.status));
    const active   = bookings.filter(b => !isDone(b));
    const finished = bookings.filter(isDone);

    const legacyHTML =
      (active.length ? active.map(buildCard).join('') : '') +
      (finished.length ? `
        <div class="bk-group-head" onclick="toggleBookings(${finished.length})" id="bookings-toggle"
             role="button" tabindex="0" aria-expanded="false" aria-controls="bookings-extra" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleBookings(${finished.length})}">
          <span>${t('home:tenantDash.bookings.groupDone')} (${finished.length})</span>
          <i class="bk-caret">⌄</i>
        </div>
        <div class="bookings-extra" id="bookings-extra" style="display:none">
          ${finished.map(buildCard).join('')}
        </div>` : '') +
      (!active.length && !finished.length ? '' : '');
    if (legacyEl._bookingHTML !== legacyHTML) {
      const extra = document.getElementById('bookings-extra');
      const expanded = !!extra && extra.style.display !== 'none';
      legacyEl.innerHTML = legacyHTML;
      legacyEl._bookingHTML = legacyHTML;
      if (expanded && legacyEl.querySelector('#bookings-extra')) {
        legacyEl.querySelector('#bookings-extra').style.display = '';
        legacyEl.querySelector('#bookings-toggle')?.setAttribute('aria-expanded','true');
      }
    }
    await MakaniManaged.mountMyRequests(sbClient, userId, contEl, cntEl);

  } catch (e) {
    if (contEl && loadSequence === _bookingsLoadSequence && currentUser?.id === userId) {
      const stale=!!contEl.querySelector('.bk-card,.mb-request');
      if(!stale)contEl.innerHTML='';
      let notice=contEl.querySelector('[data-booking-error]');
      if(!notice){notice=document.createElement('div');notice.dataset.bookingError='';notice.className='mb-error';contEl.append(notice);}
      notice.textContent=t('home:tenantDash.bookings.loadFailed');
      const retry=document.createElement('button');retry.className='account-button';retry.textContent=t('common:account.refresh');retry.onclick=()=>loadUserBookings(userId);notice.append(retry);
      await MakaniManaged.mountMyRequests(sbClient,userId,contEl,cntEl);
    }
  }
}

/* ── تفاصيل طلب الخدمة: الخط الزمني + التقرير + عرض النقل ── */
let _serviceReturnFocus=null;
function openServiceRequest(id) {
  const s = SERVICE_REQUESTS.find(x => x.id === id);
  const box = document.getElementById('svc-detail-body');
  const modal = document.getElementById('svc-detail-modal');
  if (!s || !box || !modal) return;
  _serviceReturnFocus=document.activeElement;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fdate = d => d ? new Date(d).toLocaleDateString(_bookingLocale(),
    { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  const rep = s.inspection_report || null;
  /* لكل نوع حدث بادئة مفاتيح خاصة به: حالة الطلب لها قيم خام مختلفة تمامًا
     عن الحالات المشتقّة المستخدمة في لون البطاقة (in_progress مقابل svc_report
     مثلاً)، فخلطهما كان بيطبع الاسم الإنجليزي الخام في الخط الزمني. */
  const evLabel = e => {
    if (e.event_type === 'created') return t('home:tenantDash.bookings.svcEvCreated');
    if (e.event_type === 'note')    return esc(e.note);
    if (e.event_type === 'report')  return t('home:tenantDash.bookings.svcEvReport');
    const prefix = e.event_type === 'inspection' ? 'svcInsp_'
                 : e.event_type === 'transport'  ? 'svcTrans_'
                 : 'svcReq_';
    return t('home:tenantDash.bookings.' + prefix + (e.to_status || ''),
             { defaultValue: esc(e.to_status || '') });
  };

  box.innerHTML = `
    <div class="svc-d-head">
      <span class="svc-d-ref">${esc(s.ref)}</span>
      <span class="bk-status tone-${BOOKING_TONES[_svcDerivedStatus(s)] || 'wait'}"><i></i>${esc(_svcStageLabel(s))}</span>
    </div>
    <h3 class="svc-d-title">${esc(s.listing_title || '')}</h3>
    <div class="svc-d-grid">
      <div><span>${t('home:tenantDash.bookings.svcDeliverTo')}</span><strong>${esc(s.deliver_region || '')}${s.deliver_area ? ' — ' + esc(s.deliver_area) : ''}</strong></div>
      <div><span>${t('home:tenantDash.bookings.svcPhone')}</span><strong dir="ltr">${esc(s.contact_phone || '')}</strong></div>
      <div><span>${t('home:tenantDash.bookings.svcCreated')}</span><strong>${fdate(s.created_at)}</strong></div>
      <div><span>${t('home:tenantDash.bookings.svcUpdated')}</span><strong>${fdate(s.updated_at)}</strong></div>
    </div>
    ${s.notes ? `<div class="svc-d-block"><div class="svc-d-block-h">${t('home:tenantDash.bookings.svcYourNotes')}</div><p>${esc(s.notes)}</p></div>` : ''}
    ${s.cancel_reason ? `<div class="svc-d-block svc-d-cancel"><div class="svc-d-block-h">${t('home:tenantDash.bookings.svcClosedReason')}</div><p>${t('home:tenantDash.bookings.svcReason_' + s.cancel_reason, { defaultValue: esc(s.cancel_reason) })}</p></div>` : ''}
    ${rep ? `
      <div class="svc-d-block">
        <div class="svc-d-block-h">${t('home:tenantDash.bookings.svcReportTitle')}</div>
        ${rep.notes ? `<p>${esc(rep.notes)}</p>` : ''}
        <div class="svc-d-rep">
          ${rep.dimensions ? `<span>${t('home:tenantDash.bookings.svcDimensions')}: ${esc(rep.dimensions)}</span>` : ''}
          ${rep.volume ? `<span>${t('home:tenantDash.bookings.svcVolume')}: ${esc(rep.volume)}</span>` : ''}
          ${rep.vehicle ? `<span>${t('home:tenantDash.bookings.svcVehicle')}: ${esc(rep.vehicle)}</span>` : ''}
        </div>
        ${Array.isArray(rep.discrepancies) && rep.discrepancies.length
          ? `<div class="svc-d-diff"><strong>${t('home:tenantDash.bookings.svcDiffs')}</strong><ul>${rep.discrepancies.map(d => `<li>${esc(d)}</li>`).join('')}</ul></div>` : ''}
      </div>` : ''}
    ${s.transport_quote_note ? `<div class="svc-d-block"><div class="svc-d-block-h">${t('home:tenantDash.bookings.svcQuote')}</div><p>${esc(s.transport_quote_note)}</p></div>` : ''}
    <div class="svc-d-block">
      <div class="svc-d-block-h">${t('home:tenantDash.bookings.svcTimeline')}</div>
      <ol class="svc-d-timeline">
        ${(s.events || []).map(e => `
          <li><span class="svc-d-dot"></span>
            <div><strong>${evLabel(e)}</strong><small>${fdate(e.created_at)}</small></div>
          </li>`).join('')}
      </ol>
    </div>`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
  modal.querySelector('.svc-detail-close')?.focus();
}

function closeServiceRequest() {
  document.getElementById('svc-detail-modal')?.classList.remove('open');
  document.body.style.overflow = '';
  if(_serviceReturnFocus?.isConnected)_serviceReturnFocus.focus({preventScroll:true});
}

async function withdrawBooking(bookingId) {
  if (!sbClient || !bookingId || _bookingWithdrawals.has(bookingId)) return;
  if (!confirm(t('home:tenantDash.bookings.withdrawConfirm'))) return;

  const btn = document.querySelector(`[data-withdraw="${bookingId}"]`);
  if (btn?.disabled) return;
  if (btn) { btn.disabled = true; btn.textContent = t('home:tenantDash.bookings.withdrawing'); }

  _bookingWithdrawals.add(bookingId);
  try {
    const { data: { user }, error: authErr } = await sbClient.auth.getUser();
    if (authErr || !user) throw new Error(t('home:tenantDash.bookings.loginRequiredFirst'));

    const { error } = await sbClient.rpc('user_cancel_booking', { p_booking_id: bookingId });
    if (error) throw error;

    if (currentUser?.id === user.id) await loadUserBookings(user.id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('home:tenantDash.bookings.withdrawBtn'); }
    alert(t('home:tenantDash.bookings.withdrawFailed', { msg: e.message || t('home:tenantDash.bookings.unknownError') }));
  } finally { _bookingWithdrawals.delete(bookingId); }
}

function _bazaarBookingCacheKey(userId) {
  return `makani:bazaar-bookings:${userId}`;
}

function _loadLocalBazaarBookings(userId) {
  try {
    const raw = localStorage.getItem(_bazaarBookingCacheKey(userId));
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

function _saveLocalBazaarBooking(userId, booking) {
  if (!userId || !booking) return;
  const current = _loadLocalBazaarBookings(userId);
  const key = booking.id || `${booking.bazaar_id}-${booking.slot_id}-${booking.created_at}`;
  const next = [booking, ...current.filter(b => {
    const bKey = b.id || `${b.bazaar_id}-${b.slot_id}-${b.created_at}`;
    return bKey !== key;
  })].slice(0, 100);
  localStorage.setItem(_bazaarBookingCacheKey(userId), JSON.stringify(next));
}


/* ================================================================
   🔄 القسم العشرون-ب: Auto-refresh — تحديث الحجوزات كل 15 ثانية
   ================================================================ */
let _bookingInterval = null;
let _bookingChannel=null, _bookingUserId=null, _bookingRefreshTimer=null;

function _unsubscribeBookings(){
  ++_bookingsLoadSequence;
  SERVICE_REQUESTS = [];
  if(_bookingInterval)clearInterval(_bookingInterval);
  if(_bookingRefreshTimer)clearTimeout(_bookingRefreshTimer);
  if(_bookingChannel)sbClient?.removeChannel(_bookingChannel);
  _bookingInterval=null;_bookingRefreshTimer=null;_bookingChannel=null;_bookingUserId=null;
}

function _refreshManagedBookings(userId){
  if(currentUser?.id!==userId||document.hidden)return;
  const container=document.getElementById('dash-bookings');
  if(container&&_bookingsPageActive())
    MakaniManaged.mountMyRequests(sbClient,userId,container,document.getElementById('dash-booking-count'));
}

function _subscribeBookings(userId) {
  if (!userId) return;
  if(_bookingUserId===userId&&_bookingInterval)return;
  _unsubscribeBookings();_bookingUserId=userId;
  // Existing notifications publication supplies only this customer's events.
  if(sbClient?.channel)_bookingChannel=sbClient.channel('managed-bookings-'+userId)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+userId},payload=>{
      const notification=payload.new||{};
      if(currentUser?.id!==userId||!(notification.metadata?.managed_booking_id||String(notification.type||'').startsWith('managed_booking')))return;
      clearTimeout(_bookingRefreshTimer);
      _bookingRefreshTimer=setTimeout(()=>_refreshManagedBookings(userId),120);
    }).subscribe();

  // امسح أي interval قديم
  if (_bookingInterval) {
    clearInterval(_bookingInterval);
    _bookingInterval = null;
  }

  _bookingInterval = setInterval(async () => {
    if (document.hidden || currentUser?.id !== userId) return;
    const onDash = _bookingsPageActive();
    if (!onDash) return;
    await loadUserBookings(userId);
  }, 15000);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&_bookingUserId)_refreshManagedBookings(_bookingUserId);});
/* ================================================================
   🔽 دالة إظهار/إخفاء الحجوزات الإضافية في لوحة التحكم
   ================================================================ */

/* طيّ/فرد قسم الطلبات المنتهية — الرأس نفسه هو الزر، فمفيش زر منفصل يزوّد ضجيج */
function toggleBookings(total) {
  const extra = document.getElementById('bookings-extra');
  const head  = document.getElementById('bookings-toggle');
  if (!extra || !head) return;
  const isHidden = extra.style.display === 'none';
  extra.style.display = isHidden ? '' : 'none';
  head.classList.toggle('open', isHidden);
  head.setAttribute('aria-expanded',String(isHidden));
}
