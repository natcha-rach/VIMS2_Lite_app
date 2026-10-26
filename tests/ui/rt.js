// โหลด supabase-js ตัวจริง + realtime.js (เก่า/ใหม่) ชี้ไปเซิร์ฟเวอร์ที่ไม่มีอยู่ → ดูว่ามี error หลุดไหม
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const SB = fs.readFileSync(path.join(__dirname, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"), "utf8");
(async () => {
  const b = await chromium.launch();
  for (const [name, file] of [["OLD", path.join(__dirname, "realtime_old.js")], ["NEW", path.resolve(__dirname, "../../assets/js/realtime.js")]]) {
    const p = await b.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.setContent("<html><body></body></html>");
    await p.addScriptTag({ content: SB });
    await p.addScriptTag({ content: `window.supabaseClient = supabase.createClient("http://127.0.0.1:9", "eyJhbGciOiJIUzI1NiJ9.e30.x");` });
    await p.addScriptTag({ content: fs.readFileSync(file, "utf8") });
    // จำลองมือถือ: สลับแอปไปพื้นหลังแล้วกลับมา + เน็ตหลุดแล้วกลับ
    await p.waitForTimeout(2500);
    await p.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
    await p.waitForTimeout(6000);
    const ch = await p.evaluate(() => window.supabaseClient.getChannels().length);
    console.log(name, "errors:", errs.length ? errs.slice(0, 2) : "none", "| open channels:", ch);
    await p.close();
  }
  await b.close();
})();
