/**
 * ════════════════════════════════════════════════════════════════════
 * 🧭 Contextual Onboarding — محرّك عام + سجلّ تصريحي
 * ════════════════════════════════════════════════════════════════════
 *
 * بنية تحتية، لا ميزة. المحرّك **لا يعرف شيئًا** عن المساحات أو البازارات
 * أو الإعلانات — كل معرفة بالمنتج تعيش في السجلّ (OB_CUES) وفي مزوّد
 * السياق الذي تمرّره الصفحة. لذلك:
 *
 *   ➕ إضافة إرشاد جديد = كائن واحد في السجلّ. المحرّك لا يُمَسّ إطلاقًا.
 *
 * الفلسفة: الإرشاد لا يظهر لأنه جديد، بل لأن المستخدم أمام قرار لا يملك
 * معلومته الآن — ثم يختفي. أي تلميح لا يمكن ربطه بقرار محدَّد في تلك
 * الشاشة لا مكان له هنا.
 *
 * حمّلها بـ <script src="/shared/onboarding.js"></script> بعد shared/i18n.js.
 *
 * ── الاستخدام ──
 *   OB.init({
 *     page: 'spaces',                       // السطح الحالي
 *     getContext: () => ({ caps, counts }), // مزوّد السياق (تملكه الصفحة)
 *     userId: currentUser?.id || null,
 *     t: (k, o) => t(k, o),                 // مترجم الصفحة
 *   });
 *   OB.refresh();   // بعد أي تغيّر في الحالة (نشر مساحة، إرسال طلب…)
 *
 * ── تعاقد الـ cue ──
 *   id           string    ثابت — مفتاح التخزين، لا يتغيّر بعد الإطلاق
 *   page         string    السطح الذي يظهر فيه
 *   form         'popover' | 'card'
 *   anchor       string    محدّد CSS للعنصر المُشار إليه (popover فقط)
 *   mount        string    محدّد الحاوية التي تُحقن فيها البطاقة (card فقط)
 *   priority     number    الأصغر يفوز — واحد فقط يظهر في اللحظة
 *   i18n         string    مفتاح الترجمة: <i18n>.title و<i18n>.body
 *   when(ctx)    bool      شرط الظهور (الدور + الحالة)
 *   retiredWhen(ctx) bool  تقاعُد بشرط بيانات — **بلا أي تخزين** (مفضَّل)
 *   once         bool      لو true: يُخزَّن كمرئي بمجرّد عرضه (بلا إشارة بيانات)
 */

