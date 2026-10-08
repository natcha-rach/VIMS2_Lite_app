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
  const TABLES = ['lots', 'lot_groups', 'items', 'item_images', 'sales', 'expenses'];
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
  function subscribeRealtime() {
    if (subscribed || !window.supabaseClient) return;

    channel = window.supabaseClient.channel('vims2-lite-realtime');

    TABLES.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          setSyncStatus('syncing', 'กำลัง Sync…');
          emitChange(table, payload, 'realtime');
          window.setTimeout(() => setSyncStatus('online', 'Realtime พร้อม'), 500);
        }
      );
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        subscribed = true;
        setSyncStatus('online', 'Realtime พร้อม');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        subscribed = false;
        if (channel && window.supabaseClient) {
          window.supabaseClient.removeChannel(channel);
          channel = null;
        }
        setSyncStatus('offline', 'Realtime ขัดข้อง · กำลังลองใหม่');
        window.setTimeout(() => {
          if (!subscribed) subscribeRealtime();
        }, 3000);
      } else if (status === 'CLOSED') {
        subscribed = false;
        channel = null;
        setSyncStatus('offline', 'Realtime ถูกตัด · กำลังเชื่อมใหม่');
        window.setTimeout(() => {
          if (!subscribed) subscribeRealtime();
        }, 1500);
      }
    });
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

    subscribeRealtime();
  }

  window.VIMSRealtime = { initRealtimeSync, setSyncStatus, emitChange };
  initRealtimeSync();
})();
