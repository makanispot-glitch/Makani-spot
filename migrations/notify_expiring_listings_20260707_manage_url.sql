-- =============================================================
-- إصلاح توجيه إشعارات انتهاء الإعلان — تاريخ: 2026-07-07
-- =============================================================
-- المشكلة: notify_expiring_listings() كانت تضع action_url على
-- '/market/?listing=' || id — نفس رابط العرض العام للإعلان، فيفتح
-- market/app.js بروفايل الإعلان العام (eqOpenDetail) بدل ما يوجّه
-- صاحب الإعلان لإدارة/تعديل إعلانه مباشرة.
--
-- الحل: تغيير action_url إلى '/market/?manage=' || id — بارام جديد
-- منفصل عن ?listing= (المستخدم في المشاركة والعرض العام)، يفتحه
-- market/app.js عبر eqOpenMyListings() + eqOpenEdit(id) مباشرة.
-- =============================================================

CREATE OR REPLACE FUNCTION public.notify_expiring_listings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  WITH due AS (
    UPDATE public.listings
    SET notified_7d = true
    WHERE status = 'approved' AND notified_7d = false
      AND expires_at <= now() + interval '7 days'
      AND expires_at >  now() + interval '3 days'
    RETURNING id, user_id, title
  )
  INSERT INTO public.notifications(user_id, type, source, title, body, listing_id, action_url, is_read, created_at)
  SELECT due.user_id, 'listing_expiring_7d', 'marketplace',
         '⏳ إعلانك سينتهي قريباً',
         'إعلانك "' || due.title || '" سينتهي خلال 7 أيام. قم بتجديده للحفاظ على ظهوره داخل السوق.',
         due.id, '/market/?manage=' || due.id, false, now()
  FROM due;

  WITH due AS (
    UPDATE public.listings
    SET notified_3d = true
    WHERE status = 'approved' AND notified_3d = false
      AND expires_at <= now() + interval '3 days'
      AND expires_at >  now() + interval '1 day'
    RETURNING id, user_id, title
  )
  INSERT INTO public.notifications(user_id, type, source, title, body, listing_id, action_url, is_read, created_at)
  SELECT due.user_id, 'listing_expiring_3d', 'marketplace',
         '⚠️ باقي 3 أيام على انتهاء إعلانك',
         'باقي 3 أيام فقط على انتهاء إعلانك "' || due.title || '". جدّده الآن حتى لا يختفي من السوق.',
         due.id, '/market/?manage=' || due.id, false, now()
  FROM due;

  WITH due AS (
    UPDATE public.listings
    SET notified_24h = true
    WHERE status = 'approved' AND notified_24h = false
      AND expires_at <= now() + interval '24 hours'
      AND expires_at >  now()
    RETURNING id, user_id, title
  )
  INSERT INTO public.notifications(user_id, type, source, title, body, listing_id, action_url, is_read, created_at)
  SELECT due.user_id, 'listing_expiring_24h', 'marketplace',
         '🚨 أقل من 24 ساعة على انتهاء إعلانك',
         'تبقى أقل من 24 ساعة على انتهاء إعلانك "' || due.title || '". قم بالتجديد الآن قبل اختفائه من السوق.',
         due.id, '/market/?manage=' || due.id, false, now()
  FROM due;
END;
$function$;
