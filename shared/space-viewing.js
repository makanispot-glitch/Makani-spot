/* Shared existing viewing flow — fee, payment instructions and booking status unchanged. */
let _viewingSpaceId = null;
let _viewingSettings = null;
function renderViewingTerms(settings) {
  const en=document.documentElement.lang==='en', fee=Number(settings.viewingFee ?? settings.viewing_fee ?? 150);
  const phone=settings.viewingContactPhone || settings.viewing_contact_phone || '01103467711';
  const amount=fee.toLocaleString(en?'en-US':'ar-EG')+' '+(en?'EGP':'ج.م');
  const modal=document.getElementById('visit-modal');
  const title=modal.querySelector('.vm-fee-title');title.removeAttribute('data-i18n');title.textContent=fee===0?(en?'Free viewing':'المعاينة بدون رسوم'):(en?'Viewing fee — ':'رسوم المعاينة — ')+amount;
  modal.querySelector('.vm-pay-methods').hidden=fee===0;
  const note=modal.querySelector('[data-i18n-html$="visitModal.feeNote2"]');if(note)note.closest('.vm-fee-row').hidden=fee===0;
  let contact=modal.querySelector('.mk-view-contact');if(!contact){contact=document.createElement('div');contact.className='mk-view-contact';modal.querySelector('.vm-fee-box').append(contact);}
  contact.innerHTML=`<span>${en?'Viewing contact':'للتواصل بشأن المعاينة'}</span><a href="tel:${phone.replace(/[^+\d]/g,'')}"><bdi>${MakaniSpacePricing.escape(phone)}</bdi></a>`;
  const success=modal.querySelector('.vm-success-body');success.removeAttribute('data-i18n-html');
  success.innerHTML=en?`Your request has been sent. Makani Spot will contact you within 24 hours to arrange your visit.${fee>0?`<br><br>Transfer <strong>${amount}</strong> using InstaPay or Vodafone Cash to <bdi>01103467711</bdi> and send the receipt.`:''}<br>Viewing contact: <bdi>${MakaniSpacePricing.escape(phone)}</bdi>`:`تم إرسال طلبك. سيتواصل معك فريق مكاني Spot خلال ٢٤ ساعة لترتيب المعاينة.${fee>0?`<br><br>حوّل <strong>${amount}</strong> على InstaPay أو Vodafone Cash إلى <bdi>01103467711</bdi> وأرسل الإيصال.`:''}<br>رقم التواصل للمعاينة: <bdi>${MakaniSpacePricing.escape(phone)}</bdi>`;
}

async function openViewing(spaceId) {
  const s = await findOrFetchSpace(spaceId);
  if (!s) return;
  _viewingSpaceId = spaceId;
  _viewingSettings={viewingFee:s.viewingFee??150,viewingContactPhone:s.viewingContactPhone||'01103467711'};
  renderViewingTerms(_viewingSettings);

  // بيانات المساحة في الموديل
  document.getElementById('vm-space-name').textContent = s.name || '—';
  document.getElementById('vm-space-loc').textContent  = s.loc  ? '📍 ' + s.loc : '—';

  // تعبئة الاسم والموبايل لو المستخدم مسجل
  if (currentUser) {
    const nameEl  = document.getElementById('vm-name');
    const phoneEl = document.getElementById('vm-phone');
    if (nameEl)  nameEl.value  = currentProfile?.full_name || currentUser.user_metadata?.full_name || '';
    if (phoneEl) phoneEl.value = currentProfile?.phone || '';
  } else {
    ['vm-name', 'vm-phone'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
  }

  // تاريخ افتراضي = بكره
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateEl = document.getElementById('vm-date');
  if (dateEl) {
    dateEl.min   = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`;
    dateEl.value = '';
  }

  const submit = document.getElementById('vm-submit-btn');
  submit.disabled = false; submit.textContent = t('spaces:visitModal.submit');

  // إظهار الفورم وإخفاء النجاح
  document.getElementById('vm-form-wrap').style.display = 'block';
  document.getElementById('vm-success').style.display   = 'none';
  document.getElementById('vm-error').style.display     = 'none';

  document.getElementById('visit-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeViewingModal() {
  document.getElementById('visit-modal').classList.remove('open');
  document.body.style.overflow = '';
  _viewingSpaceId = null;
  _viewingSettings = null;
}

function closeViewingOnBg(e) {
  if (e.target === document.getElementById('visit-modal')) closeViewingModal();
}

async function submitViewing() {
  const name  = document.getElementById('vm-name').value.trim();
  const phone = document.getElementById('vm-phone').value.trim();
  const date  = document.getElementById('vm-date').value;

  const errEl = document.getElementById('vm-error');
  const show  = msg => { errEl.textContent = '⚠ ' + msg; errEl.style.display = 'block'; };

  if (!name)  { show(t('spaces:validation.nameRequired')); return; }
  if (!phone || phone.replace(/\D/g,'').length < 10) {
    show(t('spaces:validation.phoneInvalid')); return;
  }
  if (!currentUser || currentUser.is_anonymous) { show(t('spaces:validation.loginRequiredViewing')); return; }
  errEl.style.display = 'none';

  const btn = document.getElementById('vm-submit-btn');
  btn.innerHTML = t('spaces:auth2.sending');
  btn.disabled  = true;

  const spaceId=_viewingSpaceId,settings=_viewingSettings;
  try {
    const s = await findOrFetchSpace(spaceId);
    if(!s)throw new Error('Space unavailable');
    const { data, error } = await sbClient.from('bookings').insert({
      id:         crypto.randomUUID(),
      user_id:    currentUser.id,
      owner_id:   s?.ownerId || null,   // ربط طلب المعاينة بصاحب المساحة → يظهر في لوحة أصحاب المساحات
      space_id:   s?.id || null,         // ربط بالمساحة
      space_name: s?.name || '',
      space_loc:  s?.loc  || '',
      activity:   'معاينة',
      duration:   `معاينة - ${settings.viewingFee} ج`,
      start_date: date || null,
      notes:      `طلب معاينة\nالاسم: ${name}\nالهاتف: ${phone}`,
      status:     'viewing_pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select('viewing_fee,viewing_contact_phone').single();

    if (error) throw error;
    if(_viewingSpaceId!==spaceId)return;
    renderViewingTerms(data?.viewing_fee != null ? data : settings);

    document.getElementById('vm-form-wrap').style.display = 'none';
    document.getElementById('vm-success').style.display   = 'block';

  } catch (err) {
    btn.innerHTML = t('spaces:visitModal.submit');
    btn.disabled  = false;
    show(t('spaces:validation.sendError'));
  }
}
