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
