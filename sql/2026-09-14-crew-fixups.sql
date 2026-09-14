-- ============================================================================
-- Two quick fixups. Run once in the Supabase SQL Editor.
-- Project: gvfolfzseqwhhimbxgjv.
-- ============================================================================

-- 1. Set Dylan Allen's field PIN to 4748 (kept on Purdue). His current PIN did
--    not match what Mike had, which is why only he couldn't log in.
do $$ begin
  perform cs_portal_set_user('greiner', 'Dylan Allen', '4748', null, 'field',
    array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]);   -- Purdue Academic Bldg.
  raise notice 'OK: Dylan Allen PIN set to 4748 (Purdue)';
exception when others then raise notice 'FAILED Dylan Allen: %', sqlerrm; end $$;

-- 2. Delete the one connectivity-test JHA I filed as Robert while proving the
--    submit path works end-to-end (fields tagged "__test").
delete from public.cs_field_submissions
 where id = '1119d056-b5f4-4967-9f94-1228ab8d75ed'
returning id::text as deleted_id, form_type, inspector_name;

-- Verify Dylan (expect role=field, active=true):
select name, role, active from cs_portal_users where slug = 'greiner' and lower(name) = 'dylan allen';
