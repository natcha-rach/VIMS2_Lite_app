-- ==========================================================
-- ใช้ครั้งเดียวเมื่อการรัน schema/part1 ครั้งก่อนล้มเหลวกลางทาง แล้วมีตารางค้างอยู่บางส่วน
-- ลบทุกอย่างที่เกี่ยวกับ VIMS2 Lite ทิ้งให้หมด (ฐานข้อมูลนี้ยังไม่มีข้อมูลจริงอยู่ จึงลบได้ปลอดภัย)
-- แล้วค่อยเริ่มรัน schema_part1_tables_and_rls.sql ใหม่ตั้งแต่ต้น
-- ==========================================================
drop view if exists public.v_items_list cascade;
drop table if exists
  lot_events,
  item_change_history,
  app_settings,
  expenses,
  sales,
  item_images,
  items,
  lot_groups,
  lots
cascade;

drop function if exists public.sell_item(uuid,numeric,text,text,text) cascade;
drop function if exists public.update_item_with_history(uuid,text,jsonb) cascade;
drop function if exists public.void_sale(uuid,text) cascade;
drop function if exists public.get_lot_summary(uuid) cascade;
drop function if exists public.get_group_progress(uuid) cascade;
drop function if exists public.get_lot_performance() cascade;
drop function if exists public.get_group_performance() cascade;
drop function if exists public.get_source_quality() cascade;
drop function if exists public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) cascade;
drop function if exists public.recost_lot(uuid,text) cascade;
drop function if exists public.assign_item_sku() cascade;
drop function if exists public.compute_lot_total_cost() cascade;
