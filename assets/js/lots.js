let editingLotId = null;
let lotsCache = [];
let activeLotId = null;
let activeGroups = [];

const $ = (id) => document.getElementById(id);

function escapeHtml(v = "") {
  return String(v).replace(/[&<>'"]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[c]));
}

function setDefaultPurchaseDate() { $("purchaseDate").valueAsDate = new Date(); }
function updateAvgCost() {
  const cost = Number($("totalCost").value || 0);
  const count = Number($("totalItems").value || 0);
  $("avgCostPreview").textContent = count > 0 ? `ต้นทุนเฉลี่ย: ${formatBaht(cost / count)} / ชิ้น` : "ต้นทุนเฉลี่ย: - / ชิ้น";
}

$("totalCost").addEventListener("input", updateAvgCost);
$("totalItems").addEventListener("input", updateAvgCost);
setDefaultPurchaseDate();

$("lotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = {
    lot_name: $("lotName").value.trim(),
    purchase_date: $("purchaseDate").value,
    source: $("source").value.trim(),
    total_cost: Number($("totalCost").value),
    total_items: Number($("totalItems").value),
    note: $("note").value.trim(),
  };
  if (payload.total_items < 0 || payload.total_cost < 0) return showToast("ต้นทุน/จำนวนไม่ถูกต้อง");

  const query = editingLotId
    ? supabaseClient.from("lots").update(payload).eq("id", editingLotId)
    : supabaseClient.from("lots").insert(payload);
  const { error } = await query;
  if (error) return showToast("บันทึกไม่สำเร็จ: " + error.message);

  showToast(editingLotId ? "แก้ไขล็อตเรียบร้อย" : "สร้างล็อตเรียบร้อย");
  exitEditMode();
  await loadLots();
});

$("cancelLotEdit").addEventListener("click", exitEditMode);
function exitEditMode() {
  editingLotId = null;
  $("lotForm").reset();
  setDefaultPurchaseDate();
  updateAvgCost();
  $("lotFormTitle").textContent = "เพิ่มล็อตใหม่";
  $("lotSubmitBtn").textContent = "บันทึกล๊อต";
  $("cancelLotEdit").classList.add("hidden");
}

