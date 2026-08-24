let dashboardRows = null;
// Cache นี้ถูก invalidate เมื่อข้อมูลจาก Device อื่นเปลี่ยน เพื่อให้ Dashboard สะท้อนยอดล่าสุด
let activeRange = "today";
const $ = (id) => document.getElementById(id);

const CHANNEL_LABELS = { street_market: "ถนนคนเดิน", facebook: "Facebook", instagram: "Instagram" };
const TIER_LABELS = { normal: "ปกติ", head: "งานหัว / Premium" };

function escapeHtml(v = "") { return String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function dateKey(d) { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`; }
function rangeFromPreset(preset) {
  const now = new Date(); const end = startOfDay(now); let start = new Date(end);
  if (preset === "7d") start.setDate(start.getDate()-6);
  else if (preset === "month") start = new Date(end.getFullYear(), end.getMonth(), 1);
  else if (preset === "3m") start = new Date(end.getFullYear(), end.getMonth()-2, 1);
  else if (preset === "year") start = new Date(end.getFullYear(), 0, 1);
  else if (preset === "all") start = new Date(2000, 0, 1);
  return { start, end: new Date(end.getTime()+86399999) };
}
function rangeFromCustom() {
  const f = $("fromDate").value, t = $("toDate").value; if (!f || !t) return null;
  const start = new Date(`${f}T00:00:00`), end = new Date(`${t}T23:59:59`);
  return end < start ? null : { start, end };
}
function inRange(value, range) { const d = new Date(value); return d >= range.start && d <= range.end; }
function sum(arr, fn) { return arr.reduce((a,x) => a + Number(fn(x) || 0), 0); }
function percent(a,b) { return b ? (a/b)*100 : 0; }

async function fetchDashboardData() {
  // fetchAllRows แทนการเรียก supabaseClient.from(...) ตรงๆ เพราะ PostgREST คืนสูงสุด 1000 แถว/ครั้ง
  // ถ้าไม่ paginate ยอด Dashboard จะตกหล่นแบบเงียบๆ เมื่อ items/sales เกิน 1000 แถว
  const [lotsR, groupsR, itemsR, salesR, expensesR] = await Promise.all([
    fetchAllRows(() => supabaseClient.from("lots").select("id,lot_name,purchase_date,total_cost,total_items")),
    fetchAllRows(() => supabaseClient.from("lot_groups").select("id,lot_id,group_name,base_price,tier")),
    fetchAllRows(() => supabaseClient.from("items").select("id,lot_id,item_name,size,condition,tier,cost_price,current_price,status,created_at,sold_at,group_id")),
    fetchAllRows(() => supabaseClient.from("sales").select("id,item_id,sale_date,channel,sale_price,cost_price,payment_method")),
    fetchAllRows(() => supabaseClient.from("expenses").select("id,expense_date,amount,category"))
  ]);
  const err = lotsR.error || groupsR.error || itemsR.error || salesR.error || expensesR.error;
  if (err) throw err;
  return { lots: lotsR.data || [], groups: groupsR.data || [], items: itemsR.data || [], sales: salesR.data || [], expenses: expensesR.data || [] };
}

// สร้างตัวเลขการเงินของแต่ละ Lot จาก Item -> Lot และ Sale -> Item
// สูตรหลัก:
// - ต้นทุนที่ขาย = SUM(sales.cost_price) ของสินค้าที่มาจาก Lot
// - ทุนคงเหลือ = Lot.total_cost - ต้นทุนที่ขาย
// - กำไร = ยอดขายสะสม - ต้นทุนที่ขาย
// - คืนทุน = ยอดขายสะสม / ต้นทุน Lot * 100
function buildLotPerformance(lots, items, sales) {
  const itemById = Object.fromEntries(items.map(i => [i.id, i]));
  const stats = {};
  lots.forEach(lot => {
    stats[lot.id] = {
      lot,
      totalItems: Number(lot.total_items || 0),
      sold: 0,
      remaining: Number(lot.total_items || 0),
      revenue: 0,
      costSold: 0,
      remainingCapital: Number(lot.total_cost || 0),
      profit: 0,
      recoveryPct: 0,
    };
  });

  sales.forEach(sale => {
    const item = itemById[sale.item_id];
    const row = item && stats[item.lot_id];
    if (!row) return;
    row.sold += 1;
    row.revenue += Number(sale.sale_price || 0);
    row.costSold += Number(sale.cost_price || 0);
  });

  Object.values(stats).forEach(row => {
    row.remaining = Math.max(0, row.totalItems - row.sold);
    row.remainingCapital = Math.max(0, Number(row.lot.total_cost || 0) - row.costSold);
    row.profit = row.revenue - row.costSold;
    row.recoveryPct = percent(row.revenue, Number(row.lot.total_cost || 0));
  });

  return stats;
}

function renderLotPerformanceRow(x) {
  const roi = percent(x.profit, Number(x.lot.total_cost || 0));
  return `<tr>
    <td><b>${escapeHtml(x.lot.lot_name)}</b><small class="table-sub">ซื้อ ${formatDate(x.lot.purchase_date)}</small></td>
    <td style="text-align:right">${formatBaht(x.lot.total_cost)}</td>
    <td style="text-align:right">${x.totalItems}</td>
    <td style="text-align:right">${x.sold}</td>
    <td style="text-align:right">${x.remaining}</td>
    <td style="text-align:right">${formatBaht(x.revenue)}</td>
    <td style="text-align:right">${formatBaht(x.costSold)}</td>
    <td style="text-align:right">${formatBaht(x.remainingCapital)}</td>
    <td style="text-align:right" class="${x.profit >= 0 ? 'profit' : 'loss'}">${formatBaht(x.profit)}</td>
    <td style="text-align:right">${x.recoveryPct.toFixed(1)}%</td>
  </tr>`;
}

function renderDashboard(data, range) {
  const { lots, groups, items, sales, expenses } = data;
  const periodSales = sales.filter(s => inRange(s.sale_date, range));
  const periodExpenses = expenses.filter(e => inRange(`${e.expense_date}T23:59:59`, range));
  const revenue = sum(periodSales, s => s.sale_price);
  const cogs = sum(periodSales, s => s.cost_price);
  const grossProfit = revenue - cogs;
  const expensesTotal = sum(periodExpenses, e => e.amount);
  const netProfit = grossProfit - expensesTotal;
  const margin = percent(grossProfit, revenue);
  $("statRevenue").textContent = formatBaht(revenue);
  $("statRevenueMeta").textContent = `${periodSales.length} รายการขาย`;
  $("statGrossProfit").textContent = formatBaht(grossProfit);
  $("statMargin").textContent = `Margin ${margin.toFixed(1)}%`;
  $("statExpenses").textContent = formatBaht(expensesTotal);
  $("statNetProfit").textContent = formatBaht(netProfit);
  $("statNetProfit").className = `value ${netProfit >= 0 ? "positive" : "negative"}`;

  const available = items.filter(i => i.status === "available");
  const sold = items.filter(i => i.status === "sold");
  const damaged = items.filter(i => i.status === "damaged");
  const totalCapital = sum(lots, l => l.total_cost);
  const stockCost = sum(available, i => i.cost_price);
  const stockRetail = sum(available, i => i.current_price);
  $("capitalStock").innerHTML = `<div><b>${formatBaht(totalCapital)}</b><span>เงินทุนตาม Lot ทั้งหมด</span></div><div><b>${formatBaht(stockCost)}</b><span>ต้นทุนสต็อกคงเหลือ</span></div><div><b>${formatBaht(stockRetail)}</b><span>ราคาขายคงเหลือ</span></div><div><b>${available.length}</b><span>ชิ้นพร้อมขาย · ${sold.length} ขายแล้ว · ${damaged.length} เสีย</span></div>`;

  const payment = { cash:0, transfer:0, government:0 };
  periodSales.forEach(s => payment[s.payment_method] = (payment[s.payment_method] || 0) + Number(s.sale_price || 0));
  $("paymentCards").innerHTML = ["cash","transfer","government"].map(k => `<div><span>${PAYMENT_LABELS[k] || k}</span><b>${formatBaht(payment[k])}</b></div>`).join("");

  const channels = {};
  periodSales.forEach(s => { const k = s.channel || "other"; channels[k] ||= { count:0, revenue:0, profit:0 }; channels[k].count++; channels[k].revenue += Number(s.sale_price||0); channels[k].profit += Number(s.sale_price||0)-Number(s.cost_price||0); });
  const maxChannel = Math.max(1, ...Object.values(channels).map(x => x.revenue));
  const channelEntries = Object.entries(channels).sort((a,b)=>b[1].revenue-a[1].revenue);
  $("channelGrid").innerHTML = channelEntries.length ? channelEntries.map(([k,v]) => `<div class="channel-card"><div class="channel-top"><b>${escapeHtml(CHANNEL_LABELS[k] || k)}</b><strong>${formatBaht(v.revenue)}</strong></div><small>${v.count} ชิ้น · กำไร ${formatBaht(v.profit)}</small><div class="bar-track"><div class="bar-fill" style="width:${Math.round(v.revenue/maxChannel*100)}%"></div></div><small>คิดเป็น ${percent(v.revenue,revenue).toFixed(1)}% ของยอดขายช่วงนี้</small></div>`).join("") : `<div class="empty-state">ยังไม่มีการขายในช่วงที่เลือก</div>`;

  const tierStats = { normal:{count:0,revenue:0,profit:0}, head:{count:0,revenue:0,profit:0} };
  const itemById = Object.fromEntries(items.map(i => [i.id,i]));
  periodSales.forEach(s => { const tier = itemById[s.item_id]?.tier === "head" ? "head" : "normal"; tierStats[tier].count++; tierStats[tier].revenue += Number(s.sale_price||0); tierStats[tier].profit += Number(s.sale_price||0)-Number(s.cost_price||0); });
  $("tierBreakdown").innerHTML = Object.entries(tierStats).map(([k,v]) => `<tr><td>${TIER_LABELS[k]}</td><td style="text-align:right">${v.count}</td><td style="text-align:right">${formatBaht(v.revenue)}</td><td style="text-align:right" class="${v.profit>=0?'profit':'loss'}">${formatBaht(v.profit)}</td><td style="text-align:right">${percent(v.profit,v.revenue).toFixed(1)}%</td></tr>`).join("");

  const now = new Date(); const agingBuckets = [{label:"0–7 วัน",min:0,max:7,count:0},{label:"8–30 วัน",min:8,max:30,count:0},{label:"31–60 วัน",min:31,max:60,count:0},{label:"61–90 วัน",min:61,max:90,count:0},{label:"90+ วัน",min:91,max:99999,count:0}];
  available.forEach(i => { const days = Math.max(0, Math.floor((now-new Date(i.created_at))/86400000)); const b = agingBuckets.find(x => days>=x.min && days<=x.max); if (b) b.count++; });
  const maxAge = Math.max(1,...agingBuckets.map(x=>x.count));
  $("agingList").innerHTML = agingBuckets.map(b => `<div class="aging-row"><span>${b.label}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(b.count/maxAge*100)}%"></div></div><b>${b.count}</b></div>`).join("");

  // Lot Performance: ใช้ยอดขายสะสมตลอดอายุ Lot เพื่อให้เห็นภาพเงินจริงของแต่ละกระสอบ
  // ไม่ผูกกับ periodSales เพราะนายต้องการรู้ว่า Lot นี้คืนทุนไปถึงไหนแล้ว แม้จะเปลี่ยนตัวกรองช่วงเวลา
  const lotStats = buildLotPerformance(lots, items, sales);
  const rows = Object.values(lotStats).filter(x => x.sold > 0 || x.totalItems > 0).sort((a,b) => b.revenue - a.revenue);
  $("lotBreakdown").innerHTML = rows.length ? rows.map(renderLotPerformanceRow).join("") : `<tr><td colspan="10">ยังไม่มีข้อมูล Lot</td></tr>`;

  $("stockCount").innerHTML = `<div><b>${items.length}</b><span>สินค้าทั้งหมด</span></div><div><b>${available.length}</b><span>พร้อมขาย</span></div><div><b>${sold.length}</b><span>ขายแล้ว</span></div><div><b>${damaged.length}</b><span>เสีย</span></div><div><b>${formatBaht(stockCost)}</b><span>ต้นทุนคงเหลือ</span></div><div><b>${formatBaht(stockRetail)}</b><span>ราคาขายคงเหลือ</span></div>`;

  const markdown = available.map(i => { const days=Math.max(0,Math.floor((now-new Date(i.created_at))/86400000)); return {...i,days}; }).filter(i=>i.days>=60).sort((a,b)=>b.days-a.days).slice(0,8);
  $("markdownList").innerHTML = markdown.length ? markdown.map(i => `<div class="markdown-item"><div><b>${escapeHtml(i.item_name)}</b><small>${i.days} วัน · ${escapeHtml(i.size||"-")} · ${i.condition} · ${i.tier==='head'?'งานหัว':'ปกติ'}</small></div><div style="text-align:right"><b>${formatBaht(i.current_price)}</b><small>ต้นทุน ${formatBaht(i.cost_price)}</small></div></div>`).join("") : `<div class="empty-state">ยังไม่มีสินค้าที่ค้าง 60+ วัน</div>`;

  const today = rangeFromPreset("today"); const todaySales = sales.filter(s=>inRange(s.sale_date,today)); const tp={cash:0,transfer:0,government:0}; todaySales.forEach(s=>tp[s.payment_method]=(tp[s.payment_method]||0)+Number(s.sale_price||0));
  $("todayPayments").innerHTML = ["cash","transfer","government"].map(k=>`<div><span>${PAYMENT_LABELS[k]||k}</span><b>${formatBaht(tp[k])}</b></div>`).join("");

  // Weekend summary: แยกเฉพาะยอดจากถนนคนเดิน และแบ่งตามวันเสาร์/อาทิตย์
  const weekend = { 6:{label:"เสาร์",count:0,revenue:0,profit:0}, 0:{label:"อาทิตย์",count:0,revenue:0,profit:0} };
  periodSales.filter(s => (s.channel || "") === "street_market").forEach(s => {
    const day = new Date(s.sale_date).getDay();
    if (!weekend[day]) return;
    weekend[day].count += 1; weekend[day].revenue += Number(s.sale_price || 0); weekend[day].profit += Number(s.sale_price || 0) - Number(s.cost_price || 0);
  });
  $("weekendSummary").innerHTML = [6,0].map(day => { const v=weekend[day]; return `<div class="weekend-card"><span>${v.label}</span><b>${formatBaht(v.revenue)}</b><small>${v.count} ชิ้น · กำไร ${formatBaht(v.profit)}</small></div>`; }).join("");

  // Top profit items: ใช้ราคาขายจริงลบต้นทุนจริง ไม่ใช้ราคาตั้งต้น
  const itemSales = {};
  periodSales.forEach(s => { const item = itemById[s.item_id]; if (!item) return; const profit = Number(s.sale_price||0)-Number(s.cost_price||0); itemSales[s.item_id] ||= {item,count:0,revenue:0,profit:0}; itemSales[s.item_id].count++; itemSales[s.item_id].revenue += Number(s.sale_price||0); itemSales[s.item_id].profit += profit; });
  const topProfit = Object.values(itemSales).sort((a,b)=>b.profit-a.profit).slice(0,10);
  $("topProfitItems").innerHTML = topProfit.length ? topProfit.map((x,i)=>`<div class="rank-item"><span class="rank-no">${i+1}</span><div><b>${escapeHtml(x.item.item_name)}</b><small>${escapeHtml(x.item.size||"-")} · ${x.item.condition} · ${x.item.tier==='head'?"งานหัว":"ปกติ"}</small></div><div class="rank-value">${formatBaht(x.profit)}<small>${x.count} ชิ้น</small></div></div>`).join("") : `<div class="empty-state">ยังไม่มีข้อมูลการขาย</div>`;

  // Lot recovery ใช้ยอดสะสมตลอดอายุ Lot เช่นเดียวกับตารางด้านบน
  // จึงตอบได้ทันทีว่า “กระสอบนี้คืนทุนแล้วกี่ %” โดยไม่ขึ้นกับช่วงเวลาของ Dashboard
  const recoveryRows = Object.values(lotStats).filter(x => x.revenue > 0).sort((a,b) => b.revenue - a.revenue).slice(0,12);
  $("lotRecovery").innerHTML = recoveryRows.length ? recoveryRows.map(x=>{ const pct=percent(x.revenue,x.lot.total_cost); return `<div class="lot-recovery-row"><div class="lot-meta"><b>${escapeHtml(x.lot.lot_name)}</b><small>ทุน ${formatBaht(x.lot.total_cost)} · ยอดขาย ${formatBaht(x.revenue)} · กำไร ${formatBaht(x.profit)} · ทุนคงเหลือ ${formatBaht(x.remainingCapital)}</small></div><div class="recovery-track"><div class="recovery-fill" style="width:${Math.min(100,pct).toFixed(1)}%"></div></div><div class="recovery-value">${pct.toFixed(0)}%<small>คืนทุน</small></div></div>`; }).join("") : `<div class="empty-state">ยังไม่มี Lot ที่มีการขาย</div>`;
}


