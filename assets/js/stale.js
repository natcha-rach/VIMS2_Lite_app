/* ==========================================================
   stale.js — การ์ด "ของค้าง" บนหน้าสินค้า (items.html) V20
   ของพร้อมขายที่ลงไว้นานเกิน N วัน → เลือกหลายชิ้น → ลด % หรือตั้งราคาใหม่ทีเดียว
   เชื่อมต่อ:
     Data ItemsRepo.staleSince / ItemsRepo.markdown (RPC markdown_items · sql/migration_v21_*.sql)
       (atomic + เก็บประวัติราคาใน item_change_history แบบเดียวกับหน้าแก้สินค้า)
     items.js → หลังลดราคาเรียก loadItems() ให้ตารางสต็อกอัปเดต
   แยกไฟล์จาก items.js (90KB) เพื่อไม่ให้ไปแตะโค้ดลงของ/Bulk ที่ซับซ้อน
   ========================================================== */
(function () {
  const card = document.getElementById("staleCard");
  if (!card || !window.ItemsRepo || !window.Money) return;
  const S = Money.toSatang;
  const thb = (satang) => "฿" + Money.toBaht(satang).toLocaleString("th-TH", { maximumFractionDigits: 0 });
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const DAY = 86400000;
  let days = 60;
  let items = [];
  const picked = new Set();
  let action = { mode: "percent", value: 20 };

  async function load() {
    const cutoff = new Date(Date.now() - days * DAY).toISOString();
    const { data, error } = await ItemsRepo.staleSince(cutoff);
    if (error) {
      card.querySelector(".stale-body").innerHTML = `<div class="empty-state">โหลดของค้างไม่สำเร็จ</div>`;
      return Notify.error("โหลดของค้างไม่สำเร็จ", error, { actions: [{ label: "ลองใหม่", onClick: load }] });
    }
    // อายุนับจากวันลงขายจริง (listed_at) ถ้ามี
    items = (data || []).map((i) => ({ ...i, age: Math.floor((Date.now() - new Date(i.listed_at || i.created_at)) / DAY) })).filter((i) => i.age >= days);
    [...picked].forEach((id) => { if (!items.some((i) => i.id === id)) picked.delete(id); });
    render();
  }

  function newPrice(i) {
    const cur = S(i.current_price);
    if (action.mode === "price") return S(Math.round(Number(action.value) || 0));
    const pct = Number(action.value) || 0;
    return S(Math.round(Money.toBaht(cur) * (100 - pct) / 100)); // ปัดบาทเต็มแบบเดียวกับ markdown_items
  }

  function render() {
    const totalCost = items.reduce((s, i) => s + S(i.cost_price), 0);
    card.querySelector(".stale-count").textContent = items.length ? `${items.length} ชิ้น · ทุนจม ${thb(totalCost)}` : "ไม่มี";
    if (!items.length) { card.querySelector(".stale-body").innerHTML = `<div class="empty-state">ไม่มีของค้างเกิน ${days} วัน 🎉</div>`; return; }

    const sel = items.filter((i) => picked.has(i.id));
    const before = sel.reduce((s, i) => s + S(i.current_price), 0);
    const after = sel.reduce((s, i) => s + newPrice(i), 0);
    const belowCost = sel.filter((i) => newPrice(i) < S(i.cost_price)).length;

    // จัดกลุ่มตาม Lot · กลุ่มราคา ให้เลือกยกกองได้
    const groups = {};
    items.forEach((i) => { const k = `${i.lots?.lot_name || "ไม่ระบุ Lot"} · ${i.lot_groups?.group_name || "ไม่มีกลุ่ม"}`; (groups[k] ||= []).push(i); });

    card.querySelector(".stale-body").innerHTML = `
      <div class="stale-actions">
        <div class="seg stale-mode">
          ${[10, 20, 30].map((p) => `<button type="button" data-pct="${p}" class="${action.mode === "percent" && Number(action.value) === p ? "active" : ""}">ลด ${p}%</button>`).join("")}
          <button type="button" data-mode="price" class="${action.mode === "price" ? "active" : ""}">ตั้งราคา</button>
        </div>
        ${action.mode === "price" ? `<input type="number" class="stale-price" min="0" step="1" inputmode="numeric" placeholder="ราคาใหม่ (บาท)" value="${esc(action.value ?? "")}">` : ""}
      </div>
      <div class="stale-preview">${sel.length
        ? `เลือก ${sel.length} ชิ้น · ราคารวม ${thb(before)} → <b>${thb(after)}</b>${belowCost ? ` · <span class="loss">ต่ำกว่าทุน ${belowCost} ชิ้น</span>` : ""}`
        : "ติ๊กเลือกชิ้นที่จะลดราคา (หรือติ๊กหัวกองเพื่อเลือกทั้งกอง)"}</div>
      <button type="button" class="btn btn-primary stale-apply" ${sel.length ? "" : "disabled"}>ใช้ราคาใหม่กับ ${sel.length} ชิ้น</button>
      <div class="stale-groups">${Object.entries(groups).map(([g, list]) => {
        const all = list.every((i) => picked.has(i.id));
        return `<div class="stale-group">
          <label class="stale-ghead"><input type="checkbox" data-group="${esc(g)}" ${all ? "checked" : ""}> <b>${esc(g)}</b> <small>${list.length} ชิ้น</small></label>
          ${list.map((i) => `<label class="stale-item">
            <input type="checkbox" data-id="${i.id}" ${picked.has(i.id) ? "checked" : ""}>
            <span class="stale-name">${esc(i.item_name)}<small>${esc(i.sku || "")} · ${esc(i.size || "-")} · ${i.age} วัน · ทุน ${thb(S(i.cost_price))}</small></span>
            <span class="stale-p">${picked.has(i.id) && newPrice(i) !== S(i.current_price) ? `<s>${thb(S(i.current_price))}</s> <b class="${newPrice(i) < S(i.cost_price) ? "loss" : ""}">${thb(newPrice(i))}</b>` : thb(S(i.current_price))}</span>
          </label>`).join("")}
        </div>`;
      }).join("")}</div>`;
  }

  card.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-id]")) { t.checked ? picked.add(t.dataset.id) : picked.delete(t.dataset.id); render(); }
    if (t.matches("[data-group]")) {
      items.filter((i) => `${i.lots?.lot_name || "ไม่ระบุ Lot"} · ${i.lot_groups?.group_name || "ไม่มีกลุ่ม"}` === t.dataset.group)
        .forEach((i) => (t.checked ? picked.add(i.id) : picked.delete(i.id)));
      render();
    }
    if (t.matches(".stale-days")) { days = Number(t.value); load(); }
  });
  card.addEventListener("input", (e) => {
    if (!e.target.matches(".stale-price")) return;
    action.value = e.target.value;
    // อัปเดตแค่ตัวอย่าง ไม่ render ใหม่ทั้งก้อน (กันช่องที่พิมพ์อยู่หลุดโฟกัส)
    const pos = e.target.selectionStart;
    render();
    const input = card.querySelector(".stale-price");
    input.focus(); try { input.setSelectionRange(pos, pos); } catch (_) {}
  });
  card.addEventListener("click", async (e) => {
    const pct = e.target.closest("[data-pct]");
    if (pct) { action = { mode: "percent", value: Number(pct.dataset.pct) }; render(); return; }
    if (e.target.closest('[data-mode="price"]')) { action = { mode: "price", value: "" }; render(); card.querySelector(".stale-price")?.focus(); return; }
    if (e.target.closest(".stale-apply")) apply();
  });

  async function apply() {
    const sel = items.filter((i) => picked.has(i.id));
    if (!sel.length) return;
    if (action.mode === "price" && (action.value === "" || Number(action.value) < 0)) return Notify.warning("ยังไม่ได้ใส่ราคาใหม่", "ใส่ราคาเป็นบาท (0 ขึ้นไป)");
    const after = sel.reduce((s, i) => s + newPrice(i), 0);
    const below = sel.filter((i) => newPrice(i) < S(i.cost_price)).length;
    const label = action.mode === "price" ? `ตั้งราคาเป็น ฿${Math.round(Number(action.value))}` : `ลด ${action.value}%`;
    if (!(await Notify.confirm({
      title: `${label} · ${sel.length} ชิ้น?`,
      message: `ราคารวม ${thb(sel.reduce((s, i) => s + S(i.current_price), 0))} → ${thb(after)}${below ? `\n⚠ ${below} ชิ้นจะขายต่ำกว่าทุน` : ""}\nประวัติราคาเดิมเก็บไว้ในหน้าแก้สินค้า`,
      confirmText: "ลดราคา",
    }))) return;
    const { data, error } = await ItemsRepo.markdown({
      ids: sel.map((i) => i.id),
      percent: action.mode === "percent" ? Number(action.value) : null,
      price: action.mode === "price" ? Number(action.value) : null,
      reason: `ลดราคาของค้าง ${days}+ วัน (${label})`,
    });
    if (error) return Notify.error("ลดราคาไม่สำเร็จ", error, { hint: /markdown_items|PGRST202/.test(error.message || "") ? "รัน sql/migration_v21_offline_markdown.sql ใน Supabase ก่อน" : undefined });
    Notify.success(`ลดราคาแล้ว ${data.updated} ชิ้น`, `ราคารวม ${thb(S(data.before_total))} → ${thb(S(data.after_total))}`);
    picked.clear();
    load();
    if (typeof window.loadItems === "function") window.loadItems();
  }

  card.querySelector(".stale-days").value = String(days);
  card.addEventListener("toggle", () => { if (card.open && !items.length) load(); });
  const reload = debounce(() => load(), 1000);
  window.addEventListener("vims:realtime", (e) => { if (["items", "page_refresh"].includes(e.detail?.table)) reload(); });
  load();
})();
