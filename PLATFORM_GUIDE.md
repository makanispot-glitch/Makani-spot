# دليل منصة مكاني Spot — للذكاء الاصطناعي (الدليل الشامل)

> **الهدف:** هذا الملف هو المرجع التقني الشامل والمحدّث للمنصة. اقرأه **أولاً** قبل أي تعديل لتعرف أين تذهب مباشرةً دون البحث في الكود.
>
> **آخر تحديث كبير:** مايو 2026 — هجرة بيانات المساحات بالكامل من Google Sheets إلى **Supabase**، إضافة نظام الباقات (Starter/Growth/Pro)، نظام طلبات الترقية، مركز تحكم إداري متعدد الصفحات، وإعادة هيكلة لوحة تحكم المالك.

---

## 0. ملخّص أحدث التحديثات (اقرأه إن كنت عائداً لمشروع تعرفه)

| التحديث | ماذا تغيّر | الملفات المتأثرة |
|---------|-----------|------------------|
| **🔴 هجرة المساحات إلى Supabase** | المساحات لم تعد تُقرأ من Google Sheets. الآن تُقرأ من جداول `spaces` + `space_units` + `space_activities` في Supabase مع **Realtime** (تحديث فوري) و polling احتياطي كل 5 دقائق. | `app.js`, `spaces/app.js`, `dashboard/app.js` |
| **🟠 نظام الباقات (Plans)** | ثلاث باقات: **Starter** (مجاني) · **Growth** (3,000ج) · **Pro** (4,500ج). صفحة أسعار `#pg-pricing`. تخزّن في `profiles.plan_tier`. | `index.html` (#pg-pricing), `style.css` (`pkg-*`) |
| **🟠 Plan Gating** | قفل ميزات الداشبورد حسب الباقة (`canAccess()`, `planGateHtml()`). ترتيب المساحات في الواجهة حسب الباقة (`_sortByPlan`) + شارات ثقة (`_planTrustBadgeHtml`). | `dashboard/app.js`, `app.js`, `spaces/app.js` |
| **🟠 طلبات الترقية / التحويل** | المالك يطلب عبر مودال → جدول `upgrade_requests` → الأدمن يراجع في `spaces-hub.html`/`subscriptions.html` → RPC `admin_set_plan_tier` يحدّث `profiles.plan_tier`. | `app.js`, `admin/spaces-hub.html`, `admin/subscriptions.html` |
| **🟢 مركز تحكم إداري جديد** | `admin/admin-hub.html` صفحة رئيسية تربط: إدارة المساحات، الاشتراكات، البازارات، طلبات المنظّمين، التقييمات. | `admin/*.html` |
| **🟢 إدارة المساحات للأدمن** | `admin/spaces-hub.html`: موافقة/رفض/تعديل/حذف المساحات والوحدات + إشعارات. الموافقة تُفعّل Realtime على الموقع العام. | `admin/spaces-hub.html` |
| **🟢 صفحة إضافة مساحة في الداشبورد** | المالك يضيف مساحة + وحدات فرعية + صور → تُحفظ في Supabase بحالة `pending`. حد Growth = 8 مساحات. | `dashboard/` (`view-add-space`, `submitAddSpace`) |
| **🟢 نظام المعاينة (Inspection)** | مودال حجز معاينة للمساحة (`#inspection-modal`, `_insp*`). | `app.js` |
| **🟢 رفع الصور إلى Cloudflare R2** | `media-handler.js` يضغط الصور (WebP/Canvas) ويرفعها لـ **Cloudflare R2** عبر Pages Function `/upload` (وليس Supabase Storage). | `media-handler.js`, `functions/upload.js`, `dashboard/app.js` |
| **🟢 تقييمات حقيقية** | `user_ratings` في Supabase + RPC `owner_list_rateable_tenants` + صفحة أدمن `ratings.html`. | `dashboard/app.js`, `admin/ratings.html` |

---

## 1. نظرة عامة على المنصة

**مكاني Spot** منصة عربية (RTL) لاستئجار مساحات صغيرة في مولات، نوادٍ، ومدارس في مصر، بالإضافة إلى نظام بازارات وسوق مشاريع.

- **المستخدمون:** مستأجرون (Tenants) · أصحاب مساحات (Owners) · منظّمو بازارات (Organizers) · مدراء (Admins)
- **البنية التقنية:** Vanilla HTML/CSS/JS (بدون أي framework) · **Supabase** (Auth + Postgres DB + Realtime) · **Cloudflare** (Pages للاستضافة + Functions + R2 للصور) · Google Apps Script (الحجوزات فقط + بازارات legacy) · PWA.
- **نموذج العمل:** اشتراك شهري لأصحاب المساحات (باقات)، بدون عمولة على الحجز.

---

## 2. شجرة الملفات الكاملة

```
Makani-spot/
│
├── index.html              ← التطبيق الرئيسي (SPA — كل صفحات الزائر/المستأجر) (~3,096 سطر)
├── app.js                  ← منطق التطبيق الرئيسي (~3,459 سطر)
├── style.css               ← نظام التصميم الكامل (~7,074 سطر)
├── media-handler.js        ← ضغط الصور (WebP/Canvas) ورفعها إلى Cloudflare R2 عبر /upload
├── sw.js                   ← Service Worker (PWA / offline)
├── manifest.json           ← PWA manifest
├── offline.html            ← صفحة Offline fallback
├── _headers                ← Cloudflare Pages headers
├── robots.txt
├── favicon.jpg
├── bump-version.ps1        ← سكربت رفع رقم نسخة الكاش (sw.js)
├── market-filter-inline.tmp.js  ← ملف مؤقت (غير مستخدم في الإنتاج)
│
├── spaces/                 ← صفحة تصفّح المساحات المستقلة (Marketplace كامل)
│   ├── index.html          (~1,199 سطر)
│   └── app.js              (~1,928 سطر) — تحميل من Supabase + Realtime + مودال معاينة
│
├── dashboard/              ← لوحة تحكم صاحب المساحة (Owner Dashboard)
│   ├── index.html          (~2,567 سطر) — التصميم الداكن + كل الـ views inline
│   └── app.js              (~3,602 سطر) — Auth بالدور، Plan Gating، إضافة مساحة، تقييمات
│
├── admin/                  ← مركز التحكم الإداري (صفحات مستقلة، كل صفحة Supabase خاص بها)
│   ├── admin-hub.html      ← 🏠 الصفحة الرئيسية للأدمن — بطاقات + إحصائيات عامة
│   ├── spaces-hub.html     ← إدارة المساحات (موافقة/رفض/تعديل/حذف + وحدات)
│   ├── subscriptions.html  ← إدارة الاشتراكات والباقات (طلبات الترقية)
│   ├── ratings.html        ← إدارة التقييمات
│   ├── bazaar-dashboard.html ← إدارة البازارات والأكشاك
│   ├── organizer-requests.html ← طلبات توثيق المنظّمين
│   └── index.html          ← (قديم) لوحة مراجعة الإعلانات الأصلية
│
├── bazaars/                ← نظام البازارات
│   ├── index.html          ← تصفّح البازارات
│   ├── app.js              ← منطق البازار (~72KB)
│   ├── organize.html/.js   ← إنشاء بازار + محرر خريطة الأكشاك
│   ├── profile.html/.js    ← ملف المنظّم العام
│   └── verification.html/.js ← طلب توثيق المنظّم
│
├── market/                 ← سوق المشاريع الجاهزة (بيع/شراء مشاريع)
│   ├── index.html
│   └── app.js
│
├── post-ad/index.html      ← نشر مشروع للبيع
├── catalog/index.html      ← كتالوج المشاريع
├── policies/index.html     ← الشروط والسياسات
│
├── functions/              ← Cloudflare Pages Functions (Serverless endpoints)
│   ├── admin/auth.js       ← مصادقة الأدمن (server-side)
│   ├── admin/listings.js   ← إدارة الإعلانات (server-side)
│   ├── delete-listing.js   ← حذف إعلان
│   └── upload.js           ← رفع ملفات
│
└── icons/                  ← أيقونات PWA (icon-192, icon-512, icon.svg, maskable.svg)
```

---

## 3. مصادر البيانات (مهم جداً — تغيّر جذرياً)

```
┌─ Supabase (المصدر الأساسي الآن) ──────────────────────────────┐
│  Auth          → تسجيل دخول/تسجيل (Email + Google OAuth)        │
│  Postgres DB   → spaces, space_units, space_activities,        │
│                  profiles, bookings, notifications,            │
│                  user_ratings, upgrade_requests,              │
│                  bazaars, bazaar_slots, bazaar_bookings,       │
│                  organizer_requests, organizer_profiles        │
│  Realtime      → بثّ تغييرات spaces + space_units فورياً        │
│  RPC           → owner_list_rateable_tenants, admin_set_plan_tier │
│  (Auth token من Supabase يُستخدم لتفويض رفع الصور إلى R2)        │
└────────────────────────────────────────────────────────────────┘

┌─ Cloudflare (الاستضافة + الصور) ──────────────────────────────┐
│  Pages         → استضافة الموقع كله                            │
│  Pages Functions → /upload, /admin/auth, /admin/listings, ...  │
│  R2 Storage    → صور المساحات/الوحدات/الإعلانات (bucket عبر /upload) │
│                  العرض من R2_PUBLIC_BASE (pub-...r2.dev)        │
└────────────────────────────────────────────────────────────────┘

┌─ Google Apps Script (متبقٍّ محدود) ───────────────────────────┐
│  BOOKING_URL        → حفظ الحجوزات (submitBooking)             │
│  BAZAAR_SHEET_URL   → بيانات بازارات قديمة (legacy fallback)   │
│  ⚠️ ملاحظة: المساحات لم تعد من Sheets — SHEET_URL أُزيل.        │
│  ⚠️ ملاحظة: الصور ليست على Supabase Storage — بل Cloudflare R2. │
└────────────────────────────────────────────────────────────────┘
```

**إعدادات الاتصال** (في رأس كل ملف JS، عدّلها في كل الملفات معاً عند التغيير):
```javascript
// app.js (أسطر ~28–41)
const BOOKING_URL      = "https://script.google.com/macros/s/.../exec";  // الحجوزات
const BAZAAR_SHEET_URL = "https://script.google.com/macros/s/.../exec";  // بازارات legacy
const SUPABASE_URL     = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY     = 'eyJhbGc...';  // anon key
// نفس SUPABASE_URL/KEY مكرّرة في: spaces/app.js, dashboard/app.js, وكل صفحات admin/*.html
```

---

## 4. مخطّط قاعدة بيانات Supabase (الجداول المرصودة)

> هذه الأعمدة مستنتجة من استعلامات الكود الفعلية. استخدمها كمرجع عند كتابة استعلامات جديدة.

### `spaces` — المساحات الرئيسية
| العمود | الوصف |
|--------|--------|
| `id` | المعرّف |
| `owner_id` | FK → profiles.id (صاحب المساحة) |
| `name`, `type` (`mall`/`club`/`school`), `region` | بيانات أساسية |
| `min_price` | أقل سعر (يُعرض كـ price) |
| `sizes_prices` | نص الأحجام مفصول بـ `|` أو `·` |
| `activities` (array), `all_acts` (bool) | الأنشطة المسموحة |
| `badge`, `badge_class`, `season`, `insight` | شارات وعرض |
| `description`, `amenities` (array) | تفاصيل |
| `image_url`, `extra_images` (array), `icon_emoji`, `thumb_color` | الوسائط |
| `sort_order` | ترتيب العرض |
| **`status`** | `pending` / `approved` / `rejected` |
| **`is_active`** | bool — يجب أن تكون `true` + status=`approved` ليظهر للعامة |
| `created_at` | تاريخ الإنشاء |

### `space_units` — الوحدات الفرعية داخل المساحة
`id`, `space_id` (FK→spaces), `unit_id`, `name`, `floor`, `size`, `price`, `status` (`available`/…), `location`, `image_url`, `notes`

### `space_activities` — قائمة الأنشطة التجارية
`id`, `emoji`, `name_ar`, `is_active`, `sort_order`

### `profiles` — ملفات المستخدمين
`id` (= auth.users.id), `name`, `phone`, `email`, **`role`** (`owner`/مستأجر/admin), **`plan_tier`** (`starter`/`growth`/`pro`), وحقول إضافية.

### `upgrade_requests` — طلبات تحويل لحساب صاحب مساحة / اختيار باقة
الأعمدة الفعلية (من `submitOwnerRequest`): `user_id`, `user_email`, `user_name`, `place_name`, `place_type`, `phone`, `notes`, `selected_plan` (`starter`/`growth`/`pro` — اختياري), `status` (`pending`/`approved`/`rejected`/`contacted`). يُنشأ من `app.js` (`submitOwnerRequest`/`requestOwnerUpgrade`)، ويُراجَع في `admin/subscriptions.html` و `admin/spaces-hub.html`.

### `notifications` — إشعارات المالك
`owner_id`, `type` (مثل `space_submitted`), `title`, `body`, علم القراءة.

### `bookings` — الحجوزات · `user_ratings` — التقييمات
الحجوزات تُحفظ في Supabase + Apps Script. التقييمات مرتبطة بالحجوزات والملفات.

### جداول البازارات
`bazaars`, `bazaar_slots` (الأكشاك), `bazaar_bookings` (حجز كشك), `organizer_requests` (توثيق منظّم), `organizer_profiles`.

---

## 5. `index.html` — التطبيق الرئيسي (SPA)

> كل الصفحات مضمّنة في ملف واحد، والتنقل عبر `showPage()` في `app.js`. الصفحة النشطة تحمل class `active`.

### 5-أ. الصفحات (Pages) — مع أرقام الأسطر التقريبية

| Page ID | السطر | الوصف | يُفعَّل عبر |
|---------|-------|--------|-------------|
| `#pg-home` | ~259 | الرئيسية: Hero + فلاتر + شبكة مساحات + بازارات | افتراضي |
| `#pg-how` | ~782 | كيف يعمل المنصة | `showPage('how')` |
| `#pg-owner` | ~946 | لأصحاب المساحات (تسويقية) | `showPage('owner')` |
| `#pg-pricing` | ~1234 | **صفحة الباقات (جديدة)** Starter/Growth/Pro | `showPage('pricing')` |
| `#pg-market` | ~1871 | سوق المساحات (Marketplace داخلي) | `showPage('market')` |
| `#pg-login` | ~1972 | تسجيل الدخول | `showPage('login')` |
| `#pg-signup` | ~2116 | إنشاء حساب | `showPage('signup')` |
| `#pg-confirm` | ~2286 | **تأكيد البريد (جديدة)** بعد التسجيل | تلقائي بعد signup |
| `#pg-dashboard` | ~2319 | لوحة المستخدم المصغّرة (حجوزاتي/تقييماتي/ترقية) | `goToDashboard()` |
| `#pg-space-detail` | ~2738 | تفاصيل مساحة واحدة | `openSpaceDetail(id)` |

### 5-ب. المودالات (Modals)

| Modal ID | السطر | الوظيفة |
|----------|-------|----------|
| `#booking-modal` | ~2496 | مودال الحجز (مشترك) — `modal-form-wrap`, `modal-act-picker`, `modal-success` |
| `#inspection-modal` | ~2585 | **مودال حجز المعاينة (جديد)** — متعدد الخطوات |
| `#owner-request-modal` | ~3013 | **مودال طلب التحويل لصاحب مساحة / الترقية (جديد)** |

### 5-ج. الأقسام العامة
```
<nav class="nav">              ← شريط التنقل العلوي
  #nav-guest                  ← أزرار الزائر
  #nav-logged                 ← أفاتار + قائمة المستخدم
  #nav-dropdown               ← قائمة منسدلة (#dd-plan-badge يعرض الباقة)
<bottom-nav>                  ← شريط تنقل سفلي للموبايل (updateBottomNav)
```

---

## 6. `app.js` — خريطة الكود الكاملة (أرقام الأسطر فعلية)

### 6-أ. الإعداد والتهيئة
```
~28–74    الثوابت: BOOKING_URL, BAZAAR_SHEET_URL, SUPABASE_URL/KEY,
          SPACES[], ACTIVITIES[], MP_PER_PAGE=12, BAZAARS[], _sliders{}
~90–125   DOMContentLoaded: إنشاء sbClient، loadData، loadBazaars،
          initAuth، subscribeSpacesRealtime، init sliders/animations
126 initPathAnimation · 166 initPriceSlider · 176 updateMainSlider
```

### 6-ب. تحميل المساحات من Supabase (🔴 القلب الجديد)
```
231 loadData()                       ← يجلب space_activities + spaces(+space_units) + profiles.plan_tier
321 fetchVisibleSpacesFromSupabase() ← نفس الاستعلام، يُعيد مصفوفة SPACES
379 silentRefreshSpaces()            ← تحديث صامت (Realtime/polling) بدون إعادة ضبط الصفحة
401 subscribeSpacesRealtime()        ← قناة Realtime على spaces + space_units (debounce 1.5s) + polling 5min
418 showLoadingState · 432 showErrorState
```
**فلتر الظهور للعامة:** `status='approved' AND is_active=true`، مرتّبة بـ `sort_order` ثم بالباقة.

### 6-ج. الباقات والبطاقات
```
505 _sortByPlan(arr)         ← يرتّب: Pro ثم Growth ثم Starter
512 _planTrustBadgeHtml(s)   ← شارة ثقة (Pro="شريك معتمد"، Growth="موثّق")
520 _planCardClass(s)        ← class إضافي للبطاقة حسب الباقة
524 buildCardHtml(s,fromPage)← HTML بطاقة المساحة (slider + شارة + أزرار)
627 renderCards(...)         ← يملأ أي grid
665 _showSpaceLoginGate(...) ← بوابة "سجّل لرؤية التفاصيل" للزوار
```
الأنشطة/الفلاتر: `451 buildActivityFilters`, `464 buildModalActivityPicker`, `479 buildMpActivityFilters`.

### 6-د. تفاصيل المساحة + السلايدرات
```
730 openSpaceDetail · 806 closeSpaceDetail
822 _renderDetailGallery · 1158 _renderDetailInfo · 1230 _renderSubSpaces · 1319 _typeLabel
سلايدر البطاقات (cs*):  953 csInitAll · 970 csGoTo · 986 csNext · 988 csPrev · 1008 _csStartAuto · 1021 _csInitSwipe
سلايدر التفاصيل (sd*):  1049 _sdInit · 1062 sdGoTo · 1117 _sdStartAuto · 1125 _sdInitSwipe · 1146 _sdCleanup
ثوابت: CS_AUTO_DELAY=3800ms · SD_AUTO_DELAY=4500ms · الحالة في _sliders[id]={index,total,autoTimer,paused}
```

### 6-هـ. Marketplace + البحث
```
1363 goToMarketplace · 1367 toggleMpType · 1376 toggleMpAct · 1385 applyMpFilters
1412 clearMpFilters · 1433 updateMpChips · 1450 renderMarketplace · 1478 renderMpPagination
1500 mpGoPage · 1509 initMpSlider · 1517 updateMpSlider · 1536 toggleMpSidebar
بحث الرئيسية: 1546 setTab · 1553 doSearch · 1558 filterAndRender · 1580 showSearchChips · 1602 clearAllFilters
```

### 6-و. التنقل والحجز
```
1635 showPage(p)        ← القيم: home|how|owner|pricing|market|login|signup|confirm|dashboard|space-detail
1676 scrollToSearch · 1683 goToLogin · 1685 goToDashboard
1696 openBooking · 1768 closeModal · 1782 submitBooking (تحقق + Apps Script + Supabase bookings + شاشة نجاح)
1333 openBookingForUnit
```

### 6-ز. المصادقة (Supabase Auth)
```
1920 initAuth · 2001 setNavUser · 2072 toggleUserDropdown
2096 doEmailLogin · 2129 doEmailSignup · 2193 authWithGoogle · 2213 doLogout
2823 updateBottomNav · 2829 handleBnUser · 2856 updateBnUser
```

### 6-ح. لوحة المستخدم المصغّرة + الترقية + التقييمات
```
2229 loadDashboardData · 2268 renderBazaarCTA · 2319 loadMyBazaars
2396 renderUpgradeSection(profile)  ← يعرض زر الترقية حسب الباقة
2452 requestOwnerUpgrade            ← يكتب في upgrade_requests
2481 loadUserBookings · 2639 _subscribeBookings · 2658 toggleBookings
2700 loadUserRatings · 2691 repStarsHtml · 2682 REP_BADGES
طلب التحويل لصاحب مساحة: 3381 handleOwnerUpgradeBtn · 3386 openOwnerRequestModal · 3415 submitOwnerRequest (→ upgrade_requests)
```

### 6-ط. نظام المعاينة (Inspection) — جديد
```
2927 openInspectionModal · 2974 closeInspectionModal · 2986 _inspGoStep
3000 _inspBuildDates · 3013 _inspSelectDate · 3019 _inspSubmitForm
3040 _inspCopyNumber · 3044 _inspCopyId · 3063 _inspConfirm · 3094 _inspGetWorkingDays
```

### 6-ي. البازارات + المشاركة + أنيميشن الأسعار
```
3200 loadBazaars · 3254 _loadBazaarsFromSupabase · 3282 renderHomeBazaars · 2883 _normalizeBazaarRow
3329 shareCard · 3355 _showShareToast
3123 initPricingAnimations · 3165 _pkgCountUp  (أنيميشن أرقام صفحة الباقات)
3185 _toDirectImgUrl (تحويل روابط Google Drive لروابط مباشرة)
```

---

## 7. نظام الباقات (Plans) — تفصيلي

### 7-أ. الباقات الثلاث (صفحة `#pg-pricing`)
| الباقة | السعر | حد المساحات | أبرز المزايا |
|--------|-------|-------------|--------------|
| **Starter** | مجاناً | حتى 2 مساحة · 16م² | إدراج، ظهور في البحث، استقبال حجوزات |
| **Growth** | 3,000 ج/شهر | 8 مساحات · 16م² | أولوية ظهور، badge موثّق، 3 مستأجرين/شهر، منشورات، صفحة مدفوعات/مخالفات |
| **Pro** | 4,500 ج/شهر | غير محدود | أولوية قصوى، Featured أسبوعي، badge "شريك معتمد"، تقارير AI، دعم بازار، مدير حساب |

- **CTAs:** كلها تذهب لواتساب `wa.me/201103467711` (لا دفع آلي بعد).
- **الـ classes:** `pkg-hero`, `pkg-card`, `pkg-card--starter/--pro`, `pkg-features-list`, `pkg-feat--on`, `pkg-table`, `pkg-th`, `pkg-tr`, `pkg-td`, `pkg-cell-x`/`pkg-cell-check`, `pkg-pitch`, `pkg-cta`. (ابحث في `style.css` بالبادئة `pkg-`).
- **أنيميشن:** `initPricingAnimations()` + `_pkgCountUp()` في `app.js`.

### 7-ب. Plan Gating في الداشبورد (`dashboard/app.js`)
```javascript
getPlan()                       // ← currentOwner.planTier || 'starter'
const PLAN_LEVELS = { starter:0, growth:1, pro:2 };
canAccess(minPlan)              // مقارنة المستويات
planGateHtml(requiredPlan)      // شاشة "🔒 هذه الميزة في باقة …"
_planBadgeHtml(tier)            // بادج الباقة في السايدبار
```
**قفل عناصر التنقل** (في `initDashboard`):
- `nav-payments`, `nav-violations` → تتطلب **growth**
- `nav-bazaar`, `nav-reports` → تتطلب **pro**

**حد الإضافة:** في `submitAddSpace` — باقة Growth محدودة بـ 8 مساحات (يُعدّ عبر `count` على `spaces` لنفس `owner_id` مع `status != rejected`).

### 7-ج. أثر الباقة على الواجهة العامة
`_sortByPlan` يضع مساحات Pro أولاً، ثم Growth، ثم Starter. `_planTrustBadgeHtml` يضيف شارة الثقة. هذا يطبَّق في `app.js` و `spaces/app.js`.

### 7-د. تدفّق الترقية (end-to-end)
```
المالك → زر ترقية (renderUpgradeSection / handleOwnerUpgradeBtn)
   → مودال (#owner-request-modal) → submitOwnerRequest()
   → INSERT upgrade_requests { user_id, selected_plan, status:'pending', place_name/type, phone, notes }
الأدمن:
   • admin/spaces-hub.html → renderOwnerRequests + promptApproveOwnerRequest/promptRejectOwnerRequest
       + changeOwnerPlan() → RPC admin_set_plan_tier(p_user_id, p_plan_tier, p_status)
   • admin/subscriptions.html → renderTable + saveSub() (تعديل باقة/حالة الاشتراك مباشرة)
   → النتيجة: UPDATE profiles.plan_tier
   → المالك يرى الباقة الجديدة عند إعادة تحميل الداشبورد؛ الواجهة العامة تُعيد الترتيب (_sortByPlan)
```
> **ملاحظة:** تغيير باقة أي مالك يتم عبر RPC `admin_set_plan_tier` (يحدّث `profiles.plan_tier` و قد يحدّث حالة الطلب). تستدعيه `changeOwnerPlan`/`setOwnerPlan` في صفحات الأدمن.

---

## 8. لوحة تحكم المالك — `dashboard/`

> تصميم داكن (Charcoal + Orange). كل الـ views مضمّنة في `dashboard/index.html` (id=`view-*`)، والتنقل عبر `goTo(viewId, navEl)`.

### 8-أ. الـ Views المتاحة
`view-overview` · `view-spaces` · `view-add-space` · `view-tenants` · `view-contracts` · `view-alerts` · `view-revenue` · `view-insights` · `view-ratings` · `view-payments` · `view-violations` · `view-reports` · `view-settings` · `view-add-bazaar`

### 8-ب. المصادقة بالدور (`dashboard/app.js`)
```
346 getSB · 441 checkRoleAndProceed  ← يتحقق profiles.role === 'owner'، وإلا signOut + بوابة منع
516 doLogin · 529 doGoogleLogin · 548 doLogout · 410 showOwnerAccessGate · 3487 checkSessionOnLoad
564 initDashboard  ← يضبط السايدبار، بادج الباقة، قفل التنقل، ويستدعي محمّلات البيانات
```

### 8-ج. تحميل بيانات المالك من Supabase
```
622 loadOwnerData()  ← مساحات المالك المعتمدة (+space_units) → ownerSpaces
                       + المساحات المعلّقة/المرفوضة → ownerPendingSpaces
694 applyDemoData()  ← fallback بيانات تجريبية لو لا اتصال
710 renderAll()      ← يستدعي كل دوال الـ render
```
⚠️ **ملاحظة:** العقود والمستأجرون والمدفوعات والمخالفات لا تزال في **localStorage** (مفاتيح عبر `contractsKey()`, `paymentsKey()`, `violationsKey()`, `ratingsKey()`) ولم تُنقل لـ Supabase بعد. المساحات والتقييمات والإشعارات في Supabase.

### 8-د. إضافة مساحة (`view-add-space`)
```
2699 submitAddSpace(e)
   ← تحقق الاسم/النوع/المنطقة + حد Growth (8)
   ← يبني spacePayload (status:'pending', is_active:false)
   ← INSERT spaces ثم INSERT space_units (collectSubUnits)
   ← INSERT notifications (type:'space_submitted')
الوحدات الفرعية: 2405 addSubUnitRow · 2483 removeSubUnitRow · 2661 collectSubUnits
الأحجام: 2323 addSizeRow · 2351 calcDefaultPrice · 2368 getSizesString
الصور (عبر media-handler → Cloudflare R2 عبر /upload):
   2551 handleMainSpaceImageUpload · 2614 handleExtraSpaceImagesUpload · 2491 handleUnitImageUpload
   (المتغيرات: asMainImgUrl, asExtraImgUrls[], asUnitImgUrls{})
```

### 8-هـ. التقييمات والإشعارات
```
3165 loadOwnerRatings · 3188 populateRateTenantSelect (RPC owner_list_rateable_tenants)
3229 submitRating (→ user_ratings) · 3126 renderRateStars · 891 renderRatingsHistory
3365 loadNotifications · 3390 subscribeNotificationsRealtime · 3419 markNotificationsRead · 3434 updateNotifBadge
```

### 8-و. باقي الأقسام (render*)
`710 renderAll` يستدعي: `renderKPIs`, `renderOverview`, `renderSpaces`, `renderTenants`, `renderBestTenant`, `renderContracts`, `renderAlerts`, `renderRevenue`, `renderInsights`, `renderRatingsHistory`, `renderPayments`, `renderViolations`, `renderReports`. الإعدادات: `3299 saveSettings`, `3552 changePassword`.

---

## 9. مركز التحكم الإداري — `admin/`

> صفحات HTML **مستقلة**، كل صفحة قائمة بذاتها (CSS + JS مضمّنان). الدخول محمي بكلمة سر تُجزّأ بـ **`sha256`** عبر `tryLogin` (الجلسة في localStorage). **آلية الوصول لـ Supabase:** بدل عميل supabase-js، تستدعي هذه الصفحات REST API مباشرةً عبر دالتين مساعدتين:
> - `sbTable(method, table, body, query)` → `fetch('${SB_URL}/rest/v1/<table>...')` لعمليات CRUD.
> - `sbRpc(fn, params)` → `fetch('${SB_URL}/rest/v1/rpc/<fn>')` لاستدعاء الـ RPCs.
>
> (الثوابت `SB_URL` و `SB_HDR` تحوي الـ apikey في رأس كل صفحة.)

### 9-أ. `admin-hub.html` — لوحة التحكم المركزية
- **الوظيفة:** صفحة هبوط الأدمن — إحصائيات حيّة، فحص حالة النظام، نظرة سريعة على المساحات، بطاقات تنقّل (`quick-card` بـ `target="_blank"`)، ومخططات معمارية توضيحية للنظام.
- **الروابط:** `spaces-hub.html`, `subscriptions.html`, `bazaar-dashboard.html`, `ratings.html`, `index.html`.
- **الدوال:** `sha256`, `tryLogin`, `doLogout`, `loadSpacesData`, `renderPendingSpaces`, `renderAllSpaces`, `renderOwners`, `manageSpace`, `setOwnerPlan`, `switchSpTab`/`renderSpTab`, `checkSystemStatus`, `startAdminAutoRefresh`, `startClock`/`tick`, `copyText`, `toast`.

### 9-ب. `spaces-hub.html` — إدارة المساحات (الأضخم) ⭐
- **الوظيفة:** مركز شامل: نظرة عامة + موافقة/رفض المساحات + تعديل/إضافة مساحة + حذف وحدات + تفعيل/تعطيل + **إدارة باقات الأصحاب** + **طلبات تحويل الأصحاب (`upgrade_requests`)** + **إدارة الأنشطة (`space_activities`)**.
- **دوال رئيسية:** `loadAll`, `renderOverview`, `renderSpaces`, `renderPending`, `renderOwners`, `renderOwnerRequests`, `renderActivities`; القرارات: `doApprove`, `doReject`/`promptReject`, `doToggle`, `promptDelete`/`doDeleteUnit`; الباقات: `changeOwnerPlan` (→ RPC `admin_set_plan_tier`); طلبات الأصحاب: `promptApproveOwnerRequest`, `promptRejectOwnerRequest`, `markContactedRequest`; الأنشطة: `saveActivity`, `toggleActivity`, `deleteActivity`; التعديل/الإضافة: `editSpace`, `openAddForm`, `buildDetailHtml`, `handleMainImg`/`handleExtraImgs`/`handleUnitImg` (رفع R2), `fetchActivities`, `loadSpaceDetail` (مع كاش).
- **الجداول/الـ RPC:** `spaces`, `space_units`, `space_activities`, `profiles`, `notifications`, `bookings` + RPC `admin_set_plan_tier`.
- **🔑 نقطة محورية:** عند `doApprove` تُضبط `status='approved'` و `is_active=true` → يُطلق Supabase Realtime → تظهر المساحة فوراً في `index.html` و `spaces/` بدون إعادة تحميل، ويُرسل إشعار للمالك.

### 9-ج. `subscriptions.html` — إدارة الاشتراكات والباقات ⭐
- **الوظيفة:** عرض كل الأصحاب/الاشتراكات في جدول، KPIs، فلترة، إبراز الاشتراكات المنتهية قريباً، وتعديل باقة/حالة أي مالك عبر مودال.
- **الدوال:** `loadAll`, `renderKPIs`, `applyFilters`, `toggleExpiring`, `renderTable`, `openModal`/`closeModal`, `saveSub` (الحفظ → RPC/تحديث `profiles`), `planLabel`/`planClass`, `statusLabel`/`statusClass`, `sbRpc`, `tryLogin`, `sha256`, `toast`.
- **الجداول/الـ RPC:** `profiles` (`plan_tier`), `upgrade_requests`, + RPC `admin_set_plan_tier`.

### 9-د. `ratings.html` — إشراف التقييمات والسمعة
- **الوظيفة:** عرض كل التقييمات، إحصائيات، فلترة بالحالة، وإخفاء/إظهار تقييم (إشراف).
- **الدوال (بادئة `adm`):** `admLogin`/`admCheckAuth`/`admGetToken`/`admShowDash`, `admLoad`, `admUpdateStats`, `admSetFilter`/`admFilterTable`, `admRender`/`admBuildTable`, `admSetStatus` (تغيير حالة التقييم), `escHtml`, `starStr`, `admToast`.
- **الجداول:** `user_ratings`, `profiles`, `bookings`.

### 9-هـ. `bazaar-dashboard.html` + `organizer-requests.html` + `index.html`
- `bazaar-dashboard.html`: إدارة البازارات والأكشاك (`bazaars`, `bazaar_slots`, `bazaar_bookings`) + طلبات المنظّمين (`organizer_requests`, `organizer_profiles`).
- `organizer-requests.html`: مراجعة طلبات توثيق المنظّمين.
- `index.html` (القديم): مراجعة إعلانات المشاريع للبيع — **محمي بـ Bearer Token من السيرفر** عبر `functions/admin/auth.js` + `functions/admin/listings.js` (أقوى من حماية كلمة السر في باقي صفحات الأدمن).

---

## 10. الصفحات المستقلة الأخرى

### `spaces/` — تصفّح المساحات (Marketplace كامل)
- تحميل من Supabase عبر `loadData()` + `mapSupabaseToSpaceObject(row, profilesMap)` (مساحات معتمدة فقط).
- Realtime + polling مثل الرئيسية (`silentRefreshSpaces`, `subscribeSpacesRealtime`).
- فلاتر sidebar + Pagination (12/صفحة) + سلايدر سعر.
- **مودال معاينة خاص:** `openViewing`, `submitViewing`, `closeViewingModal` (إضافةً لمودال الحجز).
- يكرّر أغلب دوال `app.js` (cs*/sd*، buildCardHtml، الفلاتر) بشكل مستقل.

### `bazaars/` — البازارات
عرض الفعاليات + حجز أكشاك. `organize.html` فيه محرر خريطة أكشاك 2D. `verification.html` لتوثيق المنظّم. `profile.html` ملف المنظّم العام.

### `market/` + `post-ad/` + `catalog/` — سوق المشاريع
بيع/شراء مشاريع جاهزة، نشر إعلان، كتالوج.

---

## 11. ملفات مساعدة

### `media-handler.js` — ضغط ورفع الصور إلى **Cloudflare R2**
```javascript
const UPLOAD_ENDPOINT = '/upload';   // Cloudflare Pages Function (functions/upload.js)
const R2_PUBLIC_BASE  = 'https://pub-...r2.dev';  // قاعدة عرض الصور من R2
const MAX_W = 1280, MAX_H = 1280, WEBP_QUALITY = 0.83, MAX_FILE_BYTES = 20MB;
// التدفق: قراءة EXIF orientation → ضغط/تصغير وتحويل WebP عبر Canvas → رفع عبر fetch إلى /upload
// الدوال العامة: uploadImages(files, userId, onProgress, authToken),
//                uploadSingleImageToR2(file, r2Path, authToken),
//                compressImage / compressToWebP, uploadWithRetry, cancelUpload
// يُستدعى من dashboard/app.js (handleMainSpaceImageUpload/handleExtraSpaceImagesUpload/handleUnitImageUpload)
//   ومن post-ad. التفويض عبر Supabase access token يُمرَّر كـ authToken.
```
> ⚠️ لا يوجد رفع إلى Supabase Storage في المشروع — كل الصور على R2.

### `sw.js` — Service Worker
Cache First للأصول الثابتة · Network First للـ API · fallback إلى `offline.html` · حذف الكاش القديم عند تغيير النسخة (استخدم `bump-version.ps1` لرفع الرقم).

### `functions/` — Cloudflare Pages Functions
endpoints سيرفرية: `admin/auth.js` (مصادقة أدمن), `admin/listings.js`, `delete-listing.js`, `upload.js`.

### `manifest.json`
PWA: الاسم العربي، `theme_color:#F36418`, `dir:rtl`, `lang:ar`, اختصارات (مشاريع/أعلن).

---

## 12. `style.css` — خريطة التصميم (~7,074 سطر)

> نظام التصميم مبني على **CSS Variables** في `:root`. بسبب نمو الملف، **أرقام الأسطر القديمة لم تعد دقيقة** — استخدم **Grep على بادئة الـ selector** للوصول السريع.

### 12-أ. المتغيرات الجذرية (`:root` في أعلى الملف)
```css
--orange-500:#F36418 · --orange-600:#D95A14
--navy-900:#0E1218 · --navy-700:#212833
--font-display:'Cairo' · --font-body:'IBM Plex Sans Arabic' · --font-latin:'Inter'
--shadow-sm/base/lg · --shadow-orange
--dur-instant:80ms · --dur-base:240ms · --dur-slow:360ms · --ease-out-quart
```
> الداشبورد له `:root` خاص داخل `dashboard/index.html` (ألوان داكنة: `--bg`, `--panel`, `--orange`, `--green`, `--sidebar-w:260px`).

### 12-ب. عائلات الـ selectors (ابحث بالبادئة)
| البادئة / الـ selector | المكوّن |
|------------------------|---------|
| `.nav`, `.nav-dropdown`, `.nav-avatar-btn` | شريط التنقل |
| `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-tint` | الأزرار |
| `.page`, `.page.active` | نظام الصفحات (fade-up) |
| `.hero`, `.hero-pill`, `.hero-stats` | الـ Hero |
| `.search-wrap`, `.price-slider-wrap`, `.chip` | البحث والفلاتر |
| `.cards-grid`, `.space-card`, `.card-slider`, `.card-badge` | بطاقات المساحات |
| `.pkg-*` | **صفحة الباقات** (hero/card/table/feat/cta) |
| `.sd-*`, `.sub-*` | تفاصيل المساحة + الوحدات |
| `.modal-*`, `.afg`, `.act-pick-btn` | مودال الحجز |
| `.insp-*` | **مودال المعاينة** |
| `.owner-*` | صفحة أصحاب المساحات |
| `.auth-*`, `.btn-google-auth` | صفحات الدخول/التسجيل |
| `.mp-*`, `.pg-btn` | Marketplace + Pagination |
| `.bz-*` | البازارات |
| `.bottom-nav`, `.bn-*` | شريط التنقل السفلي (موبايل) |

---

## 13. دليل المهام السريعة — "أين أعدّل لكذا؟"

| التعديل المطلوب | الملف | القسم/الدالة |
|----------------|-------|---------------|
| تغيير لون/خط أساسي | `style.css` | `:root` أعلى الملف (والداشبورد: `dashboard/index.html` `:root`) |
| **إضافة/تعديل باقة** | `index.html` (#pg-pricing) + `style.css` (`pkg-*`) + `dashboard/app.js` (`PLAN_LEVELS`, `canAccess`) |
| **تغيير حد المساحات لباقة** | `dashboard/app.js` | `submitAddSpace` (شرط count) |
| **قفل/فتح ميزة حسب الباقة** | `dashboard/app.js` | `initDashboard` (`_lockNav`) + `planGateHtml` |
| **منطق ظهور المساحة للعامة** | `app.js` / `spaces/app.js` | `loadData` (`status='approved' & is_active=true`) |
| **الموافقة على مساحة (أدمن)** | `admin/spaces-hub.html` | `doApprove` / `doReject` |
| **تغيير باقة مالك (أدمن)** | `admin/spaces-hub.html` / `subscriptions.html` | `changeOwnerPlan` / `saveSub` → RPC `admin_set_plan_tier` |
| **مراجعة طلب تحويل صاحب مساحة** | `admin/spaces-hub.html` | `renderOwnerRequests` + `promptApproveOwnerRequest` |
| **إدارة الأنشطة التجارية** | `admin/spaces-hub.html` | `saveActivity` / `toggleActivity` / `deleteActivity` |
| **تعديل ترتيب المساحات (الباقة)** | `app.js` | `_sortByPlan`, `_planTrustBadgeHtml` |
| تعديل بطاقة المساحة (محتوى) | `app.js` | `buildCardHtml` |
| تعديل بطاقة المساحة (تصميم) | `style.css` | `.space-card`, `.card-*` |
| تعديل فلاتر الرئيسية | `app.js` | `doSearch` + `filterAndRender` |
| تعديل Marketplace/Pagination | `app.js` | `renderMarketplace` + `renderMpPagination` |
| تعديل مودال الحجز (منطق) | `app.js` | `openBooking` + `submitBooking` |
| **تعديل مودال المعاينة** | `app.js` | `openInspectionModal` + `_insp*` |
| تعديل تفاصيل المساحة | `app.js` | `openSpaceDetail` + `_render*` |
| تعديل السلايدر | `app.js` | `cs*` و `sd*` |
| **إضافة مساحة (نموذج المالك)** | `dashboard/` | `view-add-space` + `submitAddSpace` + `collectSubUnits` |
| **رفع الصور** | `media-handler.js` (→ Cloudflare R2 عبر `/upload`) + handlers في `dashboard/app.js` + `functions/upload.js` |
| تعديل تسجيل الدخول/التسجيل | `app.js` | `doEmailLogin`/`doEmailSignup`/`authWithGoogle` |
| التحقق من دور المالك | `dashboard/app.js` | `checkRoleAndProceed` |
| **إضافة view للداشبورد** | `dashboard/index.html` (id=`view-*`) + `dashboard/app.js` (`goTo` + `render*`) |
| **إضافة صفحة أدمن** | `admin/*.html` جديدة + بطاقة في `admin-hub.html` |
| التقييمات | `dashboard/app.js` (`submitRating`) + `admin/ratings.html` |
| الإشعارات | `dashboard/app.js` (`loadNotifications`, `subscribeNotificationsRealtime`) |
| تعديل صفحة الباقات (أنيميشن) | `app.js` | `initPricingAnimations` + `_pkgCountUp` |
| تعديل PWA/الكاش | `manifest.json` + `sw.js` (+ `bump-version.ps1`) |
| تغيير مفاتيح Supabase | **كل** ملفات JS وصفحات admin (مكرّرة) |

---

## 14. تدفّقات شاملة (End-to-End Flows)

**أ) إضافة مساحة ونشرها:**
```
المالك (dashboard) → view-add-space → submitAddSpace
  → spaces INSERT {status:'pending', is_active:false} + space_units + notification
  → الأدمن (admin/spaces-hub.html) → doApprove
  → spaces UPDATE {status:'approved', is_active:true} + إشعار للمالك
  → Supabase Realtime → silentRefreshSpaces في index.html و spaces/
  → المساحة تظهر للعامة فوراً (مرتّبة حسب باقة المالك)
```

**ب) ترقية باقة:**
```
المالك → owner-request-modal → submitOwnerRequest → upgrade_requests INSERT {selected_plan, status:'pending'}
  → الأدمن (spaces-hub.html: changeOwnerPlan أو subscriptions.html: saveSub)
  → RPC admin_set_plan_tier → profiles.plan_tier UPDATE
  → ميزات الداشبورد تُفتح (canAccess) + ترتيب أعلى في الواجهة (_sortByPlan)
```

