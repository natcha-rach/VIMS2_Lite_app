-- V13: get_lot_performance() RPC
-- รันไฟล์นี้ใน Supabase SQL Editor ถ้าฐานข้อมูลเดิมถูกสร้างจาก schema.sql เวอร์ชันก่อนหน้า
-- ไม่ต้อง migrate ตาราง — เพิ่มแค่ function ใหม่ ใช้กับ Lot Performance ในหน้า Dashboard/Reports


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
    group by i.lot_id
  ) s on s.lot_id = l.id
  order by coalesce(s.revenue, 0) desc, l.purchase_date desc;
$$;

revoke all on function public.get_lot_performance() from public;
grant execute on function public.get_lot_performance() to anon, authenticated;
