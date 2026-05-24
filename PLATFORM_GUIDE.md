# دليل منصة مكاني Spot — للذكاء الاصطناعي
> **الهدف:** هذا الملف مرجع تقني شامل ومختصر للمنصة. اقرأه أولاً قبل أي تعديل لتعرف أين تذهب مباشرةً دون البحث في الكود.

---

## 1. نظرة عامة على المنصة

**مكاني Spot** منصة عربية (RTL) لاستئجار مساحات صغيرة في مولات، نوادٍ، ومدارس في مصر.
- **نوع المستخدمين:** مستأجرون (Tenants) · أصحاب مساحات (Owners) · مدراء (Admins)
- **البنية:** Vanilla HTML/CSS/JS · Supabase Auth/DB · Google Sheets (بيانات المساحات) · Cloudflare Pages (hosting) · PWA

---

## 2. شجرة الملفات الكاملة

```
Makani-spot/
│
├── index.html              ← الصفحة الرئيسية (SPA — كل الصفحات داخلها)
├── app.js                  ← المنطق الرئيسي للتطبيق (2,800+ سطر)
├── style.css               ← نظام التصميم الكامل (4,585 سطر)
├── sw.js                   ← Service Worker (PWA / offline)
├── manifest.json           ← PWA manifest
├── media-handler.js        ← رفع الصور إلى Supabase Storage
├── offline.html            ← صفحة Offline fallback
├── robots.txt
├── _headers                ← Cloudflare Pages headers
│
├── spaces/
│   ├── index.html          ← صفحة تصفح المساحات (standalone)
│   └── app.js              ← منطق صفحة المساحات
│
├── bazaars/
│   ├── index.html          ← تصفح بازارات
│   ├── app.js              ← منطق البازار
│   ├── organize.html       ← إنشاء بازار
│   ├── organize.js
│   ├── profile.html        ← ملف المنظِّم
│   ├── profile.js
│   ├── verification.html   ← طلب توثيق المنظِّم
│   └── verification.js
│
├── dashboard/
│   ├── index.html          ← لوحة تحكم صاحب المساحة
│   └── app.js
│
├── market/
│   ├── index.html          ← سوق المشاريع الجاهزة
│   └── app.js
│
├── post-ad/
│   └── index.html          ← نشر مشروع للبيع
│
├── catalog/
│   └── index.html          ← كتالوج المشاريع
│
├── admin/
│   ├── index.html          ← دخول الأدمن
│   ├── admin-hub.html      ← مركز تحكم الأدمن
│   ├── makani-admin-v3-fixed.html
│   ├── bazaar-dashboard.html
│   └── organizer-requests.html
│
├── policies/
│   └── index.html          ← الشروط والسياسات
│
├── functions/
│   ├── admin/auth.js
│   ├── admin/listings.js
│   └── upload.js
│
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    ├── icon.svg
    └── maskable.svg
```

---

## 3. الملف الرئيسي: `index.html` (SPA)

> **كل الصفحات مضمّنة داخل ملف واحد** ويتم التنقل بينها عبر `showPage()` في `app.js`.
> الصفحة النشطة تحمل class `active`؛ الباقية مخفية.

### الصفحات المضمّنة (Pages)

| Page ID | الوصف | يُفعَّل عبر |
|---------|--------|-------------|
| `#pg-home` | الرئيسية: Hero + فلاتر + شبكة بطاقات | افتراضي |
| `#pg-how` | كيف يعمل المنصة؟ | `showPage('how')` |
| `#pg-owner` | لأصحاب المساحات | `showPage('owner')` |
| `#pg-login` | تسجيل الدخول | `showPage('login')` |
| `#pg-signup` | إنشاء حساب | `showPage('signup')` |
| `#pg-market` | سوق المساحات (Marketplace) | `showPage('market')` |
| `#pg-space-detail` | تفاصيل مساحة واحدة | `openSpaceDetail(id)` |

### الأقسام العامة (في كل صفحة)

```
<nav class="nav">                ← شريط التنقل العلوي
  #nav-guest                    ← زر "دخول" (للزوار)
  #nav-logged                   ← زر الأفاتار + قائمة المستخدم
  #nav-dropdown                 ← قائمة منسدلة (ملفي، لوحتي، تسجيل خروج)

#booking-modal                  ← مودال الحجز (مشترك بين الصفحات)
  .modal-overlay > .modal
    #bk-name, #bk-phone, #bk-email
    #bk-size, #bk-dur, #bk-date, #bk-notes
    .act-pick-btn[]             ← أزرار اختيار النشاط
```

