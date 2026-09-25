# VIMS2 Lite V10.1 — Code Map

## ภาพรวม Data Flow

UI (HTML/CSS) → Page JS → `supabaseClient.js` → Supabase PostgREST/RPC/Storage → PostgreSQL → Realtime → Device อื่น

## Core files

- `assets/js/supabaseClient.js`: URL/key, shared helpers, Realtime channel และ Online/Offline indicator
- `assets/js/lots.js`: CRUD Lot + Group manager
- `assets/js/items.js`: Single Item, Photo Queue, Bulk Table, Excel import, image upload, Item edit/history, Bulk Draft/Resume
- `assets/js/sell.js`: ค้นหา Item → Detail → Confirm Sale → `sell_item()` RPC; ใช้ `sale_date` จาก `sales`
- `assets/js/dashboard.js`: KPI, cash/transfer/government, profit, stock, Lot performance; invalidate cache เมื่อ Realtime event มา
- `assets/js/reports.js`: รายงานตามช่วงเวลา
- `assets/js/accounting.js`: ค่าใช้จ่าย/บัญชี
- `assets/js/nav.js`: sidebar collapse state

## Database

- `lots`: กระสอบ/ล็อตที่รับเข้ามา
- `lot_groups`: กองราคาภายใน Lot เช่น 40–60, 100, 100+, งานหัว
- `items`: สินค้าแต่ละตัว; `available → sold`
- `item_images`: รูปสินค้า 1–2 รูปด้วย `sort_order` 1/2
- `sales`: snapshot ราคาขายจริง + ต้นทุน ณ ตอนขาย
- `expenses`: ค่าใช้จ่าย
- `item_change_history`: audit trail ของการแก้ Item

## Bulk 200 Flow

Lot → Group → Photo Queue/Excel → Bulk Table → Validate → Insert Items ครั้งเดียว → Upload รูปทีละ 4 งาน → Refresh

## Multi-device

Supabase Realtime ติดตาม `lots`, `lot_groups`, `items`, `item_images`, `sales`, `expenses`. เมื่อ event มาแต่ละหน้าจะ reload เฉพาะ data domain ของตัวเอง

## Draft

Bulk Table metadata ถูกเก็บใน `localStorage`. File object ของรูปเก็บข้าม refresh ไม่ได้ จึงต้องเลือกรูปใหม่หลัง Resume


## V10.1.1 safety fixes

- `sell.js`: Realtime listener ถูกประกาศเพียงครั้งเดียวหลัง page setup; ไม่สร้าง listener ซ้ำทุกครั้งที่ขาย
- `items.js`: การ upload รูปจะ throw เมื่อ Storage หรือ `item_images` insert ล้มเหลว
- Single Item: ถ้า upload รูปล้มเหลว Item ที่เพิ่งสร้างจะถูกลบออก
- Bulk: ถ้า upload รูปกอง 200 ล้มเหลว จะ cleanup รูปที่ upload แล้วและลบ Items ที่เพิ่ง insert ทั้งกอง
