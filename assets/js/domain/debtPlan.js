/* ==========================================================
   domain/debtPlan.js — ชั้น Domain: การ์ด "กันเงินหนี้" หน้าบัญชี (ไม่แตะ DOM / Supabase)
   ใครเรียก: accounting.js · ทดสอบ: tests/debtPlan.test.js
   หลักคิด: หนี้จ่ายวันที่ 29 · 1 · 5 → รอบกันเงินเริ่มวันที่ 6 และต้องพร้อมภายในวันที่ 28
            กำไรจริงของรอบ (ยอดขาย − ต้นทุนที่ขาย − ค่าใช้จ่าย) = เงินที่ควรกันได้
            เป้าต่อวันตลาด = ที่ยังขาด ÷ เสาร์-อาทิตย์ที่เหลือถึงวันที่ 28 (นับวันนี้ด้วย)
   ========================================================== */
(function (root) {
  const n = (v) => Number(v) || 0;
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function compute({ today = new Date(), sales = [], expenses = [], target = 35000 }) {
    const y = today.getFullYear(), m = today.getMonth();
    const start = today.getDate() >= 6 ? new Date(y, m, 6) : new Date(y, m - 1, 6); // วันที่ 1-5 ยังเป็นรอบของเดือนก่อน
    const readyBy = new Date(start.getFullYear(), start.getMonth(), 28);
    const dues = [new Date(start.getFullYear(), start.getMonth(), 29), new Date(start.getFullYear(), start.getMonth() + 1, 1), new Date(start.getFullYear(), start.getMonth() + 1, 5)];
    const startKey = key(start);

    const profit = sales.filter((s) => new Date(s.sale_date) >= start).reduce((a, s) => a + n(s.sale_price) - n(s.cost_price), 0)
      - expenses.filter((e) => e.expense_date >= startKey).reduce((a, e) => a + n(e.amount), 0);
    const remaining = Math.max(0, n(target) - profit);

    let daysLeft = 0;
    for (const d = new Date(y, m, today.getDate()); d <= readyBy; d.setDate(d.getDate() + 1)) if (d.getDay() === 0 || d.getDay() === 6) daysLeft++;
    const perDay = daysLeft ? Math.ceil(remaining / daysLeft) : remaining;

    return { start, readyBy, dues, profit, remaining, daysLeft, perDay, pct: n(target) ? Math.min(100, Math.max(0, (profit / n(target)) * 100)) : 0, paying: today >= dues[0] }; // ถึงวันที่ 29 = ช่วงจ่ายหนี้ (วันที่ 28 ทั้งวันยังกันเงินได้)
  }

  const api = { compute };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DebtPlan = api;
})(typeof window !== "undefined" ? window : globalThis);
