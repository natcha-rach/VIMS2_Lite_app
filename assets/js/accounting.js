let editingExpenseId = null;
let expensesCache = [];
let baseAmountTouched = false;

// escapeHtml: ไฟล์นี้เดิมไม่มีฟังก์ชันนี้ ทำให้ category/note ของค่าใช้จ่ายถูกยัดเข้า innerHTML ตรงๆ
function escapeHtml(v = "") {
  return String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

document.getElementById("expenseDate").valueAsDate = new Date();

/* ---------- ระบบแบ่งถังเงิน ---------- */
const pctInputs = {
  cost: document.getElementById("pctCost"),
  debt: document.getElementById("pctDebt"),
  reserve: document.getElementById("pctReserve"),
  other: document.getElementById("pctOther"),
};
const bucketBaseAmountEl = document.getElementById("bucketBaseAmount");

async function loadBucketSettings() {
  const { data, error } = await supabaseClient
    .from("app_settings")
    .select("*")
    .eq("key", "bucket_split")
    .maybeSingle();

  if (error) {
    console.error(error);
    return;
  }
  if (data && data.value) {
    if (data.value.cost != null) pctInputs.cost.value = data.value.cost;
    if (data.value.debt != null) pctInputs.debt.value = data.value.debt;
    if (data.value.reserve != null) pctInputs.reserve.value = data.value.reserve;
    if (data.value.other != null) pctInputs.other.value = data.value.other;
  }
  recalcBuckets();
}

document.getElementById("bucketForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const value = {
    cost: Number(pctInputs.cost.value) || 0,
    debt: Number(pctInputs.debt.value) || 0,
    reserve: Number(pctInputs.reserve.value) || 0,
    other: Number(pctInputs.other.value) || 0,
  };

  const { error } = await supabaseClient
    .from("app_settings")
    .upsert({ key: "bucket_split", value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    console.error(error);
    showToast("บันทึกเปอร์เซ็นต์ไม่สำเร็จ: " + error.message);
    return;
  }
  showToast("บันทึกเปอร์เซ็นต์การแบ่งถังเงินเรียบร้อย ครั้งหน้าจะใช้ค่านี้ทันที");
});

function recalcBuckets() {
  const pctCost = Number(pctInputs.cost.value) || 0;
  const pctDebt = Number(pctInputs.debt.value) || 0;
  const pctReserve = Number(pctInputs.reserve.value) || 0;
  const pctOther = Number(pctInputs.other.value) || 0;
  const total = pctCost + pctDebt + pctReserve + pctOther;

  const warningEl = document.getElementById("pctTotalWarning");
  document.getElementById("pctTotalValue").textContent = total;
  warningEl.classList.toggle("hidden", total === 100);

  const base = Number(bucketBaseAmountEl.value) || 0;

  document.getElementById("bucketCostAmount").textContent = formatBaht((base * pctCost) / 100);
  document.getElementById("bucketDebtAmount").textContent = formatBaht((base * pctDebt) / 100);
  document.getElementById("bucketReserveAmount").textContent = formatBaht((base * pctReserve) / 100);
  document.getElementById("bucketOtherAmount").textContent = formatBaht((base * pctOther) / 100);
}

Object.values(pctInputs).forEach((input) => input.addEventListener("input", recalcBuckets));
bucketBaseAmountEl.addEventListener("input", () => {
  baseAmountTouched = true;
  recalcBuckets();
});

/* ---------- ฟอร์มเพิ่ม/แก้ไขค่าใช้จ่าย ---------- */
document.getElementById("expenseForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const payload = {
    expense_date: document.getElementById("expenseDate").value,
    amount: Number(document.getElementById("expenseAmount").value),
    category: document.getElementById("expenseCategory").value.trim(),
    note: document.getElementById("expenseNote").value.trim(),
  };

  if (editingExpenseId) {
    const { error } = await supabaseClient.from("expenses").update(payload).eq("id", editingExpenseId);
    if (error) {
      console.error(error);
      showToast("บันทึกไม่สำเร็จ: " + error.message);
      return;
    }
    showToast("แก้ไขค่าใช้จ่ายเรียบร้อย");
    exitEditMode();
  } else {
    const { error } = await supabaseClient.from("expenses").insert(payload);
    if (error) {
      console.error(error);
      showToast("บันทึกไม่สำเร็จ: " + error.message);
      return;
    }
    showToast("บันทึกค่าใช้จ่ายเรียบร้อย");
    document.getElementById("expenseForm").reset();
    document.getElementById("expenseDate").valueAsDate = new Date();
  }

  loadAll();
});

document.getElementById("cancelExpenseEdit").addEventListener("click", exitEditMode);

