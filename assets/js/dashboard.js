let dashboardRows = null;
// Cache นี้ถูก invalidate เมื่อข้อมูลจาก Device อื่นเปลี่ยน เพื่อให้ Dashboard สะท้อนยอดล่าสุด
let periodMode = "day"; // "day" | "month" | "year"
let periodValue = new Date(); // วันที่/เดือน/ปีอ้างอิงของโหมดที่เลือกอยู่
let monthlyGoal = 0; // เป้ายอดขายเดือนนี้ (บาท) โหลดจาก app_settings คีย์ monthly_sales_goal
const $ = (id) => document.getElementById(id);

const CHANNEL_LABELS = { street_market: "ถนนคนเดิน", facebook: "Facebook", instagram: "Instagram" };
const TIER_LABELS = { normal: "ปกติ", head: "งานหัว / Premium" };
// หมายเหตุ: PAYMENT_LABELS ไม่ประกาศซ้ำที่นี่ — ใช้ตัวที่มาจาก supabaseClient.js (โหลดก่อนไฟล์นี้ทุกหน้า)
// เพราะ <script> ปกติ (ไม่ใช่ type=module) แชร์ scope เดียวกัน ถ้า const ซ้ำชื่อจะทำให้ทั้งหน้าพังด้วย SyntaxError

// ---------- Icon set: แทน Emoji ด้วย inline SVG แบบเดียวกับ template ----------
const ICONS = {
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2L12 3z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>',
  danger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="12" y1="7.5" x2="12" y2="13"/><line x1="12" y1="16" x2="12" y2="16.01"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 7 9 13 13 9 21 18"/><polyline points="14 18 21 18 21 11"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 17 9 11 13 15 21 6"/><polyline points="14 6 21 6 21 13"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 9.5 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.5 9 9 12 2"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/></svg>',
  baht: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v18"/><path d="M7 4h7a4 4 0 0 1 0 8H7"/><path d="M7 12h6a4 4 0 0 1 0 8H7"/><line x1="4" y1="9" x2="10" y2="9"/></svg>',
};

function escapeHtml(v = "") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dateKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; }

// ช่วงเวลาปัจจุบันคำนวณจาก periodMode + periodValue เสมอ — แทนที่ preset เดิม (วันนี้/7วัน/เดือนนี้/3เดือน/ปีนี้/ทั้งหมด/กำหนดเอง)
// ด้วยโหมดเดียว 3 แบบ (รายวัน/รายเดือน/รายปี) ที่แต่ละแบบมี "วันที่อ้างอิง" ให้เลือกแค่จุดเดียว ไม่ใช่ช่วง
function currentRange() {
  const d = periodValue;
  if (periodMode === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 1);
    return { start, end: new Date(end.getTime()-1) };
  }
  if (periodMode === "year") {
    const start = new Date(d.getFullYear(), 0, 1);
    const end = new Date(d.getFullYear()+1, 0, 1);
    return { start, end: new Date(end.getTime()-1) };
  }
  const start = startOfDay(d);
  return { start, end: new Date(start.getTime()+86399999) };
}

function periodLabel() {
  const d = periodValue;
  if (periodMode === "month") return new Intl.DateTimeFormat("th-TH", { month:"long", year:"numeric" }).format(d);
  if (periodMode === "year") return new Intl.DateTimeFormat("th-TH", { year:"numeric" }).format(d);
  return new Intl.DateTimeFormat("th-TH", { weekday:"short", day:"numeric", month:"short", year:"numeric" }).format(d);
}

function inRange(value, range) { const d = new Date(value); return d >= range.start && d <= range.end; }
function sum(arr, fn) { return arr.reduce((a,x) => a + Number(fn(x) || 0), 0); }
function percent(a,b) { return b ? (a/b)*100 : 0; }

