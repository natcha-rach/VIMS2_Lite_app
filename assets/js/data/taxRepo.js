/* ==========================================================
   data/taxRepo.js — ชั้น Data ของหน้าสรุปภาษี (tax.html)
   ใครเรียก: tax.js
   เรียกต่อ: supabaseClient → sales (ไม่นับที่ยกเลิก), expenses, app_settings.tax_inputs
   กติกา: คืน { data, error } แบบ supabase-js เสมอ
   ========================================================== */
const TaxRepo = {
  // ยอดขายของปี (ตามเวลาไทย) — ใช้ต้นทุน snapshot ณ วันขาย (sales.cost_price)
  salesOfYear(year) {
    const from = `${year}-01-01T00:00:00+07:00`, to = `${year + 1}-01-01T00:00:00+07:00`;
    return fetchAllRows(() => supabaseClient.from("sales").select("sale_price,cost_price,sale_date").is("voided_at", null).gte("sale_date", from).lt("sale_date", to));
  },
  expensesOfYear(year) {
    return fetchAllRows(() => supabaseClient.from("expenses").select("amount,expense_date,category").gte("expense_date", `${year}-01-01`).lte("expense_date", `${year}-12-31`));
  },
  // เกณฑ์ VAT: รายรับตั้งแต่ sinceIso
  salesSince(sinceIso) {
    return fetchAllRows(() => supabaseClient.from("sales").select("sale_price").is("voided_at", null).gte("sale_date", sinceIso));
  },
  // ตัวเลขนอกแอป { "ปี": { half|full: { outside, outsideCost } } }
  getInputs() { return supabaseClient.from("app_settings").select("value").eq("key", "tax_inputs").maybeSingle(); },
  saveInputs(value) { return supabaseClient.from("app_settings").upsert({ key: "tax_inputs", value, updated_at: new Date().toISOString() }, { onConflict: "key" }); },
};
window.TaxRepo = TaxRepo;
