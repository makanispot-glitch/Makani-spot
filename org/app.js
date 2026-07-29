/* ================================================================
   MAKANI SPOT — ORGANIZATION (MULTI-BRANCH) DASHBOARD
   لوحة دعم قرار للقراءة فقط — لا كتابة، لا تعديل بيانات من هنا إطلاقًا.
   ================================================================ */

let sb = null;
let myMemberships = [];
let currentOrgId = null;
let currentSnapshot = null;
let currentActivityFeed = [];
let compareMetric = 'health_score';

function getSB() {
  if (!sb && window.supabase) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return sb;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showGate(title, body, ctaHtml) {
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('dash').style.display = 'none';
  document.getElementById('gate-title').textContent = title;
  document.getElementById('gate-body').textContent = body;
  document.getElementById('gate-cta').innerHTML = ctaHtml || '';
}

async function doLogout() {
  const s = getSB();
  if (s) await s.auth.signOut();
  window.location.href = '/';
}

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  const s = getSB();
  if (!s) { showGate('تعذّر الاتصال', 'لا يمكن فتح لوحة المؤسسة بدون الاتصال بنظام الحسابات.', ''); return; }

  const { data: { session } } = await s.auth.getSession();
  if (!session) {
    const redirectTo = encodeURIComponent(location.pathname + location.search);
    showGate(
      'ادخل من حسابك في منصة مكاني Spot',
      'لوحة المؤسسة تفتح تلقائيًا لحسابات الإدارة العليا المرتبطة بمؤسسة على المنصة.',
      `<a href="/?p=login&redirect=${redirectTo}" class="gate-btn">تسجيل الدخول ←</a>`
    );
    return;
  }

  // "لوحة فرعي ←" تظهر فقط لو كان صاحب الجلسة نفسه صاحب مساحة (role='owner') —
  // فشل هذا الاستعلام لا يجب أن يمنع فتح لوحة المؤسسة نفسها
  try {
    const { data: myProfile } = await s.from('profiles').select('role').eq('id', session.user.id).single();
    if (myProfile?.role === 'owner') {
      const btn = document.getElementById('nav-my-branch-btn');
      if (btn) btn.style.display = 'inline-block';
    }
  } catch {}

  const { data, error } = await s.rpc('get_my_org_memberships');
  if (error) {
    showGate('تعذّر التحقق من صلاحياتك', 'حدث خطأ أثناء التحقق من عضويتك في أي مؤسسة. حاول تحديث الصفحة.', '');
    return;
  }
  myMemberships = (data || []).filter(m => m.is_org_active);

  if (!myMemberships.length) {
    showGate(
      'ليس لديك صلاحية وصول لأي مؤسسة',
      'حسابك الحالي غير مرتبط بلوحة أي مؤسسة على منصة مكاني Spot. إن كنت تدير أكثر من فرع وتريد تفعيل هذه اللوحة، تواصل مع إدارة المنصة.',
      `<a href="/" class="gate-btn">الرجوع إلى المنصة ←</a>`
    );
    return;
  }

  const urlOrg = new URLSearchParams(location.search).get('org');
  const preselect = myMemberships.find(m => m.organization_id === urlOrg);

  if (preselect) { openOrg(preselect.organization_id); return; }
  if (myMemberships.length === 1) { openOrg(myMemberships[0].organization_id); return; }

  showOrgPicker();
}

function showOrgPicker() {
  const listHtml = myMemberships.map(m => `
    <div class="org-pick-item" onclick="openOrg('${m.organization_id}')">
      <strong>${escHtml(m.organization_name)}</strong>
      <span>${roleLabel(m.org_role)}</span>
    </div>
  `).join('');
  showGate('اختر المؤسسة', 'أنت عضو في أكثر من مؤسسة — اختر أيها تريد فتح لوحتها.', `<div class="org-pick-list">${listHtml}</div>`);
}

function roleLabel(role) {
  return { ceo: 'CEO', regional_manager: 'مدير منطقة', branch_manager: 'مدير فرع' }[role] || role;
}

async function openOrg(orgId) {
  currentOrgId = orgId;
  document.getElementById('gate').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
  await loadSnapshot();
}

async function refreshNow() {
  const s = getSB();
  try {
    await s.rpc('org_refresh_metrics_now', { p_organization_id: currentOrgId });
  } catch (e) { /* لو فشلت — نعرض آخر لقطة متاحة فقط، بدون إزعاج المستخدم */ }
  await loadSnapshot();
}