async function fetchDashboardData() {
  // fetchAllRows แทนการเรียก supabaseClient.from(...) ตรงๆ เพราะ PostgREST คืนสูงสุด 1000 แถว/ครั้ง
  // ถ้าไม่ paginate ยอด Dashboard จะตกหล่นแบบเงียบๆ เมื่อ items/sales เกิน 1000 แถว
  // หมายเหตุ V13: ไม่ดึง lots/lot_groups ที่นี่แล้ว เพราะ Lot Performance/Recovery ย้ายไปใช้
  // RPC get_lot_performance() (คำนวณใน Postgres) แทนการดึงมา group ฝั่ง browser — ดู renderLotRecovery()
  const [itemsR, salesR, expensesR, settingsR] = await Promise.all([
    fetchAllRows(() => supabaseClient.from("items").select("id,lot_id,item_name,size,condition,tier,cost_price,current_price,status,created_at,sold_at,group_id")),
    fetchAllRows(() => supabaseClient.from("sales").select("id,item_id,sale_date,channel,sale_price,cost_price,payment_method")),
    fetchAllRows(() => supabaseClient.from("expenses").select("id,expense_date,amount,category")),
    supabaseClient.from("app_settings").select("key,value").eq("key", "monthly_sales_goal").maybeSingle()
  ]);
  const err = itemsR.error || salesR.error || expensesR.error;
  if (err) throw err;
  const goalValue = settingsR?.data?.value;
  monthlyGoal = Number((typeof goalValue === "object" ? goalValue?.amount : goalValue) || 0);
  return { items: itemsR.data || [], sales: salesR.data || [], expenses: expensesR.data || [] };
}

async function saveMonthlyGoal(amount) {
  const { error } = await supabaseClient.from("app_settings").upsert({ key: "monthly_sales_goal", value: { amount }, updated_at: new Date().toISOString() });
  if (error) throw error;
  monthlyGoal = amount;
}

// ช่วงเวลาก่อนหน้าที่มีความยาวเท่ากับ range ปัจจุบัน ใช้เทียบ % การเติบโต (Period-over-Period)
function previousRange(range) {
  const spanMs = range.end.getTime() - range.start.getTime();
  const prevEnd = new Date(range.start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - spanMs);
  return { start: prevStart, end: prevEnd };
}

function deltaPct(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function renderDelta(elId, current, previous) {
  const el = $(elId);
  if (!el) return;
  const d = deltaPct(current, previous);
  const up = d >= 0;
  const icon = up ? ICONS.up : ICONS.down;
  el.className = `stat-delta ${up ? "up" : "down"}`;
  el.innerHTML = `<span class="stat-delta-icon">${icon}</span>${Math.abs(d).toFixed(1)}% vs ช่วงก่อนหน้า`;
}

function renderGoalCard(sales) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthSales = sales.filter(s => { const d = new Date(s.sale_date); return d >= start && d < end; });
  const revenue = sum(monthSales, s => s.sale_price);
  $("goalRevenue").textContent = formatBaht(revenue);
  if (monthlyGoal > 0) {
    const pct = Math.min(100, (revenue / monthlyGoal) * 100);
    $("goalTarget").textContent = formatBaht(monthlyGoal);
    $("goalTarget").className = "goal-target";
    $("goalFill").style.width = `${pct.toFixed(1)}%`;
    $("goalFill").classList.toggle("goal-fill-done", pct >= 100);
    $("goalNote").textContent = pct >= 100 ? "ถึงเป้าเดือนนี้แล้ว — เก็บโมเมนตัมต่อไป" : `อีก ${formatBaht(Math.max(0, monthlyGoal - revenue))} ถึงเป้า (${pct.toFixed(0)}%)`;
  } else {
    $("goalTarget").textContent = "ยังไม่ได้ตั้งเป้า";
    $("goalFill").style.width = "0%";
    $("goalNote").textContent = 'กด "ตั้งเป้า" เพื่อกำหนดเป้ายอดขายของเดือนนี้';
  }
}

