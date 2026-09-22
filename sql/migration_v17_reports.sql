-- ==========================================================
-- VIMS2 Lite V17 — Reports: ประสิทธิภาพตามกลุ่มราคา + คุณภาพแหล่งรับของ
-- รันหลัง migration_v14 (ต้องมี lots.status) — idempotent
-- ==========================================================

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
