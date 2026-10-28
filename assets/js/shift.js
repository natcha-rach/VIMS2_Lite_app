/* ==========================================================
   shift.js — ชั้น UI ของการ์ด "ร้านวันนี้" บนหน้าภาพรวม (index.html)
   เปิดร้าน → ลงค่าใช้จ่ายด่วน → ดู "เหลือวันนี้" → นับเงิน & ปิดร้าน → แชร์สรุปไป LINE
   หน้าที่: DOM + event + แจ้งเตือน เท่านั้น (ดู docs/ARCHITECTURE.md)

   เรียกต่อ:
     Data   ShiftRepo    ← รอบร้าน, shift_totals, ค่าใช้จ่าย, เปิด/ปิดร้าน   (data/shiftRepo.js)
     Domain ShiftCalc    ← เหลือวันนี้/กำไรจริง, ขาด-เกิน, ข้อความสรุป   (domain/shiftCalc.js)
            Money        ← สตางค์ ↔ บาท                                   (money.js)
     Infra  OfflineSales ← กันปิดร้านถ้ายังมีบิลรอส่ง (offline.js)
   ถ้ายังไม่ได้รัน migration: การ์ดจะบอกให้รัน และหน้าภาพรวมส่วนอื่นยังใช้ได้ตามเดิม
   ========================================================== */