function toCsvValue(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function exportDashboardCSV(range) {
  if (!dashboardRows) return showToast("ข้อมูลยังไม่พร้อม");
  const { items, sales } = dashboardRows;
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const periodSales = sales.filter(s => inRange(s.sale_date, range)).sort((a, b) => new Date(a.sale_date) - new Date(b.sale_date));
  const revenue = sum(periodSales, s => s.sale_price);
  const cogs = sum(periodSales, s => s.cost_price);
  const rows = [
    ["สรุปช่วงเวลา", `${dateKey(range.start)} ถึง ${dateKey(range.end)}`],
    ["ยอดขาย (บาท)", revenue],
    ["กำไรขั้นต้น (บาท)", revenue - cogs],
    ["จำนวนรายการขาย", periodSales.length],
    [],
    ["วันที่", "สินค้า", "ไซส์", "สภาพ", "Tier", "ช่องทาง", "วิธีจ่าย", "ราคาขาย", "ต้นทุน", "กำไร"],
  ];
  periodSales.forEach(s => {
    const it = itemById[s.item_id] || {};
    rows.push([
      formatDate(s.sale_date), it.item_name || "", it.size || "", it.condition || "",
      it.tier === "head" ? "งานหัว" : "ปกติ", CHANNEL_LABELS[s.channel] || s.channel || "",
      PAYMENT_LABELS[s.payment_method] || s.payment_method || "",
      s.sale_price, s.cost_price, (Number(s.sale_price || 0) - Number(s.cost_price || 0)).toFixed(2),
    ]);
  });
  const csv = "\uFEFF" + rows.map(r => r.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `dashboard-${dateKey(range.start)}_${dateKey(range.end)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}



// V13: Lot Performance/Recovery คำนวณผ่าน RPC get_lot_performance() (Postgres) แทนการ
// ดึง lots+items+sales ทั้งตารางมา group ฝั่ง browser เหมือนเดิม — ดู renderLotRecovery() ด้านล่าง
async function fetchLotPerformance() {
  const { data, error } = await supabaseClient.rpc("get_lot_performance");
  if (error) throw error;
  return data || [];
}

// Lot Recovery: การ์ดเดียวที่เหลืออยู่บน Dashboard ที่ต้องใช้ยอดสะสมตลอดอายุ Lot
// (ตาราง Performance ตาม Lot แบบเต็มย้ายไปอยู่หน้า Reports แล้ว ไม่ซ้ำกันอีกต่อไป)
async function renderLotRecovery() {
  const el = $("lotRecovery");
  if (!el) return;
  try {
    const rows = (await fetchLotPerformance())
      .filter(x => Number(x.revenue) > 0)
      .sort((a, b) => Number(b.revenue) - Number(a.revenue))
      .slice(0, 12);
    el.innerHTML = rows.length ? rows.map(x => {
      const pct = Number(x.recovery_pct) || 0;
      return `<div class="lot-recovery-row"><div class="lot-meta"><b>${escapeHtml(x.lot_name)}</b><small>ทุน ${formatBaht(x.total_cost)} · ยอดขาย ${formatBaht(x.revenue)} · กำไร ${formatBaht(x.profit)} · ทุนคงเหลือ ${formatBaht(x.remaining_capital)}</small></div><div class="recovery-track"><div class="recovery-fill" style="width:${Math.min(100, pct).toFixed(1)}%"></div></div><div class="recovery-value">${pct.toFixed(0)}%<small>คืนทุน</small></div></div>`;
    }).join("") : `<div class="empty-state">ยังไม่มี Lot ที่มีการขาย</div>`;
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="empty-state">โหลดข้อมูล Lot ไม่สำเร็จ</div>`;
  }
}

// สรุปเพิ่มเติม: แทนที่ตาราง Tier/Payment/Channel ที่เดิมซ้ำกับหน้า Reports
// เหลือแค่ "ใครทำผลงานดีที่สุด" 1 บรรทัดต่อเรื่อง ให้ตัดสินใจเร็ว แล้วลิงก์ไปดูละเอียดที่ Reports
function renderQuickInsights(periodSales, items, revenue) {
  const el = $("quickInsights");
  if (!el) return;
  if (!periodSales.length) { el.innerHTML = `<div class="empty-state">ยังไม่มีการขายในช่วงที่เลือก</div>`; return; }

  const channels = {};
  periodSales.forEach(s => { const k = s.channel || "other"; channels[k] = (channels[k] || 0) + Number(s.sale_price || 0); });
  const topChannel = Object.entries(channels).sort((a, b) => b[1] - a[1])[0];

  const payments = {};
  periodSales.forEach(s => { payments[s.payment_method] = (payments[s.payment_method] || 0) + Number(s.sale_price || 0); });
  const topPayment = Object.entries(payments).sort((a, b) => b[1] - a[1])[0];

  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const tierStats = { normal: { revenue: 0, profit: 0 }, head: { revenue: 0, profit: 0 } };
  periodSales.forEach(s => {
    const tier = itemById[s.item_id]?.tier === "head" ? "head" : "normal";
    tierStats[tier].revenue += Number(s.sale_price || 0);
    tierStats[tier].profit += Number(s.sale_price || 0) - Number(s.cost_price || 0);
  });
  const bestTier = tierStats.head.profit >= tierStats.normal.profit ? "head" : "normal";

  const rowsHtml = [
    topChannel && `<div class="insight-row">${ICONS.up}<span>ช่องทางขายดีที่สุด</span><b>${escapeHtml(CHANNEL_LABELS[topChannel[0]] || topChannel[0])}</b><small>${percent(topChannel[1], revenue).toFixed(0)}% ของยอดขาย</small></div>`,
    topPayment && `<div class="insight-row">${ICONS.baht}<span>วิธีจ่ายหลัก</span><b>${escapeHtml(PAYMENT_LABELS[topPayment[0]] || topPayment[0])}</b><small>${percent(topPayment[1], revenue).toFixed(0)}% ของยอดขาย</small></div>`,
    `<div class="insight-row">${ICONS.star}<span>Tier กำไรดีกว่า</span><b>${TIER_LABELS[bestTier]}</b><small>กำไร ${formatBaht(tierStats[bestTier].profit)}</small></div>`,
  ].filter(Boolean).join("");
  el.innerHTML = rowsHtml;
}

let v11RevenueChart = null;
let v11InventoryChart = null;

function v11ChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1a1d29',
        borderColor: '#2c3146',
        borderWidth: 1,
        titleColor: '#fff',
        bodyColor: '#d6d9e8',
        padding: 10,
        callbacks: { label: ctx => `${ctx.dataset.label}: ${formatBaht(ctx.parsed.y ?? ctx.parsed)}` }
      }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#98a0b6', font: { family: 'Inter', size: 10 } } },
      y: { grid: { color: '#eceef7' }, ticks: { color: '#98a0b6', font: { family: 'Inter', size: 10 }, callback: v => formatBaht(v).replace('฿','') } }
    }
  };
}

