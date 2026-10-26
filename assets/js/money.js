/* ==========================================================
   money.js — เลขเงิน + QR พร้อมเพย์ (ไม่แตะ DOM, ไม่แตะ Supabase)
   ใช้โดย: sell.js (ตะกร้า/ชำระเงิน), shift.js (สรุปปิดร้าน), tax.js
   ทดสอบ: node --test tests/money.test.js

   business rule: คิดเงินเป็น "สตางค์" (จำนวนเต็ม) ทุกครั้งก่อนบวก/ลบ/หาร
   เพราะ JavaScript คิดทศนิยมเพี้ยน เช่น 0.1 + 0.2 = 0.30000000000000004
   ========================================================== */
(function (root) {
  // บาท → สตางค์ (int)
  function toSatang(baht) {
    const n = Number(baht);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  // สตางค์ → บาท (number)
  function toBaht(satang) {
    return Math.round(Number(satang) || 0) / 100;
  }

  // ==========================================================
  // distributeToTotal — กระจาย "ยอดใหม่ทั้งบิล" ลงแต่ละชิ้นตามสัดส่วนราคา
  // ใช้กับ: ลด 10% ทั้งบิล / "เหมา 3 ตัว 350" / ใส่ยอดเอง
  //   prices  = ราคาต่อชิ้นปัจจุบัน (สตางค์) เช่น [20000, 18000, 15000]
  //   target  = ยอดรวมใหม่ (สตางค์) เช่น 35000
  //   คืนค่า  = ราคาใหม่ต่อชิ้น (สตางค์) ที่รวมกันได้ target พอดีทุกสตางค์
  // ปัดเป็นบาทเต็มทีละชิ้น (ราคาเสื้อมือสองไม่มีสตางค์) แล้วให้ชิ้นสุดท้ายรับเศษ
  // ทำไมต้องกระจาย: กำไรรายชิ้น/รายงานขายดีตาม Lot ต้องใช้ราคาที่ขายจริงของแต่ละชิ้น
  // ==========================================================
  function distributeToTotal(prices, target) {
    const list = (prices || []).map((p) => Math.max(0, Math.round(Number(p) || 0)));
    const goal = Math.max(0, Math.round(Number(target) || 0));
    if (!list.length) return [];
    const sum = list.reduce((a, b) => a + b, 0);
    const out = [];
    let used = 0;
    for (let i = 0; i < list.length; i++) {
      if (i === list.length - 1) {
        out.push(goal - used); // ชิ้นสุดท้ายรับเศษจากการปัด
        break;
      }
      const share = sum > 0 ? (goal * list[i]) / sum : goal / list.length;
      let v = Math.round(share / 100) * 100; // ปัดเป็นบาทเต็ม
      v = Math.min(v, goal - used);          // ห้ามเกินยอดที่เหลือ → ชิ้นสุดท้ายไม่ติดลบ
      out.push(Math.max(0, v));
      used += Math.max(0, v);
    }
    return out;
  }

  // ลดเป็น % ทั้งบิล แล้วปัดยอดรวมลงเป็นบาทเต็ม (ใจดีกับลูกค้า)
  function percentOffTotal(prices, percent) {
    const sum = (prices || []).reduce((a, b) => a + (Number(b) || 0), 0);
    const pct = Math.min(100, Math.max(0, Number(percent) || 0));
    const target = Math.floor((sum * (100 - pct)) / 100 / 100) * 100;
    return distributeToTotal(prices, target);
  }

  // เงินทอน (สตางค์) — คืน null ถ้ารับเงินไม่พอ
  function changeDue(totalSatang, receivedSatang) {
    const diff = Math.round(receivedSatang) - Math.round(totalSatang);
    return diff >= 0 ? diff : null;
  }

  // ปุ่มรับเงินด่วน: พอดี + แบงก์ 100/500/1000 ที่ใกล้ที่สุดที่ครอบยอด
  function quickCashOptions(totalSatang) {
    const t = Math.ceil(Math.round(totalSatang) / 100); // บาท
    const set = new Set([t]);
    [100, 500, 1000].forEach((note) => {
      const v = Math.ceil(t / note) * note;
      if (v > t) set.add(v);
    });
    return [...set].sort((a, b) => a - b).slice(0, 4).map((b) => b * 100);
  }

  // ==========================================================
  // QR พร้อมเพย์ (มาตรฐาน EMVCo / Thai QR Payment)
  //   id = เบอร์มือถือ 10 หลัก / เลขบัตรประชาชน 13 หลัก / e-Wallet 15 หลัก
  //   amountBaht = ยอดเงิน (ไม่ใส่ = ให้ลูกค้าพิมพ์ยอดเอง)
  // ==========================================================
  function tlv(tag, value) {
    return tag + String(value.length).padStart(2, "0") + value;
  }

  function crc16(str) {
    // CRC-16/CCITT-FALSE: poly 0x1021, init 0xFFFF
    let crc = 0xffff;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) {
        crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
        crc &= 0xffff;
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  function normalizePromptPayId(id) {
    const digits = String(id || "").replace(/\D/g, "");
    if (digits.length === 10 && digits.startsWith("0")) return { tag: "01", value: "0066" + digits.slice(1) };
    if (digits.length === 13) return { tag: "02", value: digits };
    if (digits.length === 15) return { tag: "03", value: digits };
    return null;
  }

  function promptPayPayload(id, amountBaht) {
    const target = normalizePromptPayId(id);
    if (!target) return null;
    const amount = Number(amountBaht);
    const hasAmount = Number.isFinite(amount) && amount > 0;
    let payload =
      tlv("00", "01") +
      tlv("01", hasAmount ? "12" : "11") +
      tlv("29", tlv("00", "A000000677010111") + tlv(target.tag, target.value)) +
      tlv("58", "TH") +
      tlv("53", "764") +
      (hasAmount ? tlv("54", amount.toFixed(2)) : "") +
      "6304";
    return payload + crc16(payload);
  }

  const api = { toSatang, toBaht, distributeToTotal, percentOffTotal, changeDue, quickCashOptions, crc16, normalizePromptPayId, promptPayPayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Money = api;
})(typeof window !== "undefined" ? window : globalThis);
