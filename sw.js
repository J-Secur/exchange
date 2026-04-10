// ═══════════════════════════════════════════════════════════════════
//  sw.js — J-Secur Service Worker
//  • Mode hors-ligne (cache-first pour les assets)
//  • Notifications Push en arrière-plan
//  • Background sync pour les messages en attente
// ═══════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'jsecur-v1.2';
const OFFLINE_URL   = '/offline.html';

// Assets à mettre en cache pour le mode hors-ligne
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing…');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating…');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne pas intercepter les requêtes Firebase / Firestore / Storage
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebasestorage.googleapis.com')
  ) {
    return; // Laisser passer tel quel
  }

  // Stratégie : Network-first pour les navigations HTML
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return response;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match('/'))
        )
    );
    return;
  }

  // Stratégie : Cache-first pour les assets statiques (CSS, JS, images)
  if (
    request.method === 'GET' &&
    (url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.png') ||
     url.pathname.endsWith('.jpg') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.webp') ||
     url.pathname.endsWith('.woff2'))
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────
self.addEventListener('push', event => {
  let payload = { title: 'J-Secur', body: 'Nouveau message', groupId: null };

  try {
    payload = { ...payload, ...event.data.json() };
  } catch (e) {
    if (event.data) payload.body = event.data.text();
  }

  const options = {
    body     : payload.body,
    icon     : '/assets/icon-192.png',
    badge    : '/assets/icon-96.png',
    tag      : `msg-${payload.groupId || 'general'}`,
    renotify : true,
    silent   : false,
    vibrate  : [100, 50, 100],
    data     : { url: payload.groupId ? `/?open=${payload.groupId}` : '/' },
    actions  : [
      { action: 'open',    title: 'Ouvrir',       icon: '/assets/icon-96.png' },
      { action: 'dismiss', title: 'Ignorer' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Réutiliser un onglet existant si possible
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      // Sinon ouvrir un nouvel onglet
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── BACKGROUND SYNC (messages en attente) ─────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-messages') {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  // Les messages mis en attente sont dans IndexedDB (géré côté app.js)
  // Cette fonction est appelée quand la connexion revient
  const allClients = await clients.matchAll({ type: 'window' });
  allClients.forEach(client => {
    client.postMessage({ type: 'SYNC_MESSAGES' });
  });
}

// ── MESSAGE FROM APP ──────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

console.log('[SW] J-Secur Service Worker loaded —', CACHE_NAME);
