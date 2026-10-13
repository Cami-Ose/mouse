/**
 * Mouse PWA Service Worker — 仅用于清除旧缓存，不再拦截请求
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
  );
  self.clients.claim();
});
// 不拦截任何 fetch，全部走网络