async function loadDashboard(range) {
  try {
    dashboardRows ||= await fetchDashboardData();
    renderDashboard(dashboardRows, range);
  } catch (err) { console.error(err); showToast("โหลด Dashboard ไม่สำเร็จ: " + (err.message || err)); }
}

function setPeriod(preset) {
  activeRange = preset; document.querySelectorAll(".period-btn").forEach(b=>b.classList.toggle("active",b.dataset.period===preset)); loadDashboard(rangeFromPreset(preset));
}
document.querySelectorAll(".period-btn").forEach(btn=>btn.addEventListener("click",()=>setPeriod(btn.dataset.period)));
$("applyCustom").addEventListener("click",()=>{ const range=rangeFromCustom(); if(!range)return showToast("กรุณาเลือกช่วงวันที่ให้ถูกต้อง"); document.querySelectorAll(".period-btn").forEach(b=>b.classList.remove("active")); loadDashboard(range); });
function showToast(m){const t=$("toast");if(!t)return;t.textContent=m;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),2600)}

// Realtime: Dashboard ต้องดึงข้อมูลใหม่เมื่อ Lot / Item / Sale / Expense เปลี่ยนจาก Device อื่น
window.addEventListener('vims:realtime', (event) => {
  const table = event.detail?.table;
  if (table === 'page_refresh' || ['lots', 'lot_groups', 'items', 'sales', 'expenses'].includes(table)) {
    dashboardRows = null;
    loadDashboard(rangeFromPreset(activeRange));
  }
});

setPeriod("today");
