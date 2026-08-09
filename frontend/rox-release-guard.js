(function () {
  'use strict';
  var config = window.ROX_RUNTIME_CONFIG || {};
  var profile = String(config.PROFILE || 'unknown').toLowerCase();
  var flags = Object.assign({ projects: false, history: false, automations: false, roxip: false }, config.FEATURES || {});
  var labels = { projects: 'Projects', history: 'History', automations: 'Automations', roxip: 'Rox IP' };

  document.documentElement.dataset.roxProfile = profile;

  function featureFromElement(element) {
    if (!element) return '';
    var name = String(element.getAttribute('data-open') || element.getAttribute('data-tab') || '').toLowerCase();
    if (name === 'roxip') return 'roxip';
    if (name === 'projects') return 'projects';
    if (name === 'history') return 'history';
    if (name === 'automations') return 'automations';
    return '';
  }

  function messageFor(feature) {
    if (typeof window.roxT === 'function') {
      var translated = window.roxT('common.comingSoon');
      if (translated && translated !== 'common.comingSoon') return translated;
    }
    return (labels[feature] || 'This feature') + ' — Coming soon';
  }

  function showNotice(feature) {
    var old = document.getElementById('roxReleaseNotice');
    if (old) old.remove();
    var notice = document.createElement('div');
    notice.id = 'roxReleaseNotice';
    notice.textContent = messageFor(feature);
    notice.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;background:#1e1914;color:#f6efe4;border:1px solid rgba(167,139,250,.35);padding:12px 16px;border-radius:12px;font:600 13px Inter,Arial,sans-serif;box-shadow:0 14px 38px rgba(0,0,0,.45);max-width:calc(100vw - 32px);text-align:center';
    document.body.appendChild(notice);
    setTimeout(function () { if (notice.isConnected) notice.remove(); }, 2600);
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target && event.target.closest ? event.target.closest('[data-open],[data-tab]') : null;
    var feature = featureFromElement(trigger);
    if (feature && flags[feature] === false) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showNotice(feature);
    }
  }, true);

  function applyReleaseState() {
    var style = document.createElement('style');
    style.textContent = '[data-rox-coming-soon="true"]{opacity:.62!important;filter:saturate(.45)}[data-rox-coming-soon="true"]::after{content:"SOON";font:700 8px Inter,Arial,sans-serif;letter-spacing:.08em;margin-left:7px;padding:2px 5px;border-radius:999px;background:rgba(167,139,250,.15);color:#c4b5fd;border:1px solid rgba(167,139,250,.25)}#roxProfileBadge{position:fixed;right:10px;bottom:10px;z-index:2147483646;padding:5px 8px;border-radius:999px;background:rgba(5,4,3,.88);border:1px solid rgba(167,139,250,.28);color:#c4b5fd;font:700 9px Inter,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase;pointer-events:none}';
    document.head.appendChild(style);
    Object.keys(flags).forEach(function (feature) {
      if (flags[feature] !== false) return;
      var selector = feature === 'roxip' ? '[data-open="roxip"]' : '[data-open="' + feature + '"],[data-tab="' + feature + '"]';
      document.querySelectorAll(selector).forEach(function (element) { element.dataset.roxComingSoon = 'true'; element.setAttribute('aria-disabled', 'true'); });
    });
    if (profile !== 'production') {
      var badge = document.createElement('div');
      badge.id = 'roxProfileBadge';
      badge.textContent = 'ROX ' + profile;
      document.body.appendChild(badge);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyReleaseState, { once: true });
  else applyReleaseState();
})();
