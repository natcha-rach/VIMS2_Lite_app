/* ==========================================================
   domain/insightsCalc.js — ชั้น Domain: "อะไรขายดี" + Lot คืนทุนกี่วัน (ไม่แตะ DOM / Supabase)
   ใครเรียก: insights.js (การ์ดในหน้ารายงาน)
   รับแถวดิบจาก ReportsRepo · คืนค่าเป็นบาท/วัน
   เทสต์: tests/insights.test.js
   ========================================================== */
(function (root) {
  const DAY = 86400000;
  const n = (v) => Number(v || 0);
  const PRICE_BANDS = [[0, 100, "ต่ำกว่า 100"], [100, 200, "100–199"], [200, 300, "200–299"], [300, 500, "300–499"], [500, Infinity, "500 ขึ้นไป"]];
  // มิติที่จัดกลุ่มได้ · key(สินค้า, ราคา) → ชื่อกลุ่ม · order = ลำดับคงที่ (ช่วงราคา)
  const DIMS = {
    size: { label: "ไซซ์", key: (i) => (i.size || "").trim().toUpperCase() || "ไม่ระบุ" },
    condition: { label: "สภาพ", key: (i) => (i.condition ? `เกรด ${i.condition}` : "ไม่ระบุ") },
    item_type: { label: "ประเภท", key: (i) => (i.item_type || "").trim() || "ไม่ระบุ" },
    tier: { label: "Tier", key: (i) => (i.tier === "head" ? "งานหัว" : "ปกติ") },
    price: { label: "ช่วงราคา", key: (i, price) => PRICE_BANDS.find(([a, b]) => price >= a && price < b)?.[2] || "-", order: PRICE_BANDS.map((x) => x[2]) },
  };

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  const listedAt = (i) => new Date(i.listed_at || i.created_at);

  // sales = แถวขาย (มี items), stock = ของพร้อมขาย → แถวต่อกลุ่ม: ขายแล้ว, รายได้, กำไร, med = กี่วันขายออก (มัธยฐาน), ค้าง, ค้าง 60+, % ขายออก
  function groupBy(dim, sales, stock, now = Date.now()) {
    const g = {};
    const row = (k) => (g[k] ||= { key: k, sold: 0, revenue: 0, profit: 0, days: [], stock: 0, stale: 0 });
    sales.forEach((s) => {
      const r = row(DIMS[dim].key(s.items, n(s.list_price ?? s.sale_price)));
      r.sold++; r.revenue += n(s.sale_price); r.profit += n(s.sale_price) - n(s.cost_price);
      const days = (new Date(s.sale_date) - listedAt(s.items)) / DAY;
      if (days >= 0) r.days.push(days);
    });
    stock.forEach((i) => {
      const r = row(DIMS[dim].key(i, n(i.current_price)));
      r.stock++;
      if ((now - listedAt(i)) / DAY >= 60) r.stale++;
    });
    const rows = Object.values(g).map((r) => ({ ...r, med: median(r.days), through: r.sold + r.stock ? (r.sold / (r.sold + r.stock)) * 100 : 0 }));
    const order = DIMS[dim].order;
    return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.sold - a.sold);
  }

  // คำแนะนำสั้นๆ: กลุ่มที่ขายออกเร็วสุด (ขายแล้ว ≥ 3) และกลุ่มที่ค้างเยอะสุด (ค้าง ≥ 5)
  function tips(rows) {
    const best = rows.filter((r) => r.sold >= 3 && r.med !== null).sort((a, b) => a.med - b.med)[0] || null;
    const slow = rows.filter((r) => r.stock >= 5).sort((a, b) => a.through - b.through)[0] || null;
    return { best, slow: slow && slow !== best ? slow : null };
  }

  // Lot คืนทุน: เรียงยอดขายตามวัน หาวันแรกที่ยอดสะสม ≥ ทุนทั้ง Lot
  function lotPayback(lots, lotSales, now = new Date()) {
    const byLot = {};
    lotSales.forEach((s) => { const id = s.items?.lot_id; if (id) (byLot[id] ||= []).push(s); });
    return lots.filter((l) => n(l.total_cost) > 0 && byLot[l.id]?.length).map((l) => {
      const sales = byLot[l.id].sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));
      let sum = 0, paidAt = null;
      for (const s of sales) { sum += n(s.sale_price); if (!paidAt && sum >= n(l.total_cost)) paidAt = new Date(s.sale_date); }
      const days = Math.max(0, Math.round(((paidAt || now) - new Date(l.purchase_date)) / DAY));
      return { lot: l, sum, pct: (sum / n(l.total_cost)) * 100, paid: !!paidAt, days };
    }).sort((a, b) => (b.paid - a.paid) || (a.days - b.days));
  }

  const api = { DIMS, median, groupBy, tips, lotPayback };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.InsightsCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
