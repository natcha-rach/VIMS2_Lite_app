/* ==========================================================
   data/salesRepo.js — ชั้น Data: การขาย / บิล / ยกเลิก-คืนของ
   ใครเรียก: sell.js (หน้าขาย), offline.js (ส่งบิลที่ค้างตอนเน็ตหลุด)
   เรียกต่อ: supabaseClient → RPC sell_bill / void_bill / void_sale (sql/migration_v19 + v21) · ตาราง bills, sales
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่แจ้งเตือนเอง (หน้าที่ของ UI)
   ========================================================== */
const SalesRepo = {
  // ขายทั้งตะกร้าใน transaction เดียว — p_bill_id เดิม = ส่งซ้ำไม่เกิดบิลซ้ำ
  // ถ้า Supabase ยังไม่ได้รัน migration_v21 (ไม่รู้จัก p_sold_at) ส่งใหม่แบบไม่มีเวลาขาย
  async sellBill(params) {
    let res = await supabaseClient.rpc("sell_bill", params);
    if (res.error && params.p_sold_at && /p_sold_at|PGRST202|Could not find the function/i.test(`${res.error.message} ${res.error.code}`)) {
      const { p_sold_at, ...rest } = params;
      res = await supabaseClient.rpc("sell_bill", rest);
    }
    return res;
  },

  voidBill(billId, reason) { return supabaseClient.rpc("void_bill", { p_bill_id: billId, p_reason: reason }); },
  voidSale(saleId, reason) { return supabaseClient.rpc("void_sale", { p_sale_id: saleId, p_reason: reason }); },

  // แท็บ "บิล & คืนของ": บิลล่าสุดพร้อมรายการในบิล
  recentBills(limit = 60) {
    return supabaseClient.from("bills")
      .select("id, bill_no, created_at, channel, payment_method, total, list_total, voided_at, void_reason, sales(id, sale_price, list_price, voided_at, void_reason, items(item_name, sku))")
      .order("created_at", { ascending: false }).limit(limit);
  },

  // แท็บ "ขายแล้ว": ไม่นับรายการที่ยกเลิก
  recentSold(limit = 300) {
    return supabaseClient.from("sales")
      .select("item_id, sale_price, sale_date, items(id, item_name, size, condition, tier, cost_price, base_price, sku, lot_id, group_id, lots(lot_name), lot_groups(group_name))")
      .is("voided_at", null).order("sale_date", { ascending: false }).limit(limit);
  },

  // ประวัติการขายของสินค้าชิ้นเดียว (โมดอลรายละเอียด)
  historyOfItem(itemId) {
    return supabaseClient.from("sales")
      .select("id, sale_date, sale_price, cost_price, payment_method, channel, voided_at, void_reason")
      .eq("item_id", itemId).order("sale_date", { ascending: false });
  },
};
window.SalesRepo = SalesRepo;
