/* ==========================================================
   domain/lotCalc.js — ชั้น Domain: ต้นทุน Lot (ไม่แตะ DOM / Supabase)
   ใครเรียก: lots.js (preview ต้นทุนรวม/ต้นทุนเฉลี่ยในฟอร์ม, นับชิ้นต่อกลุ่ม)
   สอดคล้องกับ trigger compute_lot_total_cost() ใน Postgres — browser คิดก่อนเพื่อ preview ทันที
   เทสต์: tests/lot.test.js
   ========================================================== */
(function (root) {
  // ผลรวมต้นทุนแยกส่วน (บาท) — คิดเป็นสตางค์กันทศนิยมเพี้ยน
  function totalCost(parts) {
    const satang = parts.reduce((s, v) => s + Math.round(Number(v || 0) * 100), 0);
    return satang / 100;
  }
  // ต้นทุนเฉลี่ยต่อชิ้น หรือ null ถ้ายังไม่ใส่จำนวน
  const avgCost = (total, count) => (Number(count) > 0 ? Number(total || 0) / Number(count) : null);
  // { group_id: จำนวนชิ้น } จากแถว items ของ Lot
  function countByGroup(items) {
    const out = {};
    items.forEach((i) => { if (i.group_id) out[i.group_id] = (out[i.group_id] || 0) + 1; });
    return out;
  }

  const api = { totalCost, avgCost, countByGroup };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LotCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
