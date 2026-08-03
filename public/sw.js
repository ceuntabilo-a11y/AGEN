const CACHE = 'agen-v2'
const CORE = ['/login', '/offline.html', '/manifest.webmanifest', '/icon.svg']
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE))))
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))))
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname.startsWith('/profesional') || url.pathname.startsWith('/cliente')) return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then(response => response || caches.match('/offline.html'))))
})
