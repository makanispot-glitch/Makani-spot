/**
 * مصدر واحد لاشتقاق "قدرات الحساب" من بيانات البروفايل — بدل تكرار
 * فحوص role/roles[]/is_verified مباشرة في app.js وspaces/app.js وdashboard/app.js
 * وbazaars/app.js وbazaars/profile.js (كل ملف كان يعيد كتابة نفس الفحص بمنطقه الخاص).
 * حمّلها بـ <script src="/shared/account.js"></script> قبل ملف الصفحة الذي يستهلكها.
 *
 * تصميم متعمّد:
 * - دالة نقية: لا تقرأ من DOM ولا تبني أي واجهة — ترجع حقائق فقط، والصفحة
 *   تقرر بنفسها ماذا تعرض. هذا يبقيها صالحة لأي استهلاك مستقبلي (بروفايل عام،
 *   مشاركة، Reputation، Badges...) بدون أي حاجة لإعادة تصميمها.
 * - تُرجع "قدرات" مشتقة بأسماء صريحة الدلالة، وليس البيانات الخام كما هي —
 *   isOwner مثلاً مُشتقّة من role، لا role نفسها.
 * - لا تدمج حقائق مختلفة الأصل في حقل واحد (organizerVerified وidentityVerified
 *   مثلاً تبقيان منفصلتين حتى لو كانت بعض الصفحات تدمجهما اليوم في نص واحد —
 *   الدمج قرار عرض يبقى في الصفحة نفسها، لا في هذه الدالة).
 * - إضافة قدرة جديدة مستقبلاً = مفتاح إضافي بتعليق، بدون أي تعديل جذري في الشكل.
 *
 * @param {object|null} profile - صفّ من جدول profiles (أو null إن لم يُحمَّل بعد)
 * @param {object|null} [organizerProfile] - صفّ من جدول organizer_profiles إن كان محمّلاً (اختياري)
 * @returns {object} كائن قدرات صريح الدلالة — لا يحتوي أي حقل خام لإعادة استخدامه
 */
function getAccountCapabilities(profile, organizerProfile) {
  const role  = profile?.role || 'tenant';
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];

  return Object.freeze({
    // ── نوع الحساب الأساسي (من profiles.role — القيمة الوحيدة القانونية) ──
    isTenant: role === 'tenant',
    isOwner:  role === 'owner',
    isAdmin:  role === 'admin',

    // ── وسوم القدرات الإضافية (من profiles.roles[] — تحافظ عليها دوال
    //    الموافقة ذرّيًا منذ توحيد المرحلة ١؛ راجع الفرق النظري بينها وبين
    //    isOwner/isVerified أدناه قبل استخدامها في بوابة جديدة) ──
    isSpaceOwnerTagged: roles.includes('space_owner'),
    isOrganizer:        roles.includes('bazaar_organizer'),

    // ── التوثيق — معنيان منفصلان تمامًا، لا يُدمَجان هنا عمدًا:
    //    identityVerified   = توثيق عام للحساب (profiles.is_verified)
    //    organizerVerified  = توثيق KYC كمنظّم بازارات تحديدًا (organizer_profiles.is_verified)
    //    الصفحة التي تحتاج دمجهما لعبارة واحدة تفعل ذلك بنفسها صراحةً. ──
    identityVerified:  !!profile?.is_verified,
    organizerVerified: !!organizerProfile?.is_verified,

    // ── الباقة وحالة الحساب ──
    planTier:               profile?.plan_tier || 'starter',
    subscriptionStatus:     profile?.subscription_status || null,
    isSuspended:            !!profile?.is_suspended,
    isReadOnlySubscription: ['expired', 'cancelled', 'suspended'].includes(profile?.subscription_status),
  });
}
