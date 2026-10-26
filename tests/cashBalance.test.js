// ทดสอบ domain/cashBalance.js — รัน: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assets/js/domain/cashBalance.js");

const anchorAt = "2026-10-20T10:00:00Z";
const capital = [{ entry_type: "opening", amount: 5000, entry_date: "2026-10-20", created_at: anchorAt }];

test("ยังไม่เคยนับเงินและไม่มีเงินทุน = ยังไม่มีจุดตั้งต้น", () => {
  const r = C.compute({});
  assert.equal(r.anchor, null);
  assert.equal(r.balance, 0);
});

test("นับได้ 5000 แล้ว + ขายหลังนับ − ค่าใช้จ่าย − ซื้อล็อต ± ขาด/เกินปิดร้าน (ก่อนนับไม่นับ)", () => {
  const r = C.compute({
    capital,
    sales: [{ sale_date: "2026-10-19T10:00:00Z", sale_price: 999 }, { sale_date: "2026-10-21T10:00:00Z", sale_price: 400 }],
    expenses: [{ expense_at: "2026-10-21T09:00:00Z", amount: 100 }, { expense_date: "2026-10-20", created_at: "2026-10-20T09:00:00Z", amount: 50 }],
    lots: [{ purchase_date: "2026-10-22", created_at: "2026-10-22T00:00:00Z", total_cost: 1000 }],
    shiftDiffs: [{ closed_at: "2026-10-21T22:00:00Z", cash_diff: -20 }],
  });
  assert.equal(r.hasAnchor, true);
  assert.deepEqual(r.flow, { cap: 0, sales: 400, lots: 1000, exp: 100, drawer: -20 });
  assert.equal(r.balance, 5000 + 400 - 1000 - 100 - 20);
});

test("ไม่เคยนับ แต่มีเงินทุน → ใช้ผลรวมเงินทุนชั่วคราว", () => {
  const r = C.compute({ capital: [{ entry_type: "capital_in", amount: 3000, entry_date: "2026-10-01", created_at: "2026-10-01T00:00:00Z" }, { entry_type: "withdraw", amount: 500, entry_date: "2026-10-02", created_at: "2026-10-02T00:00:00Z" }] });
  assert.equal(r.provisional, true);
  assert.equal(r.hasAnchor, false);
  assert.equal(r.balance, 2500);
});

test("ยอดโครงการรัฐหลังจุดตั้งต้น", () => {
  assert.equal(C.governmentSince([{ payment_method: "government", sale_date: "2026-10-21T00:00:00Z", sale_price: 300 }, { payment_method: "cash", sale_date: "2026-10-21T00:00:00Z", sale_price: 100 }], capital[0]), 300);
});