function v11DestroyChart(chart) { try { chart?.destroy(); } catch (_) {} }

// ---------- Sparklines: mini trend line inside KPI cards (คล้าย stat card ใน template ตัวอย่าง) ----------
const v11Sparklines = {};
function renderSparkline(canvasId, values, color) {
  const el = document.getElementById(canvasId);
  if (!el || typeof Chart === 'undefined') return;
  v11DestroyChart(v11Sparklines[canvasId]);
  if (!values || values.length < 2) { values = [0, 0]; }
  v11Sparklines[canvasId] = new Chart(el, {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: color,
        backgroundColor: color + '1f',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { line: { capBezierPoints: true } },
    }
  });
}

function v11BuildTrend(periodSales, range) {
  const spanDays = Math.max(1, Math.ceil((range.end - range.start) / 86400000));
  const useDay = spanDays <= 45;
  const buckets = {};
  const keyFor = d => useDay
    ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  const labelFor = d => useDay
    ? new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short'}).format(d)
    : new Intl.DateTimeFormat('th-TH',{month:'short',year:'2-digit'}).format(d);
  periodSales.forEach(s => {
    const d = new Date(s.sale_date), key = keyFor(d);
    buckets[key] ||= { label: labelFor(d), revenue: 0, cost: 0, profit: 0 };
    buckets[key].revenue += Number(s.sale_price || 0);
    buckets[key].cost += Number(s.cost_price || 0);
    buckets[key].profit += Number(s.sale_price || 0) - Number(s.cost_price || 0);
  });
  const rows = Object.entries(buckets).sort(([a],[b]) => a.localeCompare(b)).map(([,v])=>v);
  return { labels: rows.map(x=>x.label), revenue: rows.map(x=>x.revenue), cost: rows.map(x=>x.cost), profit: rows.map(x=>x.profit) };
}

