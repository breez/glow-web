// Service Worker Registration. Web only.
// In the native shell the assets are already on-device and offline-capable,
// so the service worker buys nothing: its "network" is just the local asset
// server, yet it still intercepts every request and re-copies the JS bundle
// and the multi-megabyte WASM into Cache Storage on every cold start. Skip
// it there, and unregister (plus drop its caches) for installs that picked
// one up from an earlier build.
//
// A separate file, not an inline <script>: the CSP ships script-src 'self'
// with no 'unsafe-inline'.
(function () {
  if (!('serviceWorker' in navigator)) return;

  // The native bridge injects window.Capacitor before page scripts run.
  var cap = window.Capacitor;
  var isNative = !!(cap && (typeof cap.isNativePlatform === 'function'
    ? cap.isNativePlatform()
    : (cap.platform && cap.platform !== 'web')));

  if (isNative) {
    navigator.serviceWorker.getRegistrations()
      .then(function (regs) { regs.forEach(function (r) { r.unregister(); }); })
      .catch(function () { /* nothing registered: fine */ });
    if (window.caches && caches.keys) {
      caches.keys()
        .then(function (keys) {
          keys.filter(function (k) { return k.indexOf('glow-') === 0; })
            .forEach(function (k) { caches.delete(k); });
        })
        .catch(function () { /* no cache storage: fine */ });
    }
    return;
  }

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js')
      .then(function (registration) {
        console.log('SW registered:', registration.scope);
      })
      .catch(function (error) {
        console.log('SW registration failed:', error);
      });
  });
})();
