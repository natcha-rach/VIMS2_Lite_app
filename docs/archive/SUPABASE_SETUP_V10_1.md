# VIMS2 Lite V10.1 — Supabase Setup

## 1) ใช้ Project เดิม
V10.1 ใช้ Supabase Project เดิมของ V10 และ `anon` frontend key เดิมใน `assets/js/supabaseClient.js`.

## 2) ก่อน Migration
ห้ามสร้าง `lot_groups`, `item_images`, `item_change_history` ใหม่เอง เพราะ V10 schema มีตารางเหล่านี้อยู่แล้ว

## 3) Run migration
เปิด Supabase SQL Editor แล้วรัน:

`sql/migration_v10_1_realtime.sql`

Migration จะตรวจว่าตารางมีจริงก่อนเพิ่มเข้า `supabase_realtime`.

## 4) Expected result
ควรเห็นอย่างน้อย:
- public.lots
- public.lot_groups
- public.items
- public.item_images
- public.sales
- public.expenses

## 5) Frontend flow
HTML → page JS → `supabaseClient.js` → Supabase → PostgreSQL/Storage → Realtime → Device อื่น

## 6) Devices
ทุก Device ใช้ Project เดียวกัน:
- Phone 1
- Phone 2
- iPad Pro 13"
- Computer

ไม่มี permission แยกใน V10.1

## 7) Bulk Draft
Bulk Table metadata ถูกเก็บใน browser `localStorage` เพื่อ Resume หลัง refresh. รูปไม่สามารถ persist เป็น File object ผ่าน localStorage ได้ จึงต้องเลือกรูปใหม่หลัง Resume.

## 8) Sale history
`sales.sale_date` คือวันเวลาขายจริง. V10.1 แก้หน้า Sell ให้ไม่อ่าน `sold_at` จาก `sales`.