function enterEditMode(lot) {
  editingLotId = lot.id;
  $("lotName").value = lot.lot_name || "";
  $("purchaseDate").value = lot.purchase_date || "";
  $("source").value = lot.source || "";
  $("totalCost").value = lot.total_cost ?? 0;
  $("totalItems").value = lot.total_items ?? 0;
  $("note").value = lot.note || "";
  $("lotFormTitle").textContent = "แก้ไขล็อต";
  $("lotSubmitBtn").textContent = "บันทึกการแก้ไข";
  $("cancelLotEdit").classList.remove("hidden");
  updateAvgCost();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// สถานะ Lot: receiving (กำลังรับของ) → sorting (กำลังคัด/ลง) → ready (ลงครบ พร้อมขาย) → closed (ปิดล็อต)
const LOT_STATUS_LABEL = { receiving: "กำลังรับของ", sorting: "กำลังคัด", ready: "พร้อมขาย", closed: "ปิดล็อตแล้ว" };
const LOT_STATUS_NEXT = { receiving: { to: "sorting", label: "เริ่มคัด" }, sorting: { to: "ready", label: "ทำเครื่องหมายพร้อมขาย" }, ready: { to: "closed", label: "ปิดล็อต" } };

async function loadLots() {
  const { data, error } = await supabaseClient.from("lots").select("*").order("purchase_date", { ascending: false });
  if (error) {
    console.error(error);
    $("lotList").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
    return;
  }
  lotsCache = data || [];
  if (!lotsCache.length) {
    $("lotList").innerHTML = `<div class="empty-state">ยังไม่มีล็อต เพิ่มล็อตแรกด้านบนได้เลย</div>`;
    return;
  }
  const lotIds = lotsCache.map(l => l.id);
  // ตัวเลข Reconciliation/กำไรทั้งหมดคำนวณที่ Postgres (get_lot_summary, get_group_progress)
  // เพื่อไม่ให้ตรงกับ Dashboard/Reports คนละค่ากัน และไม่ต้องดึง sales ทั้งตารางมาที่ browser
  const [groupsR, summaryR, groupProgressR] = await Promise.all([
    fetchAllRows(() => supabaseClient.from("lot_groups").select("*").in("lot_id", lotIds).order("sort_order").order("created_at")),
    supabaseClient.rpc("get_lot_summary"),
    supabaseClient.rpc("get_group_progress")
  ]);
  if (groupsR.error) console.warn(groupsR.error);
  if (summaryR.error) console.warn(summaryR.error);
  if (groupProgressR.error) console.warn(groupProgressR.error);

  const groupsByLot = {};
  (groupsR.data || []).forEach(g => (groupsByLot[g.lot_id] ||= []).push(g));
  const summaryByLot = Object.fromEntries((summaryR.data || []).map(s => [s.lot_id, s]));
  const progressByGroup = Object.fromEntries((groupProgressR.data || []).map(g => [g.group_id, g]));

  $("lotList").innerHTML = lotsCache.map(lot => {
    const avg = Number(lot.total_items) > 0 ? Number(lot.total_cost) / Number(lot.total_items) : 0;
    const st = summaryByLot[lot.id] || { received: lot.total_items, listed: 0, sold: 0, rejected: lot.rejected_qty || 0, damaged: lot.damaged_qty || 0, pending: lot.total_items, items_total: 0, revenue: 0, profit: 0, remaining_to_breakeven: lot.total_cost };
    const groups = groupsByLot[lot.id] || [];
    const status = lot.status || "sorting";
    const pendingWarn = st.pending < 0;
    const nextStep = LOT_STATUS_NEXT[status];
    const canAdvance = nextStep && (status !== "sorting" || st.pending <= 0); // ต้องคัดครบก่อนกด "พร้อมขาย"
    const hasHistory = Number(st.items_total) > 0 || Number(st.sold) > 0;
    return `<div class="tag-card lot-card">
      <div class="lot-row">
        <div class="lot-title-block"><div class="lot-name">${escapeHtml(lot.lot_name)} <span class="lot-status-badge lot-status-${status}">${LOT_STATUS_LABEL[status] || status}</span></div><div class="lot-meta">${formatDate(lot.purchase_date)}${lot.source ? " · " + escapeHtml(lot.source) : ""}</div></div>
        <div class="lot-summary"><div class="lot-cost">${formatBaht(lot.total_cost)}</div><div class="lot-meta">${lot.total_items} ชิ้น · เฉลี่ย ${formatBaht(avg)}/ชิ้น</div></div>
      </div>
      <div class="lot-metrics">
        <div><b>${st.received}</b><span>รับเข้า</span></div><div><b>${st.listed}</b><span>ลงแล้ว</span></div><div><b>${st.rejected}</b><span>คัดออก</span></div><div><b>${st.damaged}</b><span>เสีย</span></div>
        <div class="${pendingWarn ? "lot-metric-warn" : ""}"><b>${st.pending}</b><span>รอคัด</span></div><div><b>${st.sold}</b><span>ขายแล้ว</span></div><div><b>${formatBaht(st.profit)}</b><span>กำไรขายแล้ว</span></div><div><b>${formatBaht(st.remaining_to_breakeven)}</b><span>เหลือก่อนคืนทุน</span></div>
      </div>
      ${pendingWarn ? `<p class="lot-warn-text">⚠️ ลงสินค้า (${st.listed}) + คัดออก (${st.rejected}) + เสีย (${st.damaged}) เกินจำนวนรับเข้า (${st.received}) อยู่ ${-st.pending} ชิ้น — ตรวจจำนวนรับเข้าหรือรายการที่ลงซ้ำ</p>` : ""}
      <div class="lot-reject-row">
        <span class="lot-reject-field">คัดออก <button type="button" class="stepper-btn" data-adjust="rejected_qty" data-delta="-1" data-id="${lot.id}">−</button><b>${lot.rejected_qty || 0}</b><button type="button" class="stepper-btn" data-adjust="rejected_qty" data-delta="1" data-id="${lot.id}">+</button></span>
        <span class="lot-reject-field">เสีย (ยังไม่ลง) <button type="button" class="stepper-btn" data-adjust="damaged_qty" data-delta="-1" data-id="${lot.id}">−</button><b>${lot.damaged_qty || 0}</b><button type="button" class="stepper-btn" data-adjust="damaged_qty" data-delta="1" data-id="${lot.id}">+</button></span>
      </div>
      <div class="group-preview"><div class="group-preview-head"><b>กลุ่มคัด ${groups.length ? `(${groups.length})` : ""}</b><button class="btn btn-primary btn-sm" data-action="groups" data-id="${lot.id}">จัดกลุ่ม / แก้ไข</button></div>
        ${groups.length ? `<div class="group-chip-list">${groups.map(g => { const p = progressByGroup[g.id]; const targetText = g.target_qty ? ` · ${p ? p.listed : 0}/${g.target_qty}` : ""; return `<span class="group-chip"><b>${escapeHtml(g.group_name)}</b><small>${g.tier === "head" ? "งานหัว" : "ปกติ"} · ${formatBaht(g.base_price)}${targetText}</small></span>`; }).join("")}</div>` : `<div class="empty-inline">ยังไม่มีกลุ่ม — กด “จัดกลุ่ม / แก้ไข” เพื่อสร้างกลุ่มเฉพาะ Lot นี้</div>`}
      </div>
      ${lot.note ? `<div class="lot-note">${escapeHtml(lot.note)}</div>` : ""}
      <div class="item-actions">
        <a class="btn btn-ghost btn-sm" href="items.html?lot=${encodeURIComponent(lot.id)}">ดูสินค้าใน Lot</a>
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${lot.id}">แก้ไข Lot</button>
        ${nextStep ? `<button class="btn btn-primary btn-sm" data-action="advance" data-id="${lot.id}" ${canAdvance ? "" : `disabled title="คัดให้ครบก่อน (รอคัด ต้องเป็น 0)"`}>${nextStep.label}</button>` : ""}
        ${status === "closed" ? `<button class="btn btn-ghost btn-sm" data-action="reopen" data-id="${lot.id}">เปิดล็อตใหม่</button>` : ""}
        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${lot.id}">${hasHistory ? "ปิด/ซ่อน Lot" : "ลบ Lot"}</button>
      </div>
    </div>`;
  }).join("");

  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener("click", () => {
    const lot = lotsCache.find(l => l.id === btn.dataset.id); if (lot) enterEditMode(lot);
  }));
  document.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener("click", () => handleDelete(btn.dataset.id, summaryByLot[btn.dataset.id])));
  document.querySelectorAll('[data-action="groups"]').forEach(btn => btn.addEventListener("click", () => openGroupManager(btn.dataset.id)));
  document.querySelectorAll('[data-action="advance"]').forEach(btn => btn.addEventListener("click", () => advanceLotStatus(btn.dataset.id)));
  document.querySelectorAll('[data-action="reopen"]').forEach(btn => btn.addEventListener("click", () => reopenLot(btn.dataset.id)));
  document.querySelectorAll("[data-adjust]").forEach(btn => btn.addEventListener("click", () => adjustLotCounter(btn.dataset.id, btn.dataset.adjust, Number(btn.dataset.delta))));
}

