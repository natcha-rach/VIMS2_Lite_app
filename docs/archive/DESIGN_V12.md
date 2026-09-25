# VIMS2 Lite V12 — "Daylight Report" UI Redesign

## What changed

V11 was a dark navy + violet admin theme. V12 replaces it with a light,
white-card theme inspired by the reference analytics template (Reports
page): white surfaces, soft shadows, rounded 16px cards, an indigo-blue
accent, and calm data-dense layout. Green = profit, red = loss, amber = warning —
kept consistent with the existing formulas.

## How it was done (and why nothing broke)

`design-v11.css` was already a **theme override layer** loaded after
`base.css` + page CSS, using `!important` on the exact class names that
`dashboard.js` / `items.js` / `lots.js` / `sell.js` / `reports.js` /
`accounting.js` generate via `innerHTML`. V12 replaces that file
(`design-v12.css`) using the **same selectors**, so:

- No HTML structure changed except: swapping the `<link>` from
  `design-v11.css` → `design-v12.css` on all 6 pages, and adding a
  `.sidebar-footer` (shop name strip, mimics the template's account
  footer) to every sidebar.
- No JS logic changed except **chart colors** (dashboard.js, reports.js)
  and one **new additive feature**: sparkline mini-charts inside the
  Revenue and Gross Profit KPI cards on the dashboard, reusing the trend
  data already computed for the main chart (no extra Supabase queries).
- All business logic, RPCs, Realtime, bulk import, Supabase calls are
  untouched.

## Fonts

Unchanged: Inter for numbers/UI, Prompt + Kanit for Thai — already
loaded via Google Fonts on all 6 pages.

## Suggestions not yet implemented (see chat reply for the full list)

- Convert the period selector from pill-buttons to a dropdown like the
  template's "Timeframe: All-time ▾" — cosmetic only, would need a small
  JS change in `dashboard.js`/`reports.js`.
- Trim dashboard sections (see chat reply for which ones and why).
