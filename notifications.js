/* ================================================================
   🔔  GLOBAL NOTIFICATIONS — v2.1
   نظام إشعارات موحّد لجميع صفحات المنصة
   جدول: notifications (user_id)
   يُحمَّل في: spaces / bazaars / market / dashboard
   ================================================================ */

(function (global) {
  'use strict';

  let _sb      = null;   // Supabase client
  let _uid     = null;   // user_id (string)
  let _notifs  = [];     // النسخة المخبّأة من الإشعارات
  let _count   = 0;      // عدد غير المقروءة
  let _bellEl  = null;   // العنصر الذي فتح البانل (لحساب outside-click)
  let _channel = null;   // Supabase Realtime channel

  /* ── أيقونات حسب source أو type ── */
  const _ICO = {
    bazaar:          '🎪',
    marketplace:     '🏷️',
    spaces:          '📍',
    booking:         '📬',
    payment:         '💰',
    system:          '📢',
    admin:           '🔔',
    space_submitted: '📋',
    space_approved:  '✅',
    space_published: '🚀',
    space_rejected:  '❌',
    bazaar_approved: '🎉',
    bazaar_submitted:'🎪',
    new_booking:     '📬',
    booking_request: '📬',
    waitlist_request:'⏳',
    bazaar_cancelled:'🚫',
    bazaar_postponed:'📅',
    slot_reserved:   '🔒',
    general:         '📢',
    ad_approved:     '✅',
    owner_approved:  '✅',
    plan_changed:    '💎',
    booking_cancelled:'🚫',
  };

  /* ═══════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════ */

  /* init(sb, uid) — يُهيّئ الوحدة بعد تسجيل الدخول
     RACE CONDITION GUARD: لو نفس المستخدم → لا نعيد التهيئة */
  async function init(sb, uid) {
    var uidStr = String(uid);
    if (_sb && _uid === uidStr) return;          /* نفس المستخدم — لا شيء */
    if (_channel) _unsubscribe();                /* مستخدم مختلف — أغلق القديم */

    _sb  = sb;
    _uid = uidStr;
    await _load();
    _subscribe();
  }

  /* mount(containerEl | containerId) — يُضيف جرس الإشعارات قبل الـ avatar btn
     DOUBLE-INJECT GUARD: يُزيل الجرس القديم أولاً */
  function mount(container) {
    var cont = typeof container === 'string'
      ? document.getElementById(container)
      : container;
    if (!cont) return;

    /* أزل أي جرس موجود مسبقاً — يمنع ظهور جرسين */
    cont.querySelector('#gn-bell')?.remove();

    var bell = document.createElement('div');
    bell.id        = 'gn-bell';
    bell.className = 'gn-bell';
    bell.setAttribute('role', 'button');
    bell.setAttribute('aria-label', 'الإشعارات');
    bell.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      '     stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' +
      '     width="20" height="20" aria-hidden="true">' +
      '  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>' +
      '  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>' +
      '</svg>' +
      '<span id="gn-badge" class="gn-badge"></span>';
    bell.addEventListener('click', toggle);

    /* أدخل الجرس قبل الـ avatar btn مباشرة، أو قبل أول عنصر */
    var avatarBtn = cont.querySelector(
      '.nav-avatar-btn, #eq-avatar-btn, #bz-avatar-btn, #nav-avatar-btn, .bz-nav-user-wrap'
    );
    cont.insertBefore(bell, avatarBtn || cont.firstChild);

    _syncBadge();
  }

  /* toggle(e) — يُفتح / يُغلق البانل — يُستدعى من onclick */
  function toggle(e) {
    if (e) {
      e.stopPropagation();
      _bellEl = e.currentTarget || e.target;
    }
    _panelOpen() ? _closePanel() : _openPanel();
  }

  /* destroy() — تنظيف كامل عند تسجيل الخروج
     يُزيل: الجرس + البانل + Realtime channel + كل listeners + الذاكرة */
  function destroy() {
    document.getElementById('gn-bell')?.remove();
    _closePanel();
    _unsubscribe();
    _sb = _uid = _bellEl = null;
    _notifs = [];
    _count  = 0;
  }

  /* markAll() — يُعلّم جميع الإشعارات كمقروءة + يُحدّث الـ UI فوراً */
  async function markAll() {
    if (!_sb || !_uid) return;
    var ids = _notifs.filter(function (n) { return !n.is_read; }).map(function (n) { return n.id; });
    if (!ids.length) return;
    try {
      await _sb.from('notifications')
        .update({ is_read: true })
        .in('id', ids)
        .eq('user_id', _uid);
    } catch (e) { /* صامت */ }
    _notifs = _notifs.map(function (n) { return Object.assign({}, n, { is_read: true }); });
    _count  = 0;
    _syncBadge();
    _renderPanel();
  }

  /* click(notifId, actionUrl) — يُعلّم إشعاراً كمقروء + يُحدّث badge فوراً + ينتقل */
  async function click(notifId, actionUrl) {
    if (!_sb || !_uid) return;
    try {
      await _sb.from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
        .eq('user_id', _uid);
    } catch (e) { /* صامت */ }
    var wasUnread = _notifs.some(function (n) { return n.id === notifId && !n.is_read; });
    _notifs = _notifs.map(function (n) {
      return n.id === notifId ? Object.assign({}, n, { is_read: true }) : n;
    });
    if (wasUnread) _count = Math.max(0, _count - 1);
    _syncBadge();           /* badge يتحدث فوراً بدون reload */
    _closePanel();
    if (actionUrl) window.location.href = actionUrl;
  }

  /* ═══════════════════════════════════════════
     PRIVATE
  ═══════════════════════════════════════════ */

  async function _load() {
    if (!_sb || !_uid) return;
    try {
      /* نعرض: غير مقروءة + مقروءة في آخر 7 أيام */
      var sevenAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      var res = await _sb
        .from('notifications')
        .select('id,title,body,type,source,action_url,is_read,created_at')
        .eq('user_id', _uid)
        .or('is_read.eq.false,created_at.gt.' + sevenAgo)
        .order('created_at', { ascending: false })
        .limit(30);
      _notifs = res.data || [];
      _count  = _notifs.filter(function (n) { return !n.is_read; }).length;
      _syncBadge();
      if (_panelOpen()) _renderPanel();
    } catch (e) { /* صامت — جدول غير جاهز أو خطأ RLS */ }
  }

  /* Realtime subscription — تنبيه فوري عند إضافة إشعار جديد */
  function _subscribe() {
    if (!_sb || !_uid || _channel) return;
    try {
      _channel = _sb
        .channel('gn-' + _uid.slice(0, 8))
        .on('postgres_changes', {
          event:  'INSERT',
          schema: 'public',
          table:  'notifications',
          filter: 'user_id=eq.' + _uid,
        }, function (payload) {
          if (!payload.new) return;
          _notifs.unshift(payload.new);
          _count = _notifs.filter(function (n) { return !n.is_read; }).length;
          _syncBadge();
          if (_panelOpen()) _renderPanel();
        })
        .on('postgres_changes', {
          event:  'UPDATE',
          schema: 'public',
          table:  'notifications',
          filter: 'user_id=eq.' + _uid,
        }, function (payload) {
          if (!payload.new) return;
          _notifs = _notifs.map(function (n) {
            return n.id === payload.new.id
              ? Object.assign({}, n, { is_read: payload.new.is_read })
              : n;
          });
          _count = _notifs.filter(function (n) { return !n.is_read; }).length;
          _syncBadge();
          if (_panelOpen()) _renderPanel();
        })
        .subscribe();
    } catch (e) { _channel = null; }
  }

  function _unsubscribe() {
    if (_channel && _sb) {
      try { _sb.removeChannel(_channel); } catch (e) { /* تجاهل */ }
    }
    _channel = null;
  }

  function _syncBadge() {
    /* جرس GN الخاص (موجود في صفحات spaces / bazaars / market) */
    var badge = document.getElementById('gn-badge');
    if (badge) {
      if (_count > 0) {
        badge.textContent   = _count > 9 ? '9+' : String(_count);
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
    /* تحديث الـ Dashboard — فقط إذا لم تكن updateNotifBadge موجودة
       (Dashboard تديرها بنفسها لأنها تجمع التنبيهات المحلية + Supabase) */
    if (typeof global.updateNotifBadge === 'function') return;

    var nbAlerts = document.getElementById('nb-alerts');
    if (nbAlerts) nbAlerts.textContent = _count > 0 ? String(_count) : '';
    var dbBadge = document.getElementById('notif-badge');
    if (dbBadge) {
      dbBadge.textContent = _count > 0 ? String(_count) : '0';
      if (_count > 0) dbBadge.classList.add('show');
      else            dbBadge.classList.remove('show');
    }
    var dbDot = document.getElementById('notif-dot');
    if (dbDot) dbDot.style.display = _count > 0 ? 'block' : 'none';
  }

  function _openPanel() {
    /* أغلق القوائم المنسدلة الأخرى */
    document.querySelectorAll('.nav-dropdown.open')
      .forEach(function (el) { el.classList.remove('open'); });
    document.querySelectorAll(
      '.nav-avatar-btn.open, #eq-avatar-btn.open, #bz-avatar-btn.open'
    ).forEach(function (el) { el.classList.remove('open'); });

    var panel = document.createElement('div');
    panel.id        = 'gn-panel';
    panel.className = 'gn-panel';
    document.body.appendChild(panel);
    _renderPanel(panel);
    document.addEventListener('click', _outside, true);
  }

  function _closePanel() {
    document.getElementById('gn-panel')?.remove();
    document.removeEventListener('click', _outside, true);
  }

  function _panelOpen() {
    return !!document.getElementById('gn-panel');
  }

  function _outside(e) {
    var panel = document.getElementById('gn-panel');
    if (!panel) return;
    var bell = document.getElementById('gn-bell')
             || document.getElementById('notif-bell');  /* dashboard */
    if (!panel.contains(e.target)
        && !(bell && bell.contains(e.target))
        && !(_bellEl && _bellEl.contains(e.target))) {
      _closePanel();
    }
  }

  function _renderPanel(panelEl) {
    var panel = panelEl || document.getElementById('gn-panel');
    if (!panel) return;

    var items = _notifs.length
      ? _notifs.map(function (n) {
          var ico = _ICO[n.source] || _ICO[n.type] || '🔔';
          var url = n.action_url ? "'" + _esc(n.action_url) + "'" : "''";
          return '<div class="gn-item' + (n.is_read ? '' : ' gn-unread') + '"' +
            ' onclick="GN.click(\'' + n.id + '\',' + url + ')">' +
            '<div class="gn-ico">' + ico + '</div>' +
            '<div class="gn-body">' +
            '<div class="gn-title">' + _esc(n.title) + '</div>' +
            (n.body ? '<div class="gn-msg">' + _esc(n.body) + '</div>' : '') +
            '<div class="gn-time">' + _ago(new Date(n.created_at)) + '</div>' +
            '</div>' +
            (!n.is_read ? '<div class="gn-dot"></div>' : '') +
            '</div>';
        }).join('')
      : '<div class="gn-empty">🔔 لا توجد إشعارات حتى الآن</div>';

    panel.innerHTML =
      '<div class="gn-hd">' +
      '<span>🔔 الإشعارات</span>' +
      (_count > 0
        ? '<button class="gn-mark-btn" onclick="GN.markAll()">تحديد الكل كمقروء</button>'
        : '') +
      '</div>' +
      '<div class="gn-list">' + items + '</div>' +
      '<div class="gn-ft">' +
      '<a href="/?p=dashboard" class="gn-view-all">عرض جميع الإشعارات ←</a>' +
      '</div>';
  }

  /* ── Helpers ── */
  function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _ago(d) {
    var s = Math.round((Date.now() - d) / 1000);
    if (s < 60)        return 'الآن';
    if (s < 3600)      return 'منذ ' + Math.floor(s / 60) + ' د';
    if (s < 86400)     return 'منذ ' + Math.floor(s / 3600) + ' س';
    if (s < 86400 * 7) return 'منذ ' + Math.floor(s / 86400) + ' يوم';
    return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
  }

  /* ── Export ── */
  global.GN = {
    init:    init,
    mount:   mount,
    toggle:  toggle,
    destroy: destroy,
    markAll: markAll,
    click:   click,
  };

})(window);
