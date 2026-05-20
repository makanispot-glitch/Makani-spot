/* ================================================================
   🔧 sw.js — Service Worker | مكاني Spot PWA
   ================================================================
   الاستراتيجية:
   • CSS / JS files                → Cache-First  (الـ ?v= بيتغير عند كل تحديث)
   • HTML pages                    → Network-First + Cache Fallback
   • Static assets (images/icons)  → Cache-First
   • Google Fonts / CDN            → Stale-While-Revalidate
   • Supabase API / R2 images      → Network-Only (بيانات حية)
   • Offline                       → صفحة بديلة /offline.html
   ================================================================ */

/* ── الإصدار: غيّر هذا الرقم عند كل نشر جديد ────────────────
   الصيغة: YYYYMMDD-HHMM  →  سهل تعرف امتى اتعمل
   ─────────────────────────────────────────────────────────── */
const CACHE_VER   = 'v202605201926';
const SHELL_CACHE = `makani-shell-${CACHE_VER}`;
const FONT_CACHE  = `makani-fonts-${CACHE_VER}`;
const CDN_CACHE   = `makani-cdn-${CACHE_VER}`;

/* الملفات المُخزَّنة مُسبقاً عند التثبيت */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* ── Install ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   // يصبح نشطاً فوراً بدون انتظار
  );
});

/* ── Activate (تنظيف الكاشات القديمة) ───────────────────────── */
self.addEventListener('activate', event => {
  const ACTIVE = new Set([SHELL_CACHE, FONT_CACHE, CDN_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => !ACTIVE.has(k)).map(k => {
          console.log(`[SW] حذف كاش قديم: ${k}`);
          return caches.delete(k);
        }))
      )
      .then(() => self.clients.claim())  // يتحكم في جميع التبويبات المفتوحة
      .then(() => {
        // أبلغ كل الصفحات المفتوحة أن هناك تحديثاً جديداً
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'SW_UPDATED',
              version: CACHE_VER,
            });
          });
        });
      })
  );
});

/* ── Fetch (منطق الاستجابة) ─────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* 0. تطوير محلي → تجاوز الكاش بالكامل */
  if (url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname.startsWith('192.168.')) {
    return;
  }

  /* 1. Supabase API + R2 + uploads → Network-Only */
  if (url.hostname.endsWith('supabase.co') ||
      url.hostname.endsWith('r2.dev') ||
      url.pathname.startsWith('/upload')) {
    return;
  }

  /* 2. Google Fonts → Stale-While-Revalidate */
  if (url.hostname.endsWith('fonts.gstatic.com') ||
      url.hostname.endsWith('fonts.googleapis.com')) {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  /* 3. CDN (jsDelivr, unpkg) → Stale-While-Revalidate */
  if (url.hostname.endsWith('cdn.jsdelivr.net') ||
      url.hostname.endsWith('unpkg.com')) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  /* 4. صفحات HTML → Network-First (أهم شيء يجيب آخر نسخة) */
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  /* 5. CSS و JS (مع أو بدون ?v=) → Cache-First
     ✅ الـ ?v= بيضمن إن كل تحديث له URL مختلف في الكاش */
  if (url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* 6. الأصول الثابتة (صور، أيقونات) → Cache-First */
  event.respondWith(cacheFirst(request));
});

/* ── استراتيجيات الاستجابة ───────────────────────────────────── */

/** Cache-First: يُرجع من الكاش، يجيب من الشبكة لو مش موجود */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('', { status: 503, statusText: 'Service Unavailable' });
  }
}

/** Network-First للـ HTML */
async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return caches.match('/offline.html');
  }
}

/** Stale-While-Revalidate */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);

  return cached ?? networkPromise;
}

/* ── رسالة من الصفحة ────────────────────────────────────────── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