// เปลี่ยนสถานะ Lot ไปขั้นถัดไป (receiving→sorting→ready→closed); ปิดล็อตจะบันทึก closed_at ด้วย
async function advanceLotStatus(lotId) {
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  const next = LOT_STATUS_NEXT[lot.status || "sorting"]; if (!next) return;
  const payload = { status: next.to };
  if (next.to === "closed") payload.closed_at = new Date().toISOString();
  const { error } = await supabaseClient.from("lots").update(payload).eq("id", lotId);
  if (error) return showToast("เปลี่ยนสถานะไม่สำเร็จ: " + error.message);
  showToast(`สถานะ Lot: ${LOT_STATUS_LABEL[next.to]}`);
  loadLots();
}

async function reopenLot(lotId) {
  const { error } = await supabaseClient.from("lots").update({ status: "ready", closed_at: null }).eq("id", lotId);
  if (error) return showToast("เปิดล็อตใหม่ไม่สำเร็จ: " + error.message);
  showToast("เปิดล็อตใหม่แล้ว");
  loadLots();
}

// ปรับตัวนับ "คัดออก/เสีย" ทีละ 1 — ของกลุ่มนี้ไม่มีแถวใน items จึงเก็บเป็นตัวนับที่ Lot โดยตรง
async function adjustLotCounter(lotId, field, delta) {
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  const next = Math.max(0, Number(lot[field] || 0) + delta);
  const { error } = await supabaseClient.from("lots").update({ [field]: next }).eq("id", lotId);
  if (error) return showToast("อัปเดตไม่สำเร็จ: " + error.message);
  loadLots();
}

