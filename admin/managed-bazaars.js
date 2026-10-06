/* Operational views of existing bazaar records; no organizer login is created. */
window.ManagedAdmin = (() => {
  const M=MakaniManaged, E=M.esc, T=M.tr;
  const savedLocale=localStorage.getItem('makani_managed_admin_locale');
  if(savedLocale==='ar'||savedLocale==='en')document.documentElement.lang=savedLocale;
  let state={listings:[],organizers:[],bookings:[],settings:{}}, tab='managed-dir', scope='observed', filter='action', busy=false, bookingPage=0, directoryLoadedAt=0, legacyDirty=false;
  const inflight=new Map();
  const field=(name,label,value='',type='text',extra='')=>`<label class="mb-field">${label}<input name="${name}" type="${type}" value="${E(value)}" ${extra}></label>`;
  const area=(name,label,value='')=>`<label class="mb-field mb-wide">${label}<textarea name="${name}">${E(value)}</textarea></label>`;
  const button=(text,action)=>`<button type="button" class="btn btn-or btn-sm" data-action="${action}">${text}</button>`;
  const localDate=value=>value ? new Date(new Date(value).getTime()-new Date(value).getTimezoneOffset()*60000).toISOString().slice(0,16) : '';
  async function rpc(name,args){const {data,error}=await db.rpc(name,args);if(error)throw error;return data;}
  function fail(error){console.error(error);toast(M.errorText(error),'e');}
  function dialog(title,body){
    const previous=document.getElementById('mb-dialog');previous?.dispatchEvent(new Event('managed-dialog-close'));previous?.remove();
    const overlay=document.createElement('div'); overlay.id='mb-dialog'; overlay.className='mb-dialog'; overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',title);
    overlay.innerHTML=`<section dir="${document.documentElement.lang==='en'?'ltr':'rtl'}"><div class="mb-actions" style="justify-content:space-between;margin-top:0"><h2>${E(title)}</h2><button class="btn btn-gh" type="button" data-close aria-label="${T('إغلاق','Close')}">✕</button></div>${body}<div class="mb-error" role="status" aria-live="polite" data-error></div></section>`;
    const opener=document.activeElement;
    const close=()=>{if(!busy){overlay.dispatchEvent(new Event('managed-dialog-close'));overlay.remove();opener?.focus();}};
    overlay.querySelector('[data-close]').onclick=close;
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const els=[...overlay.querySelectorAll('button,input,textarea,select,a')].filter(x=>!x.disabled&&x.type!=='hidden'&&x.getClientRects().length);const first=els[0],last=els.at(-1);if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}}});
    document.body.appendChild(overlay);overlay.querySelector('input,button')?.focus();return overlay;
  }
  async function run(overlay,fn){
    if(busy)return;busy=true;const buttons=[...overlay.querySelectorAll('button')],disabled=buttons.map(b=>b.disabled);
    overlay.querySelector('[data-error]').textContent='';buttons.forEach(b=>b.disabled=true);
    try{await fn();}catch(e){const el=overlay.querySelector('[data-error]');if(el)el.textContent=e.message&&!/^[a-z_]+$/.test(e.message)?e.message:M.errorText(e);else fail(e);}
    finally{busy=false;buttons.forEach((b,i)=>b.disabled=disabled[i]);overlay.querySelector('[data-progress]')?.replaceChildren();}
  }
  async function refresh(section=tab==='managed-dir'?'directory':'bookings',id=null,append=false){
    const key=section+':'+(id||'')+':'+bookingPage;
    if(inflight.has(key))return inflight.get(key);
    const pending=rpc('admin_get_managed_bazaar_view',{p_section:section,p_id:id,p_offset:section==='bookings'?bookingPage*100:0,p_limit:100}).then(data=>{
      if(data.organizers)state.organizers=data.organizers;if(data.settings)state.settings=data.settings;
      if(section==='directory'){state.listings=data.listings||[];directoryLoadedAt=Date.now();}
      else if(section==='request'){for(const row of data.bookings||[]){const i=state.bookings.findIndex(b=>b.id===row.id);if(i<0)state.bookings.push(row);else state.bookings[i]=row;}}
      else {state.bookings=append?[...state.bookings,...(data.bookings||[]).filter(r=>!state.bookings.some(old=>old.id===r.id))]:data.bookings||[];state.booking_total=data.booking_total??state.bookings.length;}
      return data;
    }).finally(()=>inflight.delete(key));inflight.set(key,pending);return pending;
  }
  async function load(next,force=false){
    tab=next||tab;bookingPage=0;const requestedTab=tab,host=document.getElementById(tab==='managed-dir'?'mb-admin-directory':'mb-admin-bookings');
    if(!host.children.length)host.innerHTML='<p>'+T('جارٍ التحميل…','Loading…')+'</p>';
    try{if(requestedTab!=='managed-dir'||force||Date.now()-directoryLoadedAt>15000)await refresh(requestedTab==='managed-dir'?'directory':'bookings');if(tab===requestedTab)render();}catch(e){host.textContent=M.errorText(e);}
  }
  function saveOrganizer(o){if(!o)return;const i=state.organizers.findIndex(x=>x.id===o.id);if(i<0)state.organizers.push(o);else state.organizers[i]=o;}
  async function savedListing(){legacyDirty=true;await refresh('directory');if(tab==='managed-dir')render();toast(T('تم حفظ البازار','Bazaar saved'),'s');}
  async function purge(id){
    const {data:{session}}=await db.auth.getSession();if(!session)throw Error('login_required');
    const response=await fetch('/managed-bazaar-delete',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({external_id:id})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'managed_delete_failed');
    if(result.cleanup_pending)toast(T('حُذف السجل؛ تنظيف الملفات سيُستكمل بالمهمة الدورية.','Record deleted; scheduled maintenance will finish file cleanup.'),'s');
  }
  const actionable=r=>['new','checking','funded','refund_review'].includes(r.managed_stage) || (r.managed_stage==='awaiting_payment' && new Date(r.payment_deadline_at)<=new Date(Date.now()+7200000)) || (r.managed_stage==='confirmed' && r.balance_due_at && new Date(r.balance_due_at)<=new Date() && Number(r.money.organizer_paid)-Number(r.money.organizer_refunded)<Number(r.managed_snapshot.balance));
  function render(){tab==='managed-dir'?renderDirectory():renderBookings();}
  function wireLanguage(host){host.dir=document.documentElement.lang==='en'?'ltr':'rtl';host.querySelector('[data-action=language]').onclick=()=>{document.documentElement.lang=document.documentElement.lang==='en'?'ar':'en';localStorage.setItem('makani_managed_admin_locale',document.documentElement.lang);render();};}
  function renderDirectory(){
    const host=document.getElementById('mb-admin-directory');
    const rows=state.listings.filter(l=>scope==='active'?!!l.linked_bazaar_id:scope==='draft'?!!l.agreement && !l.linked_bazaar_id:!l.agreement && !l.is_archived);
    host.innerHTML=`<h2>${T('الدليل والبازارات المُدارة','Directory and coordinated bazaars')}</h2><button type="button" class="btn btn-gh btn-sm" data-action="language">${document.documentElement.lang==='en'?'العربية':'English'}</button><div class="mb-admin-note">${T('ابدأ ببازار واحد متفق عليه. تبقى البازارات الخارجية معلوماتية حتى تفعيل الحجز بموافقة مكتوبة.','Start with one agreed bazaar. External listings stay informational until booking is activated with written consent.')}</div><div class="mb-actions">${button(T('إضافة بازار خارجي','Add external bazaar'),'add')}${button(T('ملفات المنظّمين','Organizer records'),'organizers')}${button(T('إعدادات العمولة والدفع','Commission and payment settings'),'settings')}${button(T('تحديث','Refresh'),'refresh')}</div><div class="mb-admin-tabs">${[['observed','الرصد','Observed'],['draft','المسودات','Drafts'],['active','المُفعّلة','Activated']].map(([key,ar,en])=>`<button class="btn ${scope===key?'btn-or':'btn-gh'} btn-sm" data-scope="${key}">${T(ar,en)}</button>`).join('')}</div><div class="mb-admin-table"><table class="tbl"><thead><tr><th>${T('البازار','Bazaar')}</th><th>${T('التاريخ','Dates')}</th><th>${T('مهتمون','Interested')}</th><th>${T('طلبات','Requests')}</th><th>${T('مؤكد','Confirmed')}</th><th>${T('الإجراء','Action')}</th></tr></thead><tbody>${rows.map(l=>`<tr><td>${E(l.name)}<div class="mb-muted">${E(l.region)} · ${l.bazaar?.booking_paused?T('الطلبات متوقفة','Requests paused'):l.is_archived?T('مؤرشف','Archived'):''}</div></td><td>${E(l.date_start)} — ${E(l.date_end || l.date_start)}</td><td>${l.interests}</td><td>${l.requests}</td><td>${l.confirmed}</td><td><button class="btn btn-or btn-sm" data-listing="${l.id}">${T(l.linked_bazaar_id?'إدارة':'تجهيز وتفعيل',l.linked_bazaar_id?'Manage':'Prepare and activate')}</button></td></tr>`).join('') || `<tr><td colspan="6">${T('لا توجد بازارات في هذا التبويب.','No bazaars in this tab.')}</td></tr>`}</tbody></table></div>`;
    host.querySelectorAll('[data-scope]').forEach(b=>b.onclick=()=>{scope=b.dataset.scope;renderDirectory();});
    host.querySelectorAll('[data-listing]').forEach(b=>b.onclick=()=>openListing(b.dataset.listing));
    host.querySelector('[data-action=add]').onclick=()=>gp('dir-add');host.querySelector('[data-action=organizers]').onclick=()=>organizers();host.querySelector('[data-action=settings]').onclick=settings;host.querySelector('[data-action=refresh]').onclick=()=>load(tab,true);wireLanguage(host);
  }
  function renderBookings(){
    const host=document.getElementById('mb-admin-bookings');
    const rows=state.bookings.filter(r=>filter==='all'||filter==='action'&&actionable(r)||filter==='soon'&&['new','checking','awaiting_payment'].includes(r.managed_stage)&&new Date(r.managed_stage==='awaiting_payment'?r.payment_deadline_at:r.availability_deadline_at)<=new Date(Date.now()+7200000)||filter==='money'&&(Number(r.money.platform_paid)+Number(r.money.organizer_paid)>0)||r.managed_stage===filter);
    host.innerHTML=`<h2>${T('الحجوزات — متابعة طلبات مكاني','Bookings — Makani request follow-up')}</h2><button type="button" class="btn btn-gh btn-sm" data-action="language">${document.documentElement.lang==='en'?'العربية':'English'}</button><div class="mb-summary"><div>${T('الطلبات','Requests')}<strong>${state.booking_total??state.bookings.length}</strong></div><div>${T('المؤكد — في المحمّل','Confirmed — loaded requests')}<strong>${state.bookings.filter(r=>r.managed_stage==='confirmed').length}</strong></div><div>${T('تحتاج إجراء — في المحمّل','Needs action — loaded requests')}<strong>${state.bookings.filter(actionable).length}</strong></div></div><div class="mb-actions"><select class="ie-sel" id="mb-filter">${[['action','تحتاج إجراء','Needs action'],['all','الكل','All'],['new','الجديد','New'],['checking','انتظار التوافر','Checking availability'],['soon','قرب انتهاء المهلة','Deadline approaching'],['awaiting_payment','انتظار الدفع','Awaiting payment'],['money','المستلم منه مبلغ','Payment received'],['funded','إتمام الحجز','Finalizing booking'],['confirmed','المؤكد','Confirmed'],['refund_review','المتابعة المالية','Financial review'],['closed','المغلق','Closed']].map(([key,ar,en])=>`<option value="${key}" ${filter===key?'selected':''}>${T(ar,en)}</option>`).join('')}</select>${button(T('تحديث','Refresh'),'refresh')}</div><div class="mb-admin-table"><table class="tbl"><thead><tr><th>${T('المرجع / العميل','Reference / customer')}</th><th>${T('البازار','Bazaar')}</th><th>${T('المرحلة','Stage')}</th><th>${T('المهلة','Deadline')}</th><th>${T('المدفوع','Paid')}</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${E(r.id.slice(0,8).toUpperCase())}<div>${E(r.user_name)}</div><div dir="ltr">${E(r.user_phone)}</div></td><td>${E(r.managed_snapshot.name)}</td><td>${M.stageBadge(r.managed_stage)}</td><td>${M.date(['new','checking'].includes(r.managed_stage)?r.availability_deadline_at:r.managed_stage==='confirmed'?r.balance_due_at:r.payment_deadline_at)}</td><td>${M.money(Number(r.money.platform_paid)+Number(r.money.organizer_paid))}</td><td><button class="btn btn-or btn-sm" data-request="${r.id}">${T('متابعة','Review')}</button></td></tr>`).join('') || `<tr><td colspan="6">${T('لا توجد طلبات مطابقة.','No matching requests.')}</td></tr>`}</tbody></table></div>`;
    if(state.bookings.length<(state.booking_total||0)){const more=document.createElement('button');more.className='btn btn-gh';more.textContent=T('تحميل المزيد من الطلبات','Load more requests');more.onclick=async()=>{more.disabled=true;try{bookingPage++;await refresh('bookings',null,true);renderBookings();}catch(e){bookingPage--;more.disabled=false;fail(e);}};host.appendChild(more);}
    host.querySelector('#mb-filter').onchange=e=>{filter=e.target.value;renderBookings();};host.querySelector('[data-action=refresh]').onclick=()=>load(tab,true);host.querySelectorAll('[data-request]').forEach(b=>b.onclick=()=>openRequest(b.dataset.request));wireLanguage(host);
  }
  function organizers(id=''){
    const o=state.organizers.find(x=>x.id===id)||{};
    const overlay=dialog(T('ملف منظّم مُدار','Managed organizer record'),`<div class="mb-admin-note">${T('بيانات داخلية للفريق، دون إنشاء حساب مستخدم أو منح علامة اعتماد.','Internal team record. No user account or verification badge is created.')}</div><select id="mb-organizer-picker"><option value="">${T('منظّم جديد','New organizer')}</option>${state.organizers.map(x=>`<option value="${x.id}" ${x.id===id?'selected':''}>${E(x.name)}</option>`).join('')}</select><form id="mb-organizer"><div class="mb-fields">${field('name',T('الاسم','Name'),o.name,'text','required')}${field('phone',T('رقم التواصل','Contact phone'),o.phone,'tel','required')}${area('notes',T('ملاحظات داخلية','Internal notes'),o.notes)}</div><button class="btn btn-or" type="submit">${T('حفظ الملف','Save record')}</button>${id?'<button class="btn btn-gh" type="button" data-delete-organizer>'+T('حذف الملف غير المرتبط','Delete unlinked record')+'</button>':''}</form>`);
    overlay.querySelector('#mb-organizer-picker').onchange=e=>organizers(e.target.value);
    overlay.querySelector('[data-delete-organizer]')?.addEventListener('click',()=>{if(!confirm(T('حذف ملف هذا المنظّم غير المرتبط؟','Delete this unlinked organizer record?')))return;run(overlay,async()=>{await rpc('admin_delete_unused_managed_organizer',{p_id:id});state.organizers=state.organizers.filter(o=>o.id!==id);overlay.remove();render();});});
    overlay.querySelector('form').onsubmit=e=>{e.preventDefault();run(overlay,async()=>{const p=Object.fromEntries(new FormData(e.target));if(id)p.id=id;const result=await rpc('admin_save_managed_organizer',{p_data:p});saveOrganizer(result.organizer);overlay.remove();render();toast(T('تم حفظ المنظّم','Organizer saved'),'s');});};
  }
  function settings(){
    const s=state.settings;const overlay=dialog(T('إعدادات الحجز بمتابعة مكاني','Coordinated booking settings'),`<form><div class="mb-admin-note">${T('مدة الاحتفاظ تخص المنتهي بلا أي طلب؛ تاريخ الطلبات والمدفوعات محفوظ. تغيير العمولة يخص الاتفاقات الجديدة فقط. يُثبّت كل اتفاق وطلب نسبته ومبالغه.','Retention applies to ended bazaars without requests; request/payment history is retained. Commission changes apply only to new agreements. Each agreement and request keeps its original rate and amounts.')}</div><div class="mb-fields">${field('rate',T('العمولة %','Commission %'),s.managed_bazaar_commission_percent,'number','min="0.01" max="100" step="0.01" required')}${field('hours',T('مهلة التوافر بالساعات','Availability deadline in hours'),s.managed_bazaar_response_hours,'number','min="1" max="72" required')}${field('retention',T('حذف المنتهي بلا طلبات بعد — أيام','Delete ended bazaars without requests after — days'),s.managed_bazaar_unused_retention_days||30,'number','min="1" max="3650" required')}${area('instructions',T('تعليمات الدفع إلى مكاني','Payment instructions for Makani'),s.managed_bazaar_payment_instructions)}</div><button class="btn btn-or" type="submit">${T('حفظ','Save')}</button></form>`);
    overlay.querySelector('form').onsubmit=e=>{e.preventDefault();run(overlay,async()=>{const f=new FormData(e.target);await rpc('admin_set_managed_bazaar_operational_settings',{p_rate:Number(f.get('rate')),p_hours:Number(f.get('hours')),p_instructions:f.get('instructions'),p_retention:Number(f.get('retention'))});Object.assign(state.settings,{managed_bazaar_commission_percent:f.get('rate'),managed_bazaar_response_hours:f.get('hours'),managed_bazaar_payment_instructions:f.get('instructions'),managed_bazaar_unused_retention_days:f.get('retention')});overlay.remove();render();});};
  }
  function openListing(id){return ManagedBazaarForms.listing({state,id,dialog,run,rpc,onSaved:savedListing,onOrganizerSaved:saveOrganizer,previewConsent,purge});}
  async function previewConsent(path,overlay){try{const {data,error}=await db.storage.from('managed-bazaar-consents').createSignedUrl(path,120);if(error)throw error;const link=document.createElement('a');link.href=data.signedUrl;link.target='_blank';link.rel='noopener';link.textContent=T('فتح الموافقة — الرابط صالح لدقيقتين','Open consent — link expires in two minutes');overlay.querySelector('[data-error]').replaceChildren(link);}catch(e){fail(e);}}
  async function openRequest(id){
    try{await refresh('request',id);const r=state.bookings.find(x=>x.id===id);if(!r)return;
      ManagedBazaarForms.request({r,organizers:state.organizers,dialog,run,rpc,previewConsent,onSaved:async()=>{
        legacyDirty=true;directoryLoadedAt=0;if(tab==='managed-bk'){bookingPage=0;await refresh('bookings');render();}await openRequest(id);toast(T('تم تحديث الطلب','Request updated'),'s');
      }});
    }catch(e){fail(e);}
  }
  async function initialize(){const id=new URLSearchParams(location.search).get('managed');if(id){gp('managed-bk');await openRequest(id);}}
  document.addEventListener('DOMContentLoaded',initialize);
  async function prepare(id){gp('managed-dir');if(Date.now()-directoryLoadedAt>15000)await refresh('directory');openListing(id);}
  async function prepareBazaar(id){if(Date.now()-directoryLoadedAt>15000)await refresh('directory');const listing=state.listings.find(l=>l.linked_bazaar_id===id);if(listing)await prepare(listing.id);}
  async function routeManagedExternal(id){try{if(Date.now()-directoryLoadedAt>15000)await refresh('directory');if(state.listings.find(l=>l.id===id)?.agreement){await prepare(id);return true;}return false;}catch(e){fail(e);return true;}}
  async function refreshLegacyIfNeeded(){if(legacyDirty){legacyDirty=false;try{await loadData();}catch(e){legacyDirty=true;fail(e);}}}
  return {load,openListing,openRequest,prepare,prepareBazaar,routeManagedExternal,refreshLegacyIfNeeded};
})();