**ج) حجز مساحة:**
```
الزائر → openBooking → submitBooking → Apps Script (BOOKING_URL) + Supabase bookings → شاشة نجاح
```

**هـ) رفع صورة مساحة:**
```
المالك (dashboard) → handle*ImageUpload → media-handler.uploadImages
  → ضغط WebP (Canvas) → fetch POST /upload (functions/upload.js) → Cloudflare R2
  → يُعاد public URL (R2_PUBLIC_BASE) → يُخزَّن في spaces.image_url / extra_images / space_units.image_url
```

**د) معاينة مساحة:**
```
المستخدم → openInspectionModal → خطوات (_inspGoStep) → _inspSubmitForm → _inspConfirm
```

---

## 15. نقاط تقنية مهمة (Gotchas)

1. **RTL أولاً:** كل الكود للعربية — تجنّب `left/right`، استخدم `start/end`.
2. **SPA بدون Router:** التنقل عبر `showPage()` وليس `<a href>` (داخل `index.html`). أما `dashboard/`, `spaces/`, `admin/` فصفحات مستقلة.
3. **لا Frameworks:** Vanilla JS بالكامل (لا React/Vue/jQuery). كل صفحة مستقلة تكرّر دوالها الخاصة.
4. **المساحات من Supabase وليس Sheets:** لا تبحث عن `SHEET_URL` للمساحات — أُزيل. استخدم جداول `spaces`/`space_units`.
5. **شرط الظهور العام:** `status='approved' AND is_active=true` — أي مساحة بدونهما لن تظهر.
6. **Realtime:** أي تغيير في `spaces`/`space_units` يُبَثّ تلقائياً (debounce 1.5s) + polling احتياطي 5 دقائق. عند إضافة جدول جديد يحتاج بثّاً، سجّله في `subscribeSpacesRealtime`.
7. **مفاتيح Supabase مكرّرة** في كل ملف JS وكل صفحة admin — غيّرها في كلها معاً.
8. **بيانات مختلطة:** المساحات/التقييمات/الإشعارات في Supabase، لكن العقود/المستأجرون/المدفوعات/المخالفات لا تزال **localStorage** في الداشبورد (مفاتيح `contractsKey`/`paymentsKey`/`violationsKey`/`ratingsKey`).
9. **السلايدر الموحّد:** أي slider جديد يُسجَّل في `_sliders{}` ويتبع نمط `cs*` أو `sd*`.
10. **الفلاتر تتراكم:** في Marketplace راعِ `mpActiveTypes`/`mpActiveActs`/`mpPage` عند أي تعديل.
11. **الباقة تُقرأ من `profiles.plan_tier`** وتُخزّن في `currentOwner.planTier` / `currentProfile`. مستويات: `starter<growth<pro`.
12. **رفع الصور** عبر `media-handler.js` (ضغط WebP بـ Canvas) إلى **Cloudflare R2** عبر `/upload` — لا ترفع صوراً خام، ولا تستخدم Supabase Storage.
15. **صفحات الأدمن تتكلم REST مباشرةً** عبر `sbTable`/`sbRpc` (وليس supabase-js)، ومحميّة بكلمة سر `sha256` — عدا `admin/index.html` (المشاريع) المحمي بـ Bearer Token سيرفري. تغيير الباقات دائماً عبر RPC `admin_set_plan_tier`.
13. **الترميز:** ملفات HTML بترميز **UTF-8 with BOM** و **CRLF**. حافظ عليه عند التعديل لتفادي مشاكل العربية.
14. **روابط Google Drive للصور:** مرّرها عبر `_toDirectImgUrl()` لتحويلها لروابط عرض مباشرة.
