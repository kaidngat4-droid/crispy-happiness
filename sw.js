/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — مركز القلب والقسطرة القلبية
   نظام الشكاوى الإلكتروني v2.1 · Offline-First Strategy
   ═══════════════════════════════════════════════════════════════ */

const CACHE_VERSION = 'v2.1.0';
const CACHE_NAME = `heart-center-${CACHE_VERSION}`;
const STATIC_CACHE = `hc-static-${CACHE_VERSION}`;
const IMAGE_CACHE = `hc-images-${CACHE_VERSION}`;
const API_CACHE = `hc-api-${CACHE_VERSION}`;

// الصفحات والملفات الثابتة
const STATIC_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './new-complaint.html',
  './complaint-detail.html',
  './users.html',
  './reports.html',
  './settings.html',
  './manifest.json',
  './js/db.js',
  './js/auth.js',
  './js/utils.js',
  './js/notifications.js',
  './js/export.js',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800;900&family=Tajawal:wght@300;400;500;700;800&family=Aref+Ruqaa:wght@400;700&family=Great+Vibes&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'
];

// الصور
const IMAGE_ASSETS = [
  './images/logo.png',
  './images/heart.png',
  './images/icons/icon-72x72.png',
  './images/icons/icon-96x96.png',
  './images/icons/icon-128x128.png',
  './images/icons/icon-144x144.png',
  './images/icons/icon-152x152.png',
  './images/icons/icon-192x192.png',
  './images/icons/icon-384x384.png',
  './images/icons/icon-512x512.png'
];

// ─── Install ───
self.addEventListener('install', event => {
  console.log('%c⚡ Heart Center SW', 'color:#D4AF37;font-size:14px;font-weight:900;', `v${CACHE_VERSION} installing...`);

  event.waitUntil(
    (async () => {
      try {
        // تثبيت الملفات الثابتة
        const staticCache = await caches.open(STATIC_CACHE);
        await Promise.all(
          STATIC_ASSETS.map(async url => {
            try {
              const response = await fetch(url, { cache: 'no-cache' });
              if (response.ok) {
                await staticCache.put(url, response);
              } else {
                console.warn('%c⚠️ Failed to cache', 'color:#FF6B35;', url);
              }
            } catch (err) {
              console.warn('%c⚠️ Skipped', 'color:#FF6B35;', url, err.message);
            }
          })
        );

        // تثبيت الصور (اختياري - لا يفشل التثبيت إذا لم توجد)
        const imageCache = await caches.open(IMAGE_CACHE);
        await Promise.all(
          IMAGE_ASSETS.map(async url => {
            try {
              const response = await fetch(url, { cache: 'no-cache' });
              if (response.ok) {
                await imageCache.put(url, response);
              }
            } catch (err) {
              // الصور اختيارية - نتجاهل الأخطاء
              console.log('%c🖼️ Image not found (optional)', 'color:#8a9bb0;', url);
            }
          })
        );

        console.log('%c✅', 'color:#39FF14;', 'Assets cached successfully');
        await self.skipWaiting();
      } catch (error) {
        console.error('%c❌ Install failed:', 'color:#FF073A;', error);
      }
    })()
  );
});

// ─── Activate & Cleanup ───
self.addEventListener('activate', event => {
  console.log('%c🛡️ Heart Center SW', 'color:#D4AF37;font-size:14px;font-weight:900;', `v${CACHE_VERSION} activating...`);

  event.waitUntil(
    (async () => {
      // حذف الكاش القديم
      const cacheNames = await caches.keys();
      const validCaches = [STATIC_CACHE, IMAGE_CACHE, API_CACHE];
      
      await Promise.all(
        cacheNames
          .filter(name => !validCaches.includes(name) && name.startsWith('hc-'))
          .map(name => {
            console.log('%c🗑️', 'color:#FF6B35;', 'Deleting old cache:', name);
            return caches.delete(name);
          })
      );

      // تنظيف الكاش من الملفات القديمة
      await cleanupOldEntries(STATIC_CACHE, STATIC_ASSETS);
      await cleanupOldEntries(IMAGE_CACHE, IMAGE_ASSETS);

      await self.clients.claim();
      console.log('%c✅ Activation complete', 'color:#39FF14;');
    })()
  );
});

// ─── Fetch Strategy ───
self.addEventListener('fetch', event => {
  const { request } = event;
  
  // تجاهل الطلبات غير GET
  if (request.method !== 'GET') return;
  
  // تجاهل الطلبات عبر البروتوكولات غير المدعومة
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // API calls
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // الصور: Cache First مع fallback
  if (request.destination === 'image') {
    event.respondWith(imageStrategy(request));
    return;
  }

  // CSS/Fonts: Stale While Revalidate
  if (request.destination === 'style' || request.destination === 'font' || 
      url.pathname.includes('font-awesome') || url.pathname.includes('googleapis')) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Scripts: Network First مع fallback
  if (request.destination === 'script') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // الصفحات: Network First مع fallback للكاش
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(pageStrategy(request));
    return;
  }

  // باقي الطلبات
  event.respondWith(
    caches.match(request).then(response => response || fetch(request))
  );
});

