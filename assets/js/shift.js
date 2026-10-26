/* ==========================================================
   shift.js — การ์ด "กะวันนี้" บนหน้าภาพรวม (index.html) V19
   เปิดกะ → ลงค่าใช้จ่ายด่วน → ดู "เหลือวันนี้" → นับเงิน & ปิดกะ → แชร์สรุปไป LINE

   เชื่อมต่อ:
     RPC open_shift / shift_totals / close_shift  (sql/migration_v19_pos_shift.sql)
     table expenses (shift_id, paid_from)          ← ค่าใช้จ่ายระหว่างวัน
     money.js                                      ← คิดเงินเป็นสตางค์
   ถ้ายังไม่ได้รัน migration: การ์ดจะบอกให้รัน และหน้าภาพรวมส่วนอื่นยังใช้ได้ตามเดิม
   ========================================================== */
(function () {
  const card = document.getElementById("shiftCard");
  if (!card || !window.supabaseClient || !window.Money) return;

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

  let shift = null;       // กะที่เปิดอยู่ (หรือ null)
  let totals = null;      // ผลจาก shift_totals
  let expenses = [];      // ค่าใช้จ่ายของกะ/วันนี้ (มี id ไว้ลบ)
  let today = null;       // ตัวเลขวันนี้ตอนยังไม่เปิดกะ
  let expenseForm = null; // หมวดที่กำลังกรอก

  async function load() {
    const { data, error } = await supabaseClient.from("shifts").select("*").is("closed_at", null).maybeSingle();
    if (error) {
      card.innerHTML = `<div class="shift-missing"><b>กะขาย / ค่าใช้จ่ายรายวัน</b><span>ยังใช้ไม่ได้ — รัน <code>sql/migration_v19_pos_shift.sql</code> ใน Supabase SQL Editor ก่อน</span></div>`;
      return;
    }
    shift = data;
    if (shift) {
      const [t, e] = await Promise.all([
        supabaseClient.rpc("shift_totals", { p_shift_id: shift.id }),
        supabaseClient.from("expenses").select("id,category,amount,paid_from,note,expense_at,created_at").eq("shift_id", shift.id).order("created_at"),
      ]);
      totals = t.data;
      expenses = e.data || [];
    } else {
      await loadTodayWithoutShift();
    }
    render();
  }

  // ยังไม่เปิดกะ: สรุปจากวันที่ตามปฏิทิน
  async function loadTodayWithoutShift() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [s, e] = await Promise.all([
      fetchAllRows(() => supabaseClient.from("sales").select("sale_price,cost_price").is("voided_at", null).gte("sale_date", start.toISOString())),
      supabaseClient.from("expenses").select("id,category,amount,paid_from,note,shift_id,created_at").eq("expense_date", todayStr()).order("created_at"),
    ]);
    const sales = s.data || [];
    expenses = e.data || [];
    const revenue = sales.reduce((a, x) => a + S(x.sale_price), 0);
    const cogs = sales.reduce((a, x) => a + S(x.cost_price), 0);
    const exp = expenses.reduce((a, x) => a + S(x.amount), 0);
    today = { revenue, cogs, exp, items: sales.length };
  }

  function render(focusAmount = false) {
    const open = !!shift;
    const revenue = open ? S(totals?.revenue) : today.revenue;
    const cogs = open ? S(totals?.cogs) : today.cogs;
    const exp = expenses.reduce((a, x) => a + S(x.amount), 0);
    const left = revenue - exp;
    const profit = revenue - cogs - exp;

    card.innerHTML = `
      <div class="shift-head">
        ${open
          ? `<span class="shift-pill open">● กะเปิดอยู่</span><span class="shift-where">${esc(shift.location)} · ตั้งแต่ ${timeStr(shift.opened_at)} · เงินทอนตั้งต้น ${thb(S(shift.opening_cash))}</span>
             <button type="button" class="btn btn-primary shift-close-btn" data-act="close">นับเงิน &amp; ปิดกะ</button>`
          : `<span class="shift-pill">ยังไม่เปิดกะ</span><span class="shift-where">ตัวเลขด้านล่างคือของวันนี้ตามปฏิทิน</span>`}
      </div>
      ${open ? "" : `
      <form class="shift-open" data-form="open">
        <label>เงินทอนตั้งต้น<input type="number" name="opening" min="0" step="1" inputmode="numeric" value="${esc(get("vims_shift_opening") || "500")}"></label>
        <label>ที่ขาย<input type="text" name="location" list="shiftLocations" value="${esc(get("vims_shift_location") || "ถนนคนเดิน")}"></label>
        <datalist id="shiftLocations"><option value="ถนนคนเดิน"><option value="ตลาดนัด"><option value="ไลฟ์ / ออนไลน์"></datalist>
        <button type="submit" class="btn btn-primary">เปิดกะ</button>
      </form>`}
      <div class="shift-summary">
        <div class="ss-row ss-sales"><span>ยอดขาย${open ? ` <small>${totals?.bills || 0} บิล · ${totals?.items || 0} ชิ้น</small>` : ` <small>${today.items} ชิ้น</small>`}</span><b>${thb(revenue)}</b></div>
        ${expenses.map((x) => `<div class="ss-row ss-exp"><span>− ${esc(x.category)}${x.note ? ` <small>${esc(x.note)}</small>` : ""}${x.paid_from === "drawer" ? ` <small class="tag">ลิ้นชัก</small>` : x.paid_from === "transfer" ? ` <small class="tag">โอน</small>` : ""}</span>
          <span>${thb(S(x.amount))}${open || !x.shift_id ? `<button type="button" class="ss-del" data-del="${x.id}" aria-label="ลบ ${esc(x.category)}">×</button>` : ""}</span></div>`).join("")}
        <div class="ss-row ss-left"><span>= เหลือวันนี้</span><b class="${left >= 0 ? "pos" : "neg"}">${thb(left)}</b></div>
        <div class="ss-row ss-profit"><span>กำไรจริง <small>หักต้นทุนเสื้อ ${thb(cogs)} แล้ว</small></span><b class="${profit >= 0 ? "pos" : "neg"}">${thb(profit)}</b></div>
        ${open ? `<div class="ss-row ss-drawer"><span>เงินสดในลิ้นชักควรมี <small>ทอน ${thb(S(totals?.opening_cash))} + ขายสด ${thb(S(totals?.cash_sales))} − จ่ายจากลิ้นชัก ${thb(S(totals?.expenses_drawer))}</small></span><b>${thb(S(totals?.expected_cash))}</b></div>` : ""}
      </div>
      <div class="shift-quick">
        ${QUICK.map((q) => `<button type="button" class="pos-chip${expenseForm?.cat === q.cat ? " active" : ""}" data-quick="${esc(q.cat)}">+ ${esc(q.label)}</button>`).join("")}
      </div>
      ${expenseForm ? `
      <form class="shift-expense" data-form="expense">
        <input type="text" name="category" value="${esc(expenseForm.cat)}" aria-label="หมวด" required>
        <input type="number" name="amount" min="1" step="1" inputmode="numeric" placeholder="บาท" value="${esc(get("vims_exp_last_" + expenseForm.cat) || "")}" aria-label="จำนวนเงิน" required>
        <div class="seg seg-2">
          <button type="button" data-paid="drawer" class="${expenseForm.paid === "drawer" ? "active" : ""}">หยิบจากลิ้นชัก</button>
          <button type="button" data-paid="transfer" class="${expenseForm.paid === "transfer" ? "active" : ""}">โอน/อื่นๆ</button>
        </div>
        <input type="text" name="note" placeholder="หมายเหตุ (ไม่บังคับ)" aria-label="หมายเหตุ">
        <div class="shift-expense-actions"><button type="button" class="btn btn-ghost" data-act="cancel-exp">ยกเลิก</button><button type="submit" class="btn btn-primary">บันทึก</button></div>
      </form>` : ""}`;

    const amt = card.querySelector('[data-form="expense"] [name="amount"]');
    if (amt && focusAmount) { amt.focus(); amt.select?.(); }
  }

  // ---------- events (delegation: การ์ดถูก render ใหม่ทั้งก้อน) ----------
  card.addEventListener("click", async (e) => {
    const q = e.target.closest("[data-quick]");
    if (q) { expenseForm = { cat: q.dataset.quick, paid: shift ? "drawer" : "transfer" }; render(true); return; }
    const paid = e.target.closest("[data-paid]");
    if (paid && expenseForm) {
      expenseForm.paid = paid.dataset.paid;
      card.querySelectorAll("[data-paid]").forEach((b) => b.classList.toggle("active", b === paid));
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "cancel-exp") { expenseForm = null; render(); return; }
    if (act === "close") { openCloseModal(); return; }
    const del = e.target.closest("[data-del]");
    if (del) {
      const x = expenses.find((r) => r.id === del.dataset.del);
      if (!x || !confirm(`ลบค่าใช้จ่าย "${x.category}" ${thb(S(x.amount))}?`)) return;
      const { error } = await supabaseClient.from("expenses").delete().eq("id", x.id);
      if (error) return toast("ลบไม่สำเร็จ: " + error.message);
      load();
    }
  });

  card.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === "open") {
      const opening = Number(form.opening.value) || 0;
      const location = form.location.value.trim() || "ถนนคนเดิน";
      const { error } = await supabaseClient.rpc("open_shift", { p_opening_cash: opening, p_location: location });
      if (error) return toast("เปิดกะไม่สำเร็จ: " + error.message);
      set("vims_shift_opening", String(opening));
      set("vims_shift_location", location);
      toast(`เปิดกะแล้ว · เงินทอน ${thb(S(opening))}`);
      load();
    }
    if (form.dataset.form === "expense") {
      const amount = Number(form.amount.value);
      const category = form.category.value.trim();
      if (!(amount > 0) || !category) return toast("ใส่จำนวนเงิน");
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
      const { error } = await supabaseClient.from("expenses").insert(row);
      if (error) return toast("บันทึกไม่สำเร็จ: " + error.message);
      set("vims_exp_last_" + expenseForm.cat, String(amount)); // ครั้งหน้ากรอกยอดเดิมให้
      toast(`ลง ${category} ${thb(S(amount))} แล้ว`);
      expenseForm = null;
      load();
    }
  });

  // ==========================================================
  // นับเงิน & ปิดกะ
  // ==========================================================
  const modal = document.getElementById("closeShiftModal");
  function openCloseModal() {
    if (!shift || !totals || !modal) return;
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
    const diff = S(raw) - S(totals.expected_cash);
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
      if (raw === "") return toast("ใส่ยอดเงินที่นับได้");
      const counted = Number(raw);
      const reason = modal.querySelector("#csReason").value.trim();
      const diff = S(counted) - S(totals.expected_cash);
      if (diff !== 0 && !reason) return toast("เงินขาด/เกิน ต้องใส่เหตุผล");
      const btn = modal.querySelector("#csSubmit");
      btn.disabled = true;
      const { data, error } = await supabaseClient.rpc("close_shift", { p_shift_id: shift.id, p_counted_cash: counted, p_reason: reason || null });
      btn.disabled = false;
      if (error) return toast("ปิดกะไม่สำเร็จ: " + error.message);
      showCloseResult(data);
      load();
    });
  }

  function summaryText(t) {
    const d = new Date(t.opened_at).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
    const n = (v) => Money.toBaht(S(v)).toLocaleString("th-TH");
    const lines = (t.expense_lines || []).map((x) => `${x.category} ${n(x.amount)}`).join(", ");
    const diff = Number(t.cash_diff || 0);
    return [
      `สรุปกะ ${t.location} ${d}`,
      `ขาย ${n(t.revenue)} บาท (${t.bills} บิล ${t.items} ชิ้น)`,
      `สด ${n(t.cash_sales)} · โอน ${n(t.transfer_sales)} · รัฐ ${n(t.government_sales)}`,
      `ค่าใช้จ่าย ${n(t.expenses)}${lines ? ` (${lines})` : ""}`,
      `เหลือ ${n(t.left_today)} · กำไรจริง ${n(t.real_profit)}`,
      `ลิ้นชัก ควรมี ${n(t.expected_cash)} นับได้ ${n(t.counted_cash)}${diff ? ` (${diff < 0 ? "ขาด" : "เกิน"} ${n(Math.abs(diff))}${t.diff_reason ? ": " + t.diff_reason : ""})` : " ตรง"}`,
    ].join("\n");
  }

  function showCloseResult(t) {
    const text = summaryText(t);
    modal.querySelector("#csForm").classList.add("hidden");
    const res = modal.querySelector("#csResult");
    res.classList.remove("hidden");
    res.querySelector("pre").textContent = text;
    res.querySelector("#csLine").onclick = () => window.open("https://line.me/R/share?text=" + encodeURIComponent(text), "_blank", "noopener");
    res.querySelector("#csShare").onclick = async () => {
      try {
        if (navigator.share) { await navigator.share({ text }); return; }
        await navigator.clipboard.writeText(text);
        toast("คัดลอกสรุปแล้ว");
      } catch (_) { /* ผู้ใช้กดยกเลิก */ }
    };
  }

  function toast(msg) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window.__shiftToast);
    window.__shiftToast = setTimeout(() => t.classList.remove("show"), 2800);
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