function exitEditMode() {
  editingExpenseId = null;
  document.getElementById("expenseForm").reset();
  document.getElementById("expenseDate").valueAsDate = new Date();
  document.getElementById("expenseSubmitBtn").textContent = "บันทึกค่าใช้จ่าย";
  document.getElementById("cancelExpenseEdit").classList.add("hidden");
}

function enterEditMode(expense) {
  editingExpenseId = expense.id;
  document.getElementById("expenseDate").value = expense.expense_date;
  document.getElementById("expenseAmount").value = expense.amount;
  document.getElementById("expenseCategory").value = expense.category || "";
  document.getElementById("expenseNote").value = expense.note || "";
  document.getElementById("expenseSubmitBtn").textContent = "บันทึกการแก้ไข";
  document.getElementById("cancelExpenseEdit").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function handleDeleteExpense(id) {
  const ok = confirm("ลบรายการค่าใช้จ่ายนี้ใช่ไหม?");
  if (!ok) return;

  const { error } = await supabaseClient.from("expenses").delete().eq("id", id);
  if (error) {
    console.error(error);
    showToast("ลบไม่สำเร็จ: " + error.message);
    return;
  }
  showToast("ลบค่าใช้จ่ายเรียบร้อย");
  if (editingExpenseId === id) exitEditMode();
  loadAll();
}

function renderExpenseList() {
  if (!expensesCache.length) {
    document.getElementById("expenseList").innerHTML = `<div class="empty-state">ยังไม่มีรายการค่าใช้จ่าย</div>`;
    return;
  }

  const sorted = [...expensesCache].sort((a, b) => (a.expense_date < b.expense_date ? 1 : -1));
  const html = sorted
    .map(
      (exp) => `
      <div class="tag-card expense-row">
        <div>
          <div class="expense-category">${escapeHtml(exp.category)}</div>
          <div class="expense-meta">${formatDate(exp.expense_date)}${exp.note ? " · " + escapeHtml(exp.note) : ""}</div>
        </div>
        <div class="expense-actions">
          <div class="expense-amount">${formatBaht(exp.amount)}</div>
          <div class="item-actions">
            <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${exp.id}">แก้ไข</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${exp.id}">ลบ</button>
          </div>
        </div>
      </div>`
    )
    .join("");

  document.getElementById("expenseList").innerHTML = html;

  document.querySelectorAll('#expenseList [data-action="edit"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const exp = expensesCache.find((x) => x.id === btn.dataset.id);
      if (exp) enterEditMode(exp);
    });
  });
  document.querySelectorAll('#expenseList [data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", () => handleDeleteExpense(btn.dataset.id));
  });
}

/* ---------- โหลดข้อมูลทั้งหมด + คำนวณสรุป + สมุดบัญชี ---------- */
let ledgerRowsForExport = [];

