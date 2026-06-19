// ═══════════════════════════════════════════════════════
// Gesits Nav — Service Worker
// Caching: app shell (biar PWA-nya bisa dibuka offline) +
// tile peta (biar rute yang pernah dilewati tetap muncul
// walau sinyal lemah/hilang). Data dinamis (rute, geocode,
// cuaca) SENGAJA tidak di-cache — selalu 'v5'fresh.
// ═══════════════════════════════════════════════════════

// Naikkan VERSION ini setiap kali deploy perubahan baru ke GitHub.
// Browser bakal deteksi sw.js berubah → toast "Update tersedia" muncul di app.
const VERSION     = 'v7';
const SHELL_CACHE = `gesits-shell-${VERSION}`;
const TILE_CACHE  = `gesits-tiles-${VERSION}`;
const TILE_CACHE_MAX = 600; // batas jumlah tile tersimpan, biar storage HP nggak penuh

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Host tile peta — di-cache cache-first (Mapbox + semua basemap gratis OSM/CARTO/Esri)
const TILE_HOSTS = [
  'api.mapbox.com',
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org',
  'basemaps.cartocdn.com',
  'server.arcgisonline.com',
];

// Host data dinamis — JANGAN disentuh sama sekali, selalu langsung ke network
const NO_CACHE_HOSTS = [
  'nominatim.openstreetmap.org',
  'router.project-osrm.org',
  'api.open-meteo.com',
  'api.openchargemap.io',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {}) // jangan sampai gagal install gara-gara satu file precache gagal
  );
  // SENGAJA tidak skipWaiting() di sini — SW baru ditahan di state "waiting"
  // sampai user klik "Update" di toast (lihat index.html: applyUpdate()).
});

// Dipanggil dari index.html saat user klik tombol "Update" di toast
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== SHELL_CACHE && n !== TILE_CACHE)
             .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

function hostMatches(hostname, list){
  return list.some((h) => hostname === h || hostname.endsWith('.' + h));
}

async function trimCache(cacheName, maxItems){
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxItems;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // jangan campur tangan request non-GET

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Data dinamis (rute/geocode/cuaca/elevasi) → selalu network langsung
  if (hostMatches(url.hostname, NO_CACHE_HOSTS)) return;

  // Tile peta → cache-first, simpan hasil baru ke tile cache (dengan batas ukuran)
  if (hostMatches(url.hostname, TILE_HOSTS)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            cache.put(req, res.clone());
            trimCache(TILE_CACHE, TILE_CACHE_MAX);
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  // App shell sendiri → cache-first, update cache di background tiap kali online
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
