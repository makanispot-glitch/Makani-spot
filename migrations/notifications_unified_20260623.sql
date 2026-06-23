-- =============================================================
-- نظام الإشعارات الموحّد — migration v1
-- تاريخ: 2026-06-23
-- =============================================================

-- 1. إضافة عمود user_id إلى جدول notifications (إذا لم يكن موجوداً)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. نسخ القيم من owner_id → user_id (للبيانات القديمة)
UPDATE notifications
SET user_id = owner_id::uuid
WHERE user_id IS NULL AND owner_id IS NOT NULL;

-- 3. إضافة حقول جديدة
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS source   text,
  ADD COLUMN IF NOT EXISTS body     text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata  jsonb DEFAULT '{}';

-- 4. تعيين expires_at للإشعارات القديمة (90 يوم من created_at)
UPDATE notifications
SET expires_at = created_at + interval '90 days'
WHERE expires_at IS NULL;

-- 5. نقل بيانات user_bazaar_notifications → notifications
INSERT INTO notifications (
  user_id, title, body, type, source,
  action_url, is_read, created_at, expires_at
)
SELECT
  ubn.user_id,
  ubn.title,
  ubn.body,
  ubn.type,
  'bazaar' AS source,
  ubn.action_url,
  ubn.is_read,
  ubn.created_at,
  ubn.created_at + interval '90 days'
FROM user_bazaar_notifications ubn
WHERE NOT EXISTS (
  SELECT 1 FROM notifications n
  WHERE n.user_id = ubn.user_id
    AND n.created_at = ubn.created_at
    AND n.title = ubn.title
);

-- 6. فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON notifications(user_id);

CREATE INDEX IF NOT EXISTS idx_notifications_is_read
  ON notifications(user_id, is_read)
  WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON notifications(expires_at)
  WHERE expires_at IS NOT NULL;

-- 7. RLS: يرى كل مستخدم إشعاراته فقط
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_see_own_notifications" ON notifications;
CREATE POLICY "users_see_own_notifications"
  ON notifications FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "users_update_own_notifications" ON notifications;
CREATE POLICY "users_update_own_notifications"
  ON notifications FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- الأدمن والنظام يقدرون يكتبون
DROP POLICY IF EXISTS "service_insert_notifications" ON notifications;
CREATE POLICY "service_insert_notifications"
  ON notifications FOR INSERT
  WITH CHECK (true); -- يُحكَم على المستوى التطبيقي

-- 8. RPC لتنظيف الإشعارات القديمة (90 يوم)
CREATE OR REPLACE FUNCTION cleanup_old_notifications(p_days int DEFAULT 90)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count int;
BEGIN
  DELETE FROM notifications
  WHERE (
    (is_read = true AND created_at < NOW() - (p_days || ' days')::interval)
    OR
    (expires_at IS NOT NULL AND expires_at < NOW())
  );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- =============================================================
-- (اختياري) جدول تفضيلات الإشعارات — للمستقبل
-- =============================================================
CREATE TABLE IF NOT EXISTS notification_preferences (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  channel     text NOT NULL,  -- 'email' | 'whatsapp' | 'push'
  source      text NOT NULL,  -- 'booking' | 'bazaar' | 'payment' | 'all'
  enabled     boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(user_id, channel, source)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_manage_own_prefs"
  ON notification_preferences
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- =============================================================
-- ملاحظة: بعد تشغيل هذا الـ migration، تحقق من:
-- 1. notifications.user_id مملوء لكل الصفوف
-- 2. RLS يمنع المستخدمين من رؤية إشعارات غيرهم
-- 3. اختبر cleanup_old_notifications(90) يعمل بدون أخطاء
-- =============================================================
