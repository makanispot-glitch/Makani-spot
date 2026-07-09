/* ================================================================
   📱 pwa-install.js — دعوة ذكية لتثبيت تطبيق مكاني Spot (PWA)
   ================================================================
   سكريبت مستقل تمامًا — سطر واحد <script src="/pwa-install.js" defer>
   في أي صفحة. لا يعتمد على أي بنية HTML موجودة (ناف بار مختلف الشكل
   في كل صفحة)، يبني واجهته العائمة الخاصة بنفسه.

   المنطق:
   • Android/Chromium: يلتقط beforeinstallprompt ويعرض بانر مخصص
     بدل نافذة المتصفح الافتراضية.
   • iOS/Safari: لا يدعم أي API برمجي للتثبيت — بدلاً من ذلك، يعرض
     نفس البانر، وزر "تثبيت" يفتح نافذة تعليمات مصورة (Share ← Add to
     Home Screen ← Add).
   • البانر يظهر مرة واحدة لكل "دورة" (أول شرط يتحقق: تسجيل دخول/نجاح
     عملية مهمة/دقيقة استخدام)، وبعدها يبقى زر دائري صغير عائم متاحًا
     دائمًا لمن يريد التثبيت لاحقًا. بعد فترة تهدئة طويلة بلا أي إشارة
     تثبيت فعلي، يُعاد تفعيل البانر تلقائيًا (احتمال أن المستخدم حذف
     التطبيق وقد يفيده التذكير) — بحد أقصى مرات، وما لم يكن قد اختار
     "لا تُظهر مرة أخرى" صراحة على iOS.
   ================================================================ */
