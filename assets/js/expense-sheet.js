/* ==========================================================
   expense-sheet.js — ปุ่ม + ลอย และแผ่นจดเงินบนหน้าแรก (index.html)
   หน้าที่: จดค่าใช้จ่าย (เงินสด/เงินโอน) · เติมทุน/ขายของเก่า/ถอนใช้ส่วนตัว · แก้/ลบค่าใช้จ่าย
   เรียกต่อ: data/expenseRepo.js · ใครเรียก: dashboard.js (ExpenseSheet.edit ตอนแตะแถวในการ์ดรายการ)
   เปลี่ยนแล้วส่ง event vims:realtime ให้ dashboard.js โหลดตัวเลขใหม่
   ========================================================== */
(function () {
  if (!window.ExpenseRepo || !window.Money || !document.getElementById("expenseSheet")) return;

  // หมวดค่าใช้จ่ายวันตลาด (ปุ่มด่วน) — ชื่อตรงกับหมวดในหน้าบัญชีเพื่อให้รายงานรวมกันได้
  const QUICK = [
    { cat: "ค่าเช่าแผง", label: "ค่าแผง" },
    { cat: "ค่าไฟ", label: "ค่าไฟ" },
    { cat: "ค่าเดินทาง", label: "น้ำมัน" },
    { cat: "ค่าแรง", label: "ค่าแรง" },
    { cat: "บรรจุภัณฑ์/ถุง", label: "ถุง" },
    { cat: "อื่นๆ", label: "อื่นๆ" },
  ];
  const S = Money.toSatang;
  const thb = (satang) => "฿" + Money.toBaht(satang).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

  let expenseForm = null; // แผ่นที่กำลังกรอก

  // V21: แผ่นล่าง (#expenseSheet) ใช้ร่วมกัน 2 ทาง: ปุ่ม + ลอย · แตะแถวค่าใช้จ่ายในการ์ดรายการ (แก้/ลบ)
  // form = { mode: "new"|"edit", type: "out"|"in", cat, paid, id?, amount?, note? }
  // type "in" = เงินเข้าที่ไม่ใช่การขาย → capital_entries (เติมทุน/ขายของเก่า) ไม่นับเป็นยอดขายหรือกำไร
  const QUICK_IN = [
    { cat: "capital_in", label: "เติมทุน" },
    { cat: "old_stock_income", label: "ขายของเก่า" },
    { cat: "withdraw", label: "ถอนใช้ส่วนตัว" }, // V21: จ่ายเงินเดือนตัวเอง — ไม่นับเป็นค่าใช้จ่ายร้าน
  ];
  const sheet = document.getElementById("expenseSheet");
  const quickChips = (list = QUICK) => list.map((q) => `<button type="button" class="pos-chip${expenseForm?.cat === q.cat ? " active" : ""}" data-quick="${esc(q.cat)}">+ ${esc(q.label)}</button>`).join("");

  function renderSheet() {
    const f = expenseForm;
    sheet.querySelector("#exTitle").textContent = f.mode === "edit" ? "แก้ค่าใช้จ่าย" : "เพิ่มรายการ";
    const typeTabs = f.mode === "new" ? `<div class="seg seg-2 ex-type">
        <button type="button" data-type="out" class="${f.type === "out" ? "active out" : ""}">− จ่าย</button>
        <button type="button" data-type="in" class="${f.type === "in" ? "active in" : ""}">⇄ เงินทุน</button>
      </div>` : "";
    const lastAmt = f.mode === "edit" ? f.amount : get("vims_exp_last_" + f.cat) || "";
    // V21: คืนความสามารถลงย้อนหลัง (เดิมอยู่ฟอร์มหน้าบัญชี) — ค่าเริ่มต้นวันนี้ ห้ามเลือกวันในอนาคต
    const dateField = `<label class="ex-date ex-wide"><span>วันที่</span><input type="date" name="date" value="${esc(f.date || todayStr())}" max="${todayStr()}" required aria-label="วันที่"></label>`;
    const actions = `<div class="ex-actions">${f.mode === "edit" ? `<button type="button" class="btn btn-ghost ex-del" data-act="del-exp">ลบ</button>` : ""}<button type="button" class="btn btn-ghost" data-act="cancel-exp">ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึก</button></div>`;
    sheet.querySelector("#exBody").innerHTML = f.type === "in" ? `${typeTabs}
      <div class="ex-quick">${quickChips(QUICK_IN)}</div>
      <form class="ex-form" data-form="income">
        <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="บาท" aria-label="จำนวนเงิน" required class="ex-wide">
        <input type="text" name="reason" minlength="3" placeholder="${f.cat === "withdraw" ? "เช่น เงินเดือนตัวเอง สัปดาห์ที่ 1" : "เช่น โอนเงินเก็บมาซื้อล็อตใหม่"}" aria-label="รายละเอียด" required class="ex-wide">
        ${dateField}
        ${actions}
      </form>` : `${typeTabs}
      <div class="ex-quick">${quickChips()}</div>
      <form class="ex-form" data-form="expense">
        <input type="text" name="category" value="${esc(f.cat)}" aria-label="หมวด" required>
        <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="บาท" value="${esc(lastAmt)}" aria-label="จำนวนเงิน" required>
        <div class="seg seg-2">
          <button type="button" data-paid="drawer" class="${f.paid === "drawer" ? "active" : ""}">เงินสด</button>
          <button type="button" data-paid="transfer" class="${f.paid === "transfer" ? "active" : ""}">เงินโอน</button>
        </div>
        <input type="text" name="note" value="${esc(f.note || "")}" placeholder="หมายเหตุ (ไม่บังคับ)" aria-label="หมายเหตุ">
        ${dateField}
        ${actions}
      </form>`;
    const amt = sheet.querySelector('[name="amount"]');
    amt.focus(); amt.select?.();
  }

  function openExpense(cat) {
    expenseForm = { mode: "new", type: "out", cat, paid: "drawer" };
    renderSheet();
    sheet.classList.remove("hidden");
  }
  function closeExpense() { expenseForm = null; sheet.classList.add("hidden"); }
  // ให้ dashboard.js เรียกตอนแตะแถวค่าใช้จ่ายในการ์ดรายการ
  window.ExpenseSheet = {
    edit(x) {
      expenseForm = { mode: "edit", type: "out", id: x.id, cat: x.category, amount: x.amount, note: x.note, paid: x.paid_from, date: x.expense_date, origDate: x.expense_date };
      renderSheet();
      sheet.classList.remove("hidden");
    },
  };
  const refreshAll = (table) => { window.dispatchEvent(new CustomEvent("vims:realtime", { detail: { table } })); }; // PULSE + การ์ดรายการ (dashboard.js) โหลดใหม่ทันที

  document.getElementById("addExpenseFab")?.addEventListener("click", () => openExpense(get("vims_exp_last_cat") || QUICK[0].cat));

  // ---------- events (delegation: การ์ดถูก render ใหม่ทั้งก้อน) ----------
  sheet.addEventListener("click", async (e) => {
    if (e.target === sheet || e.target.closest('[data-act="cancel-exp"]')) return closeExpense(); // แตะพื้นหลังมืด = ปิด
    const type = e.target.closest("[data-type]");
    if (type) { expenseForm.type = type.dataset.type; expenseForm.cat = type.dataset.type === "in" ? QUICK_IN[0].cat : get("vims_exp_last_cat") || QUICK[0].cat; renderSheet(); return; }
    const q = e.target.closest("[data-quick]");
    if (q) { expenseForm.cat = q.dataset.quick; renderSheet(); return; }
    const paid = e.target.closest("[data-paid]");
    if (paid) {
      expenseForm.paid = paid.dataset.paid;
      sheet.querySelectorAll("[data-paid]").forEach((b) => b.classList.toggle("active", b === paid));
      return;
    }
    if (e.target.closest('[data-act="del-exp"]')) {
      const f = expenseForm;
      if (!(await Notify.confirm({ title: `ลบค่าใช้จ่าย "${f.cat}"?`, message: `${thb(S(f.amount))}${f.note ? " · " + f.note : ""}\nยอดเงินจะคำนวณใหม่`, confirmText: "ลบ", danger: true }))) return;
      const { error } = await ExpenseRepo.deleteExpense(f.id);
      if (error) return Notify.error(`ลบ "${f.cat}" ไม่สำเร็จ`, error);
      Notify.success(`ลบ "${f.cat}" แล้ว`, `คืนยอด ${thb(S(f.amount))}`);
      closeExpense();
      refreshAll("expenses");
    }
  });

  sheet.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const date = form.date?.value || todayStr();
    if (date > todayStr()) return Notify.warning("เลือกวันในอนาคตไม่ได้", "ลงได้แค่วันนี้หรือย้อนหลัง");
    const atOf = (d) => (d === todayStr() ? new Date() : new Date(`${d}T12:00:00`)).toISOString();
    if (form.dataset.form === "income") {
      const amount = Number(form.amount.value);
      const reason = form.reason.value.trim();
      if (!(amount > 0)) return Notify.warning("ยังไม่ได้ใส่จำนวนเงิน", "ใส่ยอดเป็นบาท (มากกว่า 0)");
      if (reason.length < 3) return Notify.warning("ใส่รายละเอียดอย่างน้อย 3 ตัวอักษร", "เช่น โอนเงินเก็บมาซื้อล็อตใหม่");
      const label = QUICK_IN.find((q) => q.cat === expenseForm.cat)?.label || "เงินเข้า";
      const { error } = await ExpenseRepo.addCapital({ entry_type: expenseForm.cat, amount, reason, entry_date: date });
      if (error) return Notify.error(`บันทึก${label}ไม่สำเร็จ`, error);
      Notify.success(`${label} ${thb(S(amount))} แล้ว`, expenseForm.cat === "withdraw"
        ? "ไม่นับเป็นค่าใช้จ่ายร้าน (กำไรไม่ลด) — หักจากเงินจริงหน้าบัญชี"
        : "ไม่นับเป็นยอดขายหรือกำไร — นับรวมในเงินจริงหน้าบัญชี");
      closeExpense();
      refreshAll("capital_entries");
      return;
    }
    if (form.dataset.form === "expense") {
      const amount = Number(form.amount.value);
      const category = form.category.value.trim();
      if (!(amount > 0) || !category) return Notify.warning("ยังไม่ได้ใส่จำนวนเงิน", "ใส่ยอดค่าใช้จ่ายเป็นบาท (มากกว่า 0)");
      if (expenseForm.mode === "edit") {
        const patch = { category, amount, note: form.note.value.trim() || null, paid_from: expenseForm.paid || "other" };
        if (date !== expenseForm.origDate) Object.assign(patch, { expense_date: date, expense_at: atOf(date) });
        const { error } = await ExpenseRepo.updateExpense(expenseForm.id, patch);
        if (error) return Notify.error(`แก้ ${category} ไม่สำเร็จ`, error);
        Notify.success(`แก้ ${category} แล้ว`, `ยอดใหม่ ${thb(S(amount))}`);
        closeExpense();
        refreshAll("expenses");
        return;
      }
      const row = {
        expense_date: date,
        expense_at: atOf(date),
        category,
        amount,
        note: form.note.value.trim() || null,
        paid_from: expenseForm.paid || "other",
      };
      const { error } = await ExpenseRepo.addExpense(row);
      if (error) return Notify.error(`บันทึก ${category} ไม่สำเร็จ`, error);
      set("vims_exp_last_" + expenseForm.cat, String(amount)); // ครั้งหน้ากรอกยอดเดิมให้
      set("vims_exp_last_cat", expenseForm.cat); // ปุ่ม + เปิดมาที่หมวดล่าสุด
      Notify.success(`ลง ${category} ${thb(S(amount))} แล้ว`, `${row.paid_from === "drawer" ? "จ่ายเงินสด" : "จ่ายด้วยการโอน"} · วันที่ ${date}`);
      closeExpense();
      refreshAll("expenses");
    }
  });
})();
