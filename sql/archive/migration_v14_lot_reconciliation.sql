-- ==========================================================
-- VIMS2 Lite V14 — Lot status + Reconciliation
-- รันครั้งเดียวบนฐานข้อมูลเดิม (V13) ใน Supabase SQL Editor แล้วค่อย deploy ไฟล์ JS ชุด V14
-- รันซ้ำได้ (idempotent) และ "ไม่แก้/ไม่ลบ" ข้อมูลเดิม:
--   * lots       : + status, rejected_qty, damaged_qty, closed_at
--   * lot_groups : + target_qty
--   * ฟังก์ชันใหม่ get_lot_summary(), get_group_progress()
-- ฟังก์ชันเดิม (sell_item, update_item_with_history, get_lot_performance) ไม่ถูกแตะ
-- ==========================================================

-- 1) lots ---------------------------------------------------
-- เพิ่มคอลัมน์ด้วย default 'sorting' เพื่อให้ Lot เดิมทุกอันเริ่มที่ "กำลังคัด"
-- แล้วค่อยเปลี่ยน default เป็น 'receiving' สำหรับ Lot ที่สร้างใหม่หลังจากนี้
alter table lots add column if not exists status text not null default 'sorting';
alter table lots add column if not exists rejected_qty int not null default 0;
alter table lots add column if not exists damaged_qty int not null default 0;
alter table lots add column if not exists closed_at timestamptz;

alter table lots alter column status set default 'receiving';

alter table lots drop constraint if exists lots_status_check;
alter table lots add constraint lots_status_check
  check (status in ('receiving','sorting','ready','closed'));
alter table lots drop constraint if exists lots_rejected_qty_check;
alter table lots add constraint lots_rejected_qty_check check (rejected_qty >= 0);
alter table lots drop constraint if exists lots_damaged_qty_check;
alter table lots add constraint lots_damaged_qty_check check (damaged_qty >= 0);

create index if not exists idx_lots_status on lots(status);

-- 2) lot_groups ---------------------------------------------
-- target_qty = เป้าหมายจำนวนชิ้นของกลุ่ม (ไม่บังคับ) — จำนวนที่ลงจริงคำนวณจาก items เสมอ ไม่เก็บซ้ำ
alter table lot_groups add column if not exists target_qty int;
alter table lot_groups drop constraint if exists lot_groups_target_qty_check;
alter table lot_groups add constraint lot_groups_target_qty_check
  check (target_qty is null or target_qty >= 0);

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
