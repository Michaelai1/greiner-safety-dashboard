-- ============================================================================
-- Greiner — Taylorsville field users + current Skyworks equipment
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety). Run in Supabase SQL Editor.
-- PREPARED 2026-09-08, NOT YET APPLIED (Supabase connector was unauthorized).
--
-- Contents:
--   1. Three Taylorsville-only field login users via the EXISTING
--      cs_portal_set_user mechanism (same server-enforced model as Keith:
--      role='field' -> session scope='field' -> full RPCs reject the session,
--      submissions attribute server-side to job_ids[1]. No security changes.)
--   2. Current rental units into cs_equipment (idempotent upserts), ONLY for
--      unambiguous job matches from Tony's "Current Skyworks rentals
--       2026-08-31" report (PO suffix -800/-808/-785/-796/-802 all match the
--      existing cs_jobs rows by BOTH name and number).
--      EXCLUDED on purpose — do not add without Tony:
--        * Southport HS 45720, Butler 3100550 (no matching cs_jobs row)
--        * "IPS 110 / PO -801" units 46028, 40261 (rental NAME says the
--          C797 site, PO suffix says C801 — Tony must say which job)
--   3. Verification selects.
--
-- Each user is wrapped in its own DO block so one failure (e.g. the weak-PIN
-- rule rejecting Robert's requested 1113) does not stop the rest — watch the
-- NOTICEs in the output. Do NOT weaken cs_pin_is_weak; if 1113 is rejected,
-- Robert needs a different PIN from Mike/Tony.
-- ============================================================================

-- ── 1. Field users (Taylorsville Elementary = 8b51bcdd-…, job C808-2026) ────
do $$ begin
  perform cs_portal_set_user('greiner', 'Robert Goble', '1113',
    'Foreman — Taylorsville', 'field',
    array['8b51bcdd-a67b-47ab-a27b-5fa7c6daad31']::uuid[]);
  raise notice 'OK: Robert Goble created/updated (PIN 1113)';
exception when others then
  raise notice 'FAILED Robert Goble: % (if weak-PIN rejection: pick a different PIN, do not weaken the rule)', sqlerrm;
end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Ross McNeely', '5692',
    'Field — Taylorsville', 'field',
    array['8b51bcdd-a67b-47ab-a27b-5fa7c6daad31']::uuid[]);
  raise notice 'OK: Ross McNeely created/updated (PIN 5692)';
exception when others then
  raise notice 'FAILED Ross McNeely: %', sqlerrm;
end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Kyler Wheeler', '2073',
    'Field — Taylorsville', 'field',
    array['8b51bcdd-a67b-47ab-a27b-5fa7c6daad31']::uuid[]);
  raise notice 'OK: Kyler Wheeler created/updated (PIN 2073)';
exception when others then
  raise notice 'FAILED Kyler Wheeler: %', sqlerrm;
end $$;

-- ── 2. Equipment (company 8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2) ─────────────
-- Rentals rotate: when a unit goes back, set active=false and add the new one.
insert into cs_equipment (company_id, unit_number, equipment_type, job_id, active)
values
  -- Purdue Academic Bldg. C800-2025 (87906cbc-1809-4d56-b4e1-7973562221b2)
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53308','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53310','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53309','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53313','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','30879','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','30984','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','27152','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53317','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53315','Scissor lift — 13'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','16028','Scissor lift — 12'' electric','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','40929','Mast lift — 18'' driveable','87906cbc-1809-4d56-b4e1-7973562221b2',true),
  -- Taylorsville Elementary C808-2026 (8b51bcdd-a67b-47ab-a27b-5fa7c6daad31)
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','40265','Scissor lift — 19'' electric narrow','8b51bcdd-a67b-47ab-a27b-5fa7c6daad31',true),
  -- IU Health Plmb Core & Shell C785-2023 (41657b4f-1db9-4eb2-bb10-27ee83aa2e42)
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45154','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45165','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45168','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45169','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45167','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45245','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45157','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','3289Q','Scissor lift — 12'' electric','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45246','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45171','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','15847','Scissor lift — 12'' electric','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','40897','Mast lift — 18'' driveable','41657b4f-1db9-4eb2-bb10-27ee83aa2e42',true),
  -- Westin Airport Hotel C796-2025 (68e1da81-f5a1-463a-a42e-ff07f4695152)
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','9252Q','Scissor lift — 19'' electric narrow','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','15458','Scissor lift — 12'' electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','14270','Scissor lift — 12'' electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','51631','Scissor lift — 13'' electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','45248','Mast lift — 18'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','54425','Mast lift — 20'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','8705','Mast lift — 20'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','8625','Mast lift — 20'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','5563','Mast lift — 20'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','6831','Scissor lift — 12'' electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','53321','Scissor lift — 13'' electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','43662','Utility vehicle — 4WD 4/6 passenger','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','3050401','Charger unit — electric forklift','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','3034400','Forklift — 4,400# stand-up electric','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','61685Q','Mast lift — 20'' driveable','68e1da81-f5a1-463a-a42e-ff07f4695152',true),
  -- Indy Blind & Deaf School C802-2025 (1484be94-083d-4faf-8276-9b2dd5520f4f)
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','41874','Forklift — 6,000# telescopic','1484be94-083d-4faf-8276-9b2dd5520f4f',true),
  ('8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2','51686','Scissor lift — 19'' electric narrow','1484be94-083d-4faf-8276-9b2dd5520f4f',true)
on conflict (company_id, unit_number) do update
  set equipment_type = excluded.equipment_type,
      job_id = excluded.job_id,
      active = true;

-- ── 3. Verify ───────────────────────────────────────────────────────────────
select name, role, title, job_ids, active
  from cs_portal_users where slug = 'greiner' order by created_at;

select j.job_number, j.name as job, count(*) as units
  from cs_equipment e join cs_jobs j on j.id = e.job_id
 where e.company_id = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2' and e.active
 group by 1, 2 order by 1;
-- Expect: C785=12, C796=15, C800=11, C802=2, C808=1 (41 total).
