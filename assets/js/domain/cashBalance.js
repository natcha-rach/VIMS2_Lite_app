/* ==========================================================
   domain/cashBalance.js — ชั้น Domain: "เงินสด + เงินโอน ที่มีจริงตอนนี้" (หน้าบัญชี)
   ใครเรียก: accounting.js (loadAll → การ์ดเงินจริง + สูตรใต้ตัวเลข)
   ไม่แตะ DOM/Supabase · รับแถวดิบจาก AccountingRepo · คืนค่าเป็นบาท (ตามที่หน้าบัญชีเดิมใช้)
   เทสต์: tests/cashBalance.test.js

   หลักคิด: ยอดที่นับได้ล่าสุด (capital_entries.opening = จุดตั้งต้น) + รายการที่เกิด "หลัง" จุดนั้น
     + เงินทุนเข้า/ออก + ขาย − ซื้อล็อต − ค่าใช้จ่าย ± เงินขาด/เกินตอนปิดร้าน
   ยังไม่เคยนับ แต่มีเงินทุน → ใช้ผลรวมเงินทุนเป็นจุดตั้งต้นชั่วคราว (provisional)
   ========================================================== */
(function (root) {
  const CAP_SIGN = { opening: 0, capital_in: 1, old_stock_income: 1, adjust_up: 1, withdraw: -1, adjust_down: -1 };
  const n = (v) => Number(v || 0);
  const byNewest = (x, y) => new Date(y.created_at) - new Date(x.created_at);

  function compute({ capital = [], sales = [], lots = [], expenses = [], shiftDiffs = [] }) {
    let anchor = capital.filter((c) => c.entry_type === "opening").sort(byNewest)[0];
    const provisional = !anchor && capital.length > 0;
    if (provisional) {
      const last = [...capital].sort(byNewest)[0];
      anchor = { amount: capital.reduce((s, c) => s + CAP_SIGN[c.entry_type] * n(c.amount), 0), entry_date: last.entry_date, created_at: last.created_at };
    }
    const flow = { cap: 0, sales: 0, lots: 0, exp: 0, drawer: 0 };
    if (!anchor) return { balance: 0, anchor: null, provisional: false, hasAnchor: false, flow };

    const aDate = anchor.entry_date, aTs = new Date(anchor.created_at);
    // วันเดียวกับวันนับ: ถ้าลงในระบบหลังเวลานับ ถือว่าเป็นรายการใหม่
    const after = (d, row) => d > aDate || (d === aDate && new Date(row.created_at) > aTs);
    flow.cap = capital.filter((c) => c.entry_type !== "opening" && after(c.entry_date, c)).reduce((s, c) => s + CAP_SIGN[c.entry_type] * n(c.amount), 0);
    flow.sales = sales.filter((s) => new Date(s.sale_date) > aTs).reduce((s, x) => s + n(x.sale_price), 0);
    flow.lots = lots.filter((l) => after(l.purchase_date, l)).reduce((s, l) => s + n(l.total_cost), 0);
    flow.exp = expenses.filter((e) => (e.expense_at ? new Date(e.expense_at) > aTs : after(e.expense_date, e))).reduce((s, e) => s + n(e.amount), 0);
    flow.drawer = shiftDiffs.filter((s) => new Date(s.closed_at) > aTs).reduce((s, x) => s + n(x.cash_diff), 0);
    const balance = n(anchor.amount) + flow.cap + flow.sales - flow.lots - flow.exp + flow.drawer;
    return { balance, anchor, provisional, hasAnchor: !provisional, flow };
  }

  // ยอดขายโครงการรัฐหลังจุดตั้งต้น (เงินอาจยังไม่เข้าบัญชีจริง → เตือนใต้ตัวเลข)
  const governmentSince = (sales, anchor) => anchor
    ? sales.filter((s) => s.payment_method === "government" && new Date(s.sale_date) > new Date(anchor.created_at)).reduce((s, x) => s + n(x.sale_price), 0)
    : 0;

  const api = { CAP_SIGN, compute, governmentSince };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CashBalance = api;
})(typeof window !== "undefined" ? window : globalThis);