async function loadSnapshot() {
  const s = getSB();
  document.getElementById('content').innerHTML = '<div class="loading-box"><div class="spinner"></div>جاري تحميل بيانات المؤسسة…</div>';
  try {
    const { data, error } = await s.rpc('org_get_metrics_snapshot', { p_organization_id: currentOrgId });
    if (error) throw error;
    currentSnapshot = data;
    document.getElementById('nav-org-name').textContent = data.organization.name;
    renderFreshness();
    // خط النشاطات مستقل عن اللقطة الأساسية — فشله لا يجب أن يمنع عرض بقية اللوحة
    try {
      const { data: feed } = await s.rpc('org_get_activity_feed', { p_organization_id: currentOrgId, p_limit: 15 });
      currentActivityFeed = feed || [];
    } catch { currentActivityFeed = []; }
    renderDashboard();
  } catch (e) {
    document.getElementById('content').innerHTML =
      `<div class="empty-box"><div class="e-icon">⚠️</div>تعذّر تحميل بيانات المؤسسة: ${escHtml(e.message || e)}</div>`;
  }
}

function renderFreshness() {
  const branches = currentSnapshot.branches || [];
  const times = branches.map(b => new Date(b.computed_at).getTime()).filter(Boolean);
  const latest = times.length ? new Date(Math.max(...times)) : null;
  document.getElementById('nav-updated').textContent = latest ? 'آخر تحديث: ' + latest.toLocaleTimeString('ar-EG') : '';
  const staleEl = document.getElementById('nav-stale');
  staleEl.style.display = (latest && (Date.now() - latest.getTime()) > 20 * 60 * 1000) ? 'inline' : 'none';
}

/* ── Thresholds (نفس المنطق على كل مؤشر تصنيفي) ── */
function scoreClass(n) { if (n == null) return 'n'; return n >= 80 ? 'g' : n >= 50 ? 'y' : 'r'; }
function scoreLabel(n) { if (n == null) return 'بيانات غير كافية'; return n >= 80 ? 'ممتاز' : n >= 50 ? 'يحتاج متابعة' : 'حرج'; }

function renderDashboard() {
  const snap = currentSnapshot;
  const branches = snap.branches || [];
  const isScoped = snap.is_scoped;
  const hasSummary = snap.summary && Object.keys(snap.summary).length > 0;
  const orgTotalBranches = hasSummary ? (snap.summary.total_branches || 0) : null;

  if (!branches.length) {
    // ثلاث حالات فراغ مختلفة تمامًا لأسباب مختلفة — لا تشترك في نفس الرسالة
    let html;
    if (!hasSummary) {
      html = `
        <div class="empty-box">
          <div class="e-icon">⏳</div>
          <div style="font-weight:800;color:#555;margin-bottom:6px">جاري إعداد بيانات المؤسسة لأول مرة</div>
          <div style="font-size:12px">لم تُحسب أول لقطة بعد — عادة تستغرق حتى ١٥ دقيقة من ربط أول فرع. حدِّث الصفحة بعد قليل.</div>
        </div>`;
    } else if (isScoped && orgTotalBranches > 0) {
      html = `
        <div class="empty-box">
          <div class="e-icon">🔒</div>
          <div style="font-weight:800;color:#555;margin-bottom:6px">لا يوجد أي فرع ضمن نطاقك بعد</div>
          <div style="font-size:12px">هذه المؤسسة بها ${orgTotalBranches} فرع، لكن لم يُسنَد إليك أيٌّ منها بعد. تواصل مع إدارة المنصة لتحديد نطاقك.</div>
        </div>`;
    } else {
      html = `
        <div class="empty-box">
          <div class="e-icon">🏢</div>
          <div style="font-weight:800;color:#555;margin-bottom:6px">لم يتم ربط أي فرع بعد بهذه المؤسسة</div>
          <div style="font-size:12px">بمجرد ربط أول فرع من قِبل إدارة المنصة، ستبدأ هذه اللوحة بعرض بيانات حقيقية تلقائيًا دون أي إجراء إضافي منك.</div>
        </div>`;
    }
    document.getElementById('content').innerHTML = html;
    return;
  }

  // في حالة عضو مُقيَّد (مدير منطقة) نحسب الملخص من فروعه المرئية فقط، لا من ملخص المؤسسة كاملة
  const summary = isScoped ? computeScopedSummary(branches) : (snap.summary || {});
  const trendOrg = isScoped ? {} : (snap.trend_org || {});

  let html = '';
  if (isScoped) {
    html += `<div class="goal-strip" style="margin-bottom:16px;background:#EFF6FF;border-color:#93C5FD;color:#1D4ED8">
      👁️ أنت تشاهد كمدير منطقة — هذه اللوحة تعرض ${branches.length} من أصل ${orgTotalBranches ?? branches.length} فرعًا في هذه المؤسسة. كل الأرقام أدناه محسوبة على فروعك فقط.
    </div>`;
  }
  html += renderExecutiveSnapshot(snap.alerts || [], branches);
  html += renderSinceVisit(snap.my_last_visit, currentActivityFeed, branches);
  html += renderAlerts(snap.alerts || []);
  html += renderKpis(summary, trendOrg, isScoped, orgTotalBranches);
  html += renderStatusCensus(branches);
  html += renderBestWorst(branches);
  html += renderBranchCards(branches, isScoped);
  if (branches.length > 1) html += renderCompare(branches);
  else html += `<div class="hint-note">أضف فرعًا آخر لهذه المؤسسة للاستفادة من ميزة مقارنة الفروع.</div>`;
  html += renderActivityFeed(currentActivityFeed);

  document.getElementById('content').innerHTML = html;
}

