/* Shared, stateless FlowButton content for native booking buttons. */
window.MakaniFlowButton = (() => {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>';
  function content(text) {
    return `<span class="mk-flow-arrow mk-flow-arrow--in" aria-hidden="true">${arrow}</span><span class="mk-flow-label">${escape(text)}</span><span class="mk-flow-arrow mk-flow-arrow--out" aria-hidden="true">${arrow}</span>`;
  }
  return { content };
})();
