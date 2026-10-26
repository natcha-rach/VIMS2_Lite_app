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
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const pg = await ctx.newPage();
    await pg.route("**/*", (route) => {
      const u = route.request().url();
      if (u.includes("supabase-js")) return route.fulfill({ body: MOCK, contentType: "application/javascript" });
      if (u.includes("qrcode-generator")) return route.fulfill({ body: QR, contentType: "application/javascript" });
      if (u.includes("fonts.googleapis.com/css")) return route.fulfill({ body: FONT_CSS, contentType: "text/css" });
      if (u.includes("chart.js")) return route.fulfill({ body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript" });
      if (u.startsWith("http://localhost:8765")) return route.continue();
      if (u.startsWith("data:")) return route.continue();
      return route.abort();
    });
    pg.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    pg.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
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
  await m.click("#confirmSale");
  await m.waitForSelector(".notify-error");
  await m.waitForTimeout(300);
  await shot(m, "04b-sale-error");
  await m.click(".notify-error .notify-actions button:first-child");
  await m.waitForSelector("#receiptModal:not(.hidden)");
  await shot(m, "05-receipt");
  await m.click("#nextCustomer");

  // จอง
  await m.click('[data-info="it3"]');
  await m.waitForSelector("#saleDetailModal:not(.hidden)");
  await m.click("#detailReserve");
  await m.fill("#reserveName", "@prae.v");
  await m.click("#reserveForm button[type=submit]");
  await m.waitForTimeout(400);
  await shot(m, "06-reserved-badge");

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

  // ---------- ภาษี + บัญชี ----------
  await m.goto("http://localhost:8765/tax.html");
  await m.waitForTimeout(600);
  await shot(m, "10-tax");

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
