/**
 * إرسال طلب حجز المساحة — مصدر واحد بدل نسختين مختلفتين (الرئيسية و/spaces/)
 * كانتا تستخرجان السعر بـ regex من نص العرض المُنسّق بدل القيمة الرقمية الحقيقية،
 * وتبتلعان أي خطأ حفظ بصمت. الخادم يستمد السعر من المساحة أو الوحدة، أو يسجل
 * نطاقًا تقديريًا دون اختراع سعر نهائي (انظر _bookings_fill_owner).
 * لا تُستخرج قيمة مالية من نص DOM.
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
  if (!sbClient || !currentUser || currentUser.is_anonymous) {
    return { ok: false, error: 'يجب تسجيل الدخول لإرسال طلب الحجز' };
  }

  const bookingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const profileLink=(fields.profileLink||'').trim();
  if(fields.requiresBrandProfile&&!MakaniBrandProfile.valid(profileLink))return {ok:false,error:'أضف رابط ملف بروفايل البراند على Google Drive واجعله متاحًا للعرض'};

  let error;
  try { ({error}=await sbClient.from('bookings').insert({
    id: bookingId,
    user_id: currentUser.id,
    owner_id: fields.ownerId || null,
    space_id: fields.spaceId || null,
    space_name: fields.spaceName || '',
    space_loc: fields.spaceLoc || '',
    price: fields.price ?? null,
    requested_unit_id: fields.requestedUnitId || null,
    activity: fields.activity || '',
    size: fields.size || '',
    duration: fields.duration || '',
    start_date: fields.startDate || null,
    notes: fields.notes || '',
    is_waitlist: !!fields.isWaitlist,
    profile_link: profileLink || null,
    status: 'pending',
    created_at: now,
    updated_at: now,
  })); } catch(e) { error=e; }

  if (error) {
    return { ok: false, error: 'تعذّر إرسال طلب الحجز: ' + error.message };
  }
  return { ok: true, bookingId };
}
