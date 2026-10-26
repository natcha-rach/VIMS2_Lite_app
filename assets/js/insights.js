/* ==========================================================
   insights.js — "อะไรขายดี" (หน้ารายงาน) V20
   ใช้ตัดสินใจว่าซื้อกระสอบ/คัดของแบบไหนต่อ:
     - แยกตาม ไซซ์ / สภาพ / ประเภท / Tier / ช่วงราคา
       → ขายไปกี่ชิ้น, ขายเฉลี่ย, กำไรเฉลี่ย, ใช้กี่วันกว่าจะขาย (มัธยฐาน), ค้างอยู่, % ขายออก
     - Lot คืนทุนกี่วัน (วันที่ยอดขายสะสม ≥ ทุนทั้ง Lot)
   ชั้น UI · เรียกต่อ: Data ReportsRepo (โหลดแถว) → Domain InsightsCalc (จัดกลุ่ม/มัธยฐาน/คืนทุน) → วาดตาราง
   ช่วงเวลาของส่วนนี้แยกจากตัวเลือกด้านบนของหน้า (ต้องการข้อมูลยาวพอให้เห็นแนวโน้ม)
   ========================================================== */
(function () {
  const root = document.getElementById("insights");
  if (!root || !window.ReportsRepo || !window.InsightsCalc) return;
  const n = (v) => Number(v || 0);
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const DAY = 86400000;
  const DIMS = InsightsCalc.DIMS; // มิติจัดกลุ่ม (Domain)
  let range = "180";
  let dim = "size";
  let cache = null;

  async function load() {
    root.querySelector(".ins-body").innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;
    const since = range === "all" ? null : new Date(Date.now() - Number(range) * DAY).toISOString();
    const [salesR, stockR, lotsR, lotSalesR] = await Promise.all([
      ReportsRepo.salesForInsights(since), ReportsRepo.stockForInsights(), ReportsRepo.lotsBasic(), ReportsRepo.salesByLot(),
    ]);
    const err = salesR.error || stockR.error || lotsR.error || lotSalesR.error;
    if (err) {
      root.querySelector(".ins-body").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>`;
      Notify.error("โหลด 'อะไรขายดี' ไม่สำเร็จ", err, { actions: [{ label: "ลองใหม่", onClick: load }] });
      return;
    }
    cache = { sales: (salesR.data || []).filter((s) => s.items), stock: stockR.data || [], lots: lotsR.data || [], lotSales: lotSalesR.data || [] };
    render();
  }

  function render() {
    const rows = InsightsCalc.groupBy(dim, cache.sales, cache.stock);
    const { best, slow } = InsightsCalc.tips(rows);
    const tips = [
      best ? `ขายออกเร็วสุด: <b>${esc(best.key)}</b> (ครึ่งหนึ่งขายได้ภายใน ${Math.round(best.med)} วัน)` : "",
      slow ? `ค้างเยอะ: <b>${esc(slow.key)}</b> ขายออกแค่ ${slow.through.toFixed(0)}% · ค้าง ${slow.stock} ชิ้น${slow.stale ? ` (60+ วัน ${slow.stale})` : ""}` : "",
    ].filter(Boolean);

    const table = rows.length ? `<div class="table-scroll"><table class="ins-table">
      <thead><tr><th>${DIMS[dim].label}</th><th class="num">ขายแล้ว</th><th class="num">ขายเฉลี่ย</th><th class="num">กำไรเฉลี่ย</th><th class="num">กี่วันขายออก</th><th class="num">ค้างอยู่</th><th class="num">% ขายออก</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><b>${esc(r.key)}</b></td>
        <td class="num">${r.sold}</td>
        <td class="num">${r.sold ? formatBaht(r.revenue / r.sold) : "-"}</td>
        <td class="num ${r.profit >= 0 ? "profit" : "loss"}">${r.sold ? formatBaht(r.profit / r.sold) : "-"}</td>
        <td class="num">${r.med === null ? "-" : Math.round(r.med) + " วัน"}</td>
        <td class="num">${r.stock}${r.stale ? ` <small class="loss">(${r.stale} ค้าง 60+)</small>` : ""}</td>
        <td class="num"><span class="ins-bar"><i style="width:${r.through.toFixed(0)}%"></i></span>${r.through.toFixed(0)}%</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">ยังไม่มีข้อมูลการขายในช่วงนี้</div>`;

    const lots = InsightsCalc.lotPayback(cache.lots, cache.lotSales);
    const lotTable = lots.length ? `<div class="table-scroll"><table class="ins-table">
      <thead><tr><th>Lot</th><th class="num">ทุน</th><th class="num">ขายสะสม</th><th class="num">คืนทุน</th><th class="num">ใช้เวลา</th></tr></thead>
      <tbody>${lots.map((x) => `<tr>
        <td><b>${esc(x.lot.lot_name)}</b><small class="table-sub">ซื้อ ${new Date(x.lot.purchase_date).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" })}</small></td>
        <td class="num">${formatBaht(x.lot.total_cost)}</td>
        <td class="num">${formatBaht(x.sum)}</td>
        <td class="num ${x.paid ? "profit" : ""}">${x.paid ? "คืนทุนแล้ว" : x.pct.toFixed(0) + "%"}</td>
        <td class="num">${x.paid ? `${x.days} วัน` : `ผ่านมา ${x.days} วัน`}</td>
      </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state">ยังไม่มี Lot ที่ตั้งทุนและมียอดขาย</div>`;

    root.querySelector(".ins-body").innerHTML = `
      ${tips.length ? `<div class="ins-tips">${tips.map((t) => `<div>💡 ${t}</div>`).join("")}</div>` : ""}
      ${table}
      <h3 class="ins-sub">Lot คืนทุนกี่วัน <small>(นับตั้งแต่วันซื้อ จนยอดขายสะสมเท่าทุนทั้ง Lot · ทุกช่วงเวลา)</small></h3>
      ${lotTable}`;
  }

  root.innerHTML = `
    <div class="ins-toolbar">
      <div class="seg ins-dims" role="tablist">${Object.entries(DIMS).map(([k, v]) => `<button type="button" data-dim="${k}" class="${k === dim ? "active" : ""}">${v.label}</button>`).join("")}</div>
      <select class="ins-range" aria-label="ช่วงเวลา"><option value="90">90 วัน</option><option value="180" selected>180 วัน</option><option value="365">1 ปี</option><option value="all">ทั้งหมด</option></select>
    </div>
    <div class="ins-body"></div>`;
  root.querySelector(".ins-dims").addEventListener("click", (e) => {
    const b = e.target.closest("[data-dim]");
    if (!b || !cache) return;
    dim = b.dataset.dim;
    root.querySelectorAll("[data-dim]").forEach((x) => x.classList.toggle("active", x === b));
    render();
  });
  root.querySelector(".ins-range").addEventListener("change", (e) => { range = e.target.value; load(); });
  const reload = debounce(load, 1500);
  window.addEventListener("vims:realtime", (e) => {
    const t = e.detail?.table;
    if (t === "page_refresh" || t === "sales" || t === "items") reload();
  });
  load();
})();
