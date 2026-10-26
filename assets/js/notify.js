/* ==========================================================
   notify.js — ระบบแจ้งเตือนกลางของทั้งแอป (V19.1)
   โหลดต่อจาก supabaseClient.js ในทุกหน้า

   ใช้งาน
     Notify.success("บันทึกแล้ว", "รายละเอียด…")
     Notify.error("บันทึกไม่สำเร็จ", error)          ← ส่ง error object ของ Supabase มาได้เลย
     Notify.warning("ยังไม่ได้ใส่จำนวนเงิน", "…")
     Notify.info("…")
     await Notify.confirm({ title, message, confirmText, danger })   → true/false
     await Notify.prompt({ title, message, placeholder, required })  → ข้อความ หรือ null
     Notify.auto("ข้อความแบบเดิม")   ← showToast() เดิมทุกหน้าส่งมาที่นี่ ระบบเดาประเภทให้

   error ของ Supabase/เครือข่ายถูกแปลเป็นภาษาคน + วิธีแก้ (friendlyError)
   แจ้งเตือน error ค้างจนกว่าจะปิด/ครบ 10 วิ และกด "คัดลอกรายละเอียด" ไว้ส่งให้คนช่วยดูได้
   ========================================================== */
(function () {
  const ICONS = {
    success: '<path d="M5 12.5l4.2 4.2L19 7"/>',
    error: '<path d="M12 7v6"/><circle cx="12" cy="16.6" r=".6" fill="currentColor"/>',
    warning: '<path d="M12 8v5"/><circle cx="12" cy="16.4" r=".6" fill="currentColor"/>',
    info: '<path d="M12 11v5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  };
  const DURATION = { success: 3800, info: 4500, warning: 6500, error: 10000 };
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  // ---------- แปล error เป็นภาษาคน ----------
  function friendlyError(err) {
    if (!err) return { detail: "", hint: "" };
    const raw = typeof err === "string" ? err : err.message || err.error_description || err.msg || String(err);
    const code = typeof err === "object" ? err.code || err.status || "" : "";
    const m = String(raw);
    const out = (detail, hint) => ({ detail, hint, raw: m, code: String(code || "") });

    if (/failed to fetch|networkerror|network request failed|load failed|fetch.*abort|ERR_INTERNET/i.test(m) || (typeof navigator !== "undefined" && navigator.onLine === false))
      return out("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (อินเทอร์เน็ตหลุดหรือสัญญาณอ่อน)", "ข้อมูลรายการนี้ยังไม่ถูกบันทึก — เช็กเน็ตแล้วกดทำอีกครั้ง");
    if (code === "PGRST202" || /could not find the function|function .* does not exist/i.test(m))
      return out("ฐานข้อมูลยังไม่มีฟังก์ชันที่หน้านี้ต้องใช้", "รัน sql/migration_v19_pos_shift.sql ใน Supabase → SQL Editor แล้วรีเฟรชหน้า");
    if (code === "42P01" || code === "PGRST205" || /relation .* does not exist|could not find the table/i.test(m))
      return out("ฐานข้อมูลยังไม่มีตารางที่ต้องใช้", "รัน migration ล่าสุดในโฟลเดอร์ sql/ ก่อน (ดู docs/CHANGELOG_V19.md)");
    if (code === "42703" || code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(m))
      return out("ฐานข้อมูลยังไม่มีคอลัมน์ที่ต้องใช้", "รัน sql/migration_v19_pos_shift.sql แล้วรีเฟรชหน้า");
    if (code === "42501" || /row-level security|permission denied|not authorized/i.test(m))
      return out("ไม่มีสิทธิ์ทำรายการนี้", "ถ้าเปิดระบบ Login ไว้ ให้ออกแล้วเข้าสู่ระบบใหม่");
    if (code === "PGRST301" || /jwt|token.*expired|invalid claim/i.test(m))
      return out("การเข้าสู่ระบบหมดอายุ", "ออกจากระบบแล้วเข้าใหม่อีกครั้ง");
    if (code === "23505" || /duplicate key|already exists/i.test(m))
      return out("มีข้อมูลนี้อยู่แล้ว (ซ้ำ)", "ตรวจรหัส/ชื่อที่ซ้ำ เช่น รหัส Lot หรือ SKU");
    if (code === "23503" || /foreign key/i.test(m))
      return out("ข้อมูลนี้ยังถูกใช้อยู่ที่อื่น จึงลบ/แก้ไม่ได้", "ย้ายหรือลบรายการที่ผูกอยู่ก่อน");
    if (code === "23514" || /check constraint/i.test(m))
      return out("ค่าที่ใส่ไม่อยู่ในรูปแบบที่ระบบรับ", "เช็กตัวเลขติดลบ หรือช่องที่เลือกค่าไม่ถูก");
    if (code === "23502" || /null value in column/i.test(m))
      return out("ยังกรอกข้อมูลไม่ครบ", "กรอกช่องที่จำเป็นให้ครบแล้วลองใหม่");
    if (/payload too large|entity too large|exceeded the maximum allowed size/i.test(m))
      return out("ไฟล์รูปใหญ่เกินไป", "ลองถ่าย/เลือกรูปใหม่ ระบบจะย่อให้อัตโนมัติ");
    if (/quota|limit exceeded|too many requests|429/i.test(m))
      return out("ใช้งานถี่เกินหรือพื้นที่เต็ม", "รอสักครู่แล้วลองใหม่ หรือดู 'พื้นที่ที่ใช้ไป' ในหน้าบัญชี");
    // ข้อความภาษาไทยที่ฐานข้อมูลส่งมาเอง (raise exception ใน RPC) อ่านรู้เรื่องอยู่แล้ว
    return out(m, "");
  }

  // ---------- กล่องแจ้งเตือน ----------
  function stack() {
    let el = document.getElementById("notifyStack");
    if (!el) {
      el = document.createElement("div");
      el.id = "notifyStack";
      el.className = "notify-stack";
      el.setAttribute("aria-live", "polite");
      document.body.appendChild(el);
    }
    return el;
  }

  const recent = new Map(); // กันข้อความเดิมเด้งซ้ำรัวๆ

  function show(type, title, detail, opts = {}) {
    let hint = opts.hint || "";
    let raw = "";
    if (detail && typeof detail === "object") {
      const f = friendlyError(detail);
      detail = f.detail; hint = hint || f.hint; raw = f.raw + (f.code ? ` (code ${f.code})` : "");
    } else if (type === "error" && detail) {
      const f = friendlyError(detail);
      if (f.hint) { detail = f.detail; hint = hint || f.hint; raw = f.raw; }
    }
    const key = type + "|" + title + "|" + detail;
    if (recent.has(key) && Date.now() - recent.get(key) < 1500) return null;
    recent.set(key, Date.now());

    const box = stack();
    while (box.children.length >= 4) box.firstElementChild.remove();
    const el = document.createElement("div");
    el.className = `notify notify-${type}`;
    el.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
    const actions = [...(opts.actions || [])];
    if (type === "error") actions.push({ label: "คัดลอกรายละเอียด", copy: true });
    el.innerHTML = `
      <span class="notify-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[type]}</svg></span>
      <div class="notify-body">
        <b class="notify-title">${esc(title)}</b>
        ${detail ? `<div class="notify-detail">${esc(detail)}</div>` : ""}
        ${hint ? `<div class="notify-hint">วิธีแก้: ${esc(hint)}</div>` : ""}
        ${actions.length ? `<div class="notify-actions">${actions.map((a, i) => `<button type="button" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>` : ""}
      </div>
      <button type="button" class="notify-close" aria-label="ปิดการแจ้งเตือน">×</button>
      <span class="notify-timer"></span>`;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));

    const dismiss = () => { el.classList.remove("in"); el.classList.add("out"); setTimeout(() => el.remove(), 220); };
    el.querySelector(".notify-close").addEventListener("click", dismiss);
    el.querySelectorAll(".notify-actions [data-i]").forEach((b) => b.addEventListener("click", async () => {
      const a = actions[Number(b.dataset.i)];
      if (a.copy) {
        const text = [title, detail, hint && "วิธีแก้: " + hint, raw && "ข้อความระบบ: " + raw, location.pathname, new Date().toLocaleString("th-TH")].filter(Boolean).join("\n");
        try { await navigator.clipboard.writeText(text); b.textContent = "คัดลอกแล้ว ✓"; } catch (_) { b.textContent = "คัดลอกไม่ได้"; }
        return;
      }
      dismiss();
      a.onClick?.();
    }));

    // หยุดนับเวลาเมื่อเอาเมาส์ชี้/แตะค้าง (อ่านทัน)
    const ms = opts.duration ?? DURATION[type];
    if (ms > 0) {
      const timer = el.querySelector(".notify-timer");
      timer.style.animationDuration = ms + "ms";
      let left = ms, start = Date.now(), t = setTimeout(dismiss, ms);
      el.addEventListener("mouseenter", () => { clearTimeout(t); left -= Date.now() - start; el.classList.add("paused"); });
      el.addEventListener("mouseleave", () => { start = Date.now(); t = setTimeout(dismiss, Math.max(800, left)); el.classList.remove("paused"); });
    }
    return { dismiss };
  }

  // ---------- เดาประเภทจากข้อความ showToast() เดิม ----------
  function auto(msg) {
    const text = String(msg ?? "");
    let type = "info";
    if (/ไม่สำเร็จ|ผิดพลาด|error|failed|ล้มเหลว/i.test(text)) type = "error";
    else if (/กรุณา|ต้องใส่|ต้องเลือก|ต้องมี|ไม่พอ|ไม่ถูกต้อง|ยังไม่|ไม่ได้|ไม่พบ|ไม่มี|เกิน|ห้าม|ใส่ทั้ง|ใส่จำนวน|ใส่ยอด|ใส่ชื่อ|เลือก/.test(text)) type = "warning";
    else if (/สำเร็จ|เรียบร้อย|แล้ว|บันทึก|เพิ่ม|ลบ|อัปเดต|คัดลอก|ส่งออก/.test(text)) type = "success";
    // "หัวข้อ: รายละเอียด" → แยกเป็น 2 บรรทัด
    const i = text.indexOf(": ");
    if (i > 0 && i < 60) return show(type, text.slice(0, i), text.slice(i + 2));
    const j = text.indexOf(" — ");
    if (j > 0 && j < 70) return show(type, text.slice(0, j), text.slice(j + 3));
    return show(type, text, "");
  }

  // ---------- ยืนยัน / ถามข้อความ (แทน confirm()/prompt() ของเบราว์เซอร์) ----------
  function dialog({ title, message = "", confirmText = "ยืนยัน", cancelText = "ยกเลิก", danger = false, input = null }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const wrap = document.createElement("div");
      wrap.className = "notify-dialog-backdrop";
      wrap.innerHTML = `
        <div class="notify-dialog${danger ? " danger" : ""}" role="alertdialog" aria-modal="true" aria-labelledby="ndTitle" aria-describedby="ndMsg">
          <span class="notify-icon big"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${danger ? ICONS.warning : input ? ICONS.info : ICONS.info}</svg></span>
          <h3 id="ndTitle">${esc(title)}</h3>
          ${message ? `<p id="ndMsg">${esc(message)}</p>` : ""}
          ${input ? `<input type="${input.type || "text"}" class="nd-input" placeholder="${esc(input.placeholder || "")}" value="${esc(input.value ?? "")}" ${input.inputmode ? `inputmode="${input.inputmode}"` : ""} aria-label="${esc(title)}"><div class="nd-error" aria-live="polite"></div>` : ""}
          <div class="nd-actions">
            <button type="button" class="btn btn-ghost nd-cancel">${esc(cancelText)}</button>
            <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"} nd-ok">${esc(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      requestAnimationFrame(() => wrap.classList.add("in"));
      const field = wrap.querySelector(".nd-input");
      const finish = (val) => {
        wrap.classList.remove("in");
        setTimeout(() => wrap.remove(), 180);
        document.removeEventListener("keydown", onKey, true);
        prevFocus?.focus?.();
        resolve(val);
      };
      const ok = () => {
        if (!input) return finish(true);
        const v = field.value.trim();
        if (input.required && !v) { wrap.querySelector(".nd-error").textContent = input.requiredText || "ช่องนี้ต้องกรอก"; field.focus(); return; }
        finish(v);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(input ? null : false); }
        if (e.key === "Enter" && (input || document.activeElement === wrap.querySelector(".nd-ok"))) { e.preventDefault(); ok(); }
      };
      document.addEventListener("keydown", onKey, true);
      wrap.querySelector(".nd-cancel").addEventListener("click", () => finish(input ? null : false));
      wrap.querySelector(".nd-ok").addEventListener("click", ok);
      wrap.addEventListener("click", (e) => { if (e.target === wrap) finish(input ? null : false); });
      (field || wrap.querySelector(danger ? ".nd-cancel" : ".nd-ok")).focus();
    });
  }

  // รับได้ทั้ง confirm("ข้อความ\nรายละเอียด") แบบเดิม หรือ object
  function confirmDialog(arg, extra = {}) {
    if (typeof arg === "string") {
      const [first, ...rest] = arg.split("\n");
      arg = { title: first, message: rest.join("\n").trim(), ...extra };
      if (arg.danger === undefined) arg.danger = /ลบ|ยกเลิก|ล้าง/.test(first);
    }
    return dialog(arg);
  }
  function promptDialog(arg, value = "") {
    if (typeof arg === "string") arg = { title: arg, value };
    return dialog({ ...arg, confirmText: arg.confirmText || "ตกลง", input: { placeholder: arg.placeholder, value: arg.value ?? "", required: arg.required, requiredText: arg.requiredText, type: arg.type, inputmode: arg.inputmode } });
  }

  window.Notify = {
    success: (t, d, o) => show("success", t, d, o),
    error: (t, d, o) => show("error", t, d, o),
    warning: (t, d, o) => show("warning", t, d, o),
    info: (t, d, o) => show("info", t, d, o),
    auto,
    confirm: confirmDialog,
    prompt: promptDialog,
    friendlyError,
  };

  // ---------- จับ error ที่หลุดมือทั้งแอป ----------
  window.addEventListener("unhandledrejection", (e) => {
    console.error(e.reason);
    show("error", "มีบางอย่างทำงานไม่สำเร็จ", e.reason || "ไม่ทราบสาเหตุ");
  });
  window.addEventListener("error", (e) => {
    if (!e.message || e.message === "Script error.") return; // error จากไฟล์ภายนอก ไม่มีรายละเอียด
    show("error", "หน้านี้ทำงานผิดพลาด", `${e.message}${e.filename ? ` (${e.filename.split("/").pop()}:${e.lineno})` : ""}`, { hint: "ลองรีเฟรชหน้า ถ้ายังเป็นอยู่ให้กดคัดลอกรายละเอียดเก็บไว้" });
  });

  // ---------- สถานะอินเทอร์เน็ต ----------
  let offlineNote = null;
  window.addEventListener("offline", () => {
    // หน้าที่โหลด offline.js (หน้าขาย) ขายต่อได้ — บิลเก็บในเครื่องแล้วส่งเองเมื่อเน็ตกลับมา
    const detail = window.OfflineSales
      ? "ขายต่อได้ บิลจะเก็บในเครื่องแล้วส่งเองเมื่อเน็ตกลับมา (ค่าใช้จ่าย/แก้สินค้ายังบันทึกไม่ได้)"
      : "ตอนนี้ยังบันทึกการขาย/ค่าใช้จ่ายไม่ได้";
    offlineNote = show("warning", "อินเทอร์เน็ตหลุด", detail, { duration: 0, hint: "อย่าล้างข้อมูลเบราว์เซอร์ — รอเน็ตกลับมา ระบบจะแจ้งอีกครั้ง" });
  });
  window.addEventListener("online", () => {
    offlineNote?.dismiss();
    show("success", "กลับมาออนไลน์แล้ว", "บันทึกข้อมูลได้ตามปกติ");
  });
})();
