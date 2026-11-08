// ทดสอบ assets/js/domain/moneySplit.js — รัน: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../assets/js/domain/moneySplit.js");

const sales = [
  { payment_method: "cash", sale_price: "1060" },
  { payment_method: "transfer", sale_price: 2000 },
  { payment_method: "government", sale_price: 720 },
];

test("แยกขายและจ่ายตามกระเป๋า แต่ละฝั่งหักของตัวเอง", () => {
  const r = M.compute({ sales, expenses: [{ paid_from: "drawer", amount: 100 }, { paid_from: "transfer", amount: 285 }] });
  assert.deepEqual(r.cash, { in: 1060, out: 100, left: 960 });
  assert.deepEqual(r.transfer, { in: 2720, out: 285, left: 2435 });
  assert.equal(r.unknownOut, 0);
  assert.equal(r.left, 3395);
});

test("จ่ายแบบไม่ระบุ: ไม่หักกระเป๋าไหน แต่หักยอดรวม", () => {
  const r = M.compute({ sales, expenses: [{ paid_from: "other", amount: 385 }] });
  assert.equal(r.cash.left, 1060);
  assert.equal(r.transfer.left, 2720);
  assert.equal(r.unknownOut, 385);
  assert.equal(r.left, 3395);
});

test("ทศนิยมไม่เพี้ยน และติดลบได้เมื่อจ่ายเกินรับ", () => {
  const r = M.compute({ sales: [{ payment_method: "cash", sale_price: 0.1 }], expenses: [{ paid_from: "drawer", amount: 0.3 }] });
  assert.equal(r.cash.left, -0.2);
});
