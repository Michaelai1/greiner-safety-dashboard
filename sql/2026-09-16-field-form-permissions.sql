-- ============================================================================
-- Per-user, per-job field FORM PERMISSIONS + server enforcement.
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety). Run in the Supabase SQL Editor.
-- PREPARED 2026-09-16.  RUN THIS FILE FIRST, then the users file.
--
-- Model: effective forms = JOB-ENABLED  ∩  USER-ALLOWED.
--   * Per-job config already lives in cs_job_form_config (external_hotwork,
--     enabled_forms). Unchanged.
--   * Per-user allow-list is NEW: cs_field_user_forms(user_id, job_id, form_keys).
--     ABSENT ROW = all default forms (so every existing crew member — Robert,
--     Keith, David, Dalton, Dylan, Taylorsville, existing Purdue — is unchanged).
--     A present row = explicit allow-list for that person on that job.
--
-- Canonical form keys (same set the client + enabled_forms already use):
--     hotwork | aerial | forklift | jha | jobsiteanalysis
--   Standard JHA = 'jha'.  Job Site Analysis Checklist = 'jobsiteanalysis'.
--   They are SEPARATE permissions and are never mapped onto each other.
--
-- Additive. cs_portal_field_home gains one key (user_forms). cs_portal_field_submit
-- gains job-level + user-level validation (previously it validated neither, so this
-- is a security hardening; it only ever REJECTS a form the person/job may not use).
-- ============================================================================

begin;

-- 1. Per-user, per-job allow-list. Absent row = all default forms.
create table if not exists public.cs_field_user_forms (
  user_id    uuid not null references public.cs_portal_users(id) on delete cascade,
  job_id     uuid not null references public.cs_jobs(id) on delete cascade,
  form_keys  text[] not null default '{}',   -- subset of {hotwork,aerial,forklift,jha,jobsiteanalysis}
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
alter table public.cs_field_user_forms enable row level security;  -- definer-RPC access only

-- 2. field_home: add per-job `user_forms` (this user's allow-list for that job,
--    null = all). BYTE-IDENTICAL to the live 2026-09-10 definition except:
--      * also selects u_id (session user_id),
--      * each job object gains 'user_forms'.
create or replace function public.cs_portal_field_home(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; v_scope text; v_jobs uuid[]; v_user text; v_job uuid; v_uid uuid;
begin
  select company_id, scope, job_ids, user_name, user_id
    into cid, v_scope, v_jobs, v_user, v_uid
    from cs_portal_sessions where token = p_token and expires_at > now();
  if cid is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if v_scope <> 'field' then raise exception 'not a field user' using errcode = 'P0001'; end if;
  v_job := (coalesce(v_jobs, '{}'::uuid[]))[1];

  return jsonb_build_object(
    'user', v_user,
    'company', (select name from cs_companies where id = cid),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'job_number', j.job_number, 'name', j.name, 'address', j.address,
        'foreman_name', j.foreman_name,
        'external_hotwork', coalesce(c.external_hotwork, false),
        'hotwork_locations', coalesce(c.hotwork_locations, '[]'::jsonb),
        'enabled_forms', to_jsonb(c.enabled_forms),
        'enabled_permits', to_jsonb(c.enabled_permits),
        -- NEW: this user's per-job allow-list (null = all default forms)
        'user_forms', (select to_jsonb(f.form_keys) from cs_field_user_forms f
                        where f.user_id = v_uid and f.job_id = j.id))
        order by j.job_number)
        from cs_jobs j
        left join cs_job_form_config c on c.job_id = j.id
        where j.company_id = cid and j.id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(distinct jsonb_build_object('name', w.name, 'phone', w.phone))
        from cs_workers w
        where w.company_id = cid and w.active
          and w.job_id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
    'hotwork_locations', coalesce((select c.hotwork_locations from cs_job_form_config c where c.job_id = v_job), '[]'::jsonb),
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
grant  execute on function public.cs_portal_field_home(text) to anon, authenticated;

-- 3. Canonical form-key normalizer: accepts either a client key or a stored
--    form_type and returns the canonical key. Used by submit enforcement.
create or replace function public.cs_form_key(p text)
 returns text language sql immutable as $$
  select case lower(coalesce(p,''))
    when 'hot_work_permit'   then 'hotwork'
    when 'hotwork'           then 'hotwork'
    when 'aerial_platform'   then 'aerial'
    when 'aerial'            then 'aerial'
    when 'forklift'          then 'forklift'
    when 'jha'               then 'jha'
    when 'job_site_analysis' then 'jobsiteanalysis'
    when 'jobsiteanalysis'   then 'jobsiteanalysis'
    else lower(coalesce(p,'')) end
$$;

-- 4. field_submit: unchanged behavior EXCEPT it now validates the requested
--    workflow against (a) the job config and (b) the user's per-job allow-list,
--    server-side. A worker cannot hand-craft a request for a workflow their job
--    disables or they personally lack. Attribution stays server-side (ticket job).
create or replace function public.cs_portal_field_submit(
  p_token text, p_form_type text, p_form_title text, p_asset_id text,
  p_fields jsonb, p_photos jsonb, p_signature text,
  p_has_defects boolean, p_defect_count integer, p_pdf_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare s record; v_job uuid; v_job_name text; rid uuid;
        v_key text; v_ext boolean; v_enabled text[]; v_uforms text[];
begin
  select company_id, scope, job_ids, user_id, user_name into s
    from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode='P0001'; end if;
  if s.scope <> 'field' then raise exception 'insufficient scope' using errcode='P0001'; end if;
  if s.job_ids is null or array_length(s.job_ids,1) is null then
    raise exception 'no job assigned to this user' using errcode='P0001';
  end if;

  v_job := s.job_ids[1];
  select name into v_job_name from cs_jobs where id = v_job and company_id = s.company_id;
  if v_job_name is null then raise exception 'assigned job not in company' using errcode='P0001'; end if;

  -- ── workflow authorization (NEW) ──────────────────────────────────────────
  v_key := cs_form_key(p_form_type);
  select coalesce(external_hotwork,false), enabled_forms
    into v_ext, v_enabled from cs_job_form_config where job_id = v_job;
  if v_key = 'hotwork' and coalesce(v_ext,false) then
    raise exception 'workflow not enabled on this job' using errcode='P0001';
  end if;
  if v_enabled is not null and not (v_key = any(v_enabled)) then
    raise exception 'workflow not enabled on this job' using errcode='P0001';
  end if;
  select form_keys into v_uforms from cs_field_user_forms where user_id = s.user_id and job_id = v_job;
  if v_uforms is not null and not (v_key = any(v_uforms)) then
    raise exception 'workflow not permitted for this user' using errcode='P0001';
  end if;
  -- ──────────────────────────────────────────────────────────────────────────

  insert into cs_field_submissions (company_id, job_id, user_id, inspector_name,
      form_type, form_title, asset_id, fields, photos, has_defects, defect_count,
      signature, pdf_path)
  values (s.company_id, v_job, s.user_id, s.user_name,
      lower(coalesce(p_form_type,'')), coalesce(p_form_title, p_form_type),
      nullif(trim(coalesce(p_asset_id,'')),''),
      coalesce(p_fields,'{}'::jsonb), coalesce(p_photos,'[]'::jsonb),
      coalesce(p_has_defects,false), coalesce(p_defect_count,0),
      nullif(trim(coalesce(p_signature,'')),''), nullif(trim(coalesce(p_pdf_path,'')),''))
  returning id into rid;

  return jsonb_build_object('ok', true, 'id', rid, 'inspector', s.user_name,
    'job_id', v_job, 'job_name', v_job_name, 'pdf_path', p_pdf_path);
end $function$;
revoke all on function public.cs_portal_field_submit(text,text,text,text,jsonb,jsonb,text,boolean,integer,text) from public;
grant execute on function public.cs_portal_field_submit(text,text,text,text,jsonb,jsonb,text,boolean,integer,text) to anon, authenticated;

-- 5. ADMIN READ: field-login users assigned to a job + their per-job form_keys
--    (null = all). Full-scope only; for the office Jobs -> People UI.
create or replace function public.cs_portal_job_field_users(p_token text, p_job_id uuid)
 returns jsonb language plpgsql stable security definer
 set search_path to 'public','extensions'
as $function$
declare v_cid uuid; v_slug text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if not exists (select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return jsonb_build_object('ok', false, 'error', 'bad_job');
  end if;
  select slug into v_slug from cs_portal_sessions where token = p_token limit 1;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.name, 'title', u.title, 'role', u.role,
      'form_keys', (select to_jsonb(f.form_keys) from cs_field_user_forms f
                     where f.user_id = u.id and f.job_id = p_job_id))
      order by u.name)
      from cs_portal_users u
      where u.slug = v_slug and u.active and coalesce(u.role,'full') = 'field'
        and p_job_id = any(coalesce(u.job_ids, '{}'::uuid[]))), '[]'::jsonb);
