/* Rental display only. Server RPCs decide whether price values can be returned. */
(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr = (ar,en) => document.documentElement.lang === 'en' ? en : ar;
  const number = v => Number(v).toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'ar-EG');
  const registered = () => typeof currentUser !== 'undefined' ? !!currentUser && !currentUser.is_anonymous : typeof currentOwner !== 'undefined' && !!currentOwner?.id;
  const visible = s => registered() && s?.priceVisible !== false;
  const unit = key => ({month:tr('ج.م / شهر','EGP / month'),sqm_month:tr('ج.م / م² / شهر','EGP / m² / month'),total:tr('ج.م إجمالي','EGP total'),sqm:tr('ج.م / م²','EGP / m²')})[key] || tr('ج.م / شهر','EGP / month');
  function loginUrl(id) {
    const back = new URL('/spaces/', location.origin);
    if (id) back.searchParams.set('space',id);
    back.searchParams.set('lang',document.documentElement.lang === 'en' ? 'en' : 'ar');
    return '/?p=login&next=' + encodeURIComponent(back.pathname + back.search);
  }
  function render(s, value, compact) {
    if (!visible(s)) return `<span class="mk-price-lock${compact ? ' is-compact' : ''}"><span class="mk-price-dummy" aria-hidden="true">— — —</span><a href="${esc(loginUrl(s?.id))}" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><span>${tr('سجّل دخولك لمعرفة السعر','Sign in to see price')}</span></a></span>`;
    const estimated = s.pricingMode === 'estimated';
    if (s.pricingUnit && s.pricingUnit !== 'month') value = null;
    if (!estimated && value == null && s.price == null) return `<span class="mk-rental-price"><small>${tr('السعر عند التواصل','Contact for price')}</small></span>`;
    const amount = estimated ? `${tr('من','From')} <bdi>${number(s.priceMin)}</bdi> ${tr('إلى','to')} <bdi>${number(s.priceMax)}</bdi>` : `<bdi>${number(value ?? s.price ?? 0)}</bdi>`;
    return `<span class="mk-rental-price${estimated ? ' is-estimated' : ''}"><strong>${amount}</strong><small>${unit(s.pricingUnit)}</small>${estimated ? `<span class="mk-estimate-label">${tr('سعر تقديري','Estimated price')}</span>` : ''}</span>`;
  }
  function note(s,compact) {
    if (!visible(s)) return '';
    const estimated=s.pricingMode==='estimated', perMetre=['sqm','sqm_month'].includes(s.pricingUnit);
    const copy=estimated?(compact?tr('تقديري؛ يتغير حسب المساحة وشروط المكان. مكاني تساعدك في الوصول لأفضل سعر.','An estimate, subject to area and venue terms. Makani helps you find the best available price.'):s.pricingNote || tr('السعر تقديري ويختلف حسب الموقع والمساحة وشروط المكان والتفاوض مع الإدارة. تساعدك مكاني في الوصول إلى أفضل سعر.','An estimate that varies with location, area, venue terms and negotiation. Makani helps you find the best available price.')):'';
    const metre=perMetre?tr('السعر للمتر المربع. قد يشترط المكان حدًا أدنى للمساحة المستأجرة؛ تُؤكَّد الشروط مع الإدارة.','Price per square metre. The venue may require a minimum rented area; confirm the terms with management.'):'';
    if(!copy&&!metre)return '';
    return `<p class="mk-price-note">${copy?esc(copy):''}${copy&&metre?' ':''}${metre?`<span class="mk-price-unit-note">${esc(metre)}</span>`:''}</p>`;
  }
  function unitPrice(s,u) { return render({...s,price:u.price,pricingMode:'fixed',pricingUnit:'month'},u.price,true); }
  function selectSize(button,id,label) {
    const card=button.closest('.space-card');
    const pool=typeof mpCurrentSpaces !== 'undefined' ? mpCurrentSpaces : typeof mpCurrentItems !== 'undefined' ? [...mpCurrentItems,...(typeof heroItems !== 'undefined' ? heroItems : [])] : [];
    const s=pool.find(x=>String(x.id)===String(id));
    card?.querySelectorAll('.size-chip').forEach(x=>x.classList.toggle('on',x===button));
    if (s && card?.querySelector('.price-main')) card.querySelector('.price-main').innerHTML=render(s,resolveSizePrice(s,label),true);
  }
  function filterAccess() {
    const allowed=registered();
    document.querySelectorAll('#mp-slider-max,#mp-slider-min').forEach(el=>{el.disabled=!allowed; const box=el.closest('.mp-filter-group');if(box)box.hidden=!allowed;});
    document.querySelectorAll('option[value="price-asc"],option[value="price-desc"]').forEach(el=>{if(el.closest('#mp-sort'))el.disabled=!allowed;});
  }
  function quoteText(row) {
    if(row.viewing_fee != null) return `${number(row.viewing_fee)} ${tr('ج.م / معاينة','EGP / visit')}`;
    if(row.activity==='معاينة'||row.status==='viewing_pending')return tr('رسوم المعاينة لم تُسجّل في الطلب القديم','Historical viewing fee was not recorded');
    const q=row.rent_quote;
    if(q?.mode==='estimated')return `${tr('من','From')} ${number(q.min)} ${tr('إلى','to')} ${number(q.max)} ${unit(q.unit)} (${tr('تقديري','estimate')})`;
    return row.price == null ? '—' : `${number(row.price)} ${unit(q?.unit || 'month')}`;
  }
  let authKey=false,authRevision=0;
  function authChanged(client) {
    const next=registered(); filterAccess();if(authKey===next)return;authKey=next;const revision=++authRevision;
    // Remove stale visible prices immediately; fetch again outside the auth callback.
    if(!next){
      if(typeof currentSpaceDetail!=='undefined'&&currentSpaceDetail)currentSpaceDetail.priceVisible=false;
      document.querySelectorAll('.price-main,.sd-size-price,.sub-price,.msd-start-price,.msd-action-price,.opp-card-price').forEach(el=>{el.innerHTML=render({id:typeof currentSpaceDetail!=='undefined'?currentSpaceDetail?.id:null,priceVisible:false},null,true)});
      document.querySelectorAll('.mk-rental-price').forEach(el=>{el.outerHTML=render({id:typeof currentSpaceDetail!=='undefined'?currentSpaceDetail?.id:null,priceVisible:false},null,true)});
      document.querySelectorAll('.mk-price-note').forEach(el=>el.remove());
    }
    setTimeout(async()=>{
      try{
        if(revision!==authRevision)return;
        if(typeof currentSpaceDetail!=='undefined'&&currentSpaceDetail&&(!next||currentSpaceDetail.priceVisible===false)){const s=await fetchSpaceById(client,currentSpaceDetail.id);if(s&&revision===authRevision&&registered()===next){currentSpaceDetail=s;MakaniSpaceDetail.renderHeader(s,typeof _typeLabel==='function'?_typeLabel(s.type):s.type,typeof planTrustBadgeInlineHtml==='function'?planTrustBadgeInlineHtml(s):'');_renderDetailInfo(s);_renderSubSpaces(s);MakaniSpaceDetail.enhanceInfo(s);}}
        if(revision===authRevision&&typeof silentRefreshSpaces==='function')await silentRefreshSpaces();
      }catch(_){}
    },0);
  }
  window.MakaniSpacePricing={render,note,unitPrice,visible,registered,loginUrl,selectSize,filterAccess,unit,number,quoteText,authChanged,escape:esc};
})();
