# สถาปัตยกรรมโค้ด (Clean Architecture แบบเบา — ไม่มี build step)

**ย้ายครบทุกหน้าแล้ว (V21)** — กฎข้อ 1–2 มีเทสบังคับใน `tests/architecture.test.js` (ถ้า UI เรียก Supabase ตรง หรือ domain แตะ DOM เทสจะแดง)

## ชั้นของโค้ด (เรียกได้ทางเดียว: UI → Domain/Data → Infra)

```
UI (page controller)   assets/js/sell.js …        อ่าน/เขียน DOM, ผูก event, แสดง Notify
   │ เรียก
   ├─ Domain (กฎธุรกิจล้วน) assets/js/domain/*.js   ไม่แตะ DOM / Supabase → เทสต์ด้วย node ได้
   │     money.js (เดิม) · cart.js · reservations.js · shiftCalc.js · cashBalance.js · debtPlan.js · insightsCalc.js · lotCalc.js · taxCalc.js
   └─ Data (repository)   assets/js/data/*.js      ที่เดียวที่เรียก Supabase ของหน้านั้น
         salesRepo.js · catalogRepo.js · shiftRepo.js · dashboardRepo.js · accountingRepo.js · reportsRepo.js · lotsRepo.js · taxRepo.js · itemsRepo.js   คืน { data, error } แบบ supabase-js เสมอ
            │ ใช้
Infra                    supabaseClient.js (client, fetchAllRows, debounce) · notify.js · offline.js · sw.js · realtime.js
```

