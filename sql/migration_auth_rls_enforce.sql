-- ขั้นที่ 2/2: บังคับให้เฉพาะบัญชีที่อยู่ใน vims_access ใช้ข้อมูลร้านได้
-- ต้องรันหลังสร้าง/อนุมัติบัญชีเจ้าของ และหลังติดตั้ง finance + POS migrations
-- ถ้าไม่มีบัญชีเจ้าของที่ enabled migration จะหยุดโดยไม่เปลี่ยน policy ใดๆ
begin;

do $$
begin
  if to_regclass('public.vims_access') is null then
    raise exception 'ไม่พบ public.vims_access; กรุณารัน migration_auth_access_setup.sql ก่อน';
  end if;
  if not exists (select 1 from public.vims_access where enabled) then
    raise exception 'ยังไม่มีบัญชีเจ้าของที่ enabled; เพิ่ม UUID ใน vims_access ก่อนบังคับ RLS';
  end if;
  if to_regclass('public.capital_entries') is null
     or to_regclass('public.cash_counts') is null
     or to_regclass('public.pos_checkouts') is null then
    raise exception 'ติดตั้ง migration_flutter_finance.sql และ migration_pos_checkout.sql ก่อน';
  end if;
end $$;

-- Owner-only allowlist สำหรับแอปร้านส่วนตัว; ไม่เปิดสิทธิ์ให้บัญชี Auth ทั่วไปทุกบัญชี
do $$
declare
  t text;
  p record;
  tables text[] := array[
    'lots','lot_groups','items','item_images','sales','expenses','app_settings',
    'item_change_history','lot_events','capital_entries','cash_counts','pos_checkouts'
  ];
begin
  foreach t in array tables loop
    for p in select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy vims_owner_only on public.%I for all to authenticated using (public.is_vims_owner()) with check (public.is_vims_owner())',
      t
    );
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- View must apply the caller's RLS instead of executing with the view owner's rights.
alter view public.v_items_list set (security_invoker = true);
revoke all on public.v_items_list from anon;
grant select on public.v_items_list to authenticated;

-- RPC ที่อ่าน/เขียนข้อมูลต้องทำงานภายใต้ RLS ของผู้เรียก ไม่ข้าม policy ด้วย SECURITY DEFINER.
alter function public.sell_item(uuid,numeric,text,text,text) security invoker;
alter function public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb) security invoker;
alter function public.get_lot_performance() security invoker;
alter function public.get_lot_summary(uuid) security invoker;
alter function public.get_group_progress(uuid) security invoker;
alter function public.void_sale(uuid,text) security invoker;
alter function public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) security invoker;
alter function public.recost_lot(uuid,text) security invoker;
alter function public.get_group_performance() security invoker;
alter function public.get_source_quality() security invoker;
alter function public.checkout_items(uuid,jsonb,text,text,text) security invoker;
alter function public.void_checkout(uuid,text) security invoker;

-- RPC ที่ client ใช้ได้ต้องปฏิเสธ anon/public และอนุญาตเฉพาะ Authenticated owner
revoke all on function public.sell_item(uuid,numeric,text,text,text) from public, anon;
revoke all on function public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb) from public, anon;
revoke all on function public.get_lot_performance() from public, anon;
revoke all on function public.get_lot_summary(uuid) from public, anon;
revoke all on function public.get_group_progress(uuid) from public, anon;
revoke all on function public.void_sale(uuid,text) from public, anon;
revoke all on function public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) from public, anon;
revoke all on function public.recost_lot(uuid,text) from public, anon;
revoke all on function public.get_group_performance() from public, anon;
revoke all on function public.get_source_quality() from public, anon;
revoke all on function public.checkout_items(uuid,jsonb,text,text,text) from public, anon;
revoke all on function public.void_checkout(uuid,text) from public, anon;
revoke all on function public.save_cash_count(numeric,numeric,text,timestamptz) from public, anon;

grant execute on function public.sell_item(uuid,numeric,text,text,text) to authenticated;
grant execute on function public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb) to authenticated;
grant execute on function public.get_lot_performance() to authenticated;
grant execute on function public.get_lot_summary(uuid) to authenticated;
grant execute on function public.get_group_progress(uuid) to authenticated;
grant execute on function public.void_sale(uuid,text) to authenticated;
grant execute on function public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) to authenticated;
grant execute on function public.recost_lot(uuid,text) to authenticated;
grant execute on function public.get_group_performance() to authenticated;
grant execute on function public.get_source_quality() to authenticated;
grant execute on function public.checkout_items(uuid,jsonb,text,text,text) to authenticated;
grant execute on function public.void_checkout(uuid,text) to authenticated;
grant execute on function public.save_cash_count(numeric,numeric,text,timestamptz) to authenticated;

-- Storage คงการอ่านสาธารณะเพื่อรองรับรูปเก่าและ URL ที่เว็บเดิมบันทึกไว้
-- แต่จำกัดการเขียน/แทนที่/ลบไฟล์ไว้เฉพาะบัญชีเจ้าของที่อนุมัติ
drop policy if exists "public read item images" on storage.objects;
drop policy if exists "public upload item images" on storage.objects;
drop policy if exists "public update item images" on storage.objects;
drop policy if exists "public delete item images" on storage.objects;
create policy vims_item_images_public_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'item-images');
create policy vims_item_images_owner_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'item-images' and public.is_vims_owner());
create policy vims_item_images_owner_update on storage.objects
  for update to authenticated using (bucket_id = 'item-images' and public.is_vims_owner())
  with check (bucket_id = 'item-images' and public.is_vims_owner());
create policy vims_item_images_owner_delete on storage.objects
  for delete to authenticated using (bucket_id = 'item-images' and public.is_vims_owner());

commit;
