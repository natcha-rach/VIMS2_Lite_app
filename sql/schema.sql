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
  lot_code text, -- V15: ใช้สร้าง SKU (L0921 ฯลฯ) — ไม่บังคับ
  item_seq int not null default 0, -- V15: ตัวนับรันเลขต่อ Lot สำหรับ SKU
  -- V16: ต้นทุนแยกส่วน (ไม่บังคับ) — total_cost คำนวณอัตโนมัติเมื่อ purchase_cost ไม่ null (ดู trigger compute_lot_total_cost)
  purchase_cost numeric(12,2) check (purchase_cost is null or purchase_cost >= 0),
  shipping_cost numeric(12,2) not null default 0 check (shipping_cost >= 0),
  cleaning_cost numeric(12,2) not null default 0 check (cleaning_cost >= 0),
  repair_cost numeric(12,2) not null default 0 check (repair_cost >= 0),
  other_cost numeric(12,2) not null default 0 check (other_cost >= 0),
  cost_basis text not null default 'received' check (cost_basis in ('received','sellable')),
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
  -- V15: SKU + entry-mode/stock fields
  sku text,
  item_type text,
  storage_location text,
  intake_status text not null default 'listed' check (intake_status in ('draft','listed')),
  listed_at timestamptz,
  price_updated_at timestamptz,
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
  voided_at timestamptz, -- V15: ยกเลิกการขาย (กู้จากกดขายผิด)
  void_reason text,
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
create unique index if not exists idx_lots_lot_code on lots(lot_code) where lot_code is not null;
create index if not exists idx_items_status on items(status);
create index if not exists idx_items_lot on items(lot_id);
create index if not exists idx_items_group on items(group_id);
create unique index if not exists idx_items_sku on items(sku) where sku is not null;
create index if not exists idx_items_intake_status on items(intake_status);
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

-- V16: audit ของ recost_lot() ฯลฯ
create table if not exists lot_events (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_lot_events_lot on lot_events(lot_id, created_at desc);
alter table lot_events enable row level security;


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
drop policy if exists "allow all - lot_events" on lot_events;

create policy "allow all - lots" on lots for all using (true) with check (true);
create policy "allow all - lot_groups" on lot_groups for all using (true) with check (true);
create policy "allow all - items" on items for all using (true) with check (true);
create policy "allow all - item_images" on item_images for all using (true) with check (true);
create policy "allow all - sales" on sales for all using (true) with check (true);
create policy "allow all - expenses" on expenses for all using (true) with check (true);
create policy "allow all - app_settings" on app_settings for all using (true) with check (true);
create policy "allow all - item_change_history" on item_change_history for all using (true) with check (true);
create policy "allow all - lot_events" on lot_events for all using (true) with check (true);

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
  if v_item.intake_status <> 'listed' then raise exception 'สินค้านี้ยังลงไม่ครบ (รอรูป) จึงขายไม่ได้'; end if; -- V15
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
    where sa.voided_at is null -- V15
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
      count(*) filter (where i.status = 'available' and i.intake_status = 'listed') as available,
      count(*) filter (where i.status = 'sold') as sold,
      count(*) filter (where i.status = 'damaged') as damaged_items,
      coalesce(sum(i.cost_price) filter (where i.status = 'available' and i.intake_status = 'listed'), 0) as stock_cost,
      coalesce(sum(i.current_price) filter (where i.status = 'available' and i.intake_status = 'listed'), 0) as stock_value
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
    where i.lot_id is not null and s.voided_at is null and (p_lot_id is null or i.lot_id = p_lot_id)
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
    (count(i.id) filter (where i.status = 'sold' or (i.status = 'available' and i.intake_status = 'listed')))::int as listed,
    count(i.id)::int as items_total,
    (count(i.id) filter (where i.status = 'sold'))::int as sold
  from lot_groups g
  left join items i on i.group_id = g.id
  where p_lot_id is null or g.lot_id = p_lot_id
  group by g.id, g.lot_id, g.target_qty;
$$;

revoke all on function public.get_group_progress(uuid) from public;
grant execute on function public.get_group_progress(uuid) to anon, authenticated;


-- V15: SKU / Entry modes / Stock view / Bulk actions / Void sale
-- 3) SKU trigger: สร้าง SKU อัตโนมัติจาก lot_code + running number เมื่อ insert Item ใหม่
-- ทำงานเฉพาะ Lot ที่ตั้ง lot_code ไว้แล้วเท่านั้น (Lot เก่าที่ไม่มี lot_code จะไม่ได้ SKU — ไม่กระทบของเดิม)
create or replace function public.assign_item_sku()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot_code text;
  v_seq int;
