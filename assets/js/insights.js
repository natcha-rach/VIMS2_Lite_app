/* ==========================================================
   insights.js — "อะไรขายดี" (หน้ารายงาน) V20
   ใช้ตัดสินใจว่าซื้อกระสอบ/คัดของแบบไหนต่อ:
     - แยกตาม ไซซ์ / สภาพ / ประเภท / Tier / ช่วงราคา
       → ขายไปกี่ชิ้น, ขายเฉลี่ย, กำไรเฉลี่ย, ใช้กี่วันกว่าจะขาย (มัธยฐาน), ค้างอยู่, % ขายออก
     - Lot คืนทุนกี่วัน (วันที่ยอดขายสะสม ≥ ทุนทั้ง Lot)
   ข้อมูล: sales (ไม่นับที่ยกเลิก) + items + lots — คำนวณใน browser ไม่ต้องรัน SQL เพิ่ม
   ช่วงเวลาของส่วนนี้แยกจากตัวเลือกด้านบนของหน้า (ต้องการข้อมูลยาวพอให้เห็นแนวโน้ม)
   ========================================================== */
(function () {
  const root = document.getElementById("insights");
  if (!root || !window.supabaseClient) return;
  const n = (v) => Number(v || 0);
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const DAY = 86400000;
  const PRICE_BANDS = [[0, 100, "ต่ำกว่า 100"], [100, 200, "100–199"], [200, 300, "200–299"], [300, 500, "300–499"], [500, Infinity, "500 ขึ้นไป"]];
  const DIMS = {
    size: { label: "ไซซ์", key: (i) => (i.size || "").trim().toUpperCase() || "ไม่ระบุ" },
    condition: { label: "สภาพ", key: (i) => (i.condition ? `เกรด ${i.condition}` : "ไม่ระบุ") },
    item_type: { label: "ประเภท", key: (i) => (i.item_type || "").trim() || "ไม่ระบุ" },
    tier: { label: "Tier", key: (i) => (i.tier === "head" ? "งานหัว" : "ปกติ") },
    price: { label: "ช่วงราคา", key: (i, price) => PRICE_BANDS.find(([a, b]) => price >= a && price < b)?.[2] || "-", order: PRICE_BANDS.map((x) => x[2]) },
  };
  let range = "180";
  let dim = "size";
  let cache = null;

  const median = (arr) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const listedAt = (i) => new Date(i.listed_at || i.created_at);

  async function load() {
    root.querySelector(".ins-body").innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;
    const since = range === "all" ? null : new Date(Date.now() - Number(range) * DAY).toISOString();
    const salesQ = () => {
      let q = supabaseClient.from("sales")
        .select("sale_date,sale_price,cost_price,list_price,item_id,items(size,condition,tier,item_type,created_at,listed_at,lot_id)")
        .is("voided_at", null);
      if (since) q = q.gte("sale_date", since);
      return q;
    };
    const [salesR, stockR, lotsR, lotSalesR] = await Promise.all([
      fetchAllRows(salesQ),
      fetchAllRows(() => supabaseClient.from("items").select("size,condition,tier,item_type,current_price,created_at,listed_at").eq("status", "available").eq("intake_status", "listed")),
      fetchAllRows(() => supabaseClient.from("lots").select("id,lot_name,purchase_date,total_cost")),
      // คืนทุน Lot ต้องใช้ยอดขายทั้งหมดตั้งแต่ซื้อ (ไม่ตัดตามช่วง)
      fetchAllRows(() => supabaseClient.from("sales").select("sale_date,sale_price,items(lot_id)").is("voided_at", null)),
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

  // จัดกลุ่มตามมิติที่เลือก
  function groupBy(d) {
    const g = {};
    const row = (k) => (g[k] ||= { key: k, sold: 0, revenue: 0, profit: 0, days: [], stock: 0, stale: 0 });
    cache.sales.forEach((s) => {
      const price = n(s.list_price ?? s.sale_price);
      const r = row(DIMS[d].key(s.items, price));
      r.sold++; r.revenue += n(s.sale_price); r.profit += n(s.sale_price) - n(s.cost_price);
      const days = (new Date(s.sale_date) - listedAt(s.items)) / DAY;
      if (days >= 0) r.days.push(days);
    });
    const now = Date.now();
    cache.stock.forEach((i) => {
      const r = row(DIMS[d].key(i, n(i.current_price)));
      r.stock++;
      if ((now - listedAt(i)) / DAY >= 60) r.stale++;
    });
    const rows = Object.values(g).map((r) => ({ ...r, med: median(r.days), through: r.sold + r.stock ? (r.sold / (r.sold + r.stock)) * 100 : 0 }));
    const order = DIMS[d].order;
    return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.sold - a.sold);
  }

  // Lot คืนทุน: เรียงยอดขายตามวัน แล้วหาวันแรกที่ยอดสะสม ≥ ทุนทั้ง Lot
  function lotPayback() {
    const byLot = {};
    cache.lotSales.forEach((s) => { const id = s.items?.lot_id; if (id) (byLot[id] ||= []).push(s); });
    return cache.lots.filter((l) => n(l.total_cost) > 0 && byLot[l.id]?.length).map((l) => {
      const sales = byLot[l.id].sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));
      const start = new Date(l.purchase_date);
      let sum = 0, paidAt = null;
      for (const s of sales) { sum += n(s.sale_price); if (!paidAt && sum >= n(l.total_cost)) paidAt = new Date(s.sale_date); }
      const days = Math.max(0, Math.round(((paidAt || new Date()) - start) / DAY));
      return { lot: l, sum, pct: (sum / n(l.total_cost)) * 100, paid: !!paidAt, days };
    }).sort((a, b) => (b.paid - a.paid) || (a.days - b.days));
  }

  function render() {
    const rows = groupBy(dim);
    const best = rows.filter((r) => r.sold >= 3 && r.med !== null).sort((a, b) => a.med - b.med)[0];
    const slow = rows.filter((r) => r.stock >= 5).sort((a, b) => a.through - b.through)[0];
    const tips = [
      best ? `ขายออกเร็วสุด: <b>${esc(best.key)}</b> (ครึ่งหนึ่งขายได้ภายใน ${Math.round(best.med)} วัน)` : "",
      slow && slow !== best ? `ค้างเยอะ: <b>${esc(slow.key)}</b> ขายออกแค่ ${slow.through.toFixed(0)}% · ค้าง ${slow.stock} ชิ้น${slow.stale ? ` (60+ วัน ${slow.stale})` : ""}` : "",
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

    const lots = lotPayback();
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
