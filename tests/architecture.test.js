// กติกาชั้นโค้ด (docs/ARCHITECTURE.md) — รัน: node --test tests/
// UI (assets/js/*.js) ห้ามเรียกฐานข้อมูลตรง → ต้องผ่าน data/*Repo.js · domain/ ห้ามแตะหน้าจอหรือฐานข้อมูล
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const JS = path.join(__dirname, "../assets/js");
const code = (f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// ไฟล์โครงสร้างพื้นฐานที่คุยกับ Supabase เองโดยหน้าที่ (สร้าง client · login · realtime)
const INFRA = new Set(["supabaseClient.js", "auth.js", "realtime.js"]);

for (const f of fs.readdirSync(JS).filter((x) => x.endsWith(".js") && !INFRA.has(x))) {
  test(`UI ${f}: ไม่เรียก supabaseClient.from/rpc/storage ตรง`, () => {
    const hits = code(path.join(JS, f)).split("\n").filter((l) => /supabaseClient\.(from|rpc|storage)\b/.test(l));
    assert.deepEqual(hits, [], "ย้ายไป assets/js/data/*Repo.js");
  });
}

for (const f of fs.readdirSync(path.join(JS, "domain"))) {
  test(`domain/${f}: ไม่แตะ DOM / Supabase`, () => {
    assert.doesNotMatch(code(path.join(JS, "domain", f)), /\b(document|supabaseClient|localStorage|fetch)\b/);
  });
}
