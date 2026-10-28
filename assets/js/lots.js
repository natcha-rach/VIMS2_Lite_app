/* ==========================================================
   lots.js — ชั้น UI ของหน้าล็อต (lots.html): ฟอร์ม Lot + ต้นทุนแยกส่วน, การ์ด Lot, ปิด/เปิด Lot,
             คิดต้นทุนใหม่, จัดการกลุ่มราคา
   เรียกต่อ:
     Data   LotsRepo  ← lots / lot_groups / items · RPC get_lot_summary, get_group_progress, recost_lot (data/lotsRepo.js)
     Domain LotCalc   ← ต้นทุนรวม/เฉลี่ย, นับชิ้นต่อกลุ่ม                                          (domain/lotCalc.js)
     VimsContext      ← ปุ่ม "ดูสินค้าใน Lot" พา Lot ไปหน้าสินค้า (vimsContext.js)
   ========================================================== */
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

// ถ้ากรอก "ค่าซื้อ" ในส่วนแยกต้นทุนไว้ ให้ต้นทุนรวมคำนวณจากผลรวมอัตโนมัติ (เขียนทับช่องต้นทุนรวม)
// สอดคล้องกับ trigger compute_lot_total_cost() ฝั่ง Postgres — ทำที่ browser ด้วยเพื่อ preview ทันทีก่อนกดบันทึก
function costBreakdownActive() { return $("costPurchase").value !== ""; }
function syncCostBreakdown() {
  if (!costBreakdownActive()) { updateAvgCost(); return; }
  const sum = LotCalc.totalCost(["costPurchase", "costShipping", "costCleaning", "costRepair", "costOther"].map((id) => $(id).value));
  $("totalCost").value = sum;
  $("totalCost").readOnly = true;
  updateAvgCost();
}
function updateAvgCost() {
  const avg = LotCalc.avgCost($("totalCost").value, $("totalItems").value);
  $("avgCostPreview").textContent = avg !== null ? `ต้นทุนเฉลี่ย: ${formatBaht(avg)} / ชิ้น` : "ต้นทุนเฉลี่ย: - / ชิ้น";
}

$("totalCost").addEventListener("input", updateAvgCost);
$("totalItems").addEventListener("input", updateAvgCost);
["costPurchase", "costShipping", "costCleaning", "costRepair", "costOther"].forEach(id => $(id).addEventListener("input", syncCostBreakdown));
setDefaultPurchaseDate();