begin
  if new.sku is not null or new.lot_id is null then
    return new;
  end if;
  select lot_code into v_lot_code from lots where id = new.lot_id for update;
  if v_lot_code is null then
    return new;
  end if;
  update lots set item_seq = item_seq + 1 where id = new.lot_id returning item_seq into v_seq;
  new.sku := v_lot_code || '-' || lpad(v_seq::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_items_assign_sku on items;
create trigger trg_items_assign_sku before insert on items
  for each row execute function public.assign_item_sku();

-- 4) sell_item: ขายได้เฉพาะ Item ที่ลงครบแล้ว (intake_status='listed') กัน Item ที่ยังอยู่ระหว่างอัปโหลดรูปหลุดไปขาย
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
  if v_item.intake_status <> 'listed' then raise exception 'สินค้านี้ยังลงไม่ครบ (รอรูป) จึงขายไม่ได้'; end if;
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

-- 5) sales: void (ยกเลิกการขาย) — กู้จากกดขายผิดโดยไม่ต้องแก้ SQL ตรงๆ
alter table sales add column if not exists voided_at timestamptz;
alter table sales add column if not exists void_reason text;

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale sales%rowtype;
begin
  select * into v_sale from sales where id = p_sale_id for update;
  if not found then raise exception 'ไม่พบรายการขาย'; end if;
  if v_sale.voided_at is not null then raise exception 'รายการนี้ถูกยกเลิกไปแล้ว'; end if;

  update sales set voided_at = now(), void_reason = p_reason where id = p_sale_id;
  update items set status = 'available', sold_at = null where id = v_sale.item_id and status = 'sold';

  return jsonb_build_object('sale_id', p_sale_id, 'item_id', v_sale.item_id);
end;
$$;

revoke all on function public.void_sale(uuid,text) from public;
grant execute on function public.void_sale(uuid,text) to anon, authenticated;

-- 6) v_items_list: view รวม Lot/Group name + จำนวนรูป + อายุสต็อก สำหรับหน้า Stock filter
-- ให้กรอง/ค้นหาที่ server ได้ครบ (ไม่มีรูป, อายุ 30/60/90 วัน ฯลฯ) แทนการดึงทุกแถวมากรองที่ browser
create or replace view public.v_items_list as
select
  i.*,
  l.lot_name,
  l.status as lot_status,
  g.group_name,
  g.tier as group_tier,
  (select count(*) from item_images ii where ii.item_id = i.id)::int as image_count,
  extract(day from now() - coalesce(i.listed_at, i.created_at))::int as age_days
from items i
left join lots l on l.id = i.lot_id
left join lot_groups g on g.id = i.group_id;

grant select on public.v_items_list to anon, authenticated;

-- 7) bulk_update_items: แก้ไขหลายรายการพร้อมกัน (ลดราคา %, ตั้งราคาใหม่, ย้ายกลุ่ม, เปลี่ยนสถานะ, ที่เก็บ)
-- ห้ามแตะ Item ที่ status='sold' เพื่อไม่ให้ไปยุ่งกับ snapshot ต้นทุน ณ เวลาขาย
create or replace function public.bulk_update_items(
  p_ids uuid[],
  p_price_multiplier numeric default null, -- เช่น 0.9 = ลดราคา 10%
  p_new_price numeric default null,        -- ตั้งราคาใหม่ตรงๆ (ชนะ p_price_multiplier ถ้าใส่มาทั้งคู่)
  p_set_group boolean default false,
  p_group_id uuid default null,            -- ใช้ร่วมกับ p_set_group=true (null = ถอดออกจากกลุ่ม)
  p_status text default null,              -- 'available' หรือ 'damaged' เท่านั้น — ห้ามตั้ง 'sold' ผ่านทางนี้
  p_storage_location text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_status is not null and p_status not in ('available', 'damaged') then
    raise exception 'เปลี่ยนสถานะผ่าน Bulk Action ได้เฉพาะ พร้อมขาย/เสีย เท่านั้น';
  end if;

  update items set
    current_price = case
      when p_new_price is not null then greatest(p_new_price, 0)
      when p_price_multiplier is not null then greatest(round(current_price * p_price_multiplier, 0), 0)
      else current_price
    end,
    price_updated_at = case
      when p_new_price is not null or p_price_multiplier is not null then now()
      else price_updated_at
    end,
    group_id = case when p_set_group then p_group_id else group_id end,
    status = coalesce(p_status, status),
    storage_location = coalesce(p_storage_location, storage_location)
  where id = any(p_ids) and status <> 'sold';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) from public;
