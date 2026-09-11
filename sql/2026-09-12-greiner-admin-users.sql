-- ============================================================================
-- Greiner Brothers — six ADMIN (full-scope) login accounts.
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety). Run in the Supabase SQL Editor.
--
-- Uses the EXISTING cs_portal_set_user mechanism (same as Tony / the Taylorsville
-- field users). role='full' => full session scope => sees and manages everything,
-- exactly like Tony's account. job_ids = NULL (full users are not job-scoped).
-- PINs are the last 4 digits of each person's phone (bcrypt-hashed by the RPC).
--
-- Each account is wrapped in its own DO block so one failure (e.g. a weak-PIN or
-- PIN-clash rejection) does NOT stop the others — watch the NOTICEs in the output.
-- Do NOT weaken cs_pin_is_weak; if a PIN is rejected, that person needs a
-- different PIN. cs_portal_set_user upserts on (slug, lower(name)), so re-running
-- is safe and just refreshes the PIN/role.
--
--   Matt Thuer        Matt@greinerbrothers.com       3109
--   Jeff Hearrell     jhearrell@greinerbrothers.com  1001
--   Jon Deater        JDeater@greinerbrothers.com    3941
--   Steve Logan       slogan@greinerbrothers.com     3110
--   Chris Greiner Jr  Chris@greinerbrothers.com      3101
--   Paul Howard       phoward@greinerbrothers.com    7719
--
-- NOTE: email is not a column on cs_portal_users (login is name + PIN), so the
-- addresses above are recorded here for reference only.
-- ============================================================================

do $$ begin
  perform cs_portal_set_user('greiner', 'Matt Thuer', '3109', null, 'full', null);
  raise notice 'OK: Matt Thuer (PIN 3109)';
exception when others then raise notice 'FAILED Matt Thuer: %', sqlerrm; end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Jeff Hearrell', '1001', null, 'full', null);
  raise notice 'OK: Jeff Hearrell (PIN 1001)';
exception when others then raise notice 'FAILED Jeff Hearrell: %', sqlerrm; end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Jon Deater', '3941', null, 'full', null);
  raise notice 'OK: Jon Deater (PIN 3941)';
exception when others then raise notice 'FAILED Jon Deater: %', sqlerrm; end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Steve Logan', '3110', null, 'full', null);
  raise notice 'OK: Steve Logan (PIN 3110)';
exception when others then raise notice 'FAILED Steve Logan: %', sqlerrm; end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Chris Greiner Jr', '3101', null, 'full', null);
  raise notice 'OK: Chris Greiner Jr (PIN 3101)';
exception when others then raise notice 'FAILED Chris Greiner Jr: %', sqlerrm; end $$;

do $$ begin
  perform cs_portal_set_user('greiner', 'Paul Howard', '7719', null, 'full', null);
  raise notice 'OK: Paul Howard (PIN 7719)';
exception when others then raise notice 'FAILED Paul Howard: %', sqlerrm; end $$;

-- Verify (expect the six names, role=full, active=true):
select name, title, role, active, last_login_at
  from cs_portal_users
 where slug = 'greiner' and role = 'full'
 order by name;