$("lotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const useBreakdown = costBreakdownActive();
  const payload = {
    lot_name: $("lotName").value.trim(),
    purchase_date: $("purchaseDate").value,
    source: $("source").value.trim(),
    total_cost: Number($("totalCost").value),
    total_items: Number($("totalItems").value),
    note: $("note").value.trim(),
    lot_code: $("lotCode").value.trim() || null,
    // ต้นทุนแยกส่วน (V16) — purchase_cost=null คือยังใช้ต้นทุนรวมแบบเดิม ไม่ส่ง breakdown เลย
    purchase_cost: useBreakdown ? Number($("costPurchase").value || 0) : null,
    shipping_cost: Number($("costShipping").value || 0),
    cleaning_cost: Number($("costCleaning").value || 0),
    repair_cost: Number($("costRepair").value || 0),
    other_cost: Number($("costOther").value || 0),
    cost_basis: $("costBasis").value,
  };
  if (payload.total_items < 0 || payload.total_cost < 0) return showToast("ต้นทุน/จำนวนไม่ถูกต้อง");

  const query = editingLotId
    ? LotsRepo.save(editingLotId, payload)
    : LotsRepo.save(null, payload);
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
  $("totalCost").readOnly = false;
  setDefaultPurchaseDate();
  updateAvgCost();
  $("lotFormTitle").textContent = "เพิ่มล็อตใหม่";
  $("lotFormBox").open = false;
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
  $("lotCode").value = lot.lot_code || "";
  $("costPurchase").value = lot.purchase_cost ?? "";
  $("costShipping").value = lot.shipping_cost ?? 0;
  $("costCleaning").value = lot.cleaning_cost ?? 0;
  $("costRepair").value = lot.repair_cost ?? 0;
  $("costOther").value = lot.other_cost ?? 0;
  $("costBasis").value = lot.cost_basis || "received";
  $("totalCost").readOnly = lot.purchase_cost != null;
  $("lotFormTitle").textContent = "แก้ไขล็อต";
  $("lotSubmitBtn").textContent = "บันทึกการแก้ไข";
  $("cancelLotEdit").classList.remove("hidden");
  updateAvgCost();
  $("lotFormBox").open = true;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// สถานะ Lot: receiving (กำลังรับของ) → sorting (กำลังคัด/ลง) → ready (ลงครบ พร้อมขาย) → closed (ปิดล็อต)
const LOT_STATUS_LABEL = { receiving: "กำลังรับของ", sorting: "กำลังคัด", ready: "พร้อมขาย", closed: "ปิดล็อตแล้ว" };
// V21: ชิปกรองสถานะ — ค่าเริ่มต้น "กำลังทำ" (ยังไม่ปิด) Lot ที่ปิดแล้วไม่ต้องเลื่อนผ่านทุกครั้ง
const LOT_FILTERS = {
  active: { label: "กำลังทำ", keep: (l) => (l.status || "sorting") !== "closed" },
  closed: { label: "ปิดแล้ว", keep: (l) => l.status === "closed" },
  all: { label: "ทั้งหมด", keep: () => true },
};
let lotFilter = "active";
const LOT_STATUS_NEXT = { receiving: { to: "sorting", label: "เริ่มคัด" }, sorting: { to: "ready", label: "ทำเครื่องหมายพร้อมขาย" }, ready: { to: "closed", label: "ปิดล็อต" } };

async function loadLots() {
  const { data, error } = await LotsRepo.list();
  if (error) {
    console.error(error);
    Notify.error("โหลดรายการล็อตไม่สำเร็จ", error, { actions: [{ label: "ลองใหม่", onClick: () => loadLots() }] });
    $("lotList").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
    return;
  }
  lotsCache = data || [];
  // เติม datalist จากแหล่งที่มาเดิมที่เคยพิมพ์ไว้ กันสะกดต่างกันจนรายงาน "คุณภาพแหล่งรับของ" แยกกลุ่มผิด
  const sources = [...new Set(lotsCache.map(l => l.source).filter(Boolean))].sort();
  const sourceList = $("sourceList");
  if (sourceList) sourceList.innerHTML = sources.map(s => `<option value="${escapeHtml(s)}"></option>`).join("");
  if (!lotsCache.length) {
    $("lotList").innerHTML = `<div class="empty-state">ยังไม่มีล็อต เพิ่มล็อตแรกด้านบนได้เลย</div>`;
    $("lotFormBox").open = true;
    return;
  }
  const lotIds = lotsCache.map(l => l.id);
  // ตัวเลข Reconciliation/กำไรทั้งหมดคำนวณที่ Postgres (get_lot_summary, get_group_progress)
  // เพื่อไม่ให้ตรงกับ Dashboard/Reports คนละค่ากัน และไม่ต้องดึง sales ทั้งตารางมาที่ browser
  const [groupsR, summaryR, groupProgressR] = await Promise.all([
    LotsRepo.groupsOfLots(lotIds),
    LotsRepo.summaries(),
    LotsRepo.groupProgress()
  ]);
  if (groupsR.error) console.warn(groupsR.error);
  if (summaryR.error) console.warn(summaryR.error);
  if (groupProgressR.error) console.warn(groupProgressR.error);

  const groupsByLot = {};
  (groupsR.data || []).forEach(g => (groupsByLot[g.lot_id] ||= []).push(g));
  const summaryByLot = Object.fromEntries((summaryR.data || []).map(s => [s.lot_id, s]));
  const progressByGroup = Object.fromEntries((groupProgressR.data || []).map(g => [g.group_id, g]));

  const count = (f) => lotsCache.filter(LOT_FILTERS[f].keep).length;
  $("lotFilter").innerHTML = Object.entries(LOT_FILTERS).map(([k, f]) => `<button type="button" class="pos-chip${lotFilter === k ? " active" : ""}" data-lot-filter="${k}" aria-pressed="${lotFilter === k}">${f.label} ${count(k)}</button>`).join("");
  $("lotFilter").querySelectorAll("[data-lot-filter]").forEach(b => b.addEventListener("click", () => { lotFilter = b.dataset.lotFilter; loadLots(); }));
  const shown = lotsCache.filter(LOT_FILTERS[lotFilter].keep);
  if (!shown.length) { $("lotList").innerHTML = `<div class="empty-state">ไม่มีล็อตในกลุ่มนี้</div>`; return; }

  const v = (x) => (x ?? "–"); // ข้อมูลว่าง → "–" ไม่ใช่ undefined
  $("lotList").innerHTML = shown.map(lot => {
    const avg = Number(lot.total_items) > 0 ? Number(lot.total_cost) / Number(lot.total_items) : 0;
    const st = summaryByLot[lot.id] || { received: lot.total_items, listed: 0, available: 0, sold: 0, rejected: lot.rejected_qty || 0, damaged: lot.damaged_qty || 0, pending: lot.total_items, items_total: 0, revenue: 0, profit: 0, remaining_to_breakeven: lot.total_cost };
    const groups = groupsByLot[lot.id] || [];
    const status = lot.status || "sorting";
    const pendingWarn = st.pending < 0;
    const nextStep = LOT_STATUS_NEXT[status];
    const canAdvance = nextStep && (status !== "sorting" || st.pending <= 0); // ต้องคัดครบก่อนกด "พร้อมขาย"
    const hasHistory = Number(st.items_total) > 0 || Number(st.sold) > 0;
    const cost = Number(lot.total_cost) || 0;
    const recoverPct = cost > 0 ? Math.min(100, Math.max(0, (cost - Number(st.remaining_to_breakeven || 0)) / cost * 100)) : 0;
    const continueUrl = (() => {
      // "ทำต่อ" พาไปกลุ่มแรกที่ยังไม่ครบเป้า (ถ้ามีกำหนดเป้าไว้) — ถ้าไม่มีกลุ่มไหนตั้งเป้า ให้พาไปหน้า Items ของ Lot เฉยๆ
      if (status === "closed" || !window.VimsContext) return "";
      const openGroup = groups.find(g => g.target_qty && (progressByGroup[g.id]?.listed || 0) < g.target_qty);
      return openGroup ? VimsContext.itemsUrl({ lotId: lot.id, groupId: openGroup.id, mode: "rapid" }) : VimsContext.itemsUrl({ lotId: lot.id, mode: "bulk" });
    })();
    const itemsUrl = window.VimsContext ? VimsContext.itemsUrl({ lotId: lot.id }) : `items.html?lot=${encodeURIComponent(lot.id)}`;
    // V21: การ์ดย่อ — ข้อมูลที่ดูบ่อยอยู่บน · ตัวเลขละเอียด/ปุ่มคัด/กลุ่ม/คำสั่งอื่นพับไว้ใน "รายละเอียด & จัดการ"
    return `<div class="tag-card lot-card">
      <div class="lot-row">
        <div class="lot-title-block"><div class="lot-name">${escapeHtml(lot.lot_name)} <span class="lot-status-badge lot-status-${status}">${LOT_STATUS_LABEL[status] || status}</span></div><div class="lot-meta">ทุน ${formatBaht(cost)} · ลงแล้ว ${v(st.listed)}/${v(st.received)} ชิ้น · ${lot.purchase_date ? formatDate(lot.purchase_date) : "ไม่ระบุวันที่"}${lot.source ? " · " + escapeHtml(lot.source) : ""}</div></div>
      </div>
      <div class="lot-recover" role="progressbar" aria-label="คืนทุน" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(recoverPct)}"><div style="width:${recoverPct.toFixed(1)}%"></div></div>
      <div class="lot-meta">คืนทุน ${recoverPct.toFixed(0)}%${Number(st.remaining_to_breakeven) > 0 ? ` · อีก ${formatBaht(st.remaining_to_breakeven)}` : " · คืนทุนแล้ว"} · ขายแล้ว ${v(st.sold)} ชิ้น</div>
      ${pendingWarn ? `<p class="lot-warn-text">⚠️ ลงสินค้า (${st.listed}) + คัดออก (${st.rejected}) + เสีย (${st.damaged}) เกินจำนวนรับเข้า (${st.received}) อยู่ ${-st.pending} ชิ้น — ตรวจจำนวนรับเข้าหรือรายการที่ลงซ้ำ</p>` : ""}
      <div class="item-actions lot-main-actions">
        ${continueUrl ? `<a class="btn btn-primary btn-sm" href="${continueUrl}">ทำต่อ${Number(st.pending) > 0 ? ` (รอคัด ${st.pending})` : ""}</a>` : ""}
        <a class="btn btn-ghost btn-sm" href="${itemsUrl}">ดูสินค้า</a>
      </div>
      <details class="lot-more">
        <summary>รายละเอียด &amp; จัดการ</summary>
        <div class="lot-metrics">
          <div><b>${v(st.received)}</b><span>รับเข้า</span></div><div><b>${v(st.listed)}</b><span>ลงแล้ว</span></div><div><b>${v(st.rejected)}</b><span>คัดออก</span></div><div><b>${v(st.damaged)}</b><span>เสีย</span></div>
          <div class="${pendingWarn ? "lot-metric-warn" : ""}"><b>${v(st.pending)}</b><span>รอคัด</span></div><div><b>${v(st.sold)}</b><span>ขายแล้ว</span></div><div><b>${formatBaht(st.profit)}</b><span>กำไรขายแล้ว</span></div><div><b>${formatBaht(avg)}</b><span>ทุนเฉลี่ย/ชิ้น</span></div>
        </div>
        <div class="lot-reject-row">
          <span class="lot-reject-field">คัดออก <button type="button" class="stepper-btn" data-adjust="rejected_qty" data-delta="-1" data-id="${lot.id}" aria-label="คัดออก ลด 1">−</button><b>${lot.rejected_qty || 0}</b><button type="button" class="stepper-btn" data-adjust="rejected_qty" data-delta="1" data-id="${lot.id}" aria-label="คัดออก เพิ่ม 1">+</button></span>
          <span class="lot-reject-field">เสีย (ยังไม่ลง) <button type="button" class="stepper-btn" data-adjust="damaged_qty" data-delta="-1" data-id="${lot.id}" aria-label="เสีย ลด 1">−</button><b>${lot.damaged_qty || 0}</b><button type="button" class="stepper-btn" data-adjust="damaged_qty" data-delta="1" data-id="${lot.id}" aria-label="เสีย เพิ่ม 1">+</button></span>
        </div>
        <div class="group-preview"><div class="group-preview-head"><b>กลุ่มคัด ${groups.length ? `(${groups.length})` : ""}</b><button class="btn btn-primary btn-sm" data-action="groups" data-id="${lot.id}">จัดกลุ่ม / แก้ไข</button></div>
          ${groups.length ? `<div class="group-chip-list">${groups.map(g => { const p = progressByGroup[g.id]; const targetText = g.target_qty ? ` · ${p ? p.listed : 0}/${g.target_qty}` : ""; return `<span class="group-chip"><b>${escapeHtml(g.group_name)}</b><small>${g.tier === "head" ? "งานหัว" : "ปกติ"} · ${formatBaht(g.base_price)}${targetText}</small></span>`; }).join("")}</div>` : `<div class="empty-inline">ยังไม่มีกลุ่ม — กด “จัดกลุ่ม / แก้ไข” เพื่อสร้างกลุ่มเฉพาะ Lot นี้</div>`}
        </div>
        ${lot.note ? `<div class="lot-note">${escapeHtml(lot.note)}</div>` : ""}
        <div class="item-actions">
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${lot.id}">แก้ไข Lot</button>
          ${st.available > 0 ? `<button class="btn btn-ghost btn-sm" data-action="recost" data-id="${lot.id}">คำนวณต้นทุนคงเหลือใหม่</button>` : ""}
          ${nextStep ? `<button class="btn btn-ghost btn-sm" data-action="advance" data-id="${lot.id}" ${canAdvance ? "" : `disabled title="คัดให้ครบก่อน (รอคัด ต้องเป็น 0)"`}>${nextStep.label}</button>` : ""}
          ${status === "closed" ? `<button class="btn btn-ghost btn-sm" data-action="reopen" data-id="${lot.id}">เปิดล็อตใหม่</button>` : ""}
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${lot.id}">${hasHistory ? "ปิด/ซ่อน Lot" : "ลบ Lot"}</button>
        </div>
      </details>
    </div>`;
  }).join("");

  document.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener("click", () => {
    const lot = lotsCache.find(l => l.id === btn.dataset.id); if (lot) enterEditMode(lot);
  }));
  document.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener("click", () => handleDelete(btn.dataset.id, summaryByLot[btn.dataset.id])));
  document.querySelectorAll('[data-action="groups"]').forEach(btn => btn.addEventListener("click", () => openGroupManager(btn.dataset.id)));
  document.querySelectorAll('[data-action="advance"]').forEach(btn => btn.addEventListener("click", () => advanceLotStatus(btn.dataset.id)));
  document.querySelectorAll('[data-action="recost"]').forEach(btn => btn.addEventListener("click", () => recostLot(btn.dataset.id, summaryByLot[btn.dataset.id])));
  document.querySelectorAll('[data-action="reopen"]').forEach(btn => btn.addEventListener("click", () => reopenLot(btn.dataset.id)));
  document.querySelectorAll("[data-adjust]").forEach(btn => btn.addEventListener("click", () => adjustLotCounter(btn.dataset.id, btn.dataset.adjust, Number(btn.dataset.delta))));
}

