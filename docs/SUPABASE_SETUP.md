# VIMS2 Lite — Supabase Setup

## 1) Project URL

Use the Supabase **Project URL** only:

`https://cphhutlxvbinaycmsekm.supabase.co`

Do **not** use:

`https://cphhutlxvbinaycmsekm.supabase.co/rest/v1/`

`createClient()` needs the project root URL and handles REST/Storage/Auth endpoints internally.

## 2) Frontend key

`assets/js/supabaseClient.js` contains the project's **anon/public** key.

Never put a `service_role` / secret key in frontend code.

## 3) Database

For a fresh/empty database, run these three files in the Supabase SQL Editor, **one at a time, in order**, waiting for "Success" before running the next:

1. `sql/schema_part1_tables_and_rls.sql`
2. `sql/schema_part2_functions.sql`
3. `sql/schema_part3_cost_reports.sql`

(Split into three because the combined file is large enough that pasting it into the web SQL Editor in one go can silently truncate.)

If you're running it via `psql`/CLI instead of the web editor, the combined single file `sql/schema.sql` works fine too — same content.

If a run fails partway through and leaves some tables half-created, run `sql/reset_before_retry.sql` first to clear them out, then start again from part 1.

Do not run anything in `sql/archive/` on a fresh database — those are old incremental migrations (V2 through V17), kept only for upgrading an existing pre-V14 database without a full reset.

## 4) Storage

Bucket required:

`item-images`

The current project expects this bucket name exactly.

## 5) Quick verification

After opening the app, test in this order:

1. Dashboard loads without a Supabase error.
2. Create one Lot.
3. Create one Lot Group.
4. Create one Item.
5. Upload 1 image.
6. Open Item and verify image appears.
7. Sell the test Item.
8. Verify Item becomes `sold` and a row appears in `sales`.

If step 1 fails, open browser DevTools → Console and Network and inspect the first Supabase error.
