/**
 * إعدادات Supabase المشتركة — مصدر واحد بدل تكرار المفتاح والرابط
 * في كل صفحة (app.js, spaces/app.js, dashboard/app.js, admin/*.html).
 * حمّلها بـ <script src="/shared/sb-config.js"></script> قبل أي كود يستخدمها.
 * لتغيير مفاتيح Supabase: غيّرها هنا فقط.
 */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';

/* عميل واحد لكل صفحة (Singleton) — لا تُنشئ عميلاً ثانيًا بأي حال.
 *
 * لماذا: كل عميل Supabase يحمل نسخة GoTrue خاصة به تدير نفس مفتاح التخزين
 * (sb-<ref>-auth-token). ولأن Supabase **يدوّر** refresh_token عند كل تجديد،
 * فوجود نسختين تجدّدان بالتوازي يعني أن إحداهما تستهلك التوكن فتفشل الأخرى
 * بتوكن مُستهلَك — والفشل هنا ليس وميضًا بل **خروج فعلي** للمستخدم.
 * حدث هذا فعليًا: pwa-install.js كان ينشئ عميله الخاص على ٨ صفحات تملك
 * عميلها أصلاً. والجلسة مشتركة بين الصفحات (نفس localStorage)، فسباق على
 * صفحة واحدة يفسد التوكن الذي تقرأه بقية الصفحات.
 *
 * الحفظ في متغيّر واحد يجعل ترتيب النداء غير مهم: أول من ينادي يُنشئ،
 * والبقية يحصلون على نفس الكائن. (pwa-install.js سكربت defer فينادي قبل
 * DOMContentLoaded، والصفحات تنادي داخله — وكلاهما يصل لنفس النسخة.)
 *
 * الخيارات: لا شيء. كل مستهلك اليوم ينشئ العميل بلا خيارات إطلاقًا، فالمشاركة
 * آمنة. لو احتاجت صفحة خيارات مختلفة مستقبلاً، لا تلتفّ حول هذه الدالة —
 * الالتفاف يعيد المشكلة نفسها.
 */
let _makaniClient = null;

function createMakaniClient() {
  if (!_makaniClient) _makaniClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  return _makaniClient;
}