// เปลี่ยนสถานะ Lot ไปขั้นถัดไป (receiving→sorting→ready→closed); ปิดล็อตจะบันทึก closed_at ด้วย
async function advanceLotStatus(lotId) {
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  const next = LOT_STATUS_NEXT[lot.status || "sorting"]; if (!next) return;
  const payload = { status: next.to };
  if (next.to === "closed") payload.closed_at = new Date().toISOString();
  const { error } = await LotsRepo.update(lotId, payload);
  if (error) return showToast("เปลี่ยนสถานะไม่สำเร็จ: " + error.message);
  showToast(`สถานะ Lot: ${LOT_STATUS_LABEL[next.to]}`);
  loadLots();
}

async function reopenLot(lotId) {
  const { error } = await LotsRepo.update(lotId, { status: "ready", closed_at: null });
  if (error) return showToast("เปิดล็อตใหม่ไม่สำเร็จ: " + error.message);
  showToast("เปิดล็อตใหม่แล้ว");
  loadLots();
}

// คำนวณต้นทุนเฉลี่ย/ชิ้นใหม่จากต้นทุนรวม Lot — แตะเฉพาะสินค้า "พร้อมขาย" เท่านั้น
// ของที่ขายแล้วคง cost_price เดิมไว้เป็น snapshot ต้นทุน ณ วันขาย (ดู recost_lot ใน migration_v16)
async function recostLot(lotId, summary) {
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  const basisLabel = { received: "จำนวนที่รับเข้าทั้งหมด", sellable: "จำนวนที่ผ่านคัดและลงขาย" };
  const currentBasis = lot.cost_basis || "received";
  const ok = await Notify.confirm({ title: `คำนวณต้นทุนเฉลี่ยใหม่ของ "${lot.lot_name}"?`, confirmText: "คำนวณใหม่", message: `ฐานคำนวณ: ${basisLabel[currentBasis]}\nจะอัปเดตเฉพาะสินค้าที่ยัง "พร้อมขาย" (${summary?.available ?? "-"} ชิ้น) ของที่ขายไปแล้วจะไม่ถูกแก้ย้อนหลัง\n\nเปลี่ยนฐานคำนวณได้ที่ "แก้ไข Lot"` });
  if (!ok) return;
  const { data, error } = await LotsRepo.recost(lotId, currentBasis);
  if (error) return showToast("คำนวณไม่สำเร็จ: " + error.message);
  showToast(`ต้นทุนเฉลี่ยใหม่ ${formatBaht(data.avg_cost)}/ชิ้น (${data.items_updated} รายการ)`);
  loadLots();
}

