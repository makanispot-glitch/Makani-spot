/**
 * مصدر واحد لـ"شارة باقة الاشتراك" على المساحات — بدل تكرار نفس المنطق
 * حرفيًا في app.js وspaces/app.js (نسختان مطابقتان تمامًا قبل هذا الملف).
 * حمّلها بـ <script src="/shared/plan-badge.js"></script> قبل ملف الصفحة المستهلك.
 *
 * تصميم متعمّد (مرحلة ٥ — فصل دلالات "موثّق"):
 * - هذه شارة "مستوى باقة مدفوعة" فقط — ليست توثيق هوية. لذلك لا تستخدم أبدًا
 *   كلمة "موثّق" ولا علامة ✓، لأن الاثنتين محجوزتان حصريًا لتوثيق الهوية
 *   الحقيقي (profiles.is_verified / organizer_profiles.is_verified عبر
 *   getAccountCapabilities في shared/account.js). كان النص القديم "✓ موثّق"
 *   يجعل باقة Growth تظهر بنفس رمز توثيق الهوية رغم أنها مجرد اشتراك مدفوع.
 * - النمط متّبع من باقة Pro الموجودة أصلًا ("🏆 شريك معتمد") التي لم تكن
 *   تعاني من هذا التصادم من الأصل — Growth الآن تتبع نفس الأسلوب.
 * - دالة نقية: لا تلمس DOM، ترجع بيانات الشارة فقط؛ الصفحة تقرر الوسم (card/inline).
 *
 * @param {object} s - كائن المساحة (يحتاج planTier و/أو isBroker فقط)
 * @returns {{cls:string, icon:string, text:string}|null} بيانات الشارة، أو null إن لم تستحق المساحة أي شارة (starter)
 */
function getPlanBadgeInfo(s) {
  if (s?.isBroker) return { cls: 'trust-makani', icon: '🏠', text: 'مكاني Spot' };
  const tier = (s?.planTier || 'starter').toLowerCase();
  if (tier === 'broker') return { cls: 'trust-broker', icon: '🏛️', text: 'بروكر' };
  if (tier === 'pro')    return { cls: 'trust-partner', icon: '🏆', text: 'شريك معتمد' };
  if (tier === 'growth') return { cls: 'trust-verified', icon: '⭐', text: 'شريك Growth' };
  return null;
}

/** شارة عائمة أعلى صورة بطاقة المساحة (card-trust-badge) */
function planTrustBadgeCardHtml(s) {
  const b = getPlanBadgeInfo(s);
  return b ? `<span class="card-trust-badge ${b.cls}">${b.icon} ${b.text}</span>` : '';
}

/** شارة inline بجانب عنوان صفحة تفاصيل المساحة (sd-trust-badge) */
function planTrustBadgeInlineHtml(s) {
  const b = getPlanBadgeInfo(s);
  return b ? `<span class="sd-trust-badge ${b.cls}">${b.icon} ${b.text}</span>` : '';
}
