-- VIMS2 Lite v3: Dashboard / Lot management support
-- ไม่มีการเปลี่ยนโครงสร้างหลักของข้อมูล ถ้ารัน schema_v2 แล้วสามารถรันไฟล์นี้ได้เลย

create index if not exists idx_items_created_at on items(created_at);
create index if not exists idx_items_tier on items(tier);
create index if not exists idx_sales_channel on sales(channel);
create index if not exists idx_sales_payment_method on sales(payment_method);

-- ค่าเริ่มต้นช่องทางขาย/รับเงิน เผื่อฐานเดิมยังไม่มี settings
insert into app_settings(key, value)
values
  ('sale_channels', '[{"value":"street_market","label":"ถนนคนเดิน"},{"value":"facebook","label":"Facebook"},{"value":"instagram","label":"Instagram"}]'::jsonb),
  ('payment_methods', '[{"value":"cash","label":"เงินสด"},{"value":"transfer","label":"โอน"},{"value":"government","label":"โครงการรัฐ"}]'::jsonb),
  ('price_presets', '{"normal":{"multiple":3},"head":{"multiple":6}}'::jsonb)
on conflict (key) do nothing;
