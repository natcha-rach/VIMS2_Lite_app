/* ==========================================================
   SELL (sell.html) — ค้นหา → ดูรายละเอียด → ขาย → บันทึก
   เชื่อมต่อ:
   sell.html → sell.js → Supabase items / item_images / sales
   การเปลี่ยน available → sold ใช้ RPC sell_item เพื่อให้เป็น transaction เดียว
   ========================================================== */

let inStockItems = [];
let itemImagesById = {};
let soldItems = [];
let soldImagesById = {};
let soldLoaded = false;
let selectedItem = null;
let activeTab = "available"; // "available" | "sold" — คุมว่าแท็บไหนกำลังแสดงอยู่
let detailContext = "available";
const cart = new Map(); // item_id -> item (ตะกร้าอยู่ในหน่วยความจำ: รีเฟรชหน้า = ตะกร้าหาย)
const LS = { lot: "vims2_sell_lot", type: "vims2_sell_type", pay: "vims2_last_payment", chan: "vims2_last_channel" };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }; // จำไว้ว่า saleDetailModal เปิดมาจากแท็บไหน เพื่อซ่อนปุ่ม "ขายสินค้านี้" ตอนดูของที่ขายแล้ว

// โหลดสินค้าเฉพาะสถานะ available เพื่อไม่ให้สินค้าที่ขายแล้วกลับมาเลือกขายซ้ำ
// ดึงทีละหน้า 1,000 แถว (ไม่พึ่ง fetchAllRows ใน supabaseClient.js เผื่อไฟล์บนเว็บเป็นเวอร์ชันเก่า)
async function fetchAllPages(factory, pageSize = 1000) {
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await factory().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}

