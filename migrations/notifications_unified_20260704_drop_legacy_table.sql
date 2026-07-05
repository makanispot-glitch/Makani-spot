-- =============================================================
-- نظام الإشعارات الموحّد — إكمال الترحيل + حذف الجدول القديم
-- تاريخ: 2026-07-04
-- راجع: docs/adr/0001-remove-legacy-bazaar-notifications-table.md
--
-- الترحيل الجزئي في notifications_unified_20260623.sql وحّد الشكل
-- ونقل البيانات، لكن ترك 4 دوال حية تكتب/تعتمد مباشرة على
-- user_bazaar_notifications (3 منها تكتب إشعارات مستخدم حقيقية:
-- إلغاء بازار، تأجيل بازار، انتهاء مهلة رد التأجيل). هذا الملف
-- يوثّق تحويلها + الحذف النهائي بعد التحقق الكامل من:
--   1) صفر دالة/View/Trigger/Policy/Cron تعتمد على الجدول أو الدالة.
--   2) صفر صف بيانات في الجدول وقت الحذف (لا فقد بيانات).
--   3) صفر مرجع في كود العميل (JS/HTML) بخلاف تعليق تاريخي.
-- =============================================================

-- 1) تحويل الدوال الثلاث الكاتبة للإشعارات لتستخدم notifications
--    الموحّد (bazaar_id/booking_id تنتقل إلى metadata jsonb، بنفس
--    نمط select_bazaar_organizer/submit_bazaar_opportunity/proposal):
--      - cancel_bazaar(p_bazaar_id, p_reason)
--      - postpone_bazaar(p_bazaar_id, p_new_start, p_new_end, p_reason, p_deadline)
--      - expire_postponement_responses()
--    (الأجسام الكاملة مُطبَّقة عبر Supabase migration
--     "redirect_bazaar_notifications_off_legacy_table" — انظر تاريخ
--     الهجرات في لوحة Supabase لنص CREATE OR REPLACE الكامل)

-- 2) إزالة سطر التنظيف المرجعي من admin_purge_bazaar (لا بديل مطلوب —
--    إشعارات notifications تُنظَّف عبر سياسة الاحتفاظ الزمنية بلا ربط
--    مباشر بحذف البازار)

-- 3) الحذف النهائي بعد التحقق:
DROP FUNCTION IF EXISTS public.cleanup_expired_notifications();
DROP TABLE IF EXISTS public.user_bazaar_notifications;

-- النتيجة: public.notifications هو المصدر الوحيد لكل إشعارات المنصة
-- (owner / organizer / bazaar / listing / space) دون استثناء.
