/* ==========================================================
   data/expenseRepo.js — ชั้น Data ของแผ่นจดเงิน (ปุ่ม + หน้าแรก)
   ใครเรียก: expense-sheet.js · เรียกต่อ: supabaseClient → expenses, capital_entries
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่แจ้งเตือนเอง
   ========================================================== */
const ExpenseRepo = {
  addExpense(row) { return supabaseClient.from("expenses").insert(row); },
  updateExpense(id, row) { return supabaseClient.from("expenses").update(row).eq("id", id); },
  deleteExpense(id) { return supabaseClient.from("expenses").delete().eq("id", id); },
  // เงินเข้า-ออกที่ไม่ใช่การขาย (เติมทุน/ขายของเก่า/ถอน) — reason ต้อง ≥3 ตัวอักษร (check ใน DB)
  addCapital(row) { return supabaseClient.from("capital_entries").insert(row); },
};
window.ExpenseRepo = ExpenseRepo;