กฎ
1. **UI ห้ามเรียก `supabaseClient` ตรง** — ผ่าน Repo เสมอ (เปลี่ยน schema/RPC แก้ที่เดียว) · ยกเว้นไฟล์ infra: supabaseClient.js, auth.js, realtime.js
2. **Domain ห้ามรู้จัก DOM/Supabase** — รับค่า คืนค่า เงินเป็นสตางค์ (int) เสมอ
3. Domain เขียนแบบ UMD (`window.X` + `module.exports`) → `node --test tests/*.test.js` ได้
4. ไฟล์ใหม่ทุกไฟล์มีหัวไฟล์: ทำอะไร · ใครเรียก · เรียกต่อไปที่ไหน
5. ลำดับ `<script>`: supabase-js → supabaseClient → notify → auth → nav → money → domain/* → data/* → (offline) → page → realtime

## แผนที่หน้าขาย

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/cart.js` | Domain | ตะกร้า: รวมยอด, ดีล % / เหมา (กระจายด้วย Money) | sell.js |
| `domain/reservations.js` | Domain | คำนวณ "อีกกี่วัน/เลยนัด" + เรียงรายการจอง | sell.js |
| `data/catalogRepo.js` | Data | ของพร้อมขาย, รูป, การจอง, ตั้งค่าพร้อมเพย์, จอง/ยกเลิกจอง | sell.js |
| `data/salesRepo.js` | Data | sell_bill (มี fallback p_sold_at), void_bill/void_sale, บิล, ของที่ขายแล้ว, ประวัติขายรายชิ้น | sell.js, offline.js |
| `offline.js` | Infra | คิวบิลตอนเน็ตหลุด → `SalesRepo.sellBill` | sell.js, shift.js |
| `sell.js` | UI | กริด, ตะกร้า, ชำระเงิน, ใบเสร็จ, แท็บบิล/จอง/ขายแล้ว | sell.html |

## แผนที่ร้านวันนี้ (index.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/shiftCalc.js` | Domain | เหลือวันนี้/กำไรจริง, ลิ้นชักขาด-เกิน, ข้อความสรุปปิดร้าน | shift.js |
| `data/shiftRepo.js` | Data | รอบร้านที่เปิด, shift_totals, เปิด/ปิดร้าน, เพิ่ม/แก้/ลบค่าใช้จ่าย, เติมทุน (capital_entries) | shift.js |
| `data/dashboardRepo.js` | Data | ข้อมูล PULSE + การ์ดรายการ (items/sales/expenses/capital), เป้ายอดขาย, RPC Lot | dashboard.js |
| `dashboard.js` | UI | PULSE, ตัวเลือกช่วงเวลา, การ์ดรายการ (แตะแถวค่าใช้จ่าย → แผ่นแก้ของ shift.js) | index.html |
| `data/salesRepo.js` | Data | ให้ offline.js ส่งบิลค้างจากหน้าภาพรวมได้ด้วย | offline.js |
| `shift.js` | UI | การ์ดร้านวันนี้, ปุ่ม + และแผ่นเพิ่มรายการ (จ่าย/รับ-เติมทุน/แก้/ลบ), โมดอลนับเงิน & ปิดร้าน | index.html |

## แผนที่หน้าบัญชี (accounting.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/cashBalance.js` | Domain | "เงินสด + เงินโอน ที่มีจริงตอนนี้" = ยอดนับล่าสุด + รายการหลังนับ ± ขาด/เกินปิดร้าน, ยอดโครงการรัฐ | accounting.js |
| `data/accountingRepo.js` | Data | lots/expenses/sales/capital/shifts/app_settings, ประวัติรอบร้าน, storage_usage, รูป + Storage | accounting.js, shift-history.js, storage-tools.js, การ์ดพื้นที่ |
| `domain/debtPlan.js` | Domain | การ์ดกันเงินหนี้: รอบวันที่ 6→28, กำไรจริงรอบนี้, เหลือวันตลาด → วันละเท่าไร | accounting.js |
| `accounting.js` | UI | เงินจริงตอนนี้ (นับเงิน/เงินทุน), การ์ดกันเงินหนี้, ส่งออก CSV | accounting.html |
| `shift-history.js` | UI | ประวัติรอบร้าน + สรุปตามทำเล | accounting.html |
| `storage-tools.js` | UI | สร้างรูปย่อ / ลบรูปเต็มของที่ขายเกิน 6 เดือน | accounting.html |

## แผนที่หน้ารายงาน (reports.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/insightsCalc.js` | Domain | จัดกลุ่มไซซ์/สภาพ/ประเภท/Tier/ช่วงราคา, มัธยฐานวันขายออก, คำแนะนำ, Lot คืนทุนกี่วัน | insights.js |
| `data/reportsRepo.js` | Data | sales/expenses ตามช่วง, แนวโน้ม, RPC Lot/กลุ่มราคา/แหล่งซื้อ, ข้อมูลอะไรขายดี (อ่านอย่างเดียว) | reports.js, insights.js |
| `reports.js` | UI | สรุปยอด, แยกช่องทาง/วิธีจ่าย/Tier, กราฟแนวโน้ม, ตาราง Lot/กลุ่ม/แหล่งซื้อ | reports.html |
| `insights.js` | UI | การ์ด "อะไรขายดี" | reports.html |

## แผนที่หน้าล็อต (lots.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/lotCalc.js` | Domain | ต้นทุนรวมแยกส่วน, ต้นทุนเฉลี่ยต่อชิ้น, นับชิ้นต่อกลุ่ม | lots.js |
| `data/lotsRepo.js` | Data | CRUD Lot/กลุ่มราคา, สรุป Lot, ความคืบหน้ากลุ่ม, คิดต้นทุนใหม่ (recost_lot) | lots.js |
| `lots.js` | UI | ฟอร์ม Lot, การ์ด Lot, ปิด/เปิด Lot, จัดการกลุ่มราคา | lots.html |

## แผนที่หน้าภาษี (tax.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `domain/taxCalc.js` | Domain | ยอดรายเดือน (เวลาไทย), หักเหมา 60% vs ตามจริง, % เกณฑ์ VAT 1.8 ล้าน | tax.js |
| `data/taxRepo.js` | Data | ยอดขาย/ค่าใช้จ่ายของปี, รายรับ 12 เดือน, app_settings.tax_inputs | tax.js |
| `tax.js` | UI | เลือกปี/ครึ่งปี, ช่องรายได้นอกแอป, ตาราง, CSV/พิมพ์ | tax.html |

## แผนที่หน้าสินค้า (items.html)

| ไฟล์ | ชั้น | หน้าที่ | ใครเรียก |
| --- | --- | --- | --- |
| `data/itemsRepo.js` | Data | Lot/กลุ่มราคา, สร้าง/ลบ/แก้สินค้า (+ประวัติ), ตารางสต็อก (v_items_list), อัปโหลดรูป/รูปย่อ, Bulk insert + เปลี่ยนเป็น listed, ของค้าง + markdown_items | items.js, stale.js |
| `items.js` | UI | ลงของทีละชิ้น, ตาราง + ตัวกรอง, แก้ไขสินค้า, Bulk 200 | items.html |
| `stale.js` | UI | การ์ดของค้าง → ลด %/ตั้งราคา | items.html |

## ความปลอดภัยในโค้ด (V21)

| เรื่อง | ทำแล้ว | ที่ไฟล์ |
| --- | --- | --- |
| XSS | ข้อความ/URL จากฐานข้อมูลที่ใส่ลง `innerHTML` ต้องผ่าน `escapeHtml`/`esc` เสมอ (รวม `src` ของรูป และค่าช่องทาง/วิธีจ่ายที่ไม่รู้จัก) — เพราะฐานข้อมูลยังเปิดให้ anon เขียนได้ ข้อความในตารางจึงเชื่อไม่ได้ | ทุก page js |
| Filter injection | ตัด `, ( ) * % \` ออกจากคำค้นก่อนต่อเข้า `.or()` ของ PostgREST | `data/itemsRepo.js` |
| Header | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy ผ่าน Cloudflare Pages | `_headers` (เทส UI ส่ง CSP เดียวกัน) |
| Supply chain | ล็อกเวอร์ชันไลบรารีจาก CDN ทุกตัว (supabase-js 2.118.0 · chart.js 4.4.7 · qrcode-generator 1.4.4 · xlsx 0.18.5) | `*.html` |
| ข้อมูลเงิน | เขียนผ่าน RPC/ตารางที่มี check + trigger (ห้ามแก้ค่าใช้จ่ายของรอบที่ปิดแล้ว ฯลฯ) | `sql/` |

**ยังเปิดอยู่ (ต้องตัดสินใจ):** ไม่มี login + RLS เปิดให้ anon อ่าน/เขียน → ใครมี URL เว็บก็เรียก API ได้ทั้งหมด · วิธีปิด: login ครั้งเดียวต่อเครื่อง + `sql/migration_v20_auth_lock.sql`
