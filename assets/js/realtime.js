/* ==========================================================
   realtime.js — ชั้นกลางสำหรับ Sync ทุกอุปกรณ์
   Flow: Supabase Realtime → vims:realtime → หน้า UI ที่เปิดอยู่

   IMPORTANT:
   - ใช้ channel เดียวต่อ browser tab เพื่อลดการ subscribe ซ้ำ
   - ทุกหน้ารับ event ผ่าน CustomEvent ชื่อ vims:realtime
   - มี refresh สำรองเมื่อกลับมาที่หน้า / tab / online
   - ไม่มี Permission แยก device; ทุกอุปกรณ์ใช้ DB เดียวกัน
   ========================================================== */

(function () {
  const TABLES = ['lots', 'lot_groups', 'items', 'item_images', 'sales', 'expenses', 'capital_entries', 'bills', 'shifts', 'reservations']; // V19: + บิล กะ การจอง
  let channel = null;
  let subscribed = false;
  let reloadTimer = null;

  function ensureSyncIndicator() {
    if (document.getElementById('syncIndicator')) return;
    const el = document.createElement('div');
    el.id = 'syncIndicator';
    el.className = 'sync-indicator sync-connecting';
    el.innerHTML = '<span class="sync-dot"></span><span class="sync-text">กำลังเชื่อมต่อ…</span>';
    document.body.appendChild(el);
  }

  function setSyncStatus(state, text) {
    ensureSyncIndicator();
    const el = document.getElementById('syncIndicator');
    if (!el) return;
    el.className = `sync-indicator sync-${state}`;
    const textEl = el.querySelector('.sync-text');
    if (textEl) textEl.textContent = text;
  }

  function emitChange(table, payload = null, source = 'realtime') {
    window.dispatchEvent(new CustomEvent('vims:realtime', {
      detail: { table, payload, source, at: Date.now() }
    }));
  }

  // Realtime event จาก Supabase จะเรียก listener ของหน้าปัจจุบัน เช่น sell.js / reports.js / accounting.js
  //
  // V19.2 แก้บั๊ก "cannot add postgres_changes callbacks ... after subscribe()"
  // สาเหตุ: ตอนเปิดหน้า subscribeRealtime() ถูกเรียก 2 ครั้งติดกัน (จาก updateNetworkState + init)
  //        ก่อน subscribe เสร็จ และตอนเชื่อมต่อหลุด (CLOSED) ไม่ได้ removeChannel ทิ้ง
  //        supabase-js จึงคืน channel ชื่อเดิมที่ subscribe ไปแล้ว → .on() ซ้ำแล้ว error
  // วิธีแก้: (1) มี channel อยู่แล้ว/กำลังเชื่อม = ไม่สร้างใหม่  (2) ลบ channel เก่าทิ้งทุกครั้งก่อนต่อใหม่
  //         (3) ตั้งชื่อ channel ไม่ซ้ำทุกครั้ง  (4) ห่อ try/catch ไม่ให้หน้าพังเพราะ Realtime
  let retryTimer = null;
  let attempt = 0;

  async function dropChannel() {
    const old = channel;
    channel = null;
    subscribed = false;
    if (old && window.supabaseClient) {
      try { await window.supabaseClient.removeChannel(old); } catch (_) { /* ปิดไม่ได้ก็ช่างมัน */ }
    }
  }

  function scheduleRetry(ms) {
    clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => {
      if (!subscribed && navigator.onLine !== false) subscribeRealtime();
    }, ms);
  }

  function subscribeRealtime() {
    if (subscribed || channel || !window.supabaseClient) return; // กำลังเชื่อม/เชื่อมอยู่แล้ว
    attempt += 1;
    try {
      const ch = window.supabaseClient.channel(`vims2-lite-realtime-${Date.now()}-${attempt}`);
      channel = ch;
      TABLES.forEach((table) => {
        ch.on(
          'postgres_changes',
          { event: '*', schema: 'public', table },
          (payload) => {
            setSyncStatus('syncing', 'กำลัง Sync…');
            emitChange(table, payload, 'realtime');
            window.setTimeout(() => setSyncStatus('online', 'Realtime พร้อม'), 500);
          }
        );
      });

      ch.subscribe((status) => {
        if (ch !== channel) return; // event ของ channel เก่าที่ถูกทิ้งไปแล้ว
        if (status === 'SUBSCRIBED') {
          subscribed = true;
          attempt = 0;
          setSyncStatus('online', 'Realtime พร้อม');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setSyncStatus('offline', status === 'CLOSED' ? 'Realtime ถูกตัด · กำลังเชื่อมใหม่' : 'Realtime ขัดข้อง · กำลังลองใหม่');
          dropChannel().then(() => scheduleRetry(Math.min(30000, 1500 * attempt)));
        }
      });
    } catch (err) {
      // Realtime เป็นตัวช่วยเท่านั้น — ล้มเหลวก็ยังใช้แอปได้ (มี refresh สำรองตอนกลับมาที่หน้า)
      console.warn('Realtime เชื่อมต่อไม่สำเร็จ', err);
      setSyncStatus('offline', 'Realtime ขัดข้อง · กำลังลองใหม่');
      dropChannel().then(() => scheduleRetry(Math.min(30000, 3000 * attempt)));
    }
  }

  // Refresh สำรองเมื่อผู้ใช้กลับมาที่ tab/page เพื่อป้องกันกรณี browser หยุด WebSocket ตอนอยู่เบื้องหลัง
  function requestPageRefresh(source) {
    clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(() => {
      emitChange('page_refresh', null, source);
      setSyncStatus('syncing', 'กำลังตรวจข้อมูลล่าสุด…');
      window.setTimeout(() => setSyncStatus('online', 'ตรวจข้อมูลล่าสุดแล้ว'), 400);
    }, 150);
  }

  function updateNetworkState() {
    if (navigator.onLine) {
      setSyncStatus('online', subscribed ? 'ออนไลน์ · Realtime พร้อม' : 'ออนไลน์ · กำลังเชื่อม…');
      subscribeRealtime();
      requestPageRefresh('network_online');
    } else {
      setSyncStatus('offline', 'ออฟไลน์ · ยังไม่ Sync');
    }
  }

  function initRealtimeSync() {
    ensureSyncIndicator();
    updateNetworkState();

    window.addEventListener('online', updateNetworkState);
    window.addEventListener('offline', updateNetworkState);

    // เมื่อสลับกลับมาหน้านี้ ให้หน้าต่าง ๆ โหลดข้อมูลล่าสุดอีกครั้ง
    window.addEventListener('focus', () => requestPageRefresh('window_focus'));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') requestPageRefresh('visibility');
    });
    window.addEventListener('pageshow', () => requestPageRefresh('pageshow'));
    // กลับมาจากพื้นหลังบนมือถือ: ถ้าหลุดไปแล้วให้ต่อใหม่
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !subscribed && !channel) subscribeRealtime();
    });
  }

  window.VIMSRealtime = { initRealtimeSync, setSyncStatus, emitChange };
  initRealtimeSync();
})();
