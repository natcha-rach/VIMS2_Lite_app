/* ==========================================================
   domain/shiftCalc.js — ชั้น Domain: ตัวเลข "ร้านวันนี้" + ข้อความสรุปปิดร้าน (สตางค์ · ไม่แตะ DOM/Supabase)
   ใครเรียก: shift.js (render การ์ด, ช่องนับเงิน, ปุ่มแชร์ LINE)
   เรียกต่อ: money.js (toSatang/toBaht)
   กฎ (CLAUDE.md ข้อ 4): เหลือวันนี้ = ยอดขาย − ค่าใช้จ่าย · กำไรจริง = ยอดขาย − ต้นทุน − ค่าใช้จ่าย
   เทสต์: tests/shift.test.js
   ========================================================== */
(function (root) {
  const Money = root.Money || (typeof require === "function" ? require("../money.js") : null);
  const S = (v) => Money.toSatang(v);
  const sumBy = (rows, f) => rows.reduce((a, r) => a + S(f(r)), 0);

  // ยังไม่เปิดร้าน: รวมจากแถว sales/expenses ของวันนี้
  function todayFromRows(sales, expenses) {
    return { revenue: sumBy(sales, (x) => x.sale_price), cogs: sumBy(sales, (x) => x.cost_price), exp: sumBy(expenses, (x) => x.amount), items: sales.length };
  }

  // เหลือวันนี้ / กำไรจริง (สตางค์)
  function figures({ revenue, cogs, exp }) {
    return { left: revenue - exp, profit: revenue - cogs - exp };
  }

  // นับเงินได้ − ควรมี (สตางค์) · ติดลบ = ขาด
  const drawerDiff = (countedBaht, expectedBaht) => S(countedBaht) - S(expectedBaht);

  // ข้อความสรุปปิดร้าน (แชร์ LINE) จากผล close_shift
  function summaryText(t) {
    const d = new Date(t.opened_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
    const n = (v) => Money.toBaht(S(v)).toLocaleString("th-TH");
    const lines = (t.expense_lines || []).map((x) => `${x.category} ${n(x.amount)}`).join(", ");
    const diff = Number(t.cash_diff || 0);
    return [
      `สรุปปิดร้าน ${t.location} ${d}`,
      `ขาย ${n(t.revenue)} บาท (${t.bills} บิล ${t.items} ชิ้น)`,
      `สด ${n(t.cash_sales)} · โอน ${n(t.transfer_sales)} · รัฐ ${n(t.government_sales)}`,
      `ค่าใช้จ่าย ${n(t.expenses)}${lines ? ` (${lines})` : ""}`,
      `เหลือ ${n(t.left_today)} · กำไรจริง ${n(t.real_profit)}`,
      `ลิ้นชัก ควรมี ${n(t.expected_cash)} นับได้ ${n(t.counted_cash)}${diff ? ` (${diff < 0 ? "ขาด" : "เกิน"} ${n(Math.abs(diff))}${t.diff_reason ? ": " + t.diff_reason : ""})` : " ตรง"}`,
    ].join("\n");
  }

  const api = { todayFromRows, figures, drawerDiff, summaryText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShiftCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
