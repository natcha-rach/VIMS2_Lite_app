// ทดสอบ assets/js/domain/debtPlan.js — รัน: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../assets/js/domain/debtPlan.js");

test("รอบเริ่มวันที่ 6 พร้อมภายในวันที่ 28 · นัดจ่าย 29/1/5", () => {
  const r = D.compute({ today: new Date(2026, 9, 28) }); // พุธ 28 ต.ค. 2569
  assert.equal(r.start.getDate(), 6); assert.equal(r.start.getMonth(), 9);
  assert.equal(r.readyBy.getDate(), 28);
  assert.deepEqual(r.dues.map((d) => `${d.getDate()}/${d.getMonth() + 1}`), ["29/10", "1/11", "5/11"]);
});

test("วันที่ 1-5 ยังเป็นรอบของเดือนก่อน และอยู่ในช่วงจ่ายหนี้", () => {
  const r = D.compute({ today: new Date(2026, 10, 3) });
  assert.equal(r.start.getMonth(), 9);
  assert.equal(r.paying, true);
  assert.equal(r.daysLeft, 0);
});

test("กำไรรอบนี้ = ขาย − ต้นทุน − ค่าใช้จ่าย (ไม่นับก่อนวันที่ 6) · เป้าต่อวันตลาดปัดขึ้น", () => {
  const r = D.compute({
    today: new Date(2026, 9, 20), // อังคาร → เหลือ ส-อา 24,25 = 2 วันถึง 28
    target: 35000,
    sales: [
      { sale_date: "2026-10-10T10:00:00", sale_price: 10000, cost_price: 2500 },
      { sale_date: "2026-10-05T10:00:00", sale_price: 9999, cost_price: 0 }, // รอบก่อน ไม่นับ
    ],
    expenses: [{ expense_date: "2026-10-11", amount: 500 }, { expense_date: "2026-10-04", amount: 999 }],
  });
  assert.equal(r.profit, 7000);
  assert.equal(r.remaining, 28000);
  assert.equal(r.daysLeft, 2);
  assert.equal(r.perDay, 14000);
});

test("กันครบแล้ว → ไม่ต้องกันเพิ่ม", () => {
  const r = D.compute({ today: new Date(2026, 9, 20), target: 1000, sales: [{ sale_date: "2026-10-10", sale_price: 2000, cost_price: 0 }] });
  assert.equal(r.remaining, 0); assert.equal(r.perDay, 0); assert.equal(r.pct, 100);
});

test("วันที่ 28 ตอนค่ำยังเป็นช่วงกันเงิน (ไม่ใช่ช่วงจ่าย)", () => {
  const r = D.compute({ today: new Date(2026, 9, 28, 22, 0) });
  assert.equal(r.paying, false);
});
