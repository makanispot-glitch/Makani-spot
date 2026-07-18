/**
 * الوحدة المشتركة لدعم اللغتين (عربي/إنجليزي) — مصدر واحد لتهيئة i18next
 * واستهلاكه، بدل تكرار منطق التحميل والتبديل في كل صفحة.
 * حمّلها بـ:
 *   <script src="/vendor/i18next/i18next.min.js" defer></script>
 *   <script src="/vendor/i18next/i18nextHttpBackend.min.js" defer></script>
 *   <script src="/vendor/i18next/i18nextBrowserLanguageDetector.min.js" defer></script>
 *   <script src="/shared/i18n.js?v=..." defer></script>
 * قبل ملف الصفحة المستهلك — لازم await initI18n(...) تخلص قبل أي استخدام لـ t().
 *
 * تصميم متعمّد:
 * - fallbackLng: 'ar' هو شبكة الأمان لكل خطة الترحيل التدريجي: أي صفحة أو
 *   namespace لسه ما اتترجمش (أو مفتاح ناقص من locales/en/*.json) بترجع
 *   النص العربي تلقائيًا بدل ما تنكسر — لا تشيلها.
 * - منع وميض الاتجاه الغلط (flash of wrong direction) مش شغل هذا الملف:
 *   هذا الملف بيتحمّل بـ defer (بعد بداية الرسم)، فمينفعش يمنع الوميض.
 *   كل صفحة لازم يكون فيها snippet صغير synchronous في <head> قبل
 *   <link rel="stylesheet" href=".../style.css">، بنفس مكان وأسلوب
 *   تعليق "Auth Flicker Prevention" الموجود بالفعل (مثال: spaces/index.html) —
 *   انظر locale-flicker-snippet.html كمرجع للنسخ.
 * - setLocale() دالة نقية قدر الإمكان: مش بتفترض وجود عميل Supabase عالمي.
 *   الصفحة اللي عايزة تحفظ اختيار اللغة على حساب المستخدم المسجّل دخول
 *   (profiles.preferred_locale) بتمرّر sbClient/userId صراحةً، بنفس نمط
 *   submitSpaceBookingRequest(sbClient, currentUser, fields) في shared/booking.js.
 * - applyDomTranslations(): للمحتوى الثابت في HTML (نص ثابت بدون بناء JS ديناميكي،
 *   زي policies/index.html) بنستخدم data-i18n بدل ما نلمس كل عنصر يدويًا في JS.
 *   المحتوى المبني ديناميكيًا (كروت/جداول في dashboard, market, bazaars...) بيستخدم
 *   t() مباشرة جوه الـ template literal وقت البناء — لا يحتاج data-i18n.
 *   initI18n() بتنادي الدالة دي تلقائيًا مرة بعد التهيئة، وبترتبط بحدث
 *   makani:locale-changed عشان أي صفحة فيها data-i18n تتحدّث فورًا عند تبديل اللغة
 *   بدون إعادة تحميل — الصفحات اللي مالهاش data-i18n مش بتتأثر (querySelectorAll فاضية).
 * - makani:locale-changed بيتطلق أيضًا مرة واحدة في آخر initI18n() (مش بس من
 *   setLocale()) — عشان أي صفحة عندها محتوى ديناميكي مبني بـ t() (كروت market/
 *   spaces/...) ومسجّلة على الحدث ده من قبل، تقدر تعيد رسم نفسها لو الصفحة
 *   نادت t() في سباق مبكر قبل ما i18next يخلص التهيئة (fetch شبكة غير متزامن) —
 *   بدل ما تفضل عالقة على مفتاح خام زي "grid.loading" بدل النص المترجم. راجع
 *   [[feedback-i18n-gotchas]] لتفاصيل السباق ده.
 */

const MAKANI_LOCALE_KEY = 'makani_locale';
const MAKANI_SUPPORTED_LOCALES = ['ar', 'en'];

/** يقرأ اللغة الحالية — من i18next لو مهيّأ، وإلا من localStorage، وإلا 'ar' */
function getLocale() {
  if (typeof i18next !== 'undefined' && i18next.isInitialized) return i18next.language;
  try {
    const saved = localStorage.getItem(MAKANI_LOCALE_KEY);
    return MAKANI_SUPPORTED_LOCALES.includes(saved) ? saved : 'ar';
  } catch (e) {
    return 'ar';
  }
}

/** يطبّق lang/dir على <html> — نفس المنطق المستخدم في snippet منع الوميض */
function applyLocaleToDocument(locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === 'en' ? 'ltr' : 'rtl';
}

