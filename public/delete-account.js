// Escape hatch when this page loads inside an installed PWA's own window
// (in-scope navigation shows no browser chrome, so there is no other way
// back). Hidden in normal tabs and in the app's overlay iframe.
//
// A separate file, not an inline <script> / onclick: the CSP ships
// script-src 'self' with no 'unsafe-inline'.
(function () {
  if (window.self === window.top
    && (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true)) {
    document.documentElement.classList.add('standalone');
  }

  var back = document.querySelector('.back-bar');
  if (back) {
    back.addEventListener('click', function () {
      if (history.length > 1) history.back();
      else location.href = '/';
    });
  }
})();
