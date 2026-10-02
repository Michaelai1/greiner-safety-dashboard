-- ============================================================================
-- Delete the test field submissions from 2026-09-09 → present.
-- Project: gvfolfzseqwhhimbxgjv. Run in the Supabase SQL Editor.
--
-- Identified as tests (all from the pilot build/testing window; the 7 records
-- before 2026-09-09 are historical/real and are NOT touched):
--   9e342164…  aerial_platform  Robert Goble  40265  Sep 9  (defect note "Test")
--   f1e2ee59…  jha              Robert Goble         Sep 11
--   be0edd05…  hot_work_permit  Tony Sweet           Sep 11
--
-- NOTE: 9e342164 is the aerial that an earlier QA note called the "regression
-- baseline." It IS a test (its defect note is literally "Test"); deleting it
-- here matches "delete all test inspections Sep 9 → present." Remove its line
-- below if you'd rather keep that one baseline record.
--
-- This deletes the ROWS. The three PDFs in the private bucket must be removed
-- via the Storage API (SQL can't delete storage objects — storage.protect_delete
-- blocks it). Easiest: reconnect the Supabase connector and let Claude remove
-- them through the field-pdf edge broker (rows + PDFs) in one pass. Once the
-- rows are gone the PDFs are already unreachable through the app (no row → no
-- signed URL), so this SQL alone makes them disappear from every Greiner view.
-- ============================================================================

delete from public.cs_field_submissions
where id in (
  '9e342164-0e60-4967-8bb2-a79722b3f243',   -- aerial 40265 (see note above; drop this line to keep the baseline)
  'f1e2ee59-1782-4735-9ed7-0700925438e4',   -- jha (Sep 11)
  'be0edd05-ca02-47c4-a01e-982099be8aff'    -- hot work (Sep 11)
)
returning id::text as deleted_id, form_type, inspector_name, submitted_at;

-- Verify nothing from 2026-09-09+ remains (expect 0 rows):
-- select id, form_type, inspector_name, submitted_at
--   from cs_field_submissions where submitted_at >= '2026-09-09' order by submitted_at;
