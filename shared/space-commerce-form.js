/* One set of settings used by the existing admin and owner forms. */
(function () {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function html(prefix,s={}) {
    const input=(key,label,value,type='number',hint='')=>`<div><label for="${prefix}-${key}">${label}</label><input id="${prefix}-${key}" type="${type}" value="${esc(value)}" ${type==='number'?'min="0" max="2147483647" step="0.01"':'maxlength="24" dir="ltr"'}>${hint?`<p class="mk-commerce-hint">${hint}</p>`:''}</div>`;
    return `<section class="mk-commerce-fields" id="${prefix}-commerce"><h3>التسعير والتقديم والمعاينة</h3><div class="mk-commerce-grid">
      <div><label for="${prefix}-pricing-mode">طريقة التسعير</label><select id="${prefix}-pricing-mode" onchange="MakaniSpaceCommerceForm.sync('${prefix}')"><option value="fixed" ${s.pricing_mode!=='estimated'?'selected':''}>سعر محدد</option><option value="estimated" ${s.pricing_mode==='estimated'?'selected':''}>نطاق سعري تقديري</option></select></div>
      <div><label for="${prefix}-pricing-unit">وحدة سعر الإيجار</label><select id="${prefix}-pricing-unit" onchange="MakaniSpaceCommerceForm.sync('${prefix}')">${[['month','إجمالي المساحة / شهر'],['sqm_month','المتر المربع / شهر'],['total','إجمالي المساحة'],['sqm','المتر المربع']].map(([key,label])=>`<option value="${key}" ${(s.pricing_unit||'month')===key?'selected':''}>${label}</option>`).join('')}</select></div>
      <div data-fixed-fields ${s.pricing_mode==='estimated'?'hidden':''}>${input('fixed-price','السعر المحدد (ج.م)',s.min_price??0)}</div>
      <div data-range-fields ${s.pricing_mode!=='estimated'?'hidden':''}>${input('price-min','الحد الأدنى (ج.م)',s.price_min)}</div>
      <div data-range-fields ${s.pricing_mode!=='estimated'?'hidden':''}>${input('price-max','الحد الأقصى (ج.م)',s.price_max)}</div>
      <div data-range-fields ${s.pricing_mode!=='estimated'?'hidden':''} style="grid-column:1/-1"><label for="${prefix}-pricing-note">ملاحظة السعر التقديري (اختياري)</label><textarea id="${prefix}-pricing-note" rows="2" maxlength="500" placeholder="تُستخدم الملاحظة الافتراضية عند تركه فارغًا">${esc(s.pricing_note)}</textarea></div>
      ${input('viewing-fee','رسوم المعاينة (ج.م)',s.viewing_fee,'number','اتركه فارغًا لاستخدام الرسوم الحالية: 150 ج.م. الصفر يعني معاينة مجانية.')}
      ${input('viewing-phone','رقم التواصل للمعاينة',s.viewing_contact_phone,'tel','اتركه فارغًا لاستخدام رقم مكاني الحالي. هذا رقم التواصل؛ رقم استقبال التحويل منفصل.')}
      </div><label class="mk-commerce-toggle" for="${prefix}-requires-brand"><input type="checkbox" id="${prefix}-requires-brand" ${s.requires_brand_profile?'checked':''}>يشترط تقديم بروفايل البراند عند التقديم</label>
      <p class="mk-commerce-hint">تغيير رسوم المعاينة أو رقمها يخص الطلبات الجديدة؛ الطلبات السابقة تحتفظ بالقيم المسجلة وقت التقديم.</p></section>`;
  }
  function sync(prefix) {
    const section=document.getElementById(prefix+'-commerce'); if(!section)return;
    const fixed=document.getElementById(prefix+'-fixed-price');if(fixed)fixed.oninput=()=>{fixed.dataset.manual='true'};
    const estimated=document.getElementById(prefix+'-pricing-mode').value==='estimated';
    section.querySelectorAll('[data-range-fields]').forEach(x=>{x.hidden=!estimated;x.querySelectorAll('input,textarea').forEach(el=>el.disabled=!estimated)});
    section.querySelectorAll('[data-fixed-fields]').forEach(x=>{x.hidden=estimated;x.querySelectorAll('input').forEach(el=>el.disabled=estimated)});
    const legacy=document.getElementById(prefix==='f'?'f-sizes-container':prefix==='se'?'se-sizes':'as-sizes-container');
    const group=legacy?.closest(prefix==='f'?'.fg':prefix==='se'?'.form-group':'.pcard');
    const hideLegacy=estimated || document.getElementById(prefix+'-pricing-unit').value!=='month';
    if(group){group.hidden=hideLegacy;group.querySelectorAll('input').forEach(el=>el.disabled=hideLegacy);}
  }
  function read(prefix) {
    const get=key=>document.getElementById(prefix+'-'+key)?.value?.trim()||'';
    const numeric=(key,required)=>{const raw=get(key);if(!raw&&!required)return null;const n=Number(raw);if(!raw||!Number.isFinite(n)||n<0||n>2147483647)throw new Error('أدخل سعرًا صحيحًا غير سالب');return n};
    const mode=get('pricing-mode')||'fixed', low=mode==='estimated'?numeric('price-min',true):null, high=mode==='estimated'?numeric('price-max',true):null;
    const fixed=mode==='fixed'?numeric('fixed-price',true):null;
    if(fixed!==null&&!Number.isInteger(fixed))throw new Error('السعر المحدد يُحفظ بالجنيه؛ أدخل عددًا صحيحًا');
    if(mode==='estimated'&&low>high)throw new Error('الحد الأدنى لا يمكن أن يتجاوز الحد الأقصى');
    if(mode==='fixed'&&get('pricing-unit')==='month'){
      const latin=v=>String(v).replace(/[٠-٩۰-۹]/g,d=>'٠١٢٣٤٥٦٧٨٩'.includes(d)?'٠١٢٣٤٥٦٧٨٩'.indexOf(d):'۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
      const prices=prefix==='se'?get('sizes').split(/[|·]/).filter(x=>x.includes(':')).map(x=>x.split(':')[1].trim()):Array.from(document.querySelectorAll(`[id^="${prefix}-size-price-"]`)).map(x=>x.value.trim());
      for(const raw of prices.filter(Boolean)){const n=Number(latin(raw));if(!Number.isFinite(n)||n<0||n>2147483647)throw new Error('أدخل أسعار مقاسات صحيحة وغير سالبة');}
    }
    const phone=get('viewing-phone');if(phone&&!/^\+?[0-9][0-9 ()-]{8,23}$/.test(phone))throw new Error('رقم التواصل للمعاينة غير صالح');
    return {pricing_mode:mode,pricing_unit:get('pricing-unit')||'month',...(mode==='estimated'?{price_min:low,price_max:high,pricing_note:get('pricing-note')||null}:{min_price:fixed}),requires_brand_profile:!!document.getElementById(prefix+'-requires-brand')?.checked,viewing_fee:numeric('viewing-fee',false),viewing_contact_phone:phone||null};
  }
  window.MakaniSpaceCommerceForm={html,sync,read};
})();