/* ── لقطة تنفيذية فورية: سطر واحد، حكم عام قبل أي رقم (مراجعة UX الثانية) ── */
function renderExecutiveSnapshot(alerts, branches) {
  const hasCritical = alerts.some(a => a.severity === 'critical');
  const redBranches = branches.filter(b => scoreClass(b.health_score) === 'r').length;
  const isGood = !hasCritical && redBranches === 0;
  if (isGood) return `<div class="exec-snapshot exec-good">✅ كل الفروع تعمل بصورة طبيعية</div>`;
  const label = redBranches > 0 ? `${redBranches} ${redBranches === 1 ? 'فرع يحتاج' : 'فروع تحتاج'} متابعة` : 'يوجد ما يحتاج انتباهك أدناه';
  return `<div class="exec-snapshot exec-warn">⚠️ ${label}</div>`;
}

/* ── منذ آخر زيارتك: بدل "منذ الأمس" — يناسب زيارة أسبوعية/شهرية لا يومية فقط ── */
function renderSinceVisit(lastVisit, feed, branches) {
  if (!lastVisit) {
    return `<div class="since-visit-box">👋 هذه أول زيارة لك لهذه اللوحة — إليك نظرة عامة على وضع مؤسستك الآن.</div>`;
  }
  const since = new Date(lastVisit);
  const recent = (feed || []).filter(e => new Date(e.at) > since);
  const spacesAdded = recent.filter(e => e.type === 'space_added').length;
  const bookings = recent.filter(e => e.type === 'booking_new').length;
  const ratings = recent.filter(e => e.type === 'rating_received');
  const attention = branches.filter(b => scoreClass(b.health_score) === 'r').length;

  const bullets = [];
  if (spacesAdded > 0) bullets.push(`✅ تمت إضافة ${spacesAdded} ${spacesAdded === 1 ? 'مساحة جديدة' : 'مساحات جديدة'}`);
  if (bookings > 0) bullets.push(`📅 تم استلام ${bookings} ${bookings === 1 ? 'حجز جديد' : 'حجوزات جديدة'}`);
  ratings.forEach(r => bullets.push(`⭐ تقييم جديد ${r.score != null ? Number(r.score).toFixed(1) : ''} — ${escHtml(r.branch_label)}`));
  if (attention > 0) bullets.push(`⚠️ ${attention > 1 ? `${attention} فروع تحتاج متابعة` : 'فرع يحتاج متابعة'}`);

  if (!bullets.length) return '';
  return `<div class="since-visit-box">
    <div class="since-visit-hdr">منذ آخر زيارتك (${since.toLocaleDateString('ar-EG', {day:'numeric', month:'long'})})</div>
    <ul class="since-visit-list">${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
  </div>`;
}

