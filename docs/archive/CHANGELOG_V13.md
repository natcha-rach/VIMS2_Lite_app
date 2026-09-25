# VIMS2 Lite — V13 Dashboard/Reports De-dup + Lot Performance RPC

## เป้าหมาย
รอบต่อจาก V12.1: ตัดข้อมูลที่ยัง "ซ้ำ" กันระหว่าง Dashboard กับ Reports ออกจริงๆ
(V12.1 ตัดไปแล้วส่วนหนึ่ง แต่ตาราง/กราฟ 4 รายการยังโชว์ซ้ำอยู่ทั้งสองหน้า) และย้ายการคำนวณ
Lot Performance ที่หนักไปทำใน Postgres แทนการดึง items+sales ทั้งตารางมาคำนวณฝั่ง browser

## ตัดออกจาก Dashboard (index.html) — เหลือแค่ที่ Reports
- Performance ตาม Lot (ตาราง 10 คอลัมน์) — ซ้ำกับ Reports
- ประสิทธิภาพตาม Tier (ตาราง) — ซ้ำกับ "ปกติ vs งานหัว" ใน Reports
- Payment Mix (โดนัทชาร์ต) — ซ้ำกับ "แยกตามวิธีจ่ายเงิน" ใน Reports
- Sales Channels (grid) — ซ้ำกับ "แยกตามช่องทางขาย" ใน Reports

Dashboard ยังเก็บ Inventory Health donut, Stock Aging, สต็อกคงเหลือ, ควรจับตา/ลดราคา,
และ Lot Recovery ไว้ — เพราะเป็นข้อมูล "ตัดสินใจวันนี้" ไม่ใช่การวิเคราะห์เชิงลึกย้อนหลัง

## เพิ่มใหม่
- **"สรุปเพิ่มเติม" card**: แทนที่ 4 รายการที่ตัดออก ด้วยสรุป 1 บรรทัดต่อเรื่อง
  (ช่องทางขายดีที่สุด / วิธีจ่ายหลัก / Tier ที่กำไรดีกว่า) + ปุ่มลิงก์ไป Reports
  (`renderQuickInsights()` ใน `dashboard.js`)
- **Period selector เป็น dropdown**: เปลี่ยนปุ่ม pill 3 ปุ่ม (รายวัน/รายเดือน/รายปี)
  เป็น `<select id="periodModeSelect">` — กดครั้งเดียวเห็นตัวเลือกทั้งหมด

## Lot Performance ย้ายไป Postgres RPC
- ฟังก์ชันใหม่ `public.get_lot_performance()` (ดู `sql/schema.sql` และ
  `sql/migration_v13_lot_performance_rpc.sql` สำหรับฐานข้อมูลเดิม) — ทำ SUM/GROUP BY
  ที่ database แล้วส่งกลับแค่ยอดสรุปต่อ Lot แทนการดึง raw rows มาคำนวณฝั่ง browser
- `reports.js`: `renderLotBreakdown()` เรียก RPC นี้แทนการดึง `items`+`lots` ทั้งตารางมาคำนวณเอง
  → เลิก fetch `items`/`lots` เต็มตารางในหน้า Reports; `renderTierBreakdown()` ใช้ tier ที่
  join มากับ `sales.items.tier` อยู่แล้ว ไม่ต้อง query items แยกอีกต่อไป
- `dashboard.js`: Lot Recovery (การ์ดเดียวที่เหลือบน Dashboard ที่ต้องใช้ยอดสะสมของ Lot)
  เปลี่ยนไปเรียก RPC เดียวกันผ่าน `renderLotRecovery()` → เลิก fetch ตาราง `lots`/`lot_groups`
  ทั้งตารางใน `fetchDashboardData()` (พบว่า `groups` และ `window.__dashboardLots` ไม่ได้ถูก
  ใช้งานจริงที่ไหนเลย เลยลบไปด้วย)

## เหตุผลของรอบนี้
Dashboard กับ Reports เดิมตอบคำถามคนละแบบในทางทฤษฎี (Dashboard = "ตอนนี้เป็นไงบ้าง",
Reports = "วิเคราะห์ย้อนหลัง") แต่ในทางปฏิบัติแสดงข้อมูลชุดเดียวกันซ้ำกันแค่คนละ visual
ทำให้ต้องแก้ logic 2 ที่เมื่อสูตรเปลี่ยน และเปิด Dashboard ทุกครั้งต้องเลื่อนผ่าน section
ที่ไม่ต้องใช้ตัดสินใจวันนี้ ส่วน RPC ช่วยกัน Reports/Dashboard ช้าลงเมื่อ items/sales
โตเป็นหลักพัน-หมื่นแถวในอนาคต

## Known follow-up (ยังไม่ทำในรอบนี้)
- KPI หลักบน Dashboard (ยอดขาย/กำไร/เงินสด ตามช่วงเวลา) ยังดึง `items`+`sales` เต็มตาราง
  มา filter ฝั่ง browser เหมือนเดิม — ถ้าจะแก้ต่อ ต้องทำเป็น RPC ที่รับ date range เป็น
  parameter (ใหญ่กว่ารอบนี้ ต้องออกแบบ signature ให้รองรับทั้ง day/month/year mode)