---

## 4. `app.js` — خريطة الكود

> **الملف الرئيسي.** كل وظيفة تنتمي لقسم محدد. استخدم الأرقام أدناه للقفز مباشرة.

### 4-أ. الإعدادات والمتغيرات العامة (أسطر 1–90)

```javascript
SHEET_URL          // Google Apps Script → بيانات المساحات
BOOKING_URL        // Apps Script → حفظ الحجوزات
BAZAAR_SHEET_URL   // Apps Script → بيانات البازارات
SUPABASE_URL       // Supabase endpoint
SUPABASE_KEY       // Supabase anon key

// المتغيرات العالمية:
SPACES[]           // كل المساحات المحمّلة
ACTIVITIES[]       // أنواع الأنشطة
activeTab          // الفلتر النشط (mall/club/school)
selectedAct        // النشاط المختار في الفلتر
sbClient           // Supabase client
currentUser        // المستخدم المسجَّل
currentProfile     // بيانات ملف المستخدم
BAZAARS[]          // قائمة البازارات
_sliders{}         // حالة كل slider نشط
```

### 4-ب. التهيئة عند التحميل (أسطر 92–155)

```javascript
DOMContentLoaded →
  sbClient = supabase.createClient(...)
  loadData()           // جلب المساحات
  loadBazaars()        // جلب البازارات
  initAuth()           // فحص حالة تسجيل الدخول
  initPriceSlider()    // سلايدر السعر (الرئيسية)
  initPathAnimation()  // أنيميشن الـ path cards عند التمرير
```

### 4-ج. جلب البيانات (أسطر 222–280)

```javascript
loadData()
  ← fetch(SHEET_URL)
  ← يملأ SPACES[] و ACTIVITIES[]
  ← يستدعي buildActivityFilters()
  ← يستدعي renderCards(SPACES.slice(0,6), '#spaces-grid', true)

loadBazaars()
  ← fetch(BAZAAR_SHEET_URL)
  ← يملأ BAZAARS[]
  ← يعرض البازارات في قسم .bz-home-section

// هيكل كائن المساحة:
{
  id, name, loc, type, price,
  sizes[],          // مصفوفة أحجام (م²)
  acts[],           // أنشطة مختصرة (للعرض)
  allActs[],        // كل الأنشطة
  badge, badgeClass,
  season, insight,
  image,            // صورة رئيسية
  extraImages[],    // صور إضافية
  description,
  amenities[],
  subSpaces: [{
    unitId, name, location, size,
    price, status, image, floor, notes
  }]
}
```

### 4-د. بناء وعرض البطاقات (أسطر 336–458)

```javascript
buildCardHtml(space, fromPage)
  ← ينتج HTML لبطاقة واحدة
  ← يدعم slider متعدد الصور (.card-slider)
  ← يعرض شارة الحالة (.card-badge)
  ← زر "تفاصيل" إذا كان للمساحة subSpaces أو extraImages
  ← زر "احجز الآن" → openBooking(id)

renderCards(data, gridId, showViewAll, fromPage)
  ← يملأ أي grid ببطاقات المساحات
  ← يعرض "لا توجد نتائج" إذا كانت data فارغة
```

### 4-هـ. نظام السلايدر (أسطر 655–881)

**بطاقات المساحات (Card Slider — بادئة `cs`):**
```javascript
csInitAll()              // تهيئة كل .card-slider في الصفحة
csGoTo(id, index)        // الانتقال لشريحة محددة
csNext(id), csPrev(id)   // تنقل يدوي
_csStartAuto(id)         // تقليب تلقائي كل 3.8 ثانية
_csInitSwipe(el, id)     // دعم السحب (موبايل)
```

**صفحة التفاصيل (Detail Slider — بادئة `sd`):**
```javascript
_sdInit(id, total)       // تهيئة
sdGoTo(id, index)        // الانتقال
sdNext(id), sdPrev(id)   // تنقل يدوي
_sdStartAuto(id)         // تقليب تلقائي كل 4.5 ثانية
_sdInitSwipe(el, id)     // دعم السحب
_sdCleanup(id)           // إيقاف التايمر عند الإغلاق
```

