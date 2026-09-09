-- ============================================================================
-- Field home: include the assigned job's active equipment (additive key).
-- Project: gvfolfzseqwhhimbxgjv. Run in Supabase SQL Editor.
--
-- Lets the field QR forms show a job-scoped unit dropdown (e.g. Taylorsville
-- sees only 40265; Purdue sees its own lifts). Scoping is server-side: the
-- list comes from the SESSION's job_ids, so no cross-job leakage is possible.
-- Everything else in the function is byte-identical to the live definition
-- (verified against production output 2026-09-09). Backward compatible: the
-- deployed phone/QR builds ignore the extra key until they use it.
-- ============================================================================

create or replace function public.cs_portal_field_home(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; v_scope text; v_jobs uuid[]; v_user text;
begin
  select company_id, scope, job_ids, user_name
    into cid, v_scope, v_jobs, v_user
    from cs_portal_sessions where token = p_token and expires_at > now();
  if cid is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if v_scope <> 'field' then raise exception 'not a field user' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'user', v_user,
    'company', (select name from cs_companies where id = cid),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'job_number', job_number, 'name', name, 'address', address,
        'foreman_name', foreman_name) order by job_number)
        from cs_jobs
        where company_id = cid and id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
        'unit_number', unit_number, 'equipment_type', equipment_type, 'job_id', job_id)
        order by unit_number)
        from cs_equipment
        where company_id = cid and job_id = any(coalesce(v_jobs, '{}'::uuid[])) and active), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'form_type', form_type, 'form_title', form_title,
        'asset_id', asset_id, 'submitted_at', submitted_at,
        'has_defects', has_defects, 'defect_count', defect_count, 'pdf_path', pdf_path)
        order by submitted_at desc)
        from (select * from cs_field_submissions
               where company_id = cid and job_id = any(coalesce(v_jobs, '{}'::uuid[]))
               order by submitted_at desc limit 25) r), '[]'::jsonb)
  );
end $function$;

revoke all on function public.cs_portal_field_home(text) from public;
grant execute on function public.cs_portal_field_home(text) to anon, authenticated;