// ═══════════════════════════════════════════════════════════════
// Strategies
// ═══════════════════════════════════════════════════════════════

/** Network First: للصفحات و API */
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(cacheName);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('%c⚠️ Network failed, trying cache:', 'color:#FF6B35;', request.url);
    const cached = await caches.match(request);
    
    if (cached) {
      return cached;
    }
    
    // Fallback للصفحات
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match('./index.html');
      if (offlinePage) return offlinePage;
    }
    
    throw error;
  }
}

/** Stale While Revalidate: للـ CSS/Fonts */
async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request);
  
  const fetchPromise = fetch(request)
    .then(async response => {
      if (response && response.status === 200) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

/** Cache First: للصور مع fallback */
async function imageStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    
    if (response && response.status === 200) {
      const cache = await caches.open(IMAGE_CACHE);
      await cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.warn('%c🖼️ Image unavailable offline', 'color:#FF6B35;', request.url);
    
    // إرجاع SVG placeholder
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
        <rect width="100" height="100" fill="#f0f0f0"/>
        <text x="50" y="55" font-family="Arial" font-size="12" fill="#999" text-anchor="middle">📷</text>
      </svg>`,
      { 
        headers: { 
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'no-cache'
        } 
      }
    );
  }
}

/** صفحة: Network First مع offline fallback */
async function pageStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.warn('%c⚠️ Offline, trying cache:', 'color:#FF6B35;', request.url);
    
    // محاولة العثور على الصفحة في الكاش
    const cached = await caches.match(request);
    if (cached) return cached;
    
    // محاولة العثور على index.html كـ fallback
    const fallback = await caches.match('./index.html');
    if (fallback) return fallback;
    
    throw error;
  }
}

// ─── Helpers ───
async function cleanupOldEntries(cacheName, validUrls) {
  try {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    await Promise.all(
      requests
        .filter(request => !validUrls.includes(request.url))
        .map(request => {
          console.log('%c🗑️ Removing old entry:', 'color:#FF6B35;', request.url);
          return cache.delete(request);
        })
    );
  } catch (error) {
    console.warn('⚠️ Cleanup failed for', cacheName, error);
  }
}

// ─── Message Handler ───
self.addEventListener('message', event => {
  const data = event.data;
  
  switch (data) {
    case 'skipWaiting':
      self.skipWaiting();
      break;
    case 'clearCaches':
      // مسح جميع الكاشات
      event.waitUntil(
        caches.keys().then(names => 
          Promise.all(names.map(name => caches.delete(name)))
        ).then(() => {
          console.log('%c🗑️ All caches cleared', 'color:#FF6B35;');
          // إعادة التثبيت
          return self.skipWaiting();
        })
      );
      break;
    case 'getVersion':
      // إرسال النسخة للعميل
      if (event.source) {
        event.source.postMessage({
          type: 'sw-version',
          version: CACHE_VERSION
        });
      }
      break;
    default:
      if (data && data.type === 'cache-version') {
        if (event.source) {
          event.source.postMessage({
            type: 'sw-version',
            version: CACHE_VERSION
          });
        }
      }
  }
});

// ─── Push Notification ───
self.addEventListener('push', event => {
  let data = { title: 'مركز القلب', body: 'لديك إشعار جديد' };
  
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }
  
  event.waitUntil(
    self.registration.showNotification(data.title || 'مركز القلب', {
      body: data.body || 'لديك إشعار جديد',
      icon: './images/logo.png',
      badge: './images/icons/icon-72x72.png',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      data: data.data || {}
    })
  );
});

// ─── Notification Click ───
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // التركيز على نافذة موجودة أو فتح جديدة
        for (const client of clientList) {
          if ('focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow('./dashboard.html');
      })
  );
});

// ─── Sync ───
self.addEventListener('sync', event => {
  if (event.tag === 'sync-complaints') {
    event.waitUntil(syncComplaints());
  }
});

async function syncComplaints() {
  console.log('%c🔄 Syncing complaints...', 'color:#00F3FF;');
  
  try {
    // قراءة الشكاوى المحلية
    const cache = await caches.open(API_CACHE);
    const pendingRequests = await cache.keys();
    
    // إرسال الشكاوى المعلقة
    for (const request of pendingRequests) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          await cache.delete(request);
        }
      } catch (e) {
        console.warn('Sync failed for:', request.url);
      }
    }
    
    console.log('%c✅ Sync complete', 'color:#39FF14;');
  } catch (error) {
    console.error('%c❌ Sync failed:', 'color:#FF073A;', error);
  }
}

console.log('%c❤️ Heart Center SW v2.1', 'color:#D4AF37;font-size:16px;font-weight:900;', 'loaded successfully');