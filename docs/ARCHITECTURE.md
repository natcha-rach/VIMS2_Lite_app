# สถาปัตยกรรมโค้ด (Clean Architecture แบบเบา — ไม่มี build step)

ทยอยย้ายทีละหน้า · ย้ายแล้ว: **หน้าขาย (sell)**, **ร้านวันนี้ (shift)** · ยังไม่ย้าย: accounting, reports, lots, items, tax, dashboard

## ชั้นของโค้ด (เรียกได้ทางเดียว: UI → Domain/Data → Infra)

```
UI (page controller)   assets/js/sell.js …        อ่าน/เขียน DOM, ผูก event, แสดง Notify
   │ เรียก
   ├─ Domain (กฎธุรกิจล้วน) assets/js/domain/*.js   ไม่แตะ DOM / Supabase → เทสต์ด้วย node ได้
   │     money.js (เดิม) · cart.js · reservations.js · shiftCalc.js
   └─ Data (repository)   assets/js/data/*.js      ที่เดียวที่เรียก Supabase ของหน้านั้น
         salesRepo.js · catalogRepo.js · shiftRepo.js   คืน { data, error } แบบ supabase-js เสมอ
            │ ใช้
Infra                    supabaseClient.js (client, fetchAllRows, debounce) · notify.js · offline.js · sw.js · realtime.js
```

กฎ
1. **UI ห้ามเรียก `supabaseClient` ตรง** ในหน้าที่ย้ายแล้ว — ผ่าน Repo เสมอ (เปลี่ยน schema/RPC แก้ที่เดียว)
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
| `data/shiftRepo.js` | Data | รอบร้านที่เปิด, shift_totals, เปิด/ปิดร้าน, เพิ่ม/ลบค่าใช้จ่าย | shift.js |
| `data/salesRepo.js` | Data | ให้ offline.js ส่งบิลค้างจากหน้าภาพรวมได้ด้วย | offline.js |
| `shift.js` | UI | การ์ดร้านวันนี้, ฟอร์มค่าใช้จ่ายด่วน, โมดอลนับเงิน & ปิดร้าน | index.html |
