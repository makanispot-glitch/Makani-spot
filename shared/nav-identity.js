/**
 * كاش عرض ناف المستخدم — الوجه الكاتب لسكربت التمهيد الـinline.
 * الوجه القارئ موجود في shared/nav-boot-snippet.html (يُنسخ inline في <head>
 * لأنه لا بد أن يعمل قبل أول رسمة). هذا الملف يُحمَّل بـdefer لأن الكتابة
 * تحدث بعد وصول البيانات من الشبكة، أي بعد الرسم بكثير.
 *
 * ⚠️ Optimistic UI فقط — ليس مصدر حقيقة:
 *   - «هل المستخدم مسجَّل؟»  → getSession() من Supabase.
 *   - «ماذا يملك من صلاحيات؟» → getAccountCapabilities() فوق profiles/
 *     organizer_profiles، وRLS هو الحارس الفعلي على القاعدة.
 *   أسوأ ما يفعله خطأ هنا هو رسم اسم خاطئ لجزء من الثانية — لا منح صلاحية.
 *
 * الحقول مقصورة عمدًا على ما يُرسم في الناف المطويّ. لا تُضِف حقلًا لمجرد
 * أنه متاح: كل حقل هنا نسخة قد تتقادم، ويجب أن يكون ثمنه مبرَّرًا برسمة.
 */

const MK_NAV_ID_KEY = 'makani_nav_identity';

/**
 * @param {object} o
 * @param {string} o.userId - إلزامي. بدونه لا يُكتب شيء: الكاش بلا هوية صاحبه
 *   هو بالضبط السيناريو الذي يُظهر بيانات مستخدم سابق لمستخدم جديد.
 */
function cacheNavIdentity(o) {
  try {
    if (!o || !o.userId) return;
    localStorage.setItem(MK_NAV_ID_KEY, JSON.stringify({
      userId:      o.userId,
      name:        o.name  || '',
      email:       o.email || '',
      /* يُصفّى عند الكتابة أيضًا لا عند القراءة فقط — مخطط غير مسموح لا يستحق
         أن يُخزَّن أصلًا (R2/Supabase Storage كلاهما https). */
      avatar:      /^(https:\/\/|data:image\/)/.test(o.avatar || '') ? o.avatar : '',
      isOrganizer: !!o.isOrganizer
    }));
  } catch (e) { /* حصة التخزين ممتلئة أو وضع خاص — الكاش تحسين لا وظيفة */ }
}

function clearNavIdentity() {
  try { localStorage.removeItem(MK_NAV_ID_KEY); } catch (e) {}
}

/**
 * يرسم دائرة الأفاتار: الصورة إن صحّ مخططها، وإلا الحرف الأول.
 *
 * سبب وجودها: القوالب الثلاثة كانت تبني الوسم بنص —
 *   `<img src="${url}" onerror="this.outerHTML='${initial}'">`
 * و`initial` مشتق من profiles.full_name أي **مُدخَل مستخدم**، مُدرَج داخل
 * سمة onerror داخل نص JS. اسم فيه علامة اقتباس يكسر المعالج، واسم مُعَدّ
 * يحقن تنفيذًا. البناء بإسناد خصائص يغلق هذا الباب نهائيًا.
 *
 * (سكربت التمهيد الـinline في <head> يكرّر هذا المنطق عمدًا — لا يستطيع
 *  الاعتماد على ملف مؤجَّل لأنه يعمل قبل أول رسمة.)
 */
function paintNavAvatar(el, url, initial) {
  if (!el) return;
  el.textContent = initial;
  if (!/^(https:\/\/|data:image\/)/.test(url || '')) return;
  const img = new Image();
  img.alt = '';
  img.onerror = () => { el.textContent = initial; };
  img.src = url;
  el.textContent = '';
  el.appendChild(img);
}
