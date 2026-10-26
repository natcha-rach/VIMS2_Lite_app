/* ==========================================================
   SELL (sell.html) — หน้าร้าน V19: แตะรูป → ตะกร้า → ชำระเงิน → ใบเสร็จ
   เชื่อมต่อ:
     sell.html → sell.js → Supabase
       items / item_images (thumb_url) / reservations   ← โหลดกริด
       RPC sell_bill    ← ขายทั้งตะกร้าใน transaction เดียว (กดซ้ำไม่เกิดบิลซ้ำ)
       RPC void_bill    ← "เลิกทำ" / ยกเลิกทั้งบิล
       RPC void_sale    ← คืนทีละชิ้น
       RPC reserve_item / release_reservation ← จองจาก IG/FB
     money.js → กระจายส่วนลด, เงินทอน, QR พร้อมเพย์ (คิดเป็นสตางค์)
   ต้องรัน sql/migration_v19_pos_shift.sql ก่อนใช้งาน
   ========================================================== */

// ---------- state ----------
let inStockItems = [];          // ของพร้อมขาย (status=available, intake_status=listed)
let imagesById = {};            // item_id → [{image_url, thumb_url, sort_order}]
let reservationsByItem = {};    // item_id → การจองที่ active
let soldItems = [];
let soldImagesById = {};
let soldLoaded = false;
let activeTab = "available";
let showReservedOnly = false;
let detailItem = null;
let detailContext = "available";

// ตะกร้า: เก็บลำดับที่แตะ + ราคาที่ตกลงต่อชิ้น (สตางค์)
const cart = new Map();         // item_id → { price: satang }
let deal = { mode: "none", total: null }; // none | 10 | 20 | total | lines(แก้รายชิ้นเอง)
let pendingBillId = null;       // UUID ของบิลที่กำลังจะส่ง — ใช้ค่าเดิมเมื่อกดซ้ำ/ลองใหม่
let payMethod = "cash";
let channel = safeGet("vims_pos_channel") || "street_market";
let lastBill = null;            // บิลล่าสุดสำหรับใบเสร็จ/เลิกทำ
let undoTimer = null;
let posSettings = { promptpay_id: "", shop_name: "Bubbles Gumps", receipt_note: "" };

const $ = (id) => document.getElementById(id);
const S = (baht) => Money.toSatang(baht);
const thb = (satang) => "฿" + Money.toBaht(satang).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const SHIRT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3L4 7l2.5 2.5L8 8v13h8V8l1.5 1.5L20 7l-4-4-2 2h-4l-2-2z"/></svg>';

