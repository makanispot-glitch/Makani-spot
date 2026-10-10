/* The private account shell reuses profile editing, reputation and booking components. */
let _accountSection = 'bookings';
let _accountData = null;
let _accountMemberships = [];
let _accountUpgradeStatus = null;
let _accountReady = false;

function _accountIcon(name) {
  const paths = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="m9 16 2 2 4-4"/>',
    activity: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface,#fff)"/><circle cx="15" cy="17" r="3" fill="var(--surface,#fff)"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.5 10.5 7-4M8.5 13.5l7 4"/>',
    camera: '<path d="M4 6h4l2-3h4l2 3h4a1 1 0 0 1 1 1v13H3V7a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m21 15-6-6L3 21"/>',
    store: '<path d="M3 4h18l-2 6H5Z"/><path d="M5 10v11h14V10M9 21v-7h6v7"/>',
    tent: '<path d="m3 21 9-18 9 18ZM12 3v18M8 21l4-8 4 8"/>',
    building: '<path d="M4 21V3h12v18M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4M9 21v-2h2v2"/>',
    listings: '<path d="M5 3h14v18l-3-2-4 2-4-2-3 2ZM9 7h6M9 11h6M9 15h3"/>',
    arrow: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    logout: '<path d="M9 21H4V3h5M9 12h12m-4-4 4 4-4 4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  };
  return `<svg class="account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.user}</svg>`;
}

function _accountAction(href, icon, title, desc) {
  return `<a class="account-action" href="${href}"><span class="account-action-icon">${_accountIcon(icon)}</span><span><strong>${title}</strong><small>${desc}</small></span>${_accountIcon('arrow')}</a>`;
}

