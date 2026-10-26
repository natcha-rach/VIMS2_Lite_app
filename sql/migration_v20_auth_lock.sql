-- ============================================================================
-- VIMS2 Lite V20 — ล็อกฐานข้อมูล: ต้อง Login ก่อนถึงอ่าน/เขียนได้ (ไม่บังคับ แต่แนะนำมาก)
--
-- ปัญหาตอนนี้: anon key อยู่ในไฟล์ supabaseClient.js ที่ใครเปิดเว็บก็เห็น
--              และ policy เป็น "allow all" → ใครมี URL + key ก็อ่าน/แก้/ลบข้อมูลร้านได้
--
-- ลำดับที่ต้องทำ (ทำตามนี้ ไม่งั้นจะเข้าแอปตัวเองไม่ได้)
--   1) Supabase Dashboard → Authentication → Users → Add user → ใส่อีเมล + รหัสผ่านของคุณ
--      (ติ๊ก Auto Confirm User)
--   2) Authentication → Sign In / Providers → ปิด "Allow new users to sign up"
--      (กันคนอื่นสมัครเองแล้วได้สิทธิ์เท่าคุณ)
--   3) เปิดไฟล์ assets/js/supabaseClient.js → ตั้ง AUTH_REQUIRED = true → อัปโหลดขึ้น hosting
--   4) เปิดเว็บ → หน้า Login → เข้าด้วยอีเมลข้อ 1 ให้ได้ก่อน
--   5) ค่อยรันไฟล์นี้ใน SQL Editor
--
-- ย้อนกลับ (ถ้าล็อกตัวเองออก): รัน schema_part1 ส่วน "create policy allow all" + migration_v19 ซ้ำ
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array['lots','lot_groups','items','item_images','sales','expenses','app_settings',
                           'item_change_history','lot_events','capital_entries','shifts','bills','reservations'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'allow all - ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'signed in - ' || t, t);
    -- ร้านนี้มีผู้ใช้คนเดียว (คุณ) → แค่ "login แล้ว" ก็พอ ไม่ต้องแยก owner_id
    execute format('create policy %I on public.%I for all to authenticated using (true) with check (true)', 'signed in - ' || t, t);
  end loop;
end $$;

-- view ต้องเคารพ RLS ของตารางต้นทาง (Postgres 15+)
alter view if exists public.v_items_list set (security_invoker = true);
revoke select on public.v_items_list from anon;

-- RPC: ถอนสิทธิ์ anon เหลือเฉพาะคนที่ login
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('sell_item','update_item_with_history','get_lot_performance','get_lot_summary','get_group_progress',
                        'void_sale','bulk_update_items','recost_lot','get_group_performance','get_source_quality',
                        'sell_bill','void_bill','open_shift','shift_totals','close_shift','reserve_item',
                        'release_reservation','storage_usage')
  loop
    execute format('revoke execute on function %s from anon, public', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- Storage: รูปสินค้ายังเปิดดูได้ (ใช้ลิงก์ในโพสต์ IG/FB ได้) แต่อัปโหลด/แก้/ลบ ต้อง login
drop policy if exists "public upload item images" on storage.objects;
drop policy if exists "public update item images" on storage.objects;
drop policy if exists "public delete item images" on storage.objects;
drop policy if exists "signed in upload item images" on storage.objects;
drop policy if exists "signed in update item images" on storage.objects;
drop policy if exists "signed in delete item images" on storage.objects;
create policy "signed in upload item images" on storage.objects for insert to authenticated with check (bucket_id = 'item-images');
create policy "signed in update item images" on storage.objects for update to authenticated using (bucket_id = 'item-images') with check (bucket_id = 'item-images');
create policy "signed in delete item images" on storage.objects for delete to authenticated using (bucket_id = 'item-images');

-- ตรวจผล: ทุกแถวควรเป็น {authenticated}
-- select tablename, policyname, roles from pg_policies where schemaname = 'public' order by 1;
