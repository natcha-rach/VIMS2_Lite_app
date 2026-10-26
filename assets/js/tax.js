/* ==========================================================
   tax.js — สรุปภาษี (tax.html) V19
   เงินได้ 40(8) = ยอดขายในแอป (ไม่นับบิลที่ยกเลิก/คืน) + รายได้นอกแอป
   เทียบ: หักเหมา 60%  vs  หักตามจริง (ต้นทุนเสื้อที่ขาย + ค่าใช้จ่าย + ต้นทุนนอกแอป)
   ตัวเลขนอกแอปเก็บใน app_settings.tax_inputs = { "2026": { half:{outside,outsideCost}, full:{...} } }
   ใช้เตรียมตัวเลขเท่านั้น — อัตรา/กติกาให้ตรวจกับกรมสรรพากรทุกปี
   ========================================================== */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = Money.toSatang;
  const thb = (satang) => "฿" + Math.round(Money.toBaht(satang)).toLocaleString("th-TH");
  const FLAT_RATE = 0.6;          // หักเหมา 60% สำหรับเงินได้จากการขายของ (ตรวจทุกปี)
  const VAT_THRESHOLD = 1800000;  // รายรับเกินปีละ 1.8 ล้านบาท ต้องจด VAT
  const MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

  let period = "full";
  let year = new Date().getFullYear();
  let inputs = {};         // จาก app_settings.tax_inputs
  let sales = [];          // ของปีที่เลือก
  let expenses = [];
  let last = null;         // ผลคำนวณล่าสุด (ใช้ส่งออก CSV)

  // ปี: ปีนี้ + ย้อนหลัง 3 ปี (แสดง พ.ศ.)
  const yearSel = $("taxYear");
  for (let y = year; y >= year - 3; y--) yearSel.insertAdjacentHTML("beforeend", `<option value="${y}">ปีภาษี ${y + 543}</option>`);
  yearSel.addEventListener("change", () => { year = Number(yearSel.value); load(); });

  $("taxPeriodSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-period]");
    if (!b) return;
    period = b.dataset.period;
    document.querySelectorAll("#taxPeriodSeg [data-period]").forEach((x) => {
      x.classList.toggle("active", x === b);
      x.setAttribute("aria-selected", String(x === b));
    });
    fillInputs();
    compute();
  });

  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  async function load() {
    const from = `${year}-01-01T00:00:00+07:00`, to = `${year + 1}-01-01T00:00:00+07:00`;
    const [s, e, st] = await Promise.all([
      fetchAllRows(() => supabaseClient.from("sales").select("sale_price,cost_price,sale_date").is("voided_at", null).gte("sale_date", from).lt("sale_date", to)),
      fetchAllRows(() => supabaseClient.from("expenses").select("amount,expense_date,category").gte("expense_date", ymd(year, 1, 1)).lte("expense_date", ymd(year, 12, 31))),
      supabaseClient.from("app_settings").select("value").eq("key", "tax_inputs").maybeSingle(),
    ]);
    if (s.error || e.error) { toast("โหลดข้อมูลไม่สำเร็จ"); return; }
    sales = s.data || [];
    expenses = e.data || [];
    inputs = st.data?.value || {};
    fillInputs();
    compute();
    loadVat();
  }

  function cur() { return inputs[year]?.[period] || { outside: 0, outsideCost: 0 }; }
  function fillInputs() {
    $("taxOutside").value = cur().outside || 0;
    $("taxOutsideCost").value = cur().outsideCost || 0;
  }

  // เดือนของรายการขายตามเวลาไทย
  const monthOfSale = (iso) => Number(new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(5, 7));
  const monthOfDate = (d) => Number(String(d).slice(5, 7));

  function compute() {
    const lastMonth = period === "half" ? 6 : 12;
    const rows = MONTHS.slice(0, lastMonth).map((name, i) => ({ name, sales: 0, cogs: 0, exp: 0, m: i + 1 }));
    sales.forEach((x) => { const r = rows[monthOfSale(x.sale_date) - 1]; if (r) { r.sales += S(x.sale_price); r.cogs += S(x.cost_price); } });
    expenses.forEach((x) => { const r = rows[monthOfDate(x.expense_date) - 1]; if (r) r.exp += S(x.amount); });

    const app = rows.reduce((a, r) => a + r.sales, 0);
    const cogs = rows.reduce((a, r) => a + r.cogs, 0);
    const exp = rows.reduce((a, r) => a + r.exp, 0);
    const outside = S($("taxOutside").value);
    const outsideCost = S($("taxOutsideCost").value);
    const income = app + outside;
    const flat = Math.round(income * FLAT_RATE);
    const real = cogs + exp + outsideCost;
    const useFlat = flat >= real;
    const net = Math.max(0, income - Math.max(flat, real));

    $("taxPeriodLabel").textContent = period === "half"
      ? `ครึ่งปีแรก ${year + 543} (1 ม.ค. – 30 มิ.ย.)`
      : `ปีภาษี ${year + 543} (1 ม.ค. – 31 ธ.ค.)`;
    $("taxAppSales").textContent = thb(app);
    $("taxIncome").textContent = thb(income);
    $("taxFlat").textContent = thb(flat);
    $("taxReal").textContent = thb(real);
    $("taxRealDetail").textContent = `ต้นทุนเสื้อ ${thb(cogs)} + ค่าใช้จ่าย ${thb(exp)}${outsideCost ? ` + นอกแอป ${thb(outsideCost)}` : ""}`;
    $("taxFlatBox").classList.toggle("best", useFlat);
    $("taxRealBox").classList.toggle("best", !useFlat);
    $("taxAdvice").textContent = income === 0 ? "ยังไม่มีรายได้ในช่วงนี้"
      : useFlat ? `หักเหมาได้มากกว่า ${thb(flat - real)} — แนะนำหักเหมา 60%`
      : `หักตามจริงได้มากกว่า ${thb(real - flat)} — ต้องเก็บหลักฐานค่าใช้จ่ายให้ครบ`;
    $("taxNet").textContent = thb(net);

    $("taxMonthly").innerHTML = rows.map((r) => `<tr><td>${r.name}</td><td>${thb(r.sales)}</td><td>${thb(r.cogs)}</td><td>${thb(r.exp)}</td><td class="${r.sales - r.cogs - r.exp >= 0 ? "pos" : "neg"}">${thb(r.sales - r.cogs - r.exp)}</td></tr>`).join("") +
      `<tr class="sum"><td>รวม</td><td>${thb(app)}</td><td>${thb(cogs)}</td><td>${thb(exp)}</td><td>${thb(app - cogs - exp)}</td></tr>`;

    last = { rows, app, cogs, exp, outside, outsideCost, income, flat, real, net, useFlat };
  }

  // บันทึกตัวเลขนอกแอป (หน่วงไว้ครู่หนึ่งหลังพิมพ์เสร็จ)
  const saveInputs = debounce(async () => {
    inputs[year] = inputs[year] || {};
    inputs[year][period] = { outside: Number($("taxOutside").value) || 0, outsideCost: Number($("taxOutsideCost").value) || 0 };
    const { error } = await supabaseClient.from("app_settings").upsert({ key: "tax_inputs", value: inputs, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) toast("บันทึกตัวเลขนอกแอปไม่สำเร็จ: " + error.message);
  }, 800);
  ["taxOutside", "taxOutsideCost"].forEach((id) => $(id).addEventListener("input", () => { compute(); saveInputs(); }));

  // เกณฑ์ VAT: รายรับย้อนหลัง 12 เดือนจากวันนี้
  async function loadVat() {
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const { data } = await fetchAllRows(() => supabaseClient.from("sales").select("sale_price").is("voided_at", null).gte("sale_date", since));
    const total = (data || []).reduce((a, x) => a + S(x.sale_price), 0);
    const pct = Math.min(100, (Money.toBaht(total) / VAT_THRESHOLD) * 100);
    $("taxVatText").textContent = `${thb(total)} / 1.8 ล้าน`;
    $("taxVatBar").style.width = pct.toFixed(1) + "%";
    $("taxVatBar").classList.toggle("warn", pct >= 80);
    $("taxVatNote").textContent = pct >= 80 ? "ใกล้เกณฑ์จดทะเบียน VAT แล้ว — ปรึกษาสรรพากรพื้นที่" : `ยังห่างเกณฑ์จด VAT (${pct.toFixed(1)}%)`;
  }

  $("taxCsv").addEventListener("click", () => {
    if (!last) return;
    const b = (v) => Money.toBaht(v).toFixed(2);
    const lines = [["เดือน", "ยอดขาย", "ต้นทุนเสื้อ", "ค่าใช้จ่าย", "กำไร"]];
    last.rows.forEach((r) => lines.push([`${r.name} ${year + 543}`, b(r.sales), b(r.cogs), b(r.exp), b(r.sales - r.cogs - r.exp)]));
    lines.push([], ["ยอดขายในแอป", b(last.app)], ["รายได้นอกแอป", b(last.outside)], ["เงินได้ 40(8)", b(last.income)],
      ["หักเหมา 60%", b(last.flat)], ["หักตามจริง", b(last.real)], ["วิธีที่เลือก", last.useFlat ? "หักเหมา" : "หักตามจริง"], ["เงินได้หลังหักค่าใช้จ่าย", b(last.net)]);
    const csv = "﻿" + lines.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `tax-${year + 543}-${period === "half" ? "half" : "full"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $("taxPrint").addEventListener("click", () => window.print());

  function toast(msg) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(window.__taxToast);
    window.__taxToast = setTimeout(() => t.classList.remove("show"), 2800);
  }

  const reload = debounce(load, 900);
  window.addEventListener("vims:realtime", (e) => {
    const table = e.detail?.table;
    if (table === "page_refresh" || ["sales", "expenses", "bills"].includes(table)) reload();
  });

  load();
})();