function renderV11Charts(periodSales, items, range, revenue, grossProfit, margin) {
  if (typeof Chart === 'undefined') return;
  const trend = v11BuildTrend(periodSales, range);
  const ctx = document.getElementById('revenueTrendChart');
  if (ctx) {
    v11DestroyChart(v11RevenueChart);
    v11RevenueChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: trend.labels,
        datasets: [
          { label:'Revenue', data:trend.revenue, borderColor:'#4a5cf0', backgroundColor:'rgba(74,92,240,.10)', fill:true, tension:.38, pointRadius:2.5, pointHoverRadius:5 },
          { label:'Gross Profit', data:trend.profit, borderColor:'#0ea5e9', backgroundColor:'transparent', fill:false, tension:.38, pointRadius:2.5, pointHoverRadius:5 },
          { label:'COGS', data:trend.cost, borderColor:'#b2b8cf', backgroundColor:'transparent', fill:false, borderDash:[5,5], tension:.3, pointRadius:0 }
        ]
      },
      options: v11ChartDefaults()
    });
  }
  const setText=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  setText('chartRevenueTotal', formatBaht(revenue));
  setText('chartProfitTotal', formatBaht(grossProfit));
  setText('chartMarginTotal', `${margin.toFixed(1)}%`);

  // KPI card sparklines ใช้ข้อมูล trend ชุดเดียวกับกราฟหลัก ไม่ query ซ้ำ
  renderSparkline('statRevenueSpark', trend.revenue, '#4a5cf0');
  renderSparkline('statGrossProfitSpark', trend.profit, '#17b26a');

  const inv={available:0,sold:0,damaged:0};
  items.forEach(i=>inv[i.status]=(inv[i.status]||0)+1);
  const ictx=document.getElementById('inventoryHealthChart');
  if(ictx){
    v11DestroyChart(v11InventoryChart);
    v11InventoryChart=new Chart(ictx,{type:'doughnut',data:{labels:['พร้อมขาย','ขายแล้ว','เสีย'],datasets:[{data:[inv.available,inv.sold,inv.damaged],backgroundColor:['#17b26a','#0ea5e9','#f04438'],borderColor:'#fff',borderWidth:4,hoverOffset:6}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{color:'#5c6480',font:{family:'Prompt',size:11},usePointStyle:true,pointStyle:'circle',padding:18}},tooltip:{backgroundColor:'#1a1d29',borderColor:'#2c3146',borderWidth:1}}}});
  }
}


