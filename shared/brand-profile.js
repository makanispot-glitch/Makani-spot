/* Reuse profile_link. The PDF stays on the applicant's Google Drive. */
(function () {
  'use strict';
  const tr=(ar,en)=>document.documentElement.lang==='en'?en:ar;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5"/></svg>';
  function valid(link) {
    try {const u=new URL(link);return u.protocol==='https:'&&u.hostname==='drive.google.com'&&!u.username&&!u.password&&!u.port&&link.length<=2048&&!/[\s<>]/.test(link)&&(/^\/file\/d\/[A-Za-z0-9_-]+(?:\/(?:view|preview|edit))?\/?$/.test(u.pathname)||u.pathname==='/open'&&/^[A-Za-z0-9_-]+$/.test(u.searchParams.get('id')||''));}catch(_){return false;}
  }
  function setup(space) {
    let input=document.getElementById('bk-profile-link');
    if(!input){
      const wrap=document.createElement('div');wrap.className='mfg';wrap.dataset.brandCreated='true';
      wrap.innerHTML='<label for="bk-profile-link"></label><input type="url" id="bk-profile-link" dir="ltr"><div data-brand-hint></div>';
      document.querySelector('#modal-form-wrap .btn-primary').before(wrap);input=wrap.querySelector('input');
    }
    const wrap=input.closest('.mfg,.form-group'),label=wrap.querySelector('label');
    let hint=wrap.querySelector('[data-brand-hint]')||input.nextElementSibling;
    if(!hint){hint=document.createElement('div');wrap.append(hint)}
    if(!wrap._brandOriginal)wrap._brandOriginal={label:label.innerHTML,hint:hint.innerHTML,placeholder:input.placeholder,hintKey:hint.getAttribute('data-i18n-html')};
    input.value='';input.required=!!space.requiresBrandProfile;input.setCustomValidity('');input.removeAttribute('aria-invalid');
    wrap.hidden=!!wrap.dataset.brandCreated&&!space.requiresBrandProfile;
    wrap.classList.toggle('mk-brand-link',!!space.requiresBrandProfile);
    if(space.requiresBrandProfile){
      hint.removeAttribute('data-i18n-html');
      label.innerHTML=icon+tr('رابط بروفايل البراند مطلوب','Brand profile link required');
      input.placeholder='https://drive.google.com/file/d/…/view';
      hint.innerHTML=`<p>${tr('لمراجعة طلبك، شارك بروفايل البراند بصيغة PDF على Google Drive:','To review your application, share your brand profile PDF on Google Drive:')}</p><ol><li>${tr('ارفع ملف الـPDF على حسابك في Drive.','Upload the PDF to your Drive account.')}</li><li>${tr('افتح «مشاركة» ثم «الوصول العام» واختر «أي شخص لديه الرابط» بصلاحية «مشاهد».','Open Share → General access → Anyone with the link, with Viewer access.')}</li><li>${tr('اضغط «نسخ الرابط» و«تم»، ثم ألصق الرابط هنا.','Choose Copy link and Done, then paste the link here.')}</li></ol>`;
    }else{label.innerHTML=wrap._brandOriginal.label;hint.innerHTML=wrap._brandOriginal.hint;input.placeholder=wrap._brandOriginal.placeholder;if(wrap._brandOriginal.hintKey)hint.setAttribute('data-i18n-html',wrap._brandOriginal.hintKey);}
    input.oninput=()=>{input.setCustomValidity('');input.removeAttribute('aria-invalid')};
  }
  function check(required) {
    const input=document.getElementById('bk-profile-link'),link=input?.value.trim()||'';
    if(required&&!valid(link)){
      const message=tr('أضف رابط ملف بروفايل البراند على Google Drive، وأتحه لأي شخص لديه الرابط بصلاحية مشاهد.','Add the brand profile file link from Google Drive and enable Anyone with the link → Viewer.');
      if(input){input.setCustomValidity(message);input.setAttribute('aria-invalid','true');input.focus();}
      return {ok:false,error:message};
    }
    return {ok:true,link};
  }
  function linkHtml(link) {
    try {const u=new URL(link);if(!['https:','http:'].includes(u.protocol))return '';return `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer" class="mk-brand-review-link">${tr('عرض بروفايل البراند','View brand profile')}</a>`;}catch(_){return '';}
  }
  window.MakaniBrandProfile={setup,check,valid,linkHtml};
})();
