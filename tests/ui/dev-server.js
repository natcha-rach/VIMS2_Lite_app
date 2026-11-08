// เซิร์ฟเวอร์ดูแอปด้วยข้อมูลจำลอง — ไม่แตะ Supabase จริง (กดขาย/ลบได้ไม่กระทบร้าน)
// รัน: node tests/ui/dev-server.js แล้วเปิด http://localhost:8770 · ข้อมูลจำลองอยู่ใน sessionStorage ของแท็บ (ปิดแท็บ = เริ่มใหม่)
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-supabase.js"), "utf8");
const CSP = (fs.readFileSync(path.join(ROOT, "_headers"), "utf8").match(/Content-Security-Policy: (.+)/) || [])[1] || "";
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/__mock/supabase.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end(MOCK); }
  if (url === "/sw.js") { res.writeHead(404); return res.end(); } // ไม่ลง service worker ให้ cache หน้าเก่าค้าง
  const p = path.join(ROOT, url === "/" ? "index.html" : url);
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    const ext = path.extname(p);
    if (ext === ".html") d = d.toString("utf8").replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@[^"]+/g, "/__mock/supabase.js");
    res.writeHead(200, { "content-type": (TYPES[ext] || "application/octet-stream") + "; charset=utf-8", ...(ext === ".html" ? { "content-security-policy": CSP } : {}) });
    res.end(d);
  });
}).listen(8770, () => console.log("ดูแอป (ข้อมูลจำลอง): http://localhost:8770"));