/* ── شريط تعداد حالة الفروع: نظرة تعداد قبل التفاصيل عند كثرة الفروع ── */
function renderStatusCensus(branches) {
  if (branches.length < 2) return '';
  const counts = { g: 0, y: 0, r: 0, n: 0 };
  branches.forEach(b => counts[scoreClass(b.health_score)]++);
  const parts = [];
  if (counts.g) parts.push(`<span class="census-item">🟢 ${counts.g} ممتاز</span>`);
  if (counts.y) parts.push(`<span class="census-item">🟡 ${counts.y} يحتاج متابعة</span>`);
  if (counts.r) parts.push(`<span class="census-item">🔴 ${counts.r} حرج</span>`);
  if (counts.n) parts.push(`<span class="census-item">⚪ ${counts.n} بيانات غير كافية</span>`);
  return `<div class="status-census">${parts.join('')}</div>`;
}

/* ── أفضل/أسوأ فرع: تُحسب من جهة العميل من نفس branches[] المُطبَّق عليها النطاق أصلاً —
   عمدًا لا نستخدم summary.best_branch/worst_branch القادمة من الخلفية لأنها محسوبة على مستوى
   المؤسسة كاملة، وقد تشير لفرع خارج نطاق مدير المنطقة المُقيَّد ── */
function renderBestWorst(branches) {
  const withScore = branches.filter(b => b.health_score != null);
  if (withScore.length < 2) return '';
  const sorted = withScore.slice().sort((a, b) => b.health_score - a.health_score);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  if (best.branch_id === worst.branch_id) return '';
  const card = (b, icon, label, cls) => `
    <div class="spotlight-card ${cls}">
      <div class="spotlight-lbl">${icon} ${label}</div>
      <div class="spotlight-name">${escHtml(b.label)}</div>
      <div class="spotlight-score">Health Score: ${b.health_score}</div>
    </div>`;
  return `<div class="spotlight-row">
    ${card(best, '🏆', 'أفضل فرع', 'spotlight-best')}
    ${card(worst, '📉', 'يحتاج تحسين', 'spotlight-worst')}
  </div>`;
}

const ACTIVITY_LABEL = {
  space_added: e => `✅ تمت إضافة مساحة جديدة — ${escHtml(e.branch_label)}`,
  booking_new: e => `📅 تم استلام حجز جديد — ${escHtml(e.branch_label)}`,
  space_updated: e => `✏️ تم تحديث بيانات مساحة — ${escHtml(e.branch_label)}`,
  rating_received: e => `⭐ تقييم جديد ${e.score != null ? Number(e.score).toFixed(1) : ''} — ${escHtml(e.branch_label)}`,
};

/* ── آخر النشاطات: أحداث تشغيلية مُلخَّصة فقط — بلا اسم عميل/جوال/سعر (قرار مراجعة UX الثانية) ── */
function renderActivityFeed(feed) {
  if (!feed || !feed.length) return '';
  const rows = feed.map(e => {
    const fn = ACTIVITY_LABEL[e.type];
    if (!fn) return '';
    return `<div class="activity-row"><span>${fn(e)}</span><span class="activity-time">${new Date(e.at).toLocaleDateString('ar-EG', {day:'numeric', month:'short'})}</span></div>`;
  }).join('');
  return `<div class="section-title">🕓 آخر النشاطات</div><div class="activity-list">${rows}</div>`;
}

function computeScopedSummary(branches) {
  const withSpaces = branches.filter(b => b.total_spaces > 0);
  const totalSpaces = branches.reduce((s,b) => s + (b.total_spaces||0), 0);
  const occupied = branches.reduce((s,b) => s + (b.occupied_spaces||0), 0);
  return {
    total_branches: branches.length,
    total_spaces: totalSpaces,
    occupancy_rate: withSpaces.length ? Math.round(100*occupied/totalSpaces) : null,
    new_bookings_30d: branches.reduce((s,b) => s + (b.bookings_30d||0), 0),
    revenue_to_date: branches.reduce((s,b) => s + (Number(b.revenue_to_date)||0), 0),
    avg_health_score: Math.round(branches.reduce((s,b) => s + (b.health_score||0), 0) / branches.length),
  };
}

const ALERT_LABEL = {
  low_occupancy: '📉 نسبة إشغال منخفضة', vacant_60d: '🕳️ مساحات شاغرة لأكثر من 60 يومًا',
  subscription_ending: '⏰ اشتراك على وشك الانتهاء', waitlist_spike: '📈 ارتفاع طلبات قائمة الانتظار',
  booking_drop: '📉 انخفاض في الحجوزات الجديدة',
  missing_photos: '🖼️ يوجد مساحات بدون صور', low_rating: '⭐ تقييم منخفض يحتاج مراجعة',
  pending_unanswered: '⏳ طلب حجز بلا رد منذ أكثر من 48 ساعة', branch_stale: '💤 فرع بلا نشاط تشغيلي منذ 20 يومًا',
};