// ปรับตัวนับ "คัดออก/เสีย" ทีละ 1 — ของกลุ่มนี้ไม่มีแถวใน items จึงเก็บเป็นตัวนับที่ Lot โดยตรง
async function adjustLotCounter(lotId, field, delta) {
  const lot = lotsCache.find(l => l.id === lotId); if (!lot) return;
  const next = Math.max(0, Number(lot[field] || 0) + delta);
  const { error } = await LotsRepo.update(lotId, { [field]: next });
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
    const ok = await Notify.confirm({ title: `ลบ “${lot.lot_name}” ไม่ได้`, confirmText: "ปิดล็อตแทน", message: `ล็อตนี้มีสินค้า/ยอดขายแล้ว ถ้าลบ ประวัติจะหลุดจาก Lot performance และรายงาน\n\nกด "ปิดล็อตแทน" — Lot จะยังอยู่ในรายงาน แต่จะไม่แสดงเป็น Lot ที่ทำงานอยู่` });
    if (!ok) return;
    return advanceStatusDirect(lotId, "closed");
  }
  const ok = await Notify.confirm({ title: `ลบล็อต “${lot.lot_name}”?`, confirmText: "ลบล็อต", danger: true, message: `Lot นี้ยังไม่มีสินค้าหรือยอดขาย ลบได้ปลอดภัย กลุ่มของล็อตจะถูกลบไปด้วย` });
  if (!ok) return;
  const { error } = await LotsRepo.remove(lotId);
  if (error) return showToast("ลบไม่สำเร็จ: " + error.message);
  showToast("ลบล็อตเรียบร้อย");
  if (editingLotId === lotId) exitEditMode();
  loadLots();
}

