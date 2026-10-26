// ทดสอบ domain/insightsCalc.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../assets/js/domain/insightsCalc.js");

const now = new Date("2026-10-26T00:00:00Z").getTime();
const sale = (size, price, cost, listed, sold) => ({ sale_price: price, cost_price: cost, sale_date: sold, items: { size, listed_at: listed } });

test("มัธยฐาน", () => {
  assert.equal(I.median([]), null);
  assert.equal(I.median([5, 1, 3]), 3);
  assert.equal(I.median([1, 2, 3, 4]), 2.5);
});

test("จัดกลุ่มตามไซซ์: ขายแล้ว/กำไร/กี่วันขายออก/ค้าง/% ขายออก", () => {
  const sales = [sale("l", 200, 60, "2026-10-01", "2026-10-03"), sale("L", 100, 60, "2026-10-01", "2026-10-11")];
  const stock = [{ size: "L", current_price: 150, listed_at: "2026-08-01" }, { size: "M", current_price: 150, listed_at: "2026-10-20" }];
  const rows = I.groupBy("size", sales, stock, now);
  const L = rows.find((r) => r.key === "L");
  assert.equal(L.sold, 2);
  assert.equal(L.profit, 180);
  assert.equal(L.med, 6);          // 2 วัน กับ 10 วัน
  assert.equal(L.stock, 1);
  assert.equal(L.stale, 1);        // ลงตั้งแต่ ส.ค. = ค้าง 60+
  assert.equal(Math.round(L.through), 67);
  assert.equal(rows[0].key, "L");  // ขายมากสุดขึ้นก่อน
});

test("ช่วงราคาเรียงตามลำดับคงที่", () => {
  const rows = I.groupBy("price", [sale("M", 550, 60, "2026-10-01", "2026-10-02"), sale("M", 80, 30, "2026-10-01", "2026-10-02")], [], now);
  assert.deepEqual(rows.map((r) => r.key), ["ต่ำกว่า 100", "500 ขึ้นไป"]);
});

test("Lot คืนทุน: วันที่ยอดสะสมถึงทุน", () => {
  const lots = [{ id: "a", lot_name: "A", purchase_date: "2026-10-01", total_cost: 300 }, { id: "b", lot_name: "B", purchase_date: "2026-10-01", total_cost: 1000 }];
  const ls = [{ sale_date: "2026-10-05", sale_price: 200, items: { lot_id: "a" } }, { sale_date: "2026-10-11", sale_price: 150, items: { lot_id: "a" } }, { sale_date: "2026-10-05", sale_price: 100, items: { lot_id: "b" } }];
  const r = I.lotPayback(lots, ls, new Date("2026-10-26"));
  assert.equal(r[0].lot.id, "a");
  assert.equal(r[0].paid, true);
  assert.equal(r[0].days, 10);
  assert.equal(r[1].paid, false);
  assert.equal(Math.round(r[1].pct), 10);
});
