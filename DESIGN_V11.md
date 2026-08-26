# VIMS2 Lite V11 — Dashboard X UI Redesign

## Design direction

A dark admin dashboard inspired by the supplied Dashboard X reference:

- Deep navy workspace and sidebar
- Electric violet as primary action/accent
- Cyan for secondary analytics
- Green for profit / healthy inventory
- Red for loss / damaged inventory
- Dense but breathable admin layout
- Inter for UI/numbers/English
- Prompt + Kanit for Thai content
- Responsive desktop / iPad / mobile navigation

## Information architecture

1. **ภาพรวม (Dashboard)**
   - Revenue / Gross Profit / Expenses / Net Profit KPI
   - Revenue & Profit trend chart
   - Payment Mix donut
   - Inventory Health donut
   - Sales Channels
   - Capital & Stock
   - Payment breakdown
   - Tier performance
   - Stock Aging
   - Lot Performance
   - Markdown watchlist
   - Weekend performance
   - Top profit items
   - Lot recovery
   - Today's payment snapshot

2. **ล็อต**
   - Receive new lot
   - Average cost preview
   - Lot list with metrics
   - Per-lot pricing groups

3. **สินค้า**
   - Quick inventory KPIs
   - Single item entry
   - Bulk 200-item workflow
   - Excel import
   - Photo queue
   - Stock search/filter
   - Item edit + history

4. **ขายของ**
   - Ready-to-sell / sold tabs
   - Visual product grid
   - Item detail before sale
   - Payment + channel confirmation
   - Sale history

5. **รายงาน**
   - Day / month / year filters
   - Revenue/profit KPI
   - Channel / tier / payment breakdown
   - Lot performance
   - Weekend comparison
   - Trend chart + detail table
   - Sale list

6. **บัญชี**
   - Capital / expenses / revenue / net profit
   - Cashflow
   - Four-bucket money allocation
   - Expense entry/list
   - Lot accounting
   - Full cash ledger + CSV export

## Data / backend

This redesign is UI-first. Existing Supabase tables, RPCs, realtime flow, bulk import logic, and business calculations are preserved.

No database migration is required for V11 UI.
