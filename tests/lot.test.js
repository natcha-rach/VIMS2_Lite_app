// ทดสอบ domain/lotCalc.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../assets/js/domain/lotCalc.js");

test("ต้นทุนรวมแยกส่วน ไม่เพี้ยนทศนิยม", () => {
  assert.equal(L.totalCost(["0.1", "0.2", "", null, 100]), 100.3);
});

test("ต้นทุนเฉลี่ยต่อชิ้น", () => {
  assert.equal(L.avgCost(3000, 50), 60);
  assert.equal(L.avgCost(3000, 0), null);
});

test("นับชิ้นต่อกลุ่ม (ไม่นับชิ้นที่ไม่มีกลุ่ม)", () => {
  assert.deepEqual(L.countByGroup([{ group_id: "a" }, { group_id: "a" }, { group_id: null }, { group_id: "b" }]), { a: 2, b: 1 });
});
