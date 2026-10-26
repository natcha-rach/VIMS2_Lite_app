/* ==========================================================
   tax.js — ชั้น UI ของหน้าสรุปภาษี (tax.html): เลือกปี/ครึ่งปี, ตัวเลขนอกแอป, ตารางรายเดือน, เกณฑ์ VAT, CSV/พิมพ์
   เรียกต่อ:
     Data   TaxRepo  ← ยอดขาย/ค่าใช้จ่ายของปี, รายรับ 12 เดือน, app_settings.tax_inputs   (data/taxRepo.js)
     Domain TaxCalc  ← รายเดือน, หักเหมา 60% vs ตามจริง, % เกณฑ์ VAT                    (domain/taxCalc.js)
   ตัวเลขนอกแอปเก็บใน app_settings.tax_inputs = { "2026": { half:{outside,outsideCost}, full:{...} } }
   ใช้เตรียมตัวเลขเท่านั้น — อัตรา/กติกาให้ตรวจกับกรมสรรพากรทุกปี
   ========================================================== */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = Money.toSatang;
  const thb = (satang) => "฿" + Math.round(Money.toBaht(satang)).toLocaleString("th-TH");

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

  async function load() {
    const [s, e, st] = await Promise.all([TaxRepo.salesOfYear(year), TaxRepo.expensesOfYear(year), TaxRepo.getInputs()]);
    if (s.error || e.error) { Notify.error(`โหลดข้อมูลปี ${year + 543} ไม่สำเร็จ`, s.error || e.error, { actions: [{ label: "ลองใหม่", onClick: load }] }); return; }
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

  // คำนวณที่ Domain (TaxCalc) แล้ววาดผล
  function compute() {
    const rows = TaxCalc.monthly(sales, expenses, period === "half");
    const sum = TaxCalc.summary(rows, $("taxOutside").value, $("taxOutsideCost").value);
    const { app, cogs, exp, outsideCost, income, flat, real, useFlat, net } = sum;

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

    last = { rows, ...sum };
  }

  // บันทึกตัวเลขนอกแอป (หน่วงไว้ครู่หนึ่งหลังพิมพ์เสร็จ)
  const saveInputs = debounce(async () => {
    inputs[year] = inputs[year] || {};
    inputs[year][period] = { outside: Number($("taxOutside").value) || 0, outsideCost: Number($("taxOutsideCost").value) || 0 };
    const { error } = await TaxRepo.saveInputs(inputs);
    if (error) Notify.error("บันทึกตัวเลขนอกแอปไม่สำเร็จ", error, { hint: "ตัวเลขบนจอยังคำนวณได้ แต่ถ้ารีเฟรชจะหาย — ลองแก้ตัวเลขอีกครั้ง" });
    else Notify.success("บันทึกตัวเลขนอกแอปแล้ว", `ปี ${year + 543} · ${period === "half" ? "ครึ่งปี" : "ทั้งปี"}`, { duration: 2200 });
  }, 800);
  ["taxOutside", "taxOutsideCost"].forEach((id) => $(id).addEventListener("input", () => { compute(); saveInputs(); }));

  // เกณฑ์ VAT: รายรับย้อนหลัง 12 เดือนจากวันนี้
  async function loadVat() {
    const since = new Date(Date.now() - 365 * 86400000).toISOString();
    const { data } = await TaxRepo.salesSince(since);
    const total = (data || []).reduce((a, x) => a + S(x.sale_price), 0);
    const pct = TaxCalc.vatPercent(total);
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
    Notify.success("ส่งออก CSV แล้ว", `ไฟล์ ${a.download} · เปิดด้วย Excel/Google Sheets ได้`);
  });
  $("taxPrint").addEventListener("click", () => window.print());


  const reload = debounce(load, 900);
  window.addEventListener("vims:realtime", (e) => {
    const table = e.detail?.table;
    if (table === "page_refresh" || ["sales", "expenses", "bills"].includes(table)) reload();
  });

  load();
})();
