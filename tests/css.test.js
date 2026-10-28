// กันบั๊ก V21.6: CSS ค้างครึ่งบรรทัด (วงเล็บไม่ปิด) ทำให้กฎท้ายไฟล์ทั้งหมดไม่ทำงานแบบเงียบๆ — รัน: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "../assets/css");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".css"))) {
  test(`${f}: วงเล็บ { } ครบคู่`, () => {
    const s = fs.readFileSync(path.join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    for (const ch of s) { depth += ch === "{" ? 1 : ch === "}" ? -1 : 0; assert.ok(depth >= 0, "มี } เกิน"); }
    assert.equal(depth, 0, "มี { ที่ไม่ได้ปิด");
  });
}
