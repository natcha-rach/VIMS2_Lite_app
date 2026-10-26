/* ==========================================================
   auth.js — ด่านตรวจ Login (โหลดต่อจาก supabaseClient.js ทุกหน้า)
   - AUTH_REQUIRED=false → ไม่ทำอะไร (ใช้งานแบบเดิม)
   - AUTH_REQUIRED=true  → ยังไม่ login = พาไป login.html?next=<หน้าเดิม>
   - login แล้ว → เพิ่มปุ่ม "ออกจากระบบ" ที่ท้าย sidebar
   ========================================================== */
(function () {
  if (!window.supabaseClient) return;
  const page = location.pathname.split("/").pop() || "index.html";
  if (page === "login.html") return;

  supabaseClient.auth.getSession().then(({ data }) => {
    const session = data?.session;
    if (!session && window.VIMS_AUTH_REQUIRED) {
      location.replace("login.html?next=" + encodeURIComponent(page + location.search));
      return;
    }
    if (session) addLogoutButton(session.user?.email || "");
  });

  // ถ้า token หมดอายุ/ถูก logout จากอีกแท็บ → กลับไปหน้า login
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && window.VIMS_AUTH_REQUIRED) location.replace("login.html");
  });

  function addLogoutButton(email) {
    const footer = document.querySelector(".sidebar-footer");
    if (!footer || document.getElementById("logoutBtn")) return;
    const btn = document.createElement("button");
    btn.id = "logoutBtn";
    btn.type = "button";
    btn.className = "logout-btn";
    btn.title = "ออกจากระบบ " + email;
    btn.textContent = "ออก";
    btn.addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      location.replace("login.html");
    });
    footer.appendChild(btn);
  }
})();