(function () {
  'use strict';

  /* ── الإعدادات — كل القيم القابلة للتعديل في مكان واحد ── */
  var PWA_CONFIG = {
    storageKey: 'mkspot_pwa_install_v1',
    triggers: {
      timerEnabled:        true,
      timerDelayMs:        60000,       // بعد دقيقة استخدام
      authSignInEnabled:   true,
      authSignInEventName: 'SIGNED_IN',
      externalSignalEnabled: true,       // window.mkPwaInstall.signalSuccess()
    },
    rearm: {
      cooldownDays:            90,   // بلا أي إشارة تثبيت فعلي (Android)
      cooldownDaysIfInstalled: 180,  // لو رصدنا appinstalled فعليًا — انتظار أطول لاحتمال ما زال مثبَّتًا
      maxRearms:               2,    // حد أقصى لعدد مرات إعادة الظهور (أي 3 مرات إجمالاً مدى الحياة)
    },
    layout: {
      bottomNavHeight:  64,   // ارتفاع .bottom-nav الثابت أسفل الصفحة
      gapAboveBottomNav: 12,
      bannerZIndex:     600,
      pillZIndex:       600,
      iosOverlayZIndex: 700,
      pillLeftOffset:   16,
      pillSize:         46,
      iosOverlayPadding:      20,
      iosModalMaxWidth:       340,
      iosModalPadding:        '26px 22px 22px',
      iosModalIconSize:       64,
      iosModalIconRadius:     16,
      iosModalIconMarginBottom: 14,
      mobileBreakpoint:       380,
    },
    theme: {
      fontFamily:         'Cairo,sans-serif',
      brandOrange:        '#F36418',
      brandOrangeRgba60:  'rgba(243,100,24,.6)',
      brandOrangeRgba45:  'rgba(243,100,24,.45)',
      darkBg:             '#1a1a2e',
      textOnDark:         '#fff',
      subTextOnDark:      '#b8b8cc',
      closeIconColor:     '#6b6b8a',
      overlayBg:          'rgba(14,18,24,.65)',
      modalBg:            '#fff',
      stepBg:             '#f7f7f9',
      stepTextColor:      '#333',
      neverAgainColor:    '#888',
    },
    copy: {
      bannerIcon:          '📱',
      bannerTitle:         'ثبّت تطبيق مكاني Spot',
      bannerSubtitle:      'وصول أسرع وتجربة أفضل على هاتفك',
      bannerInstallLabel:  'تثبيت',
      bannerCloseAriaLabel: 'إغلاق',
      bannerCloseGlyph:    '✕',
      pillAriaLabel:       'تثبيت التطبيق',
      pillGlyph:           '⬇️',
      iosIconSrc:          '/icons/icon-192.png',
      iosIconAlt:          'مكاني Spot',
      iosTitle:            'ثبّت التطبيق على آيفون',
      iosSteps: [
        { icon: '📤', text: 'اضغط زر المشاركة (Share) في المتصفح' },
        { icon: '➕', text: 'اختر "Add to Home Screen"' },
        { icon: '✅', text: 'اضغط "Add" — هتظهر أيقونة مكاني Spot على شاشتك الرئيسية' },
      ],
      iosOkLabel:          'فهمت',
      iosNeverAgainLabel:  'لا تُظهر هذه الرسالة مرة أخرى',
    },
  };

  /* ── 0. خروج مبكر: مثبَّت بالفعل، أو ليس جهازًا محمولًا ── */
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;
  if (isStandalone) return;

  var ua = navigator.userAgent || '';
  var isIOS = (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS 13+
  var isAndroid = /Android/i.test(ua);
  if (!isIOS && !isAndroid) return;

  /* ── 1. الحالة المحفوظة ── */
  function loadState() {
    try {
      var raw = localStorage.getItem(PWA_CONFIG.storageKey);
      var parsed = raw ? JSON.parse(raw) : null;
      return {
        bannerShown:   !!(parsed && parsed.bannerShown),
        bannerShownAt: (parsed && parsed.bannerShownAt) || null,
        installedAt:   (parsed && parsed.installedAt) || null,
        rearmCount:    (parsed && parsed.rearmCount) || 0,
        iosModalSeen:  !!(parsed && parsed.iosModalSeen),
      };
    } catch (e) {
      return { bannerShown: false, bannerShownAt: null, installedAt: null, rearmCount: 0, iosModalSeen: false };
    }
  }
  function saveState() {
    try { localStorage.setItem(PWA_CONFIG.storageKey, JSON.stringify(state)); } catch (e) {}
  }
  var state = loadState();

  /* إعادة تفعيل البانر بعد فترة تهدئة طويلة — لا توجد وسيلة موثوقة لمعرفة
     أن المستخدم حذف التطبيق فعليًا، فنفترض هذا الاحتمال بعد مرور وقت طويل
     بلا أي إشارة تثبيت جديدة (بحد أقصى مرات محدود حتى لا يتحول لإزعاج).
     "iosModalSeen" يبقى رفضًا صريحًا ودائمًا يتجاوز أي إعادة تفعيل. */
  function maybeRearm() {
    if (!state.bannerShown) return;
    if (isIOS && state.iosModalSeen) return;
    if ((state.rearmCount || 0) >= PWA_CONFIG.rearm.maxRearms) return;
    var cooldownDays = state.installedAt
      ? PWA_CONFIG.rearm.cooldownDaysIfInstalled
      : PWA_CONFIG.rearm.cooldownDays;
    var elapsedDays = (Date.now() - (state.bannerShownAt || 0)) / 86400000;
    if (elapsedDays >= cooldownDays) {
      state.bannerShown = false;
      state.rearmCount = (state.rearmCount || 0) + 1;
      saveState();
    }
  }
  maybeRearm();

  var deferredPrompt  = null;
  var engagementMet   = false;
  var bannerEl        = null;
  var pillEl          = null;

  /* ── 2. أحداث المتصفح ── */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    maybeShow();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    removeBanner();
    removePill();
    state.bannerShown = true;
    state.installedAt = Date.now();
    saveState();
  });

  /* ── 3. شروط الظهور (OR) ── */
  function triggerEngagement() {
    if (engagementMet) return;
    engagementMet = true;
    maybeShow();
  }

  if (PWA_CONFIG.triggers.timerEnabled) {
    setTimeout(triggerEngagement, PWA_CONFIG.triggers.timerDelayMs);
  }

  if (PWA_CONFIG.triggers.authSignInEnabled) {
    try {
      if (typeof supabase !== 'undefined' &&
          typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_KEY !== 'undefined') {
        var _pwaSb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        _pwaSb.auth.onAuthStateChange(function (event) {
          if (event === PWA_CONFIG.triggers.authSignInEventName) triggerEngagement();
        });
      }
    } catch (e) { /* لا حرج — باقي الشروط تكفي */ }
  }

  /* API عام: تستدعيه صفحات أخرى بعد نجاح عملية مهمة (نشر إعلان/حجز) */
  window.mkPwaInstall = window.mkPwaInstall || {};
  window.mkPwaInstall.signalSuccess = PWA_CONFIG.triggers.externalSignalEnabled
    ? triggerEngagement
    : function () {};

  /* ── 4. قرار العرض ── */
  function maybeShow() {
    if (isIOS && state.iosModalSeen) return; // اختار "لا تُظهر مرة أخرى"
    if (state.bannerShown) { showPill(); return; }
    if (!engagementMet) return;
    if (isIOS || deferredPrompt) showBanner();
  }

  /* لو البانر ظهر من قبل (جلسة سابقة) ولم تحن إعادة التفعيل بعد، أظهر الزر الدائم فورًا */
  if (state.bannerShown && !(isIOS && state.iosModalSeen)) {
    showPill();
  }

  /* ── 5. الواجهة ── */
  function injectStyles() {
    if (document.getElementById('mk-pwa-style')) return;
    var L = PWA_CONFIG.layout;
    var T = PWA_CONFIG.theme;
    var bottomOffset = 'calc(' + L.bottomNavHeight + 'px + env(safe-area-inset-bottom,0px) + ' + L.gapAboveBottomNav + 'px)';
    var css =
      '#mk-pwa-banner{position:fixed;left:50%;transform:translateX(-50%);' +
      'bottom:' + bottomOffset + ';z-index:' + L.bannerZIndex + ';' +
      'background:' + T.darkBg + ';border:1.5px solid ' + T.brandOrangeRgba60 + ';border-radius:16px;' +
      'padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,.5);display:flex;' +
      'align-items:center;gap:12px;max-width:calc(100vw - 24px);' +
      'font-family:' + T.fontFamily + ';direction:rtl}' +
      '#mk-pwa-banner .mk-pwa-icon{font-size:26px;flex-shrink:0}' +
      '#mk-pwa-banner .mk-pwa-text{flex:1;min-width:0}' +
      '#mk-pwa-banner .mk-pwa-title{color:' + T.textOnDark + ';font-size:13.5px;font-weight:800;margin-bottom:2px}' +
      '#mk-pwa-banner .mk-pwa-sub{color:' + T.subTextOnDark + ';font-size:11.5px}' +
      '#mk-pwa-banner .mk-pwa-install-btn{background:' + T.brandOrange + ';color:#fff;border:none;' +
      'border-radius:10px;padding:9px 16px;font-family:' + T.fontFamily + ';font-size:12.5px;' +
      'font-weight:800;cursor:pointer;white-space:nowrap;flex-shrink:0}' +
      '#mk-pwa-banner .mk-pwa-close{background:transparent;border:none;color:' + T.closeIconColor + ';' +
      'font-size:18px;cursor:pointer;padding:2px 4px;flex-shrink:0;line-height:1}' +
      '#mk-pwa-pill{position:fixed;left:' + L.pillLeftOffset + 'px;' +
      'bottom:' + bottomOffset + ';z-index:' + L.pillZIndex + ';' +
      'width:' + L.pillSize + 'px;height:' + L.pillSize + 'px;min-height:' + L.pillSize + 'px;border-radius:50%;' +
      'background:' + T.brandOrange + ';color:#fff;border:none;box-shadow:0 4px 18px ' + T.brandOrangeRgba45 + ';' +
      'font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}' +
      '#mk-pwa-ios-overlay{position:fixed;inset:0;z-index:' + L.iosOverlayZIndex + ';background:' + T.overlayBg + ';' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;' +
      'align-items:center;justify-content:center;padding:' + L.iosOverlayPadding + 'px}' +
      '#mk-pwa-ios-modal{background:' + T.modalBg + ';border-radius:20px;max-width:' + L.iosModalMaxWidth + 'px;width:100%;' +
      'padding:' + L.iosModalPadding + ';text-align:center;font-family:' + T.fontFamily + ';direction:rtl}' +
      '#mk-pwa-ios-modal img{width:' + L.iosModalIconSize + 'px;height:' + L.iosModalIconSize + 'px;' +
      'border-radius:' + L.iosModalIconRadius + 'px;margin-bottom:' + L.iosModalIconMarginBottom + 'px}' +
      '#mk-pwa-ios-modal h3{font-size:17px;font-weight:900;color:' + T.darkBg + ';margin:0 0 16px}' +
      '#mk-pwa-ios-modal .mk-pwa-step{display:flex;align-items:center;gap:12px;' +
      'text-align:right;margin-bottom:10px;padding:10px 12px;background:' + T.stepBg + ';border-radius:12px}' +
      '#mk-pwa-ios-modal .mk-pwa-step-num{width:26px;height:26px;min-height:26px;border-radius:50%;' +
      'background:' + T.brandOrange + ';color:#fff;font-size:13px;font-weight:800;display:flex;' +
      'align-items:center;justify-content:center;flex-shrink:0}' +
      '#mk-pwa-ios-modal .mk-pwa-step-icon{font-size:20px;flex-shrink:0}' +
      '#mk-pwa-ios-modal .mk-pwa-step-text{font-size:13px;color:' + T.stepTextColor + ';flex:1;line-height:1.4}' +
      '#mk-pwa-ios-modal .mk-pwa-ok-btn{width:100%;background:' + T.brandOrange + ';color:#fff;border:none;' +
      'border-radius:12px;padding:12px;font-family:' + T.fontFamily + ';font-size:14px;' +
      'font-weight:800;cursor:pointer;margin-top:8px}' +
      '#mk-pwa-ios-modal .mk-pwa-never{margin-top:12px;font-size:12px;color:' + T.neverAgainColor + ';' +
      'display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;user-select:none}' +
      '@media(max-width:' + L.mobileBreakpoint + 'px){#mk-pwa-banner{padding:11px 13px;gap:9px}' +
      '#mk-pwa-banner .mk-pwa-title{font-size:12.5px}#mk-pwa-banner .mk-pwa-sub{display:none}}';
    var style = document.createElement('style');
    style.id = 'mk-pwa-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showBanner() {
    if (bannerEl || state.bannerShown) return;
    injectStyles();
    state.bannerShown = true;
    state.bannerShownAt = Date.now();
    saveState();
    var C = PWA_CONFIG.copy;
    bannerEl = document.createElement('div');
    bannerEl.id = 'mk-pwa-banner';
    bannerEl.innerHTML =
      '<span class="mk-pwa-icon">' + C.bannerIcon + '</span>' +
      '<div class="mk-pwa-text">' +
        '<div class="mk-pwa-title">' + C.bannerTitle + '</div>' +
        '<div class="mk-pwa-sub">' + C.bannerSubtitle + '</div>' +
      '</div>' +
      '<button type="button" class="mk-pwa-install-btn">' + C.bannerInstallLabel + '</button>' +
      '<button type="button" class="mk-pwa-close" aria-label="' + C.bannerCloseAriaLabel + '">' + C.bannerCloseGlyph + '</button>';
    document.body.appendChild(bannerEl);
    bannerEl.querySelector('.mk-pwa-install-btn').addEventListener('click', handleInstallClick);
    bannerEl.querySelector('.mk-pwa-close').addEventListener('click', function () {
      removeBanner();
      showPill();
    });
  }

  function removeBanner() {
    if (bannerEl) { bannerEl.remove(); bannerEl = null; }
  }

  function showPill() {
    if (pillEl || document.getElementById('mk-pwa-pill')) return;
    injectStyles();
    var C = PWA_CONFIG.copy;
    pillEl = document.createElement('button');
    pillEl.id = 'mk-pwa-pill';
    pillEl.type = 'button';
    pillEl.setAttribute('aria-label', C.pillAriaLabel);
    pillEl.textContent = C.pillGlyph;
    pillEl.addEventListener('click', handleInstallClick);
    document.body.appendChild(pillEl);
  }

  function removePill() {
    if (pillEl) { pillEl.remove(); pillEl = null; }
  }

  function handleInstallClick() {
    if (isIOS) {
      removeBanner();
      if (!state.iosModalSeen) openIOSModal();
      else showPill();
      return;
    }
    if (!deferredPrompt) return;
    removeBanner();
    var promptEvent = deferredPrompt;
    deferredPrompt = null;
    promptEvent.prompt();
    promptEvent.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') {
        removePill();
      } else {
        showPill();
      }
    }).catch(function () { showPill(); });
  }

  function openIOSModal() {
    if (document.getElementById('mk-pwa-ios-overlay')) return;
    injectStyles();
    var C = PWA_CONFIG.copy;
    var stepsHtml = C.iosSteps.map(function (s, i) {
      return '<div class="mk-pwa-step"><span class="mk-pwa-step-num">' + (i + 1) + '</span>' +
        '<span class="mk-pwa-step-icon">' + s.icon + '</span>' +
        '<span class="mk-pwa-step-text">' + s.text + '</span></div>';
    }).join('');
    var overlay = document.createElement('div');
    overlay.id = 'mk-pwa-ios-overlay';
    overlay.innerHTML =
      '<div id="mk-pwa-ios-modal">' +
        '<img src="' + C.iosIconSrc + '" alt="' + C.iosIconAlt + '">' +
        '<h3>' + C.iosTitle + '</h3>' +
        stepsHtml +
        '<button type="button" class="mk-pwa-ok-btn">' + C.iosOkLabel + '</button>' +
        '<label class="mk-pwa-never"><input type="checkbox" id="mk-pwa-never-chk"> ' + C.iosNeverAgainLabel + '</label>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeIOSModal();
    });
    overlay.querySelector('.mk-pwa-ok-btn').addEventListener('click', function () {
      if (document.getElementById('mk-pwa-never-chk').checked) {
        state.iosModalSeen = true;
        saveState();
        removePill();
      }
      closeIOSModal();
    });
  }

  function closeIOSModal() {
    var overlay = document.getElementById('mk-pwa-ios-overlay');
    if (overlay) overlay.remove();
  }
})();
