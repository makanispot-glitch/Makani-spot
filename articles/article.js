/* ═══════════════════════════════════════════════════════════════
   article.js — سكربت صفحة المقال
   يبقى صغيرًا عمدًا: صفحة المقال ثابتة بالكامل، والمحتوى مقروء
   بلا JavaScript إطلاقًا. هذا الملف يضيف تحسينات فقط.

   ملاحظة: لا نحمّل supabase-js هنا (~40 KB + طلب شبكة) لمجرد معرفة
   حالة الدخول. نقرأ مفتاح الجلسة من localStorage مباشرة — نفس الحيلة
   المستخدمة في index.html:63 لمنع وميض زر الدخول.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── ١) المشاركة: Web Share API مع نسخ الرابط كبديل ── */
  var shareBtn = document.querySelector('.kc-share-btn[data-share-url]');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var url   = shareBtn.getAttribute('data-share-url');
      var title = shareBtn.getAttribute('data-share-title') || document.title;

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () { /* أُلغي — طبيعي */ });
        return;
      }

      var done = function () {
        var original = shareBtn.textContent;
        shareBtn.textContent = 'تم نسخ الرابط ✓';
        shareBtn.classList.add('copied');
        setTimeout(function () {
          shareBtn.textContent = original;
          shareBtn.classList.remove('copied');
        }, 2000);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }

      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { window.prompt('انسخ الرابط:', url); }
        document.body.removeChild(ta);
      }
    });
  }

  /* ── ٢) CTA حسب حالة الدخول (بلا SDK ولا طلب شبكة) ── */
  try {
    var authed = false;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('-auth-token') !== -1 && k.indexOf('sb-') === 0) {
        var v = localStorage.getItem(k);
        if (v && v.length > 20) { authed = true; break; }
      }
    }
    if (authed) {
      var navCta = document.querySelector('.kc-nav-cta');
      /* /?p=dashboard لا /dashboard/ — الأخيرة هي لوحة تحكم أصحاب
         المساحات تحديدًا (راجع <title> في dashboard/index.html)، وكان
         توجيه كل مستخدم مسجَّل إليها خطأ. لوحة المستخدم العادي صفحة
         داخل SPA الرئيسية، ومسارها الخارجي المعتمَد هو ?p=dashboard —
         تتعامل معه app.js:2127 صراحةً، وهو ما تستخدمه بقية الصفحات
         الفرعية (مثال: spaces/app.js عند showPage('dashboard')). */
      if (navCta) { navCta.textContent = 'حسابي'; navCta.setAttribute('href', '/?p=dashboard'); }
    }
  } catch (e) { /* localStorage محجوب — تجاهل */ }

  /* ── ٣) Service Worker ── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function (reg) {
        /* الـ catch إجباري: رفض غير معالَج من انقطاع شبكة عابر كان
           يلوّث GlitchTip (راجع sw-update-unhandled-rejection-fix) */
        setInterval(function () {
          reg.update().catch(function (err) { console.warn('SW update check failed:', err); });
        }, 30 * 60 * 1000);
      }).catch(function (err) { console.warn('SW registration failed:', err); });
    });
  }
})();
