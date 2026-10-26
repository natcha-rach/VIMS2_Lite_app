// ==========================================================
// nav.js — ควบคุมเมนู sidebar
// จอแคบ (<860px): เมนูอยู่เป็นแถบด้านล่างจอเสมอ (bottom nav bar)
// จอกว้าง (>=860px): เมนูอยู่ถาวรข้างซ้ายเสมอ กดย่อเหลือไอคอนได้
// โหลดในทุกหน้า ทำงานทันทีตอนโหลดสคริปต์ (ไม่ต้องรอ DOMContentLoaded
// เพราะ script อยู่ท้าย body องค์ประกอบ DOM พร้อมแล้ว)
// ==========================================================
(function () {
  const sidebar = document.getElementById("sidebar");
  const collapseBtn = document.getElementById("navCollapse");

  if (!sidebar) return; // กันพลาดกรณีหน้าไหนไม่มี sidebar

  function applyCollapsedState(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
  }

  // โหลดสถานะย่อเมนู (มีผลเฉพาะจอกว้าง)
  const savedCollapsed = localStorage.getItem("shirtShopSidebarCollapsed") === "true";
  applyCollapsedState(savedCollapsed);

  collapseBtn?.addEventListener("click", () => {
    const collapsed = !document.body.classList.contains("sidebar-collapsed");
    localStorage.setItem("shirtShopSidebarCollapsed", collapsed);
    applyCollapsedState(collapsed);
  });

  // ไฮไลต์เมนูของหน้าปัจจุบัน
  const currentPage = location.pathname.split("/").pop() || "index.html";
  // V19.5: เมนู "สต็อก" (ลิงก์ items.html) รวม Lot + สินค้า → หน้า lots.html ก็ไฮไลต์ที่ "สต็อก"
  const activeHref = currentPage === "lots.html" ? "items.html" : currentPage;
  document.querySelectorAll(".sidebar-links a").forEach((a) => {
    if (a.getAttribute("href") === activeHref) a.classList.add("active");
  });

  // แท็บย่อย "สินค้า" ในหน้า Lot/สินค้า: พา Lot/กลุ่มที่เลือกล่าสุดไปด้วย (อ่านจาก vimsContext.js)
  const itemsTab = document.querySelector('.stock-tabs a[href="items.html"]');
  if (itemsTab && window.VimsContext) {
    const { lotId, groupId } = VimsContext.resolve();
    if (lotId || groupId) itemsTab.href = VimsContext.itemsUrl({ lotId, groupId });
  }

  // ==========================================================
  // Stock aging badge — จุดแดงที่ไอคอน "สินค้า" เมื่อมีของพร้อมขาย
  // ที่ค้างในระบบ 60 วันขึ้นไป แสดงบนทุกหน้าเพราะ sidebar ใช้ร่วมกัน
  // ==========================================================
  const STOCK_AGING_DAYS = 60;
  async function updateStockAgingBadge() {
    const badge = document.getElementById("navStockBadge");
    if (!badge || typeof supabaseClient === "undefined") return;
    try {
      const cutoff = new Date(Date.now() - STOCK_AGING_DAYS * 86400000).toISOString();
      const { count, error } = await supabaseClient
        .from("items")
        .select("id", { count: "exact", head: true })
        .eq("status", "available")
        .lte("created_at", cutoff);
      if (error) throw error;
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    } catch (err) {
      console.error("อัปเดต badge สินค้าค้างไม่สำเร็จ", err);
    }
  }
  updateStockAgingBadge();
  // Realtime: ถ้ามีสินค้า/สถานะเปลี่ยนจากอุปกรณ์อื่น ให้คำนวณ badge ใหม่
  const updateStockAgingBadgeDebounced = debounce(updateStockAgingBadge, 700);
  window.addEventListener("vims:realtime", (event) => {
    const table = event.detail?.table;
    if (table === "page_refresh" || table === "items") updateStockAgingBadgeDebounced();
  });
})();
