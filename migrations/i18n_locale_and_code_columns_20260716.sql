-- =============================================================
-- بنية دعم اللغتين (i18n) — تاريخ: 2026-07-16
-- =============================================================
-- الهدف: تجهيز DB لدعم الإنجليزية بدون كسر أي شيء — إضافات آمنة فقط
-- (أعمدة NULLABLE جديدة)، لا حذف ولا تعديل على أعمدة موجودة.
--
-- ⚠️ هذا الملف لم يُطبَّق على قاعدة البيانات بعد. قبل التطبيق:
--    1) شغّل SELECT DISTINCT badge FROM spaces WHERE badge IS NOT NULL;
--       و SELECT DISTINCT announcement_type, governorate FROM official_announcements;
--       للتأكد من كل القيم الفعلية الموجودة فعلاً في الإنتاج (الكود هنا
--       يغطي القيم المعروفة من قراءة الكود فقط، مش استعلام حي على البيانات).
--    2) وسّع كتلة الـ backfill تحت لو ظهرت قيم إضافية غير مغطاة.
--    3) طبّقه عبر Supabase (migration/SQL editor) بعد المراجعة.
-- =============================================================

-- ── 1. تفضيل اللغة على مستوى الحساب (profiles.preferred_locale) ──
-- NULL = لم يختر المستخدم صراحةً بعد (يُستخدم localStorage/المتصفح كافتراضي).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_locale text
    CHECK (preferred_locale IS NULL OR preferred_locale IN ('ar', 'en'));

-- ── 2. spaces.badge كان بيخزّن نص عربي حرفي ('متاح' مثلاً) بدل كود ──
-- (راجع dashboard/app.js — الدالة اللي بتكتب فيها). badge_code هو
-- الكود المحايد عن اللغة؛ badge الأصلي يفضل زي ما هو مؤقتًا للتوافق
-- الخلفي لحد ما كل أماكن القراءة تتحول لـ badge_code.
ALTER TABLE public.spaces
  ADD COLUMN IF NOT EXISTS badge_code text;

UPDATE public.spaces SET badge_code = 'available' WHERE badge = 'متاح' AND badge_code IS NULL;
-- أضف أسطر UPDATE مماثلة هنا لأي قيمة تانية تظهر من استعلام SELECT DISTINCT أعلاه.

-- ── 3. official_announcements: نفس المشكلة لعمودين ──
-- (راجع supabase-announcements-migration.sql للقيم الافتراضية الأصلية)
ALTER TABLE public.official_announcements
  ADD COLUMN IF NOT EXISTS announcement_type_code text,
  ADD COLUMN IF NOT EXISTS governorate_code text;

UPDATE public.official_announcements
  SET announcement_type_code = 'official_tender'
  WHERE announcement_type = 'مناقصة رسمية' AND announcement_type_code IS NULL;

UPDATE public.official_announcements
  SET governorate_code = 'unspecified'
  WHERE governorate = 'غير محدد' AND governorate_code IS NULL;
-- أضف أسطر UPDATE مماثلة هنا لأي قيم تانية تظهر من الاستعلام أعلاه.