// localStorage อาจใช้ไม่ได้ (โหมดส่วนตัว) → ห่อ try/catch ทุกครั้ง
function safeGet(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
function safeSet(key, v) { try { localStorage.setItem(key, v); } catch (_) {} }

// ==========================================================
// โหลดข้อมูล
// ==========================================================
async function loadSellGrid() {
  const { data: items, error } = await supabaseClient
    .from("items")
    .select("*, lots(lot_name), lot_groups(group_name)")
    .eq("status", "available")
    .eq("intake_status", "listed")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    $("sellGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>`;
    return;
  }
  inStockItems = items || [];

  const ids = inStockItems.map((i) => i.id);
  imagesById = await loadImages(ids);
  reservationsByItem = await loadReservations();

  // ของในตะกร้าที่ถูกขาย/หายไปจากอีกเครื่อง → เอาออกจากตะกร้าอัตโนมัติ
  const live = new Set(ids);
  let removed = 0;
  [...cart.keys()].forEach((id) => { if (!live.has(id)) { cart.delete(id); removed++; } });
  if (removed) showToast(`เอาออกจากตะกร้า ${removed} ชิ้น (ขายไปแล้วจากอีกเครื่อง)`);

  refreshFilterOptions();
  applySearch();
  renderCartBar();
}

// รูป: ใช้รูปย่อ (thumb_url) ถ้ามี — ถ้าฐานข้อมูลยังไม่มีคอลัมน์นี้ ให้ถอยไปใช้แบบเดิม
async function loadImages(ids) {
  const map = {};
  if (!ids.length) return map;
  const run = (cols) => fetchAllRows(() => supabaseClient.from("item_images").select(cols).in("item_id", ids).order("sort_order", { ascending: true }));
  let { data, error } = await run("item_id, image_url, thumb_url, sort_order");
  if (error) ({ data, error } = await run("item_id, image_url, sort_order"));
  (data || []).forEach((img) => { (map[img.item_id] ||= []).push(img); });
  return map;
}

async function loadReservations() {
  const map = {};
  const { data, error } = await supabaseClient.from("reservations").select("*").eq("status", "active");
  if (error) return map; // ยังไม่ได้รัน migration → ทำงานแบบไม่มีระบบจอง
  (data || []).forEach((r) => { map[r.item_id] = r; });
  return map;
}

async function loadPosSettings() {
  const { data } = await supabaseClient.from("app_settings").select("value").eq("key", "pos_settings").maybeSingle();
  if (data?.value) posSettings = { ...posSettings, ...data.value };
}

function thumbOf(item, map = imagesById) {
  const img = map[item.id]?.[0];
  return img ? img.thumb_url || img.image_url : null;
}

// ==========================================================
// กริดรูป (หน้าขายเน้นรูปก่อน แล้วค่อยดูชื่อยืนยัน)
// ==========================================================
function refreshFilterOptions() {
  const lotSel = $("lotFilter");
  const sizeSel = $("sizeFilter");
  const lots = new Map();
  const sizes = new Map();
  inStockItems.forEach((it) => {
    const key = it.lot_id || "none";
    const e = lots.get(key) || { name: it.lots?.lot_name || "ไม่ระบุ Lot", count: 0 };
    e.count++; lots.set(key, e);
    const sz = (it.size || "").trim().toUpperCase();
    if (sz) sizes.set(sz, (sizes.get(sz) || 0) + 1);
  });
  const prevLot = lotSel.value, prevSize = sizeSel.value;
  lotSel.innerHTML = `<option value="">ทุก Lot (${inStockItems.length})</option>` +
    [...lots].map(([id, l]) => `<option value="${id}">${escapeHtml(l.name)} (${l.count})</option>`).join("");
  lotSel.value = lots.has(prevLot) ? prevLot : "";
  sizeSel.innerHTML = `<option value="">ทุกไซซ์</option>` +
    [...sizes].sort().map(([sz, n]) => `<option value="${escapeHtml(sz)}">${escapeHtml(sz)} (${n})</option>`).join("");
  sizeSel.value = sizes.has(prevSize) ? prevSize : "";
}

// ค้นหา: ตัวเลข 1–3 หลัก = เลขท้ายป้าย SKU (เช่น 17 → *-017) นอกนั้นค้นชื่อ/SKU/ไซซ์/Lot
function matchItem(item, q) {
  if (!q) return true;
  if (/^\d{1,3}$/.test(q) && item.sku) {
    if (item.sku.endsWith("-" + q.padStart(3, "0"))) return true;
  }
  const hay = [item.item_name, item.sku, item.size, item.condition, item.lots?.lot_name, item.lot_groups?.group_name]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
}

function applySearch() {
  if (activeTab === "sold") return renderSoldGrid(filterSold());
  const q = $("searchBox").value.trim().toLowerCase();
  const lotId = $("lotFilter").value;
  const size = $("sizeFilter").value;
  const list = inStockItems.filter((it) =>
    (!lotId || (it.lot_id || "none") === lotId) &&
    (!size || (it.size || "").trim().toUpperCase() === size) &&
    (!showReservedOnly || reservationsByItem[it.id]) &&
    matchItem(it, q));
  renderGrid(list);
}

function renderGrid(items) {
  $("gridCount").textContent = `${items.length} ชิ้น` + (showReservedOnly ? " ที่จองอยู่" : "");
  if (!items.length) {
    $("sellGrid").innerHTML = `<div class="empty-state">${inStockItems.length ? "ไม่พบสินค้าที่ค้นหา" : "ไม่มีของในสต็อกให้ขาย"}</div>`;
    return;
  }
  $("sellGrid").innerHTML = items.map((item) => {
    const img = thumbOf(item);
    const inCart = cart.has(item.id);
    const res = reservationsByItem[item.id];
    const tag = item.sku ? item.sku.split("-").pop() : "";
    return `
      <div class="pos-tile${inCart ? " in-cart" : ""}${res ? " reserved" : ""}">
        <button type="button" class="pos-tile-main" data-cart="${item.id}" aria-pressed="${inCart}" aria-label="${inCart ? "เอาออกจากตะกร้า" : "ใส่ตะกร้า"} ${escapeHtml(item.item_name)}">
          <div class="pos-tile-img">${img ? `<img src="${img}" alt="" loading="lazy" decoding="async">` : SHIRT_SVG}</div>
          ${tag ? `<span class="pos-tag">${escapeHtml(tag)}</span>` : ""}
          <span class="pos-price">${thb(S(item.current_price))}</span>
          ${res ? `<span class="pos-reserved">จอง: ${escapeHtml(res.customer_name)}</span>` : ""}
          ${inCart ? `<span class="pos-check" aria-hidden="true">✓</span>` : ""}
          <span class="pos-name">${escapeHtml(item.item_name)}<small>${escapeHtml(item.size || "-")} · ${escapeHtml(item.condition || "-")}</small></span>
        </button>
        <button type="button" class="pos-info" data-info="${item.id}" aria-label="ดูรายละเอียด ${escapeHtml(item.item_name)}">i</button>
      </div>`;
  }).join("");
}

// event delegation: กริดถูก render ใหม่บ่อย (ค้นหา/Realtime) จึงผูก listener ไว้ที่ตัวกริดครั้งเดียว
$("sellGrid").addEventListener("click", (e) => {
  const info = e.target.closest("[data-info]");
  if (info) return openItemDetail(info.dataset.info, "available");
  const tile = e.target.closest("[data-cart]");
  if (tile) toggleCart(tile.dataset.cart);
});

// ==========================================================
// ตะกร้า
// ==========================================================
function toggleCart(itemId) {
  const item = inStockItems.find((i) => i.id === itemId);
  if (!item) return;
  if (cart.has(itemId)) {
    cart.delete(itemId);
  } else {
    const res = reservationsByItem[itemId];
    if (res && !confirm(`ตัวนี้จองไว้ให้ "${res.customer_name}" — ขายให้คนจองตอนนี้เลยไหม?`)) return;
    cart.set(itemId, { price: S(item.current_price) });
  }
  onCartChanged();
}

function onCartChanged() {
  pendingBillId = null;           // ตะกร้าเปลี่ยน = บิลใหม่
  if (deal.mode !== "none") applyDeal(deal.mode, deal.total, true);
  applySearch();
  renderCartBar();
  if (!$("checkoutModal").classList.contains("hidden")) renderCheckout();
}

function cartLines() {
  return [...cart.entries()].map(([id, line]) => ({ item: inStockItems.find((i) => i.id === id), ...line })).filter((l) => l.item);
}
const cartTotal = () => cartLines().reduce((s, l) => s + l.price, 0);
const cartListTotal = () => cartLines().reduce((s, l) => s + S(l.item.current_price), 0);

function renderCartBar() {
  const lines = cartLines();
  $("cartBar").classList.toggle("hidden", !lines.length);
  document.body.classList.toggle("has-cart", lines.length > 0);
  $("cartCount").textContent = `${lines.length} ชิ้น`;
  $("cartTotal").textContent = thb(cartTotal());
  $("cartThumbs").innerHTML = lines.slice(-6).map((l) => {
    const img = thumbOf(l.item);
    return `<span class="cart-thumb">${img ? `<img src="${img}" alt="">` : SHIRT_SVG}</span>`;
  }).join("") + (lines.length > 6 ? `<span class="cart-more">+${lines.length - 6}</span>` : "");
}

$("cartClear").addEventListener("click", () => {
  if (!cart.size || !confirm("ล้างตะกร้าทั้งหมด?")) return;
  cart.clear(); deal = { mode: "none", total: null }; onCartChanged();
});
$("cartPay").addEventListener("click", openCheckout);

// ==========================================================
// ชำระเงิน: แก้ราคารายชิ้น / ดีล / วิธีจ่าย / เงินทอน / QR
// ==========================================================
function openCheckout() {
  if (!cart.size) return;
  setSeg("channelSeg", "channel", channel);
  setSeg("paySeg", "pay", payMethod);
  $("cashReceived").value = "";
  renderCheckout();
  $("checkoutModal").classList.remove("hidden");
}

function renderCheckout() {
  const lines = cartLines();
  if (!lines.length) { closeModal("checkoutModal"); return; }
  $("checkoutTitle").textContent = `ชำระเงิน · ${lines.length} ชิ้น`;
  $("checkoutLines").innerHTML = lines.map((l) => {
    const list = S(l.item.current_price);
    const img = thumbOf(l.item);
    return `<div class="co-line">
      <span class="co-thumb">${img ? `<img src="${img}" alt="">` : SHIRT_SVG}</span>
      <span class="co-name">${escapeHtml(l.item.item_name)}<small>${escapeHtml(l.item.sku || "")} · ป้าย ${thb(list)}</small></span>
      <input type="number" class="co-price${l.price !== list ? " changed" : ""}" data-line="${l.item.id}" value="${Money.toBaht(l.price)}" min="0" step="1" inputmode="numeric" aria-label="ราคาที่ตกลงของ ${escapeHtml(l.item.item_name)}">
      <button type="button" class="co-remove" data-remove="${l.item.id}" aria-label="เอาออก">×</button>
    </div>`;
  }).join("");
  document.querySelectorAll("#dealChips [data-deal]").forEach((b) => b.classList.toggle("active", b.dataset.deal === deal.mode));
  $("dealTotalRow").classList.toggle("hidden", deal.mode !== "total");
  renderTotals();
}

function renderTotals() {
  const total = cartTotal();
  const list = cartListTotal();
  $("sumList").textContent = thb(list);
  $("sumDiscount").textContent = list > total ? "−" + thb(list - total) : total > list ? "+" + thb(total - list) : "฿0";
  $("sumTotal").textContent = thb(total);
  $("cartTotal").textContent = thb(total);
  $("cashPanel").classList.toggle("hidden", payMethod !== "cash");
  $("qrPanel").classList.toggle("hidden", payMethod !== "transfer");
  if (payMethod === "cash") renderCash(total);
  if (payMethod === "transfer") renderQr(total);
}

// แก้ราคาชิ้นเดียว → ถือว่าตกลงรายชิ้นเอง (ไม่ใช้ดีลทั้งบิลแล้ว)
$("checkoutLines").addEventListener("input", (e) => {
  const input = e.target.closest("[data-line]");
  if (!input) return;
  const line = cart.get(input.dataset.line);
  if (!line) return;
  line.price = Math.max(0, S(input.value));
  deal = { mode: "lines", total: null };
  pendingBillId = null;
  document.querySelectorAll("#dealChips [data-deal]").forEach((b) => b.classList.remove("active"));
  $("dealTotalRow").classList.add("hidden");
  input.classList.toggle("changed", line.price !== S(inStockItems.find((i) => i.id === input.dataset.line)?.current_price));
  renderTotals();
});
$("checkoutLines").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove]");
  if (!btn) return;
  cart.delete(btn.dataset.remove);
  onCartChanged();
});

