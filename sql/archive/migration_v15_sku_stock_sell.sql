-- ==========================================================
-- VIMS2 Lite V15 — SKU, Entry modes (draft→listed), Stock filters, Bulk actions, Void sale
-- รันหลัง migration_v14 (ต้องมี lots.status ก่อน) บน Supabase SQL Editor แล้วค่อย deploy ไฟล์ JS ชุด V15
-- รันซ้ำได้ (idempotent) และไม่ลบ/ไม่แก้ข้อมูลเดิม
-- ==========================================================

-- 1) lots: lot_code (สำหรับสร้าง SKU) + item_seq (ตัวนับรันตัวเลขต่อ Lot) ------------
alter table lots add column if not exists lot_code text;
alter table lots add column if not exists item_seq int not null default 0;
create unique index if not exists idx_lots_lot_code on lots(lot_code) where lot_code is not null;

-- 2) items: SKU + entry-mode fields ------------------------------------------------
-- intake_status: 'draft' = Bulk save เฟสแรก (insert แล้วแต่รูปยังอัปโหลดไม่ครบ) ไม่นับเป็นสต็อกขายได้
--                'listed' = ลงครบแล้ว แสดงใน Stock/Sell/Reports ตามปกติ (ค่า default เพื่อไม่กระทบ Item เดิม)
alter table items add column if not exists sku text;
alter table items add column if not exists item_type text;
alter table items add column if not exists storage_location text;
alter table items add column if not exists intake_status text not null default 'listed';
alter table items add column if not exists listed_at timestamptz;
alter table items add column if not exists price_updated_at timestamptz;

alter table items drop constraint if exists items_intake_status_check;
alter table items add constraint items_intake_status_check check (intake_status in ('draft', 'listed'));

-- backfill listed_at ของ Item เดิมด้วย created_at เพื่อให้ Stock aging ใช้ listed_at ได้ทันที
update items set listed_at = created_at where listed_at is null and intake_status = 'listed';

create unique index if not exists idx_items_sku on items(sku) where sku is not null;
create index if not exists idx_items_intake_status on items(intake_status);

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

-- 8) แก้ get_lot_summary / get_lot_performance ให้ไม่นับรายการขายที่ถูก void_sale ยกเลิกแล้ว
-- (ต้องรันหลังข้อ 5 ที่เพิ่มคอลัมน์ sales.voided_at ในไฟล์นี้)
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
    where i.lot_id is not null and s.voided_at is null and (p_lot_id is null or i.lot_id = p_lot_id) -- V15
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

-- 9) get_lot_summary / get_group_progress: Item ที่ยังเป็น intake_status='draft'
-- (อยู่ระหว่าง Bulk save เฟสอัปโหลดรูป — ดู items.js saveBulkTable) ยังไม่นับเป็น "ลงแล้ว"
-- จะถูกนับเมื่อ flip เป็น 'listed' หลังอัปโหลดรูปสำเร็จเท่านั้น (แก้ไขเป็นวินาทีหลังบันทึก ไม่ใช่ค้างถาวร)
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
