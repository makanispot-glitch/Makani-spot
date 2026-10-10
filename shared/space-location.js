/* Same allowlist as valid_space_maps_url in the database. No geocoding or guessed pins. */
(function () {
  'use strict';
  function valid(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\s\\\u0000-\u001f]/.test(value)) return false;
    // Check the original spelling too: URL normalizes encoded/dot path segments.
    return /^https:\/\/(?:(?:www\.)?google\.com\/maps(?:\/|\?)[^\s]+|maps\.google\.com\/(?:\?|maps(?:\/|\?))[^\s]+|maps\.app\.goo\.gl\/[A-Za-z0-9_-]+(?:\?[^\s]*)?|goo\.gl\/maps\/[A-Za-z0-9_-]+(?:\?[^\s]*)?)$/i.test(value)
      && !/\/(?:\.{1,2}|%2e(?:%2e)?)\//i.test(value);
  }
  function message(required) {
    const en = document.documentElement.lang === 'en';
    return required
      ? (en ? 'Add the exact location using a Google Maps share link.' : 'أضف موقع المساحة الدقيق باستخدام رابط المشاركة من Google Maps.')
      : (en ? 'Use a secure Google Maps link (https://).' : 'استخدم رابط Google Maps صالحًا وآمنًا يبدأ بـ https://.');
  }
  function checkInput(input, required) {
    if (!input) return false;
    const value = input.value.trim();
    const error = !value && required ? message(true) : value && !valid(value) ? message(false) : '';
    input.setCustomValidity(error);
    input.setAttribute('aria-invalid', String(!!error));
    if (error) { input.reportValidity(); input.focus(); return false; }
    return true;
  }
  document.addEventListener('input', e => {
    if (e.target.matches('[data-space-maps]')) { e.target.setCustomValidity(''); e.target.removeAttribute('aria-invalid'); }
  });
  window.MakaniSpaceLocation = { valid, checkInput, message };
})();