function _renderAccountFrame(data) {
  const { profile, userProfile, displayName, initial, avatarHtml, joinDate, nameBadge,
    isSpaceOwner, showOrganizerSection, isVerified, reqStatus, primaryBadges, secBadges,
    personal, listings, bazaars, ratings, reviews, reputation, completion } = data;
  const caps = getAccountCapabilities(userProfile, profile, _accountMemberships);
  const tabs = [['bookings','calendar'],['activity','activity'],['personal','user'],['ratings','star'],['settings','settings']];
  const ownerLink = isSpaceOwner ? _accountAction('/dashboard/','store',t('account.ownerTools'),t('account.ownerToolsDesc')) : '';
  const organizerLink = showOrganizerSection ? _accountAction('/bazaars/manage.html','tent',t('account.organizerTools'),t('account.organizerToolsDesc')) : '';
  const orgLink = caps.isOrgMember ? _accountAction('/org/','building',t('account.organization'),t('account.organizationDesc')) : '';
  const adminLink = caps.isAdmin ? _accountAction('/admin/','lock',t('account.admin'),t('account.adminDesc')) : '';
  const roles = [isSpaceOwner ? t('profile.badges.spaceOwnerLabel') : '', showOrganizerSection ? t('profile.badges.organizerLabel') : ''].filter(Boolean);
  const cover = _toDirectImgUrl(profile?.cover_url || userProfile?.cover_url || '');
  return `<header class="account-page-heading"><div><span class="account-eyebrow">${t('account.eyebrow')}</span><h1>${t('account.title')}</h1><p>${t('account.subtitle')}</p></div><a class="account-home" href="/">${t('account.backHome')}${_accountIcon('arrow')}</a></header>
    <section class="account-identity" aria-label="${t('account.identity')}">
      <div class="account-avatar-area"><button class="op-avatar" type="button" onclick="triggerAvatarUpload()" aria-label="${t('profile.hero.changePhotoTooltip')}"><span id="avatar-container-inner">${avatarHtml}</span></button><button class="account-avatar-edit" onclick="triggerAvatarUpload()" aria-label="${t('profile.hero.changePhotoTooltipShort')}">${_accountIcon('camera')}</button></div>
      <div class="account-identity-info"><h2 class="op-name">${_escR(displayName)}${nameBadge}</h2><div class="account-role-line">${roles.length ? roles.map(role=>`<span>${role}</span>`).join('') : `<span>${t('account.member')}</span>`}${caps.identityVerified ? `<span class="account-verified">${_accountIcon('check')}${t('account.identityVerified')}</span>` : ''}</div><p class="account-member-since">${t('profile.hero.memberSince',{date:joinDate})}${myMergedCity ? ` · ${_escR(myMergedCity)}` : ''}</p></div>
      <div class="account-identity-actions"><button class="account-button primary" onclick="openEditModal()">${_accountIcon('edit')}${t('account.edit')}</button><button class="account-button" onclick="shareMyOrganizerProfile()">${_accountIcon('share')}${t('account.share')}</button><button class="account-button icon-only" onclick="selectAccountSection('settings',true)" aria-label="${t('account.tabs.settings')}">${_accountIcon('settings')}</button></div>
    </section>
    <div class="account-layout"><aside class="account-sidebar"><nav class="account-tabs" role="tablist" aria-label="${t('account.navigation')}">${tabs.map(([key,icon])=>`<button type="button" role="tab" id="account-tab-${key}" aria-controls="account-panel-${key}" aria-selected="false" data-account-tab="${key}" onclick="selectAccountSection('${key}')">${_accountIcon(icon)}<span>${t('account.tabs.'+key)}</span></button>`).join('')}</nav><div class="account-sidebar-note">${_accountIcon('lock')}<span>${t('account.privateNote')}</span></div></aside>
      <div class="account-panels">
        <section id="account-panel-bookings" role="tabpanel" aria-labelledby="account-tab-bookings" tabindex="0" hidden><div class="account-panel-heading"><div><h2>${t('account.tabs.bookings')} <span class="account-count" id="dash-booking-count">—</span></h2><p>${t('account.bookingsDesc')}</p></div><button class="account-button" onclick="refreshAccountBookings()">${t('account.refresh')}</button></div>${ownerLink || organizerLink ? `<div class="account-tools">${ownerLink}${organizerLink}</div>` : ''}<div id="dash-bookings" aria-live="polite"></div></section>
        <section id="account-panel-activity" role="tabpanel" aria-labelledby="account-tab-activity" tabindex="0" hidden><div class="account-panel-heading"><div><h2>${t('account.tabs.activity')}</h2><p>${t('account.activityDesc')}</p></div><a class="account-button primary" href="/post-ad/">${_accountIcon('listings')}${t('account.newListing')}</a></div><div class="account-tools">${ownerLink}${organizerLink}${orgLink}${adminLink}</div>${listings}${bazaars}</section>
        <section id="account-panel-personal" role="tabpanel" aria-labelledby="account-tab-personal" tabindex="0" hidden><div class="account-panel-heading"><div><h2>${t('account.tabs.personal')}</h2><p>${t('account.personalDesc')}</p></div><button class="account-button" onclick="openEditModal()">${_accountIcon('edit')}${t('account.edit')}</button></div>${personal}<section class="op-section-card account-profile-presentation"><div class="account-cover-preview">${cover ? `<img id="op-cover-img-el" src="${_escR(cover)}" alt="${t('account.cover')}">` : '<img id="op-cover-img-el" alt="" hidden>'}<button id="op-cover-upload-btn" class="account-button" onclick="triggerCoverUpload()">${_accountIcon('image')}${t('account.cover')}</button></div>${profile?.bio ? `<p class="op-bio">${_escR(profile.bio)}</p>` : ''}<div class="account-social-links">${['facebook_url','instagram_url','tiktok_url'].filter(key=>_profSafeLinkHref(profile?.[key])).map(key=>`<a class="account-button" href="${_escR(_profSafeLinkHref(profile[key]))}" target="_blank" rel="noopener noreferrer">${_accountIcon('link')}${{facebook_url:'Facebook',instagram_url:'Instagram',tiktok_url:'TikTok'}[key]}</a>`).join('')}</div><a class="account-button" href="/bazaars/profile.html?user=${currentUser.id}" target="_blank" rel="noopener">${_accountIcon('user')}${t('account.publicProfile')}</a></section>${completion}</section>
        <section id="account-panel-ratings" role="tabpanel" aria-labelledby="account-tab-ratings" tabindex="0" hidden><div class="account-panel-heading"><div><h2>${t('account.tabs.ratings')}</h2><p>${t('account.ratingsDesc')}</p></div></div>${secBadges.length ? `<div class="account-achievements">${secBadges.map(b=>`<span>${_accountIcon(b.id==='top-rated'?'star':'listings')}${b.label}</span>`).join('')}</div>` : ''}${reputation}${data.organizerRating}${reviews}${ratings}${!reputation && !reviews && !data.organizerRating ? `<div class="account-empty">${_accountIcon('star')}<h3>${t('account.noRatings')}</h3><p>${t('account.noRatingsDesc')}</p></div>` : ''}</section>
        <section id="account-panel-settings" role="tabpanel" aria-labelledby="account-tab-settings" tabindex="0" hidden><div class="account-panel-heading"><div><h2>${t('account.tabs.settings')}</h2><p>${t('account.settingsDesc')}</p></div></div><div class="op-section-card account-settings-list"><button class="account-action" onclick="openEditModal('security')"><span class="account-action-icon">${_accountIcon('lock')}</span><span><strong>${t('account.security')}</strong><small>${t('account.securityDesc')}</small></span>${_accountIcon('arrow')}</button><button class="account-action" onclick="toggleMakaniLocale()"><span class="account-action-icon">${_accountIcon('settings')}</span><span><strong>${t('account.language')}</strong><small>${getLocale()==='en'?'English':'العربية'}</small></span>${_accountIcon('arrow')}</button></div><section class="op-section-card"><h3>${t('account.roles')}</h3><p class="account-description">${t('account.rolesDesc')}</p><div class="account-tools">${ownerLink}${organizerLink}${orgLink}${adminLink}${!isSpaceOwner ? (_accountUpgradeStatus==='pending' ? `<p class="account-pending">${t('account.ownerPending')}</p>` : _accountAction('/?p=owner','store',t('profile.cta.becomeOwnerTitle'),t('profile.cta.becomeOwnerDesc'))) : ''}${!isVerified ? (reqStatus==='pending' ? `<p class="account-pending">${t('account.organizerPending')}</p>` : _accountAction('/bazaars/verification.html','tent',t('profile.cta.becomeOrganizerTitle'),t('profile.cta.becomeOrganizerDesc'))) : ''}</div></section><button class="account-button account-logout" onclick="logoutAccount(this)">${_accountIcon('logout')}${t('account.logout')}</button></section>
      </div></div>`;
}

