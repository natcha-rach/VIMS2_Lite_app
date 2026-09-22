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
