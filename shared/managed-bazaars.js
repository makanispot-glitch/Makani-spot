/* Shared public presentation. All authoritative transitions and money are RPCs. */
window.MakaniManaged = (() => {
  const en = () => (typeof getLocale === 'function' ? getLocale() : document.documentElement.lang) === 'en';
  const tr = (ar, english) => en() ? english : ar;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => Number(value || 0).toLocaleString(en() ? 'en-EG' : 'ar-EG', { minimumFractionDigits:2, maximumFractionDigits:2 }) + ' ' + tr('ج.م', 'EGP');
  const date = value => value ? new Date(value).toLocaleString(en() ? 'en-EG' : 'ar-EG', { timeZone:'Africa/Cairo', dateStyle:'medium', timeStyle:'short' }) : '—';
  const stages = { new:['طلب جديد','New request'], checking:['التحقق من التوافر','Checking availability'], awaiting_payment:['انتظار الدفع','Awaiting payment'], funded:['إتمام الحجز مع المنظّم','Finalizing with organizer'], confirmed:['حجز مؤكد','Confirmed booking'], closed:['طلب مغلق','Closed request'], refund_review:['متابعة المبلغ المدفوع','Payment review'] };
  const stage = value => esc((stages[value] || stages.new)[en() ? 1 : 0]);
  const badge = () => `<span class="mb-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M8 3v4m8-4v4M4 10h16M5 5h14v15H5zM8 14l3 3 5-5"/></svg>${tr('بمتابعة مكاني Spot','Coordinated by Makani Spot')}</span>`;
  const errors = {
    close_reason_required:['أدخل سببًا واضحًا لإغلاق الطلب.','Enter a clear reason for closing the request.'],
    payment_and_organizer_confirmation_required:['لا يمكن تأكيد الحجز قبل تسجيل الدفعة المطلوبة وإتمامه مع المنظّم.','Record the required payment and finalize with the organizer before confirming.'],
    availability_changed_refresh_required:['تغير عدد الأماكن منذ فتح النموذج. افتحه مجددًا وراجع التوافر مع المنظّم.','Availability changed since this form opened. Reopen it and check capacity with the organizer.'],
    organizer_required:['اختر ملف المنظّم المُدار أولًا.','Choose a managed organizer record first.'],
    written_agreement_required:['أكمل نص الموافقة وتاريخها ومسؤولية الرد وموعد تحويل مستحق المنظّم.','Complete the consent text, date, refund responsibility and organizer payout timing.'],
    private_consent_attachment_required:['ارفع صورة أو PDF للموافقة المكتوبة قبل التفعيل.','Upload the written consent image or PDF before activation.'],
    listing_details_required:['أكمل صورة البازار والوصف والعنوان واسم المكان وشروط الإلغاء.','Complete the bazaar image, description, address, venue and cancellation terms.'],
    price_capacity_required:['أدخل سعرًا صحيحًا وعدد الأماكن المتاحة.','Enter a valid price and available capacity.'],
    deposit_must_cover_commission:['نسبة العربون يجب أن تغطي العمولة كاملة وألا تتجاوز ١٠٠٪.','The deposit must cover the full commission and cannot exceed 100%.'],
    future_active_bazaar_required:['التفعيل يحتاج بازارًا قادمًا غير مؤرشف.','Activation requires a future, unarchived bazaar.'],
    availability_expired_or_empty:['انتهت مهلة التوافر أو لم يعد هناك مكان متاح. حدّث قائمة الطلبات.','Availability expired or no capacity remains. Refresh the request list.'],
    valid_payment_deadline_required:['حدد مهلة دفع قادمة تسبق بداية البازار.','Set a future payment deadline before the bazaar starts.'],
    balance_deadline_required:['حدد مهلة للباقي لدى المنظّم بعد مهلة الدفعة الأولى.','Set the organizer balance deadline after the first payment deadline.'],
    organizer_confirmation_reference_required:['أدخل مرجع تأكيد الحجز من المنظّم.','Enter the organizer booking confirmation reference.'],
    duplicate_payment_reference:['هذا المرجع مسجل بالفعل. راجع السجل قبل إضافة حركة أخرى.','This reference is already recorded. Review the ledger before adding another entry.'],
    money_details_required:['أدخل مبلغًا موجبًا وتاريخًا صحيحًا ومرجعًا وجهة استلام.','Enter a positive amount, valid date, reference and recipient.'],
    first_payment_exceeded:['المبلغ يتجاوز الدفعة المطلوبة لمكاني. راجع الحركات المسجلة.','The amount exceeds the required Makani payment. Check recorded movements.'],
    organizer_balance_invalid:['تسجيل الباقي للمنظّم متاح بعد تأكيد الحجز، في حدود الباقي المتفق عليه.','Organizer balance can be recorded after confirmation, up to the agreed balance.'],
    refund_exceeds_receipts:['أدخل سبب الرد ومبلغًا لا يتجاوز ما استلمته هذه الجهة من العميل.','Provide a refund reason and an amount within that recipient’s customer receipts.'],
    payout_exceeds_due:['التحويل يتجاوز مستحق المنظّم بعد خصم العمولة والتحويلات والردود المسجلة.','The payout exceeds organizer dues after commission, previous payouts and refunds.'],
    payout_requires_confirmed_booking:['التحويل للمنظّم يتطلب حجزًا مؤكدًا.','Organizer payouts require a confirmed booking.'],
    invalid_reversal:['اختر حركة أصلية لم تُعكس وأدخل سبب التصحيح.','Choose an unreversed original entry and provide the correction reason.'],
    reversal_breaks_existing_movements:['توجد حركات تعتمد على هذا المبلغ. راجعها وصححها قبل عكس الاستلام.','Other movements depend on this amount. Review and correct those before reversing the receipt.'],
    invalid_stage:['هذا الإجراء لم يعد متاحًا في المرحلة الحالية. حدّث الطلب.','This action is unavailable at the current stage. Refresh the request.'],
    unauthorized:['هذا الإجراء متاح للأدمن فقط.','This action requires admin access.'],
    quote_changed:['تغير السعر أو الشروط. افتح التفاصيل مجددًا قبل إرسال طلبك.','The price or terms changed. Reopen the details before submitting.'],
    bazaar_not_available:['البازار غير متاح الآن لاستقبال طلبات جديدة.','This bazaar is no longer accepting requests.'],
    booking_limit_exceeded:['لديك بالفعل طلبان نشطان في هذا البازار.','You already have two active requests for this bazaar.'],
    request_details_required:['أكمل بيانات التواصل والنشاط ووافق على الشروط.','Complete your contact and business details and accept the terms.'],
    login_required:['سجّل الدخول لإرسال طلبك.','Sign in to submit your request.']
  };
  const publicNote = value => {
    const notes={'تم تسجيل استلام دفعة':'Payment receipt recorded','تم تسجيل رد مبلغ':'Customer refund recorded','تم تصحيح حركة مالية مسجلة':'A financial entry was corrected','تم استلام طلبك — الطلب خاضع لتأكيد التوافر':'Request received, subject to availability approval','الفريق يتحقق من التوافر مع المنظّم':'The team is checking availability with the organizer','تم تأكيد التوافر — راجع الدفعة المطلوبة ومهلة الدفع':'Availability approved. Check the required payment and deadline','تم تسجيل الدفعة المطلوبة — الفريق يتمّ الحجز مع المنظّم':'Required payment recorded. The team is finalizing with the organizer','تم إتمام حجزك مع المنظّم':'Your booking with the organizer is confirmed','أُغلق الطلب والفريق يتابع المبلغ المدفوع':'The request is closed. The team is reviewing the payment'};
    return en() ? notes[value] || value : value;
  };
  const errorText = error => { const key = Object.keys(errors).find(k => String(error?.message || error).includes(k)); return key ? errors[key][en()?1:0] : tr('تعذر إتمام العملية. حاول مجددًا؛ إذا استمر الخطأ تواصل مع الفريق.','Unable to complete the operation. Retry or contact the team.'); };
  function renderRequestForm(b, client, user, target) {
    if (!target) return;
    const closed = !b.available_slots || b.booking_paused || b.date_start <= new Intl.DateTimeFormat('en-CA', {timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const first = Math.round(Number(b.price_per_slot)*Number(b.managed_deposit_percent)/100*100)/100;
    target.innerHTML = `<section class="mb-box">${badge()}<h3 style="margin-top:14px">${tr('طلب حجز مكان','Request a place')}</h3><div class="mb-note">${tr('أرسل طلبك، وفريق مكاني يتأكد من التوافر قبل الدفع. الطلب لمكان واحد دون رقم، وإرساله لا يعني تأكيد الحجز.','Submit your request. Makani checks availability before payment. Each request is for one unnumbered place and does not confirm a booking.')}</div><div class="mb-summary"><div>${tr('السعر الإجمالي','Total price')}<strong>${money(b.price_per_slot)}</strong></div><div>${tr('الدفعة إلى مكاني بعد قبول التوافر','Due to Makani after availability approval')}<strong>${money(first)}</strong></div><div>${tr('الباقي للمنظّم مباشرة','Balance paid directly to organizer')}<strong>${money(Number(b.price_per_slot)-first)}</strong></div></div><p>${tr('شروط الإلغاء','Cancellation terms')}: ${esc(b.managed_cancellation_terms)}</p>${closed ? `<p>${tr('استقبال الطلبات مغلق لهذا البازار.','Requests are closed for this bazaar.')}</p>` : !user ? `<a class="btn btn-primary" href="/?p=login">${tr('سجّل الدخول لطلب الحجز','Sign in to request a booking')}</a>` : `<form class="mb-form"><div class="mb-fields"><label class="mb-field">${tr('الاسم','Name')}<input name="name" required maxlength="150" autocomplete="name" value="${esc(user.user_metadata?.full_name || user.user_metadata?.name || '')}"></label><label class="mb-field">${tr('رقم الهاتف','Phone')}<input name="phone" required type="tel" autocomplete="tel" maxlength="30"></label><label class="mb-field">${tr('اسم المشروع','Business name')}<input name="business" required maxlength="150"></label><label class="mb-field">${tr('النشاط / المنتجات','Activity / products')}<input name="activity" required maxlength="250"></label><label class="mb-field mb-wide">${tr('ملاحظات اختيارية','Optional notes')}<textarea name="notes" maxlength="2000"></textarea></label></div><label class="mb-check"><input type="checkbox" name="consent" required><span>${tr('قرأت السعر ونظام الدفع وشروط الإلغاء، وأفهم أن الطلب يخضع لتأكيد التوافر قبل الدفع.','I have read the price, payment and cancellation terms and understand that availability must be approved before payment.')}</span></label><button class="btn btn-primary" type="submit">${tr('طلب حجز مكان','Request a place')}</button><div role="status" class="mb-result" aria-live="polite"></div></form>`}</section>`;
    const form = target.querySelector('form');
    if (!form) return;
    const requestKey = crypto.randomUUID();
    form.addEventListener('submit', async event => {
      event.preventDefault(); const button=form.querySelector('button'); const result=form.querySelector('.mb-result'); button.disabled=true;
      try {
        const payload=Object.fromEntries(new FormData(form)); payload.consent=true; payload.email=user.email;
        const {data,error}=await client.rpc('request_managed_bazaar_booking',{p_bazaar_id:b.id,p_data:payload,p_request_key:requestKey,p_quote:{price:b.price_per_slot,deposit_percent:b.managed_deposit_percent,payment_mode:b.managed_payment_mode,cancellation_terms:b.managed_cancellation_terms}});
        if(error) throw error;
        form.innerHTML=`<div class="mb-success" role="status">${tr('تم استلام طلبك. الفريق يتحقق من التوافر؛ لا تدفع قبل إشعار قبول التوافر.','Your request was received. The team is checking availability. Wait for approval before paying.')}<p>${tr('مرجع الطلب','Request reference')}: ${esc(data.id.slice(0,8).toUpperCase())}</p><p>${tr('مهلة التحقق','Availability deadline')}: ${date(data.deadline)}</p><a class="btn btn-primary" href="/?p=dashboard">${tr('تابع طلبك في حجوزاتك','Track your request in My bookings')}</a></div>`;
      } catch(error) { result.className='mb-result mb-error'; result.textContent=errorText(error); button.disabled=false; }
    });
  }
  function requestCard(r) {
    const s=r.managed_snapshot || {}, m=r.money || {};
    const paid=Number(m.platform_paid || 0)+Number(m.organizer_paid || 0), refunded=Number(m.platform_refunded || 0)+Number(m.organizer_refunded || 0);
    const remaining=Math.max(0,Number(s.price)-paid);
    const deadline=['new','checking'].includes(r.managed_stage) ? r.availability_deadline_at : r.managed_stage==='awaiting_payment' ? r.payment_deadline_at : r.balance_due_at;
    return `<details class="mb-box mb-request" data-managed-request="${esc(r.id)}"><summary><span>${badge()}<strong style="display:block;margin-top:8px">${esc(s.name)}</strong><span class="mb-muted">${esc(r.id.slice(0,8).toUpperCase())} · ${esc(s.venue_name)} · ${esc(s.date_start)}</span></span><span class="mb-stage" data-stage="${esc(r.managed_stage)}">${stage(r.managed_stage)}</span></summary><p>${esc(r.managed_close_reason || '')}</p><div class="mb-summary"><div>${tr('السعر المثبت','Agreed total')}<strong>${money(s.price)}</strong></div><div>${tr('المدفوع','Recorded payments')}<strong>${money(paid)}</strong></div><div>${tr('المردود للعميل','Refunded to customer')}<strong>${money(refunded)}</strong></div></div><p>${tr('الدفعة الأولى لمكاني','First payment to Makani')}: ${money(s.first_due)} · ${tr('الباقي الأصلي للمنظّم','Original organizer balance')}: ${money(s.balance)}</p><p>${tr('المتبقي من السعر','Outstanding price')}: ${money(remaining)} · ${tr('المهلة','Deadline')}: ${date(deadline)}</p>${r.payment_instructions ? `<div class="mb-note">${esc(r.payment_instructions).replace(/\n/g,'<br>')}</div>` : ''}<p>${tr('شروط الإلغاء المحفوظة','Saved cancellation terms')}: ${esc(s.cancellation_terms)}</p><ol class="mb-timeline">${(r.events || []).map(e=>`<li>${esc(publicNote(e.note))}${Number(e.amount) ? ` · ${money(e.amount)} · ${e.party==='platform' ? tr('مكاني','Makani') : tr('المنظّم','Organizer')}` : ''}<time>${date(e.at)}</time></li>`).join('')}</ol>${['closed','refund_review'].includes(r.managed_stage) ? `<div class="mb-note">${tr('يمكنك استكشاف هذه البدائل أو تصفح البازارات. المبلغ المدفوع قيد متابعة الفريق عند وجوده.','Explore alternatives or browse bazaars. Any unresolved payment remains under review.')}<div class="mb-alt">${(r.alternatives || []).map(b=>`<a href="/bazaars/?bazaar=${esc(b.id)}&book=1">${esc(b.name)} · ${esc(b.region)} · ${esc(b.date_start)}</a>`).join('')}<a href="/bazaars/">${tr('تصفح البازارات','Browse bazaars')}</a></div></div>` : ''}</details>`;
  }
  async function mountMyRequests(client, userId, container, countEl) {
    if(!container || !userId) return;
    let host=container.querySelector('[data-managed-requests]'); if(host)host.remove();
    host=document.createElement('div'); host.dataset.managedRequests=''; container.prepend(host);
    const {data,error}=await client.rpc('get_my_managed_bazaar_bookings');
    if(error){host.innerHTML=`<div class="mb-error">${tr('تعذر تحميل طلبات البازارات بمتابعة مكاني.','Unable to load coordinated bazaar requests.')} <button type="button" class="btn" data-retry>${tr('إعادة المحاولة','Retry')}</button></div>`; host.querySelector('button').onclick=()=>mountMyRequests(client,userId,container,countEl); return;}
    if(!data?.length){host.remove();return;}
    container.querySelector('.no-bookings')?.remove();
    host.innerHTML=`<h3>${tr('طلبات البازارات بمتابعة مكاني','Bazaars coordinated by Makani')}</h3>${data.map(requestCard).join('')}`;
    if(countEl)countEl.textContent=Number(countEl.textContent || 0)+data.length;
  }
  return {tr,esc,money,date,stage,badge,errorText,renderRequestForm,requestCard,mountMyRequests};
})();
