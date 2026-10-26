// ทดสอบ domain/cart.js + domain/reservations.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
global.Money = require("../assets/js/money.js");
const Cart = require("../assets/js/domain/cart.js");
const R = require("../assets/js/domain/reservations.js");

test("รวมยอดตะกร้า + ส่วนลด", () => {
  assert.deepEqual(Cart.totals([{ list: 20000, price: 18000 }, { list: 15000, price: 15000 }]), { list: 35000, total: 33000, discount: 2000 });
});

test("ดีลเหมา กระจายแล้วผลรวมตรงทุกสตางค์", () => {
  const p = Cart.dealPrices([20000, 18000, 35000], "total", 650);
  assert.equal(p.reduce((a, b) => a + b, 0), 65000);
});

test("ดีลเหมายังไม่ใส่ยอด = ราคาป้าย · แก้รายชิ้นแล้ว = ไม่ทับ", () => {
  assert.deepEqual(Cart.dealPrices([100, 200], "total", ""), [100, 200]);
  assert.equal(Cart.dealPrices([100, 200], "lines"), null);
});

test("แปลงเป็น p_lines ของ sell_bill เป็นบาท", () => {
  assert.deepEqual(Cart.toRpcLines([{ itemId: "a", price: 15050 }]), [{ item_id: "a", price: 150.5 }]);
});

test("วันนัดจอง: เลยนัด / วันนี้ / ไม่กำหนด แล้วเรียงถูก", () => {
  const now = new Date("2026-10-26T15:00:00");
  assert.equal(R.daysLeft("2026-10-24", now), -2);
  assert.equal(R.daysLeft("2026-10-26", now), 0);
  assert.equal(R.daysLeft(null, now), null);
  const rows = R.sortByDue([{ id: 1, due_date: null }, { id: 2, due_date: "2026-10-30" }, { id: 3, due_date: "2026-10-20" }], now);
  assert.deepEqual(rows.map((x) => x.r.id), [3, 2, 1]);
  assert.equal(R.isOverdue(rows[0]), true);
});