// ดีลทั้งบิล → กระจายลงแต่ละชิ้นตามสัดส่วน "ราคาป้าย"
function applyDeal(mode, totalBaht, silent) {
  const lines = cartLines();
  const listPrices = lines.map((l) => S(l.item.current_price));
  let prices = listPrices;
  if (mode === "10" || mode === "20") prices = Money.percentOffTotal(listPrices, Number(mode));
  if (mode === "total" && totalBaht !== null && totalBaht !== "" && Number(totalBaht) >= 0) prices = Money.distributeToTotal(listPrices, S(totalBaht));
  if (mode === "lines") return; // แก้รายชิ้นเองแล้ว ไม่ทับ
  lines.forEach((l, i) => { cart.get(l.item.id).price = prices[i]; });
  deal = { mode, total: mode === "total" ? totalBaht : null };
  pendingBillId = null;
  if (!silent) renderCheckout();
}
$("dealChips").addEventListener("click", (e) => {
  const b = e.target.closest("[data-deal]");
  if (!b) return;
  if (b.dataset.deal === "total") {
    deal = { mode: "total", total: $("dealTotal").value || null };
    renderCheckout();
    $("dealTotal").focus();
    return;
  }
  applyDeal(b.dataset.deal, null);
});
$("dealTotal").addEventListener("input", () => applyDeal("total", $("dealTotal").value, false));

