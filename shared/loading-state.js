/* Locale visibility is CSS-driven, so neither a missing key nor slow i18n can
   expose raw translation keys during initial page loading. */
(function () {
  'use strict';
  var markup = '<div class="mk-loading" role="status" aria-live="polite">' +
    '<span class="mk-loading-spinner" aria-hidden="true"></span>' +
    '<span class="mk-label-ar">جاري التحميل…</span>' +
    '<span class="mk-label-en" lang="en">Loading…</span></div>';
  window.MakaniLoading = {
    markup: function () { return markup; },
    show: function (target) {
      var element = typeof target === 'string' ? document.getElementById(target) : target;
      if (element) element.innerHTML = markup;
    }
  };
})();
