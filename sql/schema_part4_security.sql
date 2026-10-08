-- ==========================================================
-- VIMS2 Lite — Part 4: Security hardening  (รันได้ทั้ง DB ใหม่และ DB เดิม / รันซ้ำได้ปลอดภัย)
-- ==========================================================
-- ทำอะไร:
--   1) เปลี่ยน RLS จาก "ใครก็ได้ (anon)" เป็น "เฉพาะเจ้าของร้านที่ล็อกอินแล้ว" เท่านั้น
--   2) ถอดสิทธิ์ anon ออกจากตาราง / ฟังก์ชัน / view ทั้งหมด
--   3) เปลี่ยน function ทั้งหมดจาก SECURITY DEFINER เป็น SECURITY INVOKER (ไม่ข้าม RLS)
--   4) ล็อก Storage: อัปโหลด/ลบ/แก้ ได้เฉพาะเจ้าของ + จำกัดชนิดไฟล์/ขนาด
--   5) กันตั้งสถานะ 'sold' ตรงๆ โดยไม่มีรายการขาย (ทำให้ยอดขายหาย)
--
-- ลำดับที่ต้องทำ (สำคัญ — ทำผิดลำดับจะเข้าแอปไม่ได้):
--   A. Supabase Dashboard > Authentication > Users > Add user  (อีเมล+รหัสผ่านของเจ้าของร้าน)
--   B. Authentication > Sign In / Providers > ปิด "Allow new users to sign up"
--   C. รันไฟล์นี้ทั้งไฟล์ใน SQL Editor
--   D. รันคำสั่งนี้ 1 ครั้ง (แก้อีเมลให้ตรงกับข้อ A) เพื่อกำหนดว่าใครคือเจ้าของ:
--        insert into public.app_admins(user_id)
--        select id from auth.users where email = 'YOUR_EMAIL@example.com'
--        on conflict do nothing;
--   E. ทดสอบตามหัวข้อ "Verification" ท้ายไฟล์
-- ==========================================================

-- ---------- 0) ตารางรายชื่อเจ้าของ + ฟังก์ชันตรวจสิทธิ์ ----------
-- ตารางนี้เปิด RLS แต่ "ไม่มี policy" = browser อ่าน/เขียนไม่ได้เลย แก้ได้จาก SQL Editor เท่านั้น
-- ทำไมไม่ใช้แค่ "authenticated": ถ้าเผลอเปิด sign-up ไว้ คนแปลกหน้าสมัครแล้วจะเห็นข้อมูลทั้งร้าน
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

-- ---------- 1) RLS: เฉพาะเจ้าของเท่านั้น ----------
do $$
declare
  t text;
begin
  foreach t in array array[
    'lots','lot_groups','items','item_images','sales',
    'expenses','app_settings','item_change_history','lot_events'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', 'allow all - ' || t, t);
      execute format('drop policy if exists %I on public.%I', 'owner only - ' || t, t);
      execute format(
        'create policy %I on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))',
        'owner only - ' || t, t
      );
    end if;
  end loop;
end $$;

-- ---------- 2) ถอดสิทธิ์ anon ออกจากทุกอย่างใน schema public ----------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- View v_items_list: view ปกติรันด้วยสิทธิ์เจ้าของ view = ข้าม RLS ได้!
-- security_invoker = true ทำให้ view เคารพ RLS ของตารางเดิม
do $$
begin
  if to_regclass('public.v_items_list') is not null then
    execute 'alter view public.v_items_list set (security_invoker = true)';
    execute 'revoke all on public.v_items_list from anon';
    execute 'grant select on public.v_items_list to authenticated';
  end if;
end $$;