function renderAlerts(alerts) {
  if (!alerts.length) return '';
  const rows = alerts.map(a => `
    <div class="alert-row alert-${a.severity}">
      <span>${ALERT_LABEL[a.alert_type] || escHtml(a.message)}</span>
      <span style="margin-right:auto;font-size:11px;opacity:.75">${new Date(a.created_at).toLocaleDateString('ar-EG')}</span>
    </div>
  `).join('');
  return `<div class="alerts-box"><div class="section-title">🔔 تنبيهات تحتاج انتباهك</div>${rows}</div>`;
}

function fmtTrend(t) {
  if (!t || t.previous == null || t.delta == null) return '';
  const cls = t.delta > 0 ? 'trend-up' : t.delta < 0 ? 'trend-down' : 'trend-flat';
  const arrow = t.delta > 0 ? '↑' : t.delta < 0 ? '↓' : '→';
  return `<div class="kpi-trend ${cls}">${arrow} ${t.delta > 0 ? '+' : ''}${Math.round(t.delta)} خلال آخر شهر</div>`;
}

function renderKpis(summary, trendOrg, isScoped, orgTotalBranches) {
  const occ = summary.occupancy_rate;
  const occDotClass = occ == null ? 'dot-n' : occ >= 80 ? 'dot-g' : occ >= 50 ? 'dot-y' : 'dot-r';
  // لمدير المنطقة: "فروعك: 3 من 10" — لا "إجمالي الفروع: 3" التي تُقرأ كأن المؤسسة لا تملك غيرها
  const branchesTile = isScoped
    ? { num: `${summary.total_branches ?? '—'} من ${orgTotalBranches ?? '—'}`, lbl: 'فروعك' }
    : { num: summary.total_branches ?? '—', lbl: 'إجمالي الفروع' };
  const tiles = [
    branchesTile,
    { num: summary.total_spaces ?? '—', lbl: 'إجمالي المساحات' },
    { num: occ == null ? 'بلا بيانات' : occ + '%', dim: occ == null, lbl: 'نسبة الإشغال', dot: occDotClass, trend: fmtTrend(trendOrg.occupancy_rate) },
    { num: summary.new_bookings_30d ?? 0, lbl: 'حجوزات جديدة (30 يوم)', trend: fmtTrend(trendOrg.new_bookings_30d) },
    { num: (Number(summary.revenue_to_date)||0).toLocaleString('ar-EG'), lbl: 'الإيراد حتى تاريخه (ج.م)', trend: fmtTrend(trendOrg.revenue_to_date) },
    { num: summary.avg_health_score ?? '—', lbl: 'متوسط Health Score', trend: fmtTrend(trendOrg.avg_health_score) },
  ];
  const tilesHtml = tiles.map(t => `
    <div class="kpi-tile">
      <div class="kpi-num ${t.dim?'dim':''}">${t.num}${t.dot ? `<span class="dot ${t.dot}"></span>` : ''}</div>
      <div class="kpi-lbl">${t.lbl}</div>
      ${t.trend || ''}
    </div>
  `).join('');
  return `<div class="section-title">📊 نظرة عامة</div><div class="kpi-grid">${tilesHtml}</div>`;
}

const NEW_BRANCH_WINDOW_DAYS = 14;
function isNewBranch(b) {
  if (b.health_score != null || !b.attached_at) return false;
  return (Date.now() - new Date(b.attached_at).getTime()) < NEW_BRANCH_WINDOW_DAYS * 24 * 3600 * 1000;
}