**حالة السلايدر** محفوظة في:
```javascript
_sliders[id] = { index, total, autoTimer, paused }
```

### 4-و. صفحة تفاصيل المساحة (أسطر 472–1051)

```javascript
openSpaceDetail(spaceId, fromPage)
  ← يبني الصفحة ديناميكياً
  ← يستدعي _renderDetailGallery(space)   // slider الصور
  ← يستدعي _renderDetailInfo(space)      // وصف + مرافق + أحجام
  ← يستدعي _renderSubSpaces(space)       // شبكة الوحدات

closeSpaceDetail()
  ← يعود للصفحة السابقة + _sdCleanup()

openBookingForUnit(spaceId, unitId)
  ← يفتح مودال الحجز مع تحديد الوحدة مسبقاً
```

### 4-ز. البحث والفلتر (الرئيسية) (أسطر 1288–1352)

```javascript
setTab(el, type)      // الفلتر: mall | club | school
doSearch()            // يطبّق الفلاتر ويُحدِّث الشبكة
filterAndRender()     // المنطق الأساسي للفلتر:
                      //   region + type + price + activity

showSearchChips()     // يعرض الفلاتر النشطة كـ chips
clearAllFilters()     // يصفّر كل الفلاتر
```

### 4-ح. صفحة السوق/Marketplace (أسطر 1090–1269)

```javascript
goToMarketplace()         // التوجيه إلى /spaces/
toggleMpType(type, el)    // فلتر النوع (mall/club/school)
toggleMpAct(id, el)       // فلتر النشاط
applyMpFilters()          // تطبيق كل الفلاتر
clearMpFilters()          // تصفير
updateMpChips()           // عرض chips الفلاتر النشطة
renderMarketplace()       // عرض الشبكة (12 بطاقة/صفحة)
renderMpPagination()      // أزرار الترقيم
mpGoPage(n)               // الانتقال لصفحة N
initMpSlider()            // سلايدر السعر في Marketplace
```

### 4-ط. التنقل بين الصفحات (أسطر 1365–1415)

```javascript
showPage(pageName)
  // الأسماء المقبولة: 'home' | 'how' | 'owner' | 'login' | 'signup' | 'market' | 'space-detail'
  ← يخفي كل الصفحات (.page)
  ← يضيف .active للصفحة المطلوبة
  ← يحدّث highlight شريط التنقل
  ← يهيّئ Marketplace عند أول فتح

scrollToSearch()   // تمرير للـ #search-anchor
goToLogin()        // showPage('login')
goToDashboard()    // تحميل بيانات المالك + showPage('dashboard')
```

### 4-ي. الحجز (أسطر 1421–1600)

```javascript
openBooking(spaceId)
  ← يملأ بيانات المساحة في المودال
  ← يملأ بيانات المستخدم المسجّل تلقائياً

closeModal()              // إغلاق المودال
submitBooking()
  ← تحقق: الاسم + الهاتف (10+ أرقام) + النشاط
  ← إرسال إلى BOOKING_URL (Google Apps Script)
  ← حفظ في Supabase (جدول bookings)
  ← عرض شاشة النجاح
```

### 4-ك. المصادقة (Auth)

```javascript
initAuth()                // فحص الجلسة عند التحميل
doEmailLogin()            // تسجيل دخول بالإيميل
doEmailSignup()           // إنشاء حساب
authWithGoogle()          // OAuth عبر Google
doLogout()                // تسجيل الخروج
toggleUserDropdown()      // فتح/إغلاق قائمة المستخدم
```

---

## 5. `style.css` — خريطة التصميم

> **نظام التصميم مبني على CSS Variables.** كل تعديل بصري يبدأ من الـ `:root`.

### 5-أ. المتغيرات الجذرية (أسطر 1–140)