/**
 * تهيئة i18next لصفحة معيّنة.
 * @param {string[]|string} namespaces - أسماء ملفات الترجمة المطلوبة لهذه الصفحة
 *   (مثال: ['common', 'spaces']) — كل واحد بيتحمّل من
 *   /locales/{{lng}}/{{ns}}.json عند الحاجة فقط (lazy).
 * @returns {Promise<object>} كائن i18next بعد اكتمال التهيئة
 */
async function initI18n(namespaces) {
  const ns = Array.isArray(namespaces) ? namespaces : [namespaces || 'common'];
  await i18next
    .use(i18nextHttpBackend)
    .use(i18nextBrowserLanguageDetector)
    .init({
      fallbackLng: 'ar',
      supportedLngs: MAKANI_SUPPORTED_LOCALES,
      ns,
      defaultNS: ns[0],
      // common.json فيها مفاتيح مشتركة (nav, userMenu, auth, footer...) تُستخدم
      // بدون بادئة namespace في كل صفحة (data-i18n="nav.home" مش "common:nav.home") —
      // fallbackNS يخلي i18next يدوّر فيها تلقائيًا لو المفتاح مش موجود في الـ namespace
      // الافتراضي بتاع الصفحة (spaces/market/bazaars/...).
      fallbackNS: 'common',
      backend: {
        loadPath: '/locales/{{lng}}/{{ns}}.json',
      },
      detection: {
        // بدون 'navigator' عمدًا: العربية هي اللغة الافتراضية لكل زائر جديد
        // بغض النظر عن لغة متصفحه — التبديل للإنجليزية إجراء صريح فقط
        // (زر التبديل، أو ?lang=en، أو اختيار سابق محفوظ) — لا يوجد أي
        // "تخمين" تلقائي من إعدادات الجهاز.
        order: ['localStorage', 'querystring'],
        lookupLocalStorage: MAKANI_LOCALE_KEY,
        lookupQuerystring: 'lang',
        caches: ['localStorage'],
      },
      interpolation: { escapeValue: false }, // مش بنطبع HTML خام عبر الترجمة، ماينفعش نحتاج escaping زيادة عن اللزوم
      returnEmptyString: false,
    });
  applyLocaleToDocument(i18next.language);
  document.addEventListener('makani:locale-changed', () => {
    applyDomTranslations(document);
    if (typeof updateLangSwitcherLabel === 'function') {
      try { updateLangSwitcherLabel(); } catch (err) { console.warn('[i18n] updateLangSwitcherLabel error:', err); }
    }
  });
  // بيغطي data-i18n فورًا، وبيبلّغ أي مستمع صفحة-خاص (زي إعادة رسم كروت
  // market/spaces) إن الترجمة بقت جاهزة — أول مرة، مش بس عند setLocale() لاحقًا.
  document.dispatchEvent(new CustomEvent('makani:locale-changed', { detail: { locale: i18next.language, initial: true } }));
  return i18next;
}

/** اختصار قصير لـ i18next.t — استخدمه في كود الصفحة بدل الوصول لـ i18next مباشرة */
function t(key, opts) {
  return i18next.t(key, opts);
}

/**
 * يطبّق الترجمة على كل عنصر HTML ثابت فيه data-i18n داخل root المُعطى.
 * - data-i18n="key"          → el.textContent = t(key)
 * - data-i18n-html="key"     → بدّل مكان data-i18n لو النص محتاج وسوم HTML جوّاه (نادر، استخدمه بحذر)
 * - data-i18n-attr="attr1:key1,attr2:key2" → بيترجم خصائص زي placeholder/title/aria-label
 * @param {Document|Element} [root] - نطاق البحث، افتراضيًا document بالكامل
 */
function applyDomTranslations(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  scope.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.getAttribute('data-i18n-attr').split(',').forEach(pair => {
      const [attr, key] = pair.split(':').map(s => s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
}

/**
 * تبديل اللغة الحالية + حفظها + (اختياريًا) حفظها على حساب المستخدم.
 * @param {'ar'|'en'} locale
 * @param {{sbClient?: object, userId?: string}} [opts] - لو الصفحة عندها
 *   عميل Supabase ومستخدم مسجّل دخول، بيتحفظ الاختيار في profiles.preferred_locale
 *   بأفضل جهد (best-effort) — فشل الحفظ لا يمنع تبديل اللغة في الواجهة.
 */
async function setLocale(locale, opts) {
  if (!MAKANI_SUPPORTED_LOCALES.includes(locale)) return;
  await i18next.changeLanguage(locale);
  try { localStorage.setItem(MAKANI_LOCALE_KEY, locale); } catch (e) {}
  applyLocaleToDocument(locale);
  document.dispatchEvent(new CustomEvent('makani:locale-changed', { detail: { locale } }));

  if (opts?.sbClient && opts?.userId) {
    opts.sbClient
      .from('profiles')
      .update({ preferred_locale: locale })
      .eq('id', opts.userId)
      .then(() => {}, () => {});
  }
}
