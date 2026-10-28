/* ==========================================================
   data/dashboardRepo.js — ชั้น Data ของหน้าแรก (index.html)
   ใครเรียก: dashboard.js (PULSE · การ์ดรายการ · Lot ใกล้คืนทุน)
   เรียกต่อ: supabaseClient → items, sales, expenses, capital_entries, app_settings, lots · RPC get_lot_performance / get_lot_summary
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่แจ้งเตือนเอง (V21: ย้ายมาจาก dashboard.js)
   ========================================================== */
const DashboardRepo = {
  // fetchAllRows: PostgREST คืนสูงสุด 1000 แถว/ครั้ง ถ้าไม่ paginate ยอดจะตกหล่นแบบเงียบๆ
  listedItems() { return fetchAllRows(() => supabaseClient.from("items").select("id,lot_id,item_name,size,condition,tier,cost_price,current_price,status,created_at,listed_at,sold_at,group_id").eq("intake_status", "listed")); },
  sales() { return fetchAllRows(() => supabaseClient.from("sales").select("id,item_id,bill_id,sale_date,channel,sale_price,cost_price,payment_method,items(item_name,sku)").is("voided_at", null)); },
  expenses() { return fetchAllRows(() => supabaseClient.from("expenses").select("id,expense_date,expense_at,amount,category,note,paid_from,shift_id")); },
  capital() { return fetchAllRows(() => supabaseClient.from("capital_entries").select("id,entry_type,amount,reason,entry_date,created_at")); },
  goal() { return supabaseClient.from("app_settings").select("key,value").eq("key", "monthly_sales_goal").maybeSingle(); },
  saveGoal(amount) { return supabaseClient.from("app_settings").upsert({ key: "monthly_sales_goal", value: { amount }, updated_at: new Date().toISOString() }); },
  lotPerformance() { return supabaseClient.rpc("get_lot_performance"); },
  lotSummary() { return supabaseClient.rpc("get_lot_summary"); },
  lotNames() { return supabaseClient.from("lots").select("id,lot_name"); },
};
window.DashboardRepo = DashboardRepo;
