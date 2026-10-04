-- ============================================================================
-- 22 Purdue FIELD LOGIN users + their per-job form permissions.
-- Project: gvfolfzseqwhhimbxgjv.  RUN 2026-09-16-field-form-permissions.sql FIRST
-- (this file needs the cs_field_user_forms table + cs_portal_set_user).
-- Run this in the Supabase SQL Editor.
--
-- Each person: role='field', assigned ONLY to Purdue Academic Bldg. (C800-2025),
-- PIN = the generated 4-digit code, permissions = their Purdue allow-list.
-- role='field' => field session scope => office/admin RPCs reject them; they get
-- the phone field landing only. Names are the EXACT spellings provided.
--
-- Each user is its own DO block so a weak-PIN / duplicate-PIN rejection is
-- isolated and reported as a NOTICE; the rest still run. cs_portal_set_user
-- upserts on (slug, lower(name)) and the permission row upserts too, so a re-run
-- is safe. WATCH THE OUTPUT for any 'FAILED' lines and tell Claude which.
-- ============================================================================

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Mike Hamm', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Mike Hamm (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Mike Hamm: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Lewayne Grissom', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial','forklift','jha']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Lewayne Grissom (PIN redacted) hotwork/aerial/forklift/jha';
exception when others then raise notice 'FAILED Lewayne Grissom: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Troy Ward', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Troy Ward (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Troy Ward: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'John Silvey', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial','forklift']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: John Silvey (PIN redacted) hotwork/aerial/forklift';
exception when others then raise notice 'FAILED John Silvey: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Kamare Robinson', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial','forklift']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Kamare Robinson (PIN redacted) hotwork/aerial/forklift';
exception when others then raise notice 'FAILED Kamare Robinson: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Raymond Randolph', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Raymond Randolph (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Raymond Randolph: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Wendell Westmoreland', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Wendell Westmoreland (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Wendell Westmoreland: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Jacob Champoux', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial','forklift']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Jacob Champoux (PIN redacted) hotwork/aerial/forklift';
exception when others then raise notice 'FAILED Jacob Champoux: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Brayden Eicher', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Brayden Eicher (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Brayden Eicher: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Justin Fetterhoff', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Justin Fetterhoff (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Justin Fetterhoff: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Walker Shephard', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Walker Shephard (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Walker Shephard: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Rowland Smith', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial','forklift']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Rowland Smith (PIN redacted) hotwork/aerial/forklift';
exception when others then raise notice 'FAILED Rowland Smith: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Brendan Nellans', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Brendan Nellans (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Brendan Nellans: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Micheal Brownlee', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Micheal Brownlee (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Micheal Brownlee: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Austin Beaver', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Austin Beaver (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Austin Beaver: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Alan Price', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Alan Price (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Alan Price: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Jammal Howard', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Jammal Howard (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Jammal Howard: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Nick Nielsen', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Nick Nielsen (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Nick Nielsen: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Thomas Heffernan', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Thomas Heffernan (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Thomas Heffernan: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Cody Rose', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Cody Rose (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Cody Rose: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Joey Jessup', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Joey Jessup (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Joey Jessup: %', sqlerrm; end $$;

do $$ declare uid uuid; begin
  select (cs_portal_set_user('greiner', 'Cory Vinson', '<PIN redacted>', null, 'field',
           array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]) ->> 'id')::uuid into uid;
  insert into cs_field_user_forms (user_id, job_id, form_keys)
    values (uid, '87906cbc-1809-4d56-b4e1-7973562221b2', array['hotwork','aerial']::text[])
    on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  raise notice 'OK: Cory Vinson (PIN redacted) hotwork/aerial';
exception when others then raise notice 'FAILED Cory Vinson: %', sqlerrm; end $$;

-- Verify: expect 22 field users on Purdue with their allow-lists.
select u.name, u.role, f.form_keys
  from cs_portal_users u
  left join cs_field_user_forms f on f.user_id = u.id
       and f.job_id = '87906cbc-1809-4d56-b4e1-7973562221b2'
 where u.slug = 'greiner' and coalesce(u.role,'full')='field'
   and '87906cbc-1809-4d56-b4e1-7973562221b2' = any(u.job_ids)
 order by u.name;
