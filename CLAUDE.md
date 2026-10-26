# CLAUDE.md — VIMS2 Lite / Bubbles Gumps (ส่งต่องานให้ Claude Code)

> ไฟล์นี้สรุปทุกอย่างที่ทำมาแล้ว + สิ่งที่ต้องทำต่อ อ่านให้จบก่อนแก้โค้ด
> อัปเดตล่าสุด: 26 ต.ค. 2569 (V19.3) · branch `v19-pos-shift-tax`

---

## 1. เจ้าของงานและวิธีทำงานที่ต้องเคารพ

- เจ้าของร้านทำงาน **คนเดียว** ขายเสื้อยืดมือสองที่ถนนคนเดิน + IG/FB ชื่อร้าน **Bubbles Gumps**
- คุยและเขียนทุกอย่างเป็น **ภาษาไทย** (UI, comment ในโค้ด, ข้อความ error, เอกสาร)
- **ประหยัด token**: ทำบน Web App เดิม (HTML/CSS/JS + Supabase) — **ห้ามสร้างแอปใหม่** (แผน Flutter พักไว้)
- เขียน comment อธิบาย "ส่วนนี้ทำอะไร เชื่อมกับอะไร ทำไม" (ไม่ต้องทุกบรรทัด) ตาม convention ใน README
- คำศัพท์ในแอป: ใช้ **"เปิดร้าน / ปิดร้าน / ร้านวันนี้ / รอบร้าน"** — ห้ามใช้คำว่า "กะ"
- ไม่ต้องมีระบบลูกค้าประจำ/แต้มสะสม (ผู้ใช้ตัดออกแล้ว)
- ราคาที่ตกลงกับลูกค้าต้องแก้เองได้ทุกชิ้น; หน้าขายต้องเน้นรูปก่อนชื่อ
- ทุกจุดสำเร็จ/ผิดพลาดต้องมีแจ้งเตือนพร้อมรายละเอียด (ใช้ `Notify` — ดูข้อ 5)
- ห้าม commit ไฟล์ secret ใหม่ (anon key ใน `supabaseClient.js` มีอยู่แล้วตั้งแต่เดิม — เป็น public key)

## 2. ภาพรวมระบบ

- Frontend: HTML หลายหน้า + vanilla JS + CSS (ไม่มี build step) โฮสต์แบบ static
- Backend: **Supabase** (Postgres + Storage bucket `item-images` public + Realtime) — ไม่มี API server ของเราเอง
- Logic ที่ต้อง atomic อยู่ใน **Postgres RPC** (`security definer`)
- Repo: `natcha-rach/VIMS2_Lite_v6` (remote `origin`) — default branch `master`

```
index.html      ภาพรวม + การ์ด "ร้านวันนี้" (shift.js)
sell.html       หน้าขาย POS (sell.js, pos.css)
items.html      สินค้า/ลงของ/Bulk 200 (items.js)
lots.html       ล็อต/กลุ่มราคา (lots.js)
reports.html    รายงาน (reports.js)
accounting.html บัญชี/เงินทุน/ค่าใช้จ่าย + การ์ดพื้นที่ที่ใช้ (accounting.js)
tax.html        สรุปภาษี ภ.ง.ด.94/90 (tax.js, tax.css)          ← V19
login.html      เข้าสู่ระบบ (ทำงานเมื่อ AUTH_REQUIRED=true)       ← V19
assets/js/
  supabaseClient.js  client, AUTH_REQUIRED, formatBaht/formatDate, fetchAllRows, debounce
  notify.js          ระบบแจ้งเตือนกลาง + confirm/prompt + friendlyError   ← V19.1
  auth.js            ด่านตรวจ login ทุกหน้า + ปุ่มออก                    ← V19
  money.js           เงินเป็นสตางค์, กระจายส่วนลด, เงินทอน, QR พร้อมเพย์  ← V19
  shift.js           การ์ดร้านวันนี้ (เปิด/ปิดร้าน, ค่าใช้จ่ายด่วน)        ← V19
  sell.js            กริดรูป, ตะกร้า, ชำระเงิน, ใบเสร็จ, บิล/คืน, จอง     ← V19 เขียนใหม่
  tax.js             สรุปภาษี                                             ← V19
  realtime.js        Supabase Realtime → event `vims:realtime`            (แก้ V19.2)
  nav.js, vimsContext.js, dashboard.js, items.js, lots.js, reports.js, accounting.js (ของเดิม)
assets/css/
  base.css → (หน้า).css → design-v12.css → pos.css/shift.css/tax.css → polish.css (โหลดท้ายสุดทุกหน้า)
sql/
  schema_part1..3.sql          โปรเจกต์ใหม่รันตามลำดับ
  migration_v19_pos_shift.sql  ← V19 (รันซ้ำได้)
  migration_v20_auth_lock.sql  ← ล็อก RLS ให้ต้อง login (ไม่บังคับ, อ่านหัวไฟล์ก่อน)
tests/money.test.js   node --test tests/money.test.js  (9 ข้อ ผ่าน)
tests/ui/             Playwright + Supabase จำลอง (ดูข้อ 7)
.github/workflows/backup.yml   pg_dump ทุกคืน (ต้องตั้ง secret SUPABASE_DB_URL)
docs/CHANGELOG_V19.md, docs/CODE_MAP.md
```