async function advanceStatusDirect(lotId, status) {
  const payload = { status };
  if (status === "closed") payload.closed_at = new Date().toISOString();
  const { error } = await LotsRepo.update(lotId, payload);
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
  const { data, error } = await LotsRepo.groupsOfLot(activeLotId);
  if (error) return showToast("โหลดกลุ่มไม่สำเร็จ: " + error.message);
  activeGroups = data || [];
  const { data: items, error: itemErr } = await LotsRepo.itemGroupsOfLot(activeLotId);
  if (itemErr) console.warn(itemErr);
  const countByGroup = LotCalc.countByGroup(items || []);
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
  const { error } = await LotsRepo.saveGroup(id, payload);
  if (error) return showToast("บันทึกกลุ่มไม่สำเร็จ: " + error.message);
  showToast(id ? "แก้ไขกลุ่มแล้ว" : "เพิ่มกลุ่มแล้ว");
  resetGroupForm(); await loadGroupsForLot(); await loadLots();
});
async function deleteGroup(id) {
  const g = activeGroups.find(x => x.id === id); if (!g) return;
  if (!(await Notify.confirm({ title: `ลบกลุ่ม “${g.group_name}”?`, message: "สินค้าในกลุ่มนี้จะไม่ถูกลบ แต่จะไม่มีกลุ่มราคา", confirmText: "ลบกลุ่ม", danger: true }))) return;
  const { error } = await LotsRepo.removeGroup(id);
  if (error) return showToast("ลบกลุ่มไม่สำเร็จ: " + error.message);
  showToast("ลบกลุ่มแล้ว"); await loadGroupsForLot(); await loadLots();
}
function closeGroupModal() { $("groupModal").classList.add("hidden"); $("groupModal").setAttribute("aria-hidden", "true"); activeLotId = null; activeGroups = []; }
document.querySelectorAll("[data-close-group]").forEach(el => el.addEventListener("click", closeGroupModal));
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("groupModal").classList.contains("hidden")) closeGroupModal(); });

// V19.1: แจ้งเตือนทั้งหมดไปที่ระบบกลาง notify.js (แยกสำเร็จ/ผิดพลาด/เตือน + รายละเอียด + วิธีแก้)
function showToast(msg) { return window.Notify ? Notify.auto(msg) : console.log(msg); }

loadLots();

// Realtime: Lot/Group ที่เพิ่มจากอีก Device จะปรากฏในหน้าปัจจุบันโดยไม่ต้อง Refresh
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['lots', 'lot_groups'].includes(table)) loadLots();
});
