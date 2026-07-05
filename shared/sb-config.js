/**
 * إعدادات Supabase المشتركة — مصدر واحد بدل تكرار المفتاح والرابط
 * في كل صفحة (app.js, spaces/app.js, dashboard/app.js, admin/*.html).
 * حمّلها بـ <script src="/shared/sb-config.js"></script> قبل أي كود يستخدمها.
 * لتغيير مفاتيح Supabase: غيّرها هنا فقط.
 */
const SUPABASE_URL = 'https://rxqkpjuvudweyovekvvx.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ4cWtwanV2dWR3ZXlvdmVrdnZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjEyNDgsImV4cCI6MjA5MjEzNzI0OH0.rqwOP-6B4s2H9GmgmfE3QkYbaQpS5dFX_Yf-hz6R2IE';

function createMakaniClient() {
  return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