## 3. ฐานข้อมูล (สถานะหลัง V19)

ตารางเดิม: `lots, lot_groups, items, item_images, sales, expenses, app_settings, item_change_history, lot_events, capital_entries`

เพิ่มใน V19:
| ตาราง/คอลัมน์ | หมายเหตุ |
| --- | --- |
| `shifts` (= รอบเปิดร้าน) | `opening_cash, opened_at, closed_at, expected_cash, counted_cash, cash_diff, diff_reason, summary jsonb, location` · เปิดได้ทีละ 1 (unique index `closed_at is null`) |
| `bills` | `id uuid` **สร้างจาก browser**, `bill_no` identity, `shift_id, channel, payment_method, list_total, total, cash_received, voided_at, void_reason` |
| `reservations` | `item_id, customer_name, channel, deposit, due_date, status active/sold/released, bill_id` · active ได้ 1 ต่อชิ้น |
| `sales.bill_id`, `sales.list_price` | ราคาป้าย ณ ตอนขาย เทียบกับ `sale_price` ที่ต่อรอง |
| `expenses.shift_id`, `expenses.paid_from` | `drawer` (หยิบจากลิ้นชัก) / `transfer` / `other` |
| `item_images.thumb_url/thumb_path` | รูปย่อ 400px (items.js สร้างตอนอัปโหลด) |
| index `idx_items_sellable` | partial: `status='available' and intake_status='listed'` |
| trigger `trg_expenses_closed_shift` | ปิดร้านแล้ว ห้ามเพิ่ม/แก้/ลบค่าใช้จ่ายของรอบนั้น |

RPC: `sell_bill(p_bill_id, p_lines jsonb[{item_id,price}], p_payment_method, p_channel, p_cash_received, p_note, p_sell_reserved)` (idempotent),
`void_bill`, `void_sale` (อัปเดต: ยกเลิกครบทุกชิ้น → บิลยกเลิก), `open_shift`, `shift_totals`, `close_shift`,
`reserve_item`, `release_reservation`, `storage_usage` + ของเดิม (`sell_item` ยังอยู่แต่ไม่มีหน้าไหนใช้แล้ว)

app_settings keys ที่ใช้: `pos_settings {promptpay_id, shop_name, receipt_note}`, `tax_inputs {ปี:{half|full:{outside,outsideCost}}}`, `cash_count`, `bucket_split`, `monthly_sales_goal`, `sale_channels`, `payment_methods`, `price_presets`

## 4. กฎธุรกิจ (ห้ามทำผิด)

