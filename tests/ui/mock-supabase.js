// In-memory stand-in for supabase-js v2, enough for UI smoke tests.
(function () {
  const uid = () => crypto.randomUUID();
  const now = () => new Date().toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const svg = (c) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 50'><rect width='40' height='50' fill='${c}'/><path d='M14 8l-6 5 3 4 3-2v20h12V15l3 2 3-4-6-5-3 2h-6z' fill='#fff' opacity='.85'/></svg>`);
  const KEY = "__mockdb";
  let db = JSON.parse(sessionStorage.getItem(KEY) || "null");
  if (!db) {
    const lot = { id: "lot1", lot_name: "Lot 18 กระสอบญี่ปุ่น", lot_code: "L18" };
    const colors = ["#c0392b", "#2c3e50", "#16a085", "#8e44ad", "#d35400", "#27ae60", "#7f8c8d", "#2980b9"];
    const names = ["Nike Vintage 90s", "Levi's Tab", "Band Tee Nirvana", "Harley Davidson", "Champion Reverse", "Uniqlo Plain", "Disney Mickey", "Adidas Trefoil"];
    const prices = [200, 180, 350, 250, 150, 60, 120, 190];
    const items = names.map((n, i) => ({ id: "it" + i, lot_id: "lot1", group_id: null, item_name: n, size: ["M", "L", "XL", "M"][i % 4], condition: "A", tier: "normal",
      cost_price: 60, base_price: prices[i], current_price: prices[i], status: "available", intake_status: "listed", sku: "L18-" + String(i + 1).padStart(3, "0"), created_at: now(), lots: lot }));
    db = { lots: [lot], lot_groups: [], items,
      item_images: items.map((it, i) => ({ id: "img" + i, item_id: it.id, image_url: svg(colors[i]), thumb_url: svg(colors[i]), sort_order: 1 })),
      sales: [], bills: [], shifts: [], expenses: [], reservations: [], app_settings: [{ key: "pos_settings", value: { promptpay_id: "0899999999", shop_name: "Bubbles Gumps" } }], capital_entries: [] };
  }
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(db));
  let billNo = db.bills.length;

  function embed(table, row) {
    const r = { ...row };
    if (table === "items") { r.lots = db.lots.find((l) => l.id === row.lot_id) || null; r.lot_groups = null; }
    if (table === "sales") r.items = embed("items", db.items.find((i) => i.id === row.item_id) || {});
    if (table === "item_images") r.items = db.items.find((i) => i.id === row.item_id) || null;
    if (table === "bills") r.sales = db.sales.filter((s) => s.bill_id === row.id).map((s) => embed("sales", s));
    return r;
  }

  // คอลัมน์แบบ "items.status" (filter บนตารางที่ join มา)
  const get = (r, c) => c.split(".").reduce((o, k) => (o == null ? o : o[k]), r);

  class Q {
    constructor(t) { this.t = t; this.f = []; this.op = "select"; this.ord = null; this.lim = null; this.one = false; }
    select() { return this; }
    eq(c, v) { this.f.push((r) => get(r, c) == v); return this; }
    not(c, op, v) { this.f.push((r) => (op === "is" ? (get(r, c) ?? null) !== v : get(r, c) != v)); return this; }
    is(c, v) { this.f.push((r) => (r[c] ?? null) === v); return this; }
    in(c, v) { this.f.push((r) => v.includes(r[c])); return this; }
    gte(c, v) { this.f.push((r) => String(r[c]) >= String(v)); return this; }
    lte(c, v) { this.f.push((r) => String(r[c]) <= String(v)); return this; }
    lt(c, v) { this.f.push((r) => String(get(r, c)) < String(v)); return this; }
    or() { return this; }
    order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    insert(row) { this.op = "insert"; this.row = row; return this; }
    upsert(row) { this.op = "upsert"; this.row = row; return this; }
    update(row) { this.op = "update"; this.row = row; return this; }
    delete() { this.op = "delete"; return this; }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      const T = (db[this.t] ||= []);
      if (this.op === "insert") { [].concat(this.row).forEach((r) => T.push({ id: uid(), created_at: now(), ...r })); save(); return { data: null, error: null }; }
      if (this.op === "upsert") { [].concat(this.row).forEach((r) => { const i = T.findIndex((x) => x.key === r.key); if (i >= 0) T[i] = r; else T.push(r); }); save(); return { data: null, error: null }; }
      let rows = T.filter((r) => { const e = embed(this.t, r); return this.f.every((f) => f(e)); });
      if (this.op === "delete") { db[this.t] = T.filter((r) => !rows.includes(r)); save(); return { data: null, error: null }; }
      if (this.op === "update") { rows.forEach((r) => Object.assign(r, this.row)); save(); return { data: null, error: null }; }
      rows = rows.map((r) => embed(this.t, r));
      if (this.ord) { const [c, asc] = this.ord; rows.sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim) rows = rows.slice(0, this.lim);
      return { data: this.one ? rows[0] || null : rows, error: null, count: rows.length };
    }
  }

  const err = (m) => ({ data: null, error: { message: m } });
  function totals(id) {
    const sh = db.shifts.find((s) => s.id === id);
    const bills = db.bills.filter((b) => b.shift_id === id).map((b) => b.id);
    const ss = db.sales.filter((s) => bills.includes(s.bill_id) && !s.voided_at);
    const ex = db.expenses.filter((e) => e.shift_id === id);
    const sum = (a, f) => a.reduce((x, y) => x + Number(f(y)), 0);
    const cash = sum(ss.filter((s) => s.payment_method === "cash"), (s) => s.sale_price);
    const drawer = sum(ex.filter((e) => e.paid_from === "drawer"), (e) => e.amount);
    const revenue = sum(ss, (s) => s.sale_price), cogs = sum(ss, (s) => s.cost_price), exp = sum(ex, (e) => e.amount);
    return { revenue, cogs, cash_sales: cash, transfer_sales: sum(ss.filter((s) => s.payment_method === "transfer"), (s) => s.sale_price), government_sales: 0,
      items: ss.length, bills: new Set(ss.map((s) => s.bill_id)).size, expenses: exp, expenses_drawer: drawer,
      expense_lines: ex.map((e) => ({ category: e.category, amount: e.amount })), shift_id: id, location: sh.location, opened_at: sh.opened_at,
      opening_cash: sh.opening_cash, expected_cash: sh.opening_cash + cash - drawer, left_today: revenue - exp, real_profit: revenue - cogs - exp };
  }
  const RPC = {
    sell_bill(p) {
      const dup = db.bills.find((b) => b.id === p.p_bill_id);
      if (dup) return { data: { bill_id: dup.id, bill_no: dup.bill_no, total: dup.total, list_total: dup.list_total, duplicate: true }, error: null };
      const shift = db.shifts.find((s) => !s.closed_at);
      let total = 0, list = 0;
      for (const l of p.p_lines) { const it = db.items.find((i) => i.id === l.item_id); if (!it || it.status !== "available") return err("ไม่ได้อยู่ในสต็อกแล้ว");
        if (db.reservations.find((r) => r.item_id === it.id && r.status === "active") && !p.p_sell_reserved) return err(`"${it.item_name}" ถูกจองไว้แล้ว`); }
      const bill = { id: p.p_bill_id, bill_no: ++billNo, shift_id: shift?.id || null, channel: p.p_channel, payment_method: p.p_payment_method, created_at: now(), voided_at: null };
      db.bills.push(bill);
      p.p_lines.forEach((l) => { const it = db.items.find((i) => i.id === l.item_id); it.status = "sold";
        db.reservations.filter((r) => r.item_id === it.id && r.status === "active").forEach((r) => { r.status = "sold"; r.bill_id = bill.id; });
        db.sales.push({ id: uid(), item_id: it.id, bill_id: bill.id, sale_price: l.price, list_price: it.current_price, cost_price: it.cost_price, payment_method: p.p_payment_method, channel: p.p_channel, sale_date: now(), voided_at: null });
        total += l.price; list += it.current_price; });
      bill.total = total; bill.list_total = list; save();
      return { data: { bill_id: bill.id, bill_no: bill.bill_no, total, list_total: list, duplicate: false }, error: null };
    },
    void_bill(p) { const b = db.bills.find((x) => x.id === p.p_bill_id); b.voided_at = now(); b.void_reason = p.p_reason;
      db.sales.filter((s) => s.bill_id === b.id && !s.voided_at).forEach((s) => { s.voided_at = now(); db.items.find((i) => i.id === s.item_id).status = "available"; }); save(); return { data: {}, error: null }; },
    void_sale(p) { const s = db.sales.find((x) => x.id === p.p_sale_id); s.voided_at = now(); s.void_reason = p.p_reason; db.items.find((i) => i.id === s.item_id).status = "available"; save(); return { data: {}, error: null }; },
    open_shift(p) { const s = { id: uid(), opening_cash: p.p_opening_cash, location: p.p_location, opened_at: now(), closed_at: null }; db.shifts.push(s); save(); return { data: s, error: null }; },
    shift_totals(p) { return { data: totals(p.p_shift_id), error: null }; },
    close_shift(p) { const t = totals(p.p_shift_id); const diff = p.p_counted_cash - t.expected_cash; if (diff && !p.p_reason) return err("ต้องใส่เหตุผล");
      const s = db.shifts.find((x) => x.id === p.p_shift_id); const out = { ...t, counted_cash: p.p_counted_cash, cash_diff: diff, diff_reason: p.p_reason };
      Object.assign(s, { closed_at: now(), expected_cash: t.expected_cash, counted_cash: p.p_counted_cash, cash_diff: diff, diff_reason: p.p_reason, summary: out }); save();
      return { data: out, error: null }; },
    reserve_item(p) { const r = { id: uid(), item_id: p.p_item_id, customer_name: p.p_customer_name, channel: p.p_channel, deposit: p.p_deposit, due_date: p.p_due_date, status: "active" }; db.reservations.push(r); save(); return { data: r, error: null }; },
    release_reservation(p) { db.reservations.find((r) => r.id === p.p_reservation_id).status = "released"; save(); return { data: {}, error: null }; },
    markdown_items(p) { let n = 0, b = 0, a = 0;
      db.items.filter((i) => p.p_item_ids.includes(i.id) && i.status === "available").forEach((i) => {
        const nv = p.p_price != null ? Math.round(p.p_price) : Math.round(i.current_price * (100 - p.p_percent) / 100);
        if (nv === i.current_price) return; b += i.current_price; a += nv; i.current_price = nv; n++; });
      save(); return { data: { updated: n, before_total: b, after_total: a }, error: null }; },
    storage_usage() { return { data: { db_bytes: 31457280, image_bytes: 412000000, image_files: 2310, items: 1290, sold_items: 870 }, error: null }; },
  };
  const ch = { on() { return ch; }, subscribe(cb) { cb && cb("SUBSCRIBED"); return ch; } };
  window.supabase = { createClient: () => ({
    from: (t) => new Q(t),
    rpc: async (n, p) => {
      if (window.__failRpc === n) { window.__failRpc = null; return { data: null, error: { message: "TypeError: Failed to fetch", code: "" } }; }
      return RPC[n] ? RPC[n](p || {}) : { data: [], error: null };
    },
    channel: () => ch, removeChannel() {},
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }), remove: async () => ({}) }) },
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) },
  }) };
  window.__mockdb = () => db;
})();
