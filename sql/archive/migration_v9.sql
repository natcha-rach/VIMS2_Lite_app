-- VIMS2 Lite v9: Dashboard / Reports performance helpers
-- ไม่มีการเปลี่ยน business data; เพิ่ม index สำหรับ query รายงานจำนวนมาก

create index if not exists idx_sales_channel_date on sales(channel, sale_date desc);
create index if not exists idx_sales_payment_date on sales(payment_method, sale_date desc);
create index if not exists idx_items_created_status on items(status, created_at desc);
create index if not exists idx_items_lot_status on items(lot_id, status);

-- หมายเหตุ: Dashboard v9 คำนวณ aggregate ใน browser จาก Supabase เพื่อให้โปรเจกต์เล็กและไม่มี API layer
-- หากข้อมูลโตมากในอนาคต ค่อยย้าย aggregate หนัก ๆ ไปเป็น SQL view/RPC ได้โดยไม่ต้องเปลี่ยน UI contract
