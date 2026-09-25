-- VIMS2 Lite v7: Item edit history
-- ใช้เก็บ old/new value ทุกครั้งที่แก้ไข Item เพื่อรักษา audit trail โดยไม่สร้าง Backend API

create table if not exists item_change_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  action text not null default 'update' check (action in ('update','image_replace')),
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_item_change_history_item on item_change_history(item_id, created_at desc);

alter table item_change_history enable row level security;
drop policy if exists "allow all - item_change_history" on item_change_history;
create policy "allow all - item_change_history" on item_change_history for all using (true) with check (true);

-- Atomic update: เปลี่ยนข้อมูล Item + สร้าง history record ใน transaction เดียว
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
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_updated items%rowtype;
  v_history_id uuid;
begin
  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  -- ไม่อนุญาตให้แก้สถานะ sold กลับเป็น available/damaged เพราะประวัติการขายต้องไม่หาย
  if v_item.status = 'sold' and p_status <> 'sold' then
    raise exception 'สินค้าที่ขายแล้วไม่สามารถเปลี่ยนกลับจาก sold ได้';
  end if;
  if p_condition not in ('A','B') then raise exception 'Condition ไม่ถูกต้อง'; end if;
  if p_tier not in ('normal','head') then raise exception 'Tier ไม่ถูกต้อง'; end if;
  if p_status not in ('available','sold','damaged') then raise exception 'Status ไม่ถูกต้อง'; end if;

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

revoke all on function public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb) from public;
grant execute on function public.update_item_with_history(uuid,text,text,text,text,text,uuid,numeric,numeric,numeric,jsonb) to anon, authenticated;
