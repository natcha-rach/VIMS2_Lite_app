-- ==========================================================
-- Migration: เพิ่มตาราง app_settings (สำหรับระบบแบ่งถังเงินในหน้าบัญชี)
-- ใช้เฉพาะกรณีเคยรัน schema.sql ไปแล้วรอบนึง
-- ถ้าเพิ่งเริ่มติดตั้งใหม่ ให้รัน schema.sql ทั้งไฟล์แทน ไม่ต้องรันไฟล์นี้
-- วิธีใช้: SQL Editor -> วางไฟล์นี้ -> Run
-- ==========================================================

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

drop policy if exists "allow all - app_settings" on app_settings;
create policy "allow all - app_settings" on app_settings for all using (true) with check (true);
