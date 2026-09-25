-- ============================================================
-- VIMS2 Lite V10.1 — Realtime Migration
-- ============================================================
-- ใช้กับ V10 ที่มี table เหล่านี้อยู่แล้วเท่านั้น
-- ไม่สร้าง lot_groups/item_images ใหม่ เพราะ V10 มีอยู่แล้ว
-- ไม่ลบข้อมูลเดิม
-- ============================================================

DO $$
DECLARE
  table_name TEXT;
  realtime_tables TEXT[] := ARRAY[
    'lots',
    'lot_groups',
    'items',
    'item_images',
    'sales',
    'expenses'
  ];
BEGIN
  FOREACH table_name IN ARRAY realtime_tables LOOP
    -- เช็กว่าตารางมีจริงก่อน เพื่อไม่ให้ migration ล้มจาก relation ที่ไม่มี
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = table_name
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          table_name
        );
      END IF;

      -- ส่งข้อมูล row ก่อน/หลังสำหรับ UPDATE/DELETE ให้ Realtime client ใช้ได้ละเอียดขึ้น
      EXECUTE format(
        'ALTER TABLE public.%I REPLICA IDENTITY FULL',
        table_name
      );
    END IF;
  END LOOP;
END $$;

-- ตรวจสอบผลลัพธ์: ควรเห็น 6 ตารางของ V10
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('lots','lot_groups','items','item_images','sales','expenses')
ORDER BY tablename;
