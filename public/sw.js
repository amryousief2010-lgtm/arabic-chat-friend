// 🔄 Service Worker — cache versioning + stale-while-revalidate (no HTML)
// إصدار الكاش يتم استبداله تلقائياً عند البناء (بصمة timestamp)
const CACHE_VERSION = "v__BUILD_HASH__";
const STATIC_CACHE = `static-${CACHE_VERSION}`;

// أنواع الموارد التي نخزّنها (لا HTML أبداً)
const STATIC_DESTINATIONS = new Set(["script", "style", "image", "font"]);

self.addEventListener("install", (event) => {
  // تفعيل مباشر بدون انتظار
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // مسح كل الكاشات القديمة التي لا تطابق الإصدار الحالي
      const keys = await caches.keys();
      const deleted = [];
      await Promise.all(
        keys.map((k) => {
          if (k !== STATIC_CACHE) {
            deleted.push(k);
            return caches.delete(k);
          }
          return Promise.resolve();
        }),
      );
      await self.clients.claim();

      // إخطار كل النوافذ بتفعيل SW جديد
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      clients.forEach((c) =>
        c.postMessage({
          type: "SW_ACTIVATED",
          version: CACHE_VERSION,
          clearedCaches: deleted,
          at: new Date().toISOString(),
        }),
      );
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // نفس الأصل فقط
  if (url.origin !== self.location.origin) return;

  // ❌ لا تتدخل أبداً في طلبات HTML/التنقل أو ملف الإصدار
  if (req.mode === "navigate" || req.destination === "document") return;
  if (url.pathname === "/version.json") return;
  if (url.pathname.startsWith("/~oauth")) return;

  // ✅ stale-while-revalidate للأصول الثابتة فقط
  if (!STATIC_DESTINATIONS.has(req.destination)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);
      return cached || (await networkFetch) || new Response("", { status: 504 });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