// ลบได้จริงเฉพาะ Lot ที่ยังว่างเปล่า (ไม่เคยมีสินค้า/ขาย) กันประวัติหลุดจาก Lot performance และ Reports
// ถ้ามีประวัติแล้ว ให้ "ปิดล็อต" แทน เพื่อให้ยอดขายเก่ายังผูกกับ Lot นี้อยู่
async function handleDelete(lotId, summary) {
  const lot = lotsCache.find(l => l.id === lotId);
  if (!lot) return;
  const hasHistory = Number(summary?.items_total || 0) > 0 || Number(summary?.sold || 0) > 0;
  if (hasHistory) {
    const ok = confirm(`ล็อต “${lot.lot_name}” มีสินค้า/ยอดขายอยู่แล้ว จึงลบไม่ได้ (ประวัติจะหลุดจาก Lot performance และ Reports)\n\nกด OK เพื่อ "ปิดล็อต" แทน — Lot จะยังอยู่ในรายงาน แต่จะไม่แสดงเป็น Lot ที่ทำงานอยู่`);
    if (!ok) return;
    return advanceStatusDirect(lotId, "closed");
  }
  const ok = confirm(`ลบล็อต “${lot.lot_name}” ใช่ไหม?\n\nLot นี้ยังไม่มีสินค้าหรือยอดขาย ลบได้ปลอดภัย กลุ่มของล็อตจะถูกลบไปด้วย`);
  if (!ok) return;
  const { error } = await supabaseClient.from("lots").delete().eq("id", lotId);
  if (error) return showToast("ลบไม่สำเร็จ: " + error.message);
  showToast("ลบล็อตเรียบร้อย");
  if (editingLotId === lotId) exitEditMode();
  loadLots();
}

async function advanceStatusDirect(lotId, status) {
  const payload = { status };
  if (status === "closed") payload.closed_at = new Date().toISOString();
  const { error } = await supabaseClient.from("lots").update(payload).eq("id", lotId);
  if (error) return showToast("ปิดล็อตไม่สำเร็จ: " + error.message);
  showToast("ปิดล็อตแล้ว");
  loadLots();
}

async function openGroupManager(lotId) {
  activeLotId = lotId;
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  $("groupModalTitle").textContent = `กลุ่มคัด: ${lot.lot_name}`;
  $("groupModalMeta").textContent = `${lot.total_items} ชิ้น · ต้นทุนเฉลี่ย ${formatBaht(Number(lot.total_items) ? Number(lot.total_cost) / Number(lot.total_items) : 0)} / ชิ้น`;
  $("groupModal").classList.remove("hidden");
  $("groupModal").setAttribute("aria-hidden", "false");
  resetGroupForm();
  await loadGroupsForLot();
}

async function loadGroupsForLot() {
  if (!activeLotId) return;
  const { data, error } = await supabaseClient.from("lot_groups").select("*").eq("lot_id", activeLotId).order("sort_order").order("created_at");
  if (error) return showToast("โหลดกลุ่มไม่สำเร็จ: " + error.message);
  activeGroups = data || [];
  const { data: items, error: itemErr } = await supabaseClient.from("items").select("group_id,status").eq("lot_id", activeLotId);
  if (itemErr) console.warn(itemErr);
  const countByGroup = {};
  (items || []).forEach(i => { if (i.group_id) countByGroup[i.group_id] = (countByGroup[i.group_id] || 0) + 1; });
  $("groupSummary").innerHTML = activeGroups.length ? `<span>${activeGroups.length} กลุ่ม</span><span>${Object.values(countByGroup).reduce((a,b)=>a+b,0)} รายการถูกผูกกลุ่มแล้ว</span>` : `<span>ยังไม่มีกลุ่ม</span><span>สร้างกลุ่มเพื่อเริ่มคัดสินค้า</span>`;
  $("groupList").innerHTML = activeGroups.length ? activeGroups.map(g => `<div class="group-manage-row"><div><b>${escapeHtml(g.group_name)}</b><span>${g.tier === "head" ? "งานหัว / Premium" : "ปกติ"} · ราคาตั้งต้น ${formatBaht(g.base_price)} · ${countByGroup[g.id] || 0}${g.target_qty ? `/${g.target_qty}` : ""} รายการ</span></div><div class="group-row-actions"><button class="btn btn-ghost btn-sm" data-group-edit="${g.id}">แก้ไข</button><button class="btn btn-danger btn-sm" data-group-delete="${g.id}" ${countByGroup[g.id] ? "disabled title=\"กลุ่มนี้มีสินค้าอยู่\"" : ""}>ลบ</button></div></div>`).join("") : `<div class="empty-state">ยังไม่มีกลุ่ม</div>`;
  document.querySelectorAll("[data-group-edit]").forEach(btn => btn.addEventListener("click", () => editGroup(btn.dataset.groupEdit)));
  document.querySelectorAll("[data-group-delete]").forEach(btn => btn.addEventListener("click", () => deleteGroup(btn.dataset.groupDelete)));
}

