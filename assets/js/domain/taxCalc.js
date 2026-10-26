/* ==========================================================
   domain/taxCalc.js — ชั้น Domain: ตัวเลขภาษี ภ.ง.ด.94/90 (สตางค์ · ไม่แตะ DOM / Supabase)
   ใครเรียก: tax.js
   เรียกต่อ: money.js (toSatang/toBaht)
   เงินได้ 40(8) = ยอดขายในแอป + รายได้นอกแอป · เทียบหักเหมา 60% vs หักตามจริง (ต้นทุนเสื้อ + ค่าใช้จ่าย + ต้นทุนนอกแอป)
   ⚠ เครื่องมือเตรียมตัวเลข ไม่ใช่คำแนะนำภาษี — อัตรา/เกณฑ์ตรวจกับกรมสรรพากรทุกปี
   เทสต์: tests/tax.test.js
   ========================================================== */
(function (root) {
  const Money = root.Money || (typeof require === "function" ? require("../money.js") : null);
  const S = (v) => Money.toSatang(v);
  const FLAT_RATE = 0.6;          // หักเหมา 60% (เงินได้จากการขายของ)
  const VAT_THRESHOLD = 1800000;  // รายรับเกินปีละ 1.8 ล้านบาท ต้องจด VAT
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  // เดือนตามเวลาไทย (UTC+7) ของเวลาขาย / เดือนของวันที่ YYYY-MM-DD
  const monthOfSale = (iso) => Number(new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(5, 7));
  const monthOfDate = (d) => Number(String(d).slice(5, 7));

  // ยอดรายเดือน (ครึ่งปี = 6 เดือนแรก)
  function monthly(sales, expenses, half) {
    const rows = MONTHS.slice(0, half ? 6 : 12).map((name, i) => ({ name, m: i + 1, sales: 0, cogs: 0, exp: 0 }));
    sales.forEach((x) => { const r = rows[monthOfSale(x.sale_date) - 1]; if (r) { r.sales += S(x.sale_price); r.cogs += S(x.cost_price); } });
    expenses.forEach((x) => { const r = rows[monthOfDate(x.expense_date) - 1]; if (r) r.exp += S(x.amount); });
    return rows;
  }

  // สรุปเงินได้และวิธีหักที่คุ้มกว่า (outside/outsideCost เป็นบาท)
  function summary(rows, outsideBaht, outsideCostBaht) {
    const app = rows.reduce((a, r) => a + r.sales, 0);
    const cogs = rows.reduce((a, r) => a + r.cogs, 0);
    const exp = rows.reduce((a, r) => a + r.exp, 0);
    const outside = S(outsideBaht), outsideCost = S(outsideCostBaht);
    const income = app + outside;
    const flat = Math.round(income * FLAT_RATE);
    const real = cogs + exp + outsideCost;
    const useFlat = flat >= real;
    const net = Math.max(0, income - Math.max(flat, real));
    return { app, cogs, exp, outside, outsideCost, income, flat, real, useFlat, net };
  }

  // ความคืบหน้าเกณฑ์ VAT (%) จากรายรับ 12 เดือน (สตางค์)
  const vatPercent = (totalSatang) => Math.min(100, (Money.toBaht(totalSatang) / VAT_THRESHOLD) * 100);

  const api = { FLAT_RATE, VAT_THRESHOLD, MONTHS, monthOfSale, monthly, summary, vatPercent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TaxCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