function renderDashboard(data, range) {
  const { items, sales, expenses } = data;
  renderGoalCard(sales);
  $("pulseDate").textContent = periodLabel();

  const periodSales = sales.filter(s => inRange(s.sale_date, range));
  const periodExpenses = expenses.filter(e => inRange(`${e.expense_date}T23:59:59`, range));
  const revenue = sum(periodSales, s => s.sale_price);
  const cogs = sum(periodSales, s => s.cost_price);
  const grossProfit = revenue - cogs;
  const expensesTotal = sum(periodExpenses, e => e.amount);
  const netProfit = grossProfit - expensesTotal;
  const margin = percent(grossProfit, revenue);
  const cash = sum(periodSales.filter(s => s.payment_method === "cash"), s => s.sale_price);
  const available = items.filter(i => i.status === "available");

  renderV11Charts(periodSales, items, range, revenue, grossProfit, margin);
  $("statRevenue").textContent = formatBaht(revenue);
  $("statRevenueMeta").textContent = `${periodSales.length} รายการขาย`;
  $("statGrossProfit").textContent = formatBaht(grossProfit);
  $("statMargin").textContent = `Margin ${margin.toFixed(1)}%`;
  $("statExpenses").textContent = formatBaht(expensesTotal);
  $("statNetProfit").textContent = formatBaht(netProfit);
  $("statNetProfit").className = `value ${netProfit >= 0 ? "positive" : "negative"}`;
  $("statCash").textContent = formatBaht(cash);
  $("statAvailable").textContent = `${available.length} ชิ้น`;
  $("statAvailableMeta").textContent = `มูลค่าทุน ${formatBaht(sum(available,i=>i.cost_price))} · ไม่ขึ้นกับช่วงเวลาที่เลือก`;

  // Period-over-period: เทียบกับช่วงก่อนหน้าที่มีความยาวเท่ากันเสมอ (วันก่อนหน้า/เดือนก่อนหน้า/ปีก่อนหน้า)
  const prevRange = previousRange(range);
  const prevSales = sales.filter(s => inRange(s.sale_date, prevRange));
  const prevExpenses = expenses.filter(e => inRange(`${e.expense_date}T23:59:59`, prevRange));
  const prevRevenue = sum(prevSales, s => s.sale_price);
  const prevGrossProfit = prevRevenue - sum(prevSales, s => s.cost_price);
  const prevExpensesTotal = sum(prevExpenses, e => e.amount);
  const prevNetProfit = prevGrossProfit - prevExpensesTotal;
  const prevCash = sum(prevSales.filter(s => s.payment_method === "cash"), s => s.sale_price);
  renderDelta("statRevenueDelta", revenue, prevRevenue);
  renderDelta("statGrossProfitDelta", grossProfit, prevGrossProfit);
  renderDelta("statExpensesDelta", expensesTotal, prevExpensesTotal);
  renderDelta("statNetProfitDelta", netProfit, prevNetProfit);
  renderDelta("statCashDelta", cash, prevCash);

  const sold = items.filter(i => i.status === "sold");
  const damaged = items.filter(i => i.status === "damaged");
  const stockCost = sum(available, i => i.cost_price);
  const stockRetail = sum(available, i => i.current_price);

  // Channel/Payment/Tier breakdown แบบเต็มย้ายไปหน้า Reports (ไม่ซ้ำกันอีกต่อไป) —
  // Dashboard เหลือแค่สรุป 1 บรรทัดต่อเรื่องเพื่อการตัดสินใจเร็ว
  renderQuickInsights(periodSales, items, revenue);

  const now = new Date(); const agingBuckets = [{label:"0–7 วัน",min:0,max:7,count:0},{label:"8–30 วัน",min:8,max:30,count:0},{label:"31–60 วัน",min:31,max:60,count:0},{label:"61–90 วัน",min:61,max:90,count:0},{label:"90+ วัน",min:91,max:99999,count:0}];
  available.forEach(i => { const days = Math.max(0, Math.floor((now-new Date(i.created_at))/86400000)); const b = agingBuckets.find(x => days>=x.min && days<=x.max); if (b) b.count++; });
  const maxAge = Math.max(1,...agingBuckets.map(x=>x.count));
  $("agingList").innerHTML = agingBuckets.map(b => `<div class="aging-row"><span>${b.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(b.count/maxAge*100)}%"></div></div><b>${b.count}</b></div>`).join("");

  $("stockCount").innerHTML = `<div><b>${items.length}</b><span>สินค้าทั้งหมด</span></div><div><b>${available.length}</b><span>พร้อมขาย</span></div><div><b>${sold.length}</b><span>ขายแล้ว</span></div><div><b>${damaged.length}</b><span>เสีย</span></div><div><b>${formatBaht(stockCost)}</b><span>ต้นทุนคงเหลือ</span></div><div><b>${formatBaht(stockRetail)}</b><span>ราคาขายคงเหลือ</span></div>`;

  const markdown = available.map(i => { const days=Math.max(0,Math.floor((now-new Date(i.created_at))/86400000)); return {...i,days}; }).filter(i=>i.days>=60).sort((a,b)=>b.days-a.days).slice(0,8);
  $("markdownList").innerHTML = markdown.length ? markdown.map(i => `<div class="markdown-item"><div><b>${escapeHtml(i.item_name)}</b><small>${i.days} วัน · ${escapeHtml(i.size||"-")} · ${i.condition} · ${i.tier==='head'?'งานหัว':'ปกติ'}</small></div><div style="text-align:right"><b>${formatBaht(i.current_price)}</b><small>ต้นทุน ${formatBaht(i.cost_price)}</small></div></div>`).join("") : `<div class="empty-state">ยังไม่มีสินค้าที่ค้าง 60+ วัน</div>`;

  // Top profit items ย้ายไปวิเคราะห์ต่อในหน้า "รายงาน" (reports.js) แทน — Dashboard
  // เน้นเฉพาะสิ่งที่ต้องตัดสินใจวันนี้ ไม่ใช่การวิเคราะห์เชิงลึกรายช่วง
  // Lot Recovery แสดงแยกผ่าน renderLotRecovery() (โหลดจาก RPC) — ไม่ผูกกับ periodSales ของฟังก์ชันนี้
}