function resetGroupForm() {
  $("groupId").value = ""; $("groupName").value = ""; $("groupBasePrice").value = ""; $("groupTier").value = "normal"; if ($("groupTargetQty")) $("groupTargetQty").value = "";
  $("groupSubmitBtn").textContent = "เพิ่มกลุ่ม"; $("cancelGroupEdit").classList.add("hidden");
}
function editGroup(id) {
  const g = activeGroups.find(x => x.id === id); if (!g) return;
  $("groupId").value = g.id; $("groupName").value = g.group_name; $("groupBasePrice").value = g.base_price; $("groupTier").value = g.tier;
  if ($("groupTargetQty")) $("groupTargetQty").value = g.target_qty ?? "";
  $("groupSubmitBtn").textContent = "บันทึกกลุ่ม"; $("cancelGroupEdit").classList.remove("hidden"); $("groupName").focus();
}
$("cancelGroupEdit").addEventListener("click", resetGroupForm);
$("groupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const id = $("groupId").value;
  // ไม่ให้ผู้ใช้กรอกลำดับเอง: กลุ่มใหม่ต่อท้ายอัตโนมัติ, กลุ่มที่แก้ไขคงลำดับเดิมไว้
  const existing = id ? activeGroups.find(x => x.id === id) : null;
  const nextOrder = activeGroups.length ? Math.max(...activeGroups.map(g => Number(g.sort_order) || 0)) + 1 : 0;
  const sortOrder = existing ? Number(existing.sort_order) || 0 : nextOrder;
  const targetRaw = $("groupTargetQty")?.value;
  const payload = { lot_id: activeLotId, group_name: $("groupName").value.trim(), base_price: Number($("groupBasePrice").value || 0), tier: $("groupTier").value, sort_order: sortOrder, target_qty: targetRaw ? Number(targetRaw) : null };
  if (!payload.group_name) return showToast("กรุณาใส่ชื่อกลุ่ม");
  const { error } = id ? await supabaseClient.from("lot_groups").update(payload).eq("id", id) : await supabaseClient.from("lot_groups").insert(payload);
  if (error) return showToast("บันทึกกลุ่มไม่สำเร็จ: " + error.message);
  showToast(id ? "แก้ไขกลุ่มแล้ว" : "เพิ่มกลุ่มแล้ว");
  resetGroupForm(); await loadGroupsForLot(); await loadLots();
});
async function deleteGroup(id) {
  const g = activeGroups.find(x => x.id === id); if (!g) return;
  if (!confirm(`ลบกลุ่ม “${g.group_name}” ใช่ไหม?`)) return;
  const { error } = await supabaseClient.from("lot_groups").delete().eq("id", id);
  if (error) return showToast("ลบกลุ่มไม่สำเร็จ: " + error.message);
  showToast("ลบกลุ่มแล้ว"); await loadGroupsForLot(); await loadLots();
}
function closeGroupModal() { $("groupModal").classList.add("hidden"); $("groupModal").setAttribute("aria-hidden", "true"); activeLotId = null; activeGroups = []; }
document.querySelectorAll("[data-close-group]").forEach(el => el.addEventListener("click", closeGroupModal));
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("groupModal").classList.contains("hidden")) closeGroupModal(); });

function showToast(msg) { const t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("show"); clearTimeout(window.__toast); window.__toast = setTimeout(() => t.classList.remove("show"), 2600); }

loadLots();

// Realtime: Lot/Group ที่เพิ่มจากอีก Device จะปรากฏในหน้าปัจจุบันโดยไม่ต้อง Refresh
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['lots', 'lot_groups'].includes(table)) loadLots();
});
