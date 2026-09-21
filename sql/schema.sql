-- VIMS2 Lite / Bubbles Gumps - Supabase schema
-- รันไฟล์นี้แทน schema เดิมสำหรับฐานข้อมูลใหม่

create extension if not exists pgcrypto;

create table if not exists lots (
  id uuid primary key default gen_random_uuid(),
  lot_name text not null,
  purchase_date date not null default current_date,
  source text,
  total_cost numeric(12,2) not null default 0 check (total_cost >= 0),
  total_items int not null default 0 check (total_items >= 0),
  note text,
  -- V14: สถานะ Lot + ของที่คัดทิ้งก่อนลง (ไม่มีแถวใน items) — ดู migration_v14_lot_reconciliation.sql
  status text not null default 'receiving' check (status in ('receiving','sorting','ready','closed')),
  rejected_qty int not null default 0 check (rejected_qty >= 0),
  damaged_qty int not null default 0 check (damaged_qty >= 0),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists lot_groups (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  group_name text not null,
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  tier text not null default 'normal' check (tier in ('normal','head')),
  sort_order int not null default 0,
  target_qty int check (target_qty is null or target_qty >= 0), -- V14: เป้าหมายจำนวนชิ้นของกลุ่ม (ไม่บังคับ)
  created_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references lots(id) on delete set null,
  group_id uuid references lot_groups(id) on delete set null,
  item_name text not null,
  size text,
  condition text not null default 'A' check (condition in ('A','B')),
  tier text not null default 'normal' check (tier in ('normal','head')),
  cost_price numeric(12,2) not null default 0 check (cost_price >= 0),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  current_price numeric(12,2) not null default 0 check (current_price >= 0),
  status text not null default 'available' check (status in ('available','sold','damaged')),
  created_at timestamptz not null default now(),
  sold_at timestamptz
);

create table if not exists item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  image_url text not null,
  storage_path text,
  sort_order int not null default 1 check (sort_order in (1,2)),
  created_at timestamptz not null default now(),
  unique (item_id, sort_order)
);

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete set null,
  sale_date timestamptz not null default now(),
  channel text not null default 'street_market',
  sale_price numeric(12,2) not null check (sale_price >= 0),
  cost_price numeric(12,2) not null check (cost_price >= 0),
  payment_method text not null check (payment_method in ('cash','transfer','government')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_lot_groups_lot on lot_groups(lot_id);
create index if not exists idx_lots_status on lots(status);
create index if not exists idx_items_status on items(status);
create index if not exists idx_items_lot on items(lot_id);
create index if not exists idx_items_group on items(group_id);
create index if not exists idx_item_images_item on item_images(item_id);
create index if not exists idx_sales_item on sales(item_id);
create index if not exists idx_sales_date on sales(sale_date);
create index if not exists idx_expenses_date on expenses(expense_date);

-- Item edit history: audit trail สำหรับการแก้ไขสินค้าโดยตรงจาก Frontend
create table if not exists item_change_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  action text not null default 'update' check (action in ('update','image_replace')),
  changed_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_item_change_history_item on item_change_history(item_id, created_at desc);


-- ค่าเริ่มต้น: กลุ่มราคาที่แก้ได้จากหน้า Settings/ต่อ Lot ได้เอง
insert into app_settings(key, value)
values
  ('sale_channels', '[{"value":"street_market","label":"ถนนคนเดิน"},{"value":"facebook","label":"Facebook"},{"value":"instagram","label":"Instagram"}]'::jsonb),
  ('payment_methods', '[{"value":"cash","label":"เงินสด"},{"value":"transfer","label":"โอน"},{"value":"government","label":"โครงการรัฐ"}]'::jsonb),
  ('price_presets', '{"normal":{"multiple":3},"head":{"multiple":6}}'::jsonb)
on conflict (key) do nothing;

-- Storage: สร้าง bucket รูปสินค้า
insert into storage.buckets (id, name, public)
values ('item-images','item-images',true)
on conflict (id) do update set public = true;

-- RLS: โปรเจกต์ส่วนตัว ใช้ anon โดยตรงตามแนวทางเดิม
alter table lots enable row level security;
alter table lot_groups enable row level security;
alter table items enable row level security;
alter table item_images enable row level security;
alter table sales enable row level security;
alter table expenses enable row level security;
alter table app_settings enable row level security;
alter table item_change_history enable row level security;

drop policy if exists "allow all - lots" on lots;
drop policy if exists "allow all - lot_groups" on lot_groups;
drop policy if exists "allow all - items" on items;
drop policy if exists "allow all - item_images" on item_images;
drop policy if exists "allow all - sales" on sales;
drop policy if exists "allow all - expenses" on expenses;
drop policy if exists "allow all - app_settings" on app_settings;
drop policy if exists "allow all - item_change_history" on item_change_history;

create policy "allow all - lots" on lots for all using (true) with check (true);
create policy "allow all - lot_groups" on lot_groups for all using (true) with check (true);
create policy "allow all - items" on items for all using (true) with check (true);
create policy "allow all - item_images" on item_images for all using (true) with check (true);
create policy "allow all - sales" on sales for all using (true) with check (true);
create policy "allow all - expenses" on expenses for all using (true) with check (true);
create policy "allow all - app_settings" on app_settings for all using (true) with check (true);
create policy "allow all - item_change_history" on item_change_history for all using (true) with check (true);

drop policy if exists "public read item images" on storage.objects;
drop policy if exists "public upload item images" on storage.objects;
drop policy if exists "public update item images" on storage.objects;
drop policy if exists "public delete item images" on storage.objects;
create policy "public read item images" on storage.objects for select using (bucket_id = 'item-images');
create policy "public upload item images" on storage.objects for insert with check (bucket_id = 'item-images');
create policy "public update item images" on storage.objects for update using (bucket_id = 'item-images') with check (bucket_id = 'item-images');
create policy "public delete item images" on storage.objects for delete using (bucket_id = 'item-images');

-- ขาย 1 ชิ้นแบบ atomic: ถ้า insert sale หรือเปลี่ยนสถานะไม่สำเร็จ ทั้ง transaction จะ rollback
create or replace function public.sell_item(
  p_item_id uuid,
  p_sale_price numeric,
  p_payment_method text,
  p_channel text default 'street_market',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_sale sales%rowtype;
begin
  select * into v_item from items where id = p_item_id for update;
  if not found then raise exception 'ไม่พบสินค้า'; end if;
  if v_item.status <> 'available' then raise exception 'สินค้านี้ไม่ได้อยู่ในสต็อก'; end if;
  if p_sale_price < 0 then raise exception 'ราคาขายไม่ถูกต้อง'; end if;

  insert into sales(item_id, sale_price, cost_price, payment_method, channel, note)
  values (p_item_id, p_sale_price, v_item.cost_price, p_payment_method, p_channel, p_note)
  returning * into v_sale;

  update items set status='sold', sold_at=now() where id=p_item_id;
  return jsonb_build_object('sale_id', v_sale.id, 'item_id', p_item_id);
end;
$$;

revoke all on function public.sell_item(uuid,numeric,text,text,text) from public;
grant execute on function public.sell_item(uuid,numeric,text,text,text) to anon, authenticated;


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


-- V13: Lot Performance คำนวณใน Postgres แทน browser
-- เดิม Dashboard และ Reports ต่างดึง items + sales "ทั้งตาราง" มา group/sum เองฝั่ง JS
-- (จำเป็นเพราะ Performance ตาม Lot ต้องใช้ยอดสะสมตลอดอายุ Lot ไม่ใช่แค่ช่วงเวลาที่เลือก)
-- ปัญหาคือเมื่อ sales/items เพิ่มเป็นหลักพัน-หมื่นแถว การ fetch มาคำนวณฝั่ง browser ทุกครั้งที่เปิดหน้า
-- จะช้าลงเรื่อยๆ แบบไม่มีจุดพังชัดเจน (silent degradation)
-- ฟังก์ชันนี้ทำ SUM/GROUP BY ที่ database แล้วส่งกลับแค่ยอดสรุปต่อ Lot แทน raw rows
create or replace function public.get_lot_performance()
returns table (
  lot_id uuid,
  lot_name text,
  purchase_date date,
  total_cost numeric,
  total_items int,
  sold int,
  remaining int,
  revenue numeric,
  cost_sold numeric,
  remaining_capital numeric,
  profit numeric,
  recovery_pct numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id as lot_id,
    l.lot_name,
    l.purchase_date,
    l.total_cost,
    l.total_items,
    coalesce(s.sold_count, 0)::int as sold,
    greatest(l.total_items - coalesce(s.sold_count, 0), 0)::int as remaining,
    coalesce(s.revenue, 0)::numeric as revenue,
    coalesce(s.cost_sold, 0)::numeric as cost_sold,
    greatest(l.total_cost - coalesce(s.cost_sold, 0), 0)::numeric as remaining_capital,
    (coalesce(s.revenue, 0) - coalesce(s.cost_sold, 0))::numeric as profit,
    case when l.total_cost > 0
      then round(coalesce(s.revenue, 0) / l.total_cost * 100, 1)
      else 0
    end as recovery_pct
  from lots l
  left join (
    select
      i.lot_id,
      count(*) as sold_count,
      sum(sa.sale_price) as revenue,
      sum(sa.cost_price) as cost_sold
    from sales sa
    join items i on i.id = sa.item_id
    group by i.lot_id
  ) s on s.lot_id = l.id
  order by coalesce(s.revenue, 0) desc, l.purchase_date desc;
$$;

revoke all on function public.get_lot_performance() from public;
grant execute on function public.get_lot_performance() to anon, authenticated;


-- V14: Lot Reconciliation RPC
-- 3) get_lot_summary — ตัวเลข Reconciliation + เงินต่อ Lot (คำนวณที่ Postgres ทั้งหมด)
--   รับเข้า  = lots.total_items
--   ลงแล้ว   = items ที่ available + sold
--   คัดออก   = lots.rejected_qty            (ของที่คัดทิ้งก่อนลง ไม่มีแถวใน items)
--   เสีย     = lots.damaged_qty + items.status='damaged'
--   รอคัด    = รับเข้า - ลงแล้ว - คัดออก - เสีย   (ติดลบ = ลงเกินจำนวนรับเข้า)
-- p_lot_id = null → ทุก Lot, ใส่ id → เฉพาะ Lot นั้น
create or replace function public.get_lot_summary(p_lot_id uuid default null)
returns table (
  lot_id uuid,
  status text,
  closed_at timestamptz,
  received int,
  listed int,
  available int,
  sold int,
  rejected int,
  damaged int,
  pending int,
  items_total int,
  total_cost numeric,
  revenue numeric,
  cost_sold numeric,
  profit numeric,
  remaining_to_breakeven numeric,
  stock_cost numeric,
  stock_value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with it as (
    select
      i.lot_id as lid,
      count(*) as items_total,
      count(*) filter (where i.status = 'available') as available,
      count(*) filter (where i.status = 'sold') as sold,
      count(*) filter (where i.status = 'damaged') as damaged_items,
      coalesce(sum(i.cost_price) filter (where i.status = 'available'), 0) as stock_cost,
      coalesce(sum(i.current_price) filter (where i.status = 'available'), 0) as stock_value
    from items i
    where i.lot_id is not null and (p_lot_id is null or i.lot_id = p_lot_id)
    group by i.lot_id
  ),
  sa as (
    select
      i.lot_id as lid,
      sum(s.sale_price) as revenue,
      sum(s.cost_price) as cost_sold
    from sales s
    join items i on i.id = s.item_id
    where i.lot_id is not null and (p_lot_id is null or i.lot_id = p_lot_id)
    group by i.lot_id
  )
  select
    l.id as lot_id,
    l.status,
    l.closed_at,
    l.total_items as received,
    (coalesce(it.available, 0) + coalesce(it.sold, 0))::int as listed,
    coalesce(it.available, 0)::int as available,
    coalesce(it.sold, 0)::int as sold,
    l.rejected_qty as rejected,
    (l.damaged_qty + coalesce(it.damaged_items, 0))::int as damaged,
    (l.total_items
      - (coalesce(it.available, 0) + coalesce(it.sold, 0))
      - l.rejected_qty
      - (l.damaged_qty + coalesce(it.damaged_items, 0)))::int as pending,
    coalesce(it.items_total, 0)::int as items_total,
    l.total_cost::numeric as total_cost,
    coalesce(sa.revenue, 0)::numeric as revenue,
    coalesce(sa.cost_sold, 0)::numeric as cost_sold,
    (coalesce(sa.revenue, 0) - coalesce(sa.cost_sold, 0))::numeric as profit,
    greatest(l.total_cost - coalesce(sa.revenue, 0), 0)::numeric as remaining_to_breakeven,
    coalesce(it.stock_cost, 0)::numeric as stock_cost,
    coalesce(it.stock_value, 0)::numeric as stock_value
  from lots l
  left join it on it.lid = l.id
  left join sa on sa.lid = l.id
  where p_lot_id is null or l.id = p_lot_id;
$$;

revoke all on function public.get_lot_summary(uuid) from public;
grant execute on function public.get_lot_summary(uuid) to anon, authenticated;

-- 4) get_group_progress — จำนวนที่ลงจริงต่อกลุ่ม เทียบ target_qty
create or replace function public.get_group_progress(p_lot_id uuid default null)
returns table (
  group_id uuid,
  lot_id uuid,
  target_qty int,
  listed int,
  items_total int,
  sold int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id as group_id,
    g.lot_id as lot_id,
    g.target_qty as target_qty,
    (count(i.id) filter (where i.status in ('available', 'sold')))::int as listed,
    count(i.id)::int as items_total,
    (count(i.id) filter (where i.status = 'sold'))::int as sold
  from lot_groups g
  left join items i on i.group_id = g.id
  where p_lot_id is null or g.lot_id = p_lot_id
  group by g.id, g.lot_id, g.target_qty;
$$;

revoke all on function public.get_group_progress(uuid) from public;
grant execute on function public.get_group_progress(uuid) to anon, authenticated;