async function loadDashboard(range) {
  try {
    dashboardRows ||= await fetchDashboardData();
    renderDashboard(dashboardRows, range);
  } catch (err) { console.error(err); showToast("โหลด Dashboard ไม่สำเร็จ: " + (err.message || err)); }
  // แยกจาก renderDashboard เพราะดึงผ่าน RPC (async) และไม่ผูกกับ periodRange — ไม่ต้อง block การแสดง KPI หลัก
  renderLotRecovery();
}

function setPeriodMode(mode) {
  periodMode = mode;
  $("periodModeSelect").value = mode;
  $("periodDate").classList.toggle("hidden", mode !== "day");
  $("periodMonth").classList.toggle("hidden", mode !== "month");
  $("periodYear").classList.toggle("hidden", mode !== "year");
  syncPeriodValueFromInputs();
  loadDashboard(currentRange());
}

// อ่านค่าจาก input ที่กำลังแสดงอยู่ (ตาม periodMode) มาเป็น periodValue จุดเดียวที่ currentRange() ใช้คำนวณช่วง
function syncPeriodValueFromInputs() {
  if (periodMode === "month") {
    const v = $("periodMonth").value;
    if (v) { const [y, m] = v.split("-"); periodValue = new Date(Number(y), Number(m) - 1, 1); }
  } else if (periodMode === "year") {
    const v = $("periodYear").value;
    if (v) periodValue = new Date(Number(v), 0, 1);
  } else {
    const v = $("periodDate").value;
    if (v) periodValue = new Date(`${v}T00:00:00`);
  }
}

function populateYearSelect() {
  const sel = $("periodYear");
  const nowY = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => nowY - i);
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
}

$("periodModeSelect").addEventListener("change", (e) => setPeriodMode(e.target.value));
$("periodDate").addEventListener("change", () => { syncPeriodValueFromInputs(); loadDashboard(currentRange()); });
$("periodMonth").addEventListener("change", () => { syncPeriodValueFromInputs(); loadDashboard(currentRange()); });
$("periodYear").addEventListener("change", () => { syncPeriodValueFromInputs(); loadDashboard(currentRange()); });
$("exportCsvBtn")?.addEventListener("click", () => exportDashboardCSV(currentRange()));
$("editGoalBtn")?.addEventListener("click", async () => {
  const input = prompt("ตั้งเป้ายอดขายเดือนนี้ (บาท)", monthlyGoal || "");
  if (input === null) return;
  const val = Number(String(input).replace(/[^0-9.]/g, ""));
  if (!isFinite(val) || val < 0) return showToast("กรุณากรอกตัวเลขให้ถูกต้อง");
  try {
    await saveMonthlyGoal(val);
    renderGoalCard(dashboardRows?.sales || []);
    showToast("บันทึกเป้ายอดขายแล้ว");
  } catch (err) { console.error(err); showToast("บันทึกเป้าไม่สำเร็จ: " + (err.message || err)); }
});
function showToast(m){const t=$("toast");if(!t)return;t.textContent=m;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2600)}

// Realtime: Dashboard ต้องดึงข้อมูลใหม่เมื่อ Lot / Item / Sale / Expense เปลี่ยนจาก Device อื่น
// debounce: Bulk save ยิง event เป็นร้อยครั้ง — โหลด Dashboard ใหม่ครั้งเดียวหลังนิ่งแล้ว
const reloadDashboardDebounced = debounce(() => loadDashboard(currentRange()), 700);
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['lots', 'lot_groups', 'items', 'sales', 'expenses'].includes(table)) {
    dashboardRows = null;
    reloadDashboardDebounced();
  }
});

// ค่าเริ่มต้น: โหมดรายวัน วันที่ปัจจุบัน — ตั้งค่า input ทั้ง 3 แบบไว้ล่วงหน้าแม้จะซ่อนอยู่
// เพื่อให้สลับโหมดแล้วมีค่าเริ่มต้นที่สมเหตุสมผลทันทีโดยไม่ต้องรอผู้ใช้กรอก
const __now = new Date();
$("periodDate").value = dateKey(__now);
$("periodMonth").value = `${__now.getFullYear()}-${String(__now.getMonth() + 1).padStart(2, "0")}`;
populateYearSelect();
loadDashboard(currentRange());