```css
/* الألوان الأساسية */
--orange-500: #F36418;   /* البرتقالي الرئيسي */
--orange-600: #D95A14;
--navy-900: #0E1218;     /* أغمق خلفية */
--navy-700: #212833;     /* خلفية القسم الداكن */

/* الخطوط */
--font-display: 'Cairo'
--font-body: 'IBM Plex Sans Arabic'
--font-latin: 'Inter'

/* الإشعاعات والظلال */
--shadow-sm, --shadow-base, --shadow-lg
--shadow-orange     /* توهج برتقالي */

/* التحريك */
--dur-instant: 80ms
--dur-base: 240ms
--dur-slow: 360ms
--ease-out-quart
```

### 5-ب. خريطة الأقسام الرئيسية في style.css

| الأسطر | القسم | العناصر الرئيسية |
|--------|--------|-------------------|
| 165–376 | **Navbar** | `.nav`, `.logo`, `.nav-links`, `.nav-dropdown`, `.nav-avatar-btn`, `.btn-login-nav` |
| 380–436 | **Buttons** | `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-tint`, `.btn-view-all` |
| 442–452 | **Page System** | `.page`, `.page.active` (fade-up animation) |
| 456–512 | **Hero** | `.hero`, `.hero-pill`, `.hero h1`, `.hero-stats` |
| 517–636 | **Search/Filter** | `.search-wrap`, `.search-box`, `.price-slider-wrap`, `.active-chips`, `.chip` |
| 641–723 | **Space Cards** | `.cards-grid`, `.space-card`, `.card-thumb`, `.card-slider`, `.card-badge`, `.card-body`, `.card-footer` |
| 729–777 | **How Section** | `.path-card`, `.how-detail-card` |
| 781–785 | **Animations** | `@keyframes blink, spin, pulse, popIn, modalPop` |
| 791–874 | **Modal** | `.modal-overlay`, `.modal`, `.modal-header`, `.afg`, `.act-pick-btn` |
| 879–1003 | **Auth Pages** | `.auth-fullpage`, `.auth-panel-left/right`, `.btn-google-auth`, `.btn-auth-submit` |
| 1010–1120 | **Space Detail** | `.sd-header`, `.sd-gallery-wrap`, `.sd-slider`, `.sd-arrow`, `.sd-thumbs-row`, `.sd-info`, `.sub-grid`, `.sub-card`, `.sub-status` |
| 1130–1207 | **Owner Page** | `.owner-hero`, `.owner-features`, `.feature-card`, `.step-card` |
| 1208–1280 | **Marketplace Pagination** | `.mp-pagination`, `.pg-btn`, `.pg-dots` |

---

## 6. الصفحات المستقلة (Standalone Pages)

### `/spaces/` — تصفح المساحات
- **الملفات:** `spaces/index.html` + `spaces/app.js`
- نفس بطاقات الرئيسية لكن مع:
  - تصفية متقدمة في sidebar
  - Pagination (12 بطاقة/صفحة)
  - سلايدر السعر خاص بها

### `/bazaars/` — البازارات
- **الملفات:** `bazaars/index.html` + `bazaars/app.js`
- عرض الفعاليات القادمة مع فلاتر (المنطقة، التواريخ، رسوم الدخول)
- نظام حجز مقاعد للباعة

### `/bazaars/organize.html` — إنشاء بازار
- **الملف:** `bazaars/organize.html` + `bazaars/organize.js`
- نموذج لإنشاء فعالية: الاسم، التواريخ، الموقع، رسوم الدخول، عدد الأكشاك
- محرر خريطة الأكشاك التفاعلي (2D Seat Mapper)

### `/dashboard/` — لوحة تحكم المالك
- **الملفات:** `dashboard/index.html` + `dashboard/app.js`
- Dark Theme (Charcoal + Orange)
- تبويبات: المساحات · الحجوزات · البازارات · التقارير · الإعدادات
- محمية بـ Auth (Supabase)

### `/market/` — سوق المشاريع
- **الملفات:** `market/index.html` + `market/app.js`
- بيع/شراء مشاريع جاهزة
- بطاقات المشروع: صور، وصف، تجهيزات، سعر، بيانات البائع

### `/post-ad/` — نشر مشروع للبيع
- **الملف:** `post-ad/index.html`
- نموذج: عنوان، فئة، حالة، وصف، صور، قائمة التجهيزات، سعر، تواصل

---

## 7. ملفات مساعدة مهمة

### `sw.js` — Service Worker
```javascript
// استراتيجية الكاش:
// 1. Static assets → Cache First
// 2. API requests → Network First
// 3. Fallback → offline.html
// عند تحديث النسخة: حذف الكاش القديم تلقائياً
```