// ครอบ try/catch: ถ้าพังจะขึ้นข้อความสาเหตุบนหน้าจอ แทนที่จะค้าง "กำลังโหลด..." เงียบๆ
async function loadSellGrid() {
  try {
    await loadSellGridInner();
  } catch (e) {
    console.error(e);
    document.getElementById("sellGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(e?.message || e)}</div>`;
  }
}

async function loadSellGridInner() {
  // รูปมากับ item ใน query เดียว (embedded select) — ไม่ใช้ .in(ids) ที่ URL ยาวเกินแล้วรูปหายเงียบๆ
  const { data: items, error } = await fetchAllPages(() => supabaseClient
    .from("items")
    .select("id, item_name, size, condition, tier, sku, cost_price, base_price, current_price, lot_id, group_id, lots(lot_name), lot_groups(group_name), item_images(image_url, sort_order)")
    .eq("status", "available")
    .eq("intake_status", "listed") // V15: ซ่อน Item ที่ยังเป็น draft (รอรูป)
    .order("created_at", { ascending: false })
    .order("id"));

  if (error) {
    console.error(error);
    document.getElementById("sellGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${escapeHtml(error.message)}</div>`;
    return;
  }

  inStockItems = items || [];
  itemImagesById = {};
  inStockItems.forEach((item) => {
    itemImagesById[item.id] = (item.item_images || []).slice().sort((x, y) => x.sort_order - y.sort_order);
  });

  // ของในตะกร้าที่ถูกขาย/ถอนจากเครื่องอื่นไปแล้ว → เอาออก, ที่เหลืออัปเดตราคาล่าสุด
  const fresh = new Map(inStockItems.map((i) => [i.id, i]));
  [...cart.keys()].forEach((id) => (fresh.has(id) ? cart.set(id, fresh.get(id)) : cart.delete(id)));

  populateLotFilter();
  applySearch();
  updateCartBar();
}

// โหลดของที่ขายแล้ว (300 รายการล่าสุด) สำหรับแท็บ "ขายแล้ว" — ดูรายงานย้อนหลังทั้งหมดได้ที่หน้ารายงาน
async function loadSoldGrid() {
  const { data: sales, error } = await supabaseClient
    .from("sales")
    .select("item_id, sale_price, sale_date, items(id, item_name, size, condition, tier, cost_price, base_price, lot_id, group_id, lots(lot_name), lot_groups(group_name))")
    .is("voided_at", null) // V15: ไม่นับรายการที่ถูกยกเลิกแล้ว
    .order("sale_date", { ascending: false })
    .limit(300);

  if (error) {
    console.error(error);
    document.getElementById("soldGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>`;
    return;
  }

  // แปลง sales+items ให้อยู่ในรูปแบบเดียวกับ inStockItems เพื่อใช้ openItemSaleDetail ร่วมกันได้
  soldItems = (sales || [])
    .filter((s) => s.items)
    .map((s) => ({
      ...s.items,
      current_price: s.sale_price,
      _saleDate: s.sale_date,
    }));

  const ids = soldItems.map((item) => item.id);
  soldImagesById = {};
  if (ids.length) {
    const { data: images, error: imageError } = await supabaseClient
      .from("item_images")
      .select("item_id, image_url, sort_order")
      .in("item_id", ids)
      .order("sort_order", { ascending: true });
    if (!imageError) {
      (images || []).forEach((image) => {
        if (!soldImagesById[image.item_id]) soldImagesById[image.item_id] = [];
        soldImagesById[image.item_id].push(image);
      });
    }
  }

  soldLoaded = true;
  renderSoldGrid(soldItems);
}

// สร้างการ์ดของที่ขายแล้ว: คลิกเพื่อดูรายละเอียด/ประวัติการขาย (ขายซ้ำไม่ได้)
function renderSoldGrid(items) {
  if (!items.length) {
    document.getElementById("soldGrid").innerHTML = `<div class="empty-state">ยังไม่มีของที่ขายแล้ว</div>`;
    return;
  }
  const html = items.map((item) => {
    const image = soldImagesById[item.id]?.[0];
    return `
      <button class="item-tile tile-sold" data-id="${item.id}">
        <div class="item-tile-image">${image ? `<img src="${safeImgUrl(image.image_url)}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>'}</div>
        <div class="name">${escapeHtml(item.item_name)}</div>
        <div class="meta">${escapeHtml(item.size || "-")} · ${item.condition || "-"} · ${item.tier === "head" ? "งานหัว" : "ปกติ"}</div>
        <div class="price">${formatBaht(item.current_price)}</div>
        <div class="item-tile-sold-date">${formatDateTime(item._saleDate)}</div>
      </button>`;
  }).join("");

  document.getElementById("soldGrid").innerHTML = html;
  document.querySelectorAll("#soldGrid .item-tile").forEach((tile) => {
    tile.addEventListener("click", () => openItemSaleDetail(tile.dataset.id, "sold"));
  });
}

// สลับแท็บพร้อมขาย / ขายแล้ว
document.querySelectorAll(".sell-tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll(".sell-tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.getElementById("sellGrid").classList.toggle("hidden", activeTab !== "available");
    document.getElementById("soldGrid").classList.toggle("hidden", activeTab !== "sold");
    document.getElementById("sellHintAvailable").classList.toggle("hidden", activeTab !== "available");
    document.getElementById("sellHintSold").classList.toggle("hidden", activeTab !== "sold");
    document.getElementById("searchBox").value = "";
    document.getElementById("lotFilter").classList.toggle("hidden", activeTab !== "available");
    document.getElementById("typeFilter").classList.toggle("hidden", activeTab !== "available");
    if (activeTab === "sold" && !soldLoaded) await loadSoldGrid();
    else if (activeTab === "sold") renderSoldGrid(soldItems);
    else applySearch();
  });
});

// สร้างการ์ดสินค้า: คลิกได้ทั้งการ์ดเพื่อเปิดรายละเอียดก่อนขาย
function renderGrid(items) {
  if (!items.length) {
    document.getElementById("sellGrid").innerHTML = `<div class="empty-state">ไม่มีของในสต็อกให้ขาย</div>`;
    return;
  }

  const html = items.map((item) => {
    const image = itemImagesById[item.id]?.[0];
    return `
      <div class="item-tile${cart.has(item.id) ? " in-cart" : ""}" data-id="${item.id}">
        <button type="button" class="item-tile-main" data-action="detail" data-id="${item.id}" aria-label="ดูรายละเอียด ${escapeHtml(item.item_name)}">
          <div class="item-tile-image">${image ? `<img src="${safeImgUrl(image.image_url)}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>'}</div>
          <div class="name">${escapeHtml(item.item_name)}${item.sku ? ` <span class="sku-tag">${escapeHtml(item.sku)}</span>` : ""}</div>
          <div class="meta">${escapeHtml(item.size || "-")} · ${item.condition || "-"} · ${item.tier === "head" ? "งานหัว" : "ปกติ"}</div>
          <div class="price">${formatBaht(item.current_price ?? item.sell_price)}</div>
        </button>
        <button type="button" class="btn btn-primary item-tile-sell" data-action="sell" data-id="${item.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"/><path d="M17 12h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3a2 2 0 0 1 0-4z"/></svg>ขาย</button>
        <button type="button" class="btn btn-ghost item-tile-cart" data-action="cart" data-id="${item.id}">${cart.has(item.id) ? "✓ อยู่ในตะกร้า" : "+ ตะกร้า"}</button>
      </div>`;
  }).join("");

  document.getElementById("sellGrid").innerHTML = html;
  // ใช้ event delegation เพื่อให้ปุ่มขายทำงานแน่นอนแม้ grid จะถูก render ใหม่จาก Realtime
  document.querySelectorAll("#sellGrid [data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const itemId = button.dataset.id;
      if (button.dataset.action === "cart") {
        toggleCart(itemId);
      } else if (button.dataset.action === "sell") {
        openItemSaleDetail(itemId, "available").then(() => openSellConfirm());
      } else {
        openItemSaleDetail(itemId, "available");
      }
    });
  });
}

// ค้นหาแบบทันทีจากชื่อสินค้า / size / group / lot เพื่อให้ใช้หน้าร้านได้เร็ว — ใช้ได้ทั้งแท็บพร้อมขายและขายแล้ว
function applySearch() {
  const q = document.getElementById("searchBox").value.trim().toLowerCase();
  const lot = activeTab === "available" ? document.getElementById("lotFilter").value : "";
  const type = activeTab === "available" ? document.getElementById("typeFilter").value : "";
  const source = activeTab === "sold" ? soldItems : inStockItems;
  const render = activeTab === "sold" ? renderSoldGrid : renderGrid;
  const filtered = source.filter((item) => {
    if (lot === "__none" ? item.lot_id : lot && item.lot_id !== lot) return false;
    if (type && typeKey(item) !== type) return false;
    if (!q) return true;
    const haystack = [item.item_name, item.sku, item.size, item.condition, item.lots?.lot_name, item.lot_groups?.group_name]
      .filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  });
  render(filtered);
}

// Dropdown กรองตาม Lot (นับจำนวนที่พร้อมขายต่อ Lot) — จำค่าล่าสุดไว้
function populateLotFilter() {
  const sel = document.getElementById("lotFilter");
  const prev = sel.value || lsGet(LS.lot) || "";
  const counts = new Map();
  inStockItems.forEach((i) => counts.set(i.lot_id || "__none", (counts.get(i.lot_id || "__none") || 0) + 1));
  const names = new Map(inStockItems.map((i) => [i.lot_id || "__none", i.lots?.lot_name || "ไม่ระบุ Lot"]));
  sel.innerHTML = `<option value="">ทุก Lot (${inStockItems.length})</option>` +
    [...counts.entries()].sort((a, b) => names.get(a[0]).localeCompare(names.get(b[0]), "th"))
      .map(([id, n]) => `<option value="${escapeHtml(id)}">${escapeHtml(names.get(id))} (${n})</option>`).join("");
  sel.value = counts.has(prev) ? prev : "";
  populateTypeFilter();
}
document.getElementById("lotFilter").addEventListener("change", (e) => { lsSet(LS.lot, e.target.value); populateTypeFilter(); applySearch(); });

// Dropdown ประเภทสินค้า = ชื่อกลุ่มราคา (lot_groups.group_name เช่น งานหัว / งานหาง) รวมชื่อเดียวกันข้าม Lot
// เปลี่ยนตาม Lot ที่เลือก: เลือก Lot แล้วจะเห็นเฉพาะประเภทที่มีใน Lot นั้น พร้อมจำนวน
function typeKey(item) { return item.lot_groups?.group_name || "__none"; }
function populateTypeFilter() {
  const sel = document.getElementById("typeFilter");
  const lot = document.getElementById("lotFilter").value;
  const prev = sel.value || lsGet(LS.type) || "";
  const counts = new Map();
  inStockItems
    .filter((i) => !lot || (lot === "__none" ? !i.lot_id : i.lot_id === lot))
    .forEach((i) => counts.set(typeKey(i), (counts.get(typeKey(i)) || 0) + 1));
  const label = (k) => (k === "__none" ? "ไม่มีกลุ่ม" : k);
  const total = [...counts.values()].reduce((t, n) => t + n, 0);
  sel.innerHTML = `<option value="">ทุกประเภท (${total})</option>` +
    [...counts.entries()].sort((a, b) => label(a[0]).localeCompare(label(b[0]), "th"))
      .map(([k, n]) => `<option value="${escapeHtml(k)}">${escapeHtml(label(k))} (${n})</option>`).join("");
  sel.value = counts.has(prev) ? prev : "";
}
document.getElementById("typeFilter").addEventListener("change", (e) => { lsSet(LS.type, e.target.value); applySearch(); });

document.getElementById("searchBox").addEventListener("input", applySearch);

// เปิดหน้ารายละเอียด: เป็นจุดกลางระหว่าง “ค้นหา” และ “ยืนยันการขาย”
// context = "available" (มาจากแท็บพร้อมขาย ขายได้) หรือ "sold" (มาจากแท็บขายแล้ว ดูอย่างเดียว)
async function openItemSaleDetail(itemId, context = "available") {
  detailContext = context;
  const item = (context === "sold" ? soldItems : inStockItems).find((row) => row.id === itemId);
  if (!item) return;
  selectedItem = item;
  document.getElementById("openSellConfirm").classList.toggle("hidden", context === "sold");

  const images = (context === "sold" ? soldImagesById : itemImagesById)[item.id] || [];
  document.getElementById("detailImage1").innerHTML = images[0] ? `<img src="${safeImgUrl(images[0].image_url)}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>';
  document.getElementById("detailImage2").innerHTML = images[1] ? `<img src="${safeImgUrl(images[1].image_url)}" alt="">` : "＋";
  document.getElementById("detailName").textContent = item.item_name;
  document.getElementById("detailMeta").textContent = `${item.size || "ไม่ระบุไซซ์"} · ${item.condition || "-"} · ${item.tier === "head" ? "งานหัว" : "ปกติ"}`;
  document.getElementById("detailLot").textContent = item.lots?.lot_name || "-";
  document.getElementById("detailGroup").textContent = item.lot_groups?.group_name || "-";
  document.getElementById("detailCost").textContent = formatBaht(item.cost_price);
  document.getElementById("detailBasePrice").textContent = formatBaht(item.base_price);
  document.getElementById("detailCurrentPrice").textContent = formatBaht(item.current_price ?? item.sell_price);

  // โหลดประวัติการขายเฉพาะ Item นี้ เพื่อให้รู้ว่ามีรายการขายเดิมหรือไม่
  const { data: sales } = await supabaseClient
    .from("sales")
    .select("id, sale_date, sale_price, cost_price, payment_method, channel, note, voided_at, void_reason")
    .eq("item_id", item.id)
    .order("sale_date", { ascending: false });
  renderSaleHistory(sales || []);

  document.getElementById("saleDetailModal").classList.remove("hidden");
}

function renderSaleHistory(sales) {
  const el = document.getElementById("saleHistory");
  if (!sales.length) {
    el.innerHTML = `<div class="empty-state small">ยังไม่มีประวัติการขาย</div>`;
    return;
  }
  el.innerHTML = sales.map((sale) => {
    const profit = Number(sale.sale_price || 0) - Number(sale.cost_price || 0);
    const voided = !!sale.voided_at;
    return `<div class="sale-history-row ${voided ? "voided" : ""}">
      <div><b>${formatBaht(sale.sale_price)}</b><span>${formatDateTime(sale.sale_date)}</span></div>
      <div><span>${escapeHtml(paymentLabel(sale.payment_method))}</span><span>${escapeHtml(channelLabel(sale.channel))}</span></div>
      <strong class="${profit >= 0 ? "profit" : "loss"}">${profit >= 0 ? "+" : ""}${formatBaht(profit)}</strong>
      ${voided
        ? `<span class="voided-tag" title="${sale.void_reason ? escapeHtml(sale.void_reason) : ""}">ยกเลิกแล้ว</span>`
        : `<button type="button" class="btn btn-ghost btn-sm" data-void-sale="${sale.id}">ยกเลิกการขายนี้</button>`}
    </div>`;
  }).join("");
  el.querySelectorAll("[data-void-sale]").forEach((btn) => btn.addEventListener("click", () => voidSaleById(btn.dataset.voidSale)));
}

// ยกเลิกการขาย (กู้จากกดขายผิด) — คืนสถานะ Item เป็น available ทันที
async function voidSaleById(saleId) {
  const reason = prompt("เหตุผลที่ยกเลิก (ไม่บังคับ):", "") || null;
  const { error } = await supabaseClient.rpc("void_sale", { p_sale_id: saleId, p_reason: reason });
  if (error) return showToast("ยกเลิกไม่สำเร็จ: " + error.message);
  showToast("ยกเลิกการขายแล้ว — สินค้ากลับเป็นพร้อมขาย");
  document.getElementById("saleDetailModal").classList.add("hidden");
  soldLoaded = false;
  await loadSellGrid();
  if (activeTab === "sold") await loadSoldGrid();
}

// จากรายละเอียด → เปิดฟอร์มขายจริง โดยใช้ current_price เป็นราคาเริ่มต้น
function openSellConfirm() {
  if (!selectedItem) return;
  document.getElementById("modalItemId").value = selectedItem.id;
  document.getElementById("modalItemName").textContent = selectedItem.item_name;
  document.getElementById("modalItemMeta").textContent = `${selectedItem.size || ""} ${selectedItem.condition ? "· " + selectedItem.condition : ""} · ต้นทุน ${formatBaht(selectedItem.cost_price)}`;
  document.getElementById("salePrice").value = selectedItem.current_price ?? selectedItem.sell_price ?? 0;
  document.getElementById("sellModal").classList.remove("hidden");
}

function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

document.getElementById("closeSaleDetail").addEventListener("click", () => closeModal("saleDetailModal"));
document.getElementById("cancelDetailSale").addEventListener("click", () => closeModal("saleDetailModal"));
document.getElementById("cancelSell").addEventListener("click", () => closeModal("sellModal"));
// ปุ่ม "ขายสินค้านี้" อยู่ใน Modal รายละเอียด — ใช้ event delegation เพื่อป้องกันปัญหา listener หลุดหลัง UI ถูก render/อัปเดต
document.addEventListener("click", (event) => {
  const button = event.target.closest("#openSellConfirm");
  if (!button) return;
  event.preventDefault();
  closeModal("saleDetailModal");
  openSellConfirm();
});

// Confirm การขาย: ใช้ RPC ที่ lock row + insert sale + update status ใน transaction เดียว
// เชื่อม: sell.js → Supabase RPC sell_item → sales + items.status/sold_at
// ถ้าขั้นตอนใดล้มเหลว Database จะ rollback ทั้งชุด
document.getElementById("sellForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const itemId = document.getElementById("modalItemId").value;
  const item = inStockItems.find((row) => row.id === itemId);
  if (!item) return;

  const salePrice = Number(document.getElementById("salePrice").value);
  const paymentMethod = document.getElementById("paymentMethod").value;
  const channel = document.getElementById("channel").value;
  if (!Number.isFinite(salePrice) || salePrice < 0) return showToast("ราคาขายไม่ถูกต้อง");

  const submitButton = document.querySelector("#sellForm button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "กำลังบันทึก...";

  const { error } = await supabaseClient.rpc("sell_item", {
    p_item_id: item.id,
    p_sale_price: salePrice,
    p_payment_method: paymentMethod,
    p_channel: channel,
    p_note: null,
  });

  submitButton.disabled = false;
  submitButton.textContent = "ยืนยันการขาย";

  if (error) {
    console.error(error);
    showToast("บันทึกการขายไม่สำเร็จ: " + error.message);
    return;
  }

  lsSet(LS.pay, paymentMethod); lsSet(LS.chan, channel);
  closeModal("sellModal");
  selectedItem = null;
  showToast(`ขาย “${item.item_name}” สำเร็จ`);

  // หลังขายสำเร็จ โหลด Stock ใหม่ทันทีบนเครื่องที่กดขาย
  await loadSellGrid();
});

function paymentLabel(value) {
  return ({ cash: "เงินสด", transfer: "โอน", government: "โครงการรัฐ" })[value] || value || "-";
}
function channelLabel(value) {
  return ({ street_market: "ถนนคนเดิน", facebook: "Facebook", instagram: "Instagram" })[value] || value || "-";
}
function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}
function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove("show"), 2500);
}




// ==========================================================
// ตะกร้า + ราคารวมที่ตกลง + ปุ่มส่วนลดเร็ว + จำวิธีจ่ายล่าสุด
// ==========================================================
const payEl = document.getElementById("paymentMethod");
const chanEl = document.getElementById("channel");
const cartPayEl = document.getElementById("cartPay");
const cartChanEl = document.getElementById("cartChannel");
cartPayEl.innerHTML = payEl.innerHTML;
cartChanEl.innerHTML = chanEl.innerHTML;
[[payEl, cartPayEl, LS.pay], [chanEl, cartChanEl, LS.chan]].forEach(([a, b, key]) => {
  const v = lsGet(key);
  if (v && [...a.options].some((o) => o.value === v)) { a.value = v; b.value = v; }
});

// ส่วนลดจากราคาตั้ง: "5"/"10"/"20" = ลด %, "floor10" = ปัดลงหลักสิบ, "reset" = ราคาตั้ง
function discounted(listTotal, mode) {
  if (mode === "reset") return listTotal;
  if (mode === "floor10") return Math.floor(listTotal / 10) * 10;
  return Math.round(listTotal * (1 - Number(mode) / 100));
}
document.getElementById("singleChips").addEventListener("click", (e) => {
  const mode = e.target.closest("[data-disc]")?.dataset.disc;
  if (!mode || !selectedItem) return;
  const base = Number(selectedItem.current_price ?? 0);
  document.getElementById("salePrice").value = discounted(base, mode);
});

function toggleCart(id) {
  if (cart.has(id)) cart.delete(id);
  else { const it = inStockItems.find((i) => i.id === id); if (it) cart.set(id, it); }
  updateCartBar();
  applySearch();
}
function updateCartBar() {
  const n = cart.size;
  document.getElementById("cartBar").classList.toggle("hidden", n === 0);
  const sum = [...cart.values()].reduce((t, i) => t + Number(i.current_price || 0), 0);
  document.getElementById("cartBarText").textContent = `ตะกร้า ${n} ชิ้น · ราคาตั้ง ${formatBaht(sum)}`;
  if (n === 0) closeModal("cartModal");
}

// กระจายราคารวมตามสัดส่วนราคาตั้ง (หน่วยเป็นบาทเต็ม ถ้ายอดรวมมีสตางค์ใช้สตางค์) เศษทั้งหมดตกที่ชิ้นแพงสุด → ผลรวมตรงยอดที่ตกลงเป๊ะ
function allocate(total, items) {
  const unit = Number.isInteger(total) ? 1 : 0.01;
  const U = Math.round(total / unit);
  const L = items.reduce((t, i) => t + Number(i.current_price || 0), 0);
  const w = items.map((i) => (L > 0 ? Number(i.current_price || 0) / L : 1 / items.length));
  const units = w.map((x) => Math.floor(U * x));
  let rest = U - units.reduce((t, x) => t + x, 0);
  const top = w.indexOf(Math.max(...w));
  units[top] += rest;
  return units.map((x) => Math.round(x * unit * 100) / 100);
}

function openCart() {
  if (!cart.size) return;
  const listTotal = [...cart.values()].reduce((t, i) => t + Number(i.current_price || 0), 0);
  document.getElementById("cartTotal").value = listTotal;
  document.getElementById("cartModal").classList.remove("hidden");
  renderCart();
}
function cartTotalValue() { return Number(document.getElementById("cartTotal").value); }
function renderCart() {
  const items = [...cart.values()];
  const total = cartTotalValue();
  const ok = Number.isFinite(total) && total >= 0;
  const shares = ok ? allocate(total, items) : items.map(() => 0);
  const cost = items.reduce((t, i) => t + Number(i.cost_price || 0), 0);
  document.getElementById("cartCount").textContent = `(${items.length} ชิ้น)`;
  document.getElementById("cartLines").innerHTML = items.map((i, idx) => {
    const profit = shares[idx] - Number(i.cost_price || 0);
    return `<div class="cart-line"><div><b>${escapeHtml(i.item_name)}</b><span>${escapeHtml(i.size || "-")} · ตั้ง ${formatBaht(i.current_price)}</span></div>
      <div class="cart-line-price"><b>${formatBaht(shares[idx])}</b><span class="${profit >= 0 ? "profit" : "loss"}">${profit >= 0 ? "+" : ""}${formatBaht(profit)}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" data-remove="${i.id}" aria-label="เอาออก">✕</button></div>`;
  }).join("");
  const profit = total - cost;
  document.getElementById("cartSummary").innerHTML =
    `ต้นทุนรวม ${formatBaht(cost)} · กำไรบิลนี้ <b class="${profit >= 0 ? "profit" : "loss"}">${profit >= 0 ? "+" : ""}${formatBaht(profit)}</b>` +
    (ok && profit < 0 ? `<div class="loss">⚠ ราคารวมต่ำกว่าต้นทุน — ขายแล้วจะขาดทุน</div>` : "");
}
document.getElementById("cartTotal").addEventListener("input", renderCart);
document.getElementById("cartChips").addEventListener("click", (e) => {
  const mode = e.target.closest("[data-disc]")?.dataset.disc;
  if (!mode) return;
  const listTotal = [...cart.values()].reduce((t, i) => t + Number(i.current_price || 0), 0);
  document.getElementById("cartTotal").value = discounted(listTotal, mode);
  renderCart();
});
document.getElementById("cartLines").addEventListener("click", (e) => {
  const id = e.target.closest("[data-remove]")?.dataset.remove;
  if (!id) return;
  cart.delete(id); updateCartBar(); applySearch();
  if (cart.size) renderCart();
});
document.getElementById("openCart").addEventListener("click", openCart);
document.getElementById("cartClose").addEventListener("click", () => closeModal("cartModal"));
document.getElementById("cartClear").addEventListener("click", () => { cart.clear(); updateCartBar(); applySearch(); });

