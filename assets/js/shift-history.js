/* ==========================================================
   shift-history.js — ประวัติรอบร้าน (หน้าบัญชี) V20
   อ่านจาก shifts.summary ที่ close_shift() เก็บ snapshot ไว้ตอนปิดร้าน (ตัวเลขไม่เปลี่ยนย้อนหลัง)
   แสดง: สรุปตามทำเล (ขายเฉลี่ยต่อรอบ / กำไรจริงเฉลี่ย / ขาด-เกินรวม) + รายการรอบร้านล่าสุด
   ชั้น UI · เรียกต่อ: AccountingRepo.closedShifts (data/accountingRepo.js) · แสดงใน accounting.html → #shiftHistory
   ========================================================== */
(function () {
  const el = document.getElementById("shiftHistory");
  if (!el || !window.AccountingRepo) return;
  const n = (v) => Number(v || 0);
  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const dateTh = (v) => new Date(v).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit" });
  const hours = (a, b) => Math.max(0, (new Date(b) - new Date(a)) / 3600000);
  let range = "90";

  async function load() {
    const since = range === "all" ? null : new Date(Date.now() - Number(range) * 86400000).toISOString();
    const { data, error } = await AccountingRepo.closedShifts(since);
    if (error) {
      el.innerHTML = /shifts|relation|PGRST205|42P01/i.test(`${error.message} ${error.code}`)
        ? `<div class="empty-state">ยังไม่มีข้อมูล — รัน sql/migration_v19_pos_shift.sql ก่อน</div>`
        : `<div class="empty-state">โหลดประวัติรอบร้านไม่สำเร็จ</div>`;
      if (!/shifts|relation|PGRST205|42P01/i.test(`${error.message} ${error.code}`)) Notify.error("โหลดประวัติรอบร้านไม่สำเร็จ", error, { actions: [{ label: "ลองใหม่", onClick: load }] });
      return;
    }
    render(data || []);
  }

  function render(rows) {
    const head = `<div class="sh-toolbar"><select id="shRange" aria-label="ช่วงเวลา">
        <option value="30"${range === "30" ? " selected" : ""}>30 วันล่าสุด</option>
        <option value="90"${range === "90" ? " selected" : ""}>90 วันล่าสุด</option>
        <option value="all"${range === "all" ? " selected" : ""}>ทั้งหมด</option></select></div>`;
    if (!rows.length) { el.innerHTML = head + `<div class="empty-state">ยังไม่มีรอบร้านที่ปิดแล้วในช่วงนี้ — เปิด/ปิดร้านจากการ์ด "ร้านวันนี้" หน้าภาพรวม</div>`; bind(); return; }

    // สรุปตามทำเล: รู้ว่าที่ไหนคุ้มไปขาย
    const byLoc = {};
    rows.forEach((r) => {
      const s = r.summary || {};
      const x = (byLoc[r.location] ||= { count: 0, revenue: 0, profit: 0, items: 0, hours: 0, diff: 0 });
      x.count++; x.revenue += n(s.revenue); x.profit += n(s.real_profit); x.items += n(s.items);
      x.hours += hours(r.opened_at, r.closed_at); x.diff += n(r.cash_diff);
    });
    const locRows = Object.entries(byLoc).sort((a, b) => b[1].revenue / b[1].count - a[1].revenue / a[1].count).map(([loc, x]) => `<tr>
        <td><b>${esc(loc)}</b></td><td class="num">${x.count}</td>
        <td class="num">${formatBaht(x.revenue / x.count)}</td>
        <td class="num ${x.profit >= 0 ? "profit" : "loss"}">${formatBaht(x.profit / x.count)}</td>
        <td class="num">${(x.items / x.count).toFixed(1)}</td>
        <td class="num">${x.hours ? formatBaht(x.revenue / x.hours) : "-"}</td>
        <td class="num ${x.diff < 0 ? "loss" : ""}">${x.diff ? (x.diff > 0 ? "+" : "") + formatBaht(x.diff) : "ตรง"}</td></tr>`).join("");

    const list = rows.map((r) => {
      const s = r.summary || {};
      const d = n(r.cash_diff);
      return `<details class="sh-row">
        <summary>
          <span class="sh-date">${dateTh(r.opened_at)}<small>${esc(r.location)} · ${new Date(r.opened_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}–${new Date(r.closed_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</small></span>
          <span class="sh-num"><b>${formatBaht(s.revenue)}</b><small class="${n(s.real_profit) >= 0 ? "profit" : "loss"}">กำไร ${formatBaht(s.real_profit)}</small></span>
          <span class="sh-diff ${d === 0 ? "ok" : d < 0 ? "short" : "over"}">${d === 0 ? "ลิ้นชักตรง" : d < 0 ? `ขาด ${formatBaht(-d)}` : `เกิน ${formatBaht(d)}`}</span>
        </summary>
        <div class="sh-detail">
          <div><span>บิล / ชิ้น</span><b>${n(s.bills)} บิล · ${n(s.items)} ชิ้น</b></div>
          <div><span>เงินสด · โอน · รัฐ</span><b>${formatBaht(s.cash_sales)} · ${formatBaht(s.transfer_sales)} · ${formatBaht(s.government_sales)}</b></div>
          <div><span>ค่าใช้จ่าย</span><b>${formatBaht(s.expenses)}</b></div>
          ${(s.expense_lines || []).map((x) => `<div class="sub"><span>− ${esc(x.category)}${x.paid_from === "drawer" ? " (ลิ้นชัก)" : ""}</span><span>${formatBaht(x.amount)}</span></div>`).join("")}
          <div><span>เหลือวันนี้</span><b>${formatBaht(s.left_today)}</b></div>
          <div><span>ลิ้นชัก ควรมี / นับได้</span><b>${formatBaht(s.expected_cash)} / ${formatBaht(r.counted_cash)}</b></div>
          ${r.diff_reason ? `<div><span>เหตุผลขาด/เกิน</span><b>${esc(r.diff_reason)}</b></div>` : ""}
        </div>
      </details>`;
    }).join("");

    el.innerHTML = head + `
      <div class="table-scroll"><table class="sh-loc">
        <thead><tr><th>ทำเล</th><th class="num">รอบ</th><th class="num">ขาย/รอบ</th><th class="num">กำไรจริง/รอบ</th><th class="num">ชิ้น/รอบ</th><th class="num">ขาย/ชม.</th><th class="num">ขาด/เกินรวม</th></tr></thead>
        <tbody>${locRows}</tbody></table></div>
      <div class="sh-list">${list}</div>`;
    bind();
  }

  function bind() {
    document.getElementById("shRange")?.addEventListener("change", (e) => { range = e.target.value; load(); });
  }

  const reload = debounce(load, 800);
  window.addEventListener("vims:realtime", (e) => {
    const t = e.detail?.table;
    if (t === "page_refresh" || t === "shifts") reload();
  });
  load();
})();
