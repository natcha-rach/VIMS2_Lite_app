
## Lot Financial Performance Update
- เพิ่มสรุปสะสมราย Lot ใน Dashboard, Reports และ Accounting
- แสดงทุนทั้งหมด, จำนวนทั้งหมด, ขายแล้ว, เหลือ, ยอดขายสะสม, ต้นทุนที่ขาย, ทุนคงเหลือ, กำไร และ % คืนทุน
- คำนวณทุนคงเหลือจาก `lots.total_cost - SUM(sales.cost_price)` และกำไรจาก `ยอดขาย - ต้นทุนที่ขาย`
- ตาราง Performance ตาม Lot ไม่ขึ้นกับช่วงเวลาที่เลือก เพื่อให้ติดตามสถานะของกระสอบได้ตลอดอายุ
# V10.1 Changelog

## Added
- Supabase Realtime สำหรับ 4 devices
- Online / Offline / Syncing indicator
- Realtime refresh ของ Items, Lots, Sell, Dashboard, Accounting, Reports
- Bulk Draft/Resume สำหรับข้อมูลตาราง
- iPad Pro 13" responsive tuning (portrait/landscape)
- Detailed code comments / data-flow documentation
- Safe realtime migration that checks table existence

## Fixed
- `sell.js` sale history ใช้ `sales.sale_date` แทน `sold_at`
- Dashboard cache ถูก invalidate เมื่อข้อมูลจาก device อื่นเปลี่ยน

## Preserved
- `lot_groups`
- `item_images`
- `item_change_history`
- Atomic `sell_item()`
- Bulk 200 / Photo Queue / Excel Import


## V10.1.1 Safety Fixes

- Fixed duplicated Realtime listener registration in `sell.js`.
- Fixed immediate stock refresh after a successful sale.
- Failed single-item image upload now rolls back the just-created Item.
- Failed Bulk image upload now cleans up uploaded Storage files and rolls back the inserted Items.
- Preserved the existing V10 schema and the already-applied Realtime migration.

## V10.1 NEXT — Bulk 200 workflow refinement

- Removed an accidental startup `clearBulkDraft()` call so Bulk Draft can actually be resumed after refresh.
- Added Photo Queue pairing modes:
  - 1 image / item — sequential filename order.
  - 2 images / item — pairs 1-2, 3-4, 5-6, ...
  - Mixed 1/2 images — manual secondary-image assignment.
- Bulk and single-item inserts now generate UUIDs in the browser before insert, making row-to-item mapping deterministic for bulk photo upload and cleanup.
- Quick Entry now rolls back the newly created Item if its image upload fails.
## V10.1.1 — Realtime & Mobile UI Fix

- รวม Supabase Realtime เป็น channel กลางเดียวต่อ browser tab เพื่อป้องกัน subscription ซ้ำระหว่าง `supabaseClient.js` และ `realtime.js`
- เพิ่ม refresh fallback เมื่อกลับมาที่ tab/page, focus, `pageshow` หรือกลับมา online เพื่อให้ Sell / Reports / Accounting เห็นข้อมูลล่าสุดแม้ browser หยุด WebSocket ชั่วคราว
- เพิ่ม reconnect เมื่อ Realtime channel timeout/error/closed
- ทำให้ Dashboard / Lots / Items รองรับ `page_refresh` แบบเดียวกัน
- แก้ mobile `input[type="date"]` หน้า Lot ไม่ให้ native date control ล้นพื้นที่ field
- ไม่ต้องเพิ่ม migration ใหม่ และไม่เปลี่ยน schema


## V10.1.2 — Review fixes (code review pass)

- `accounting.js`: added missing `escapeHtml()` and applied it to expense category/note and ledger descriptions (previously inserted into innerHTML unescaped; CSV export still uses raw text).
- `reports.js`: escaped `lot_name` in the lot breakdown table (was unescaped).
- Added `fetchAllRows()` helper in `supabaseClient.js` that paginates with `.range()`; applied to every `items`/`sales` (and related) query in `dashboard.js`, `lots.js`, `accounting.js`, `reports.js`, `items.js` so totals stop silently truncating once a table passes Supabase's 1000-row default limit.
- `lots.html`/`lots.js`: removed the manual "ลำดับการแสดงผล" field from the group form. New groups now auto-append to the end (`max(sort_order) + 1`); editing a group keeps its existing order.
- `items.html`/`items.js`: the single-item "ต้นทุน/ชิ้น" field now auto-fills from the lot's average cost when a lot is selected (still editable), matching the Bulk/Quick Entry behavior described in the README.
- `sell.html`/`sell.js`/`sell.css`: added "พร้อมขาย" / "ขายแล้ว" tabs on the Sell page. The sold tab shows the latest 300 sales (with search) and reuses the existing item detail modal in read-only mode (no sell button).

Known accepted risk: RLS remains fully open (`using (true)`) — intentional single-user setup, no login added per request. Keep the GitHub repo private and rotate the Supabase anon key if it was ever exposed publicly.

## V10.1.3 — Bulk-intake UX review

Reviewed the "รับเป็นกอง" flow for a 200-piece sack use case. Finding: the system already had a fast path (Photo Queue → Bulk Table: select all photos at once, auto-paired, then a spreadsheet-style table with Enter-to-next-row, paste-from-Excel, fill-down, one batch save) — but the group-row buttons had it backwards, styling the slow one-by-one Quick Entry as the primary (`btn-primary`) action and the fast table path as the secondary ghost button.

- `items.js` `renderGroups()`: swapped button styles/labels — "⚡ ถ่ายรูปแล้วลงทั้งกอง" (Photo Queue → Bulk Table) is now primary; "ลงทีละชิ้น" (old Quick Entry) is now the secondary option for small quantities.
- `items.html`: rewrote the Step 1 callouts to explain when to use which path (large sack → fast table path; 2–3 items → one-by-one; already have an Excel list → Import Excel), and fixed the modal subtitle which previously implied one-by-one was the only/default method.

Naming: still using "รับเป็นกอง" for the overall feature — pending a better name from the shop owner.

## V10.1.4 — Renamed bulk-intake menu

"รับเป็นกอง" → **"ลงสินค้าหลายชิ้น"** (chosen by the shop owner). Updated the open-modal button, modal header, and page subtitle in `items.html` to match; internal ids/functions (`openBulk`, `bulkModal`, etc.) left as-is since renaming those has no user-facing effect.
