// ทดสอบ assets/js/money.js — รัน: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../assets/js/money.js");

const sum = (a) => a.reduce((x, y) => x + y, 0);

test("บาท ↔ สตางค์ ไม่เพี้ยน", () => {
  assert.equal(M.toSatang(0.1) + M.toSatang(0.2), 30);
  assert.equal(M.toSatang("199.99"), 19999);
  assert.equal(M.toBaht(12345), 123.45);
});

test("เหมา 3 ตัว 350: รวมพอดี ทุกชิ้นเป็นบาทเต็ม ตามสัดส่วน", () => {
  const out = M.distributeToTotal([20000, 18000, 15000], 35000);
  assert.equal(sum(out), 35000);
  out.slice(0, -1).forEach((v) => assert.equal(v % 100, 0));
  assert.ok(out[0] >= out[1] && out[1] >= out[2]);
});

test("ยอดที่ปัดแล้วเกิน → ชิ้นสุดท้ายไม่ติดลบ", () => {
  for (let target = 0; target <= 1000; target += 100) {
    const out = M.distributeToTotal([10000, 10000, 100], target);
    assert.equal(sum(out), target);
    out.forEach((v) => assert.ok(v >= 0));
  }
});

test("ราคาเป็น 0 ทั้งหมด → แบ่งเท่ากัน", () => {
  const out = M.distributeToTotal([0, 0], 10000);
  assert.deepEqual(out, [5000, 5000]);
});

test("ลด 10% ปัดยอดรวมลงเป็นบาทเต็ม", () => {
  const out = M.percentOffTotal([19900, 15000], 10);
  assert.equal(sum(out), 31400); // 349 * 0.9 = 314.1 → 314
});

test("เงินทอน + ปุ่มรับเงินด่วน", () => {
  assert.equal(M.changeDue(35000, 50000), 15000);
  assert.equal(M.changeDue(35000, 30000), null);
  assert.deepEqual(M.quickCashOptions(35000), [35000, 40000, 50000, 100000]);
});

test("CRC16-CCITT ตรงค่ามาตรฐาน", () => {
  assert.equal(M.crc16("123456789"), "29B1");
});

test("PromptPay payload: เบอร์มือถือ + ยอดเงิน", () => {
  const p = M.promptPayPayload("080-123-4567", 350);
  assert.ok(p.startsWith("000201010212"));
  assert.ok(p.includes("0016A000000677010111" + "01130066801234567"));
  assert.ok(p.includes("5406350.00"));
  assert.equal(p.slice(-4), M.crc16(p.slice(0, -4)));
  assert.equal(M.promptPayPayload("12345", 10), null);
});

// ค่าอ้างอิงจากตัวอย่างของไลบรารี php-promptpay-qr (kittinan)
test("PromptPay payload ตรงกับไลบรารีอ้างอิง", () => {
  assert.equal(M.promptPayPayload("0899999999"), "00020101021129370016A000000677010111011300668999999995802TH53037646304FE29");
  assert.equal(M.promptPayPayload("089-999-9999", 420), "00020101021229370016A000000677010111011300668999999995802TH53037645406420.006304CF9E");
});