// segmented buttons (ช่องทาง/วิธีจ่าย)
function setSeg(segId, attr, value) {
  document.querySelectorAll(`#${segId} [data-${attr}]`).forEach((b) => b.classList.toggle("active", b.dataset[attr] === value));
}
$("channelSeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-channel]");
  if (!b) return;
  channel = b.dataset.channel; safeSet("vims_pos_channel", channel);
  setSeg("channelSeg", "channel", channel);
});
$("paySeg").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay]");
  if (!b) return;
  payMethod = b.dataset.pay;
  setSeg("paySeg", "pay", payMethod);
  renderTotals();
});

function renderCash(total) {
  $("quickCash").innerHTML = Money.quickCashOptions(total).map((v, i) =>
    `<button type="button" class="pos-chip" data-cash="${Money.toBaht(v)}">${i === 0 ? "พอดี " : ""}${thb(v)}</button>`).join("");
  updateChange();
}
$("quickCash").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cash]");
  if (!b) return;
  $("cashReceived").value = b.dataset.cash;
  updateChange();
});
$("cashReceived").addEventListener("input", updateChange);
function updateChange() {
  const total = cartTotal();
  const raw = $("cashReceived").value;
  const el = $("changeDue");
  if (raw === "") { el.textContent = "รับพอดี ไม่ต้องทอน"; el.className = "change-due"; return true; }
  const change = Money.changeDue(total, S(raw));
  if (change === null) { el.textContent = `รับเงินไม่พอ ขาดอีก ${thb(total - S(raw))}`; el.className = "change-due short"; return false; }
  el.innerHTML = `ทอน <b>${thb(change)}</b>`;
  el.className = "change-due ok";
  return true;
}

// QR พร้อมเพย์ตามยอด (ลูกค้าสแกนแล้วยอดขึ้นเอง ไม่ต้องพิมพ์)
function renderQr(total) {
  const payload = Money.promptPayPayload(posSettings.promptpay_id, Money.toBaht(total));
  if (!payload) {
    $("qrBox").innerHTML = `<button type="button" class="btn btn-ghost" id="qrSetup">ตั้งค่าเบอร์พร้อมเพย์ก่อน</button>`;
    $("qrCaption").textContent = "ยังไม่มีเลขพร้อมเพย์ — ลูกค้าโอนเองแล้วกดยืนยันได้";
    $("qrSetup").addEventListener("click", openPosSettings);
    return;
  }
  if (typeof qrcode !== "function") { $("qrBox").textContent = "โหลดตัวสร้าง QR ไม่สำเร็จ (ตรวจอินเทอร์เน็ต)"; return; }
  const qr = qrcode(0, "M");
  qr.addData(payload);
  qr.make();
  $("qrBox").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  $("qrCaption").innerHTML = `พร้อมเพย์ ${escapeHtml(maskId(posSettings.promptpay_id))} · <b>${thb(total)}</b><br>เช็กยอดเข้าแอปธนาคารก่อนกดยืนยัน`;
}
function maskId(id) { const d = String(id).replace(/\D/g, ""); return d.length > 4 ? "xxx-" + d.slice(-4) : d; }

// ==========================================================
// ยืนยันขาย → sell_bill
// ==========================================================
$("confirmSale").addEventListener("click", confirmSale);
async function confirmSale() {
  const lines = cartLines();
  if (!lines.length) return;
  if (payMethod === "cash" && !updateChange()) return showToast("รับเงินไม่พอ");
  const btn = $("confirmSale");
  btn.disabled = true; btn.textContent = "กำลังบันทึก...";

  pendingBillId ||= crypto.randomUUID(); // ลองใหม่ด้วย id เดิม = ไม่เกิดบิลซ้ำ
  const received = payMethod === "cash" && $("cashReceived").value !== "" ? Money.toBaht(S($("cashReceived").value)) : null;
  const snapshot = lines.map((l) => ({ name: l.item.item_name, sku: l.item.sku, price: l.price, list: S(l.item.current_price) }));
  const hasReserved = lines.some((l) => reservationsByItem[l.item.id]);

  const { data, error } = await supabaseClient.rpc("sell_bill", {
    p_bill_id: pendingBillId,
    p_lines: lines.map((l) => ({ item_id: l.item.id, price: Money.toBaht(l.price) })),
    p_payment_method: payMethod,
    p_channel: channel,
    p_cash_received: received,
    p_note: null,
    p_sell_reserved: hasReserved,
  });
  btn.disabled = false; btn.textContent = "ยืนยันขาย";

  if (error) {
    console.error(error);
    if (/sell_bill/.test(error.message || "") && /function|schema cache/i.test(error.message || "")) {
      return showToast("ฐานข้อมูลยังไม่มี sell_bill — รัน sql/migration_v19_pos_shift.sql ก่อน");
    }
    // ถ้าเป็นปัญหาเน็ต เก็บ pendingBillId ไว้ กดยืนยันอีกครั้งจะไม่เกิดบิลซ้ำ
    return showToast("บันทึกไม่สำเร็จ: " + error.message + " — กดยืนยันอีกครั้งได้");
  }

  lastBill = {
    id: data.bill_id, no: data.bill_no, total: S(data.total), list: S(data.list_total),
    lines: snapshot, pay: payMethod, channel, received: received === null ? null : S(received), at: new Date(),
  };
  cart.clear();
  deal = { mode: "none", total: null };
  pendingBillId = null;
  $("dealTotal").value = "";
  closeModal("checkoutModal");
  renderCartBar();
  openReceipt();
  loadSellGrid();
}

