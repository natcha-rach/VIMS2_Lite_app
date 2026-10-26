/* ==========================================================
   domain/cart.js — ชั้น Domain: คำนวณตะกร้า (ไม่แตะ DOM / Supabase · เงินเป็นสตางค์)
   ใครเรียก: sell.js (renderCartBar, renderTotals, applyDeal, confirmSale)
   เรียกต่อ: money.js (percentOffTotal, distributeToTotal, toBaht)
   เทสต์: tests/cart.test.js
   ========================================================== */
(function (root) {
  const Money = root.Money || (typeof require === "function" ? require("../money.js") : null);

  // lines = [{ list: ราคาป้าย(สตางค์), price: ราคาที่ตกลง(สตางค์) }]
  function totals(lines) {
    const list = lines.reduce((s, l) => s + l.list, 0);
    const total = lines.reduce((s, l) => s + l.price, 0);
    return { list, total, discount: list - total }; // discount ติดลบ = ขายแพงกว่าป้าย
  }

  // ดีลทั้งบิล → ราคาต่อชิ้นใหม่ (เรียงตาม listPrices) หรือ null ถ้าไม่ต้องเปลี่ยน
  //   mode "none" = ราคาป้าย · "10"/"20" = ลด % · "total" = ใส่ยอดเหมา (บาท) · "lines" = แก้รายชิ้นเองแล้ว ไม่ทับ
  function dealPrices(listPrices, mode, totalBaht) {
    if (mode === "lines") return null;
    if (mode === "10" || mode === "20") return Money.percentOffTotal(listPrices, Number(mode));
    if (mode === "total") {
      if (totalBaht === null || totalBaht === "" || !(Number(totalBaht) >= 0)) return listPrices.slice();
      return Money.distributeToTotal(listPrices, Money.toSatang(totalBaht));
    }
    return listPrices.slice();
  }

  // แปลงตะกร้าเป็น p_lines ของ RPC sell_bill (ราคาเป็นบาท)
  const toRpcLines = (lines) => lines.map((l) => ({ item_id: l.itemId, price: Money.toBaht(l.price) }));

  const api = { totals, dealPrices, toRpcLines };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Cart = api;
})(typeof window !== "undefined" ? window : globalThis);
