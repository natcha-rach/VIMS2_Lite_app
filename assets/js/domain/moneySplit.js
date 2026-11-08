/* ==========================================================
   domain/moneySplit.js — ชั้น Domain: แยกเงินสด / เงินโอน ของการ์ด "เงินเข้า-ออก" หน้าแรก
   ใครเรียก: dashboard.js · ทดสอบ: tests/moneySplit.test.js
   หลักคิด: ขาย: เงินสด = payment_method "cash" · ที่เหลือ (โอน/พร้อมเพย์/โครงการรัฐ) = เงินโอน
            จ่าย: paid_from "drawer" = เงินสด · "transfer" = เงินโอน · อื่นๆ = ไม่ระบุ (ไม่เดาว่าเป็นกระเป๋าไหน หักเฉพาะยอดรวม)
   คิดเป็นสตางค์ภายในกันทศนิยมเพี้ยน แล้วคืนเป็นบาท
   ========================================================== */
(function (root) {
  const sat = (v) => Math.round((Number(v) || 0) * 100);
  const sum = (rows, field) => rows.reduce((a, r) => a + sat(r[field]), 0);

  function compute({ sales = [], expenses = [] }) {
    const cashIn = sum(sales.filter((s) => s.payment_method === "cash"), "sale_price");
    const transferIn = sum(sales.filter((s) => s.payment_method !== "cash"), "sale_price");
    const cashOut = sum(expenses.filter((e) => e.paid_from === "drawer"), "amount");
    const transferOut = sum(expenses.filter((e) => e.paid_from === "transfer"), "amount");
    const unknownOut = sum(expenses.filter((e) => e.paid_from !== "drawer" && e.paid_from !== "transfer"), "amount");
    const baht = (s) => s / 100;
    return {
      cash: { in: baht(cashIn), out: baht(cashOut), left: baht(cashIn - cashOut) },
      transfer: { in: baht(transferIn), out: baht(transferOut), left: baht(transferIn - transferOut) },
      unknownOut: baht(unknownOut),
      left: baht(cashIn + transferIn - cashOut - transferOut - unknownOut),
    };
  }

  const api = { compute };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MoneySplit = api;
})(typeof window !== "undefined" ? window : globalThis);
