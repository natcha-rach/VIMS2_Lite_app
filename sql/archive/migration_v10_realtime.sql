-- ============================================================
-- VIMS2 Lite V10.1 — Realtime Sync
-- เชื่อม: Supabase Database → Realtime → มือถือ 1 / มือถือ 2 / iPad / Computer
-- รันหลัง schema/migration เดิมทั้งหมด
-- ============================================================

-- เพิ่ม table เข้า publication ของ Supabase Realtime แบบ idempotent
-- ถ้า table อยู่แล้ว จะไม่เพิ่มซ้ำและ migration ยังรันต่อได้
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'lots','lot_groups','items','item_images','sales','expenses','app_settings','item_change_history'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('alter publication supabase_realtime add table public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ใช้ replica identity full เพื่อให้ Realtime UPDATE/DELETE ส่งข้อมูลก่อน-หลังมาได้ครบ
ALTER TABLE public.lots REPLICA IDENTITY FULL;
ALTER TABLE public.lot_groups REPLICA IDENTITY FULL;
ALTER TABLE public.items REPLICA IDENTITY FULL;
ALTER TABLE public.item_images REPLICA IDENTITY FULL;
ALTER TABLE public.sales REPLICA IDENTITY FULL;
ALTER TABLE public.expenses REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;
ALTER TABLE public.item_change_history REPLICA IDENTITY FULL;
