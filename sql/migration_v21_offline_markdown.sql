-- ============================================================================
-- VIMS2 Lite — migration V21 (รันซ้ำได้)
-- รันใน Supabase → SQL Editor หลัง migration_v19_pos_shift.sql
--
--   1) sell_bill รับ p_sold_at   ← บิลที่ขายตอนเน็ตหลุด (offline.js) ส่งทีหลังแต่เวลาขายถูกต้อง
--   2) markdown_items            ← ลดราคาของค้างหลายชิ้นพร้อมกัน + เก็บประวัติราคา
--   3) item_images.full_removed_at ← จดว่าลบรูปเต็มแล้ว เหลือแค่รูปย่อ (ประหยัด Storage ฟรี 1 GB)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) sell_bill + p_sold_at
--    ต้อง drop ตัวเดิม (7 พารามิเตอร์) ก่อน ไม่งั้นจะมี 2 ตัวชื่อซ้ำ แล้ว PostgREST เลือกไม่ถูก
--    หน้าเว็บเก่าที่ยัง cache อยู่ (ส่ง 7 ค่า) ยังเรียกได้ เพราะ p_sold_at มีค่า default
--    รอบร้าน: ผูกกับรอบที่เปิดอยู่ "ถ้าเปิดก่อนเวลาขาย" — ถ้ารอบนั้นปิดไปแล้ว บิลไม่ผูกรอบ
--    (ตัวเลขปิดร้านต้องไม่เปลี่ยนย้อนหลัง · shift.js กันปิดร้านถ้ายังมีบิลค้างส่งในเครื่อง)
-- ---------------------------------------------------------------------------
drop function if exists public.sell_bill(uuid, jsonb, text, text, numeric, text, boolean);

