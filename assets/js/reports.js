/* ==========================================================
   reports.js — รายงานยอดขาย/กำไร/เงินรับ
   Data flow:
   reports.html -> reports.js -> Supabase (sales, expenses, items, lots)
   หน้านี้เป็น read-only report: ไม่แก้ข้อมูลธุรกรรมโดยตรง
   ========================================================== */
const CHANNEL_LABELS = { street_market: "ถนนคนเดิน", facebook: "Facebook", instagram: "Instagram" };
function escapeHtml(v="") { return String(v).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;"}[c])); }
const TIER_LABELS = { normal: "ปกติ", head: "งานหัว / Premium" };
const today = new Date();
let currentPeriod = "day";

function formatBaht(value) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function formatDate(value) { return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function showToast(msg) { const t=document.getElementById("toast"); if(!t)return; t.textContent=msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"),2500); }
function percent(a,b) { return b ? (a/b)*100 : 0; }

/* ---------- ตั้งค่า date/month/year selector ---------- */
const pickDate = document.getElementById("pickDate");
pickDate.value = today.toISOString().slice(0,10);
const pickMonth = document.getElementById("pickMonth");
pickMonth.value = today.toISOString().slice(0,7);
const yearSelect = document.getElementById("pickYear");
for (let y=today.getFullYear(); y>=today.getFullYear()-5; y--) { const opt=document.createElement("option"); opt.value=y; opt.textContent=`พ.ศ. ${y+543}`; yearSelect.appendChild(opt); }
yearSelect.value = today.getFullYear();

document.querySelectorAll(".period-tab").forEach(tab=>tab.addEventListener("click",()=>{
  document.querySelectorAll(".period-tab").forEach(t=>t.classList.remove("active"));
  tab.classList.add("active"); currentPeriod=tab.dataset.period;
  document.getElementById("pickerDay").style.display=currentPeriod==="day"?"block":"none";
  document.getElementById("pickerMonth").style.display=currentPeriod==="month"?"block":"none";
  document.getElementById("pickerYear").style.display=currentPeriod==="year"?"block":"none";
  loadReport();
}));
pickDate.addEventListener("change",loadReport); pickMonth.addEventListener("change",loadReport); yearSelect.addEventListener("change",loadReport);

/* ---------- คำนวณช่วงเวลา ---------- */
function getMainRange() {
  if (currentPeriod === "day") { const d=pickDate.valueAsDate||today; const start=new Date(d.getFullYear(),d.getMonth(),d.getDate()); const end=new Date(start); end.setDate(end.getDate()+1); return {start,end}; }
  if (currentPeriod === "month") { const [y,m]=pickMonth.value.split("-").map(Number); return {start:new Date(y,m-1,1),end:new Date(y,m,1)}; }
  const y=Number(yearSelect.value); return {start:new Date(y,0,1),end:new Date(y+1,0,1)};
}

async function loadReport() {
  const {start,end}=getMainRange();
  try {
    /* Query ครั้งเดียวแล้วคำนวณหลายมุมใน browser เพื่อให้หน้า report ตอบสนองเร็ว */
    // fetchAllRows กัน items/sales ตกหล่นแบบเงียบๆ เมื่อเกิน 1000 แถว (default row limit ของ Supabase)
    // ดึง Sales ทั้งหมด 1 ครั้ง เพราะ Performance ตาม Lot ต้องใช้ยอดสะสมตลอดอายุ Lot
    // ส่วนการ์ดสรุป/รายการขายด้านบนยังกรองตามช่วงเวลาที่ผู้ใช้เลือก
    const [salesR, expensesR, itemsR, lotsR] = await Promise.all([
      fetchAllRows(() => supabaseClient.from("sales").select("id,item_id,sale_date,channel,sale_price,cost_price,payment_method,note,items(item_name,size,condition,tier)").order("sale_date",{ascending:false})),
      fetchAllRows(() => supabaseClient.from("expenses").select("id,expense_date,amount,category,note").gte("expense_date",start.toISOString().slice(0,10)).lte("expense_date",new Date(end.getTime()-86400000).toISOString().slice(0,10))),
      fetchAllRows(() => supabaseClient.from("items").select("id,item_name,size,condition,tier,lot_id")),
      fetchAllRows(() => supabaseClient.from("lots").select("id,lot_name,total_cost,total_items,purchase_date"))
    ]);
    const err=salesR.error||expensesR.error||itemsR.error||lotsR.error; if(err) throw err;
    const allSales=salesR.data||[], sales=allSales.filter(s=>{const d=new Date(s.sale_date);return d>=start&&d<end;}), expenses=expensesR.data||[], items=itemsR.data||[], lots=lotsR.data||[];
    renderStats(sales,expenses); renderPaymentBreakdown(sales); renderChannelBreakdown(sales); renderTierBreakdown(sales,items); renderLotBreakdown(allSales,items,lots); renderWeekendBreakdown(sales); renderTopProfitItems(sales); renderSaleList(sales); await renderTrend(start,end);
  } catch(err) { console.error(err); showToast("โหลดรายงานไม่สำเร็จ: "+(err.message||err)); }
}

function renderStats(sales,expenses) {
  const revenue=sales.reduce((a,s)=>a+Number(s.sale_price||0),0); const cost=sales.reduce((a,s)=>a+Number(s.cost_price||0),0); const profit=revenue-cost; const expenseTotal=expenses.reduce((a,e)=>a+Number(e.amount||0),0); const net=profit-expenseTotal;
  document.getElementById("repRevenue").textContent=formatBaht(revenue); document.getElementById("repCost").textContent=formatBaht(cost); document.getElementById("repCount").textContent=`${sales.length} ชิ้น`; document.getElementById("repProfit").textContent=formatBaht(profit); document.getElementById("repExpenses").textContent=formatBaht(expenseTotal); document.getElementById("repNetProfit").textContent=formatBaht(net);
  ["repProfit","repNetProfit"].forEach(id=>{const el=document.getElementById(id);el.classList.remove("profit","loss");el.classList.add(Number(id==="repProfit"?profit:net)>=0?"profit":"loss");});
}
function renderPaymentBreakdown(sales) {
  const by={}; sales.forEach(s=>{by[s.payment_method] ||= {count:0,total:0};by[s.payment_method].count++;by[s.payment_method].total+=Number(s.sale_price||0);});
  const rows=Object.keys(by).length?Object.entries(by).map(([k,v])=>`<tr><td>${PAYMENT_LABELS[k]||k}</td><td style="text-align:right">${v.count}</td><td style="text-align:right">${formatBaht(v.total)}</td></tr>`).join(""):"<tr><td colspan=3 class=empty-state>ไม่มีรายการขาย</td></tr>";
  document.getElementById("repPaymentBreakdown").innerHTML=rows;
}
function renderChannelBreakdown(sales) {
  const by={}; sales.forEach(s=>{const k=s.channel||"other";by[k] ||= {count:0,revenue:0,profit:0};by[k].count++;by[k].revenue+=Number(s.sale_price||0);by[k].profit+=Number(s.sale_price||0)-Number(s.cost_price||0);});
  document.getElementById("repChannelBreakdown").innerHTML=Object.keys(by).length?Object.entries(by).sort((a,b)=>b[1].revenue-a[1].revenue).map(([k,v])=>`<tr><td>${CHANNEL_LABELS[k]||k}</td><td style="text-align:right">${v.count}</td><td style="text-align:right">${formatBaht(v.revenue)}</td><td style="text-align:right" class="${v.profit>=0?'profit':'loss'}">${formatBaht(v.profit)}</td></tr>`).join(""):"<tr><td colspan=4 class=empty-state>ไม่มีรายการขาย</td></tr>";
}
function renderTierBreakdown(sales,items) {
  const by={normal:{count:0,revenue:0,profit:0},head:{count:0,revenue:0,profit:0}}; const map=Object.fromEntries(items.map(i=>[i.id,i]));
  sales.forEach(s=>{const k=map[s.item_id]?.tier==="head"?"head":"normal";by[k].count++;by[k].revenue+=Number(s.sale_price||0);by[k].profit+=Number(s.sale_price||0)-Number(s.cost_price||0);});
  document.getElementById("repTierBreakdown").innerHTML=Object.entries(by).map(([k,v])=>`<tr><td>${TIER_LABELS[k]}</td><td style="text-align:right">${v.count}</td><td style="text-align:right">${formatBaht(v.revenue)}</td><td style="text-align:right" class="${v.profit>=0?'profit':'loss'}">${formatBaht(v.profit)}</td></tr>`).join("");
}
// Performance ตาม Lot เป็นยอดสะสมตลอดอายุ Lot เพื่อไม่ให้การเปลี่ยนช่วงรายงานทำให้ตัวเลขทุนของกระสอบดูสับสน
function renderLotBreakdown(sales,items,lots) {
  // ตารางนี้เป็นยอดสะสมตลอดอายุ Lot เพื่อใช้ติดตามทุน/กำไรของกระสอบโดยตรง
  const map=Object.fromEntries(items.map(i=>[i.id,i]));
  const by=Object.fromEntries(lots.map(l=>[l.id,{lot:l,totalItems:Number(l.total_items||0),sold:0,revenue:0,costSold:0,remaining:0,remainingCapital:Number(l.total_cost||0),profit:0,recoveryPct:0}]));
  sales.forEach(s=>{const i=map[s.item_id],r=i&&by[i.lot_id];if(!r)return;r.sold++;r.revenue+=Number(s.sale_price||0);r.costSold+=Number(s.cost_price||0);});
  Object.values(by).forEach(r=>{r.remaining=Math.max(0,r.totalItems-r.sold);r.remainingCapital=Math.max(0,Number(r.lot.total_cost||0)-r.costSold);r.profit=r.revenue-r.costSold;r.recoveryPct=percent(r.revenue,Number(r.lot.total_cost||0));});
  const rows=Object.values(by).filter(x=>x.totalItems>0||x.sold>0).sort((a,b)=>b.revenue-a.revenue);
  document.getElementById("repLotBreakdown").innerHTML=rows.length?rows.map(x=>`<tr>
    <td><b>${escapeHtml(x.lot.lot_name)}</b><small class="table-sub">ซื้อ ${formatDate(x.lot.purchase_date)}</small></td>
    <td style="text-align:right">${formatBaht(x.lot.total_cost)}</td>
    <td style="text-align:right">${x.totalItems}</td>
    <td style="text-align:right">${x.sold}</td>
    <td style="text-align:right">${x.remaining}</td>
    <td style="text-align:right">${formatBaht(x.revenue)}</td>
    <td style="text-align:right">${formatBaht(x.costSold)}</td>
    <td style="text-align:right">${formatBaht(x.remainingCapital)}</td>
    <td style="text-align:right" class="${x.profit>=0?'profit':'loss'}">${formatBaht(x.profit)}</td>
    <td style="text-align:right">${x.recoveryPct.toFixed(1)}%</td>
  </tr>`).join(""):"<tr><td colspan=10 class=empty-state>ยังไม่มีข้อมูล Lot</td></tr>";
}
function renderWeekendBreakdown(sales) {
  const by={6:{label:"เสาร์",count:0,revenue:0,profit:0},0:{label:"อาทิตย์",count:0,revenue:0,profit:0}};
  sales.filter(s=>s.channel==="street_market").forEach(s=>{const k=new Date(s.sale_date).getDay();if(!by[k])return;by[k].count++;by[k].revenue+=Number(s.sale_price||0);by[k].profit+=Number(s.sale_price||0)-Number(s.cost_price||0);});
  document.getElementById("repWeekendBreakdown").innerHTML=[6,0].map(k=>{const v=by[k];return `<div class="weekend-report-card"><span>${v.label}</span><b>${formatBaht(v.revenue)}</b><small>${v.count} ชิ้น · กำไร ${formatBaht(v.profit)}</small></div>`;}).join("");
}
// ตัวทำกำไรสูงสุด: ใช้ราคาขายจริงลบต้นทุนจริง ไม่ใช้ราคาตั้งต้น รวมสินค้าชิ้นเดียวกันที่ขายหลายครั้งเข้าด้วยกัน
function renderTopProfitItems(sales) {
  const by = {};
  sales.forEach(s => {
    const it = s.items;
    if (!it) return;
    const key = s.item_id;
    const profit = Number(s.sale_price||0) - Number(s.cost_price||0);
    by[key] ||= { item: it, count: 0, revenue: 0, profit: 0 };
    by[key].count++; by[key].revenue += Number(s.sale_price||0); by[key].profit += profit;
  });
  const top = Object.values(by).sort((a,b) => b.profit - a.profit).slice(0, 10);
  document.getElementById("repTopProfitItems").innerHTML = top.length ? top.map((x,i) => `<div class="rank-item"><span class="rank-no">${i+1}</span><div><b>${escapeHtml(x.item.item_name)}</b><small>${escapeHtml(x.item.size||"-")} · ${x.item.condition||"-"} · ${x.item.tier==='head'?"งานหัว":"ปกติ"}</small></div><div class="rank-value">${formatBaht(x.profit)}<small>${x.count} ชิ้น</small></div></div>`).join("") : `<div class="empty-state">ยังไม่มีข้อมูลการขายในช่วงนี้</div>`;
}
function renderSaleList(sales) {
  document.getElementById("repSaleList").innerHTML=sales.length?sales.map(s=>`<div class="sale-row"><div><div class="sale-name">${escapeHtml(s.items?.item_name||"สินค้า")}</div><div class="sale-meta">${formatDate(s.sale_date)} · ${PAYMENT_LABELS[s.payment_method]||s.payment_method} · ${CHANNEL_LABELS[s.channel]||s.channel||"-"}</div></div><div class="sale-price">${formatBaht(s.sale_price)}</div></div>`).join(""):"<div class=empty-state>ไม่มีรายการขายในช่วงนี้</div>";
}
let reportTrendChart = null;
function renderReportTrendChart(rows){
  if(typeof Chart==='undefined') return;
  const canvas=document.getElementById('reportTrendChart'); if(!canvas) return;
  try{reportTrendChart?.destroy();}catch(_){ }
  const ordered=[...rows].reverse();
  reportTrendChart=new Chart(canvas,{type:'line',data:{labels:ordered.map(r=>r.label),datasets:[
    {label:'ยอดขาย',data:ordered.map(r=>r.revenue),borderColor:'#4a5cf0',backgroundColor:'rgba(74,92,240,.10)',fill:true,tension:.38,pointRadius:3},
    {label:'กำไร',data:ordered.map(r=>r.profit),borderColor:'#0ea5e9',backgroundColor:'transparent',tension:.38,pointRadius:3}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{color:'#5c6480',font:{family:'Prompt',size:11},usePointStyle:true,padding:16}},tooltip:{backgroundColor:'#1a1d29',borderColor:'#2c3146',borderWidth:1,callbacks:{label:c=>`${c.dataset.label}: ${formatBaht(c.raw)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#98a0b6',font:{family:'Inter',size:10}}},y:{grid:{color:'#eceef7'},ticks:{color:'#98a0b6',font:{family:'Inter',size:10},callback:v=>formatBaht(v).replace('฿','')}}}}});
}

async function renderTrend(start,end) {
  const title=document.getElementById("repTrendTitle"),col=document.getElementById("repTrendCol1"); let trendStart=new Date(start),trendEnd=new Date(end),labelFn;
  if(currentPeriod==="day"){title.textContent="แนวโน้ม 7 วันล่าสุด";col.textContent="วันที่";trendStart.setDate(trendStart.getDate()-6);labelFn=d=>formatDate(d).split(" ").slice(0,2).join(" ");}
  else if(currentPeriod==="month"){title.textContent="แนวโน้มรายวันในเดือนนี้";col.textContent="วันที่";labelFn=d=>formatDate(d).split(" ").slice(0,2).join(" ");}
  else {title.textContent="แนวโน้มรายเดือนในปีนี้";col.textContent="เดือน";labelFn=d=>new Intl.DateTimeFormat("th-TH",{month:"short"}).format(d);}
  const {data,error}=await supabaseClient.from("sales").select("sale_date,sale_price,cost_price").gte("sale_date",trendStart.toISOString()).lt("sale_date",trendEnd.toISOString()); if(error){console.error(error);return;}
  const buckets={}; data.forEach(s=>{const d=new Date(s.sale_date);const key=currentPeriod==="year"?`${d.getFullYear()}-${d.getMonth()}`:d.toDateString();buckets[key] ||= {count:0,revenue:0,profit:0,label:labelFn(d)};buckets[key].count++;buckets[key].revenue+=Number(s.sale_price||0);buckets[key].profit+=Number(s.sale_price||0)-Number(s.cost_price||0);});
  const rows=Object.values(buckets);
  renderReportTrendChart(rows);
  document.getElementById("repTrendBody").innerHTML=rows.length?rows.sort((a,b)=>a.label<b.label?1:-1).map(r=>`<tr><td>${r.label}</td><td style="text-align:right">${r.count}</td><td style="text-align:right">${formatBaht(r.revenue)}</td><td style="text-align:right" class="${r.profit>=0?'profit':'loss'}">${formatBaht(r.profit)}</td></tr>`).join(""):"<tr><td colspan=4 class=empty-state>ยังไม่มีรายการขาย</td></tr>";
}

loadReport();

// Realtime: รายงานจะโหลดข้อมูลใหม่เมื่อยอดขาย/ค่าใช้จ่าย/สินค้าเปลี่ยนจาก Device อื่น
window.addEventListener('vims:realtime', (event) => {
  if (event.detail?.table === 'page_refresh' || ['sales', 'expenses', 'items', 'lots'].includes(event.detail?.table)) loadReport();
});
