/* Keyboard and current-page semantics for the shared navigation shell. */
(function () {
  'use strict';
  var nav = document.querySelector('.platform-nav');
  if (!nav) return;
  var avatar = nav.querySelector('.nav-avatar-btn');
  var bell = nav.querySelector('#gn-bell');
  if (avatar) {
    var name = avatar.querySelector('[data-nav-name]');
    var menu = nav.querySelector('.nav-dropdown');
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-haspopup', 'true');
    if (name) {
      if (!name.id) name.id = 'platform-nav-account-name';
      avatar.setAttribute('aria-labelledby', name.id);
    }
    if (menu && menu.id) avatar.setAttribute('aria-controls', menu.id);
  }
  if (bell) bell.setAttribute('tabindex', '0');
  [avatar, bell].filter(Boolean).forEach(function (control) {
    control.addEventListener('keydown', function (event) {
      if (event.target === control && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        control.click();
      }
    });
  });
  nav.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && avatar && avatar.classList.contains('open')) {
      event.preventDefault();
      avatar.click();
      avatar.focus();
    }
  });
  function sync() {
    nav.querySelectorAll('.nav-links a').forEach(function (link) {
      if (link.classList.contains('active')) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (avatar) avatar.setAttribute('aria-expanded', String(avatar.classList.contains('open')));
  }
  sync();
  new MutationObserver(sync).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
})();
