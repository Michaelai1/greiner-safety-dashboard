-- ============================================================================
-- Field-user job assignment: list field users and set their jobs from the
-- office, so Tony can put people on jobs (and multiple jobs) with clicks.
-- Project: gvfolfzseqwhhimbxgjv. Run in the Supabase SQL Editor.
-- PREPARED 2026-09-11, NOT YET APPLIED (Supabase connector detached this session).
--
-- Pairs with the field-phone multi-job switcher already shipped: once a user is
-- on 2+ jobs, they pick the jobsite at the top of their phone and the inspection
-- attributes to it. These two RPCs are what the office "Assign to jobs" UI calls.
-- Additive; nothing existing changes.
-- ============================================================================

-- List the portal's FIELD users + their current job assignments (full scope).
create or replace function public.cs_portal_field_users(p_token text)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public','extensions'
as $function$
declare v_cid uuid; v_slug text;
begin
  v_cid := cs_portal_cid(p_token, 'full');   -- full-scope only; field sessions rejected
  select slug into v_slug from cs_portal_sessions where token = p_token limit 1;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.name, 'title', u.title, 'role', u.role,
      'job_ids', coalesce(to_jsonb(u.job_ids), '[]'::jsonb))
      order by u.name)
      from cs_portal_users u
      where u.slug = v_slug and u.active and coalesce(u.role,'full') = 'field'), '[]'::jsonb);
end $function$;
revoke all on function public.cs_portal_field_users(text) from public;
grant  execute on function public.cs_portal_field_users(text) to anon, authenticated;

-- Set a field user's jobs (add / remove / move = just pass the new array).
-- Every job is validated to belong to the caller's company, so no cross-company
-- assignment is possible.
create or replace function public.cs_portal_field_user_set_jobs(
  p_token text, p_user_id uuid, p_job_ids uuid[]
) returns jsonb language plpgsql security definer
  set search_path to 'public','extensions'
as $function$
declare v_cid uuid; v_slug text; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select slug into v_slug from cs_portal_sessions where token = p_token limit 1;
  if p_job_ids is not null and array_length(p_job_ids,1) is not null and exists (
      select 1 from unnest(p_job_ids) j
      where not exists (select 1 from cs_jobs where id = j and company_id = v_cid)) then
    return jsonb_build_object('ok', false, 'error', 'bad_job');
  end if;
  update cs_portal_users
     set job_ids = p_job_ids
   where id = p_user_id and slug = v_slug and coalesce(role,'full') = 'field';
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found_or_not_field'); end if;
  return jsonb_build_object('ok', true, 'id', p_user_id,
    'job_ids', coalesce(to_jsonb(p_job_ids), '[]'::jsonb));
end $function$;
revoke all on function public.cs_portal_field_user_set_jobs(text, uuid, uuid[]) from public;
grant  execute on function public.cs_portal_field_user_set_jobs(text, uuid, uuid[]) to anon, authenticated;
