/* Shared detail presentation. Booking and publishing remain owned by their existing flows. */
(function () {
  'use strict';
  const paths = {
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    share: '<path d="M12 16V3m-4 4 4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    next: '<path d="m10 6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    photo: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-6-6L3 21"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-11 5 2 2 4-4"/>',
    store: '<path d="M3 9h18l-2-6H5l-2 6Zm1 0v12h16V9M9 21v-7h6v7M3 9c0 4 4 4 4 0 0 4 5 4 5 0 0 4 5 4 5 0 0 4 4 4 4 0"/>',
    size: '<path d="M3 7h18v10H3zM7 7v4m5-4v6m5-6v4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    visitors: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'
  };
  const icon = name => `<svg class="msd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.store}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr = (ar, en) => document.documentElement.lang === 'en' ? en : ar;
  const rtl = () => document.documentElement.dir !== 'ltr';
  const price = value => Number(value || 0).toLocaleString(rtl() ? 'ar-EG' : 'en-US');
  const currency = () => tr('ج.م.', 'EGP');
  const cleanLabel = value => String(value).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu,'').trim();
  let photos = [], active = 0, dialog, returnFocus, oldOverflow, resizeObserver;
  const broken = new Set();
  let photoName = '', galleryRevision = 0;

  function imageList(space) {
    const extra = Array.isArray(space.extraImages) ? space.extraImages : String(space.extraImages || '').split('|');
    // De-duplicate only in presentation; never rewrite the stored media arrays.
    return [...new Set([space.image, ...extra].map(x => String(x || '').trim()).filter(Boolean))];
  }
  function renderGallery(space) {
    closeGallery();
    photos = imageList(space); photoName = space.name || ''; broken.clear(); active = 0;
    const revision = ++galleryRevision;
    const el = document.getElementById('sd-gallery');
    if (!el) return;
    if (!photos.length) {
      el.innerHTML = `<div class="msd-no-photos">${icon('photo')}<span>${tr('لا توجد صور لهذه المساحة بعد', 'No photos available yet')}</span></div>`;
      return;
    }
    const preview = photos.slice(0, 4);
    el.innerHTML = `<div class="msd-gallery" data-count="${preview.length}">${preview.map((url, index) => `
      <button type="button" class="msd-photo" data-photo="${index}" aria-label="${esc(tr('فتح الصورة', 'Open photo'))} ${index+1}: ${esc(photoName)}">
        <img src="${esc(url)}" alt="${esc(photoName)} — ${index+1}" loading="${index ? 'lazy' : 'eager'}" decoding="async">
        <span class="msd-image-error" hidden>${icon('photo')}${tr('تعذّر تحميل الصورة', 'Photo unavailable')}</span>
      </button>`).join('')}</div>
      <div class="msd-gallery-caption"><span>${tr('اكتشف المكان بالصور', 'A closer look at the space')}</span>
      <button type="button" class="msd-text-button" data-all-photos>${icon('photo')}${tr('عرض كل الصور', 'Show all photos')} <span dir="ltr">(${photos.length})</span></button></div>`;
    el.querySelectorAll('[data-photo]').forEach(button => {
      button.onclick = () => openGallery(Number(button.dataset.photo), button);
      button.querySelector('img').onerror = () => {
        if (revision !== galleryRevision) return;
        broken.add(Number(button.dataset.photo)); button.classList.add('is-broken');
        button.querySelector('img').hidden = true; button.querySelector('.msd-image-error').hidden = false;
      };
    });
    el.querySelector('[data-all-photos]').onclick = e => openGallery(0, e.currentTarget);
  }
  function ensureDialog() {
    if (dialog) return;
    dialog = document.createElement('dialog'); dialog.id = 'msd-lightbox'; dialog.className = 'msd-lightbox';
    dialog.innerHTML = `<div class="msd-lightbox-top"><h2 id="msd-photo-title"></h2><button type="button" data-close>${icon('close')}</button></div>
      <div class="msd-lightbox-stage"><button type="button" data-prev>${icon('back')}</button><div class="msd-lightbox-image"></div><button type="button" data-next>${icon('next')}</button></div>
      <div class="msd-lightbox-bottom"><span id="msd-photo-count" aria-live="polite"></span><div class="msd-photo-strip"></div></div>`;
    dialog.setAttribute('aria-labelledby', 'msd-photo-title');
    document.body.appendChild(dialog);
    dialog.querySelector('[data-close]').onclick = closeGallery;
    dialog.querySelector('[data-prev]').onclick = () => go(active - 1);
    dialog.querySelector('[data-next]').onclick = () => go(active + 1);
    dialog.addEventListener('cancel', e => { e.preventDefault(); closeGallery(); });
    dialog.addEventListener('click', e => { if (e.target === dialog) closeGallery(); });
    dialog.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); go(active + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
    let start;
    const stage = dialog.querySelector('.msd-lightbox-image');
    stage.addEventListener('touchstart', e => { start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, {passive:true});
    stage.addEventListener('touchend', e => {
      if (!start) return;
      const dx = e.changedTouches[0].clientX-start.x, dy = e.changedTouches[0].clientY-start.y;
      if (Math.abs(dx)>50 && Math.abs(dy)<50) go(active+(dx<0?1:-1));
      start = null;
    }, {passive:true});
  }
  function openGallery(index, source) {
    if (!photos.length) return;
    ensureDialog(); returnFocus = source || document.activeElement; oldOverflow = document.body.style.overflow;
    dialog.querySelector('#msd-photo-title').textContent = photoName;
    dialog.querySelector('[data-close]').ariaLabel = tr('إغلاق معرض الصور', 'Close gallery');
    dialog.querySelector('[data-prev]').ariaLabel = tr('الصورة السابقة', 'Previous photo');
    dialog.querySelector('[data-next]').ariaLabel = tr('الصورة التالية', 'Next photo');
    dialog.querySelector('.msd-photo-strip').innerHTML = photos.map((url, i) => `<button type="button" data-index="${i}" aria-label="${esc(tr('الصورة', 'Photo'))} ${i+1}"><img src="${esc(url)}" alt="" loading="lazy"><span>${i+1}</span></button>`).join('');
    dialog.querySelectorAll('[data-index]').forEach(button => {
      button.onclick = () => go(Number(button.dataset.index));
      button.querySelector('img').onerror = () => { button.querySelector('img').hidden = true; };
    });
    dialog.showModal(); document.body.style.overflow = 'hidden'; go(index);
    dialog.querySelector('[data-close]').focus();
  }
  function go(index) {
    active = (index + photos.length) % photos.length;
    const holder = dialog.querySelector('.msd-lightbox-image');
    holder.innerHTML = broken.has(active) ? `<div class="msd-lightbox-error">${icon('photo')}${tr('تعذّر تحميل هذه الصورة. يمكنك الانتقال للصورة التالية.', 'This photo could not load. You can continue to the next photo.')}</div>` : `<img src="${esc(photos[active])}" alt="${esc(photoName)} — ${active+1}">`;
    const image = holder.querySelector('img');
    const imageIndex = active, revision = galleryRevision;
    if (image) image.onerror = () => {
      if (revision !== galleryRevision) return;
      broken.add(imageIndex); if (active === imageIndex) go(active);
    };
    dialog.querySelector('#msd-photo-count').textContent = `${active+1} / ${photos.length}`;
    dialog.querySelectorAll('[data-index]').forEach(button => {
      const on = Number(button.dataset.index) === active;
      button.setAttribute('aria-current', String(on));
      if (on) button.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    dialog.querySelector('[data-prev]').hidden = dialog.querySelector('[data-next]').hidden = photos.length < 2;
  }
  function restoreGallery() {
    document.body.style.overflow = oldOverflow || '';
    if (returnFocus?.isConnected) returnFocus.focus({preventScroll:true});
    returnFocus = null;
  }
  function closeGallery() { if (dialog?.open) { dialog.close(); restoreGallery(); } }

  function renderHeader(space, typeLabel, trustBadge) {
    document.getElementById('sd-header').innerHTML = `<div class="sd-header-inner">
      <div class="msd-topline"><button type="button" class="msd-text-button msd-back" data-back>${icon(rtl()?'next':'back')}${tr('العودة للمساحات','Back to spaces')}</button>
      <button type="button" class="msd-text-button msd-share" data-share>${icon('share')}${tr('مشاركة','Share')}</button></div>
      <div class="msd-heading"><div><div class="msd-eyebrow">${esc(typeLabel)}${trustBadge || ''}</div><h1 class="sd-name">${esc(space.name)}</h1>
      <div class="sd-meta"><span>${icon('pin')}${esc(space.loc)}</span>${space.subSpaces?.length ? `<span>${tr('وحدات داخل المساحة:','Units in this space:')} ${space.subSpaces.length}</span>` : ''}</div></div>
      <div class="msd-start-price"><span>${tr('سعر المساحة','Space price')}</span>${MakaniSpacePricing.render(space)}</div></div>
      ${MakaniBrandProfile.badge(space)}</div>`;
    document.querySelector('#sd-header [data-back]').onclick = () => window.closeSpaceDetail();
    document.querySelector('#sd-header [data-share]').onclick = () => window.shareCard('space', space.id, space.name);
  }
  function enhanceInfo(space) {
    const el = document.getElementById('sd-info');
    el.querySelector('.msd-venue-insights')?.remove();
    const days = [['sat','السبت','Saturday'],['sun','الأحد','Sunday'],['mon','الاثنين','Monday'],['tue','الثلاثاء','Tuesday'],['wed','الأربعاء','Wednesday'],['thu','الخميس','Thursday'],['fri','الجمعة','Friday']];
    const peak = days.filter(([key]) => space.peakDays?.includes(key)).map(([,ar,en]) => tr(ar,en));
    const facts = [];
    if (space.expectedMonthlyVisitors != null) facts.push(['visitors',tr('الزوار المتوقعون شهريًا','Expected monthly visitors'),price(space.expectedMonthlyVisitors),tr('تقدير لحركة الزوار','Estimated visitor traffic')]);
    if (space.googleRating != null) facts.push(['star',tr('تقييم Google Maps','Google Maps rating'),Number(space.googleRating).toLocaleString(rtl()?'ar-EG':'en-US',{minimumFractionDigits:1,maximumFractionDigits:1})+' / '+price(5),tr('تقييم المكان على Google','Venue rating on Google')]);
    if (peak.length) facts.push(['calendar',tr('أيام الذروة','Peak days'),peak.join(tr('، ',' · ')),tr('الأيام الأكثر إقبالًا','Busiest days')]);
    if (facts.length) el.insertAdjacentHTML('beforeend', `<section class="msd-venue-insights" aria-labelledby="msd-venue-title"><h2 id="msd-venue-title">${tr('المكان في أرقام','Venue at a glance')}</h2><dl class="msd-venue-facts">${facts.map(([symbol,label,value,hint])=>`<div class="msd-venue-fact">${icon(symbol)}<div><dt>${label}</dt><dd><bdi>${esc(value)}</bdi></dd><p>${hint}</p></div></div>`).join('')}</dl></section>`);
    // The home implementation previously omitted the publisher block that /spaces/ has.
    if (!el.querySelector('.sd-owner-card')) {
      const hasOwner = !space.isBroker && !!space.ownerName;
      const name = hasOwner ? space.ownerName : tr('مكاني Spot','Makani Spot');
      const tier = space.planTier || 'starter';
      const role = !hasOwner ? tr('ناشر المنصة','Platform publisher') : tier==='pro' ? tr('شريك معتمد','Certified partner') : tier==='growth' ? tr('شريك Growth','Growth partner') : tier==='broker' ? tr('وسيط معتمد','Certified broker') : tr('صاحب المساحة','Space owner');
      const profile = hasOwner && space.ownerId ? ` href="/?p=owner-profile&id=${encodeURIComponent(space.ownerId)}"` : '';
      el.querySelector('.sd-info-grid').insertAdjacentHTML('beforeend', `<section class="sd-info-card sd-info-full"><div class="sd-info-title">${tr('الناشر','Publisher')}</div><${profile?'a':'div'} class="sd-owner-card"${profile}>
        <div class="sd-owner-avatar-placeholder">${hasOwner ? esc(name[0]) : icon('store')}</div><div class="sd-owner-info"><div class="sd-owner-name">${esc(name)}</div><span class="sd-owner-role">${esc(role)}</span></div></${profile?'a':'div'}></section>`);
    }
    el.querySelectorAll('.sd-info-title').forEach(title => {
      const text = cleanLabel(title.textContent);
      const card = title.parentElement;
      const type = card.querySelector('.sd-description') ? 'info' : card.querySelector('.sd-owner-card') ? 'user' : card.querySelector('.sd-sizes-list') ? 'size' : card.querySelector('.sd-amenities-wrap') ? 'check' : card.querySelector('.sd-extra-row') ? 'calendar' : 'store';
      title.innerHTML = icon(type) + `<span>${esc(text)}</span>`;
    });
    el.querySelectorAll('.act-tag').forEach(tag => { tag.textContent = cleanLabel(tag.textContent); });
    document.querySelectorAll('#sd-subspaces .sub-meta,#sd-subspaces .sub-location,#sd-subspaces .sub-spec:not(.sub-price)').forEach(line => {
      const text = cleanLabel(line.textContent);
      const type = line.classList.contains('sub-location') ? 'pin' : line.classList.contains('sub-meta') ? 'store' : 'size';
      line.innerHTML = icon(type) + `<span>${esc(text)}</span>`;
    });
    const unitsTitle = document.querySelector('#sd-subspaces .sd-section-title');
    if (unitsTitle) unitsTitle.innerHTML = icon('size') + `<span>${esc(cleanLabel(unitsTitle.textContent))}</span>`;
    const oldMap = el.querySelector('.msd-location'); if (oldMap) oldMap.remove();
    el.querySelector('.mk-price-guidance')?.remove();
    const valid = window.MakaniSpaceLocation.valid(space.mapsUrl || '');
    el.insertAdjacentHTML('beforeend', `<section class="msd-location" aria-labelledby="msd-location-title">
      <div class="msd-location-icon">${icon('pin')}</div><div class="msd-location-copy"><h2 id="msd-location-title">${tr('موقع المساحة','Space location')}</h2><p>${esc(space.loc)}${valid ? '' : `<span>${tr('لم يضف الناشر الموقع الدقيق بعد','The publisher has not added the exact location yet')}</span>`}</p></div>
      ${valid ? `<a class="msd-map-link" href="${esc(space.mapsUrl)}" target="_blank" rel="noopener noreferrer">${tr('فتح Google Maps','Open Google Maps')}${icon('external')}</a>` : ''}</section>${MakaniSpacePricing.detailNote(space)}`);
    const footer = document.querySelector('#pg-space-detail .sd-sticky-footer');
    footer.innerHTML = `<div class="msd-action-inner"><div class="msd-action-price">${MakaniSpacePricing.render(space,null,true)}</div>
      <button type="button" class="msd-visit" data-view>${icon('calendar')}${tr('حجز معاينة','Schedule visit')}</button><button type="button" class="msd-book" data-book>${tr('احجز المساحة','Book this space')}${icon('next')}</button></div>`;
    footer.querySelector('[data-book]').onclick = () => window.openBooking(space.id);
    footer.querySelector('[data-view]').onclick = () => window.openViewing(space.id);
    const page = document.querySelector('#pg-space-detail .sd-page');
    resizeObserver?.disconnect();
    const measure = () => page.style.setProperty('--msd-bar-height', `${Math.ceil(footer.getBoundingClientRect().height)}px`);
    resizeObserver = new ResizeObserver(measure); resizeObserver.observe(footer); requestAnimationFrame(measure);
  }

  function shareUrl(url, text, title) {
    // Existing shareCard functions keep responsibility for their route/unit identity.
    const link = new URL(url); link.searchParams.set('lang', document.documentElement.lang === 'en' ? 'en' : 'ar');
    if (navigator.share) {
      try {
        Promise.resolve(navigator.share({url:link.href, text, title})).catch(error => {
          if (error.name !== 'AbortError') copyLink(link.href);
        });
      } catch (error) { if (error.name !== 'AbortError') copyLink(link.href); }
    } else copyLink(link.href);
  }
  async function copyLink(url) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      showStatus(tr('تم نسخ رابط المساحة','Space link copied'));
    } catch (_) {
      // Selectable, explicit fallback when browser permissions block clipboard access.
      const copyDialog = document.createElement('dialog'); copyDialog.className = 'msd-copy-dialog';
      copyDialog.innerHTML = `<h2>${tr('انسخ رابط المشاركة','Copy share link')}</h2><p>${tr('اضغط على الرابط لتحديده ونسخه','Select the link below to copy it')}</p><input readonly dir="ltr" aria-label="${tr('رابط المشاركة','Share link')}" value="${esc(url)}"><button type="button">${tr('إغلاق','Close')}</button>`;
      document.body.appendChild(copyDialog); copyDialog.showModal();
      const input = copyDialog.querySelector('input'); input.onclick = () => input.select(); input.focus(); input.select();
      copyDialog.querySelector('button').onclick = () => copyDialog.close(); copyDialog.onclose = () => copyDialog.remove();
    }
  }
  function showStatus(text) {
    let status = document.getElementById('msd-share-status');
    if (!status) { status = document.createElement('div'); status.id='msd-share-status'; status.setAttribute('role','status'); document.body.appendChild(status); }
    status.textContent=text; status.hidden=false; clearTimeout(status._timer);
    status._timer=setTimeout(() => {status.hidden=true;},3500);
  }
  window.MakaniSpaceDetail = {renderHeader,renderGallery,enhanceInfo,closeGallery,shareUrl,imageList};
})();
