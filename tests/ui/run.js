const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");
const ROOT = path.resolve(__dirname, "../..");
const OUT = __dirname;
const MOCK = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const QR = fs.readFileSync(path.join(__dirname, "node_modules/qrcode-generator/qrcode.js"), "utf8");

const FONT_CSS = ["prompt","inter"].flatMap(f => [400,500,600,700].flatMap(w => ["thai","latin"].map(sub => {
  const file = `node_modules/@fontsource/${f}/files/${f}-${sub}-${w}-normal.woff2`;
  if (!fs.existsSync(path.join(__dirname, file))) return "";
  return `@font-face{font-family:'${f === "prompt" ? "Prompt" : "Inter"}';font-weight:${w};font-style:normal;src:url(http://localhost:8765/__f/${file}) format('woff2');${sub==="thai"?"unicode-range:U+0E01-0E5B,U+200C-200D,U+25CC;":""}}`;
}))).join("\n");
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/__f/")) { res.writeHead(200, {"content-type":"font/woff2"}); return res.end(fs.readFileSync(path.join(__dirname, req.url.slice(5)))); }
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    const t = p.endsWith(".html") ? "text/html" : p.endsWith(".css") ? "text/css" : "application/javascript";
    res.writeHead(200, { "content-type": t + "; charset=utf-8" }); res.end(d);
  });
}).listen(8765);

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function page(w, h) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    await pg.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase-js")) return route.fulfill({ body: MOCK, contentType: "application/javascript" });
      if (u.includes("qrcode-generator")) return route.fulfill({ body: QR, contentType: "application/javascript" });
      if (u.includes("fonts.googleapis.com/css")) return route.fulfill({ body: FONT_CSS, contentType: "text/css" });
      if (u.includes("xlsx")) return route.fulfill({ body: "window.XLSX={};", contentType: "application/javascript" });
      if (u.includes("chart.js")) return route.fulfill({ body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript" });
      if (u.startsWith("http://localhost:8765")) return route.continue();
      if (u.startsWith("data:")) return route.continue();
      return route.abort();
    });
    pg.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    pg.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
    pg.on("requestfailed", (r) => { if (!r.url().startsWith("data:")) errors.push("requestfailed: " + r.url().slice(0, 120)); });
    pg.on("dialog", (d) => d.accept(d.type() === "prompt" ? "ไซซ์ไม่พอดี" : undefined));
    return pg;
  }
  const shot = (pg, n) => pg.screenshot({ path: path.join(OUT, n + ".png"), fullPage: false });

  // ---------- มือถือ: หน้าหลัก เปิดกะ + ค่าใช้จ่าย ----------
  const m = await page(390, 844);
  await m.goto("http://localhost:8765/index.html");
  await m.waitForSelector(".shift-open");
  await m.click(".shift-open button[type=submit]");
  await m.waitForSelector(".shift-pill.open");
  await m.click('[data-quick="ค่าเช่าแผง"]');
  await m.fill('[data-form="expense"] [name="amount"]', "200");
  await m.click('[data-form="expense"] button[type=submit]');
  await m.waitForTimeout(400);
  await m.waitForTimeout(300);
  await shot(m, "01-main-shift");

  // ---------- ขาย ----------
  await m.goto("http://localhost:8765/sell.html");
  await m.waitForSelector(".pos-tile");
  await m.click('[data-cart="it0"]');
  await m.click('[data-cart="it1"]');
  await m.click('[data-cart="it2"]');
  await m.waitForTimeout(200);
  await shot(m, "02-sell-grid-cart");
  await m.fill("#searchBox", "7");
  await m.waitForTimeout(100);
  const found = await m.$$eval(".pos-tile", (t) => t.length);
  console.log("search '7' tiles:", found);
  await m.fill("#searchBox", "");
  await m.click("#cartPay");
  await m.click('[data-deal="total"]');
  await m.fill("#dealTotal", "650");
  await m.waitForTimeout(100);
  const lines = await m.$$eval(".co-price", (els) => els.map((e) => e.value));
  console.log("deal 650 ->", lines);
  await m.click('[data-cash="1000"]').catch(() => {});
  await m.waitForTimeout(100);
  await shot(m, "03-checkout");
  await m.click('[data-pay="transfer"]');
  await m.waitForTimeout(150);
  const qr = await m.$eval("#qrBox", (e) => e.innerHTML.slice(0, 40));
  console.log("qr:", qr);
  await shot(m, "04-checkout-qr");
  await m.click('[data-pay="cash"]');
  await m.fill("#cashReceived", "1000");
  await m.evaluate(() => { window.__failRpc = "sell_bill"; });
  // V20: เน็ตหลุดตอนขาย → บิลเข้าคิวในเครื่อง ขายต่อได้ แล้วส่งเองเมื่อเน็ตกลับ
  await m.click("#confirmSale");
  await m.waitForSelector("#receiptModal:not(.hidden)");
  console.log("receipt (offline):", await m.$eval("#receiptTitle", (e) => e.textContent));
  await shot(m, "05-receipt-queued");
  await m.click("#nextCustomer");
  await m.waitForTimeout(300);
  console.log("queue banner:", await m.$eval("#offlineQueueBtn", (e) => e.textContent));
  console.log("tiles while queued (expect 5):", await m.$$eval(".pos-tile", (t) => t.length));
  await shot(m, "05b-queue-banner");
  await m.evaluate(() => OfflineSales.flush());
  await m.waitForTimeout(800);
  console.log("after flush banner hidden:", await m.$eval("#offlineQueueBtn", (e) => e.classList.contains("hidden")), "bills:", await m.evaluate(() => window.__mockdb().bills.length));

  // จอง
  await m.click('[data-info="it3"]');
  await m.waitForSelector("#saleDetailModal:not(.hidden)");
  await m.click("#detailReserve");
  await m.fill("#reserveName", "@prae.v");
  await m.click("#reserveForm button[type=submit]");
  await m.waitForTimeout(400);
  await shot(m, "06-reserved-badge");
  await m.click('[data-tab="reservations"]');
  await m.waitForSelector(".res-card");
  console.log("reservation cards:", await m.$$eval(".res-card", (t) => t.length), "badge:", await m.$eval("#resBadge", (e) => e.textContent));
  await shot(m, "06b-reservations-tab");

  // บิล
  await m.click('[data-tab="bills"]');
  await m.waitForSelector(".bill-card");
  await m.click("[data-refund]");
  await m.waitForSelector(".notify-dialog");
  await m.click(".nd-ok");
  await m.waitForTimeout(150);
  await shot(m, "07a-prompt-required");
  await m.fill(".nd-input", "ไซซ์ไม่พอดี");
  await m.click(".nd-ok");
  await m.waitForTimeout(500);
  await shot(m, "07-bills");

  // ---------- ปิดกะ ----------
  await m.goto("http://localhost:8765/index.html");
  await m.waitForSelector(".shift-close-btn");
  await shot(m, "08-main-after-sale");
  // V21: การ์ด "รายการ" พับไว้ แตะแล้วเห็นแถว — แถวโชว์รายละเอียด (ชื่อสินค้า/หมวด) ไม่ใช่คำว่ารายรับ/รายจ่าย
  await m.waitForSelector("#moneyList .money-row", { state: "attached" });
  console.log("list hidden before tap:", !(await m.isVisible("#moneyList .money-row")));
  await m.click(".money-list-card summary");
  console.log("money rows:", await m.$$eval("#moneyList .money-row", (r) => r.map((x) => x.textContent.replace(/\s+/g, " ").trim())));
  await m.screenshot({ path: path.join(OUT, "08c-money-list.png"), fullPage: true });
  // V21: ปุ่ม + ลอย → แผ่นเพิ่มค่าใช้จ่ายเปิดที่หมวดล่าสุด, แตะพื้นหลังมืดแล้วปิด
  await m.click("#addExpenseFab");
  console.log("fab sheet open:", await m.isVisible("#expenseSheet [data-form=expense]"), "cat:", await m.inputValue("#expenseSheet [name=category]"));
  await m.waitForTimeout(400);
  await m.screenshot({ path: path.join(OUT, "08d-fab-sheet.png") });
  await m.mouse.click(5, 5);
  console.log("fab sheet closed:", !(await m.isVisible("#expenseSheet [data-form=expense]")));
  // V21: แท็บ "รับ (เติมทุน)" → capital_entries แล้วโผล่ในการ์ดรายการ (สีเขียว)
  await m.click("#addExpenseFab");
  await m.click('#expenseSheet [data-type="in"]');
  await m.fill("#expenseSheet [data-form=income] [name=amount]", "1000");
  await m.fill("#expenseSheet [data-form=income] [name=reason]", "โอนเงินเก็บมาซื้อล็อต");
  await m.click("#expenseSheet [data-form=income] button[type=submit]");
  await m.waitForTimeout(1200);
  console.log("capital rows:", await m.evaluate(() => window.__mockdb().capital_entries.map((c) => c.entry_type + ":" + c.amount)));
  console.log("list has เติมทุน:", await m.$$eval("#moneyList .money-row.in", (r) => r.some((x) => x.textContent.includes("เติมทุน"))));
  // V21: แตะแถวค่าใช้จ่าย → แผ่นแก้ (ยอดเดิม) → แก้หมายเหตุ → บันทึก
  if (!(await m.isVisible("#moneyList .money-row"))) await m.click(".money-list-card summary");
  await m.click("#moneyList button.money-row");
  console.log("edit sheet:", await m.textContent("#exTitle"), "amount:", await m.inputValue("#expenseSheet [name=amount]"));
  await m.fill("#expenseSheet [name=note]", "แก้ทดสอบ");
  await m.click("#expenseSheet [data-form=expense] button[type=submit]");
  await m.waitForTimeout(1200);
  console.log("edited note:", await m.evaluate(() => window.__mockdb().expenses.map((e) => e.category + ":" + e.amount + ":" + e.note)));
  await m.click('[data-del]');
  await m.waitForSelector(".notify-dialog");
  await m.waitForTimeout(400);
  await shot(m, "08b-confirm-delete");
  await m.click(".nd-cancel");
  await m.waitForTimeout(300);
  await m.click(".shift-close-btn");
  await m.fill("#csCounted", "1100");
  await m.fill("#csReason", "ทอนผิด");
  await m.click("#csSubmit");
  await m.waitForSelector("#csResult:not(.hidden)");
  console.log(await m.$eval(".cs-summary", (e) => e.textContent));
  console.log("Z", await m.evaluate(() => { const n = document.querySelector('.notify'); if (!n) return 'no notify'; const r = n.getBoundingClientRect(); const e = document.elementFromPoint(r.x + 40, r.y + 12); return [getComputedStyle(document.getElementById('notifyStack')).zIndex, getComputedStyle(document.getElementById('closeShiftModal')).zIndex, e.id || e.className, document.getElementById('notifyStack').parentElement.tagName]; }));
  await m.waitForTimeout(400);
  await shot(m, "09-close-shift");

  // ---------- สินค้า: ลงของ 1 ชิ้น → ตารางสต็อก (ItemsRepo) ----------
  await m.goto("http://localhost:8765/items.html");
  await m.waitForTimeout(800);
  const before = await m.evaluate(() => window.__mockdb().items.length);
  // V21: ฟอร์มพับไว้ → ปุ่ม "+ เพิ่มสินค้า" กาง · ตัวเลขบรรทัดเดียว
  console.log("single form closed:", !(await m.isVisible("#itemName")), "| stats:", await m.$eval("#quickStats", (e) => e.textContent.trim()));
  await m.click("#focusSingle");
  await m.selectOption("#lotSelect", "lot1");
  await m.waitForTimeout(300);
  await m.fill("#itemName", "เสื้อทดสอบ ItemsRepo");
  await m.fill("#sellPrice", "250");
  await m.fill("#costPrice", "60");
  await m.click("#itemForm button[type=submit]");
  await m.waitForTimeout(900);
  console.log("items added:", (await m.evaluate(() => window.__mockdb().items.length)) - before, "| in table:", await m.$eval("#itemList", (e) => e.textContent.includes("เสื้อทดสอบ ItemsRepo")));
  // V21: แตะแถว = เปิดแก้ (ไม่มีปุ่ม "แก้ไข" แยก) · สลับเป็นตารางรูป
  await m.click("#itemList .stock-open");
  await m.waitForTimeout(400);
  console.log("row tap opens edit:", await m.isVisible("#editItemModal"));
  await m.keyboard.press("Escape");
  await m.goto("http://localhost:8765/items.html");
  await m.waitForTimeout(600);
  await m.click('[data-view="grid"]');
  console.log("grid view:", await m.$eval("#itemList", (e) => e.classList.contains("grid-view")));
  await shot(m, "08e-items-grid");
  await m.click('[data-view="list"]');

  // ---------- V20: ของค้าง → ลดราคา ----------
  await m.evaluate(() => { const db = window.__mockdb(); db.items[6].created_at = new Date(Date.now() - 100 * 86400000).toISOString(); db.items[7].created_at = db.items[6].created_at; sessionStorage.setItem("__mockdb", JSON.stringify(db)); });
  await m.goto("http://localhost:8765/items.html");
  await m.waitForTimeout(800);
  console.log("stale summary:", await m.$eval(".stale-count", (e) => e.textContent));
  await m.click(".stale-count");
  console.log("stale open:", await m.$eval("#staleCard", (e) => e.open));
  await m.click(".stale-ghead input");
  await m.waitForTimeout(150);
  console.log("stale preview:", await m.$eval(".stale-preview", (e) => e.textContent));
  await m.click(".stale-apply");
  await m.waitForSelector(".notify-dialog");
  await m.click(".nd-ok");
  await m.waitForTimeout(600);
  console.log("prices after markdown:", await m.evaluate(() => window.__mockdb().items.slice(6).map((i) => i.current_price)));
  await shot(m, "09b-stale-markdown");

  // ---------- ล็อต: ต้นทุนเฉลี่ย + บันทึก Lot (LotCalc + LotsRepo) ----------
  await m.goto("http://localhost:8765/lots.html");
  await m.waitForTimeout(500);
  // V21: ฟอร์มพับไว้ · การ์ดย่อไม่มี undefined / Invalid Date · รายละเอียดพับไว้
  console.log("lot form closed:", !(await m.isVisible("#lotName")), "| card text ok:", !(await m.$eval("#lotList", (e) => /undefined|Invalid Date/.test(e.textContent))), "| filter chips:", await m.$$eval("[data-lot-filter]", (b) => b.map((x) => x.textContent)));
  await m.click("#lotFormBox summary");
  await m.fill("#lotName", "Lot ทดสอบ");
  await m.fill("#totalCost", "3000");
  await m.fill("#totalItems", "50");
  console.log("lot avg preview:", await m.$eval("#avgCostPreview", (e) => e.textContent));
  await m.click("#lotForm button[type=submit]");
  await m.waitForTimeout(600);
  console.log("lots in db:", await m.evaluate(() => window.__mockdb().lots.map((l) => l.lot_name)));

  // ---------- ภาษี + บัญชี ----------
  await m.goto("http://localhost:8765/tax.html");
  await m.waitForTimeout(600);
  console.log("tax income/net:", await m.$eval("#taxIncome", (e) => e.textContent), await m.$eval("#taxNet", (e) => e.textContent), "|", await m.$eval("#taxAdvice", (e) => e.textContent));
  await shot(m, "10-tax");
  await m.goto("http://localhost:8765/accounting.html");
  await m.waitForTimeout(900);
  console.log("shift history rows:", await m.$$eval(".sh-row", (t) => t.length), "| tools:", await m.$$eval(".st-tool", (t) => t.length));
  await shot(m, "10b-accounting");
  // V21: การ์ดกันเงินหนี้แทนถังเงิน · ฟอร์ม/รายการค่าใช้จ่าย + สมุดบัญชีถูกตัดออก
  console.log("debt card:", await m.$eval("#debtBody", (e) => e.textContent.replace(/\s+/g, " ").trim()), "| old sections gone:", !(await m.$("#expenseForm")) && !(await m.$("#ledgerBody")) && !(await m.$("#bucketForm")));
  await m.locator(".debt-card").screenshot({ path: path.join(OUT, "10g-debt-card.png") });
  await m.locator("#shiftHistory").screenshot({ path: path.join(OUT, "10d-shift-history.png") });
  await m.locator("#storageCard").screenshot({ path: path.join(OUT, "10e-storage-tools.png") });
  await m.goto("http://localhost:8765/reports.html");
  await m.waitForTimeout(900);
  console.log("insights rows:", await m.$$eval("#insights .ins-table tbody tr", (t) => t.length));
  await shot(m, "10c-insights");
  await m.locator("#insights").screenshot({ path: path.join(OUT, "10f-insights-card.png") });
  // V21: รายงาน 4 แท็บ — เปิดมาที่ "ขายดี", แตะ "ล็อต" แล้วตารางล็อตโผล่และขายดีซ่อน · ไม่มีการ์ดสรุปยอดซ้ำ
  console.log("report tabs:", await m.$$eval("[data-tab]", (b) => b.map((x) => x.textContent + ":" + x.getAttribute("aria-selected"))), "| summary gone:", !(await m.$("#repRevenue")));
  await m.click('[data-tab="lot"]');
  console.log("lot tab:", await m.isVisible("#repLotBreakdown"), "best hidden:", !(await m.isVisible("#insights")));
  await shot(m, "10h-report-lot-tab");
  await m.click('[data-tab="best"]');

  // ---------- จอกว้าง ----------
  const d = await page(1280, 800);
  await d.goto("http://localhost:8765/sell.html");
  await d.waitForSelector(".pos-tile");
  await d.click('[data-cart="it5"]');
  await d.waitForTimeout(200);
  await shot(d, "11-desktop-sell");
  await d.goto("http://localhost:8765/index.html");
  await d.waitForTimeout(600);
  await shot(d, "12-desktop-main");

  console.log("ERRORS:\n" + (errors.join("\n") || "none"));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
