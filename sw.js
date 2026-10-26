/* ==========================================================
   sw.js — ให้หน้าเว็บเปิดได้ตอนไม่มีเน็ต (V20)
   ลงทะเบียนจาก assets/js/offline.js

   - ไฟล์เว็บ (html/css/js) + สคริปต์ CDN: "เน็ตก่อน" ได้ไฟล์ใหม่เสมอ (เลข ?v= ยังใช้ได้)
     ไม่มีเน็ตค่อยใช้ชุดที่เคยโหลดไว้
   - รูปย่อสินค้าใน Supabase Storage: "แคชก่อน" (รูปไม่เปลี่ยน ชื่อไฟล์สุ่มทุกครั้ง) เก็บไม่เกิน 800 รูป
   - เรียก API ของ Supabase (ข้อมูล/RPC/realtime) ไม่ยุ่งเลย — offline.js จัดการคิวบิลเอง
   ========================================================== */
const PAGE_CACHE = "vims-pages-v1";
const IMG_CACHE = "vims-thumbs-v1";
const IMG_MAX = 800;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [PAGE_CACHE, IMG_CACHE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.pathname.includes("/storage/v1/object/public/item-images/") && url.pathname.includes("thumb_")) {
    event.respondWith(cacheFirstImage(req));
    return;
  }
  const isOwn = url.origin === self.location.origin;
  const isCdn = url.hostname === "cdn.jsdelivr.net" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (isOwn || isCdn) event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok || res.type === "opaque") cache.put(req, res.clone());
    return res;
  } catch (err) {
    // ไม่มีเน็ต: หาไฟล์เดิม (ไม่สน ?v=) — เปิดหน้าตรงๆ ไม่เจอให้ใช้หน้าขาย
    const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    if (req.mode === "navigate") return (await cache.match("sell.html", { ignoreSearch: true })) || Response.error();
    throw err;
  }
}

async function cacheFirstImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  // ขอแบบ cors (Storage สาธารณะรองรับ) — ถ้าเก็บแบบ opaque เบราว์เซอร์นับพื้นที่เกินจริงหลาย MB ต่อรูป
  const res = await fetch(req.url, { mode: "cors", credentials: "omit" }).catch(() => fetch(req));
  if (res.ok) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const k of keys.slice(0, Math.max(0, keys.length - IMG_MAX))) await cache.delete(k); // ลบรูปเก่าสุดเกินโควตา
  }
  return res;
}