### `media-handler.js`
```javascript
// رفع الصور:
// 1. ضغط الصورة قبل الرفع (Canvas resize)
// 2. رفع إلى Supabase Storage
// 3. إرجاع الـ public URL
```

### `manifest.json`
```json
{
  "name": "مكاني Spot — منصة المساحات الصغيرة",
  "theme_color": "#FF6B00",
  "background_color": "#0C0C0C",
  "dir": "rtl", "lang": "ar",
  "shortcuts": [
    { "name": "مشاريع", "url": "/market/" },
    { "name": "أعلن", "url": "/post-ad/" }
  ]
}
```

---

## 8. دليل المهام السريعة

> استخدم هذا القسم لمعرفة **أين تذهب** لكل نوع من التعديلات.

| التعديل المطلوب | الملف | القسم/الدالة |
|----------------|-------|---------------|
| تغيير لون أساسي | `style.css` | `:root` (أسطر 1–140) |
| تعديل شريط التنقل | `style.css` | أسطر 165–376 · `index.html > nav.nav` |
| تعديل بطاقة المساحة (تصميم) | `style.css` | أسطر 641–723 |
| تعديل بطاقة المساحة (محتوى) | `app.js` | `buildCardHtml()` |
| تعديل فلاتر الرئيسية | `app.js` | `doSearch()` + `filterAndRender()` |
| تعديل مودال الحجز (تصميم) | `style.css` | أسطر 791–874 |
| تعديل مودال الحجز (منطق) | `app.js` | `openBooking()` + `submitBooking()` |
| تعديل صفحة تفاصيل المساحة (تصميم) | `style.css` | أسطر 1010–1120 |
| تعديل صفحة تفاصيل المساحة (منطق) | `app.js` | `openSpaceDetail()` + `_render*()` |
| تعديل سلوك السلايدر | `app.js` | أسطر 655–881 (`cs*` و`sd*`) |
| تعديل صفحة Hero | `style.css` أسطر 456–512 · `index.html #pg-home > section.hero` |
| تعديل صفحة تسجيل الدخول | `style.css` أسطر 879–1003 · `index.html #pg-login` |
| تعديل Marketplace / Pagination | `app.js` | `renderMarketplace()` + `renderMpPagination()` |
| تعديل التنقل بين الصفحات | `app.js` | `showPage()` |
| تعديل لوحة تحكم المالك | `dashboard/index.html` + `dashboard/app.js` |
| تعديل صفحة البازارات | `bazaars/index.html` + `bazaars/app.js` |
| تعديل PWA (أيقونة، اسم) | `manifest.json` + `icons/` |
| تعديل Offline page | `offline.html` + `sw.js` |
| تعديل سياسات الكاش | `sw.js` |
| تعديل رفع الصور | `media-handler.js` |

---

## 9. مصادر البيانات

```
Google Sheets (عبر Apps Script) ← بيانات المساحات (SPACES)
                                ← بيانات البازارات (BAZAARS)
                                ← حفظ الحجوزات

Supabase ← Auth (تسجيل الدخول / Google OAuth)
         ← جدول bookings (الحجوزات)
         ← جدول profiles (ملفات المستخدمين)
         ← Storage (الصور المرفوعة)
```

---

## 10. نقاط تقنية مهمة

1. **RTL أولاً:** كل الكود مبني للعربية — تجنب استخدام `left/right` في CSS، استخدم `start/end` أو تأكد من وجود مكافئ RTL.
2. **SPA بدون Router:** التنقل بين الصفحات يعتمد على `showPage()` في `app.js` وليس `<a href>`.
3. **السلايدر الموحّد:** أي slider جديد يجب أن يُسجَّل في `_sliders{}` واتبع نفس نمط `cs*` أو `sd*`.
4. **لا Frameworks:** المشروع vanilla JS بالكامل — لا React، لا Vue، لا jQuery.
5. **بيانات المساحات من Sheets:** تحديث البيانات يكون من Google Sheets مباشرة، وليس من DB.
6. **الفلاتر تتراكم:** في Marketplace، الفلاتر متعددة الاختيار ويجب مراعاة حالة `activeFilters{}`.
