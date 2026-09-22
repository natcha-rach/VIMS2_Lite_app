-- ==========================================================
-- VIMS2 Lite V16 — แยกต้นทุน Lot + Cost basis + Break-even
-- รันหลัง migration_v14/v15 — idempotent, ไม่กระทบ Lot ที่ยังใช้ total_cost แบบเดิม
-- ==========================================================

-- 1) lots: ต้นทุนแยกส่วน (ไม่บังคับ) — ถ้าไม่ตั้ง purchase_cost, total_cost ทำงานแบบเดิมทุกอย่าง
alter table lots add column if not exists purchase_cost numeric(12,2);
alter table lots add column if not exists shipping_cost numeric(12,2) not null default 0;
alter table lots add column if not exists cleaning_cost numeric(12,2) not null default 0;
alter table lots add column if not exists repair_cost numeric(12,2) not null default 0;
alter table lots add column if not exists other_cost numeric(12,2) not null default 0;
-- cost_basis: ฐานคำนวณต้นทุนเฉลี่ย/ชิ้น — received = รับเข้าทั้งหมด, sellable = ผ่านคัดแล้ว (ลงแล้ว)
alter table lots add column if not exists cost_basis text not null default 'received';
alter table lots drop constraint if exists lots_cost_basis_check;
alter table lots add constraint lots_cost_basis_check check (cost_basis in ('received', 'sellable'));
alter table lots drop constraint if exists lots_purchase_cost_check;
alter table lots add constraint lots_purchase_cost_check check (purchase_cost is null or purchase_cost >= 0);
alter table lots drop constraint if exists lots_shipping_cost_check;
alter table lots add constraint lots_shipping_cost_check check (shipping_cost >= 0);
alter table lots drop constraint if exists lots_cleaning_cost_check;
alter table lots add constraint lots_cleaning_cost_check check (cleaning_cost >= 0);
alter table lots drop constraint if exists lots_repair_cost_check;
alter table lots add constraint lots_repair_cost_check check (repair_cost >= 0);
alter table lots drop constraint if exists lots_other_cost_check;
alter table lots add constraint lots_other_cost_check check (other_cost >= 0);

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
