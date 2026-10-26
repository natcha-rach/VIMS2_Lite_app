/* ==========================================================
   data/catalogRepo.js — ชั้น Data: สินค้าที่ขายได้ + รูป + การจอง + ตั้งค่าหน้าร้าน
   ใครเรียก: sell.js (หน้าขาย)
   เรียกต่อ: supabaseClient (ตาราง items, item_images, reservations, app_settings · RPC reserve_item/release_reservation)
   กติกา: คืน { data, error } แบบ supabase-js เสมอ — UI ตัดสินใจเองว่าจะแจ้งเตือนอย่างไร
   ========================================================== */
const CatalogRepo = {
  // ของพร้อมขาย (ใช้ partial index idx_items_sellable) ใหม่สุดก่อน
  listSellable() {
    return supabaseClient.from("items")
      .select("*, lots(lot_name), lot_groups(group_name)")
      .eq("status", "available").eq("intake_status", "listed")
      .order("created_at", { ascending: false });
  },

  // รูปของหลายชิ้น → { item_id: [รูป...] } · ฐานข้อมูลยังไม่มี thumb_url (ก่อน v19) ถอยไปใช้คอลัมน์เดิม
  async imagesByItem(ids) {
    const map = {};
    if (!ids.length) return { data: map, error: null };
    const run = (cols) => fetchAllRows(() => supabaseClient.from("item_images").select(cols).in("item_id", ids).order("sort_order", { ascending: true }));
    let { data, error } = await run("item_id, image_url, thumb_url, sort_order");
    if (error) ({ data, error } = await run("item_id, image_url, sort_order"));
    (data || []).forEach((img) => { (map[img.item_id] ||= []).push(img); });
    return { data: map, error };
  },

  // การจองที่ยังเปิด → { item_id: การจอง } · ยังไม่รัน migration = ไม่มีระบบจอง (คืน map ว่าง ไม่ error)
  async activeReservations() {
    const map = {};
    const { data, error } = await supabaseClient.from("reservations").select("*").eq("status", "active");
    if (!error) (data || []).forEach((r) => { map[r.item_id] = r; });
    return { data: map, error: null };
  },

  reserve({ itemId, customerName, channel, deposit, dueDate, note }) {
    return supabaseClient.rpc("reserve_item", {
      p_item_id: itemId, p_customer_name: customerName, p_channel: channel,
      p_deposit: deposit, p_due_date: dueDate, p_note: note,
    });
  },
  releaseReservation(id) {
    return supabaseClient.rpc("release_reservation", { p_reservation_id: id });
  },

  // app_settings.pos_settings = { promptpay_id, shop_name, receipt_note }
  getPosSettings() {
    return supabaseClient.from("app_settings").select("value").eq("key", "pos_settings").maybeSingle();
  },
  savePosSettings(value) {
    return supabaseClient.from("app_settings").upsert({ key: "pos_settings", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  },
};
window.CatalogRepo = CatalogRepo;