// ==========================================================
// ใบเสร็จ + เลิกทำ 5 วินาที
// ==========================================================
function openReceipt() {
  const b = lastBill;
  const change = b.received !== null ? b.received - b.total : null;
  $("receiptTitle").textContent = `ขายแล้ว · บิล #${b.no}`;
  $("receiptBody").innerHTML = `
    ${b.lines.map((l) => `<div class="rc-line"><span>${escapeHtml(l.name)}</span><span>${l.price !== l.list ? `<s>${thb(l.list)}</s> ` : ""}${thb(l.price)}</span></div>`).join("")}
    <div class="rc-total"><span>รวม</span><b>${thb(b.total)}</b></div>
    <div class="rc-meta">${paymentLabel(b.pay)} · ${channelLabel(b.channel)}${change !== null ? ` · รับ ${thb(b.received)} ทอน ${thb(change)}` : ""}</div>`;
  $("receiptModal").classList.remove("hidden");
  startUndoCountdown();
}

function startUndoCountdown() {
  clearInterval(undoTimer);
  const btn = $("undoSale");
  let left = 5;
  btn.classList.remove("hidden");
  btn.disabled = false;
  btn.textContent = `เลิกทำ (${left})`;
  undoTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) { clearInterval(undoTimer); btn.classList.add("hidden"); return; }
    btn.textContent = `เลิกทำ (${left})`;
  }, 1000);
}

$("undoSale").addEventListener("click", async () => {
  if (!lastBill) return;
  clearInterval(undoTimer);
  const btn = $("undoSale");
  btn.disabled = true; btn.textContent = "กำลังยกเลิก...";
  const { error } = await supabaseClient.rpc("void_bill", { p_bill_id: lastBill.id, p_reason: "เลิกทำทันทีหลังขาย" });
  if (error) { btn.disabled = false; btn.textContent = "เลิกทำ"; return showToast("ยกเลิกไม่สำเร็จ: " + error.message); }
  showToast(`ยกเลิกบิล #${lastBill.no} แล้ว — สินค้ากลับเข้าสต็อก`);
  lastBill = null;
  closeModal("receiptModal");
  loadSellGrid();
});
$("nextCustomer").addEventListener("click", () => { clearInterval(undoTimer); closeModal("receiptModal"); $("searchBox").focus(); });

