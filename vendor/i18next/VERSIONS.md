# Vendored i18next builds

هذه الملفات محمّلة يدويًا (vendored) بدل تحميلها من CDN حي، لأن فشل تحميلها بيأثر على كل النص المرئي بالصفحة قبل أول رسم (على عكس أي CDN تبعية تانية في المشروع). راجع `shared/i18n.js` للطريقة اللي بيتم تحميلها بيها.

لتحديث نسخة أي مكتبة: نزّل النسخة الجديدة من نفس الروابط تحت بنفس الاسم، اختبر يدويًا (`tests/smoke.spec.js` locale-switch test)، وحدّث الجدول ده.

| ملف | الحزمة | النسخة | المصدر |
|---|---|---|---|
| `i18next.min.js` | `i18next` | 26.3.6 | https://unpkg.com/i18next@26.3.6/dist/umd/i18next.min.js |
| `i18nextHttpBackend.min.js` | `i18next-http-backend` | 4.0.0 | https://unpkg.com/i18next-http-backend@4.0.0/i18nextHttpBackend.min.js |
| `i18nextBrowserLanguageDetector.min.js` | `i18next-browser-languagedetector` | 8.2.1 | https://unpkg.com/i18next-browser-languagedetector@8.2.1/dist/umd/i18nextBrowserLanguageDetector.min.js |

تحميل بتاريخ: 2026-07-16.