(function () {
  const card = document.getElementById("shiftCard");
  if (!card || !window.ShiftRepo || !window.ShiftCalc || !window.Money) return;

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
  const timeStr = (v) => new Date(v).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

  let shift = null;       // รอบร้านที่เปิดอยู่ (หรือ null)
  let totals = null;      // ผลจาก shift_totals
  let expenses = [];      // ค่าใช้จ่ายของรอบร้าน/วันนี้ (มี id ไว้ลบ)
  let today = null;       // ตัวเลขวันนี้ตอนยังไม่เปิดร้าน
  let expenseForm = null; // หมวดที่กำลังกรอก

  async function load() {
    const { data, error } = await ShiftRepo.openShift();
    if (error && !/shifts|relation|schema cache|PGRST205|42P01/i.test(`${error.message} ${error.code}`)) {
      card.innerHTML = `<div class="shift-missing"><b>โหลดร้านวันนี้ไม่สำเร็จ</b><span>${esc(Notify.friendlyError(error).detail)}</span></div>`;
      Notify.error("โหลดร้านวันนี้ไม่สำเร็จ", error, { actions: [{ label: "ลองใหม่", onClick: load }] });
      return;
    }
    if (error) {
      card.innerHTML = `<div class="shift-missing"><b>รอบเปิดร้าน / ค่าใช้จ่ายรายวัน</b><span>ยังใช้ไม่ได้ — รัน <code>sql/migration_v19_pos_shift.sql</code> ใน Supabase SQL Editor ก่อน</span></div>`;
      return;
    }
    shift = data;
    if (shift) {
      const [t, e] = await Promise.all([ShiftRepo.totals(shift.id), ShiftRepo.expensesOfShift(shift.id)]);
      totals = t.data;
      expenses = e.data || [];
    } else {
      await loadTodayWithoutShift();
    }
    render();
  }

  // ยังไม่เปิดร้าน: สรุปจากวันที่ตามปฏิทิน
  async function loadTodayWithoutShift() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [s, e] = await Promise.all([ShiftRepo.salesSince(start.toISOString()), ShiftRepo.expensesOfDate(todayStr())]);
    expenses = e.data || [];
    today = ShiftCalc.todayFromRows(s.data || [], expenses);
  }

  function render() {
    const open = !!shift;
    const revenue = open ? S(totals?.revenue) : today.revenue;
    const cogs = open ? S(totals?.cogs) : today.cogs;
    const exp = ShiftCalc.todayFromRows([], expenses).exp;
    const { left, profit } = ShiftCalc.figures({ revenue, cogs, exp });

    card.innerHTML = `
      <div class="shift-head">
        ${open
          ? `<span class="shift-pill open">● ร้านเปิดอยู่</span><span class="shift-where">${esc(shift.location)} · ตั้งแต่ ${timeStr(shift.opened_at)} · เงินทอนตั้งต้น ${thb(S(shift.opening_cash))}</span>
             <button type="button" class="btn btn-primary shift-close-btn" data-act="close">นับเงิน &amp; ปิดร้าน</button>`
          : `<span class="shift-pill">ยังไม่เปิดร้าน</span><span class="shift-where">ตัวเลขด้านล่างคือของวันนี้ตามปฏิทิน</span>`}
      </div>
      ${open ? "" : `
      <form class="shift-open" data-form="open">
        <label>เงินทอนตั้งต้น<input type="number" name="opening" min="0" step="1" inputmode="numeric" value="${esc(get("vims_shift_opening") || "500")}"></label>
        <label>ที่ขาย<input type="text" name="location" list="shiftLocations" value="${esc(get("vims_shift_location") || "ถนนคนเดิน")}"></label>
        <datalist id="shiftLocations"><option value="ถนนคนเดิน"><option value="ตลาดนัด"><option value="ไลฟ์ / ออนไลน์"></datalist>
        <button type="submit" class="btn btn-primary">เปิดร้าน</button>
      </form>`}
      <div class="shift-summary">
        <div class="ss-row ss-sales"><span>ยอดขาย${open ? ` <small>${totals?.bills || 0} บิล · ${totals?.items || 0} ชิ้น</small>` : ` <small>${today.items} ชิ้น</small>`}</span><b>${thb(revenue)}</b></div>
        ${expenses.map((x) => `<div class="ss-row ss-exp"><span>− ${esc(x.category)}${x.note ? ` <small>${esc(x.note)}</small>` : ""}${x.paid_from === "drawer" ? ` <small class="tag">ลิ้นชัก</small>` : x.paid_from === "transfer" ? ` <small class="tag">โอน</small>` : ""}</span>
          <span>${thb(S(x.amount))}${open || !x.shift_id ? `<button type="button" class="ss-del" data-del="${x.id}" aria-label="ลบ ${esc(x.category)}">×</button>` : ""}</span></div>`).join("")}
        <div class="ss-row ss-left"><span>= เหลือวันนี้</span><b class="${left >= 0 ? "pos" : "neg"}">${thb(left)}</b></div>
        <div class="ss-row ss-profit"><span>กำไรจริง <small>หักต้นทุนเสื้อ ${thb(cogs)} แล้ว</small></span><b class="${profit >= 0 ? "pos" : "neg"}">${thb(profit)}</b></div>
        ${open ? `<div class="ss-row ss-drawer"><span>เงินสดในลิ้นชักควรมี <small>ทอน ${thb(S(totals?.opening_cash))} + ขายสด ${thb(S(totals?.cash_sales))} − จ่ายจากลิ้นชัก ${thb(S(totals?.expenses_drawer))}</small></span><b>${thb(S(totals?.expected_cash))}</b></div>` : ""}
      </div>
      <div class="shift-quick">${quickChips()}</div>`;
  }

  // V21: แผ่นล่าง (#expenseSheet) ใช้ร่วมกัน 3 ทาง: ปุ่มด่วนในการ์ด · ปุ่ม + ลอย · แตะแถวค่าใช้จ่ายในการ์ดรายการ (แก้/ลบ)
  // form = { mode: "new"|"edit", type: "out"|"in", cat, paid, id?, amount?, note? }
  // type "in" = เงินเข้าที่ไม่ใช่การขาย → capital_entries (เติมทุน/ขายของเก่า) ไม่นับเป็นยอดขายหรือกำไร
  const QUICK_IN = [
    { cat: "capital_in", label: "เติมทุน" },
    { cat: "old_stock_income", label: "ขายของเก่า" },
  ];
  const sheet = document.getElementById("expenseSheet");
  const quickChips = (list = QUICK) => list.map((q) => `<button type="button" class="pos-chip${expenseForm?.cat === q.cat ? " active" : ""}" data-quick="${esc(q.cat)}">+ ${esc(q.label)}</button>`).join("");

  function renderSheet() {
    const f = expenseForm;
    sheet.querySelector("#exTitle").textContent = f.mode === "edit" ? "แก้ค่าใช้จ่าย" : "เพิ่มรายการ";
    const typeTabs = f.mode === "new" ? `<div class="seg seg-2 ex-type">
        <button type="button" data-type="out" class="${f.type === "out" ? "active out" : ""}">− จ่าย</button>
        <button type="button" data-type="in" class="${f.type === "in" ? "active in" : ""}">+ รับ (เติมทุน)</button>
      </div>` : "";
    const lastAmt = f.mode === "edit" ? f.amount : get("vims_exp_last_" + f.cat) || "";
    const actions = `<div class="shift-expense-actions">${f.mode === "edit" ? `<button type="button" class="btn btn-ghost ex-del" data-act="del-exp">ลบ</button>` : ""}<button type="button" class="btn btn-ghost" data-act="cancel-exp">ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึก</button></div>`;
    sheet.querySelector("#exBody").innerHTML = f.type === "in" ? `${typeTabs}
      <div class="shift-quick">${quickChips(QUICK_IN)}</div>
      <form class="shift-expense" data-form="income">
        <input type="number" name="amount" min="1" step="1" inputmode="numeric" placeholder="บาท" aria-label="จำนวนเงิน" required class="ex-wide">
        <input type="text" name="reason" minlength="3" placeholder="รายละเอียด เช่น โอนเงินเก็บมาซื้อล็อตใหม่" aria-label="รายละเอียด" required class="ex-wide">
        ${actions}
      </form>` : `${typeTabs}
      <div class="shift-quick">${quickChips()}</div>
      <form class="shift-expense" data-form="expense">
        <input type="text" name="category" value="${esc(f.cat)}" aria-label="หมวด" required>
        <input type="number" name="amount" min="1" step="1" inputmode="numeric" placeholder="บาท" value="${esc(lastAmt)}" aria-label="จำนวนเงิน" required>
        <div class="seg seg-2">
          <button type="button" data-paid="drawer" class="${f.paid === "drawer" ? "active" : ""}">หยิบจากลิ้นชัก</button>
          <button type="button" data-paid="transfer" class="${f.paid === "transfer" ? "active" : ""}">โอน/อื่นๆ</button>
        </div>
        <input type="text" name="note" value="${esc(f.note || "")}" placeholder="หมายเหตุ (ไม่บังคับ)" aria-label="หมายเหตุ">
        ${actions}
      </form>`;
    const amt = sheet.querySelector('[name="amount"]');
    amt.focus(); amt.select?.();
  }

  function openExpense(cat) {
    expenseForm = { mode: "new", type: "out", cat, paid: shift ? "drawer" : "transfer" };
    renderSheet();
    sheet.classList.remove("hidden");
  }
  function closeExpense() { expenseForm = null; sheet.classList.add("hidden"); render(); }
  // ให้ dashboard.js เรียกตอนแตะแถวค่าใช้จ่ายในการ์ดรายการ
  window.ExpenseSheet = {
    edit(x) {
      expenseForm = { mode: "edit", type: "out", id: x.id, cat: x.category, amount: x.amount, note: x.note, paid: x.paid_from };
      renderSheet();
      sheet.classList.remove("hidden");
    },
  };
  const refreshAll = (table) => { load(); window.dispatchEvent(new CustomEvent("vims:realtime", { detail: { table } })); }; // PULSE + การ์ดรายการ (dashboard.js) โหลดใหม่ทันที

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
      if (!(await Notify.confirm({ title: `ลบค่าใช้จ่าย "${f.cat}"?`, message: `${thb(S(f.amount))}${f.note ? " · " + f.note : ""}\nยอดเหลือวันนี้และเงินในลิ้นชักจะคำนวณใหม่`, confirmText: "ลบ", danger: true }))) return;
      const { error } = await ShiftRepo.deleteExpense(f.id);
      if (error) return Notify.error(`ลบ "${f.cat}" ไม่สำเร็จ`, error);
      Notify.success(`ลบ "${f.cat}" แล้ว`, `คืนยอด ${thb(S(f.amount))}`);
      closeExpense();
      refreshAll("expenses");
    }
  });

  card.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-quick]");
    if (q) { openExpense(q.dataset.quick); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") { openCloseModal(); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const x = expenses.find((r) => r.id === del.dataset.del);
      if (!x || !(await Notify.confirm({ title: `ลบค่าใช้จ่าย "${x.category}"?`, message: `${thb(S(x.amount))}${x.note ? " · " + x.note : ""}\nยอดเหลือวันนี้และเงินในลิ้นชักจะคำนวณใหม่`, confirmText: "ลบ", danger: true }))) return;
      const { error } = await ShiftRepo.deleteExpense(x.id);
      if (error) return Notify.error(`ลบ "${x.category}" ไม่สำเร็จ`, error);
      Notify.success(`ลบ "${x.category}" แล้ว`, `คืนยอด ${thb(S(x.amount))} กลับเข้าเหลือวันนี้`);
      load();
    }
  });

  card.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === "open") {
      const opening = Number(form.opening.value) || 0;
      const location = form.location.value.trim() || "ถนนคนเดิน";
      const { error } = await ShiftRepo.open(opening, location);
      if (error) return Notify.error("เปิดร้านไม่สำเร็จ", error);
      set("vims_shift_opening", String(opening));
      set("vims_shift_location", location);
      Notify.success("เปิดร้านแล้ว", `${location} · เงินทอนตั้งต้น ${thb(S(opening))} — ขายได้เลย ทุกบิลจะนับเข้ารอบร้านนี้`);
      load();
    }
  });

  sheet.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === "income") {
      const amount = Number(form.amount.value);
      const reason = form.reason.value.trim();
      if (!(amount > 0)) return Notify.warning("ยังไม่ได้ใส่จำนวนเงิน", "ใส่ยอดเป็นบาท (มากกว่า 0)");
      if (reason.length < 3) return Notify.warning("ใส่รายละเอียดอย่างน้อย 3 ตัวอักษร", "เช่น โอนเงินเก็บมาซื้อล็อตใหม่");
      const label = QUICK_IN.find((q) => q.cat === expenseForm.cat)?.label || "เงินเข้า";
      const { error } = await ShiftRepo.addCapital({ entry_type: expenseForm.cat, amount, reason, entry_date: todayStr() });
      if (error) return Notify.error(`บันทึก${label}ไม่สำเร็จ`, error);
      Notify.success(`${label} ${thb(S(amount))} แล้ว`, "ไม่นับเป็นยอดขายหรือกำไร — นับรวมในเงินจริงหน้าบัญชี");
      closeExpense();
      refreshAll("capital_entries");
      return;
    }
    if (form.dataset.form === "expense") {
      const amount = Number(form.amount.value);
      const category = form.category.value.trim();
      if (!(amount > 0) || !category) return Notify.warning("ยังไม่ได้ใส่จำนวนเงิน", "ใส่ยอดค่าใช้จ่ายเป็นบาท (มากกว่า 0)");
      if (expenseForm.mode === "edit") {
        const { error } = await ShiftRepo.updateExpense(expenseForm.id, { category, amount, note: form.note.value.trim() || null, paid_from: expenseForm.paid || "other" });
        if (error) return Notify.error(`แก้ ${category} ไม่สำเร็จ`, error);
        Notify.success(`แก้ ${category} แล้ว`, `ยอดใหม่ ${thb(S(amount))}`);
        closeExpense();
        refreshAll("expenses");
        return;
      }
      const now = new Date();
      const row = {
        expense_date: todayStr(),
        expense_at: now.toISOString(),
        category,
        amount,
        note: form.note.value.trim() || null,
        shift_id: shift?.id || null,
        paid_from: shift ? expenseForm.paid : "other",
      };
      const { error } = await ShiftRepo.addExpense(row);
      if (error) return Notify.error(`บันทึก ${category} ไม่สำเร็จ`, error);
      set("vims_exp_last_" + expenseForm.cat, String(amount)); // ครั้งหน้ากรอกยอดเดิมให้
      set("vims_exp_last_cat", expenseForm.cat); // ปุ่ม + เปิดมาที่หมวดล่าสุด
      Notify.success(`ลง ${category} ${thb(S(amount))} แล้ว`, row.paid_from === "drawer" ? "หักจากเงินในลิ้นชักที่ควรมีแล้ว" : row.paid_from === "transfer" ? "จ่ายด้วยการโอน (ไม่หักเงินในลิ้นชัก)" : "นับเป็นค่าใช้จ่ายของวันนี้");
      closeExpense();
      refreshAll("expenses");
    }
  });

  // ==========================================================
  // นับเงิน & ปิดร้าน
  // ==========================================================
  const modal = document.getElementById("closeShiftModal");
  async function openCloseModal() {
    if (!shift || !totals || !modal) return;
    // V20: มีบิลที่ขายตอนเน็ตหลุดยังไม่ได้ส่ง → ยอดยังไม่ครบ ห้ามปิดร้าน (ตัวเลขปิดร้านต้องไม่เปลี่ยนย้อนหลัง)
    const pending = window.OfflineSales ? await OfflineSales.count() : 0;
    if (pending) {
      await OfflineSales.flush();
      const left = await OfflineSales.count();
      if (left) return Notify.warning(`ยังมี ${left} บิลรอส่ง — ปิดร้านไม่ได้`, "บิลที่ขายตอนเน็ตหลุดยังไม่เข้าระบบ ยอดเงินในลิ้นชักจะไม่ตรง", {
        hint: "ต่อเน็ตแล้วรอให้ส่งครบ หรือเปิดหน้าขาย → ป้าย 'รอส่ง' เพื่อจัดการ",
        actions: [{ label: "ไปหน้าขาย", onClick: () => (location.href = "sell.html") }],
      });
      Notify.info("ส่งบิลที่ค้างครบแล้ว", "ตัวเลขในการ์ดอัปเดตแล้ว — กด 'นับเงิน & ปิดร้าน' อีกครั้ง");
      load();
      return;
    }
    modal.querySelector("#csExpected").textContent = thb(S(totals.expected_cash));
    modal.querySelector("#csCounted").value = "";
    modal.querySelector("#csReason").value = "";
    modal.querySelector("#csDiff").textContent = "";
    modal.querySelector("#csResult").classList.add("hidden");
    modal.querySelector("#csForm").classList.remove("hidden");
    modal.classList.remove("hidden");
    modal.querySelector("#csCounted").focus();
  }
  function updateDiff() {
    const raw = modal.querySelector("#csCounted").value;
    const el = modal.querySelector("#csDiff");
    if (raw === "") { el.textContent = ""; return; }
    const diff = ShiftCalc.drawerDiff(raw, totals.expected_cash);
    el.className = "cs-diff " + (diff === 0 ? "ok" : diff < 0 ? "short" : "over");
    el.textContent = diff === 0 ? "ตรงพอดี" : diff < 0 ? `ขาด ${thb(-diff)} — ใส่เหตุผลด้วย` : `เกิน ${thb(diff)} — ใส่เหตุผลด้วย`;
  }
  if (modal) {
    modal.querySelector("#csCounted").addEventListener("input", updateDiff);
    modal.querySelector("#csCancel").addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector("#csDone").addEventListener("click", () => modal.classList.add("hidden"));
    modal.querySelector("#csForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = modal.querySelector("#csCounted").value;
      if (raw === "") return Notify.warning("ยังไม่ได้ใส่ยอดที่นับได้", "นับเงินสดในลิ้นชักทั้งหมด (รวมเงินทอนตั้งต้น) แล้วใส่ยอด");
      const counted = Number(raw);
      const reason = modal.querySelector("#csReason").value.trim();
      const diff = ShiftCalc.drawerDiff(counted, totals.expected_cash);
      if (diff !== 0 && !reason) return Notify.warning(`เงิน${diff < 0 ? "ขาด" : "เกิน"} ${thb(Math.abs(diff))} ต้องใส่เหตุผล`, "เช่น ทอนผิด / ซื้อน้ำแล้วลืมลง — ไว้ดูย้อนหลัง");
      const btn = modal.querySelector("#csSubmit");
      btn.disabled = true;
      const { data, error } = await ShiftRepo.close(shift.id, counted, reason || null);
      btn.disabled = false;
      if (error) return Notify.error("ปิดร้านไม่สำเร็จ", error, { hint: "รอบร้านยังเปิดอยู่ ตัวเลขไม่หาย ลองกดปิดร้านอีกครั้ง" });
      const d = Number(data.cash_diff || 0);
      Notify.success("ปิดร้านแล้ว", `ขาย ${thb(S(data.revenue))} · เหลือ ${thb(S(data.left_today))} · ลิ้นชัก${d === 0 ? "ตรงพอดี" : d < 0 ? ` ขาด ${thb(S(-d))}` : ` เกิน ${thb(S(d))}`}`);
      showCloseResult(data);
      load();
    });
  }

  function showCloseResult(t) {
    const text = ShiftCalc.summaryText(t); // Domain
    modal.querySelector("#csForm").classList.add("hidden");
    const res = modal.querySelector("#csResult");
    res.classList.remove("hidden");
    res.querySelector("pre").textContent = text;
    res.querySelector("#csLine").onclick = () => window.open("https://line.me/R/share?text=" + encodeURIComponent(text), "_blank", "noopener");
    res.querySelector("#csShare").onclick = async () => {
      try {
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        Notify.success("คัดลอกสรุปปิดร้านแล้ว", "ไปวางในแชตได้เลย");
      } catch (_) { /* ผู้ใช้กดยกเลิก */ }
    };
  }


  // Realtime: ขายจากมือถือ/แท็บเล็ต → ตัวเลขการ์ดนี้ขยับตาม
  // ระหว่างกรอกค่าใช้จ่ายไม่ render ใหม่ (กันตัวเลขที่พิมพ์อยู่หาย) — บันทึกเสร็จจะโหลดเองอยู่แล้ว
  const reload = debounce(() => { if (!expenseForm) load(); }, 700);
  window.addEventListener("vims:realtime", (e) => {
    const table = e.detail?.table;
    if (table === "page_refresh" || ["sales", "bills", "expenses", "shifts"].includes(table)) reload();
  });

  load();
})();