create or replace function public.sell_bill(
  p_bill_id uuid,
  p_lines jsonb,
  p_payment_method text,
  p_channel text default 'street_market',
  p_cash_received numeric default null,
  p_note text default null,
  p_sell_reserved boolean default false,
  p_sold_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bill bills%rowtype;
  v_shift uuid;
  v_line jsonb;
  v_item items%rowtype;
  v_price numeric;
  v_total numeric := 0;
  v_list numeric := 0;
  v_at timestamptz;
begin
  if p_bill_id is null then raise exception 'ไม่มีเลขบิล'; end if;

  -- idempotent: ส่งซ้ำด้วย id เดิม → คืนบิลเดิม
  select * into v_bill from bills where id = p_bill_id;
  if found then
    return jsonb_build_object('bill_id', v_bill.id, 'bill_no', v_bill.bill_no, 'total', v_bill.total,
                              'list_total', v_bill.list_total, 'shift_id', v_bill.shift_id, 'duplicate', true);
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ตะกร้าว่าง';
  end if;
  if p_payment_method not in ('cash','transfer','government') then raise exception 'วิธีจ่ายเงินไม่ถูกต้อง'; end if;
  if (select count(distinct l->>'item_id') from jsonb_array_elements(p_lines) l) <> jsonb_array_length(p_lines) then
    raise exception 'มีสินค้าซ้ำในบิล';
  end if;

  -- เวลาขาย: ไม่ส่งมา = ตอนนี้ · ห้ามเป็นอนาคต (นาฬิกามือถือเพี้ยน) · ย้อนได้ไม่เกิน 7 วัน
  v_at := least(coalesce(p_sold_at, now()), now());
  if v_at < now() - interval '7 days' then raise exception 'บิลค้างส่งเกิน 7 วัน — ตรวจสอบแล้วลงขายใหม่ด้วยมือ'; end if;

  select id into v_shift from shifts where closed_at is null and opened_at <= v_at limit 1;

  insert into bills(id, shift_id, channel, payment_method, cash_received, note, created_at)
  values (p_bill_id, v_shift, coalesce(p_channel, 'street_market'), p_payment_method, p_cash_received, p_note, v_at)
  returning * into v_bill;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from items where id = (v_line->>'item_id')::uuid for update;
    if not found then raise exception 'ไม่พบสินค้าในบิล'; end if;
    if v_item.status <> 'available' then raise exception '"%" ไม่ได้อยู่ในสต็อกแล้ว', v_item.item_name; end if;
    if v_item.intake_status <> 'listed' then raise exception '"%" ยังลงไม่ครบ (รอรูป)', v_item.item_name; end if;

    v_price := round((v_line->>'price')::numeric, 2);
    if v_price is null or v_price < 0 then raise exception 'ราคาของ "%" ไม่ถูกต้อง', v_item.item_name; end if;

    if exists (select 1 from reservations where item_id = v_item.id and status = 'active') then
      if not p_sell_reserved then raise exception '"%" ถูกจองไว้แล้ว', v_item.item_name; end if;
      update reservations set status = 'sold', bill_id = p_bill_id, closed_at = v_at
       where item_id = v_item.id and status = 'active';
    end if;

    insert into sales(item_id, bill_id, sale_date, sale_price, list_price, cost_price, payment_method, channel, note)
    values (v_item.id, p_bill_id, v_at, v_price, v_item.current_price, v_item.cost_price, p_payment_method,
            coalesce(p_channel, 'street_market'), p_note);
    update items set status = 'sold', sold_at = v_at where id = v_item.id;

    v_total := v_total + v_price;
    v_list := v_list + v_item.current_price;
  end loop;

  if p_payment_method = 'cash' and p_cash_received is not null and p_cash_received < v_total then
    raise exception 'รับเงินน้อยกว่ายอดบิล';
  end if;

  update bills set total = v_total, list_total = v_list where id = p_bill_id returning * into v_bill;
  return jsonb_build_object('bill_id', v_bill.id, 'bill_no', v_bill.bill_no, 'total', v_total,
                            'list_total', v_list, 'shift_id', v_shift, 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) markdown_items — ลดราคาของค้างทีละหลายชิ้น (หน้า สต็อก → การ์ด "ของค้าง")
--    p_percent = ลดกี่ % จากราคาปัจจุบัน หรือ p_price = ตั้งราคาใหม่ตรงๆ (ใส่อย่างใดอย่างหนึ่ง)
--    ปัดเป็นบาทเต็ม · ข้ามชิ้นที่ไม่ใช่ available · เก็บประวัติใน item_change_history แบบเดียวกับหน้าแก้สินค้า
-- ---------------------------------------------------------------------------
create or replace function public.markdown_items(
  p_item_ids uuid[],
  p_percent numeric default null,
  p_price numeric default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item items%rowtype;
  v_new numeric;
  v_count int := 0;
  v_before numeric := 0;
  v_after numeric := 0;
begin
  if (p_percent is null) = (p_price is null) then raise exception 'เลือกอย่างใดอย่างหนึ่ง: ลด %% หรือ ตั้งราคาใหม่'; end if;
  if p_percent is not null and (p_percent <= 0 or p_percent >= 100) then raise exception 'เปอร์เซ็นต์ต้องอยู่ระหว่าง 1–99'; end if;
  if p_price is not null and p_price < 0 then raise exception 'ราคาใหม่ไม่ถูกต้อง'; end if;
  if coalesce(array_length(p_item_ids, 1), 0) = 0 then raise exception 'ยังไม่ได้เลือกสินค้า'; end if;

  for v_item in select * from items where id = any(p_item_ids) and status = 'available' for update loop
    v_new := case when p_price is not null then round(p_price) else round(v_item.current_price * (100 - p_percent) / 100) end;
    if v_new = v_item.current_price then continue; end if;
    update items set current_price = v_new, price_updated_at = now() where id = v_item.id;
    insert into item_change_history(item_id, action, changed_fields)
    values (v_item.id, 'update', jsonb_build_object(
      'current_price', jsonb_build_object('old', v_item.current_price, 'new', v_new),
      'reason', coalesce(nullif(trim(p_reason), ''), 'ลดราคาของค้าง')));
    v_count := v_count + 1;
    v_before := v_before + v_item.current_price;
    v_after := v_after + v_new;
  end loop;

  return jsonb_build_object('updated', v_count, 'before_total', v_before, 'after_total', v_after);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) รูปเต็มที่ลบแล้ว (เหลือรูปย่อ) — storage.js ลบไฟล์ใน Storage แล้วจดเวลาไว้ที่นี่
-- ---------------------------------------------------------------------------
alter table item_images add column if not exists full_removed_at timestamptz;

-- สิทธิ์เรียก RPC
do $$
declare f text;
begin
  foreach f in array array[
    'sell_bill(uuid,jsonb,text,text,numeric,text,boolean,timestamptz)',
    'markdown_items(uuid[],numeric,numeric,text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ให้ PostgREST เห็นฟังก์ชันใหม่ทันที
notify pgrst, 'reload schema';
