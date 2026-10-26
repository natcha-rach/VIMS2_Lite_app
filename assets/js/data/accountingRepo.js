/* ==========================================================
   data/accountingRepo.js — ชั้น Data ของหน้าบัญชี (accounting.html)
   ใครเรียก: accounting.js (สรุปเงิน/ค่าใช้จ่าย/เงินทุน/ถังเงิน), shift-history.js (ประวัติรอบร้าน),
            storage-tools.js (รูปย่อ/ลบรูปเต็ม), สคริปต์การ์ดพื้นที่ใน accounting.html
   เรียกต่อ: supabaseClient → lots, expenses, sales, items, capital_entries, shifts, app_settings, item_images,
            Storage bucket item-images · RPC storage_usage
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · ไม่แจ้งเตือนเอง
   ========================================================== */
const AccountingRepo = {
  // ---------- ข้อมูลทั้งหมดที่ใช้คำนวณหน้าบัญชี (fetchAllRows กันข้อมูลตกหล่นเกิน 1000 แถว) ----------
  allLots() { return fetchAllRows(() => supabaseClient.from("lots").select("*")); },
  allExpenses() { return fetchAllRows(() => supabaseClient.from("expenses").select("*")); },
  allSales() { return fetchAllRows(() => supabaseClient.from("sales").select("*, items(item_name)").is("voided_at", null)); }, // ไม่นับที่ยกเลิก
  allItemLots() { return fetchAllRows(() => supabaseClient.from("items").select("id,lot_id")); },
  allCapital() { return fetchAllRows(() => supabaseClient.from("capital_entries").select("*")); },
  // เงินขาด/เกินตอนปิดร้าน — ยังไม่รัน migration_v19 จะ error (UI ข้ามได้)
  closedShiftDiffs() { return supabaseClient.from("shifts").select("closed_at,cash_diff").not("closed_at", "is", null); },

  // ---------- เงินทุน / นับเงินจริง ----------
  addCapital(entry) { return supabaseClient.from("capital_entries").insert(entry); },

  // ---------- ค่าใช้จ่าย (trigger ใน DB ห้ามแก้ของรอบร้านที่ปิดแล้ว) ----------
  addExpense(row) { return supabaseClient.from("expenses").insert(row); },
  updateExpense(id, row) { return supabaseClient.from("expenses").update(row).eq("id", id); },
  deleteExpense(id) { return supabaseClient.from("expenses").delete().eq("id", id); },

  // ---------- app_settings (cash_count = ยอดนับล่าสุด, bucket_split = % ถังเงิน) ----------
  getSetting(key) { return supabaseClient.from("app_settings").select("value").eq("key", key).maybeSingle(); },
  saveSetting(key, value) { return supabaseClient.from("app_settings").upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" }); },

  // ---------- ประวัติรอบร้าน (shift-history.js) · sinceIso = null คือทั้งหมด ----------
  closedShifts(sinceIso) {
    return fetchAllRows(() => {
      let q = supabaseClient.from("shifts").select("id,location,opened_at,closed_at,opening_cash,counted_cash,cash_diff,diff_reason,summary")
        .not("closed_at", "is", null).order("opened_at", { ascending: false });
      if (sinceIso) q = q.gte("opened_at", sinceIso);
      return q;
    });
  },

  // ---------- พื้นที่ / รูป (การ์ดพื้นที่ + storage-tools.js) ----------
  storageUsage() { return supabaseClient.rpc("storage_usage"); },
  countImagesWithoutThumb() { return supabaseClient.from("item_images").select("id", { count: "exact", head: true }).is("thumb_url", null); },
  imagesWithoutThumb() { return fetchAllRows(() => supabaseClient.from("item_images").select("id,item_id,image_url").is("thumb_url", null)); },
  // รูปเต็มของที่ขายเกิน cutoff ที่มีรูปย่อแล้วและยังไม่ถูกลบ (คอลัมน์ full_removed_at มาจาก migration_v21)
  oldSoldFullImages(cutoffIso, headOnly) {
    const cols = headOnly ? "id,items!inner(id)" : "id,item_id,storage_path,thumb_url,thumb_path,items!inner(status,sold_at)";
    return supabaseClient.from("item_images").select(cols, headOnly ? { count: "exact", head: true } : undefined)
      .eq("items.status", "sold").lt("items.sold_at", cutoffIso)
      .not("thumb_url", "is", null).not("storage_path", "is", null).is("full_removed_at", null);
  },
  updateImage(id, fields) { return supabaseClient.from("item_images").update(fields).eq("id", id); },
  uploadImage(path, blob) { return supabaseClient.storage.from("item-images").upload(path, blob, { upsert: false, contentType: "image/jpeg" }); },
  publicImageUrl(path) { return supabaseClient.storage.from("item-images").getPublicUrl(path).data.publicUrl; },
  removeImages(paths) { return supabaseClient.storage.from("item-images").remove(paths); },
};
window.AccountingRepo = AccountingRepo;