- **เงินคิดเป็นสตางค์ (int)** ฝั่ง JS เสมอ (`Money.toSatang/toBaht`) — Postgres ใช้ `numeric(12,2)`
- ดีลทั้งบิล (ลด %/เหมา) → `Money.distributeToTotal` กระจายตามสัดส่วนราคาป้าย ปัดบาทเต็ม **ชิ้นสุดท้ายรับเศษ** ผลรวมต้องตรงทุกสตางค์
- **ห้ามลบข้อมูลเงิน** → ใช้ void + เหตุผล (บิล/การขาย) · ทุกการยกเลิก/คืนต้องมีเหตุผล
- เงินที่ควรมีในลิ้นชัก = เงินทอนตั้งต้น + ขายเงินสด − ค่าใช้จ่ายที่ `paid_from='drawer'` (ไม่นับ sales ที่ void)
- ปิดร้าน: ขาด/เกิน ≠ 0 ต้องมีเหตุผล · snapshot ตัวเลขลง `shifts.summary`
- ของที่จองอยู่ขายได้เฉพาะเมื่อส่ง `p_sell_reserved=true` (UI ถามยืนยันก่อน)
- ของ `sold` ห้ามกลับเป็น available ยกเว้นผ่าน void
- กำไรขั้นต้น = `sale_price − sales.cost_price` (snapshot ต้นทุน ณ วันขาย) · กำไรจริงวันนี้ = ยอดขาย − ต้นทุน − ค่าใช้จ่าย
- ภาษี: เงินได้ 40(8), หักเหมา 60% vs ตามจริง, เกณฑ์ VAT 1.8 ล้าน/ปี — **เป็นเครื่องมือเตรียมตัวเลข ไม่ใช่คำแนะนำภาษี** (คง disclaimer ไว้)
- ไม่ต้อง archive ของที่ขายแล้ว (≈3KB/ชิ้น) — ที่กินพื้นที่คือรูป

## 5. Convention ของโค้ด

- **แจ้งเตือน**: ใช้ `Notify.success/error/warning/info(title, detail|errorObject, {hint, actions:[{label,onClick}], duration})`
  - ส่ง error object ของ Supabase เป็น detail ได้เลย → `friendlyError` แปลเป็นไทย + วิธีแก้
  - ยืนยัน/ถาม: `await Notify.confirm({title, message, confirmText, danger})`, `await Notify.prompt({title, message, placeholder, required})`
  - **ห้ามใช้** `alert/confirm/prompt` ของเบราว์เซอร์ · `showToast()` เดิมของทุกหน้าส่งต่อไป `Notify.auto()` แล้ว
- โหลด script ตามลำดับ: supabase-js CDN → `supabaseClient.js` → `notify.js` → `auth.js` → `nav.js` → (money.js) → page js → `realtime.js`
- **Cache-busting**: แก้ไฟล์ JS/CSS แล้วเพิ่มเลข `?v=` ในทุก `.html` ที่โหลดไฟล์นั้น (มือถือ cache แรง)
- Realtime: หน้าเว็บฟัง `window.addEventListener('vims:realtime', e => e.detail.table)` + `page_refresh` · ใช้ `debounce`
- ตารางใหม่ต้องเพิ่มใน `TABLES` ของ `realtime.js` และ publication `supabase_realtime` ใน migration
- SQL ใหม่: เขียนเป็นไฟล์ migration ที่รันซ้ำได้ (`if not exists`, `create or replace`) ชื่อ `sql/migration_vNN_*.sql` + เพิ่ม grant/revoke ให้ RPC
- CSS ใหม่ใช้ token `--v11-*` (design-v12) และ `--ui-*/--ok/--bad/--warn/--info` (polish.css) · ปุ่ม/ช่อง ≥44px · ฟอนต์ Prompt
- localStorage ห่อ try/catch เสมอ (ใช้แค่จำค่าเล็กๆ เช่น ช่องทางล่าสุด, จำนวนคอลัมน์)
- Modal ของ POS อยู่ใต้ `<body>` (นอก `#mainWrap`) เพื่ออยู่เหนือเมนูล่างมือถือ

## 6. สถานะงาน (Roadmap)

