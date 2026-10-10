/* One form, two presentations. Native dialog isolates the background. */
(() => {
  const panel = document.getElementById('home-search-panel');
  const form = document.getElementById('search-box');
  const trigger = document.getElementById('home-search-trigger');
  const mobile = matchMedia('(max-width: 720px)');
  if (!panel || !form || !trigger) return;
  const rentalOptions = document.getElementById('home-rental-options');
  const rentalToggle = document.getElementById('home-rental-toggle');

  function updateSummary() {
    const rental = document.getElementById('f-rental');
    const rentalValue = document.getElementById('home-rental-value');
    const label = rental.selectedOptions[0]?.textContent.trim() || '';
    if (rentalValue.textContent !== label) rentalValue.textContent = label;
    form.querySelectorAll('[name="home-rental-choice"]').forEach(input => { input.checked = input.value === rental.value; });
    if (rental.hasAttribute('aria-invalid')) rentalToggle.setAttribute('aria-invalid', 'true');
    else rentalToggle.removeAttribute('aria-invalid');
    const parts = ['f-region', 'f-act', 'f-rental'].map(id => {
      const field = document.getElementById(id);
      return field?.value ? field.selectedOptions[0]?.textContent.trim() : '';
    }).filter(Boolean);
    document.getElementById('home-search-summary').textContent = parts.length
      ? parts.join(' · ')
      : (typeof t === 'function' ? t('search.rental.summary') : 'المنطقة · النشاط · نوع التأجير');
  }
  window.openHomeSearch = () => {
    if (!mobile.matches || panel.open) return;
    trigger.focus({ preventScroll: true });
    document.getElementById('home-search-panel-body').appendChild(form);
    panel.showModal();
    document.body.classList.add('home-search-open');
    trigger.setAttribute('aria-expanded', 'true');
    rentalToggle.focus({ preventScroll: true });
  };
  window.closeHomeSearch = () => { if (panel.open) panel.close(); };
  panel.addEventListener('close', () => {
    document.getElementById('home-search-inline').appendChild(form);
    document.body.classList.remove('home-search-open');
    trigger.setAttribute('aria-expanded', 'false');
    updateSummary();
    rentalOptions.open = false;
    if (mobile.matches && document.getElementById('pg-home').classList.contains('active') && !document.querySelector('#hlp-modal.open, dialog[open]')) trigger.focus({ preventScroll: true });
  });
  panel.addEventListener('click', event => {
    const rect = panel.getBoundingClientRect();
    if (event.target === panel && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) panel.close();
  });
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button, summary, select, input, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });
  mobile.addEventListener('change', () => {
    if (!mobile.matches) closeHomeSearch();
  });
  window.resetHomeSearch = () => {
    ['f-region', 'f-act', 'f-rental'].forEach(id => { document.getElementById(id).value = ''; });
    selectedAct = '';
    document.getElementById('rental-error').hidden = true;
    document.getElementById('f-rental').removeAttribute('aria-invalid');
    setDiscoveryIntent('');
    updateSummary();
    rentalOptions.open = false;
    (mobile.matches ? rentalToggle : document.getElementById('f-region')).focus();
  };
  window.chooseHomeRental = value => {
    const rental = document.getElementById('f-rental');
    rental.value = value;
    rental.dispatchEvent(new Event('change', { bubbles: true }));
    rentalOptions.open = false;
    rentalToggle.focus({ preventScroll: true });
  };
  form.addEventListener('submit', () => {
    if (mobile.matches && !document.getElementById('f-rental').value) {
      rentalOptions.open = true;
      rentalToggle.setAttribute('aria-invalid', 'true');
      rentalToggle.focus();
    }
  });
  form.addEventListener('change', updateSummary);
  document.addEventListener('makani:locale-changed', updateSummary);
  new MutationObserver(updateSummary).observe(form, { childList: true, subtree: true });
  updateSummary();
})();
