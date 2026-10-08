# VIMS2 Lite — Security Review & Hardening

ตรวจโดยไล่ทั้งโปรเจกต์ (SQL ทุกไฟล์, JS ทุกไฟล์, HTML ทุกหน้า) แล้วแก้ในชุดนี้ และทดสอบ SQL บน PostgreSQL 16 จริง
(anon / คนล็อกอินที่ไม่ใช่เจ้าของ / เจ้าของ / อัปเกรดจากฐานเดิม)

## สรุปสั้น
สถาปัตยกรรม "HTML + Supabase โดยตรง" ใช้ได้ **ก็ต่อเมื่อ RLS ล็อกจริง** แต่ชุดเดิมตั้ง RLS เป็น `using (true)` ให้ anon
และ anon key อยู่ใน JS ที่ทุกคนเปิดดูได้ → **ใครก็ตามที่เปิดเว็บได้ อ่าน/แก้/ลบข้อมูลทั้งร้านได้** (ยอดขาย ต้นทุน กำไร)
ข้อนี้คือช่องโหว่หลัก ที่เหลือเป็นการเสริมชั้นป้องกัน

## ช่องโหว่ที่พบ และสิ่งที่แก้

| # | ความรุนแรง | พบอะไร | แก้อย่างไร |
|---|---|---|---|
| 1 | **Critical** | RLS ทุกตาราง `for all using (true)` ให้ anon → อ่าน/แก้/ลบได้ผ่าน REST ตรงๆ ด้วย anon key ที่เห็นใน JS | ใช้ Supabase Auth + RLS เฉพาะเจ้าของ (`app_admins` + `is_owner()`), ถอดสิทธิ์ anon ทั้ง schema |
| 2 | **Critical** | Storage bucket `item-images` เปิดให้ใครก็ได้ upload/แก้/ลบ ไม่จำกัดชนิดและขนาดไฟล์ | policy เฉพาะเจ้าของ + จำกัด 10 MB + เฉพาะ image/* |
| 3 | **High** | ทุก function เป็น `SECURITY DEFINER` และ `grant execute to anon` → เรียก `sell_item`, `void_sale`, `bulk_update_items`, `recost_lot` ได้โดยไม่ต้องล็อกอิน (ข้าม RLS) | เปลี่ยนเป็น `SECURITY INVOKER`, เหลือ execute เฉพาะ `authenticated` |
| 4 | **High** | `v_items_list` เป็น view ปกติ (ข้าม RLS) และ grant ให้ anon → ต่อให้แก้ RLS ตารางก็ยังรั่วผ่าน view | `security_invoker = true` + ถอด anon |
| 5 | **High** | หน้าแก้ไขสินค้าตั้งสถานะ "ขายแล้ว" ได้เอง → Item เป็น sold แต่ไม่มีแถวใน `sales` (ยอดขาย/กำไรหาย) | DB ปฏิเสธ + ซ่อนตัวเลือกใน UI |
| 6 | **Medium** | XSS (stored) ผ่านข้อความจาก DB ที่ไม่ได้ escape: `image_url` ใน `src`, label ช่องทางขาย/วิธีจ่าย, `error.message`, ชื่อ field ใน history | escape ทุกจุด + `safeImgUrl()` (รับเฉพาะ URL ของ bucket เรา) |
| 7 | **Medium** | ไม่มี CSP + โหลด JS จาก CDN โดยไม่มี SRI/pin เวอร์ชัน (`supabase-js@2`) | เก็บ supabase-js/chart.js/xlsx ไว้ใน `assets/vendor/` (pin เวอร์ชัน) + CSP `script-src 'self'` (ไม่มี inline script ในโปรเจกต์ จึงตั้งเข้มได้) |
| 8 | **Medium** | Upload ไม่ตรวจชนิดไฟล์; นามสกุลมาจากชื่อไฟล์ผู้ใช้ | whitelist MIME → นามสกุล, จำกัด 10 MB |
| 9 | **Low** | CSV export ไม่กัน Formula Injection (note ที่ขึ้นต้น `=`/`+`/`-`/`@` ถูก Excel รันเป็นสูตร) | `csvSafeText()` |
| 10 | **Low** | Excel import ไม่จำกัดความยาว/ช่วงราคา | จำกัดชื่อ 200, ไซส์ 30, ราคา 0–1,000,000 |
| 11 | **Low** | `clear_all_data.sql` (TRUNCATE ทุกตาราง) และ `reset_before_retry.sql` (DROP) วางปนกับ schema ปกติ | ย้ายไป `sql/danger/` |

## ไฟล์ที่เพิ่ม/แก้
- **ใหม่:** `sql/schema_part4_security.sql`, `login.html`, `assets/js/login.js`, `assets/js/security.js`, `assets/css/login.css`, `assets/vendor/*`, `_headers`, `docs/SECURITY.md`
- **แก้:** `sql/schema*.sql` (ไม่สร้าง policy เปิดโล่งอีก), `supabaseClient.js` (auth guard + signOut), `nav.js` (ปุ่มออกจากระบบ), `realtime.js` (เริ่มหลังล็อกอิน), `items.js`, `sell.js`, `reports.js`, `dashboard.js`, `accounting.js`, ทุกหน้า `.html`

## ขั้นตอน Deploy (ทำตามลำดับ — สำคัญ)
ทดสอบบน staging project ก่อน แล้วค่อยทำซ้ำบน production

1. **Backup ก่อน** (Dashboard > Database > Backups หรือ export CSV ของทุกตาราง)
2. Authentication > Users > **Add user** (อีเมล + รหัสผ่านยาว/ไม่ซ้ำกับที่อื่น)
3. Authentication > Sign In / Providers > **ปิด "Allow new users to sign up"**
4. SQL Editor: รัน `sql/schema_part4_security.sql`
5. รันครั้งเดียว (แก้อีเมล):
   ```sql
   insert into public.app_admins(user_id)
   select id from auth.users where email = 'YOUR_EMAIL@example.com'
   on conflict do nothing;
   ```
6. อัปโหลดไฟล์เว็บชุดใหม่ (ดูหัวข้อ "อะไรควร/ไม่ควรขึ้น hosting")
7. ทดสอบ: เปิดเว็บ → ต้องเด้งไป login → เข้าสู่ระบบ → ขาย/อัปโหลดรูปได้ปกติ
8. ทดสอบว่าคนนอกเข้าไม่ได้ (curl ท้ายไฟล์ `schema_part4_security.sql`) ต้องได้ 401 / permission denied / `[]`

> ระหว่างข้อ 4 ถึง 5 (ยังไม่ได้ insert เจ้าของ) แอปจะเข้าไม่ได้ชั่วคราว — เป็นเรื่องปกติ ทำข้อ 5 ต่อทันที

## อะไรควร/ไม่ควรขึ้น hosting
- **ขึ้นได้:** `*.html`, `assets/`, `_headers`
- **ไม่ควรขึ้น:** `sql/`, `docs/`, `README.md` (เปิดเผย schema/โครงสร้างระบบให้คนนอก — ไม่ใช่ความลับ แต่ไม่มีประโยชน์ที่จะเปิด)
- ถ้าใช้ **GitHub Pages** ระบบจะเสิร์ฟทั้ง repo → แนะนำให้แยก repo เว็บ (เฉพาะไฟล์ที่ขึ้นได้) ออกจาก repo ที่เก็บ sql/docs หรือทำ repo เป็น private แล้ว deploy ผ่าน Cloudflare Pages / Netlify
- `_headers` ใช้ได้กับ Cloudflare Pages / Netlify (ตั้ง `frame-ancestors`, HSTS ฯลฯ ที่ meta tag ทำไม่ได้). GitHub Pages ไม่รองรับไฟล์นี้ — CSP แบบ meta ในแต่ละหน้ายังทำงานอยู่

## ความเสี่ยงที่ยังเหลือ (ยอมรับได้สำหรับร้านเดียว แต่ควรรู้)
1. **ข้อมูลที่เคยเปิดโล่งอาจถูกเข้าถึงแล้ว** — ถ้า URL เว็บหรือ repo เคยเป็น public ให้ดู Dashboard > Logs (API / Storage) ว่ามี request แปลกๆ ไหม และเปลี่ยนรหัสผ่านที่เกี่ยวข้อง. anon key เปลี่ยนไม่ได้ง่ายๆ (ต้อง rotate JWT secret) แต่หลังล็อก RLS แล้ว key เก่า **ไม่มีผลอีก**
2. **SheetJS `xlsx@0.18.5`** (เวอร์ชันสุดท้ายบน npm) มีช่องโหว่ที่รู้จัก (Prototype Pollution CVE-2023-30533, ReDoS CVE-2024-22363) — แก้แล้วใน 0.20.x ที่แจกจาก cdn.sheetjs.com เท่านั้น. ความเสี่ยงเกิดเมื่อ import ไฟล์ Excel ที่ไม่น่าเชื่อถือ → **import เฉพาะไฟล์ที่ทำเอง/มาจากแหล่งที่ไว้ใจ** และควรอัปเกรดไป 0.20.x (โหลด tgz จาก cdn.sheetjs.com มาไว้ใน `assets/vendor/` แทนไฟล์เดิม)
3. **ยังไม่มี MFA** — เปิด TOTP ให้บัญชีเจ้าของได้ใน Supabase (Authentication > MFA) ควรเปิดเพราะข้อมูลการเงินทั้งหมดผูกกับบัญชีเดียว
4. Google Fonts ยังโหลดจากภายนอก (CSP อนุญาตเฉพาะโดเมนของ Google) — ถ้าต้องการปิดสนิท ให้ดาวน์โหลดฟอนต์มาไว้ใน `assets/`
5. Auth guard ฝั่ง browser เป็นแค่ความสะดวก ตัวป้องกันจริงคือ RLS — อย่าลบหรือผ่อน `schema_part4_security.sql`
6. ไม่มี audit log ระดับ DB สำหรับ DELETE/UPDATE ทั่วไป (มีเฉพาะประวัติแก้ไข Item และ `lot_events`) — พิจารณาเพิ่มเมื่อธุรกิจโตขึ้น

## เรื่องที่ต้องระวังเมื่อเพิ่มฟีเจอร์ Facebook Live CF / Edge Functions
- **Page Access Token, App Secret, service_role key ต้องอยู่ใน Edge Function secrets เท่านั้น** — ห้ามใส่ใน JS, ห้ามเก็บใน `app_settings` (browser อ่านได้)
- Webhook ต้องตรวจ `X-Hub-Signature-256` (HMAC ด้วย App Secret) ก่อนประมวลผลทุกครั้ง และตรวจ verify token ตอน subscribe
- Edge Function ที่ใช้ service_role ข้าม RLS ได้ → ตรวจ input ให้เข้มเอง และให้ทำงานเฉพาะ logic ที่จำเป็น (เช่น RPC เดียวที่ atomic)
- ตารางใหม่ (`live_sessions`, `live_comments`, `live_claims`, `notifications`) ต้องเปิด RLS + policy แบบ owner-only (`(select public.is_owner())`) เหมือนตารางเดิม และ function ใหม่ให้ใช้ `security invoker` เว้นแต่จำเป็นจริง
