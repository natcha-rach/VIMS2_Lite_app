// ==========================================================
// login.js — เข้าสู่ระบบด้วยอีเมล/รหัสผ่านของเจ้าของร้าน (Supabase Auth)
// ==========================================================
(function () {
  const form = document.getElementById("loginForm");
  const errBox = document.getElementById("loginError");
  const btn = document.getElementById("loginBtn");
  let failCount = 0;

  // ไปหน้าที่ผู้ใช้ตั้งใจจะเปิดก่อน login — รับเฉพาะชื่อไฟล์ .html ในโฟลเดอร์เดียวกัน (กัน open redirect)
  function nextPage() {
    const next = new URLSearchParams(location.search).get("next") || "";
    return /^[a-z0-9_-]+\.html(\?[a-zA-Z0-9_=&%.\-]*)?$/i.test(next) ? next : "index.html";
  }

  function showError(msg) {
    errBox.textContent = msg; // textContent เท่านั้น ไม่ใช้ innerHTML
    errBox.hidden = false;
  }

  // ตรวจว่าบัญชีนี้เป็นเจ้าของร้านจริง (อยู่ในตาราง app_admins) — ถ้าไม่ใช่ให้ออกจากระบบทันที
  async function checkOwnerOrSignOut() {
    const { data, error } = await supabaseClient.rpc("is_owner");
    if (error) {
      await supabaseClient.auth.signOut();
      return "ตรวจสิทธิ์ไม่สำเร็จ — ยังไม่ได้รัน sql/schema_part4_security.sql ใช่หรือไม่? (ดู docs/SUPABASE_SETUP.md)";
    }
    if (data !== true) {
      await supabaseClient.auth.signOut();
      return "บัญชีนี้ยังไม่ได้รับสิทธิ์เจ้าของร้าน (ดู docs/SUPABASE_SETUP.md ข้อ 3.1)";
    }
    return null;
  }

  // มี session อยู่แล้ว → ข้ามหน้า login
  supabaseClient.auth.getSession().then(async ({ data }) => {
    if (!data.session) return;
    const problem = await checkOwnerOrSignOut();
    if (!problem) location.replace(nextPage());
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errBox.hidden = true;
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    if (!email || !password) return showError("กรอกอีเมลและรหัสผ่านให้ครบ");

    btn.disabled = true;
    btn.textContent = "กำลังตรวจสอบ…";
    // หน่วงเพิ่มตามจำนวนครั้งที่ผิด (ช่วยชะลอการเดารหัสจากหน้าเว็บ; ตัวจำกัดจริงอยู่ที่ Supabase Auth rate limit)
    if (failCount > 0) await new Promise((r) => setTimeout(r, Math.min(failCount * 1000, 8000)));

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      failCount++;
      btn.disabled = false;
      btn.textContent = "เข้าสู่ระบบ";
      // ข้อความกลางๆ ไม่บอกว่าอีเมลหรือรหัสผ่านอันไหนผิด
      return showError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }

    const problem = await checkOwnerOrSignOut();
    if (problem) {
      btn.disabled = false;
      btn.textContent = "เข้าสู่ระบบ";
      return showError(problem);
    }
    location.replace(nextPage());
  });
})();
