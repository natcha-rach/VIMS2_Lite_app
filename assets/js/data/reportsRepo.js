/* ==========================================================
   data/reportsRepo.js — ชั้น Data ของหน้ารายงาน (reports.html) · อ่านอย่างเดียว ไม่แก้ข้อมูล
   ใครเรียก: reports.js (สรุปยอด/แนวโน้ม/Lot/กลุ่ม/แหล่งซื้อ), insights.js (อะไรขายดี)
   เรียกต่อ: supabaseClient → sales, expenses, items, lots · RPC get_lot_performance / get_group_performance / get_source_quality
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่นับการขายที่ยกเลิก (voided_at)
   ========================================================== */
const ReportsRepo = {
  // ---------- reports.js ----------
  allSalesWithItem() {
    return fetchAllRows(() => supabaseClient.from("sales")
      .select("id,item_id,sale_date,channel,sale_price,cost_price,payment_method,note,items(item_name,size,condition,tier)")
      .is("voided_at", null).order("sale_date", { ascending: false }));
  },
  // ค่าใช้จ่ายช่วงวันที่ (รวมหัวท้าย, รูปแบบ YYYY-MM-DD)
  expensesBetween(fromDate, toDate) {
    return fetchAllRows(() => supabaseClient.from("expenses").select("id,expense_date,amount,category,note").gte("expense_date", fromDate).lte("expense_date", toDate));
  },
  // กราฟแนวโน้ม [startIso, endIso)
  salesBetween(startIso, endIso) {
    return fetchAllRows(() => supabaseClient.from("sales").select("sale_date,sale_price,cost_price").is("voided_at", null).gte("sale_date", startIso).lt("sale_date", endIso));
  },
  lotPerformance() { return supabaseClient.rpc("get_lot_performance"); },
  groupPerformance() { return supabaseClient.rpc("get_group_performance"); },
  sourceQuality() { return supabaseClient.rpc("get_source_quality"); },

  // ---------- insights.js ----------
  // การขายพร้อมคุณสมบัติสินค้า · sinceIso = null คือทั้งหมด
  salesForInsights(sinceIso) {
    return fetchAllRows(() => {
      let q = supabaseClient.from("sales")
        .select("sale_date,sale_price,cost_price,list_price,item_id,items(size,condition,tier,item_type,created_at,listed_at,lot_id)")
        .is("voided_at", null);
      if (sinceIso) q = q.gte("sale_date", sinceIso);
      return q;
    });
  },
  stockForInsights() {
    return fetchAllRows(() => supabaseClient.from("items").select("size,condition,tier,item_type,current_price,created_at,listed_at").eq("status", "available").eq("intake_status", "listed"));
  },
  lotsBasic() { return fetchAllRows(() => supabaseClient.from("lots").select("id,lot_name,purchase_date,total_cost")); },
  // คืนทุน Lot ต้องใช้ยอดขายทั้งหมดตั้งแต่ซื้อ (ไม่ตัดตามช่วง)
  salesByLot() { return fetchAllRows(() => supabaseClient.from("sales").select("sale_date,sale_price,items(lot_id)").is("voided_at", null)); },
};
window.ReportsRepo = ReportsRepo;
