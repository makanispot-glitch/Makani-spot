/**
 * إرسال طلب حجز المساحة — مصدر واحد بدل نسختين مختلفتين (الرئيسية و/spaces/)
 * كانتا تستخرجان السعر بـ regex من نص العرض المُنسّق بدل القيمة الرقمية الحقيقية،
 * وتبتلعان أي خطأ حفظ بصمت. القاعدة نفسها تحمي من price فارغ/صفري عند توفر
 * space_id (انظر _bookings_fill_owner)، فهذه الدالة تمرّر الرقم الحقيقي فقط
 * ولا تحاول اشتقاقه من DOM.
 * حمّلها بـ <script src="/shared/booking.js"></script>.
 */

/**
 * @param {object} sbClient عميل Supabase
 * @param {object} currentUser مستخدم Supabase الحالي (يجب تسجيل الدخول)
 * @param {object} fields بيانات الحجز: spaceId, ownerId, spaceName, spaceLoc,
 *   price (رقم حقيقي وليس نصاً معروضاً), activity, size, duration, startDate,
 *   notes, isWaitlist, profileLink
 * @returns {Promise<{ok:true, bookingId:string} | {ok:false, error:string}>}
 */
async function submitSpaceBookingRequest(sbClient, currentUser, fields) {
  if (!sbClient || !currentUser) {
    return { ok: false, error: 'يجب تسجيل الدخول لإرسال طلب الحجز' };
  }

  const bookingId = crypto.randomUUID();
  const now = new Date().toISOString();

  const { error } = await sbClient.from('bookings').insert({
    id: bookingId,
    user_id: currentUser.id,
    owner_id: fields.ownerId || null,
    space_id: fields.spaceId || null,
    space_name: fields.spaceName || '',
    space_loc: fields.spaceLoc || '',
    price: fields.price || null,
    activity: fields.activity || '',
    size: fields.size || '',
    duration: fields.duration || '',
    start_date: fields.startDate || null,
    notes: fields.notes || '',
    is_waitlist: !!fields.isWaitlist,
    profile_link: fields.profileLink || null,
    status: 'pending',
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return { ok: false, error: 'تعذّر إرسال طلب الحجز: ' + error.message };
  }
  return { ok: true, bookingId };
}
