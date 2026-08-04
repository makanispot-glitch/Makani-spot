/**
 * ════════════════════════════════════════════════════════════════════
 * 🧭 سجلّ التلميحات السياقية — نقطة التوسّع الوحيدة
 * ════════════════════════════════════════════════════════════════════
 *
 * **لإضافة إرشاد جديد: أضف كائنًا هنا فقط.** لا تعدّل shared/onboarding.js —
 * المحرّك عام بالكامل ولا يعرف شيئًا عن منتج المنصة.
 *
 * قواعد ملزمة قبل إضافة أي تلميح:
 *   ١) Progressive Disclosure — التلميح يظهر عند نقطة القرار، لا عند
 *      أول زيارة. سؤال الفرز: «هل المستخدم أمام قرار الآن يفتقد معلومته؟»
 *      إن لم تكن الإجابة نعم، فلا تلميح.
 *   ٢) لا تلميح لميزة غير جاهزة للإنتاج. الإرشاد يوثّق ما يعمل فعلًا.
 *   ٣) فضّل retiredWhen على once — التقاعد بشرط بيانات ذاتي التصحيح
 *      ويعمل عبر الأجهزة بلا مزامنة. لا تستخدم once إلا حين لا توجد
 *      إشارة بيانات أصلًا.
 *   ٤) الرسالة سطران كحدّ أقصى، فعلية لا وصفية.
 *   ٥) كل نص من i18n — بلا استثناء وبلا نص مكتوب في الكود.
 *
 * ترتيب الأولوية داخل السطح الواحد: الأصغر يفوز (واحد فقط يظهر).
 * تُحمَّل بعد shared/onboarding.js.
 */

