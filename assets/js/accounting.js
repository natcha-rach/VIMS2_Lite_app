/* ==========================================================
   accounting.js — ชั้น UI ของหน้าบัญชี (accounting.html)
   หน้าที่: เงินจริงตอนนี้ (นับเงิน/เงินทุน), การ์ดกันเงินหนี้, ส่งออก CSV
   V21: ตัดฟอร์ม/รายการค่าใช้จ่าย + สมุดบัญชี (ซ้ำกับการ์ดรายการ + ปุ่ม + หน้าแรก), ถังเงิน % (แทนด้วยกันเงินหนี้),
        ทุนตาม Lot (ซ้ำกับหน้ารายงาน)
   เรียกต่อ:
     Data   AccountingRepo ← lots/expenses/sales/capital/shifts/app_settings  (data/accountingRepo.js)
     Domain CashBalance    ← "เงินสด + เงินโอน ที่มีจริงตอนนี้"              (domain/cashBalance.js)
     Domain DebtPlan       ← การ์ดกันเงินหนี้ รอบ 6→28                        (domain/debtPlan.js)
   ไฟล์คู่กันบนหน้าเดียวกัน: shift-history.js (ประวัติรอบร้าน), storage-tools.js (ลดพื้นที่รูป)
   ========================================================== */
let debtTarget = 35000; // app_settings.debt_plan.target — หนี้รายเดือน (จ่ายวันที่ 29/1/5)

// escapeHtml: ไฟล์นี้เดิมไม่มีฟังก์ชันนี้ ทำให้ category/note ของค่าใช้จ่ายถูกยัดเข้า innerHTML ตรงๆ
function escapeHtml(v = "") {
  return String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

/* ---------- เงินทุน / ปรับยอดเงิน ---------- */
const CAP_SIGN = CashBalance.CAP_SIGN; // + / − ของเงินทุนแต่ละประเภท (Domain)
const CAP_LABELS = { opening: "ตั้งยอดเงินจริง", capital_in: "เพิ่มเงินทุน", old_stock_income: "เงินขายของเก่า", withdraw: "ถอนเงิน", adjust_up: "ปรับยอด(+)", adjust_down: "ปรับยอด(−)" };
let currentBalance = 0;
let hasAnchor = false;
let hasCapitalEntries = false;
document.getElementById("capDate").valueAsDate = new Date();

async function addCapitalEntry(entry_type, amount, reason, entry_date) {
  reason = (reason || "").trim();
  if (!(amount > 0) && !(entry_type === "opening" && amount >= 0)) return showToast("กรุณาใส่จำนวนเงินมากกว่า 0");
  if (reason.length < 3) return showToast("ต้องใส่เหตุผล/รายละเอียดทุกครั้ง");
  const { error } = await AccountingRepo.addCapital({ entry_type, amount, reason, entry_date });
  if (error) { console.error(error); return showToast("บันทึกไม่สำเร็จ: " + error.message); }
  showToast("บันทึกเรียบร้อย");
  loadAll();
  return true;
}

document.getElementById("capitalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  let type = document.getElementById("capType").value;
  // ยังไม่เคยตั้งเงินตั้งต้น: เงินทุนที่ใส่ = เงินจริงที่มีอยู่ตอนนี้ ใช้เป็นจุดเริ่มต้นเลย (ไม่หักต้นทุน Lot ที่จ่ายไปก่อนหน้า)
  if (!hasAnchor && !hasCapitalEntries && type === "capital_in") {
    const amt = Number(document.getElementById("capAmount").value);
    if (!(amt > 0)) return showToast("กรุณาใส่จำนวนเงินมากกว่า 0");
    if (!(await Notify.confirm({ title: "ยังไม่ได้ตั้งเงินตั้งต้น", confirmText: "ใช้ยอดนี้", message: `ใช้ ${formatBaht(amt)} เป็นเงินจริงที่มีอยู่ตอนนี้ (เงินสด + เงินโอน) ใช่ไหม?` }))) return;
    type = "opening";
  }
  const ok = await addCapitalEntry(
    type,
    Number(document.getElementById("capAmount").value),
    document.getElementById("capReason").value,
    document.getElementById("capDate").value
  );
  if (ok) { document.getElementById("capAmount").value = ""; document.getElementById("capReason").value = ""; }
});

