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
let detailContext = "available"; // จำไว้ว่า saleDetailModal เปิดมาจากแท็บไหน เพื่อซ่อนปุ่ม "ขายสินค้านี้" ตอนดูของที่ขายแล้ว

// โหลดสินค้าเฉพาะสถานะ available เพื่อไม่ให้สินค้าที่ขายแล้วกลับมาเลือกขายซ้ำ
async function loadSellGrid() {
  const { data: items, error } = await supabaseClient
    .from("items")
    .select("*, lots(lot_name), lot_groups(group_name)")
    .eq("status", "available")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    document.getElementById("sellGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>`;
    return;
  }

  inStockItems = items || [];

  // โหลดรูปหลัก/รูปที่ 2 แยกจาก items เพราะรูปถูกเก็บใน item_images แบบ 1-to-many
  const ids = inStockItems.map((item) => item.id);
  itemImagesById = {};
  if (ids.length) {
    const { data: images, error: imageError } = await supabaseClient
      .from("item_images")
      .select("item_id, image_url, sort_order")
      .in("item_id", ids)
      .order("sort_order", { ascending: true });

    if (!imageError) {
      (images || []).forEach((image) => {
        if (!itemImagesById[image.item_id]) itemImagesById[image.item_id] = [];
        itemImagesById[image.item_id].push(image);
      });
    }
  }

  renderGrid(inStockItems);
}

// โหลดของที่ขายแล้ว (300 รายการล่าสุด) สำหรับแท็บ "ขายแล้ว" — ดูรายงานย้อนหลังทั้งหมดได้ที่หน้ารายงาน
async function loadSoldGrid() {
  const { data: sales, error } = await supabaseClient
    .from("sales")
    .select("item_id, sale_price, sale_date, items(id, item_name, size, condition, tier, cost_price, base_price, lot_id, group_id, lots(lot_name), lot_groups(group_name))")
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
        <div class="item-tile-image">${image ? `<img src="${image.image_url}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>'}</div>
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
    if (activeTab === "sold" && !soldLoaded) await loadSoldGrid();
    else if (activeTab === "sold") renderSoldGrid(soldItems);
    else renderGrid(inStockItems);
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
      <div class="item-tile" data-id="${item.id}">
        <button type="button" class="item-tile-main" data-action="detail" data-id="${item.id}" aria-label="ดูรายละเอียด ${escapeHtml(item.item_name)}">
          <div class="item-tile-image">${image ? `<img src="${image.image_url}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>'}</div>
          <div class="name">${escapeHtml(item.item_name)}</div>
          <div class="meta">${escapeHtml(item.size || "-")} · ${item.condition || "-"} · ${item.tier === "head" ? "งานหัว" : "ปกติ"}</div>
          <div class="price">${formatBaht(item.current_price ?? item.sell_price)}</div>
        </button>
        <button type="button" class="btn btn-primary item-tile-sell" data-action="sell" data-id="${item.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v10a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-4"/><path d="M17 12h3a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-3a2 2 0 0 1 0-4z"/></svg>ขาย</button>
      </div>`;
  }).join("");

  document.getElementById("sellGrid").innerHTML = html;
  // ใช้ event delegation เพื่อให้ปุ่มขายทำงานแน่นอนแม้ grid จะถูก render ใหม่จาก Realtime
  document.querySelectorAll("#sellGrid [data-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const itemId = button.dataset.id;
      if (button.dataset.action === "sell") {
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
  const source = activeTab === "sold" ? soldItems : inStockItems;
  const render = activeTab === "sold" ? renderSoldGrid : renderGrid;
  if (!q) return render(source);
  const filtered = source.filter((item) => {
    const haystack = [
      item.item_name,
      item.size,
      item.condition,
      item.lots?.lot_name,
      item.lot_groups?.group_name,
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(q);
  });
  render(filtered);
}

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
  document.getElementById("detailImage1").innerHTML = images[0] ? `<img src="${images[0].image_url}" alt="">` : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:60%;height:60%"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>';
  document.getElementById("detailImage2").innerHTML = images[1] ? `<img src="${images[1].image_url}" alt="">` : "＋";
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
    .select("id, sale_date, sale_price, cost_price, payment_method, channel, note")
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
    return `<div class="sale-history-row">
      <div><b>${formatBaht(sale.sale_price)}</b><span>${formatDateTime(sale.sale_date)}</span></div>
      <div><span>${paymentLabel(sale.payment_method)}</span><span>${channelLabel(sale.channel)}</span></div>
      <strong class="${profit >= 0 ? "profit" : "loss"}">${profit >= 0 ? "+" : ""}${formatBaht(profit)}</strong>
    </div>`;
  }).join("");
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