| เฟส | เสร็จแล้ว | ยังไม่ทำ |
| --- | --- | --- |
| 0 ฐานราก | migration v19/v20, login + `AUTH_REQUIRED` (ปิดอยู่), money.js + test, backup workflow | CI รัน test อัตโนมัติ (GitHub Actions) |
| 1 หน้าร้าน | กริดรูป 2/3 คอลัมน์, ค้นเลข 3 ตัวท้าย SKU, ตะกร้า, แก้ราคารายชิ้น/ลด %/เหมา, เงินทอน, QR พร้อมเพย์, ใบเสร็จรูป, เลิกทำ 5 วิ, รูปย่อ | backfill รูปย่อให้รูปเก่า |
| 2 เงินตรง | การ์ดร้านวันนี้, ค่าใช้จ่ายด่วน, เหลือวันนี้/กำไรจริง, นับเงิน & ปิดร้าน + แชร์ LINE, แท็บบิล & คืนของ | ประวัติรอบร้านย้อนหลัง (ดู `shifts.summary`), ผูกยอดปิดร้านเข้าหน้าบัญชี (`cash_count`) |
| 3 ออนไลน์+ภาษี | จอง IG/FB, หน้า tax, การ์ดพื้นที่ที่ใช้ | แนบรูปใบเสร็จค่าใช้จ่าย (bucket ส่วนตัว + `expenses.receipt_path`), ลบรูปเต็มของชิ้นที่ขายเกิน 6 เดือน (pg_cron/Edge Function), รายการจองทั้งหมด + เตือนครบกำหนด |
| 4 ทนทาน | — | ขายตอนเน็ตหลุด (คิวบิลใน IndexedDB แล้วส่ง `sell_bill` ด้วย UUID เดิม), crash reporting, แนะนำลดราคาของค้าง 60+ วัน |
| UX | Notify ทั้งแอป, polish.css, เมนูล่างมือถือ + ปุ่มขายตรงกลาง, คำว่า เปิดร้าน/ปิดร้าน | ตรวจหน้า items/lots/reports บนมือถือจริงอีกรอบ, dark mode (ยังไม่ทำ) |

### งานถัดไปที่แนะนำ (เรียงตามคุ้มค่า)
1. **Push branch** `v19-pos-shift-tax` ขึ้น GitHub แล้วเปิด PR เข้า `master` (รอบก่อน push ไม่ได้เพราะ session ไม่มีสิทธิ์ repo)
2. ช่วยผู้ใช้ deploy จริง: รัน `migration_v19` → อัปโหลดไฟล์ → ตั้งพร้อมเพย์ → ทดลองเปิดร้าน/ขาย 1–2 บิล/ปิดร้าน
3. เปิด Login + รัน `migration_v20_auth_lock.sql` (ทำตามลำดับในหัวไฟล์ ไม่งั้นล็อกตัวเองออก)
4. ผูกการปิดร้านเข้ากับหน้าบัญชี (เงินคงเหลือจริง) + หน้าประวัติรอบร้าน
5. Offline queue สำหรับหน้าขาย

## 7. การทดสอบ

- Unit: `node --test tests/money.test.js` (มีค่าอ้างอิง PromptPay จาก php-promptpay-qr: `0899999999` → `...6304FE29`)
- SQL: ทดสอบกับ Postgres local + stub ของ Supabase (role `anon/authenticated`, schema `storage/auth`, publication) แล้วรัน `sql/schema.sql` → migration v19 → v20 ได้ผ่าน
- UI: `cd tests/ui && npm i && npx playwright install chromium` (ถ้าเครื่องยังไม่มี) แล้ว
  - `node run.js` — flow จริง: เปิดร้าน → ค่าแผง → ใส่ตะกร้า → ดีลเหมา → จำลองเน็ตหลุดตอนขาย (error + ลองอีกครั้ง) → ใบเสร็จ → จอง → คืนของ (prompt บังคับเหตุผล) → ลบค่าใช้จ่าย (confirm) → ปิดร้าน → ภาษี
  - `node shots.js after` — ภาพทุกหน้า มือถือ 390px + จอ 1280px
  - `node rt.js` — supabase-js ตัวจริง: realtime เก่ามี error / ใหม่ไม่มี
  - `mock-supabase.js` คือ supabase-js จำลองใน memory (ตั้ง `window.__failRpc = "ชื่อ rpc"` เพื่อจำลอง error)
- ยังไม่เคยทดสอบกับ Supabase โปรเจกต์จริงของผู้ใช้ — ระวังเรื่อง schema จริงอาจต่างจากไฟล์ใน `sql/` (เช่น `capital_entries`, `expenses.expense_at` ไม่อยู่ใน schema_part แต่ migration_v19 สร้างให้แบบ if not exists)

## 8. ข้อควรระวัง / บั๊กที่เคยเจอ

