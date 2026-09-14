-- ============================================================================
-- Reset Dylan Allen's field PIN to 4748 (the last 4 Mike confirmed).
-- Project: gvfolfzseqwhhimbxgjv. Run once in the Supabase SQL Editor.
--
-- Dylan already exists as a field user on Purdue (job 87906cbc-…); his current
-- PIN did not match 4748. cs_portal_set_user upserts on (slug, lower(name)) and
-- re-hashes the PIN. We pass his SAME job so the assignment is preserved (the
-- upsert overwrites job_ids), and null title (keeps his existing title).
-- ============================================================================

do $$ begin
  perform cs_portal_set_user('greiner', 'Dylan Allen', '4748', null, 'field',
    array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]);   -- Purdue Academic Bldg.
  raise notice 'OK: Dylan Allen PIN set to 4748 (Purdue)';
exception when others then raise notice 'FAILED Dylan Allen: %', sqlerrm; end $$;

-- Verify (expect Dylan, role=field, 1 job):
select name, role, active from cs_portal_users where slug = 'greiner' and lower(name) = 'dylan allen';
