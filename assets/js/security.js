// ==========================================================
// security.js — ตัวช่วยความปลอดภัยที่ใช้ร่วมกันทุกหน้า (โหลดหลัง supabaseClient.js)
// ==========================================================

// URL รูปที่ยอมให้แสดงได้: ต้องเป็น Public URL ของ bucket item-images ในโปรเจกต์ Supabase ของเราเท่านั้น
// ทำไมต้องมี: image_url เป็นข้อความจากฐานข้อมูล ถ้าถูกแก้ให้มี " หรือ javascript: จะหลุดออกจาก src="..." ได้ (XSS)
// คืนค่าที่ escape แล้ว พร้อมใส่ใน src="${safeImgUrl(url)}" ได้เลย (ถ้าไม่ผ่านจะคืน "" เพื่อไม่แสดงรูป)
const SAFE_IMG_PREFIX = SUPABASE_URL + "/storage/v1/object/public/item-images/";
function safeImgUrl(url) {
  const u = String(url || "");
  if (!u.startsWith(SAFE_IMG_PREFIX)) return "";
  if (/["'<>\s]/.test(u.slice(SAFE_IMG_PREFIX.length))) return "";
  return u;
}
window.safeImgUrl = safeImgUrl;

// ป้องกัน CSV/Excel Formula Injection: ค่าที่ขึ้นต้นด้วย = + - @ tab CR จะถูกตีเป็นสูตรเมื่อเปิดใน Excel
// (เช่น note ที่พิมพ์ว่า =HYPERLINK(...)) จึงเติม ' นำหน้าให้เป็นข้อความธรรมดา
// ตัวเลขจริง (number หรือสตริงที่เป็นตัวเลขล้วน เช่น -120.50) ไม่ถูกแตะ
function csvSafeText(v) {
  if (typeof v === "number") return String(v);
  const s = String(v ?? "");
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
window.csvSafeText = csvSafeText;