- Realtime: ห้ามเรียก `.on()` บน channel ที่ subscribe แล้ว — ใช้ชื่อ channel ไม่ซ้ำ + `removeChannel` ก่อนต่อใหม่ (แก้แล้วใน V19.2)
- `design-v12.css` ใช้ `!important` เยอะ — override ใน `polish.css` ต้องใช้ selector เจาะจงพอ (เช่น `.sidebar-links a.active`)
- ฟอร์ม global ใน polish.css ใช้ `:where()` (specificity 0) เพื่อไม่ทับ class ของหน้าเดิม
- `qrcode-generator@1.4.4` บน CDN ไม่มี `.min.js` → ใช้ `qrcode.js`
- iOS: ช่องกรอกต้อง ≥16px ไม่งั้นซูม
- เปิด `AUTH_REQUIRED=true` ก่อนสร้าง user = เข้าแอปไม่ได้
- ข้อจำกัดแพ็กเกจฟรี Supabase: DB 500MB, Storage 1GB, หยุดเองเมื่อไม่ใช้งาน 1 สัปดาห์, ไม่มี backup — ตรวจหน้า pricing ปัจจุบันก่อนแนะนำ

## 9. เอกสารประกอบ (นอก repo)

- Requirement + วิเคราะห์ POS คู่แข่ง: Claude Doc (artifact `F8aNKt9Gn6VWpq1LBrAeng`)
- Mockup 10 หน้าจอ: design canvas (artifact `GLqnwvB1XNoTmdv5mMJ53w`)
- Storyboard & Build Roadmap: Claude Doc (artifact `CfnTwwiniFcqzM96NYGPXa`) — มีหัวข้อ "ทำบน Web App เดิมก่อน (V19)"
- โปรเจกต์ Flutter ที่ทำไว้ก่อน (พักไว้): `VIMS2_Lite_Flutter.zip`

---

## 10. งานที่ผู้ใช้สั่งล่าสุด (26 ต.ค. 2569 20:39) — ทำตามลำดับนี้

### งาน A — หน้าหลักเหลือแค่ "ร้านวันนี้ + PULSE" ✅ ทำแล้วใน V19.4 (commit "V19.4")
- `index.html` เหลือ: หัวหน้า + ปุ่ม Download, การ์ด `#shiftCard`, ตัวเลือกช่วงเวลา, section `.v11-today-pulse` (6 stat-card)
- `dashboard.js`: `$()` คืน div เปล่าเมื่อหา id ไม่เจอ (โค้ดคำนวณเดิมทำงานต่อได้โดยไม่ error), `renderLotRecovery/renderTodayTasks` ข้ามเมื่อไม่มีการ์ด
- สิ่งที่ Claude Code ต้องทำ: แค่ตรวจบนมือถือจริงหลัง deploy ว่าไม่มีแจ้งเตือน error
- ถ้าจะลบโค้ดคำนวณที่ไม่ได้ใช้ใน `dashboard.js` (goal/charts/aging/markdown) ทำได้ แต่ไม่บังคับ — ระวังอย่าลบส่วนที่ PULSE ใช้ (`statRevenue`, `statGrossProfit`, `statExpenses`, `statNetProfit`, `statCash`, `statAvailable`, sparkline)

### งาน B — รวมเมนู "ล็อต" + "สินค้า" เป็นเมนูเดียว "สต็อก" (ยังไม่ทำ)
ข้อตกลงกับผู้ใช้: **รวมที่เมนู/การนำทาง แต่ไม่ยุบไฟล์** (`lots.html`/`lots.js` กับ `items.html`/`items.js` แยกเหมือนเดิม — items.js ~90KB เสี่ยงพังและโหลดช้า)
1. ทุกหน้า `.html` (index, items, lots, sell, reports, accounting, tax): ใน `.sidebar-links` แทน 2 ลิงก์ `lots.html` + `items.html` ด้วยลิงก์เดียว
   `<a href="items.html" title="สต็อก">` ไอคอนกล่อง (ใช้ svg ของล็อตเดิม) + `<span class="label">สต็อก</span>` + ย้าย `#navStockBadge` มาไว้ในลิงก์นี้
   → เมนูเหลือ 5 ปุ่ม: ภาพรวม · สต็อก · ขายของ (วงกลมกลาง) · รายงาน · บัญชี
   (ปุ่มขายควรอยู่ตรงกลาง — ลำดับใหม่: ภาพรวม, สต็อก, ขายของ, รายงาน, บัญชี)
2. `nav.js`: ไฮไลต์ "สต็อก" เมื่อหน้าปัจจุบันเป็น `items.html` หรือ `lots.html`
   (ตอนนี้เทียบ `href === currentPage` — เพิ่มกรณี `lots.html` → active ที่ลิงก์ items.html)
