// ทดสอบ domain/taxCalc.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
global.Money = require("../assets/js/money.js");
const T = require("../assets/js/domain/taxCalc.js");

test("เดือนของการขายใช้เวลาไทย (31 ธ.ค. 20:00 UTC = 1 ม.ค. ไทย)", () => {
  assert.equal(T.monthOfSale("2026-01-31T18:00:00Z"), 2);
  assert.equal(T.monthOfSale("2026-01-31T16:00:00Z"), 1);
});

test("รายเดือน + ครึ่งปีตัดเดือน 7 ขึ้นไป", () => {
  const sales = [{ sale_price: 200, cost_price: 60, sale_date: "2026-03-10T05:00:00Z" }, { sale_price: 100, cost_price: 60, sale_date: "2026-08-10T05:00:00Z" }];
  const exps = [{ amount: 50, expense_date: "2026-03-01" }];
  assert.equal(T.monthly(sales, exps, false)[7].sales, 10000);
  const half = T.monthly(sales, exps, true);
  assert.equal(half.length, 6);
  assert.deepEqual(half[2], { name: "มี.ค.", m: 3, sales: 20000, cogs: 6000, exp: 5000 });
});

test("หักเหมา vs ตามจริง เลือกที่หักได้มากกว่า", () => {
  const rows = [{ sales: 10000000, cogs: 2000000, exp: 1000000 }]; // ขาย 100,000 ต้นทุน 20,000 จ่าย 10,000
  const s = T.summary(rows, 0, 0);
  assert.equal(s.flat, 6000000);
  assert.equal(s.useFlat, true);
  assert.equal(s.net, 4000000);
  const s2 = T.summary([{ sales: 10000000, cogs: 6000000, exp: 1000000 }], 0, 0);
  assert.equal(s2.useFlat, false);
  assert.equal(s2.net, 3000000);
});

test("เกณฑ์ VAT", () => {
  assert.equal(T.vatPercent(Money.toSatang(900000)), 50);
  assert.equal(T.vatPercent(Money.toSatang(5000000)), 100);
});
