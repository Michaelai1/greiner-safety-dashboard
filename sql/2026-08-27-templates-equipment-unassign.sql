-- Pilot workflow connections: GC/job templates, minimal equipment backend,
-- safe remove-from-job. Applied to production 2026-08-27.

-- ============ 1. Minimal equipment registry (backend-ready, no UI writes yet)
create table if not exists cs_equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  unit_number text not null,
  equipment_type text,
  job_id uuid references cs_jobs(id),
  qr_slug text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, unit_number)
);
alter table cs_equipment enable row level security;  -- no policies: definer-RPC access only

-- ============ 2. GC / job-specific form templates
create table if not exists cs_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  name text not null,
  form_type text not null,           -- JHA / Hot Work Permit / Aerial / Forklift / Other
  gc_name text,                      -- e.g. Shiel Sexton, Meyer Najem
  job_ids uuid[],                    -- null or {} = company-wide; else specific jobs
  doc_id uuid references cs_company_docs(id) on delete set null,  -- source file
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table cs_templates enable row level security;

-- ============ 3. Remove a worker from their job (assignment only — the worker,
-- their training, and their history all remain).
create or replace function public.cs_portal_worker_unassign(
  p_token text, p_worker_id uuid
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  update cs_workers set job_id = null
   where id = p_worker_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_worker_unassign(text, uuid) from public;
grant execute on function public.cs_portal_worker_unassign(text, uuid) to anon, authenticated;

-- ============ 4. Template admin RPCs (full scope only)
create or replace function public.cs_portal_template_add(
  p_token text, p_name text, p_form_type text,
  p_gc text default null, p_job_ids uuid[] default null,
  p_doc_id uuid default null, p_active boolean default true
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_id uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if nullif(btrim(p_name), '') is null then
    return json_build_object('ok', false, 'error', 'name_required');
  end if;
  if p_job_ids is not null and array_length(p_job_ids, 1) is not null and exists (
      select 1 from unnest(p_job_ids) j
      where not exists (select 1 from cs_jobs where id = j and company_id = v_cid)) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  if p_doc_id is not null and not exists (
      select 1 from cs_company_docs where id = p_doc_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_doc');
  end if;
  insert into cs_templates (company_id, name, form_type, gc_name, job_ids, doc_id, active)
  values (v_cid, btrim(p_name), btrim(coalesce(p_form_type, 'Other')),
          nullif(btrim(coalesce(p_gc, '')), ''), p_job_ids, p_doc_id, coalesce(p_active, true))
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cs_portal_template_add(text, text, text, text, uuid[], uuid, boolean) from public;
grant execute on function public.cs_portal_template_add(text, text, text, text, uuid[], uuid, boolean) to anon, authenticated;

create or replace function public.cs_portal_template_update(
  p_token text, p_template_id uuid,
  p_name text default null, p_form_type text default null,
  p_gc text default null, p_job_ids uuid[] default null,
  p_doc_id uuid default null, p_active boolean default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if p_job_ids is not null and array_length(p_job_ids, 1) is not null and exists (
      select 1 from unnest(p_job_ids) j
      where not exists (select 1 from cs_jobs where id = j and company_id = v_cid)) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  update cs_templates set
    name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
    form_type = coalesce(nullif(btrim(coalesce(p_form_type, '')), ''), form_type),
    gc_name = case when p_gc is null then gc_name else nullif(btrim(p_gc), '') end,
    job_ids = coalesce(p_job_ids, job_ids),
    doc_id = coalesce(p_doc_id, doc_id),
    active = coalesce(p_active, active)
  where id = p_template_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_template_update(text, uuid, text, text, text, uuid[], uuid, boolean) from public;
grant execute on function public.cs_portal_template_update(text, uuid, text, text, text, uuid[], uuid, boolean) to anon, authenticated;

create or replace function public.cs_portal_template_delete(
  p_token text, p_template_id uuid
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  delete from cs_templates where id = p_template_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_template_delete(text, uuid) from public;
grant execute on function public.cs_portal_template_delete(text, uuid) to anon, authenticated;

-- ============ 5. Bundle: add real equipment + gc_templates (same shape as before,
-- two new keys; everything else byte-identical to the prior definition).
create or replace function public.cs_portal_bundle(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $$
declare cid uuid;
begin
  cid := cs_portal_cid(p_token, 'full');
  return jsonb_build_object(
    'company', (select jsonb_build_object('id', id, 'name', name) from cs_companies where id = cid),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'job_number', job_number, 'name', name, 'address', address,
        'status', status, 'start_date', start_date,
        'foreman_name', foreman_name, 'foreman_phone', foreman_phone,
        'pm_name', pm_name, 'gc_name', gc_name)
        order by job_number desc) from cs_portal_visible_jobs(cid)), '[]'::jsonb),
    'reports', coalesce((select jsonb_agg(
        (jsonb_build_object(
          'id', id, 'template_code', template_code, 'report_date', report_date,
          'inspector_name', inspector_name, 'overall', overall, 'job_id', job_id,
          'has_defects', has_defects, 'defect_count', defect_count, 'created_at', created_at,
          'submitted_at', submitted_at, 'items', items)
          || coalesce(fields, '{}'::jsonb))
        order by report_date desc, created_at desc) from cs_reports where company_id = cid), '[]'::jsonb),
    'certs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'worker', worker, 'cert_type', cert_type, 'issued', issued,
        'expires', expires, 'notes', notes)
        order by worker, cert_type) from cs_worker_certs where company_id = cid), '[]'::jsonb),
    'workers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'job_id', job_id, 'classification', classification,
        'phone', phone, 'email', email, 'active', active)
        order by name) from cs_workers where company_id = cid and active), '[]'::jsonb),
    'stats', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'year', year, 'recordables', recordables, 'dart_cases', dart_cases,
        'deaths', deaths, 'total_hours', total_hours, 'emr', emr)
        order by year desc) from cs_safety_stats where company_id = cid), '[]'::jsonb),
    'docs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'category', category, 'filename', filename, 'path', path,
        'size_bytes', size_bytes, 'created_at', created_at)
        order by created_at desc) from cs_company_docs where company_id = cid), '[]'::jsonb),
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'unit_number', unit_number, 'equipment_type', equipment_type,
        'job_id', job_id, 'qr_slug', qr_slug, 'active', active)
        order by unit_number) from cs_equipment where company_id = cid), '[]'::jsonb),
    'gc_templates', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'form_type', form_type, 'gc_name', gc_name,
        'job_ids', coalesce(to_jsonb(job_ids), '[]'::jsonb), 'doc_id', doc_id,
        'active', active, 'created_at', created_at)
        order by created_at desc) from cs_templates where company_id = cid), '[]'::jsonb)
  );
end $$;
