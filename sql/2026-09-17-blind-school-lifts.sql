-- ============================================================================
-- Add two newly delivered 13' electric scissor lifts to the Indy Blind & Deaf
-- School jobsite. Project: gvfolfzseqwhhimbxgjv. Run once in the Supabase SQL Editor.
--
-- PRODUCTION DATA UPDATE (no schema/code change).
--
-- Jobsite: "Indy Blind & Deaf School" (C802-2025)
--          id 1484be94-083d-4faf-8276-9b2dd5520f4f
--   NOTE: the request called it "Blind School Education Building." No record by
--   that exact name exists; this is the only Blind-related jobsite in production
--   (Indiana School for the Blind, 7725 N. College Ave). Using it rather than
--   creating a new jobsite. Confirm this is the intended site.
--
-- Company: Greiner Brothers  id 8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2
--
-- Data model note: cs_equipment stores only unit_number + equipment_type (a
-- free-text descriptor) + job_id + active. There are NO make / model / year
-- columns, so those source values are recorded here as comments for traceability
-- but are not stored as structured fields (consistent with all other units).
-- equipment_type uses the existing canonical value "Scissor lift — 13' electric"
-- (already used by 11+ units), so these two match the rest of the fleet exactly.
--
--   Unit 53311 — 13' SCISSORS ELECTRIC — JLG ES1330L — year 25 (2025)
--   Unit 59004 — 13' SCISSORS ELECTRIC — JLG ES1330M — year 26 (2026)
--
-- Idempotent: on conflict (company_id, unit_number) it updates the existing row
-- rather than creating a duplicate. Verified before writing that NEITHER 53311
-- nor 59004 currently exists, so both are clean inserts.
-- ============================================================================

insert into cs_equipment (company_id, unit_number, equipment_type, job_id, active)
values
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53311','Scissor lift — 13'' electric','1484be94-083d-4faf-8276-9b2dd5520f4f',true), -- JLG ES1330L, yr 25
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','59004','Scissor lift — 13'' electric','1484be94-083d-4faf-8276-9b2dd5520f4f',true)  -- JLG ES1330M, yr 26
on conflict (company_id, unit_number) do update
  set equipment_type = excluded.equipment_type,
      job_id = excluded.job_id,
      active = true
returning unit_number, equipment_type, job_id, active;

-- ── Verify: both units on the Blind school, each exactly once ─────────────────
select e.unit_number, e.equipment_type, j.name as jobsite, j.job_number, e.active
  from cs_equipment e join cs_jobs j on j.id = e.job_id
 where e.company_id = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2'
   and e.unit_number in ('53311','59004')
 order by e.unit_number;

-- Uniqueness check (expect exactly 1 row each; the unique constraint enforces it):
select unit_number, count(*)
  from cs_equipment
 where company_id = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2'
   and unit_number in ('53311','59004')
 group by unit_number;
