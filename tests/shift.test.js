// ทดสอบ domain/shiftCalc.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
global.Money = require("../assets/js/money.js");
const C = require("../assets/js/domain/shiftCalc.js");

test("วันนี้ (ยังไม่เปิดร้าน): รวมยอดขาย/ต้นทุน/ค่าใช้จ่ายเป็นสตางค์", () => {
  const t = C.todayFromRows([{ sale_price: "150.50", cost_price: 60 }, { sale_price: 200, cost_price: 60 }], [{ amount: 100 }]);
  assert.deepEqual(t, { revenue: 35050, cogs: 12000, exp: 10000, items: 2 });
  assert.deepEqual(C.figures(t), { left: 25050, profit: 13050 });
});

test("ลิ้นชักขาด/เกิน", () => {
  assert.equal(C.drawerDiff(1100, 772), 32800);
  assert.equal(C.drawerDiff(700, "772.50"), -7250);
});

test("ข้อความสรุปปิดร้าน", () => {
  const txt = C.summaryText({ location: "ถนนคนเดิน", opened_at: "2026-10-26T10:00:00Z", revenue: 472, bills: 1, items: 2, cash_sales: 472, transfer_sales: 0, government_sales: 0,
    expenses: 200, expense_lines: [{ category: "ค่าเช่าแผง", amount: 200 }], left_today: 272, real_profit: 152, expected_cash: 772, counted_cash: 1100, cash_diff: 328, diff_reason: "ทอนผิด" });
  assert.match(txt, /ขาย 472 บาท \(1 บิล 2 ชิ้น\)/);
  assert.match(txt, /เกิน 328: ทอนผิด/);
});
