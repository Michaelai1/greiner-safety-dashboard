-- ============================================================================
-- Job-scoped documents + IU crew list from job access.
--
-- 1. cs_job_docs: original files that belong to ONE job (not the company
--    library). Same private bucket (cs-company-docs) and the same company-docs
--    edge function; paths are <company_id>/jobs/<job_id>/<uuid>-<name>.
--    Who may read: an office (full) session of the same company, or a field
--    session whose job list contains the document's job. Nobody else.
--    Who may add/archive: office (full) sessions only. Nothing is deleted.
-- 2. cs_portal_field_home 'people': the crew list is now active roster members
--    whose roster job is one of the session's jobs PLUS active field logins whose
--    job access includes one of those jobs, de-duplicated by name. A person's
--    roster job never changes.
--
-- Additive except for the cs_portal_field_home replacement, which returns the
-- same keys as the live 2026-09-16 definition.
-- ============================================================================

create table if not exists cs_job_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  job_id uuid not null references cs_jobs(id),
  section text not null,
  title text not null,
  filename text not null,
  mime text not null default 'application/pdf',
  size_bytes bigint not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source_date text,
  path text not null unique,
  created_at timestamptz not null default now(),
  created_by text,
  archived_at timestamptz,
  unique (job_id, sha256)
);
create index if not exists cs_job_docs_job_idx on cs_job_docs (job_id) where archived_at is null;
alter table cs_job_docs enable row level security;   -- no policies: definer RPCs only

-- The company id when this session may read documents of this job; otherwise an error.
create or replace function public.cs_job_doc_access(p_token text, p_job_id uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  select company_id, scope, job_ids into s from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if not exists (select 1 from cs_jobs where id = p_job_id and company_id = s.company_id) then
    raise exception 'not permitted' using errcode = 'P0001';
  end if;
  if s.scope = 'full' then return s.company_id; end if;
  if s.scope = 'field' and p_job_id = any(coalesce(s.job_ids, '{}'::uuid[])) then return s.company_id; end if;
  raise exception 'not permitted' using errcode = 'P0001';
end $$;

create or replace function public.cs_portal_job_docs(p_token text, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := cs_job_doc_access(p_token, p_job_id);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', d.id, 'job_id', d.job_id, 'section', d.section, 'title', d.title, 'filename', d.filename,
      'mime', d.mime, 'size_bytes', d.size_bytes, 'sha256', d.sha256, 'source_date', d.source_date,
      'created_at', d.created_at) order by d.section, d.title)
    from cs_job_docs d where d.job_id = p_job_id and d.company_id = v_cid and d.archived_at is null), '[]'::jsonb);
end $$;

create or replace function public.cs_portal_job_doc_path(p_token text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d cs_job_docs; v_cid uuid;
begin
  select * into d from cs_job_docs where id = p_id and archived_at is null;
  if not found then raise exception 'not found or not permitted' using errcode = 'P0001'; end if;
  v_cid := cs_job_doc_access(p_token, d.job_id);
  if d.company_id <> v_cid then raise exception 'not found or not permitted' using errcode = 'P0001'; end if;
  return jsonb_build_object('path', d.path, 'filename', d.filename, 'mime', d.mime, 'sha256', d.sha256, 'size_bytes', d.size_bytes);
end $$;

-- Office only. Re-adding the same file (same sha256) to the same job returns the
-- existing record, so uploads are idempotent.
create or replace function public.cs_portal_job_doc_add(
  p_token text, p_job_id uuid, p_section text, p_title text, p_filename text, p_mime text,
  p_size bigint, p_sha256 text, p_source_date text, p_path text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cid uuid; d cs_job_docs; v_by text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if not exists (select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    raise exception 'bad job' using errcode = 'P0001';
  end if;
  if p_path !~ ('^' || v_cid::text || '/jobs/' || p_job_id::text || '/') then
    raise exception 'path outside job' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_section, '')), '') is null or nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'section and title required' using errcode = 'P0001';
  end if;
  select * into d from cs_job_docs where job_id = p_job_id and sha256 = lower(p_sha256);
  if found then
    return jsonb_build_object('id', d.id, 'existing', true, 'path', d.path);
  end if;
  select user_name into v_by from cs_portal_sessions where token = p_token;
  insert into cs_job_docs (company_id, job_id, section, title, filename, mime, size_bytes, sha256, source_date, path, created_by)
  values (v_cid, p_job_id, btrim(p_section), btrim(p_title), p_filename, coalesce(p_mime, 'application/pdf'),
          p_size, lower(p_sha256), nullif(btrim(coalesce(p_source_date, '')), ''), p_path, v_by)
  returning * into d;
  return jsonb_build_object('id', d.id, 'existing', false, 'path', d.path);
end $$;

create or replace function public.cs_portal_job_doc_archive(p_token text, p_id uuid, p_archived boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cid uuid; n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  update cs_job_docs set archived_at = case when coalesce(p_archived, true) then now() else null end
   where id = p_id and company_id = v_cid;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- Live 2026-09-16 definition, with 'people' widened to job access.
create or replace function public.cs_portal_field_home(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; v_scope text; v_jobs uuid[]; v_user text; v_job uuid; v_uid uuid; v_slug text;
begin
  select company_id, scope, job_ids, user_name, user_id, slug
    into cid, v_scope, v_jobs, v_user, v_uid, v_slug
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
        'user_forms', (select to_jsonb(f.form_keys) from cs_field_user_forms f
                        where f.user_id = v_uid and f.job_id = j.id))
        order by j.job_number)
        from cs_jobs j
        left join cs_job_form_config c on c.job_id = j.id
        where j.company_id = cid and j.id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
    -- Crew: roster members on these jobs, plus field logins with access to them.
    -- One entry per name; the roster record (and its phone) wins.
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'phone', x.phone) order by lower(x.name))
        from (select distinct on (lower(name)) name, phone
                from (select w.name, w.phone, 0 as pri
                        from cs_workers w
                       where w.company_id = cid and w.active
                         and w.job_id = any(coalesce(v_jobs, '{}'::uuid[]))
                      union all
                      select u.name, null::text, 1
                        from cs_portal_users u
                       where u.slug = v_slug and u.active and coalesce(u.role, 'full') = 'field'
                         and coalesce(u.job_ids, '{}'::uuid[]) && coalesce(v_jobs, '{}'::uuid[])) a
               order by lower(name), pri) x), '[]'::jsonb),
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

revoke all on function public.cs_job_doc_access(text, uuid) from public, anon, authenticated;
revoke all on function public.cs_portal_job_docs(text, uuid) from public;
revoke all on function public.cs_portal_job_doc_path(text, uuid) from public;
revoke all on function public.cs_portal_job_doc_add(text, uuid, text, text, text, text, bigint, text, text, text) from public;
revoke all on function public.cs_portal_job_doc_archive(text, uuid, boolean) from public;
revoke all on function public.cs_portal_field_home(text) from public;
grant execute on function public.cs_portal_job_docs(text, uuid) to anon, authenticated;
grant execute on function public.cs_portal_job_doc_path(text, uuid) to anon, authenticated;
grant execute on function public.cs_portal_job_doc_add(text, uuid, text, text, text, text, bigint, text, text, text) to anon, authenticated;
grant execute on function public.cs_portal_job_doc_archive(text, uuid, boolean) to anon, authenticated;
grant execute on function public.cs_portal_field_home(text) to anon, authenticated;
