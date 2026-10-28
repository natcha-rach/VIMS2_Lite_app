const { chromium } = require("playwright");
const path = require("path"), fs = require("fs"), http = require("http");
const ROOT = path.resolve(__dirname, "../.."), OUT = path.join(__dirname, process.argv[2] || "before");
fs.mkdirSync(OUT, { recursive: true });
const MOCK = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const QR = fs.readFileSync(path.join(__dirname, "node_modules/qrcode-generator/qrcode.js"), "utf8");
const FONTS = path.join(__dirname, "fonts");
const FONT_CSS = ["prompt","inter"].flatMap(f => [400,500,600,700].flatMap(w => ["thai","latin"].map(sub => {
  const file = `node_modules/@fontsource/${f}/files/${f}-${sub}-${w}-normal.woff2`;
  if (!fs.existsSync(path.join(__dirname, file))) return "";
  return `@font-face{font-family:'${f === "prompt" ? "Prompt" : "Inter"}';font-weight:${w};font-style:normal;src:url(http://localhost:8766/__f/${file}) format('woff2');${sub==="thai"?"unicode-range:U+0E01-0E5B,U+200C-200D,U+25CC;":""}}`;
}))).join("\n");
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/__f/")) { res.writeHead(200, {"content-type":"font/woff2"}); return res.end(fs.readFileSync(path.join(__dirname, req.url.slice(5)))); }
  const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); }
    const t = p.endsWith(".html") ? "text/html" : p.endsWith(".css") ? "text/css" : "application/javascript";
    res.writeHead(200, { "content-type": t + "; charset=utf-8" }); res.end(d); });
}).listen(8766);
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // VP=devices → เครื่องที่เจ้าของใช้จริง (ขนาดจอ CSS px): iPhone 18 Pro, 12 Pro Max, Galaxy Z Flip 6 (จอใน), iPad Pro 11" ตั้ง/นอน, PC
  const SETS = { default: [[390, 844, "m"], [1280, 820, "d"]],
    devices: [[402, 874, "ip18"], [428, 926, "ip12pm"], [360, 880, "flip6"], [834, 1194, "ipad"], [1194, 834, "ipadL"], [1440, 900, "pc"]] };
  for (const [w, h, tag] of SETS[process.env.VP || "default"]) {
    const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: w, height: h } });
    const pg = await ctx.newPage();
    await pg.route("**/*", (r) => { const u = r.request().url();
      if (u.includes("supabase-js")) return r.fulfill({ body: MOCK, contentType: "application/javascript" });
      if (u.includes("qrcode-generator")) return r.fulfill({ body: QR, contentType: "application/javascript" });
      if (u.includes("fonts.googleapis.com/css")) return r.fulfill({ body: FONT_CSS, contentType: "text/css" });
      if (u.includes("chart.js")) return r.fulfill({ body: "window.Chart=function(){return{destroy(){},update(){}}};", contentType: "application/javascript" });
      if (u.includes("sheetjs") || u.includes("xlsx")) return r.fulfill({ body: "", contentType: "application/javascript" });
      if (u.startsWith("http://localhost:8766") || u.startsWith("data:")) return r.continue();
      return r.abort(); });
    pg.on("pageerror", (e) => errors.push(tag + " pageerror: " + e.message));
    for (const p of (process.argv[3] || "index,sell,items,lots,accounting,reports,tax,login").split(",")) {
      await pg.goto(`http://localhost:8766/${p}.html`);
      await pg.waitForTimeout(700);
      // ล้นจอแนวนอน = มีอะไรกว้างเกินจอ (ต้องเลื่อนซ้าย-ขวาได้) → รายงานชื่อ element ที่ล้น
      const over = await pg.evaluate(() => { const W = document.documentElement.clientWidth;
        return document.documentElement.scrollWidth > W ? [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.right > W + 1 && r.width > 0 && getComputedStyle(e).position !== "fixed"; }).slice(0, 4).map((e) => e.tagName + "." + [...e.classList].join(".") + "#" + e.id) : []; });
      if (over.length) errors.push(`${tag} ${p} ล้นจอ: ${over.join(", ")}`);
      await pg.screenshot({ path: path.join(OUT, `${tag}-${p}.png`), fullPage: true });
      if (p === "index") { // ปุ่ม + ต้องไม่ทับปุ่มขายของตรงกลาง และแผ่นต้องอยู่ในจอ
        const hit = await pg.evaluate(() => { const a = document.getElementById("addExpenseFab")?.getBoundingClientRect(), b = document.querySelector('a[href="sell.html"]')?.getBoundingClientRect();
          return a && b && b.width ? !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom) : false; });
        if (hit) errors.push(`${tag} ปุ่ม + ทับปุ่มขายของ`);
        await pg.click("#addExpenseFab"); await pg.waitForTimeout(400);
        await pg.screenshot({ path: path.join(OUT, `${tag}-index-sheet.png`) });
        await pg.mouse.click(5, 5);
      }
    }
    await ctx.close();
  }
  console.log(errors.join("\n") || "no page errors");
  await browser.close(); server.close();
})();
