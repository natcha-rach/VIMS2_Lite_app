/* ==========================================================
   data/itemsRepo.js — ชั้น Data ของหน้าสินค้า (items.html)
   ใครเรียก: items.js (ลงของทีละชิ้น, ตารางสต็อก, แก้ไขสินค้า, กลุ่มราคา), stale.js (ของค้าง → ลดราคา)
   เรียกต่อ: supabaseClient → items, v_items_list, item_images, lot_groups, lots, item_change_history
            RPC get_group_progress / bulk_update_items / update_item_with_history / markdown_items
   กติกา: คืน { data, error } แบบ supabase-js เสมอ
   รอบ 1: ยังไม่ย้าย uploadItemImages() และ Bulk 200 (Photo Queue/Excel) — ซับซ้อน ทำรอบถัดไป
   ========================================================== */
const ItemsRepo = {
  // ---------- Lot / กลุ่มราคา ----------
  lotsForPicker() { return supabaseClient.from("lots").select("id, lot_name, purchase_date, total_cost, total_items").order("purchase_date", { ascending: false }); },
  groupsOfLot(lotId) { return supabaseClient.from("lot_groups").select("*").eq("lot_id", lotId).order("sort_order"); },
  groupProgress(lotId) { return supabaseClient.rpc("get_group_progress", { p_lot_id: lotId }); },
  addGroup(row) { return supabaseClient.from("lot_groups").insert(row); },

  // ---------- สินค้า ----------
  // สร้าง 1 ชิ้น แล้วคืนแถวที่สร้าง (ต้องใช้ id ไปอัปโหลดรูป)
  create(payload) { return supabaseClient.from("items").insert(payload).select().single(); },
  // ใช้ยกเลิกชิ้นที่เพิ่งสร้างเมื่ออัปโหลดรูปไม่สำเร็จ (ยังไม่เคยขาย)
  remove(id) { return supabaseClient.from("items").delete().eq("id", id); },

  // ตารางสต็อก: view v_items_list (มี image_count/age_days/ชื่อ Lot-Group) + ตัวกรองฝั่ง server
  //   status: available|sold|damaged|all · q: ค้นชื่อ/SKU · extra: no_photo|no_price|age30|age60|age90
  list({ status, q, extra }) {
    return fetchAllRows(() => {
      let query = supabaseClient.from("v_items_list").select("*").eq("intake_status", "listed").order("created_at", { ascending: false });
      if (status !== "all") query = query.eq("status", status);
      if (q) query = query.or(`item_name.ilike.%${q}%,sku.ilike.%${q}%`);
      if (extra === "no_photo") query = query.eq("image_count", 0);
      if (extra === "no_price") query = query.or("current_price.is.null,current_price.eq.0");
      if (extra === "age30") query = query.gte("age_days", 30);
      if (extra === "age60") query = query.gte("age_days", 60);
      if (extra === "age90") query = query.gte("age_days", 90);
      return query;
    });
  },
  imagesOfItems(ids) { return fetchAllRows(() => supabaseClient.from("item_images").select("*").in("item_id", ids).order("sort_order")); },
  imagesOfItem(id) { return supabaseClient.from("item_images").select("*").eq("item_id", id).order("sort_order"); },
  // การ์ดตัวเลขบนหัวตาราง
  statsRows() { return fetchAllRows(() => supabaseClient.from("items").select("status,cost_price").eq("intake_status", "listed")); },
  // แก้หลายชิ้นพร้อมกัน (ราคา/กลุ่ม/สถานะ) — patch = { p_xxx: ค่า }
  bulkUpdate(ids, patch) { return supabaseClient.rpc("bulk_update_items", { p_ids: ids, ...patch }); },

  // ---------- แก้ไขสินค้า 1 ชิ้น (เก็บประวัติใน item_change_history) ----------
  updateWithHistory(params) { return supabaseClient.rpc("update_item_with_history", params); },
  history(itemId, limit = 30) { return supabaseClient.from("item_change_history").select("*").eq("item_id", itemId).order("created_at", { ascending: false }).limit(limit); },
  addHistory(row) { return supabaseClient.from("item_change_history").insert(row); },
  // เปลี่ยนรูป: ลบไฟล์เดิมใน Storage + แถว item_images เดิม (อัปรูปใหม่ยังทำใน items.js)
  removeImageFiles(paths) { return supabaseClient.storage.from("item-images").remove(paths); },
  removeImagesOfItem(itemId) { return supabaseClient.from("item_images").delete().eq("item_id", itemId); },

  // ---------- ของค้าง (stale.js) ----------
  staleSince(cutoffIso) {
    return fetchAllRows(() => supabaseClient.from("items")
      .select("id,item_name,sku,size,condition,cost_price,current_price,created_at,listed_at,lots(lot_name),lot_groups(group_name)")
      .eq("status", "available").eq("intake_status", "listed").lte("created_at", cutoffIso)
      .order("created_at", { ascending: true }));
  },
  // ลด % หรือตั้งราคาใหม่หลายชิ้น (migration_v21) — ใส่ percent หรือ price อย่างใดอย่างหนึ่ง
  markdown({ ids, percent, price, reason }) {
    return supabaseClient.rpc("markdown_items", { p_item_ids: ids, p_percent: percent, p_price: price, p_reason: reason });
  },
};
window.ItemsRepo = ItemsRepo;