function renderBranchCards(branches, isScoped) {
  const sorted = branches.slice().sort((a,b) => (b.health_score||0) - (a.health_score||0));
  const topBranchId = branches.length > 1 ? sorted[0]?.branch_id : null;
  const cards = sorted.map(b => {
    const isNew = isNewBranch(b);
    const cls = isNew ? 'n' : scoreClass(b.health_score);
    const healthLbl = isNew ? '🆕 فرع جديد — جاري جمع البيانات' : scoreLabel(b.health_score);
    const oppTag = b.opportunity_score >= 70 ? `<div class="opp-badge">🚀 فرصة نمو ${b.opportunity_score}%</div>` : '';
    const metrics = [];
    metrics.push(`<span>🏬 ${b.total_spaces} مساحة</span>`);
    metrics.push(`<span>${b.occupancy_rate == null ? 'بلا بيانات إشغال' : '📈 إشغال ' + b.occupancy_rate + '%'}</span>`);
    metrics.push(`<span>📅 ${b.bookings_30d} حجز (30ي)</span>`);
    if (b.vacant_60d_count > 0) metrics.push(`<span>🕳️ ${b.vacant_60d_count} شاغرة +60ي</span>`);
    const contact = b.owner_full_name ? `<div class="branch-contact">👤 ${escHtml(b.owner_full_name)}${b.owner_phone ? ` · <a href="https://wa.me/${escHtml(String(b.owner_phone).replace(/\D/g,''))}" target="_blank" rel="noopener">تواصل واتساب ←</a>` : ''}</div>` : '';
    return `
      <div class="branch-card ${b.branch_id === topBranchId ? 'crown' : ''}">
        <div class="branch-top">
          <div>
            <div class="branch-name">${escHtml(b.label)}</div>
            <div class="branch-plan">${escHtml(b.plan_tier || 'starter')} ${b.is_suspended ? '<span class="opp-badge suspended-tag">موقوف</span>' : ''} ${isNew ? '<span class="opp-badge new-branch-tag">جديد</span>' : ''}</div>
          </div>
          <div style="text-align:left">
            <div class="health-num health-${cls}">${isNew ? '🆕' : (b.health_score ?? '—')}</div>
            <div class="health-lbl health-${cls}">${healthLbl}</div>
          </div>
        </div>
        <div class="branch-metrics">${metrics.join('')}</div>
        ${oppTag}
        ${contact}
      </div>`;
  }).join('');
  return `<div class="section-title">🏆 أداء ${isScoped ? 'فروعك' : 'الفروع'} (Health Score)</div>
    <div class="hint-note" style="text-align:right;margin:-6px 0 12px">ⓘ Health Score وOpportunity Score تقدير أولي مبني على قواعد واضحة (الإشغال، الاشتراك، الحجوزات، الجودة) — وليسا حكمًا نهائيًا مطلقًا، وسيتطوران مع تراكم البيانات.</div>
    <div class="branch-grid">${cards}</div>`;
}

const COMPARE_METRICS = {
  health_score:    { label: 'Health Score', max: 100, fmt: v => v == null ? '—' : v },
  occupancy_rate:  { label: 'نسبة الإشغال', max: 100, fmt: v => (v==null?'—':v+'%') },
  revenue_to_date: { label: 'الإيراد', max: null, fmt: v => (Number(v)||0).toLocaleString('ar-EG') },
};

function renderCompare(branches) {
  return `
    <div class="section-title">⚖️ مقارنة الفروع</div>
    <div class="compare-list">
      <div class="compare-controls" id="compare-controls">
        ${Object.keys(COMPARE_METRICS).map(k => `<button class="${k===compareMetric?'on':''}" onclick="setCompareMetric('${k}')">${COMPARE_METRICS[k].label}</button>`).join('')}
      </div>
      <div id="compare-rows">${buildCompareRows(branches)}</div>
    </div>`;
}

function buildCompareRows(branches) {
  const m = COMPARE_METRICS[compareMetric];
  const vals = branches.map(b => Number(b[compareMetric]) || 0);
  const max = m.max || Math.max(...vals, 1);
  return branches.slice().sort((a,b) => (Number(b[compareMetric])||0) - (Number(a[compareMetric])||0)).map(b => {
    const v = Number(b[compareMetric]) || 0;
    const pct = Math.min(100, Math.round(100 * v / (max||1)));
    return `
      <div class="compare-row">
        <div class="compare-name">${escHtml(b.label)}</div>
        <div class="compare-bar-wrap"><div class="compare-bar" style="width:${pct}%"></div></div>
        <div class="compare-val">${m.fmt(b[compareMetric])}</div>
      </div>`;
  }).join('');
}

function setCompareMetric(key) {
  compareMetric = key;
  document.querySelectorAll('#compare-controls button').forEach(btn => btn.classList.toggle('on', btn.textContent === COMPARE_METRICS[key].label));
  document.getElementById('compare-rows').innerHTML = buildCompareRows(currentSnapshot.branches);
}
