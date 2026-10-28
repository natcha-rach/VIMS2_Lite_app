/* ==========================================================
   data/shiftRepo.js — ชั้น Data: รอบร้าน (เปิด/ปิดร้าน) + ค่าใช้จ่ายรายวัน
   ใครเรียก: shift.js (การ์ด "ร้านวันนี้" หน้าภาพรวม)
   เรียกต่อ: supabaseClient → ตาราง shifts, sales, expenses · RPC open_shift / shift_totals / close_shift (migration_v19)
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่แจ้งเตือนเอง
   ========================================================== */
const ShiftRepo = {
  // รอบร้านที่เปิดอยู่ (เปิดได้ทีละ 1) หรือ null
  openShift() { return supabaseClient.from("shifts").select("*").is("closed_at", null).maybeSingle(); },

  // ตัวเลขรอบร้านจาก DB (ยอดขาย/ต้นทุน/เงินที่ควรมีในลิ้นชัก) — ดู shift_totals ใน SQL
  totals(shiftId) { return supabaseClient.rpc("shift_totals", { p_shift_id: shiftId }); },

  expensesOfShift(shiftId) {
    return supabaseClient.from("expenses").select("id,category,amount,paid_from,note,expense_at,created_at").eq("shift_id", shiftId).order("created_at");
  },

  // ยังไม่เปิดร้าน: ยอดขายวันนี้ตามปฏิทิน (ไม่นับที่ยกเลิก) + ค่าใช้จ่ายของวันนี้
  salesSince(startIso) {
    return fetchAllRows(() => supabaseClient.from("sales").select("sale_price,cost_price").is("voided_at", null).gte("sale_date", startIso));
  },
  expensesOfDate(dateStr) {
    return supabaseClient.from("expenses").select("id,category,amount,paid_from,note,shift_id,created_at").eq("expense_date", dateStr).order("created_at");
  },

  open(openingCash, location) { return supabaseClient.rpc("open_shift", { p_opening_cash: openingCash, p_location: location }); },
  close(shiftId, countedCash, reason) { return supabaseClient.rpc("close_shift", { p_shift_id: shiftId, p_counted_cash: countedCash, p_reason: reason }); },

  // ค่าใช้จ่ายของรอบที่ปิดแล้ว trigger ใน DB จะปฏิเสธเอง (trg_expenses_closed_shift)
  addExpense(row) { return supabaseClient.from("expenses").insert(row); },
  deleteExpense(id) { return supabaseClient.from("expenses").delete().eq("id", id); },
  updateExpense(id, row) { return supabaseClient.from("expenses").update(row).eq("id", id); },
  // V21: เงินเข้าที่ไม่ใช่การขาย (เติมทุน/ขายของเก่า) — reason ต้อง ≥3 ตัวอักษร (check ใน DB)
  addCapital(row) { return supabaseClient.from("capital_entries").insert(row); },
};
window.ShiftRepo = ShiftRepo;