end $function$;
revoke all on function public.cs_portal_job_field_users(text, uuid) from public;
grant  execute on function public.cs_portal_job_field_users(text, uuid) to anon, authenticated;

-- 6. ADMIN WRITE: set a field user's allowed forms for a job. Full-scope only.
--    p_form_keys is sanitized to the known key set. Passing the full set = same
--    as "all". Validates the target is a field user actually assigned to the job.
create or replace function public.cs_portal_user_forms_set(
  p_token text, p_user_id uuid, p_job_id uuid, p_form_keys text[]
) returns jsonb language plpgsql security definer
  set search_path to 'public','extensions'
as $function$
declare v_cid uuid; v_slug text; v_clean text[];
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select slug into v_slug from cs_portal_sessions where token = p_token limit 1;
  if not exists (select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return jsonb_build_object('ok', false, 'error', 'bad_job');
  end if;
  if not exists (select 1 from cs_portal_users u
      where u.id = p_user_id and u.slug = v_slug and coalesce(u.role,'full') = 'field'
        and p_job_id = any(coalesce(u.job_ids, '{}'::uuid[]))) then
    return jsonb_build_object('ok', false, 'error', 'not_a_field_user_on_job');
  end if;
  v_clean := (select coalesce(array_agg(distinct k), '{}')
                from unnest(coalesce(p_form_keys,'{}')) k
               where k in ('hotwork','aerial','forklift','jha','jobsiteanalysis'));
  insert into cs_field_user_forms (user_id, job_id, form_keys, updated_at)
  values (p_user_id, p_job_id, v_clean, now())
  on conflict (user_id, job_id) do update set form_keys = excluded.form_keys, updated_at = now();
  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'job_id', p_job_id,
    'form_keys', to_jsonb(v_clean));
end $function$;
revoke all on function public.cs_portal_user_forms_set(text, uuid, uuid, text[]) from public;
grant  execute on function public.cs_portal_user_forms_set(text, uuid, uuid, text[]) to anon, authenticated;

commit;

-- ── Verify the RPCs exist (expect no error) ─────────────────────────────────
-- select cs_form_key('hot_work_permit');           -- -> hotwork
-- select cs_form_key('job_site_analysis');          -- -> jobsiteanalysis
