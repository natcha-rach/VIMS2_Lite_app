/* ==========================================================
   offline.js — ขายต่อได้ตอนเน็ตหลุด (V20)
   ที่ถนนคนเดินสัญญาณมือถือแย่ → ถ้าส่ง sell_bill ไม่ได้เพราะเน็ต
   บิลจะถูกเก็บในเครื่อง (IndexedDB) แล้วส่งให้เองเมื่อเน็ตกลับมา

   เชื่อมต่อ:
     ส่งบิล    → SalesRepo.sellBill (data/salesRepo.js) — ต้องโหลด salesRepo.js ก่อนไฟล์นี้
     sell.js   → OfflineSales.enqueue() ตอนส่งบิลไม่ได้, saveSnapshot/loadSnapshot ของกริดสินค้า
     shift.js  → OfflineSales.count() กันปิดร้านทั้งที่ยังมีบิลค้างส่ง
     RPC sell_bill(p_bill_id, …, p_sold_at)  ← UUID เดิม + เวลาขายจริง → ส่งซ้ำกี่ครั้งก็ไม่เกิดบิลซ้ำ
                                               (p_sold_at ต้องรัน sql/migration_v21_*.sql)
   ทำไม IndexedDB ไม่ใช่ localStorage: ข้อมูลกริด/คิวใหญ่ได้ และไม่บล็อกหน้าเว็บ
   ========================================================== */
(function () {
  const DB_NAME = "vims_offline";
  const STORE = "kv";
  const QUEUE_KEY = "sell_queue";
  let dbPromise = null;

  // ---------- IndexedDB แบบ key/value เล็กๆ (ใช้ไม่ได้ในโหมดส่วนตัวบางเครื่อง → คืน null เงียบๆ) ----------
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
    return dbPromise;
  }
  async function kvGet(key) {
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }
  async function kvSet(key, value) {
    const db = await openDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (_) { resolve(false); }
    });
  }

  // error แบบไหนถือว่า "เน็ตหลุด" (ส่งใหม่ได้) — ต่างจาก error ธุรกิจ เช่น "ขายไปแล้ว" ที่ส่งใหม่ก็ไม่ผ่าน
  function isNetworkError(err) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    const msg = `${err?.message || ""} ${err?.details || ""}`;
    return /Failed to fetch|NetworkError|Load failed|network|timeout|ERR_INTERNET|ECONN/i.test(msg);
  }

  // ---------- คิวบิล ----------
  // entry: { bill_id, params (ส่ง sell_bill ได้เลย), snapshot (ไว้แสดง/ใบเสร็จ), item_ids, sold_at, tries, last_error, failed }
  async function list() { return (await kvGet(QUEUE_KEY)) || []; }
  async function save(q) { const ok = await kvSet(QUEUE_KEY, q); emit(q); return ok; }
  async function count() { return (await list()).length; }

  async function enqueue(entry) {
    const q = await list();
    if (!q.some((x) => x.bill_id === entry.bill_id)) q.push({ tries: 0, failed: false, last_error: null, ...entry });
    return save(q);
  }

  // แจ้งหน้าเว็บทุกครั้งที่คิวเปลี่ยน (sell.js วาดป้าย "รอส่ง N บิล")
  function emit(q) { window.dispatchEvent(new CustomEvent("vims:offline-queue", { detail: { queue: q } })); }

  // ส่งบิลที่ค้างทีละบิลตามลำดับเวลา — เรียกตอนโหลดหน้า, เน็ตกลับมา, ทุก 30 วิ
  let flushing = false;
  async function flush() {
    if (flushing || !window.SalesRepo) return { sent: 0 };
    if (navigator.onLine === false) return { sent: 0 };
    flushing = true;
    let sent = 0;
    try {
      const q = await list();
      for (const entry of q.filter((x) => !x.failed)) {
        const { data, error } = await SalesRepo.sellBill(entry.params); // ชั้น Data (data/salesRepo.js)
        if (error && isNetworkError(error)) break; // ยังไม่มีเน็ต → รอรอบหน้า
        const cur = await list();
        const idx = cur.findIndex((x) => x.bill_id === entry.bill_id);
        if (idx < 0) continue;
        if (error) {
          // error ธุรกิจ (เช่น ชิ้นนี้ถูกขาย/แก้จากอีกเครื่อง) → หยุดส่งบิลนี้ ให้เจ้าของตัดสินใจเอง
          cur[idx] = { ...cur[idx], tries: cur[idx].tries + 1, failed: true, last_error: Notify.friendlyError(error).detail };
          await save(cur);
          Notify.error("ส่งบิลที่ขายตอนเน็ตหลุดไม่สำเร็จ", `${describe(entry)} — ${cur[idx].last_error}`, {
            hint: "เงินที่รับมาแล้วยังไม่ถูกนับเข้าระบบ — เปิดหน้าขาย ดูป้าย 'รอส่ง' เพื่อลองใหม่หรือทิ้งบิลนี้",
            duration: 0,
          });
          continue;
        }
        cur.splice(idx, 1);
        await save(cur);
        sent++;
        Notify.success(`ส่งบิล #${data.bill_no} ที่ขายตอนเน็ตหลุดแล้ว`, `${describe(entry)} · นับเข้ายอดขายแล้ว`);
      }
    } finally {
      flushing = false;
    }
    if (sent) window.dispatchEvent(new CustomEvent("vims:offline-flushed", { detail: { sent } }));
    return { sent };
  }

  async function retry(billId) {
    const q = await list();
    const e = q.find((x) => x.bill_id === billId);
    if (e) { e.failed = false; await save(q); }
    return flush();
  }
  async function discard(billId) {
    const q = (await list()).filter((x) => x.bill_id !== billId);
    return save(q);
  }

  function describe(entry) {
    const n = entry.snapshot?.lines?.length || entry.item_ids?.length || 0;
    const total = entry.snapshot?.total != null ? Money.toBaht(entry.snapshot.total).toLocaleString("th-TH") : "?";
    const at = entry.sold_at ? new Date(entry.sold_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "";
    return `${n} ชิ้น ฿${total}${at ? " (ขายเมื่อ " + at + ")" : ""}`;
  }

  // ---------- snapshot กริดหน้าขาย (เปิดหน้าขายตอนไม่มีเน็ตยังเห็นของ) ----------
  const saveSnapshot = (data) => kvSet("sell_snapshot", { ...data, saved_at: new Date().toISOString() });
  const loadSnapshot = () => kvGet("sell_snapshot");

  window.OfflineSales = { isNetworkError, enqueue, list, count, flush, retry, discard, describe, saveSnapshot, loadSnapshot };

  // sw.js: เปิดหน้าขายได้แม้ไม่มีเน็ต (ใช้ได้เฉพาะ https / localhost)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch((err) => console.warn("ลงทะเบียน sw.js ไม่สำเร็จ", err));
  }

  // ข้อความ "เน็ตหลุด/กลับมาแล้ว" อยู่ใน notify.js — ตรงนี้แค่สั่งส่งคิว
  window.addEventListener("online", flush);
  setInterval(flush, 30000);
  flush();
})();
