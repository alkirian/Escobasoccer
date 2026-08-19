// Service worker: red primero, caché de respaldo.
//
// La estrategia importa más que el código: "red primero" significa que con
// conexión SIEMPRE se sirve la versión fresca (nada de builds viejos pegados
// — el clásico dolor de los service workers), y sin conexión se sirve lo
// último que se vio. El juego queda jugable offline sin arriesgar frescura.
const CACHE = 'escoba-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Solo mismo origen: nada de cachear terceros
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Guardar copia solo de respuestas sanas
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
