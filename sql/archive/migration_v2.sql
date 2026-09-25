-- รันหลัง schema เดิม หากมีข้อมูลเดิมอยู่แล้ว

-- 1) เปลี่ยน status in_stock -> available
create table if not exists lot_groups (
  id uuid primary key default gen_random_uuid(), lot_id uuid not null references lots(id) on delete cascade,
  group_name text not null, base_price numeric(12,2) not null default 0,
  tier text not null default 'normal', sort_order int not null default 0, created_at timestamptz not null default now()
);

alter table items drop constraint if exists items_status_check;
update items set status='available' where status='in_stock';
alter table items add constraint items_status_check check (status in ('available','sold','damaged'));

-- 2) เพิ่มฟิลด์ใหม่
alter table items add column if not exists group_id uuid references lot_groups(id) on delete set null;
alter table items add column if not exists tier text not null default 'normal';
alter table items add column if not exists base_price numeric(12,2) not null default 0;
alter table items add column if not exists current_price numeric(12,2) not null default 0;
alter table items add column if not exists sold_at timestamptz;
alter table items drop constraint if exists items_condition_check;
alter table items add constraint items_condition_check check (condition in ('A','B'));
alter table items add constraint items_tier_check check (tier in ('normal','head'));
update items set base_price=sell_price where base_price=0;
update items set current_price=sell_price where current_price=0;

create table if not exists item_images (
  id uuid primary key default gen_random_uuid(), item_id uuid not null references items(id) on delete cascade,
  image_url text not null, storage_path text, sort_order int not null default 1 check(sort_order in(1,2)), created_at timestamptz not null default now(), unique(item_id,sort_order)
);
create index if not exists idx_lot_groups_lot on lot_groups(lot_id);
create index if not exists idx_items_group on items(group_id);
create index if not exists idx_item_images_item on item_images(item_id);

insert into storage.buckets(id,name,public) values('item-images','item-images',true) on conflict(id) do update set public=true;

alter table lot_groups enable row level security; alter table item_images enable row level security;
drop policy if exists "allow all - lot_groups" on lot_groups; create policy "allow all - lot_groups" on lot_groups for all using(true) with check(true);
drop policy if exists "allow all - item_images" on item_images; create policy "allow all - item_images" on item_images for all using(true) with check(true);
drop policy if exists "public read item images" on storage.objects; create policy "public read item images" on storage.objects for select using(bucket_id='item-images');
drop policy if exists "public upload item images" on storage.objects; create policy "public upload item images" on storage.objects for insert with check(bucket_id='item-images');
drop policy if exists "public update item images" on storage.objects; create policy "public update item images" on storage.objects for update using(bucket_id='item-images') with check(bucket_id='item-images');
drop policy if exists "public delete item images" on storage.objects; create policy "public delete item images" on storage.objects for delete using(bucket_id='item-images');

create or replace function public.sell_item(p_item_id uuid,p_sale_price numeric,p_payment_method text,p_channel text default 'street_market',p_note text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_item items%rowtype; v_sale sales%rowtype;
begin
 select * into v_item from items where id=p_item_id for update;
 if not found then raise exception 'ไม่พบสินค้า'; end if;
 if v_item.status<>'available' then raise exception 'สินค้านี้ไม่ได้อยู่ในสต็อก'; end if;
 insert into sales(item_id,sale_price,cost_price,payment_method,channel,note) values(p_item_id,p_sale_price,v_item.cost_price,p_payment_method,p_channel,p_note) returning * into v_sale;
 update items set status='sold',sold_at=now() where id=p_item_id;
 return jsonb_build_object('sale_id',v_sale.id,'item_id',p_item_id);
end;$$;
revoke all on function public.sell_item(uuid,numeric,text,text,text) from public;
grant execute on function public.sell_item(uuid,numeric,text,text,text) to anon,authenticated;