document.getElementById("cartConfirm").addEventListener("click", async () => {
  const items = [...cart.values()];
  const total = cartTotalValue();
  if (!items.length) return;
  if (!Number.isFinite(total) || total < 0) return showToast("ราคารวมไม่ถูกต้อง");
  const btn = document.getElementById("cartConfirm");
  btn.disabled = true; btn.textContent = "กำลังบันทึก...";
  const shares = allocate(total, items);
  const { error } = await supabaseClient.rpc("sell_cart", {
    p_lines: items.map((i, idx) => ({ item_id: i.id, sale_price: shares[idx] })),
    p_payment_method: cartPayEl.value,
    p_channel: cartChanEl.value,
    p_note: null,
  });
  btn.disabled = false; btn.textContent = "ยืนยันการขาย";
  if (error) { console.error(error); return showToast("บันทึกการขายไม่สำเร็จ: " + error.message); }
  lsSet(LS.pay, cartPayEl.value); lsSet(LS.chan, cartChanEl.value);
  payEl.value = cartPayEl.value; chanEl.value = cartChanEl.value;
  cart.clear(); soldLoaded = false;
  closeModal("cartModal");
  showToast(`ขายสำเร็จ ${items.length} ชิ้น รวม ${formatBaht(total)}`);
  await loadSellGrid();
});

// ==========================================================
// REALTIME — SELL PAGE
// ==========================================================
// ถ้า Device อื่นเพิ่ม/ขาย/แก้ Item หรือรูป:
//   Supabase Realtime
//      ↓
//   vims:realtime
//      ↓
//   โหลด Stock Grid ใหม่
// ==========================================================
const reloadSellDebounced = debounce(() => {
  loadSellGrid();
  if (activeTab === 'sold') loadSoldGrid();
}, 500);
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['items', 'item_images', 'sales'].includes(table)) {
    soldLoaded = false; // ให้โหลดของขายแล้วใหม่ครั้งถัดไปที่สลับมาแท็บนี้
    reloadSellDebounced();
  }
});

// โหลด Stock ครั้งแรกเมื่อเปิดหน้า Sell
loadSellGrid();