(function (global) {
  'use strict';
  if (!global.OB) return;

  global.OB.register([

    /* ══════════════════════════════════════════════════════════════
       ١) الزائر / المستخدم العادي — سطح المساحات
       ══════════════════════════════════════════════════════════════ */

    /* نقطة القرار: أمامه فلاتر كثيرة ولا يعرف من أين يبدأ. */
    {
      id: 'spaces.search',
      page: 'spaces',
      form: 'popover',
      anchor: '#mp-region',
      priority: 10,
      i18n: 'onboarding.spaces.search',
      when: function (c) { return !c.hasSearched && c.spacesVisible > 0; },
      retiredWhen: function (c) { return !!c.hasSearched; },
    },

    /* نقطة القرار: يرى بطاقات لكنه لا يعرف أن التفاصيل مفتوحة له بلا تسجيل
       (الجدار أُزيل حديثًا — والتوقّع السائد في السوق أنها محجوبة). */
    {
      id: 'spaces.detail',
      page: 'spaces',
      form: 'popover',
      anchor: '.mp-grid-card .btn-detail, #mp-grid button[onclick*="openSpaceDetail"]',
      priority: 20,
      i18n: 'onboarding.spaces.detail',
      when: function (c) { return c.hasSearched && !c.hasOpenedDetail && c.spacesVisible > 0; },
      retiredWhen: function (c) { return !!c.hasOpenedDetail; },
    },

    /* نقطة القرار: زائر داخل التفاصيل — يتردّد لأنه لا يعرف هل الطلب
       يُلزمه بشيء، ولا متى يُطلب منه التسجيل. */
    {
      id: 'spaces.book',
      page: 'spaces',
      form: 'popover',
      anchor: '.sd-book-btn, #page-space-detail button[onclick*="openBooking"]',
      priority: 30,
      i18n: 'onboarding.spaces.book',
      when: function (c) { return c.detailOpen && !c.isLoggedIn && !c.hasBooked; },
      retiredWhen: function (c) { return !!c.hasBooked; },
    },

    /* نقطة القرار الأهم: أرسل الطلب — ثم ماذا؟ دور المنصة يختلف جذريًا
       بين مساحة بروكر (الفريق يتفاوض) ومساحة مالك (المالك يبتّ)، ولا
       وسيلة اليوم ليعرف أيّهما ينطبق عليه. يُطلَق صراحةً بـ OB.trigger. */
    {
      id: 'spaces.afterRequest',
      page: 'spaces',
      form: 'card',
      mount: '#modal-success',
      manual: true,        // يُطلَق بـ OB.trigger عند لحظة الإرسال لا بالاختيار التلقائي
      priority: 5,
      once: true,
      i18n: function (c) {
        return c.lastBookingIsBroker
          ? 'onboarding.spaces.afterRequestBroker'
          : 'onboarding.spaces.afterRequestOwner';
      },
    },

    /* ══════════════════════════════════════════════════════════════
       ٢) صاحب المساحة — لوحة التحكم
       ──────────────────────────────────────────────────────────────
       الخطوة الأولى («أضف أول مساحة») تملكها بطاقة renderOnboarding
       القائمة في dashboard/app.js — تعمل جيدًا وتتقاعد بشرط بيانات
       (ownerSpacesFull.length > 0)، فلا تُكرَّر هنا. هذه التلميحات
       تتسلّم منها **بعد** نشر أول مساحة.

       ⏸️ **معلَّقة عمدًا — جاهزة معماريًا وغير مفعَّلة.**
       السبب: `dashboard/` لا يملك طبقة i18n إطلاقًا (لا i18next ولا t()
       ولا data-i18n) — وهو الموديول التالي في خطة التدويل. تفعيلها الآن
       كان سيتطلّب إمّا تحميل بنية ترجمة جديدة على اللوحة، أو مصدر نصوص
       ثانيًا — وكلاهما مرفوض بقرار مالك المنتج.

       ✅ **جاهز بالفعل:** التلميحات الثلاثة أدناه، وشروط when/retiredWhen
       لكلٍّ منها، ومحدّدات الأنكور، ونصوصها بالعربية والإنجليزية في
       locales/{ar,en}/common.json تحت onboarding.owner.*

       🔌 **التفعيل لاحقًا = خطوتان فقط، بلا أي تعديل منطق:**
         ١) في dashboard/index.html بعد تحميل i18n:
              <link rel="stylesheet" href="/shared/onboarding.css?v=...">
              <script src="/shared/onboarding.js?v=..." defer></script>
              <script src="/shared/onboarding-cues.js?v=..." defer></script>
         ٢) في dashboard/app.js بعد اكتمال تحميل بيانات المالك:
              OB.init({
                page: 'dashboard',
                userId: currentUser?.id || null,
                t: (k, o) => t('common:' + k, o),
                getContext: () => ({
                  view:             currentView,                       // 'bookings' | 'spaces' | …
                  spacesCount:      ownerSpacesFull.length,
                  bookingsCount:    <إجمالي طلبات الحجز>,
                  pendingBookings:  <عدد المعلّقة>,
                  hasHandledBooking:<بتّ في طلب مرّة>,
                  hasEditedSpace:   <عدّل مساحة مرّة>,
                }),
              });
              // ثم OB.refresh() بعد أي بتّ في طلب أو تعديل مساحة
       ══════════════════════════════════════════════════════════════ */

    /* نقطة القرار: نشر أول مساحة ولا يعرف أين ستصله الطلبات. */
    {
      id: 'owner.whereBookings',
      page: 'dashboard',
      form: 'popover',
      anchor: '.nav-item[onclick*="bookings"]',
      priority: 20,
      i18n: 'onboarding.owner.whereBookings',
      when: function (c) { return c.spacesCount > 0 && c.bookingsCount === 0; },
      retiredWhen: function (c) { return c.bookingsCount > 0; },
    },

    /* نقطة القرار: وصل أول طلب فعلًا — وأمامه أزرار بتّ لأول مرة. */
    {
      id: 'owner.handleBooking',
      page: 'dashboard',
      form: 'popover',
      anchor: '.bk-btn-accept, [onclick*="acceptBooking"]',
      priority: 10,
      i18n: 'onboarding.owner.handleBooking',
      when: function (c) { return c.view === 'bookings' && c.pendingBookings > 0 && !c.hasHandledBooking; },
      retiredWhen: function (c) { return !!c.hasHandledBooking; },
    },

    /* نقطة القرار: المساحة منشورة ولا يعرف أن التعديل فوري بلا مراجعة. */
    {
      id: 'owner.editSpace',
      page: 'dashboard',
      form: 'popover',
      anchor: '[onclick*="editSpace"]',
      priority: 40,
      i18n: 'onboarding.owner.editSpace',
      when: function (c) { return c.view === 'spaces' && c.spacesCount > 0 && !c.hasEditedSpace; },
      retiredWhen: function (c) { return !!c.hasEditedSpace; },
    },

    /* ══════════════════════════════════════════════════════════════
       ٣) منظّم البازار — صفحة الإدارة
       ══════════════════════════════════════════════════════════════ */

    /* نقطة القرار: تفعيل التوثيق للتوّ ولا بازار بعد. */
    {
      id: 'organizer.firstBazaar',
      page: 'bz-manage',
      form: 'card',
      mount: '#mn-overview, #mn-cards',
      priority: 20,
      i18n: 'onboarding.organizer.firstBazaar',
      when: function (c) { return c.isOrganizer && c.bazaarsCount === 0; },
      retiredWhen: function (c) { return c.bazaarsCount > 0; },
    },

    /* نقطة القرار: أنشأ بازارًا ويتساءل لماذا لا يظهر للعامة — وأن
       خريطة الأماكن ليست عملًا يدويًا ينتظره. */
    {
      id: 'organizer.pendingReview',
      page: 'bz-manage',
      form: 'card',
      mount: '#mn-overview, #mn-cards',
      priority: 15,
      i18n: 'onboarding.organizer.pendingReview',
      when: function (c) { return c.pendingBazaars > 0 && c.publishedBazaars === 0; },
      retiredWhen: function (c) { return c.publishedBazaars > 0; },
    },

    /* نقطة القرار: اعتُمد البازار وتولّدت الخريطة — ماذا يملك فيها؟ */
    {
      id: 'organizer.slots',
      page: 'bz-manage',
      form: 'popover',
      anchor: '[onclick*="switchTab(\'slots\'"]',
      priority: 30,
      i18n: 'onboarding.organizer.slots',
      when: function (c) { return c.publishedBazaars > 0 && !c.hasEditedSlots; },
      retiredWhen: function (c) { return !!c.hasEditedSlots; },
    },

    /* نقطة القرار الأهم للمنظّم: يرى جدول حجوزات بلا أزرار فيظنّه عطلًا.
       الحقيقة أن الأدمن وحده يؤكّد — معلومة لا تصله اليوم من أي مكان. */
    {
      id: 'organizer.bookingsReadOnly',
      page: 'bz-manage',
      form: 'popover',
      anchor: '[onclick*="switchTab(\'bookings\'"]',
      priority: 10,
      once: true,
      i18n: 'onboarding.organizer.bookingsReadOnly',
      when: function (c) { return c.bookingsCount > 0; },
    },

  ]);
})(window);
