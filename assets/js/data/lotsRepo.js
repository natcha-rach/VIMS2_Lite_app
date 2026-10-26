/* ==========================================================
   data/lotsRepo.js — ชั้น Data ของหน้าล็อต (lots.html)
   ใครเรียก: lots.js (ฟอร์ม Lot, การ์ด Lot, ปิด/เปิด Lot, คิดต้นทุนใหม่, จัดการกลุ่มราคา)
   เรียกต่อ: supabaseClient → lots, lot_groups, items · RPC get_lot_summary / get_group_progress / recost_lot
   กติกา: คืน { data, error } แบบ supabase-js เสมอ · trigger compute_lot_total_cost() ใน DB คิดต้นทุนรวมซ้ำให้อีกชั้น
   ========================================================== */
const LotsRepo = {
  // ---------- Lot ----------
  list() { return supabaseClient.from("lots").select("*").order("purchase_date", { ascending: false }); },
  // id = null → สร้างใหม่ · มี id → แก้ไข
  save(id, payload) { return id ? supabaseClient.from("lots").update(payload).eq("id", id) : supabaseClient.from("lots").insert(payload); },
  update(id, fields) { return supabaseClient.from("lots").update(fields).eq("id", id); },
  remove(id) { return supabaseClient.from("lots").delete().eq("id", id); },
  // คิดต้นทุนต่อชิ้นของทั้ง Lot ใหม่ตามวิธีที่เลือก (เท่ากันทุกชิ้น / ตามราคา ฯลฯ)
  recost(id, basis) { return supabaseClient.rpc("recost_lot", { p_lot_id: id, p_basis: basis }); },
  // สรุปขาย/คืนทุนของทุก Lot + ความคืบหน้าแต่ละกลุ่ม (ใช้บนการ์ด)
  summaries() { return supabaseClient.rpc("get_lot_summary"); },
  groupProgress() { return supabaseClient.rpc("get_group_progress"); },

  // ---------- กลุ่มราคาใน Lot ----------
  groupsOfLots(lotIds) { return fetchAllRows(() => supabaseClient.from("lot_groups").select("*").in("lot_id", lotIds).order("sort_order").order("created_at")); },
  groupsOfLot(lotId) { return supabaseClient.from("lot_groups").select("*").eq("lot_id", lotId).order("sort_order").order("created_at"); },
  itemGroupsOfLot(lotId) { return supabaseClient.from("items").select("group_id,status").eq("lot_id", lotId); },
  saveGroup(id, payload) { return id ? supabaseClient.from("lot_groups").update(payload).eq("id", id) : supabaseClient.from("lot_groups").insert(payload); },
  removeGroup(id) { return supabaseClient.from("lot_groups").delete().eq("id", id); },
};
window.LotsRepo = LotsRepo;