async function loadAll() {
  // fetchAllRows กัน sales/expenses ตกหล่นแบบเงียบๆ เมื่อเกิน 1000 แถว (default row limit ของ Supabase)
  const [{ data: lots, error: lotsErr }, { data: expenses, error: expErr }, { data: sales, error: salesErr }, { data: items, error: itemsErr }] =
    await Promise.all([
      fetchAllRows(() => supabaseClient.from("lots").select("*")),
      fetchAllRows(() => supabaseClient.from("expenses").select("*")),
      fetchAllRows(() => supabaseClient.from("sales").select("*, items(item_name)")),
      fetchAllRows(() => supabaseClient.from("items").select("id,lot_id")),
    ]);

  if (lotsErr || expErr || salesErr || itemsErr) {
    console.error(lotsErr || expErr || salesErr || itemsErr);
    showToast("โหลดข้อมูลไม่สำเร็จ");
    return;
  }

  expensesCache = expenses;
  renderExpenseList();

  const totalCapital = lots.reduce((sum, l) => sum + Number(l.total_cost || 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const totalRevenue = sales.reduce((sum, s) => sum + Number(s.sale_price || 0), 0);
  const totalCostSold = sales.reduce((sum, s) => sum + Number(s.cost_price || 0), 0);

  const netProfit = totalRevenue - totalCostSold - totalExpenses;
  const cashflow = totalRevenue - totalCapital - totalExpenses;

  document.getElementById("accCapital").textContent = formatBaht(totalCapital);
  document.getElementById("accExpenses").textContent = formatBaht(totalExpenses);
  document.getElementById("accRevenue").textContent = formatBaht(totalRevenue);

  if (!baseAmountTouched) {
    bucketBaseAmountEl.value = totalRevenue.toFixed(2);
  }
  recalcBuckets();

  const netProfitEl = document.getElementById("accNetProfit");
  netProfitEl.textContent = formatBaht(netProfit);
  netProfitEl.classList.remove("profit", "loss");
  netProfitEl.classList.add(netProfit >= 0 ? "profit" : "loss");

  const cashflowEl = document.getElementById("accCashflow");
  cashflowEl.textContent = formatBaht(cashflow);
  cashflowEl.classList.remove("profit", "loss");
  cashflowEl.classList.add(cashflow >= 0 ? "profit" : "loss");

  renderLotAccounting(lots, items, sales);
  renderLedger(lots, expenses, sales);
}

// สรุปทุน/ยอดขาย/กำไรของแต่ละ Lot สำหรับหน้าบัญชี
// ใช้ต้นทุนจาก sales.cost_price เพื่อเก็บ snapshot ของต้นทุนตอนขาย และไม่ทำให้กำไรย้อนหลังเปลี่ยน
function renderLotAccounting(lots, items, sales) {
  const itemMap = Object.fromEntries(items.map(i => [i.id, i]));
  const byLot = Object.fromEntries(lots.map(lot => [lot.id, {
    lot,
    totalItems: Number(lot.total_items || 0),
    sold: 0,
    revenue: 0,
    costSold: 0,
    remaining: Number(lot.total_items || 0),
    remainingCapital: Number(lot.total_cost || 0),
    profit: 0,
    recoveryPct: 0,
  }]));

  sales.forEach(sale => {
    const item = itemMap[sale.item_id];
    const row = item && byLot[item.lot_id];
    if (!row) return;
    row.sold += 1;
    row.revenue += Number(sale.sale_price || 0);
    row.costSold += Number(sale.cost_price || 0);
  });

  Object.values(byLot).forEach(row => {
    row.remaining = Math.max(0, row.totalItems - row.sold);
    row.remainingCapital = Math.max(0, Number(row.lot.total_cost || 0) - row.costSold);
    row.profit = row.revenue - row.costSold;
    row.recoveryPct = row.lot.total_cost ? (row.revenue / Number(row.lot.total_cost)) * 100 : 0;
  });

  const rows = Object.values(byLot).filter(row => row.totalItems > 0 || row.sold > 0).sort((a, b) => b.revenue - a.revenue);
  document.getElementById("accLotBreakdown").innerHTML = rows.length ? rows.map(row => `
    <tr>
      <td><b>${escapeHtml(row.lot.lot_name)}</b><small class="table-sub">ซื้อ ${formatDate(row.lot.purchase_date)}</small></td>
      <td style="text-align:right">${formatBaht(row.lot.total_cost)}</td>
      <td style="text-align:right">${row.totalItems}</td>
      <td style="text-align:right">${row.sold}</td>
      <td style="text-align:right">${row.remaining}</td>
      <td style="text-align:right">${formatBaht(row.revenue)}</td>
      <td style="text-align:right">${formatBaht(row.costSold)}</td>
      <td style="text-align:right">${formatBaht(row.remainingCapital)}</td>
      <td style="text-align:right" class="${row.profit >= 0 ? "profit" : "loss"}">${formatBaht(row.profit)}</td>
      <td style="text-align:right">${row.recoveryPct.toFixed(1)}%</td>
    </tr>`).join("") : `<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล Lot</td></tr>`;
}

function renderLedger(lots, expenses, sales) {
  const events = [];

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
      date: new Date(e.expense_date),
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
    running += ev.in - ev.out;
    ev.balance = running;
  });

  ledgerRowsForExport = events;

  if (!events.length) {
    document.getElementById("ledgerBody").innerHTML = `<tr><td colspan="5" class="empty-state">ยังไม่มีรายการ</td></tr>`;
    return;
  }

  // แสดงใหม่ -> เก่า
  const html = [...events]
    .reverse()
    .map(
      (ev) => `
      <tr>
        <td>${formatDate(ev.date)}</td>
        <td>${escapeHtml(ev.desc)}</td>
        <td style="text-align:right">${ev.in ? formatBaht(ev.in) : "-"}</td>
        <td style="text-align:right">${ev.out ? formatBaht(ev.out) : "-"}</td>
        <td style="text-align:right">${formatBaht(ev.balance)}</td>
      </tr>`
    )
    .join("");

  document.getElementById("ledgerBody").innerHTML = html;
}

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

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

loadAll();
loadBucketSettings();

// Realtime: บัญชีสะท้อนค่าใช้จ่าย/ยอดขาย/Lot ที่เปลี่ยนจาก Device อื่น
const reloadAccountingDebounced = debounce(loadAll, 700);
window.addEventListener('vims:realtime', (event) => {
  if (event.detail?.table === 'page_refresh' || ['expenses', 'sales', 'lots', 'items'].includes(event.detail?.table)) reloadAccountingDebounced();
});
