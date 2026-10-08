// ==========================================================
// ตั้งค่าการเชื่อมต่อ Supabase
// วิธีหาค่า: Supabase Dashboard -> Project Settings -> API
// SUPABASE_URL      = Project URL (ห้ามใส่ /rest/v1/ ต่อท้าย)
// SUPABASE_ANON_KEY = anon public key / publishable frontend key
// หมายเหตุ: createClient() จะจัดการ /rest/v1, /auth, /storage ให้เอง
// ==========================================================
const SUPABASE_URL = "https://cphhutlxvbinaycmsekm.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwaGh1dGx4dmJpbmF5Y21zZWttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMTcyNzEsImV4cCI6MjEwMTc5MzI3MX0._8Qjqrnnlot6Lt5vGuQQg_PgfZ9YavBxLxMG22ctxvc";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

// ==========================================================
// Auth guard — ทุกหน้า (ยกเว้น login.html) ต้องล็อกอินก่อน
// หมายเหตุสำคัญ: ตัวนี้เป็นแค่ "ความสะดวก" (พาไปหน้า login) ไม่ใช่ตัวป้องกันจริง
// ตัวป้องกันจริงคือ RLS ใน Supabase (sql/schema_part4_security.sql) ที่ให้เฉพาะเจ้าของร้านอ่าน/เขียนได้
// ==========================================================
const IS_LOGIN_PAGE = /(^|\/)login\.html$/.test(location.pathname);
const AUTH_STORAGE_KEY = "sb-" + new URL(SUPABASE_URL).hostname.split(".")[0] + "-auth-token";

function goToLogin() {
  const page = (location.pathname.split("/").pop() || "index.html") + location.search;
  location.replace("login.html?next=" + encodeURIComponent(page));
}

if (!IS_LOGIN_PAGE) {
  // เช็คเร็วๆ แบบ synchronous ก่อนหน้าจะโหลดข้อมูล (กันจอกะพริบ/error ตอนยังไม่ล็อกอิน)
  let hasStoredSession = false;
  try { hasStoredSession = !!localStorage.getItem(AUTH_STORAGE_KEY); } catch (e) { /* localStorage ใช้ไม่ได้ */ }
  if (!hasStoredSession) goToLogin();

  // ถ้า session หมดอายุ/ถูกเพิกถอน (เช่น logout จากอีกแท็บ) ให้กลับไปหน้า login
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) goToLogin();
  });
}

// ออกจากระบบ: เคลียร์ session + ข้อมูลร่างที่ค้างในเครื่อง แล้วกลับหน้า login
async function vimsSignOut() {
  try { await supabaseClient.auth.signOut(); } catch (e) { console.warn("signOut:", e); }
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("vims2_")).forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  location.replace("login.html");
}
window.vimsSignOut = vimsSignOut;
// ให้โมดูล Realtime และสคริปต์หน้าอื่นเข้าถึง client ตัวเดียวกันได้
window.supabaseClient = supabaseClient;

// แปลง payment_method (english) <-> ป้ายที่แสดงผล (ไทย)
const PAYMENT_LABELS = {
  cash: "เงินสด",
  transfer: "เงินโอน",
  government: "โครงการรัฐบาล",
};

// ฟอร์แมตตัวเลขเป็นสกุลเงินบาท
function formatBaht(num) {
  const n = Number(num) || 0;
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ฿";
}

// ฟอร์แมตวันที่แบบไทยสั้นๆ
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" });
}

// ==========================================================
// fetchAllRows — ดึงข้อมูลทั้งหมดโดยไม่ติด default row limit ของ Supabase (1000 แถว/query)
// รับ queryFactory เป็นฟังก์ชันที่คืน query ใหม่ทุกครั้ง (ยังไม่ใส่ .range())
// เพราะ query builder ของ Supabase เรียก .range() ซ้ำบน object เดิมไม่ได้
// ใช้กับตารางที่โตเรื่อยๆ เช่น items / sales เพื่อไม่ให้ Dashboard/รายงาน/บัญชี
// คำนวณตกหล่นแบบเงียบๆ เมื่อข้อมูลเกิน 1000 แถว
// ==========================================================
async function fetchAllRows(queryFactory, pageSize = 1000) {
  let from = 0;
  let all = [];
  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
window.fetchAllRows = fetchAllRows;

// ==========================================================
// debounce — รวม Realtime event ที่มาถี่ๆ ให้โหลดข้อมูลใหม่ "ครั้งเดียว" (trailing)
// ทำไมต้องมี: บันทึก Bulk 200 ชิ้นสร้าง event ราว 600 ครั้ง (items + item_images)
// ถ้าแต่ละ event สั่งโหลดตารางใหม่ทั้งหมด หน้าจอจะกระตุกและยิง query ซ้ำหลายร้อยครั้ง
// ==========================================================
function debounce(fn, wait = 500) {
  let timer = null;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
window.debounce = debounce;
