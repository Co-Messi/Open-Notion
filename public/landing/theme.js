// Apply the saved theme before first paint so there is no flash.
(function () {
  try {
    var t = localStorage.getItem('opennotion.landing.theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
  document.documentElement.classList.add('js');
})();
