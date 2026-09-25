# VIMS2 Lite — V12.1 Dashboard Cleanup + Icon Redesign

## เป้าหมาย
ลดความรกของหน้า Dashboard (ตัดข้อมูลซ้ำ/ย้ายของที่เป็นการวิเคราะห์เชิงลึกไปหน้า Reports)
เพิ่ม Feature ที่ช่วยตัดสินใจรายวัน/รายเดือน และเปลี่ยน Emoji icon ทั้งแอปเป็น inline SVG
line-icon ให้ตรงสไตล์ Template ที่อ้างอิง

## ตัด/รวมใน Dashboard (index.html)
- ลบการ์ด "ภาพรวมเงินรับวันนี้" (ล่างสุด) — ซ้ำกับ "เงินสดรับวันนี้" ใน Today Pulse
- ลบการ์ด "การรับเงินในช่วงที่เลือก" — ซ้ำกับกราฟโดนัท Payment Mix (เก็บโดนัทไว้)
- ย้าย "เสาร์ vs อาทิตย์" ออกจาก Dashboard (มีอยู่แล้วในหน้า Reports)
- ย้าย "ตัวทำกำไรสูงสุด" ไปหน้า Reports (เดิมมีเฉพาะใน Dashboard) — เพิ่ม `renderTopProfitItems()` ใน `reports.js`

## Feature ใหม่
- **Export CSV**: ปุ่ม Download มุมขวาบน Dashboard — export สรุป + รายการขายของช่วงเวลาที่เลือกเป็น CSV (มี BOM รองรับภาษาไทยใน Excel)
- **Period-over-Period**: badge % เขียว/แดงใต้ KPI การ์ด (ยอดขาย/กำไรขั้นต้น/ค่าใช้จ่าย/กำไรสุทธิ) เทียบกับช่วงก่อนหน้าที่มีความยาวเท่ากัน ซ่อนอัตโนมัติเมื่อเลือกช่วง "ทั้งหมด"
- **เป้ายอดขายรายเดือน (Goal tracking)**: การ์ดใหม่พร้อม progress bar, ปุ่ม "ตั้งเป้า" บันทึกลง `app_settings` (key: `monthly_sales_goal`, value: `{amount:number}`) ไม่ใช้ localStorage เพื่อให้ sync ข้ามอุปกรณ์
- **Stock aging badge**: จุดแดงที่ไอคอน "สินค้า" ใน sidebar (ทุกหน้า) แสดงจำนวนสินค้าพร้อมขายที่ค้าง 60+ วัน คำนวณใน `nav.js` และ refresh ตาม Realtime event ของ `items`

## Icon Redesign
- แทน Emoji ทั้งหมดด้วย inline SVG (stroke=currentColor, เส้นบาง สไตล์เดียวกับ Template) ครอบคลุม: sidebar ทุกหน้า, KPI label, quick actions, action center, insight cards, callout/tip ต่างๆ ในหน้า สินค้า/ขายของ/บัญชี
- Sidebar active state ใช้แถบสีม่วงซ้าย + พื้นหลังอ่อนแทนพื้นหลังทึบเดิม เพื่อให้ icon เส้นอ่านง่ายขึ้น

## ไม่เปลี่ยน Schema เดิม
ใช้ตาราง `app_settings` (key/value) ที่มีอยู่แล้วสำหรับเก็บเป้ายอดขาย ไม่ต้อง migrate ฐานข้อมูล
