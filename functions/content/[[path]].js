/**
 * Cloudflare Pages Function — يحجب /content/* بالكامل
 *
 * content/articles/*.md هو مصدر مركز المعرفة (يقرأه build-content.js
 * وقت البناء)، وغير مستبعد من .gitignore عمدًا لأنه المصدر الذي
 * يُنشر ويُنسَّخ احتياطيًا عبر Git. لكن Cloudflare Pages تقدّم كل ملف
 * في المستودع كأصل ثابت، فبلا هذه الدالة كانت كل مسودة أو مقال مخفي
 * مقروءً علنًا على /content/articles/{slug}.md — noindex في _headers
 * توجيه فهرسة لا تحكّم وصول، فنموذج «مسودة/مخفي/مجدول» بلا معنى عمليًا.
 *
 * [[path]] يطابق /content و/content/أي-شيء متداخل. Functions تُقدَّم
 * قبل الأصول الثابتة دائمًا في Cloudflare Pages، فهذا يحجب الوصول
 * كليًا بصرف النظر عن وجود الملف الفعلي — بلا SSR وبلا منطق عمل،
 * حجب وصول بسيط فقط (نفس فئة functions/admin/*.js الموجودة أصلًا).
 */
export async function onRequest() {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    },
  });
}