-- ---------- 3) กันตั้ง sold ตรงๆ ผ่านหน้าแก้ไขสินค้า ----------
-- เดิมหน้าแก้ไขเลือก "ขายแล้ว" ได้ → Item เป็น sold แต่ไม่มีแถวใน sales → ยอดขาย/กำไรหาย
-- ตอนนี้ต้องขายผ่าน sell_item() เท่านั้น
create or replace function public.update_item_with_history(
  p_item_id uuid,
  p_item_name text,
  p_size text,
  p_condition text,
  p_tier text,
  p_status text,
  p_group_id uuid,
  p_cost_price numeric,
  p_base_price numeric,
  p_current_price numeric,
  p_changed_fields jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_updated items%rowtype;
  v_history_id uuid;
begin
  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  if v_item.status = 'sold' and p_status <> 'sold' then
    raise exception 'สินค้าที่ขายแล้วไม่สามารถเปลี่ยนกลับจาก sold ได้ (ถ้าขายผิดให้ใช้ "ยกเลิกการขาย")';
  end if;
  if p_status = 'sold' and v_item.status <> 'sold' then
    raise exception 'ตั้งสถานะเป็น sold ตรงๆ ไม่ได้ ต้องขายผ่านหน้า "ขายของ" เพื่อให้มีรายการขาย';
  end if;
  if p_condition not in ('A','B') then raise exception 'Condition ไม่ถูกต้อง'; end if;
  if p_tier not in ('normal','head') then raise exception 'Tier ไม่ถูกต้อง'; end if;
  if p_status not in ('available','sold','damaged') then raise exception 'Status ไม่ถูกต้อง'; end if;
  if length(coalesce(trim(p_item_name), '')) = 0 or length(p_item_name) > 200 then
    raise exception 'ชื่อสินค้าต้องมี 1-200 ตัวอักษร';
  end if;

  update items
  set item_name = trim(p_item_name),
      size = nullif(trim(p_size), ''),
      condition = p_condition,
      tier = p_tier,
      status = p_status,
      group_id = p_group_id,
      cost_price = greatest(p_cost_price, 0),
      base_price = greatest(p_base_price, 0),
      current_price = greatest(p_current_price, 0)
  where id = p_item_id
  returning * into v_updated;

  insert into item_change_history(item_id, action, changed_fields)
  values (p_item_id, 'update', coalesce(p_changed_fields, '{}'::jsonb))
  returning id into v_history_id;

  return jsonb_build_object('item', to_jsonb(v_updated), 'history_id', v_history_id);
end;
$$;

-- ---------- 4) เปลี่ยนฟังก์ชันทั้งหมดเป็น SECURITY INVOKER ----------
-- SECURITY DEFINER = รันด้วยสิทธิ์เจ้าของฟังก์ชัน (ข้าม RLS) ซึ่ง anon เคยเรียกได้ตรงๆ
-- INVOKER = รันด้วยสิทธิ์คนเรียก → ต้องผ่าน RLS (เจ้าของเท่านั้น) ทุกครั้ง
do $$
declare
  s text;
begin
  foreach s in array array[
    'public.sell_item(uuid,numeric,text,text,text)',
    'public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb)',
    'public.void_sale(uuid,text)',
    'public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text)',
    'public.recost_lot(uuid,text)',
    'public.get_lot_performance()',
    'public.get_lot_summary(uuid)',
    'public.get_group_progress(uuid)',
    'public.get_group_performance()',
    'public.get_source_quality()',
    'public.assign_item_sku()'
  ] loop
    if to_regprocedure(s) is not null then
      execute format('alter function %s security invoker', s);
    end if;
  end loop;
end $$;

-- ฟังก์ชันของเราทุกตัวใน public (ไม่รวมของ extension): ถอด anon/public เหลือเฉพาะ authenticated
-- (is_owner() ตั้งค่าไว้แล้วด้านบน — loop นี้ให้ผลเหมือนกัน)
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end $$;

-- ---------- 5) Storage: bucket item-images ----------
-- bucket ยังเป็น public เพื่อให้ <img src="..."> แสดงรูปได้โดยไม่ต้องเซ็น URL
-- (ผู้ที่มี URL เต็มเปิดดูรูปได้ แต่ list/อัปโหลด/แก้/ลบ ทำไม่ได้ถ้าไม่ใช่เจ้าของ)
-- จำกัดขนาด 10 MB และเฉพาะไฟล์รูป กัน upload ไฟล์อันตราย/เต็มพื้นที่
update storage.buckets
set public = true,
    file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
where id = 'item-images';

drop policy if exists "public read item images" on storage.objects;
drop policy if exists "public upload item images" on storage.objects;
drop policy if exists "public update item images" on storage.objects;
drop policy if exists "public delete item images" on storage.objects;
drop policy if exists "owner read item images" on storage.objects;
drop policy if exists "owner upload item images" on storage.objects;
drop policy if exists "owner update item images" on storage.objects;
drop policy if exists "owner delete item images" on storage.objects;

create policy "owner read item images" on storage.objects for select to authenticated
  using (bucket_id = 'item-images' and (select public.is_owner()));
create policy "owner upload item images" on storage.objects for insert to authenticated
  with check (bucket_id = 'item-images' and (select public.is_owner()));
create policy "owner update item images" on storage.objects for update to authenticated
  using (bucket_id = 'item-images' and (select public.is_owner()))
  with check (bucket_id = 'item-images' and (select public.is_owner()));
create policy "owner delete item images" on storage.objects for delete to authenticated
  using (bucket_id = 'item-images' and (select public.is_owner()));

-- ==========================================================
-- Verification (รันหลังทำครบ A–D)
-- 1) ใน SQL Editor:  select * from public.app_admins;   → ต้องเห็น 1 แถว (เจ้าของ)
-- 2) ทดสอบว่า anon เข้าไม่ได้ (เปลี่ยน <URL> และ <ANON_KEY>) ต้องได้ [] หรือ error 401/permission denied:
--      curl "<URL>/rest/v1/sales?select=*" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      curl "<URL>/rest/v1/v_items_list?select=*" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--      curl -X POST "<URL>/rest/v1/rpc/get_lot_performance" -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
-- 3) ล็อกอินหน้าเว็บแล้วทดสอบตาม docs/SUPABASE_SETUP.md ข้อ 5 (ขาย/อัปโหลดรูป) ต้องใช้งานได้ปกติ
-- ==========================================================
