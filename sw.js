/* ================================================================
   🔧 sw.js — Service Worker | مكاني Spot PWA
   ================================================================
   الاستراتيجية:
   • Static assets (CSS/JS/icons)  → Cache-First
   • HTML pages                    → Network-First + Cache Fallback
   • Google Fonts / CDN            → Stale-While-Revalidate
   • Supabase API / R2 images      → Network-Only (بيانات حية)
   • Offline                       → صفحة بديلة /offline.html
   ================================================================ */

const CACHE_VER    = 'v12';                     // ← غيّر هذا عند كل نشر جديد
const SHELL_CACHE  = `makani-shell-${CACHE_VER}`;
const FONT_CACHE   = `makani-fonts-${CACHE_VER}`;
const CDN_CACHE    = `makani-cdn-${CACHE_VER}`;

/* الملفات المُخزَّنة مُسبقاً عند التثبيت */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/media-handler.js',
  '/manifest.json',
  '/offline.html',
  '/icons/icon.svg',
  '/icons/maskable.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/market/',
  '/market/index.html',
  '/market/app.js',
];

/* ── Install ─────────────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())   // يصبح نشطاً فوراً
  );
});

/* ── Activate (تنظيف الكاشات القديمة) ───────────────────────── */
self.addEventListener('activate', event => {
  const ACTIVE = new Set([SHELL_CACHE, FONT_CACHE, CDN_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => !ACTIVE.has(k)).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())  // يتحكم في الصفحات المفتوحة
  );
});

/* ── Fetch (منطق الاستجابة) ─────────────────────────────────── */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;   // POST/PUT/DELETE → تجاوز

  const url = new URL(request.url);

  /* 1. Supabase API + R2 images → Network-Only (بيانات حية دائماً) */
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

  /* 3. CDN (Supabase JS، jsDelivr) → Stale-While-Revalidate */
  if (url.hostname.endsWith('cdn.jsdelivr.net') ||
      url.hostname.endsWith('unpkg.com')) {
    event.respondWith(staleWhileRevalidate(request, CDN_CACHE));
    return;
  }

  /* 4. صفحات HTML → Network-First + Cache Fallback */
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstHtml(request));
    return;
  }

  /* 5. باقي الأصول (CSS، JS، صور، أيقونات) → Cache-First */
  event.respondWith(cacheFirst(request));
});

/* ── استراتيجيات الاستجابة ───────────────────────────────────── */

/** Cache-First: يُرجع من الكاش، يحدّثه في الخلفية إن لزم */
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

/** Network-First للـ HTML: يحاول الشبكة أولاً، يرجع للكاش، ثم offline */
async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    const cache    = await caches.open(SHELL_CACHE);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    /* إن لم تكن الصفحة مُخزَّنة → صفحة Offline */
    return caches.match('/offline.html');
  }
}

/** Stale-While-Revalidate: يُرجع الكاش فوراً ويحدّثه في الخلفية */
async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => null);

  return cached ?? networkPromise;
}

/* ── رسالة من الصفحة (تحديث يدوي) ─────────────────────────── */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
