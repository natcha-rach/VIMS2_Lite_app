-- VIMS2 Lite v8: Sale Detail / Item Sale Workflow
-- UI ใช้ข้อมูล items + item_images + sales โดยตรง
-- การตัดสต็อกยังใช้ RPC sell_item เดิม เพื่อให้ INSERT sales + UPDATE items เป็น transaction เดียว

-- ดัชนีช่วยให้หน้า Sell โหลดประวัติการขายของ Item ได้เร็วขึ้น
create index if not exists idx_sales_item_sold_at on sales(item_id, sold_at desc);
create index if not exists idx_item_images_item_sort on item_images(item_id, sort_order);

-- ป้องกันไม่ให้ Item เดียวกันมีรูปเกิน 2 รูปในระดับฐานข้อมูล
-- หมายเหตุ: policy เดิมยังคงใช้ได้; constraint นี้ช่วยกันข้อมูลผิดจาก import/manual SQL
create or replace function public.enforce_item_image_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count from item_images where item_id = new.item_id;
  if v_count >= 2 then
    raise exception 'สินค้าหนึ่งตัวมีรูปได้สูงสุด 2 รูป';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_item_image_limit on item_images;
create trigger trg_item_image_limit
before insert on item_images
for each row execute function public.enforce_item_image_limit();
