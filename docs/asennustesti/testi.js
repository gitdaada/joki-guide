'use strict';
(function () {
  var s = document.getElementById('tila');
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  s.textContent = standalone ? 'Avattu asennettuna sovelluksena. Testi onnistui.' : 'Avattu selaimessa. Valitse Chromen valikosta ⋮ → Asenna sovellus.';
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(function () {});
})();
