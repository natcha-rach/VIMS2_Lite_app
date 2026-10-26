-- ขั้นที่ 1/2: เตรียมบัญชีเจ้าของ โดยยังไม่เปลี่ยน RLS ที่เว็บกำลังใช้อยู่
-- รันหลัง base schema, migration_flutter_finance.sql และ migration_pos_checkout.sql
begin;

create table if not exists public.vims_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.vims_access enable row level security;
revoke all on public.vims_access from public, anon, authenticated;

-- ฟังก์ชันตรวจ allowlist; ใช้สิทธิ์เจ้าของฟังก์ชันอ่านตารางที่ client อ่านตรงไม่ได้
create or replace function public.is_vims_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vims_access a
    where a.user_id = (select auth.uid()) and a.enabled = true
  );
$$;
revoke all on function public.is_vims_owner() from public, anon;
grant execute on function public.is_vims_owner() to authenticated;

commit;

-- หลังสร้างบัญชี Email/Password ใน Supabase Dashboard:
-- 1) Authentication -> Users -> คัดลอก UUID ของบัญชีเจ้าของ
-- 2) รัน SQL นี้ใน SQL Editor โดยแทน UUID:
-- insert into public.vims_access(user_id, enabled)
-- values ('ใส่-UUID-บัญชีเจ้าของ', true)
-- on conflict (user_id) do update set enabled = excluded.enabled;
-- 3) ทดสอบ login ทั้งเว็บและ Flutter ก่อนรัน migration_auth_rls_enforce.sql
