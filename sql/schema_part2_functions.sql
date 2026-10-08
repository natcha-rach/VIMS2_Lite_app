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
