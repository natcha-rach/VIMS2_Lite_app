-- ==========================================================
-- Migration: เพิ่มตาราง expenses (สำหรับคนที่รัน schema.sql ไปแล้วรอบนึง)
-- ถ้าเพิ่งเริ่มติดตั้งใหม่ ให้รัน schema.sql ทั้งไฟล์แทน ไม่ต้องรันไฟล์นี้
-- วิธีใช้: SQL Editor -> วางไฟล์นี้ -> Run
-- ==========================================================

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  amount numeric(10,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_date on expenses(expense_date);

alter table expenses enable row level security;

-- ป้องกัน error กรณีเคยสร้าง policy นี้ไว้แล้ว
drop policy if exists "allow all - expenses" on expenses;
create policy "allow all - expenses" on expenses for all using (true) with check (true);