(function (global) {
  'use strict';

  var KEY_PREFIX   = 'msp_ob_';
  /* سقف الجلسة يحسب **التلميحات غير المُتفاعَل معها فقط**. تلميح نفّذ
     المستخدم ما يشرحه لا يُحتسب: النظام حينها يرافقه في مسار يتقدّم فيه
     فعلًا، لا يلاحقه. الغرض من السقف منع الإلحاح، لا قطع إرشاد ناجح. */
  var MAX_UNUSED_PER_SESSION = 2;
  var MUTE_AFTER_DISMISSALS = 2; // تجاهل متتاليان ⟵ صمت دائم
  var SCROLL_DISMISS_PX = 220;   // تمرير واضح = المستخدم تجاوز الأمر
  var SHOW_DELAY_MS = 700;       // يترك الصفحة تستقر قبل أي تلميح

  var _cues       = [];
  var _cfg        = null;
  var _activeEl    = null;
  var _activeCue   = null;
  var _unusedCount = 0;   // تلميحات عُرِضت ولم يتفاعل معها المستخدم
  var _bound      = false;
  var _scrollY0   = 0;

  /* ── الحالة (localStorage، مرتبطة بالمستخدم) ─────────────────────
     قرار متعمَّد: لا عمود في القاعدة. سابقة مباشرة في هذا المستودع —
     profiles.preferred_locale كُتب له ترحيل ولم يُطبَّق قط فصار setLocale
     يفشل صامتًا. إرشاد يتكرّر على جهاز ثانٍ إزعاج طفيف؛ ترحيل غير مطبَّق
     تعطّل صامت كامل. المزامنة السحابية وصلة مفتوحة أدناه (sync). */
  function _key() { return KEY_PREFIX + ((_cfg && _cfg.userId) || 'guest'); }

  function _state() {
    try {
      var raw = localStorage.getItem(_key());
      var s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== 'object') s = {};
      if (!s.seen || typeof s.seen !== 'object') s.seen = {};
      s.dismissStreak = Number(s.dismissStreak) || 0;
      s.muted = !!s.muted;
      return s;
    } catch (_) { return { seen: {}, dismissStreak: 0, muted: false }; }
  }

  function _save(s) {
    try { localStorage.setItem(_key(), JSON.stringify(s)); } catch (_) { /* محجوب — تجاهل */ }
  }

  /** ترحيل حالة الزائر لمفتاح المستخدم عند أول دخول — فلا يُعاد ما رآه */
  function _migrateGuest(userId) {
    if (!userId) return;
    try {
      var g = localStorage.getItem(KEY_PREFIX + 'guest');
      if (!g) return;
      var target = KEY_PREFIX + userId;
      if (!localStorage.getItem(target)) localStorage.setItem(target, g);
      localStorage.removeItem(KEY_PREFIX + 'guest');
    } catch (_) { /* تجاهل */ }
  }

  /* ── التموضع: واعٍ بالنافذة، لا يغطّي هدفه أبدًا ──────────────────
     مستخرَج مرّة واحدة هنا. (التولتيبان القائمان في bazaars/app.js
     يحملان نسختيهما الخاصتين ولم يُعادا تركيبًا عمدًا — ذلك refactor
     مؤجَّل حتى تتوفّر بيانات استخدام؛ الجديد لا يصنع نسخة ثالثة.) */
  function _anchorTo(el, target) {
    var GAP = 10, EDGE = 10;
    var r  = target.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;

    el.classList.remove('obc-below', 'obc-above');
    var w = el.offsetWidth, h = el.offsetHeight;

    var spaceBelow = vh - r.bottom;
    var below = spaceBelow >= h + GAP + EDGE || spaceBelow >= r.top;
    el.classList.add(below ? 'obc-below' : 'obc-above');

    var top  = below ? r.bottom + GAP : r.top - h - GAP;
    var left = r.left + r.width / 2 - w / 2;
    var wanted = left;
    if (left < EDGE) left = EDGE;
    else if (left + w > vw - EDGE) left = vw - w - EDGE;

    el.style.top  = Math.max(EDGE, top) + 'px';
    el.style.left = left + 'px';

    // السهم يتبع الهدف عند إزاحة الصندوق أفقيًا
    var shift = wanted - left;
    var arrowPct = 50 + (shift / w) * 100;
    el.style.setProperty('--obc-arrow', Math.min(88, Math.max(12, arrowPct)) + '%');
  }

  /* ── العرض ─────────────────────────────────────────────────────── */
  function _tr(k, o) {
    if (_cfg && typeof _cfg.t === 'function') {
      var v = _cfg.t(k, o);
      if (v && v !== k) return v;
    }
    return '';
  }

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function _close(reason) {
    if (!_activeEl) return;
    var cue = _activeCue;
    _activeEl.classList.add('obc-out');
    var el = _activeEl;
    setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 160);
    _activeEl = null; _activeCue = null;

    if (!cue) return;
    var s = _state();
    if (cue.once || reason === 'dismiss' || reason === 'act') s.seen[cue.id] = Date.now();

    /* مفتاح الصمت الذكي: من يغلق تلميحين متتاليين بلا تفاعل فَهِم بالفعل —
       احترام ذلك جزء من التصميم لا استثناء منه. */
    if (reason === 'dismiss') {
      s.dismissStreak = (s.dismissStreak || 0) + 1;
      if (s.dismissStreak >= MUTE_AFTER_DISMISSALS) s.muted = true;
    } else if (reason === 'act') {
      s.dismissStreak = 0;
      _unusedCount = Math.max(0, _unusedCount - 1);  // أثبت نفعه — لا يُحتسب
    }
    _save(s);
  }

  function _bindGlobal() {
    if (_bound) return;
    _bound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _activeEl) _close('dismiss');
    });
    window.addEventListener('scroll', function () {
      if (!_activeEl) return;
      if (Math.abs(window.scrollY - _scrollY0) > SCROLL_DISMISS_PX) _close('dismiss');
      else if (_activeCue && _activeCue.form === 'popover') _reposition();
    }, { passive: true });
    window.addEventListener('resize', function () {
      if (_activeCue && _activeCue.form === 'popover') _reposition();
    }, { passive: true });
    document.addEventListener('click', function (e) {
      if (!_activeEl) return;
      if (_activeEl.contains(e.target)) return;
      _close('dismiss');
    }, true);
  }

  function _reposition() {
    if (!_activeEl || !_activeCue || !_activeCue.anchor) return;
    var target = document.querySelector(_activeCue.anchor);
    if (!target) { _close('dismiss'); return; }
    _anchorTo(_activeEl, target);
  }

  /* i18n قد يكون نصًا أو دالة (ctx)=>key — فرسالة تختلف حسب الحالة (مساحة
     بروكر مقابل مساحة مالك مثلًا) تبقى قرار السجلّ لا المحرّك. */
  function _build(cue, ctx) {
    var base = (typeof cue.i18n === 'function') ? cue.i18n(ctx || {}) : cue.i18n;
    if (!base) return null;
    var params = {};
    try { params = (cue.i18nParams && cue.i18nParams(ctx || {})) || {}; } catch (_) { params = {}; }

    var title = _tr(base + '.title', params);
    var body  = _tr(base + '.body',  params);
    if (!title && !body) return null;   // لا نعرض مفاتيح خام أبدًا

    var el = document.createElement('div');
    el.className = 'obc obc-' + cue.form;
    el.setAttribute('role', 'status');
    el.setAttribute('dir', document.documentElement.getAttribute('dir') || 'rtl');
    el.innerHTML =
      '<button class="obc-x" type="button" aria-label="' + _esc(_tr('onboarding.dismiss') || 'إغلاق') + '">&times;</button>' +
      (title ? '<div class="obc-title">' + _esc(title) + '</div>' : '') +
      (body  ? '<div class="obc-body">'  + _esc(body)  + '</div>' : '');

    el.querySelector('.obc-x').addEventListener('click', function (e) {
      e.stopPropagation(); _close('dismiss');
    });
    return el;
  }

  function _ctx() {
    try { return (_cfg && _cfg.getContext && _cfg.getContext()) || {}; }
    catch (_) { return {}; }
  }

  function _show(cue, ctx) {
    var el = _build(cue, ctx || _ctx());
    if (!el) return false;

    if (cue.form === 'popover') {
      var target = document.querySelector(cue.anchor);
      if (!target || !target.offsetParent) return false;   // هدف غير مرئي = لا تلميح
      document.body.appendChild(el);
      _activeEl = el; _activeCue = cue;
      _anchorTo(el, target);
      /* الهدف يُعلَّم لا يُحجَب — لا overlay ولا تعتيم ولا التقاط للنقر */
      target.classList.add('obc-target');
      var clear = function () { target.classList.remove('obc-target'); };
      setTimeout(clear, 6000);
      target.addEventListener('click', function onAct() {
        target.removeEventListener('click', onAct);
        clear();
        if (_activeCue === cue) _close('act');
      });
    } else {
      var mount = document.querySelector(cue.mount);
      if (!mount) return false;
      mount.insertBefore(el, mount.firstChild);
      _activeEl = el; _activeCue = cue;
    }

    _scrollY0 = window.scrollY || 0;
    _unusedCount++;                 // يُخصم في _close عند التفاعل
    requestAnimationFrame(function () { el.classList.add('obc-in'); });
    setTimeout(function () { el.classList.add('obc-in'); }, 30);  // شبكة أمان لو rAF مؤجَّل
    return true;
  }

  /* ── الاختيار: تلميح واحد فقط، بالأولوية ────────────────────────── */
  function _resolve() {
    if (!_cfg || _activeEl) return null;
    if (_unusedCount >= MAX_UNUSED_PER_SESSION) return null;

    var s = _state();
    if (s.muted) return null;

    var ctx = _ctx();
    var pool = _cues.filter(function (c) {
      if (c.page !== _cfg.page) return false;
      /* تلميحات اللحظة (manual) تُطلَق بحدث صريح عبر trigger() فقط —
         لا يجوز أن يلتقطها الاختيار التلقائي، وإلا ظهرت «وصل طلبك» عند
         فتح الصفحة قبل أن يُرسل المستخدم شيئًا. */
      if (c.manual) return false;
      if (s.seen[c.id]) return false;
      try {
        if (c.retiredWhen && c.retiredWhen(ctx)) return false;
        return !c.when || c.when(ctx);
      } catch (_) { return false; }     // شرط معطوب لا يكسر الصفحة
    });
    if (!pool.length) return null;
    pool.sort(function (a, b) { return (a.priority || 50) - (b.priority || 50); });
    return pool[0];
  }

  /* لو نفّذ المستخدم ما يشرحه التلميح المعروض الآن، فالتلميح صار ضجيجًا —
     يُغلق فورًا (ويُحتسب «تفاعلًا» لا تجاهلًا) ليفسح المجال لما بعده. */
  function _retireActiveIfDone() {
    if (!_activeCue || !_activeCue.retiredWhen) return;
    var done = false;
    try { done = !!_activeCue.retiredWhen(_ctx()); } catch (_) { done = false; }
    if (done) _close('act');
  }

  var _pending = null;
  function _tick() {
    _retireActiveIfDone();
    if (_pending) { clearTimeout(_pending); _pending = null; }
    _pending = setTimeout(function () {
      _pending = null;
      var cue = _resolve();
      if (cue) _show(cue);
    }, SHOW_DELAY_MS);
  }

  /* ── الواجهة العامة ─────────────────────────────────────────────── */
  var OB = {
    /** يسجّل تلميحًا (أو مصفوفة) — النقطة الوحيدة للتوسّع */
    register: function (cue) {
      if (Array.isArray(cue)) { cue.forEach(OB.register); return OB; }
      if (!cue || !cue.id || !cue.page) return OB;
      if (_cues.some(function (c) { return c.id === cue.id; })) return OB;
      _cues.push(cue);
      return OB;
    },

    init: function (cfg) {
      _cfg = cfg || {};
      _migrateGuest(_cfg.userId);
      _bindGlobal();
      _tick();
      return OB;
    },

    /** يُستدعى بعد أي تغيّر حالة (نشر مساحة، إرسال طلب، منح صلاحية) */
    refresh: function (patch) {
      if (!_cfg) return OB;
      if (patch && typeof patch === 'object') {
        Object.keys(patch).forEach(function (k) { _cfg[k] = patch[k]; });
        if (patch.userId) _migrateGuest(patch.userId);
      }
      _tick();
      return OB;
    },

    /** يفرض عرض تلميح بعينه فورًا (لحظة حدث: إرسال طلب مثلًا) */
    trigger: function (id) {
      if (!_cfg) return OB;
      var s = _state();
      if (s.muted || s.seen[id]) return OB;
      var cue = _cues.filter(function (c) { return c.id === id; })[0];
      if (!cue || _activeEl) return OB;
      var ctx = _ctx();
      try { if (cue.when && !cue.when(ctx)) return OB; } catch (_) { return OB; }
      _show(cue, ctx);
      return OB;
    },

    close: function () { _close('dismiss'); return OB; },

    /** وصلة مزامنة سحابية — تُملأ لاحقًا إن ثبتت الحاجة، بلا تغيير في المستدعين */
    sync: function () { return Promise.resolve(); },

    /** للاختبار فقط */
    _reset: function () { try { localStorage.removeItem(_key()); } catch (_) {} _unusedCount = 0; return OB; },
    _state: _state,
  };

  global.OB = OB;
})(window);