grant execute on function public.bulk_update_items(uuid[],numeric,numeric,boolean,uuid,text,text) to anon, authenticated;


-- V16: ต้นทุน Lot แยกส่วน + Break-even
-- 2) trigger: ถ้า Lot ใช้ต้นทุนแยกส่วนแล้ว (purchase_cost ไม่ null) ให้ total_cost คำนวณจากผลรวมเสมอ
-- Lot เก่าที่ purchase_cost ยัง null จะไม่โดนแตะ — total_cost ยังแก้ตรงๆ ได้แบบเดิมทุกอย่าง
create or replace function public.compute_lot_total_cost()
returns trigger
language plpgsql
as $$
begin
  if new.purchase_cost is not null then
    new.total_cost := coalesce(new.purchase_cost, 0) + coalesce(new.shipping_cost, 0)
      + coalesce(new.cleaning_cost, 0) + coalesce(new.repair_cost, 0) + coalesce(new.other_cost, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lots_compute_total_cost on lots;
create trigger trg_lots_compute_total_cost before insert or update on lots
  for each row execute function public.compute_lot_total_cost();

-- 3) lot_events: audit ของการ recost/ปิดล็อต ฯลฯ (ตอนนี้ใช้กับ recost_lot ก่อน)
create table if not exists lot_events (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_lot_events_lot on lot_events(lot_id, created_at desc);

alter table lot_events enable row level security;
drop policy if exists "allow all - lot_events" on lot_events;
create policy "allow all - lot_events" on lot_events for all using (true) with check (true);

-- 4) recost_lot: คำนวณต้นทุนเฉลี่ย/ชิ้นใหม่ แล้วอัปเดตเฉพาะสินค้าที่ "พร้อมขาย" (available)
-- ของที่ขายแล้วคง cost_price เดิมไว้เป็น snapshot ต้นทุน ณ วันขาย ไม่ถูกแก้ย้อนหลัง
create or replace function public.recost_lot(p_lot_id uuid, p_basis text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lot lots%rowtype;
  v_basis text;
  v_received int;
  v_listed int;
  v_basis_qty int;
  v_avg_cost numeric;
  v_updated int;
begin
  select * into v_lot from lots where id = p_lot_id for update;
  if not found then raise exception 'ไม่พบ Lot'; end if;

  v_basis := coalesce(p_basis, v_lot.cost_basis, 'received');
  if v_basis not in ('received', 'sellable') then raise exception 'cost_basis ต้องเป็น received หรือ sellable'; end if;

  select
    l.total_items,
    (count(i.id) filter (where i.status in ('available','sold')))::int
  into v_received, v_listed
  from lots l
  left join items i on i.lot_id = l.id
  where l.id = p_lot_id
  group by l.total_items;

  v_basis_qty := case when v_basis = 'sellable' then v_listed else v_received end;
  if coalesce(v_basis_qty, 0) <= 0 then raise exception 'จำนวนฐานคำนวณเป็น 0 — ยังคำนวณต้นทุนเฉลี่ยไม่ได้'; end if;

  v_avg_cost := round(v_lot.total_cost / v_basis_qty, 2);

  update items set cost_price = v_avg_cost, price_updated_at = now()
  where lot_id = p_lot_id and status = 'available';
  get diagnostics v_updated = row_count;

  update lots set cost_basis = v_basis where id = p_lot_id;

  insert into lot_events(lot_id, event_type, detail)
  values (p_lot_id, 'recost', jsonb_build_object(
    'basis', v_basis, 'basis_qty', v_basis_qty, 'avg_cost', v_avg_cost,
    'items_updated', v_updated, 'total_cost', v_lot.total_cost
  ));

  return jsonb_build_object('avg_cost', v_avg_cost, 'basis', v_basis, 'basis_qty', v_basis_qty, 'items_updated', v_updated);
end;
$$;

revoke all on function public.recost_lot(uuid,text) from public;
grant execute on function public.recost_lot(uuid,text) to anon, authenticated;


-- V17: Reports (group performance, source quality)
-- 1) get_group_performance: กำไร/อัตราขายของแต่ละกลุ่มราคา (งานหัว/ปกติ/ฯลฯ) ทุก Lot รวมกัน
create or replace function public.get_group_performance()
returns table (
  group_id uuid,
  group_name text,
  tier text,
  lot_id uuid,
  lot_name text,
  listed int,
  sold int,
  sell_through_pct numeric,
  revenue numeric,
  cost_sold numeric,
  profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id as group_id,
    g.group_name,
    g.tier,
    g.lot_id,
    l.lot_name,
    (count(i.id) filter (where i.status = 'sold' or (i.status = 'available' and i.intake_status = 'listed')))::int as listed, -- V17: ไม่นับ Item ที่ยังเป็น draft (รอรูป)
    (count(i.id) filter (where i.status = 'sold'))::int as sold,
    case when count(i.id) filter (where i.status = 'sold' or (i.status = 'available' and i.intake_status = 'listed')) > 0
      then round(100.0 * count(i.id) filter (where i.status = 'sold') / count(i.id) filter (where i.status = 'sold' or (i.status = 'available' and i.intake_status = 'listed')), 1)
      else 0 end as sell_through_pct,
    coalesce(sum(s.sale_price), 0)::numeric as revenue,
    coalesce(sum(s.cost_price), 0)::numeric as cost_sold,
    coalesce(sum(s.sale_price) - sum(s.cost_price), 0)::numeric as profit
  from lot_groups g
  join lots l on l.id = g.lot_id
  left join items i on i.group_id = g.id
  left join sales s on s.item_id = i.id and s.voided_at is null
  group by g.id, g.group_name, g.tier, g.lot_id, l.lot_name;
$$;

revoke all on function public.get_group_performance() from public;
grant execute on function public.get_group_performance() to anon, authenticated;

-- 2) get_source_quality: สรุปตามแหล่งรับของ (lots.source) — อัตราคัดออก/เสีย และกำไรต่อ Lot
create or replace function public.get_source_quality()
returns table (
  source text,
  lots_count int,
  total_received int,
  total_rejected int,
  total_damaged int,
  reject_rate_pct numeric,
  total_cost numeric,
  total_revenue numeric,
  total_profit numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with lot_sales as (
    select i.lot_id, sum(s.sale_price) as revenue, sum(s.cost_price) as cost_sold
    from sales s
    join items i on i.id = s.item_id
    where s.voided_at is null and i.lot_id is not null
    group by i.lot_id
  ),
  lot_damaged as (
    select lot_id, count(*) as damaged_items from items where status = 'damaged' and lot_id is not null group by lot_id
  )
  select
    coalesce(l.source, 'ไม่ระบุแหล่ง') as source,
    count(distinct l.id)::int as lots_count,
    coalesce(sum(l.total_items), 0)::int as total_received,
    coalesce(sum(l.rejected_qty), 0)::int as total_rejected,
    coalesce(sum(l.damaged_qty + coalesce(ld.damaged_items, 0)), 0)::int as total_damaged,
    case when sum(l.total_items) > 0
      then round(100.0 * sum(l.rejected_qty + l.damaged_qty + coalesce(ld.damaged_items, 0)) / sum(l.total_items), 1)
      else 0 end as reject_rate_pct,
    coalesce(sum(l.total_cost), 0)::numeric as total_cost,
    coalesce(sum(ls.revenue), 0)::numeric as total_revenue,
    coalesce(sum(ls.revenue) - sum(ls.cost_sold), 0)::numeric as total_profit
  from lots l
  left join lot_sales ls on ls.lot_id = l.id
  left join lot_damaged ld on ld.lot_id = l.id
  group by coalesce(l.source, 'ไม่ระบุแหล่ง')
  order by total_profit desc nulls last;
$$;

revoke all on function public.get_source_quality() from public;
grant execute on function public.get_source_quality() to anon, authenticated;