3. ใส่แถบแท็บย่อยบนสุดของ `.page` ทั้ง 2 หน้า: `<nav class="stock-tabs"><a href="lots.html">Lot</a><a href="items.html">สินค้า</a></nav>` (แท็บของหน้าปัจจุบันมี `aria-current="page"`) สไตล์ใช้แบบ `.seg` ใน pos.css / ใส่ CSS ใน polish.css
4. แท็บ "สินค้า" ต้องพา Lot/กลุ่มที่เลือกล่าสุดไปด้วย: ใช้ `VimsContext.itemsUrl(VimsContext.resolve())` (มีใน `vimsContext.js` แล้ว) — `lots.html` ต้องโหลด `vimsContext.js` ด้วยถ้ายังไม่โหลด
5. ปุ่ม "ไปหน้าสินค้า" ที่หัวหน้า lots.html เอาออกได้ (ซ้ำกับแท็บ)
6. polish.css มี rule ปุ่มขายตรงกลางโดยอิง `a[href="sell.html"]` อยู่แล้ว — ใช้ได้กับ 5 ปุ่มเลย
7. เพิ่มเลข `?v=` ของ nav.js / polish.css ในทุก html · รัน `tests/ui` (`node shots.js after`) ดูมือถือ 390px + จอ 1280px ว่าเมนูไม่ตกบรรทัด และ `node run.js` ผ่าน
8. commit: `V19.5: merge Lots + Items into one "สต็อก" menu with sub-tabs`

### งาน C — Deploy
ยังไม่รู้ว่าผู้ใช้ host เว็บไว้ที่ไหน → **ถามผู้ใช้ก่อน** 1 คำถาม (เช่น GitHub Pages / Netlify / Vercel / Cloudflare Pages / โฮสต์อื่นแบบอัปโหลดไฟล์)
1. **ฐานข้อมูลก่อนเว็บเสมอ**: ต้องรัน `sql/migration_v19_pos_shift.sql` ใน Supabase ก่อนเว็บ V19 ขึ้นจริง (หน้าขายเรียก `sell_bill`)
   - ถ้าผู้ใช้ให้ connection string: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f sql/migration_v19_pos_shift.sql` (รันซ้ำได้)
   - ถ้าไม่ให้: บอกผู้ใช้วางไฟล์นี้ใน Supabase → SQL Editor → Run แล้วรอยืนยันว่าขึ้น Success
   - ตรวจหลังรัน: `select proname from pg_proc where proname in ('sell_bill','open_shift','close_shift','reserve_item');` ต้องได้ 4 แถว
   - **อย่ารัน `migration_v20_auth_lock.sql` เอง** จนกว่าผู้ใช้สร้าง user + เปิด `AUTH_REQUIRED=true` + login ได้แล้ว (ดูหัวไฟล์)
2. Push: `git push -u origin v19-pos-shift-tax` → เปิด PR เข้า `master` → merge (ถามผู้ใช้ก่อน merge)
3. ถ้าเลือก **GitHub Pages**: มี `.github/workflows/pages.yml` แล้ว (รัน unit test → คัดเฉพาะ *.html + assets/ → deploy เมื่อ push เข้า master)
   ผู้ใช้ต้องเปิด repo → Settings → Pages → Source = **GitHub Actions** ครั้งแรกครั้งเดียว · URL จะเป็น `https://natcha-rach.github.io/VIMS2_Lite_v6/`
   ถ้า repo เป็น private และบัญชีเป็นแพ็กเกจฟรี GitHub Pages อาจใช้ไม่ได้ → เสนอ Netlify/Cloudflare Pages (ลากโฟลเดอร์ที่มีแค่ *.html + assets/)
4. ถ้าโฮสต์อื่น: deploy เฉพาะ `*.html` + `assets/` (ไม่ต้องอัป `sql/ tests/ docs/ .github/`)
5. หลัง deploy: เปิด URL จริงบนมือถือ → หน้าขาย → ปุ่มเฟือง ตั้งพร้อมเพย์ → ทดลอง เปิดร้าน → ขาย 1 บิล → เลิกทำ → ปิดร้าน แล้วรายงานผลให้ผู้ใช้
6. Supabase → Authentication → URL Configuration: เพิ่ม URL เว็บจริงใน Site URL/Redirect URLs (จำเป็นเมื่อเปิดระบบ login)
