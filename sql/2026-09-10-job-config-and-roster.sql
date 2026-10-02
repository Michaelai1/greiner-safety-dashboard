-- ============================================================================
-- Per-job form configuration + field-home roster/config exposure.
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety). Run in Supabase SQL Editor.
-- PREPARED 2026-09-10, NOT YET APPLIED (Supabase connector unauthorized).
--
-- Additive and backward compatible. Until this runs, the phone/QR clients fall
-- back to their prior behavior (no roster autocomplete, hot work shown on every
-- job, manual hot-work location) — so nothing regresses if it is not yet run.
--
-- Drives, with NO code changes per job:
--   * People autocomplete (#1): field_home returns the job's roster.
--   * Hot-work exclusion for Meyer/Taylorsville (#3): external_hotwork hides the
--     Greiner hot work permit on that job (Taylorsville uses Meyer's QR).
--   * Hot-work location hierarchy (#3): hotwork_locations config per job.
--   * Per-job form/permit availability (#6/#7/#8): enabled_forms / enabled_permits.
--
-- Waiting on Tony (leave NULL/[] until he answers — see items 2,3,4,6 in brief):
--   confined space / excavation jobs, inspection matrix, hot-work floor values.
-- ============================================================================

begin;

-- 1. One config row per job (all optional; absent row = all defaults).
create table if not exists public.cs_job_form_config (
  job_id            uuid primary key references public.cs_jobs(id) on delete cascade,
  external_hotwork  boolean not null default false,   -- true = GC handles hot work (hide Greiner permit)
  hotwork_locations jsonb   not null default '[]'::jsonb, -- [{building, floors:[..]}]
  enabled_forms     text[],                            -- null = all default Greiner forms; else allow-list
  enabled_permits   text[],                            -- e.g. {confined_space, excavation} per job
  updated_at        timestamptz not null default now()
);
alter table public.cs_job_form_config enable row level security;  -- definer-RPC access only

-- 2. field_home: expose the job's roster + config (server-scoped to the session's
--    job_ids). BYTE-IDENTICAL to the live definition except the two new keys and
--    the per-job config join — verified against production output 2026-09-10.
create or replace function public.cs_portal_field_home(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; v_scope text; v_jobs uuid[]; v_user text; v_job uuid;
begin
  select company_id, scope, job_ids, user_name
    into cid, v_scope, v_jobs, v_user
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
        'enabled_permits', to_jsonb(c.enabled_permits))
        order by j.job_number)
        from cs_jobs j
        left join cs_job_form_config c on c.job_id = j.id
        where j.company_id = cid and j.id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
    -- job roster for person autocomplete: active workers on the user's job(s)
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

-- 3. Taylorsville (C808) — Meyer handles hot work: hide the Greiner permit.
--    (Purdue C800 left default: Greiner hot work applies, per Shiel Sexton.)
insert into public.cs_job_form_config (job_id, external_hotwork)
values ('8b51bcdd-a67b-47ab-a27b-5fa7c6daad31', true)
on conflict (job_id) do update set external_hotwork = true, updated_at = now();

commit;

-- ── Verify ──────────────────────────────────────────────────────────────────
select j.job_number, j.name, c.external_hotwork, c.enabled_forms, c.enabled_permits
  from cs_jobs j left join cs_job_form_config c on c.job_id = j.id
 where j.company_id = (select id from cs_companies where name = 'Greiner Brothers')
 order by j.job_number;
-- Expect: C808 external_hotwork = true; all others null/false.

-- ── Later, when Tony sends values (examples — DO NOT run until confirmed): ────
-- Hot-work floors for Purdue:
--   update cs_job_form_config set hotwork_locations =
--     '[{"building":"Academic Building","floors":["1","2","3","Roof"]}]'::jsonb
--   where job_id = '87906cbc-1809-4d56-b4e1-7973562221b2';
-- Confined space / excavation on a job:
--   insert into cs_job_form_config (job_id, enabled_permits) values ('<job>', '{confined_space}')
--     on conflict (job_id) do update set enabled_permits = excluded.enabled_permits;