function selectAccountSection(key, focusPanel = false) {
  if (!['bookings','activity','personal','ratings','settings'].includes(key)) key = 'bookings';
  _accountSection = key;
  document.querySelectorAll('[data-account-tab]').forEach(button => {
    const selected = button.dataset.accountTab === key;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.account-panels > [role=tabpanel]').forEach(panel=>{panel.hidden = panel.id !== 'account-panel-'+key;});
  history.replaceState(null,'',location.pathname+location.search+'#'+key);
  document.querySelector(`[data-account-tab="${key}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
  if (focusPanel) document.getElementById('account-panel-'+key)?.focus({preventScroll:true});
  if (key === 'bookings') { _subscribeBookings(currentUser?.id); refreshAccountBookings(); }
}

async function refreshAccountBookings() {
  if (!currentUser || !document.getElementById('dash-bookings')) return;
  const container=document.getElementById('dash-bookings');
  if(!container.children.length)container.innerHTML=`<div class="account-empty" role="status">${t('profile.loading')}</div>`;
  await loadUserBookings(currentUser.id);
}

async function logoutAccount(button) {
  if (button.disabled) return;
  button.disabled = true;
  const { error } = await sbClient.auth.signOut();
  if (error) { button.disabled=false; showSuccessToast(t('account.logoutFailed'),true); return; }
  _unsubscribeBookings();
  if (typeof clearNavIdentity === 'function') clearNavIdentity();
  currentUser = null;
  location.replace('/');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closeEditModal(); closeServiceRequest(); }
  const dialog=document.querySelector('#edit-profile-modal.open .op-modal-card, #svc-detail-modal.open .svc-detail-box');
  if(dialog && event.key==='Tab'){
    const controls=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')].filter(el=>el.getClientRects().length);
    const first=controls[0],last=controls.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  }
  const tab = event.target.closest('[data-account-tab]');
  if (!tab || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
  event.preventDefault();
  const tabs=[...document.querySelectorAll('[data-account-tab]')];
  const rtl=document.documentElement.dir==='rtl';
  const step=event.key==='ArrowDown' || event.key===(rtl?'ArrowLeft':'ArrowRight') ? 1 : -1;
  const index=event.key==='Home' ? 0 : event.key==='End' ? tabs.length-1 : (tabs.indexOf(tab)+step+tabs.length)%tabs.length;
  selectAccountSection(tabs[index].dataset.accountTab); tabs[index].focus();
});
window.addEventListener('hashchange',()=>{if(_accountReady)selectAccountSection(location.hash.slice(1));});
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelectorAll('[data-account-icon]').forEach(el=>{el.innerHTML=_accountIcon(el.dataset.accountIcon);});
});