function updateCountPreview() {
  const c = document.getElementById("realCashOnHand").value, t = document.getElementById("realTransfer").value;
  const el = document.getElementById("countPreview");
  if (c === "" && t === "") { el.textContent = ""; return; }
  const real = (Number(c) || 0) + (Number(t) || 0);
  const diff = Math.round((real - currentBalance) * 100) / 100;
  el.textContent = !hasAnchor ? `รวมนับได้ ${formatBaht(real)}` : `รวมนับได้ ${formatBaht(real)} · ระบบคำนวณ ${formatBaht(currentBalance)} · ส่วนต่าง ${diff > 0 ? "+" : ""}${formatBaht(diff)}`;
}
["realCashOnHand", "realTransfer"].forEach((id) => document.getElementById(id).addEventListener("input", updateCountPreview));

document.getElementById("adjBtn").addEventListener("click", async () => {
  const c = document.getElementById("realCashOnHand").value, t = document.getElementById("realTransfer").value;
  if (c === "" || t === "") return showToast("ใส่ทั้งเงินสดและเงินโอน (ไม่มีให้ใส่ 0)");
  const cash = Number(c), transfer = Number(t), real = cash + transfer;
  let reason = document.getElementById("adjReason").value.trim();
  if (reason.length < 3) return showToast("ต้องใส่เหตุผลทุกครั้ง");
  if (hasAnchor) {
    const diff = Math.round((real - currentBalance) * 100) / 100;
    if (diff !== 0) {
      if (!(await Notify.confirm({ title: "ยอดนับจริงไม่ตรงกับระบบ", confirmText: "บันทึกยอดนับจริง", message: `ระบบคำนวณ ${formatBaht(currentBalance)} / นับจริง ${formatBaht(real)}\nส่วนต่าง ${diff > 0 ? "+" : "−"}${formatBaht(Math.abs(diff))} — บันทึกยอดที่นับจริงเป็นจุดตั้งต้นใหม่ใช่ไหม?` }))) return;
      reason += ` (ส่วนต่างจากระบบ ${diff > 0 ? "+" : "−"}${Math.abs(diff).toFixed(2)})`;
    }
  }
  const today = new Date().toISOString().slice(0, 10);
  const ok = await addCapitalEntry("opening", real, reason, today);
  if (!ok) return;
  await AccountingRepo.saveSetting("cash_count", { cash, transfer, date: today });
  ["realCashOnHand", "realTransfer", "adjReason"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("countPreview").textContent = "";
});

/* ---------- โหลดข้อมูลทั้งหมด + คำนวณสรุป + สมุดบัญชี ---------- */
let ledgerRowsForExport = [];

async function loadAll() {
  // fetchAllRows กัน sales/expenses ตกหล่นแบบเงียบๆ เมื่อเกิน 1000 แถว (default row limit ของ Supabase)
  const [{ data: lots, error: lotsErr }, { data: expenses, error: expErr }, { data: sales, error: salesErr }, { data: capital, error: capErr }] =
    await Promise.all([
      AccountingRepo.allLots(),
      AccountingRepo.allExpenses(),
      AccountingRepo.allSales(), // ไม่นับรายการที่ถูกยกเลิก
      AccountingRepo.allCapital(),
    ]);

  if (lotsErr || expErr || salesErr || capErr) {
    console.error(lotsErr || expErr || salesErr || capErr);
    Notify.error("โหลดข้อมูลบัญชีไม่สำเร็จ", lotsErr || expErr || salesErr || capErr, { actions: [{ label: "ลองใหม่", onClick: () => loadAll() }] });
    return;
  }

  // V20: เงินขาด/เกินตอนปิดร้าน (shifts.cash_diff) = เงินจริงที่หาย/เกินจากที่ระบบคิด → ต้องรวมในยอดเงินจริงด้วย
  // ตาราง shifts มาจาก migration_v19 — ยังไม่ได้รัน ก็ข้ามไป (ไม่ทำให้หน้าบัญชีพัง)
  const { data: closedShifts } = await AccountingRepo.closedShiftDiffs();
  const shiftDiffs = closedShifts || [];

  // ยอดเงินจริง = ยอดที่นับได้ล่าสุด + รายการหลังจากนั้น (คำนวณที่ Domain: domain/cashBalance.js)
  hasCapitalEntries = capital.length > 0;
  const cb = CashBalance.compute({ capital, sales, lots, expenses, shiftDiffs });
  const { anchor, provisional, flow: newFlow } = cb;
  currentBalance = cb.balance;
  hasAnchor = cb.hasAnchor;

  const balEl = document.getElementById("accCashBalance");
  const noBase = !anchor;
  const firstTime = noBase || provisional; // ยังไม่เคยนับเงินจริง → ตัวเลขเป็นแค่ประมาณการ
  document.getElementById("cashFirst").classList.toggle("hidden", !firstTime);
  balEl.textContent = noBase ? "—" : (provisional ? "ประมาณ " : "") + formatBaht(currentBalance);
  balEl.style.fontSize = firstTime ? "18px" : "";
  balEl.classList.toggle("loss", !firstTime && currentBalance < 0);
  document.getElementById("cashFormula").textContent = noBase
    ? "ใส่เงินสดและเงินโอนที่มีจริงตอนนี้ในช่อง \"นับเงินจริง\" ด้านล่าง ระบบจะใช้เป็นจุดเริ่มต้น แล้วบวก/ลบเฉพาะรายการที่เกิดหลังจากนั้น"
    : `${provisional ? "เงินทุนที่บันทึกไว้" : "ยอดที่นับ"} ${formatBaht(anchor.amount)} (${formatDate(anchor.entry_date)}) + ขายใหม่ ${formatBaht(newFlow.sales)} ± เงินทุนใหม่ ${formatBaht(newFlow.cap)} − ซื้อล็อตใหม่ ${formatBaht(newFlow.lots)} − ค่าใช้จ่ายใหม่ ${formatBaht(newFlow.exp)}${newFlow.drawer ? ` ${newFlow.drawer > 0 ? "+" : "−"} เงิน${newFlow.drawer > 0 ? "เกิน" : "ขาด"}ตอนปิดร้าน ${formatBaht(Math.abs(newFlow.drawer))}` : ""}`;
  document.getElementById("cashFirstBtn").onclick = () => { const box = document.getElementById("countBox"); box.open = true; box.scrollIntoView({ behavior: "smooth", block: "center" }); document.getElementById("realCashOnHand").focus(); };
  const gov = CashBalance.governmentSince(sales, anchor);
  const { data: cc } = await AccountingRepo.getSetting("cash_count");
  document.getElementById("cashCountNote").textContent =
    (cc && cc.value ? `นับล่าสุด ${formatDate(cc.value.date)}: เงินสด ${formatBaht(cc.value.cash)} · เงินโอน ${formatBaht(cc.value.transfer)}. ` : "") +
    (provisional ? "ยังไม่ได้นับเงินจริง — ใช้เงินทุนที่บันทึกไว้เป็นยอดตั้งต้นชั่วคราว ตั้งยอดนับจริงเพื่อให้ตรงกับเงินในมือ. " : "") +
    (gov > 0 ? `ยอดขายโครงการรัฐรวม ${formatBaht(gov)} (ถ้ายังไม่เข้าบัญชี ยอดนี้จะสูงกว่าเงินจริง)` : "");
  document.getElementById("cashCountNote").style.display = document.getElementById("cashCountNote").textContent ? "" : "none";

  renderDebtCard(sales, expenses);
  renderLedger(lots, expenses, sales, capital);
}

function renderLedger(lots, expenses, sales, capital = []) {
  const events = [];
  capital.forEach((c) => {
    const sign = CAP_SIGN[c.entry_type];
    if (c.entry_type === "opening") {
      events.push({ date: new Date(c.created_at), desc: `ตั้งยอดเงินจริง ${formatBaht(c.amount)}: ${c.reason}`, in: 0, out: 0, reset: Number(c.amount) });
      return;
    }
    events.push({
      date: new Date(c.entry_date),
      desc: `${CAP_LABELS[c.entry_type]}: ${c.reason}`,
      in: sign > 0 ? Number(c.amount) : 0,
      out: sign < 0 ? Number(c.amount) : 0,
    });
  });

  // desc เก็บเป็นข้อความดิบ (ไม่ escape) เพราะใช้ทั้งแสดงผลและ export CSV
  // การ escape สำหรับ HTML ทำตอน render เท่านั้น (ดู renderLedger ด้านล่าง)
  lots.forEach((l) => {
    events.push({
      date: new Date(l.purchase_date),
      desc: `รับล็อต: ${l.lot_name}${l.source ? " (" + l.source + ")" : ""}`,
      in: 0,
      out: Number(l.total_cost || 0),
    });
  });

  expenses.forEach((e) => {
    events.push({
      date: e.expense_at ? new Date(e.expense_at) : new Date(e.expense_date),
      desc: `ค่าใช้จ่าย: ${e.category}${e.note ? " (" + e.note + ")" : ""}`,
      in: 0,
      out: Number(e.amount || 0),
    });
  });

  sales.forEach((s) => {
    const name = s.items ? s.items.item_name : "(ไม่พบชื่อสินค้า)";
    events.push({
      date: new Date(s.sale_date),
      desc: `ขาย: ${name} (${PAYMENT_LABELS[s.payment_method] || s.payment_method})`,
      in: Number(s.sale_price || 0),
      out: 0,
    });
  });

  // เรียงเก่า -> ใหม่ เพื่อคำนวณยอดคงเหลือสะสม
  events.sort((a, b) => a.date - b.date);
  let running = 0;
  events.forEach((ev) => {
    running = ev.reset != null ? ev.reset : running + ev.in - ev.out;
    ev.balance = running;
  });

  ledgerRowsForExport = events;

}

/* ---------- V21: การ์ดกันเงินหนี้ ---------- */
const dFmt = (d) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
function renderDebtCard(sales, expenses) {
  const el = document.getElementById("debtBody");
  const p = DebtPlan.compute({ sales, expenses, target: debtTarget });
  const status = p.paying ? `ช่วงจ่ายหนี้ — นัด ${p.dues.map(dFmt).join(" · ")}`
    : p.remaining && p.daysLeft ? `ต้องอีก ${formatBaht(p.remaining)} · เหลือวันตลาด (ส-อา) ${p.daysLeft} วัน → <b>วันละ ${formatBaht(p.perDay)}</b>`
    : p.remaining ? `ยังขาด <b>${formatBaht(p.remaining)}</b> · ไม่มีเสาร์-อาทิตย์เหลือก่อนวันที่ 28 — ต้องใช้ยอดออนไลน์หรือเงินสำรอง`
    : "กันครบเป้าแล้ว";
  el.innerHTML = `
    <div class="debt-range">รอบ ${dFmt(p.start)} – ${dFmt(p.readyBy)} · เป้า ${formatBaht(debtTarget)}</div>
    <div class="debt-amt"><b>${formatBaht(Math.max(0, p.profit))}</b> <span>กำไรจริงรอบนี้</span></div>
    <div class="debt-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}"><div style="width:${p.pct.toFixed(1)}%"></div></div>
    <p class="debt-status">${status}</p>
    <p class="muted debt-note">นัดจ่าย ${p.dues.map(dFmt).join(" · ")} · กำไรจริง = ยอดขาย − ต้นทุนของที่ขาย − ค่าใช้จ่าย (เป็นเงินที่ควรกันไว้ ยังไม่ได้แยกบัญชีจริง)</p>`;
}
async function loadDebtTarget() {
  const { data } = await AccountingRepo.getSetting("debt_plan");
  if (data?.value?.target > 0) debtTarget = Number(data.value.target);
}
document.getElementById("debtEdit").addEventListener("click", async () => {
  const v = await Notify.prompt({ title: "เป้ากันเงินหนี้ต่อเดือน", message: "ยอดหนี้ที่ต้องจ่ายรวมทั้งเดือน (บาท)", placeholder: String(debtTarget), required: true });
  const n = Number(v);
  if (!(n > 0)) return v == null ? undefined : Notify.warning("ใส่ตัวเลขมากกว่า 0", "เช่น 35000");
  const { error } = await AccountingRepo.saveSetting("debt_plan", { target: n });
  if (error) return Notify.error("บันทึกเป้าไม่สำเร็จ", error);
  debtTarget = n;
  Notify.success("ตั้งเป้ากันเงินหนี้แล้ว", formatBaht(n));
  loadAll();
});

/* ---------- ส่งออก CSV ---------- */
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  if (!ledgerRowsForExport.length) {
    showToast("ยังไม่มีข้อมูลให้ส่งออก");
    return;
  }

  const header = "วันที่,รายการ,เงินเข้า,เงินออก,คงเหลือสะสม";
  const rows = ledgerRowsForExport.map((ev) => {
    const dateStr = ev.date.toLocaleDateString("th-TH");
    const desc = `"${ev.desc.replace(/"/g, '""')}"`;
    return [dateStr, desc, ev.in.toFixed(2), ev.out.toFixed(2), ev.balance.toFixed(2)].join(",");
  });

  const csvContent = "\uFEFF" + [header, ...rows].join("\n"); // \uFEFF กัน Excel อ่านภาษาไทยเพี้ยน
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `บัญชีร้าน-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// V19.1: แจ้งเตือนทั้งหมดไปที่ระบบกลาง notify.js (แยกสำเร็จ/ผิดพลาด/เตือน + รายละเอียด + วิธีแก้)
function showToast(msg) { return window.Notify ? Notify.auto(msg) : console.log(msg); }

loadDebtTarget().then(loadAll);

// Realtime: บัญชีสะท้อนค่าใช้จ่าย/ยอดขาย/Lot ที่เปลี่ยนจาก Device อื่น
const reloadAccountingDebounced = debounce(loadAll, 700);
window.addEventListener('vims:realtime', (event) => {
  if (event.detail?.table === 'page_refresh' || ['expenses', 'sales', 'lots', 'capital_entries'].includes(event.detail?.table)) reloadAccountingDebounced();
});
