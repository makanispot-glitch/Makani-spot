
(function () {
  const FALLBACK_CATEGORIES = [
    ['partition', 'ط¨ط§ط±طھط´ظ† ظˆط£ط«ط§ط«'],
    ['food-cart', 'ط¹ط±ط¨ط§طھ ط·ط¹ط§ظ…'],
    ['fridge', 'ط«ظ„ط§ط¬ط§طھ ظˆطھط¨ط±ظٹط¯'],
    ['display', 'ع¤ظٹطھط±ظٹظ†ط§طھ ظˆط¹ط±ط¶'],
    ['kitchen', 'ظ…ط¹ط¯ط§طھ ظ…ط·ط¨ط®'],
    ['coffee', 'ظ…ط¹ط¯ط§طھ ظƒط§ظپظٹظ‡'],
    ['pos', 'ظƒط§ط´ظٹط± ظˆPOS'],
    ['vending', 'ط£ط¬ظ‡ط²ط© ط¨ظٹط¹ ط°ط§طھظٹ'],
    ['storage', 'ط±ظپظˆظپ ظˆطھط®ط²ظٹظ†'],
    ['lighting', 'ط¥ط¶ط§ط،ط© طھط¬ط§ط±ظٹط©'],
    ['other', 'ط£ط®ط±ظ‰']
  ];
  const FALLBACK_GOVS = [
    'ط§ظ„ظ‚ط§ظ‡ط±ط©','ط§ظ„ط¬ظٹط²ط©','ط§ظ„ط¥ط³ظƒظ†ط¯ط±ظٹط©','ط§ظ„ط´ط±ظ‚ظٹط©','ط§ظ„ط¯ظ‚ظ‡ظ„ظٹط©',
    'ط§ظ„ظ…ظ†ظˆظپظٹط©','ط§ظ„ظ‚ظ„ظٹظˆط¨ظٹط©','ط§ظ„ط¨ط­ظٹط±ط©','ظƒظپط± ط§ظ„ط´ظٹط®','ط§ظ„ط؛ط±ط¨ظٹط©',
    'ط³ظˆظ‡ط§ط¬','ط§ظ„ظ…ظ†ظٹط§','ط£ط³ظٹظˆط·','ظ‚ظ†ط§','ط§ظ„ط£ظ‚طµط±','ط£ط³ظˆط§ظ†',
    'ط¨ظˆط±ط³ط¹ظٹط¯','ط§ظ„ط³ظˆظٹط³','ط§ظ„ط¥ط³ظ…ط§ط¹ظٹظ„ظٹط©','ط¯ظ…ظٹط§ط·','ط§ظ„ظپظٹظˆظ…',
    'ط¨ظ†ظٹ ط³ظˆظٹظپ','ظ…ط·ط±ظˆط­','ط´ظ…ط§ظ„ ط³ظٹظ†ط§ط،','ط¬ظ†ظˆط¨ ط³ظٹظ†ط§ط،',
    'ط§ظ„ظˆط§ط¯ظٹ ط§ظ„ط¬ط¯ظٹط¯','ط§ظ„ط¨ط­ط± ط§ظ„ط£ط­ظ…ط±'
  ];

  function stopFilterEvent(ev) {
    if (!ev) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
  }

  function currentFilterState() {
    const activeTab = document.querySelector('#eq-drawer-tabs .eq-tab.on');
    const gov = document.getElementById('eq-drawer-gov');
    const sort = document.getElementById('eq-drawer-sort');
    const price = document.getElementById('eq-drawer-price');
    return {
      category: activeTab ? (activeTab.dataset.cat || '') : '',
      gov: gov ? gov.value : '',
      sort: sort ? sort.value : 'newest',
      price: price ? (parseInt(price.value, 10) || 0) : 0
    };
  }

  function forceFilterBadge(state) {
    const count = (state.category ? 1 : 0) + (state.gov ? 1 : 0) + (state.price > 0 ? 1 : 0);
    ['eq-drawer-badge', 'eq-mobile-filter-badge'].forEach(id => {
      const badge = document.getElementById(id);
      if (!badge) return;
      badge.textContent = count;
      badge.classList.toggle('show', count > 0);
    });
  }

  window.__forceMarketFilterOpen = function (ev) {
    stopFilterEvent(ev);
    const drawer = document.getElementById('eq-filter-drawer');
    const overlay = document.getElementById('eq-sidebar-overlay');
    const tab = document.getElementById('eq-sidebar-tab');
    const mobileBtn = document.getElementById('eq-mobile-filter-btn');
    if (!drawer) return false;
    document.body.classList.add('filter-open');
    drawer.classList.add('is-open');
    drawer.style.transform = 'translateX(0)';
    drawer.style.pointerEvents = 'auto';
    drawer.style.visibility = 'visible';
    drawer.style.display = 'block';
    drawer.style.zIndex = '10001';
    if (overlay) overlay.style.display = 'block';
    if (tab) tab.setAttribute('aria-expanded', 'true');
    if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'true');
    return false;
  };

  window.__forceMarketFilterClose = function (ev) {
    stopFilterEvent(ev);
    const drawer = document.getElementById('eq-filter-drawer');
    const overlay = document.getElementById('eq-sidebar-overlay');
    const tab = document.getElementById('eq-sidebar-tab');
    const mobileBtn = document.getElementById('eq-mobile-filter-btn');
    document.body.classList.remove('filter-open');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.style.transform = '';
      drawer.style.pointerEvents = '';
      drawer.style.visibility = '';
      drawer.style.display = '';
      drawer.style.zIndex = '';
    }
    if (overlay) overlay.style.display = '';
    if (tab) tab.setAttribute('aria-expanded', 'false');
    if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'false');
    return false;
  };

  window.__forceMarketFilterReset = function (ev) {
    stopFilterEvent(ev);
    const gov = document.getElementById('eq-drawer-gov');
    const sort = document.getElementById('eq-drawer-sort');
    const price = document.getElementById('eq-drawer-price');
    const priceVal = document.getElementById('eq-drawer-price-val');
    if (gov) gov.value = '';
    if (sort) sort.value = 'newest';
    if (price) price.value = 0;
    if (priceVal) priceVal.textContent = 'ط¨ظ„ط§ ط­ط¯';
    document.querySelectorAll('#eq-drawer-tabs .eq-tab').forEach((btn, i) => btn.classList.toggle('on', i === 0));
    forceFilterBadge({ category: '', gov: '', price: 0 });
    return false;
  };

  window.__forceMarketFilterApply = function (ev) {
    stopFilterEvent(ev);
    const state = currentFilterState();
    const cards = Array.from(document.querySelectorAll('#eq-grid .eq-card'));
    let shown = 0;
    cards.forEach(card => {
      const category = card.dataset.category || '';
      const region = card.dataset.region || '';
      const price = Number(card.dataset.price || 0);
      const visible = (!state.category || category === state.category)
        && (!state.gov || region === state.gov)
        && (!state.price || price <= state.price);
      card.style.display = visible ? '' : 'none';
      if (visible) shown++;
    });
    const count = document.getElementById('eq-count');
    if (count && cards.length) count.textContent = shown + ' ط¥ط¹ظ„ط§ظ†';
    forceFilterBadge(state);
    window.__forceMarketFilterClose(ev);
    return false;
  };

  function installMarketFilterFallback() {
    const tab     = document.getElementById('eq-sidebar-tab');
    const mobileBtn = document.getElementById('eq-mobile-filter-btn');
    const drawer  = document.getElementById('eq-filter-drawer');
    const overlay = document.getElementById('eq-sidebar-overlay');
    const panel   = drawer ? drawer.querySelector('.eq-drawer-panel') : null;
    const close   = document.getElementById('eq-drawer-close-btn');
    const reset   = document.getElementById('eq-drawer-reset-btn');
    const apply   = document.getElementById('eq-drawer-apply-btn');

    if ((!tab && !mobileBtn) || !drawer) return;
    const installTarget = mobileBtn || tab;
    if (installTarget.dataset.filterFallbackInstalled === '1' && typeof window.eqOpenSidebar === 'function') {
      ensureDrawerOptions();
      return;
    }
    installTarget.dataset.filterFallbackInstalled = '';

    if (typeof window.eqOpenSidebar === 'function' && !window.eqOpenSidebar._fallback) window.__eqAppOpen = window.eqOpenSidebar;
    if (typeof window.eqCloseSidebar === 'function' && !window.eqCloseSidebar._fallback) window.__eqAppClose = window.eqCloseSidebar;
    if (typeof window.eqResetDrawer === 'function' && !window.eqResetDrawer._fallback) window.__eqAppReset = window.eqResetDrawer;
    if (typeof window.eqApplyDrawerFilters === 'function' && !window.eqApplyDrawerFilters._fallback) window.__eqAppApply = window.eqApplyDrawerFilters;
    if (typeof window.eqSyncDrawerFromActive === 'function' && !window.eqSyncDrawerFromActive._fallback) window.__eqAppSync = window.eqSyncDrawerFromActive;

    let fallbackState = window.__eqFallbackState || { category: '', gov: '', sort: 'newest', price: 0 };
    window.__eqFallbackState = fallbackState;

    function priceLabel(value) {
      return value > 0 ? Number(value).toLocaleString('ar-EG') + ' ط¬' : 'ط¨ظ„ط§ ط­ط¯';
    }

    function ensureDrawerOptions() {
      const tabs = document.getElementById('eq-drawer-tabs');
      const gov = document.getElementById('eq-drawer-gov');
      const sort = document.getElementById('eq-drawer-sort');
      const price = document.getElementById('eq-drawer-price');
      const priceVal = document.getElementById('eq-drawer-price-val');

      if (tabs && !tabs.children.length) {
        tabs.innerHTML = '<button type="button" class="eq-tab on" data-cat="">ط§ظ„ظƒظ„</button>' +
          FALLBACK_CATEGORIES.map(([id, label]) => `<button type="button" class="eq-tab" data-cat="${id}">${label}</button>`).join('');
      }
      if (tabs && tabs.children.length) {
        tabs.querySelectorAll('.eq-tab').forEach(btn => {
          if (btn.hasAttribute('data-cat')) return;
          const onclick = btn.getAttribute('onclick') || '';
          const match = onclick.match(/eqDrawerSetCategory\('([^']*)'/);
          if (match) btn.dataset.cat = match[1];
          else if (btn.textContent.trim() === 'ط§ظ„ظƒظ„') btn.dataset.cat = '';
        });
      }
      if (gov && gov.options.length <= 1) {
        gov.innerHTML = '<option value="">ظƒظ„ ط§ظ„ظ…ط­ط§ظپط¸ط§طھ</option>' +
          FALLBACK_GOVS.map(g => `<option value="${g}">${g}</option>`).join('');
      }
      if (sort && !sort.value) sort.value = fallbackState.sort || 'newest';
      if (price) price.value = fallbackState.price || 0;
      if (priceVal) priceVal.textContent = priceLabel(fallbackState.price || 0);
      syncDrawerUi();
    }

    function syncDrawerUi() {
      const tabs = document.getElementById('eq-drawer-tabs');
      if (tabs) {
        tabs.querySelectorAll('.eq-tab').forEach(btn => {
          const cat = btn.dataset.cat ?? '';
          btn.classList.toggle('on', cat === (fallbackState.category || ''));
        });
      }
      const badge = document.getElementById('eq-drawer-badge');
      const mobileBadge = document.getElementById('eq-mobile-filter-badge');
      if (badge) {
        const count = (fallbackState.category ? 1 : 0) + (fallbackState.gov ? 1 : 0) + ((fallbackState.price || 0) > 0 ? 1 : 0);
        badge.textContent = count;
        badge.classList.toggle('show', count > 0);
        if (mobileBadge) {
          mobileBadge.textContent = count;
          mobileBadge.classList.toggle('show', count > 0);
        }
      }
    }

    function applyDomFilters() {
      const cards = Array.from(document.querySelectorAll('#eq-grid .eq-card'));
      let shown = 0;
      cards.forEach(card => {
        const category = card.dataset.category || '';
        const region = card.dataset.region || '';
        const price = Number(card.dataset.price || 0);
        const okCategory = !fallbackState.category || category === fallbackState.category;
        const okGov = !fallbackState.gov || region === fallbackState.gov;
        const okPrice = !fallbackState.price || price <= fallbackState.price;
        const show = okCategory && okGov && okPrice;
        card.style.display = show ? '' : 'none';
        if (show) shown++;
      });
      const count = document.getElementById('eq-count');
      if (count && cards.length) count.textContent = shown + ' ط¥ط¹ظ„ط§ظ†';
    }

    function forceOpen() {
      ensureDrawerOptions();
      try { if (typeof window.__eqAppSync === 'function') window.__eqAppSync(); } catch (_) {}
      document.body.classList.add('filter-open');
      drawer.classList.add('is-open');
      drawer.style.transform = 'translateX(0)';
      drawer.style.pointerEvents = 'auto';
      drawer.style.visibility = 'visible';
      drawer.style.display = 'block';
      drawer.style.zIndex = '10001';
      if (panel) panel.style.pointerEvents = 'auto';
      if (overlay) overlay.style.display = 'block';
      if (tab) tab.setAttribute('aria-expanded', 'true');
      if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'true');
    }

    function forceClose() {
      document.body.classList.remove('filter-open');
      drawer.classList.remove('is-open');
      drawer.style.transform = '';
      drawer.style.pointerEvents = '';
      drawer.style.visibility = '';
      drawer.style.display = '';
      drawer.style.zIndex = '';
      if (panel) panel.style.pointerEvents = '';
      if (overlay) overlay.style.display = '';
      if (tab) tab.setAttribute('aria-expanded', 'false');
      if (mobileBtn) mobileBtn.setAttribute('aria-expanded', 'false');
    }

    window.eqOpenSidebar = function () {
      try { if (typeof window.__eqAppOpen === 'function') window.__eqAppOpen(); } catch (_) {}
      forceOpen();
    };
    window.eqOpenSidebar._fallback = true;

    window.eqCloseSidebar = function () {
      try { if (typeof window.__eqAppClose === 'function') window.__eqAppClose(); } catch (_) {}
      forceClose();
    };
    window.eqCloseSidebar._fallback = true;

    window.eqResetDrawer = function () {
      fallbackState.category = '';
      fallbackState.gov = '';
      fallbackState.sort = 'newest';
      fallbackState.price = 0;
      const gov = document.getElementById('eq-drawer-gov');
      const sort = document.getElementById('eq-drawer-sort');
      const price = document.getElementById('eq-drawer-price');
      const priceVal = document.getElementById('eq-drawer-price-val');
      if (gov) gov.value = '';
      if (sort) sort.value = 'newest';
      if (price) price.value = 0;
      if (priceVal) priceVal.textContent = priceLabel(0);
      syncDrawerUi();
      try { if (typeof window.__eqAppReset === 'function') window.__eqAppReset(); } catch (_) {}
    };
    window.eqResetDrawer._fallback = true;

    window.eqApplyDrawerFilters = function () {
      const gov = document.getElementById('eq-drawer-gov');
      const sort = document.getElementById('eq-drawer-sort');
      const price = document.getElementById('eq-drawer-price');
      fallbackState.gov = gov ? gov.value : fallbackState.gov;
      fallbackState.sort = sort ? sort.value : fallbackState.sort;
      fallbackState.price = price ? (parseInt(price.value, 10) || 0) : fallbackState.price;

      if (typeof window.__eqAppApply === 'function') {
        try { window.__eqAppApply(); } catch (_) { applyDomFilters(); }
      } else {
        applyDomFilters();
      }
      applyDomFilters();
      forceClose();
    };
    window.eqApplyDrawerFilters._fallback = true;

    window.eqDrawerGovChange = function (sel) {
      fallbackState.gov = sel.value;
      try { if (window.__eqAppGovChange) window.__eqAppGovChange(sel); } catch (_) {}
      syncDrawerUi();
    };

    window.eqDrawerSortChange = function (sel) {
      fallbackState.sort = sel.value;
      try { if (window.__eqAppSortChange) window.__eqAppSortChange(sel); } catch (_) {}
    };

    window.eqDrawerPriceChange = function (inp) {
      fallbackState.price = parseInt(inp.value, 10) || 0;
      const priceVal = document.getElementById('eq-drawer-price-val');
      if (priceVal) priceVal.textContent = priceLabel(fallbackState.price);
      try { if (window.__eqAppPriceChange) window.__eqAppPriceChange(inp); } catch (_) {}
      syncDrawerUi();
    };

    window.eqDrawerSetCategory = function (cat, el) {
      fallbackState.category = cat || '';
      if (el && el.dataset) el.dataset.cat = fallbackState.category;
      syncDrawerUi();
    };

    function bindOpen(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      window.eqOpenSidebar();
    }

    if (tab) {
      ['pointerdown', 'touchstart'].forEach(type => {
        tab.addEventListener(type, bindOpen, true);
      });
      tab.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      }, true);
    }
    if (mobileBtn) {
      ['pointerdown', 'click'].forEach(type => {
        mobileBtn.addEventListener(type, bindOpen, true);
      });
    }
    const tabs = document.getElementById('eq-drawer-tabs');
    if (tabs && !tabs.dataset.fallbackBound) {
      tabs.dataset.fallbackBound = '1';
      tabs.addEventListener('click', function (ev) {
        const btn = ev.target.closest('.eq-tab');
        if (!btn) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        fallbackState.category = btn.dataset.cat || '';
        syncDrawerUi();
      }, true);
    }
    if (overlay) overlay.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      window.eqCloseSidebar();
    }, true);
    if (panel) panel.addEventListener('click', function (ev) {
      ev.stopPropagation();
    }, false);
    if (close) close.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      window.eqCloseSidebar();
    }, true);
    if (reset) reset.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      window.eqResetDrawer();
    }, true);
    if (apply) apply.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      window.eqApplyDrawerFilters();
    }, true);

    installTarget.dataset.filterFallbackInstalled = '1';
    ensureDrawerOptions();
  }

  window.addEventListener('DOMContentLoaded', installMarketFilterFallback);
  window.addEventListener('load', installMarketFilterFallback);
  setTimeout(installMarketFilterFallback, 1000);
})();

