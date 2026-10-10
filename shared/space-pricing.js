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
    const price = `<strong>${amount}</strong><small>${unit(s.pricingUnit)}</small>`;
    if (!estimated) return `<span class="mk-rental-price">${price}</span>`;
    return `<button type="button" class="mk-rental-price mk-price-trigger is-estimated" data-mk-price-unit="${esc(s.pricingUnit || 'month')}" aria-haspopup="dialog" aria-expanded="false" aria-label="${esc(tr('توضيح السعر التقديري:','Estimated price information:') + ' ' + amount.replace(/<[^>]*>/g,'') + ' ' + unit(s.pricingUnit))}">${price}<span class="mk-price-trigger-label">${tr('توضيح السعر','Price guide')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></span></button>`;
  }
  // A single tooltip outside the card avoids clipping by image/card overflow.
  let tooltip, activeTrigger, pinned=false, closeTimer, scrollFrame, restoringFocus=false;
  function closeTooltip() {
    clearTimeout(closeTimer);
    if (activeTrigger) {
      activeTrigger.setAttribute('aria-expanded','false');
      activeTrigger.removeAttribute('aria-describedby');
      activeTrigger.removeAttribute('aria-controls');
    }
    if (tooltip) tooltip.hidden=true;
    activeTrigger=null;
    pinned=false;
  }
  function dismissTooltip(restoreFocus) {
    const trigger=activeTrigger;
    closeTooltip();
    if (restoreFocus && trigger?.isConnected) {
      restoringFocus=true;
      trigger.focus({preventScroll:true});
      restoringFocus=false;
    }
  }
  function positionTooltip() {
    if (!activeTrigger?.isConnected) return closeTooltip();
    const anchor=activeTrigger.getBoundingClientRect();
    const viewport=window.visualViewport;
    const leftEdge=viewport?.offsetLeft || 0, topEdge=viewport?.offsetTop || 0;
    const width=viewport?.width || innerWidth, height=viewport?.height || innerHeight;
    tooltip.style.maxWidth=Math.max(0,width-24)+'px';
    tooltip.style.maxHeight=Math.max(64,height-24)+'px';
    let panel=tooltip.getBoundingClientRect();
    const aboveSpace=anchor.top-topEdge-22, belowSpace=topEdge+height-anchor.bottom-22;
    const above=aboveSpace>=panel.height || (belowSpace<panel.height && aboveSpace>=belowSpace);
    tooltip.style.maxHeight=Math.max(64,above?aboveSpace:belowSpace)+'px';
    panel=tooltip.getBoundingClientRect();
    const left=Math.max(leftEdge+12,Math.min(anchor.left+(anchor.width-panel.width)/2,leftEdge+width-panel.width-12));
    const top=Math.max(topEdge+12,Math.min(above?anchor.top-panel.height-10:anchor.bottom+10,topEdge+height-panel.height-12));
    tooltip.style.left=left+'px';
    tooltip.style.top=top+'px';
    tooltip.dataset.side=above?'above':'below';
  }
  function openTooltip(trigger, persist=false) {
    clearTimeout(closeTimer);
    if (activeTrigger!==trigger) closeTooltip();
    if (!tooltip) {
      tooltip=document.createElement('div');
      tooltip.id='mk-price-tooltip';
      tooltip.className='mk-price-tooltip';
      document.body.appendChild(tooltip);
    }
    const key=trigger.dataset.mkPriceUnit, perMetre=['sqm','sqm_month'].includes(key);
    const basis=perMetre?(key==='sqm_month'?tr('السعر تقديري للمتر المربع شهريًا.','Estimated price per square metre per month.'):tr('السعر تقديري للمتر المربع.','Estimated price per square metre.')):tr('السعر تقديري؛ يُؤكَّد السعر النهائي مع الإدارة.','This is an estimate. Confirm the final price with management.');
    const area=tr('مقاس إرشادي شائع للبارتشن:','A common guide size for a partition:');
    const terms=tr('إجمالي الإيجار = سعر المتر × المساحة. الحد الأدنى والسعر النهائي تحددهما إدارة المكان.','Total rent = price per m² × area. Venue management confirms the minimum area and final price.');
    tooltip.dir=document.documentElement.dir || 'rtl';
    tooltip.setAttribute('role',persist?'dialog':'tooltip');
    tooltip.setAttribute('aria-labelledby','mk-price-tooltip-title');
    tooltip.dataset.pinned=String(persist);
    tooltip.innerHTML=`<div class="mk-price-tooltip-head"><strong class="mk-price-tooltip-title" id="mk-price-tooltip-title">${tr('قبل تقدير تكلفة الإيجار','Before estimating your rent')}</strong><button type="button" class="mk-price-tooltip-close">${tr('إغلاق','Close')}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div id="mk-price-tooltip-copy"><p>${basis}</p>${perMetre?`<div class="mk-price-tooltip-area"><svg class="mk-partition-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="m4 35 20 10 20-10-20-10Z" fill="#FCD4BC"/><path d="M7 12v22l17 9V21Z" fill="#F36418"/><path d="m24 21 17-9v22l-17 9Z" fill="#C43C24"/><path d="M7 12 24 3l17 9-17 9Z" fill="#F9AD80"/><path d="m11 17 9 5v14l-9-5Z" fill="#FFF3EB"/><path d="m28 23 9-5v14l-9 5Z" fill="#FFF3EB"/><path d="M14 19v14m3-12v14m14-13v13m3-15v13" stroke="#F9AD80" stroke-width="1.5"/><path d="M7 12 24 3l17 9v22l-17 9-17-9Z" stroke="#B33F05" stroke-width="1.5" stroke-linejoin="round"/></svg><div>${area}<br><span class="mk-price-tooltip-size"><bdi dir="ltr">3 × 3</bdi> <span>${tr('م','m')}</span> = <bdi dir="ltr">9</bdi> <span>${tr('م²','m²')}</span></span></div></div><p>${terms}</p>`:''}</div>`;
    activeTrigger=trigger;
    pinned=persist;
    trigger.setAttribute('aria-expanded','true');
    trigger.setAttribute('aria-describedby','mk-price-tooltip-copy');
    trigger.setAttribute('aria-controls',tooltip.id);
    tooltip.hidden=false;
    tooltip.scrollTop=0;
    positionTooltip();
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    if (!pinned) closeTimer=setTimeout(closeTooltip,280);
  }
  document.addEventListener('pointerdown',event=>{
    if (!event.target.closest('.mk-price-trigger') && !tooltip?.contains(event.target)) closeTooltip();
  },true);
  document.addEventListener('click',event=>{
    if (event.target.closest('.mk-price-tooltip-close')) {
      event.stopPropagation();
      dismissTooltip(event.detail===0);
      return;
    }
    const trigger=event.target.closest('.mk-price-trigger');
    if (trigger) {
      event.stopPropagation();
      if (trigger===activeTrigger && pinned) closeTooltip();
      else {
        openTooltip(trigger,true);
        if (event.detail===0) tooltip.querySelector('.mk-price-tooltip-close').focus({preventScroll:true});
      }
    } else if (!tooltip?.contains(event.target)) closeTooltip();
  },true);
  document.addEventListener('pointerover',event=>{
    if (event.pointerType!=='mouse') return;
    if (tooltip?.contains(event.target)) return clearTimeout(closeTimer);
    const trigger=event.target.closest('.mk-price-trigger');
    if (trigger && !pinned && (activeTrigger!==trigger || !trigger.contains(event.relatedTarget))) openTooltip(trigger);
  });
  document.addEventListener('pointerout',event=>{
    if (event.pointerType!=='mouse') return;
    const trigger=event.target.closest('.mk-price-trigger');
    if ((trigger && trigger===activeTrigger && !trigger.contains(event.relatedTarget)) || (tooltip?.contains(event.target) && !tooltip.contains(event.relatedTarget))) scheduleClose();
  });
  document.addEventListener('focusin',event=>{
    if (restoringFocus || tooltip?.contains(event.target)) return;
    const trigger=event.target.closest('.mk-price-trigger');
    if (trigger) { if (activeTrigger!==trigger) openTooltip(trigger); }
    else closeTooltip();
  });
  document.addEventListener('focusout',event=>{
    if (event.target===activeTrigger) scheduleClose();
  });
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape' && activeTrigger) { event.stopPropagation(); dismissTooltip(tooltip?.contains(document.activeElement)); }
  },true);
  window.addEventListener('scroll',event=>{
    if (!activeTrigger || tooltip?.contains(event.target)) return;
    cancelAnimationFrame(scrollFrame);
    scrollFrame=requestAnimationFrame(()=>{
      if (!activeTrigger) return;
      const box=activeTrigger.getBoundingClientRect();
      if (box.bottom<=0 || box.top>=innerHeight || box.right<=0 || box.left>=innerWidth) closeTooltip();
      else positionTooltip();
    });
  },{passive:true,capture:true});
  window.addEventListener('resize',closeTooltip,{passive:true});
  window.visualViewport?.addEventListener('resize',closeTooltip,{passive:true});
  function note(s,compact) {
    if (!visible(s)) return '';
    const estimated=s.pricingMode==='estimated', perMetre=['sqm','sqm_month'].includes(s.pricingUnit);
    const copy=estimated?(compact?tr('تقديري؛ يتغير حسب المساحة وشروط المكان. مكاني تساعدك في الوصول لأفضل سعر.','An estimate, subject to area and venue terms. Makani helps you find the best available price.'):s.pricingNote || tr('السعر تقديري ويختلف حسب الموقع والمساحة وشروط المكان والتفاوض مع الإدارة. تساعدك مكاني في الوصول إلى أفضل سعر.','An estimate that varies with location, area, venue terms and negotiation. Makani helps you find the best available price.')):'';
    const metre=perMetre?tr('السعر للمتر المربع. قد يشترط المكان حدًا أدنى للمساحة المستأجرة؛ تُؤكَّد الشروط مع الإدارة.','Price per square metre. The venue may require a minimum rented area; confirm the terms with management.'):'';
    if(!copy&&!metre)return '';
    return `<p class="mk-price-note">${copy?esc(copy):''}${copy&&metre?' ':''}${metre?`<span class="mk-price-unit-note">${esc(metre)}</span>`:''}</p>`;
  }
  function unitPrice(s,u) { return render({...s,price:u.price,pricingMode:'fixed',pricingUnit:'month'},u.price,true); }
  function detailNote(s) {
    if(!visible(s))return '';
    const estimated=s.pricingMode==='estimated',perMetre=['sqm','sqm_month'].includes(s.pricingUnit);
    if(!estimated&&!perMetre)return '';
    const items=[];
    if(estimated)items.push(tr('السعر المعروض تقديري، وقد يختلف حسب المساحة وموقعها وشروط المكان. يُؤكَّد السعر النهائي مع الإدارة.','The displayed price is an estimate and may vary with area, location and venue terms. Confirm the final price with management.'));
    if(perMetre)items.push(s.pricingUnit==='sqm_month'?tr('السعر للمتر المربع شهريًا، ويُحسب الإجمالي حسب المساحة المستأجرة.','Price per square metre per month. The total depends on the rented area.'):tr('السعر للمتر المربع، ويُحسب الإجمالي حسب المساحة المستأجرة.','Price per square metre. The total depends on the rented area.'));
    if(perMetre)items.push(tr('قد يشترط المكان حدًا أدنى للمساحة المستأجرة؛ تأكّد من المساحة المطلوبة وشروط الاستئجار مع الإدارة.','The venue may require a minimum rented area. Confirm the required area and rental terms with management.'));
    items.push(tr('تساعدك مكاني سبوت في الوصول إلى أفضل سعر متاح والتنسيق مع إدارة المكان.','Makani Spot helps you find the best available price and coordinate with venue management.'));
    return `<aside class="mk-price-note mk-price-guidance" aria-label="${tr('ملاحظات السعر والاستئجار','Pricing and rental notes')}"><h2>${tr('ملاحظات السعر والاستئجار','Pricing and rental notes')}</h2><ul>${items.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></aside>`;
  }
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
      closeTooltip();
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
  window.MakaniSpacePricing={render,note,detailNote,unitPrice,visible,registered,loginUrl,selectSize,filterAccess,unit,number,quoteText,authChanged,escape:esc};
})();
