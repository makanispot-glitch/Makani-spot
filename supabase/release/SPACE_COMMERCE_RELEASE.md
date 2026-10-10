# Space commerce release

Status updated 10 October 2026: the owner deployed the compatible frontend and explicitly approved both commerce migrations. Both were applied to remote Supabase and live read-only API checks passed. See `SPACE_COMMERCE_ACTIVATION_2026-10-10.md`. Local preview still uses an ephemeral PostgreSQL database, not production credentials.

## Exact scope

1. `20261010003938_space_commerce.sql`: additive space/bookings fields; pricing/range/phone/legacy size-price validation; safe public JSON RPCs; existing admin upsert overloads; registered applicant/Drive-link validation in the existing booking trigger; immutable quote/visit snapshots; column UPDATE grants under existing owner/admin RLS. No Storage bucket, upload endpoint or file metadata table.
2. `20261010004014_space_commerce_access.sql`: compatibility wrapper for existing search; price-safe public publisher profile; registration condition on existing SELECT policies for spaces, space_units and bookings. INSERT/UPDATE/DELETE ownership policies remain intact.

The SQL contents approved as `20261009231431_space_commerce.sql` and `20261009231548_space_commerce_access.sql` are unchanged. Local filenames were aligned with the actual remote migration versions after application, to prevent a later CLI push from attempting them again.

Existing min_price and sizes_prices data are preserved. Existing unit prices remain monthly totals. Existing viewing payment destination remains unchanged; viewing contact is a separate field. Historical booking rows are not backfilled.

## Coordinated activation

1. Review the full migration diff and local acceptance report; capture current definitions of affected functions and SELECT policies in an access-controlled backup. Recheck production schema/RLS drift and existing negative or malformed legacy size prices before applying. New edits enforce validation without rewriting unchanged legacy size text.
2. Apply the preparation migration through Supabase migrations, in its transaction. Verify existing fixed spaces, admin/owner editing, and safe guest/registered RPC outputs. Preparation alone does not enforce the guest restriction on all old direct table endpoints.
3. Deploy the compatible HTML/JS/CSS together, including the new shared files and APP_VERSION/SW cache version `v20261010-commerce-1`. The old public detail query reads the base table, so do not activate table restrictions before the compatible frontend is available. Reload older open tabs/PWA clients before introducing estimated listings; old clients do not understand the new units or range fields.
4. Immediately apply the access migration in its transaction. Verify unauthenticated and anonymous-authenticated direct table reads expose no space/unit/booking rows; safe search, detail and publisher RPCs continue returning public non-price data. Confirm registered rent prices and public viewing fees. Reload PostgREST schema cache if its normal migration refresh has not completed.
5. Test a dedicated staging/test account before any real request: admin/owner create/edit, required/optional Drive application, selected unit, free/paid viewing, historical snapshot, request filters and reviewer links. Disable external notification callbacks in staging tests; local tests intentionally omitted them.

The automatic approval review rejected the initial remote preparation attempt because it changed schema, permissions, booking functions and a new storage bucket before full tests. Storage was then removed per the owner's correction, and local tests were completed. A later attempt required explicit approval of the two production files. After the owner gave that approval, the normal Supabase migration tool applied both successfully; no rejection was bypassed.

## Rollback

Keep the added columns and recorded snapshots. Do not drop or rewrite price/history fields to roll back presentation. Prefer correcting the compatible frontend while retaining access protection.

If a rollback to the old frontend is required, review its effect explicitly: old raw guest queries require restoring prior SELECT policies, which restores guest rental-price access. Restore exact backed-up policies/functions only as a deliberate release decision; do not silently remove protection or enable anonymous booking writes. The original maps migration and verified location data remain independent.

## Local verification

`node tests/commerce-sql.test.cjs` runs full migrations in PGlite/PostgreSQL using anon/authenticated roles, JWT claims, real policy/function definitions and isolated fixtures. `npx playwright test -c tests/space-commerce.config.js` runs the site through the preview HTTP adapter against the same migrations. `node tests/commerce-preview.cjs` starts port8850; data disappears when the process stops. The preview adapter and fixtures live under ignored tests/ and are never included in production deployment.