// วาดใบเสร็จเป็นรูป → แชร์ (LINE/IG ผ่าน share sheet) หรือดาวน์โหลด
$("shareReceipt").addEventListener("click", async () => {
  if (!lastBill) return;
  const blob = await drawReceipt(lastBill);
  const file = new File([blob], `receipt-${lastBill.no}.png`, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: `ใบเสร็จ #${lastBill.no}` });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return; // ผู้ใช้กดยกเลิกเอง
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

async function drawReceipt(b) {
  const W = 600, pad = 36, lh = 34;
  const H = 260 + b.lines.length * lh + (posSettings.receipt_note ? 40 : 0);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  try { await document.fonts?.ready; } catch (_) {}
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#161923"; g.textBaseline = "alphabetic";
  g.font = "600 28px Prompt, sans-serif"; g.textAlign = "center";
  g.fillText(posSettings.shop_name || "Bubbles Gumps", W / 2, 56);
  g.font = "400 18px Prompt, sans-serif"; g.fillStyle = "#5b6178";
  g.fillText(`ใบเสร็จ #${b.no} · ${b.at.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}`, W / 2, 88);
  let y = 132;
  g.textAlign = "left"; g.fillStyle = "#161923"; g.font = "400 20px Prompt, sans-serif";
  b.lines.forEach((l) => {
    const name = l.name.length > 30 ? l.name.slice(0, 29) + "…" : l.name;
    g.textAlign = "left"; g.fillText(name, pad, y);
    g.textAlign = "right"; g.fillText(thb(l.price), W - pad, y);
    y += lh;
  });
  g.strokeStyle = "#e4e6f0"; g.beginPath(); g.moveTo(pad, y - 12); g.lineTo(W - pad, y - 12); g.stroke();
  y += 20;
  g.font = "700 26px Prompt, sans-serif"; g.textAlign = "left"; g.fillText("รวม", pad, y);
  g.textAlign = "right"; g.fillText(thb(b.total), W - pad, y);
  y += 34;
  g.font = "400 18px Prompt, sans-serif"; g.fillStyle = "#5b6178"; g.textAlign = "left";
  const change = b.received !== null ? ` · รับ ${thb(b.received)} ทอน ${thb(b.received - b.total)}` : "";
  g.fillText(`${paymentLabel(b.pay)}${change}`, pad, y);
  if (posSettings.receipt_note) { y += 40; g.textAlign = "center"; g.fillText(posSettings.receipt_note, W / 2, y); }
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

// ==========================================================
// แท็บบิล: ยกเลิกทั้งบิล / คืนทีละชิ้น
// ==========================================================
async function loadBills() {
  const { data, error } = await supabaseClient
    .from("bills")
    .select("id, bill_no, created_at, channel, payment_method, total, list_total, voided_at, void_reason, sales(id, sale_price, list_price, voided_at, void_reason, items(item_name, sku))")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) {
    $("billsList").innerHTML = `<div class="empty-state">โหลดบิลไม่สำเร็จ — รัน sql/migration_v19_pos_shift.sql แล้วหรือยัง?</div>`;
    return;
  }
  if (!data?.length) { $("billsList").innerHTML = `<div class="empty-state">ยังไม่มีบิล</div>`; return; }
  $("billsList").innerHTML = data.map((b) => {
    const active = (b.sales || []).filter((s) => !s.voided_at);
    const now = active.reduce((s, x) => s + S(x.sale_price), 0);
    return `<div class="bill-card${b.voided_at ? " voided" : ""}">
      <div class="bill-head">
        <b>#${b.bill_no}</b>
        <span>${formatDateTime(b.created_at)} · ${channelLabel(b.channel)} · ${paymentLabel(b.payment_method)}</span>
        <strong>${thb(now)}</strong>
      </div>
      ${(b.sales || []).map((s) => `<div class="bill-line${s.voided_at ? " voided" : ""}">
        <span>${escapeHtml(s.items?.item_name || "-")} <small>${escapeHtml(s.items?.sku || "")}</small></span>
        <span>${thb(S(s.sale_price))}</span>
        ${s.voided_at ? `<span class="voided-tag" title="${escapeHtml(s.void_reason || "")}">คืนแล้ว</span>` : b.voided_at ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-refund="${s.id}">คืนชิ้นนี้</button>`}
      </div>`).join("")}
      ${b.voided_at ? `<div class="bill-void-note">ยกเลิกแล้ว${b.void_reason ? " · " + escapeHtml(b.void_reason) : ""}</div>`
        : `<button type="button" class="btn btn-ghost btn-sm bill-void" data-void-bill="${b.id}" data-no="${b.bill_no}">ยกเลิกทั้งบิล</button>`}
    </div>`;
  }).join("");
}

$("billsList").addEventListener("click", async (e) => {
  const refund = e.target.closest("[data-refund]");
  const voidBtn = e.target.closest("[data-void-bill]");
  if (!refund && !voidBtn) return;
  const reason = (prompt(refund ? "เหตุผลที่คืน (เช่น ไซซ์ไม่พอดี / มีตำหนิ):" : "เหตุผลที่ยกเลิกทั้งบิล:", "") || "").trim();
  if (!reason) return showToast("ต้องใส่เหตุผลทุกครั้ง");
  const { error } = refund
    ? await supabaseClient.rpc("void_sale", { p_sale_id: refund.dataset.refund, p_reason: reason })
    : await supabaseClient.rpc("void_bill", { p_bill_id: voidBtn.dataset.voidBill, p_reason: reason });
  if (error) return showToast("ไม่สำเร็จ: " + error.message);
  showToast(refund ? "คืนแล้ว — สินค้ากลับเข้าสต็อก" : `ยกเลิกบิล #${voidBtn.dataset.no} แล้ว`);
  soldLoaded = false;
  loadBills();
  loadSellGrid();
});

// ==========================================================
// แท็บขายแล้ว (ของเดิม)
// ==========================================================
async function loadSoldGrid() {
  const { data: sales, error } = await supabaseClient
    .from("sales")
    .select("item_id, sale_price, sale_date, items(id, item_name, size, condition, tier, cost_price, base_price, sku, lot_id, group_id, lots(lot_name), lot_groups(group_name))")
    .is("voided_at", null)
    .order("sale_date", { ascending: false })
    .limit(300);
  if (error) {
    console.error(error);
    $("soldGrid").innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ</div>`;
    return;
  }
  soldItems = (sales || []).filter((s) => s.items).map((s) => ({ ...s.items, current_price: s.sale_price, _saleDate: s.sale_date }));
  soldImagesById = await loadImages(soldItems.map((i) => i.id));
  soldLoaded = true;
  renderSoldGrid(filterSold());
}
function filterSold() {
  const q = $("soldSearch").value.trim().toLowerCase();
  return soldItems.filter((it) => matchItem(it, q));
}
function renderSoldGrid(items) {
  if (!items.length) { $("soldGrid").innerHTML = `<div class="empty-state">ยังไม่มีของที่ขายแล้ว</div>`; return; }
  $("soldGrid").innerHTML = items.map((item) => {
    const img = thumbOf(item, soldImagesById);
    return `<button class="item-tile tile-sold" data-id="${item.id}">
      <div class="item-tile-image">${img ? `<img src="${img}" alt="" loading="lazy">` : SHIRT_SVG}</div>
      <div class="name">${escapeHtml(item.item_name)}</div>
      <div class="meta">${escapeHtml(item.size || "-")} · ${item.condition || "-"}</div>
      <div class="price">${formatBaht(item.current_price)}</div>
      <div class="item-tile-sold-date">${formatDateTime(item._saleDate)}</div>
    </button>`;
  }).join("");
}
$("soldGrid").addEventListener("click", (e) => {
  const t = e.target.closest("[data-id]");
  if (t) openItemDetail(t.dataset.id, "sold");
});
$("soldSearch").addEventListener("input", applySearch);

// ==========================================================
// รายละเอียดสินค้า + จอง
// ==========================================================
async function openItemDetail(itemId, context) {
  detailContext = context;
  const item = (context === "sold" ? soldItems : inStockItems).find((r) => r.id === itemId);
  if (!item) return;
  detailItem = item;
  const imgs = (context === "sold" ? soldImagesById : imagesById)[item.id] || [];
  $("detailImage1").innerHTML = imgs[0] ? `<img src="${imgs[0].image_url}" alt="">` : SHIRT_SVG;
  $("detailImage2").innerHTML = imgs[1] ? `<img src="${imgs[1].image_url}" alt="">` : "";
  $("detailImage2").classList.toggle("hidden", !imgs[1]);
  $("detailName").textContent = item.item_name;
  $("detailMeta").textContent = `${item.sku ? item.sku + " · " : ""}${item.size || "ไม่ระบุไซซ์"} · ${item.condition || "-"} · ${item.tier === "head" ? "งานหัว" : "ปกติ"}`;
  $("detailLot").textContent = item.lots?.lot_name || "-";
  $("detailGroup").textContent = item.lot_groups?.group_name || "-";
  $("detailCost").textContent = formatBaht(item.cost_price);
  $("detailBasePrice").textContent = formatBaht(item.base_price);
  $("detailCurrentPrice").textContent = formatBaht(item.current_price);

  const res = context === "available" ? reservationsByItem[item.id] : null;
  $("detailActions").classList.toggle("hidden", context === "sold");
  $("detailAddCart").textContent = cart.has(item.id) ? "เอาออกจากตะกร้า" : "ใส่ตะกร้า";
  $("detailReserve").classList.toggle("hidden", !!res);
  $("reserveBox").classList.toggle("hidden", !res);
  if (res) {
    $("reserveBox").innerHTML = `<div><b>จองโดย ${escapeHtml(res.customer_name)}</b>
      <span>${channelLabel(res.channel)}${res.due_date ? " · ภายใน " + formatDate(res.due_date) : ""}${Number(res.deposit) ? " · มัดจำ " + formatBaht(res.deposit) : ""}${res.note ? " · " + escapeHtml(res.note) : ""}</span></div>
      <button type="button" class="btn btn-ghost btn-sm" id="releaseReserve">ยกเลิกจอง</button>`;
    $("releaseReserve").addEventListener("click", () => releaseReservation(res));
  }

  const { data: sales } = await supabaseClient
    .from("sales")
    .select("id, sale_date, sale_price, cost_price, payment_method, channel, voided_at, void_reason")
    .eq("item_id", item.id)
    .order("sale_date", { ascending: false });
  renderSaleHistory(sales || []);
  $("saleDetailModal").classList.remove("hidden");
}

function renderSaleHistory(sales) {
  const el = $("saleHistory");
  if (!sales.length) { el.innerHTML = `<div class="empty-state small">ยังไม่มีประวัติการขาย</div>`; return; }
  el.innerHTML = sales.map((sale) => {
    const profit = Number(sale.sale_price || 0) - Number(sale.cost_price || 0);
    return `<div class="sale-history-row ${sale.voided_at ? "voided" : ""}">
      <div><b>${formatBaht(sale.sale_price)}</b><span>${formatDateTime(sale.sale_date)}</span></div>
      <div><span>${paymentLabel(sale.payment_method)}</span><span>${channelLabel(sale.channel)}</span></div>
      <strong class="${profit >= 0 ? "profit" : "loss"}">${profit >= 0 ? "+" : ""}${formatBaht(profit)}</strong>
      ${sale.voided_at ? `<span class="voided-tag" title="${escapeHtml(sale.void_reason || "")}">ยกเลิกแล้ว</span>` : ""}
    </div>`;
  }).join("");
}

$("detailAddCart").addEventListener("click", () => {
  if (!detailItem) return;
  closeModal("saleDetailModal");
  toggleCart(detailItem.id);
});
$("detailReserve").addEventListener("click", () => {
  if (!detailItem) return;
  $("reserveItemName").textContent = `${detailItem.item_name}${detailItem.sku ? " · " + detailItem.sku : ""} · ${formatBaht(detailItem.current_price)}`;
  $("reserveForm").reset();
  const due = new Date(Date.now() + 3 * 86400000); // ค่าเริ่มต้น: ภายใน 3 วัน
  $("reserveDue").value = due.toISOString().slice(0, 10);
  closeModal("saleDetailModal");
  $("reserveModal").classList.remove("hidden");
  $("reserveName").focus();
});
$("reserveForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!detailItem) return;
  const { error } = await supabaseClient.rpc("reserve_item", {
    p_item_id: detailItem.id,
    p_customer_name: $("reserveName").value.trim(),
    p_channel: $("reserveChannel").value,
    p_deposit: Number($("reserveDeposit").value) || 0,
    p_due_date: $("reserveDue").value || null,
    p_note: $("reserveNote").value.trim() || null,
  });
  if (error) return showToast("จองไม่สำเร็จ: " + error.message);
  showToast(`จองให้ ${$("reserveName").value.trim()} แล้ว`);
  cart.delete(detailItem.id);
  closeModal("reserveModal");
  loadSellGrid();
});
async function releaseReservation(res) {
  if (!confirm(`ยกเลิกการจองของ ${res.customer_name}? สินค้าจะกลับมาขายได้ตามปกติ`)) return;
  const { error } = await supabaseClient.rpc("release_reservation", { p_reservation_id: res.id });
  if (error) return showToast("ไม่สำเร็จ: " + error.message);
  showToast("ยกเลิกการจองแล้ว");
  closeModal("saleDetailModal");
  loadSellGrid();
}

// ==========================================================
// ตั้งค่าหน้าร้าน (พร้อมเพย์ / ใบเสร็จ) → app_settings.pos_settings
// ==========================================================
function openPosSettings() {
  $("setPromptPay").value = posSettings.promptpay_id || "";
  $("setShopName").value = posSettings.shop_name || "";
  $("setReceiptNote").value = posSettings.receipt_note || "";
  $("posSettingsModal").classList.remove("hidden");
}
$("openPosSettings").addEventListener("click", openPosSettings);
$("posSettingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("setPromptPay").value.trim();
  if (id && !Money.normalizePromptPayId(id)) return showToast("เลขพร้อมเพย์ต้องเป็นเบอร์ 10 หลัก หรือเลขบัตร 13 หลัก");
  const value = { promptpay_id: id, shop_name: $("setShopName").value.trim() || "Bubbles Gumps", receipt_note: $("setReceiptNote").value.trim() };
  const { error } = await supabaseClient.from("app_settings").upsert({ key: "pos_settings", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return showToast("บันทึกไม่สำเร็จ: " + error.message);
  posSettings = value;
  showToast("บันทึกการตั้งค่าแล้ว");
  closeModal("posSettingsModal");
  if (!$("checkoutModal").classList.contains("hidden")) renderTotals();
});

// ==========================================================
// แท็บ / ตัวกรอง / คอลัมน์
// ==========================================================
document.querySelectorAll(".sell-tab").forEach((tab) => {
  tab.addEventListener("click", async () => {
    activeTab = tab.dataset.tab;
    document.querySelectorAll(".sell-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("availableView").classList.toggle("hidden", activeTab !== "available");
    $("billsView").classList.toggle("hidden", activeTab !== "bills");
    $("soldView").classList.toggle("hidden", activeTab !== "sold");
    $("cartBar").classList.toggle("tab-hidden", activeTab !== "available");
    if (activeTab === "bills") await loadBills();
    else if (activeTab === "sold" && !soldLoaded) await loadSoldGrid();
    else applySearch();
  });
});
$("searchBox").addEventListener("input", applySearch);
$("lotFilter").addEventListener("change", applySearch);
$("sizeFilter").addEventListener("change", applySearch);
$("reservedFilter").addEventListener("click", () => {
  showReservedOnly = !showReservedOnly;
  $("reservedFilter").classList.toggle("active", showReservedOnly);
  $("reservedFilter").setAttribute("aria-pressed", String(showReservedOnly));
  applySearch();
});
// มือถือ: สลับ 2 คอลัมน์ (รูปใหญ่ ดูง่าย) / 3 คอลัมน์ (เห็นของเยอะ)
function applyCols(n) {
  $("sellGrid").classList.toggle("cols-2", n === 2);
  $("sellGrid").classList.toggle("cols-3", n === 3);
  $("colsToggle").textContent = n === 2 ? "3 คอลัมน์" : "2 คอลัมน์";
}
let gridCols = safeGet("vims_pos_cols") === "3" ? 3 : 2;
applyCols(gridCols);
$("colsToggle").addEventListener("click", () => { gridCols = gridCols === 2 ? 3 : 2; safeSet("vims_pos_cols", String(gridCols)); applyCols(gridCols); });

// ปิด modal
function closeModal(id) { $(id)?.classList.add("hidden"); }
$("closeCheckout").addEventListener("click", () => closeModal("checkoutModal"));
$("closeSaleDetail").addEventListener("click", () => closeModal("saleDetailModal"));
$("closeReserve").addEventListener("click", () => closeModal("reserveModal"));
$("closePosSettings").addEventListener("click", () => closeModal("posSettingsModal"));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  ["posSettingsModal", "reserveModal", "saleDetailModal", "checkoutModal"].some((id) => {
    if (!$(id).classList.contains("hidden")) { closeModal(id); return true; }
    return false;
  });
});

// ---------- helpers ----------
function paymentLabel(v) { return ({ cash: "เงินสด", transfer: "โอน", government: "โครงการรัฐ" })[v] || v || "-"; }
function channelLabel(v) { return ({ street_market: "ถนนคนเดิน", facebook: "Facebook", instagram: "Instagram" })[v] || v || "-"; }
function formatDateTime(v) { return v ? new Date(v).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
function escapeHtml(v = "") { return String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function showToast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove("show"), 3000);
}

// ==========================================================
// REALTIME: อีกเครื่องขาย/แก้ของ → โหลดกริดใหม่ (ตะกร้าจะตัดของที่หายไปให้เอง)
// ==========================================================
const reloadSellDebounced = debounce(() => {
  loadSellGrid();
  if (activeTab === "bills") loadBills();
  if (activeTab === "sold") loadSoldGrid();
}, 600);
window.addEventListener("vims:realtime", (event) => {
  const table = event.detail?.table;
  if (table === "page_refresh" || ["items", "item_images", "sales", "bills", "reservations"].includes(table)) {
    soldLoaded = false;
    reloadSellDebounced();
  }
});

// มือถือ: วัดความสูงเมนูล่างจริง ให้แถบตะกร้าลอยเหนือเมนูพอดี
function updateNavOffset() {
  const nav = document.getElementById("sidebar");
  const mobile = window.matchMedia("(max-width: 859.98px)").matches;
  document.documentElement.style.setProperty("--nav-h", mobile && nav ? nav.offsetHeight + "px" : "0px");
}
updateNavOffset();
window.addEventListener("resize", debounce(updateNavOffset, 150));

// modal อยู่ใต้ <body> แล้วใน HTML (เหนือเมนูล่างบนมือถือ)
loadPosSettings();
loadSellGrid();
