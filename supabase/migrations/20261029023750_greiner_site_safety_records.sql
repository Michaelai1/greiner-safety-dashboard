-- Site safety history for field users. This is deliberately NOT the company-wide
-- office dashboard: every read is constrained to one currently assigned job.
-- No account roles, assignments, existing records, or sending queues change.
begin;

create table if not exists public.cs_portal_site_safety_grants (
  user_id uuid not null references public.cs_portal_users(id) on delete cascade,
  job_id uuid not null references public.cs_jobs(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (user_id, job_id)
);
alter table public.cs_portal_site_safety_grants enable row level security;
revoke all on public.cs_portal_site_safety_grants from public, anon, authenticated;

-- Exactly the requested 30: 27 newly added Westin users, one existing
-- Westin lead account, and the 2 newly added IPS 110 users. The other
-- existing IPS foremen are not silently granted broader history access.
do $grant$
declare v_count integer;
begin
  select count(*) into v_count
    from public.cs_portal_users u
    where u.slug = 'greiner' and u.active and u.role = 'field'
      and (
        (u.title = 'Field — Westin Airport Hotel'
          and u.job_ids = array['68e1da81-f5a1-463a-a42e-ff07f4695152'::uuid])
        or (u.title = 'Lead Foreman — Westin Airport Hotel'
          and u.job_ids = array['68e1da81-f5a1-463a-a42e-ff07f4695152'::uuid])
        or (u.title = 'Field — IPS 110'
          and u.job_ids = array['e2a9890b-d468-420a-ae9a-6094a5111d99'::uuid])
      );
  if v_count <> 30 then
    raise exception 'expected 30 exact site users, found %; no grants applied', v_count;
  end if;
end $grant$;

insert into public.cs_portal_site_safety_grants (user_id, job_id)
select u.id, u.job_ids[1]
  from public.cs_portal_users u
 where u.slug = 'greiner' and u.active and u.role = 'field'
   and (
     (u.title = 'Field — Westin Airport Hotel'
       and u.job_ids = array['68e1da81-f5a1-463a-a42e-ff07f4695152'::uuid])
     or (u.title = 'Lead Foreman — Westin Airport Hotel'
       and u.job_ids = array['68e1da81-f5a1-463a-a42e-ff07f4695152'::uuid])
     or (u.title = 'Field — IPS 110'
       and u.job_ids = array['e2a9890b-d468-420a-ae9a-6094a5111d99'::uuid])
   )
on conflict (user_id, job_id) do nothing;

create or replace function public.cs_portal_site_safety(
  p_token text, p_job_id uuid, p_kind text default 'all',
  p_offset integer default 0, p_limit integer default 25
)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_company uuid;
  v_kind text := coalesce(p_kind, 'all');
  v_offset integer := coalesce(p_offset, 0);
  v_limit integer := coalesce(p_limit, 25);
  v_total integer;
  v_items jsonb;
begin
  if p_job_id is null or v_kind not in ('all', 'jha', 'inspection', 'talk')
     or v_offset < 0 or v_offset > 5000 or v_limit < 1 or v_limit > 50 then
    raise exception 'invalid site safety request' using errcode = 'P0001';
  end if;

  select s.company_id into v_company
    from public.cs_portal_sessions s
    join public.cs_portal_users u on u.id = s.user_id and u.slug = s.slug
   where s.token = p_token and s.expires_at > now()
     and s.slug = 'greiner' and s.scope = 'field'
     and u.active and u.role = 'field'
     and p_job_id = any(coalesce(s.job_ids, '{}'::uuid[]))
     and p_job_id = any(coalesce(u.job_ids, '{}'::uuid[]))
     and exists (select 1 from public.cs_portal_site_safety_grants g
                 where g.user_id = u.id and g.job_id = p_job_id);
  if v_company is null or not exists (
    select 1 from public.cs_jobs j where j.id = p_job_id and j.company_id = v_company
  ) then
    raise exception 'job not permitted' using errcode = 'P0001';
  end if;

  with records as (
    select f.id, 'field'::text as source,
      case when f.form_type = 'jha' then 'jha' else 'inspection' end as kind,
      coalesce(nullif(f.form_title, ''), f.form_type, 'Field form') as title,
      f.inspector_name as person, f.submitted_at as occurred_at,
      'Filed'::text as status, f.has_defects, f.defect_count,
      f.pdf_path, f.form_type
    from public.cs_field_submissions f
    where f.company_id = v_company and f.job_id = p_job_id
    union all
    select r.id, 'report'::text,
      case when lower(coalesce(r.form_type, '')) like '%jha%'
                  or lower(coalesce(r.template_code, '')) like '%jha%'
           then 'jha' else 'inspection' end,
      coalesce(nullif(r.template_code, ''), 'Inspection'),
      r.inspector_name, coalesce(r.submitted_at, r.created_at),
      'Filed'::text, r.has_defects, r.defect_count,
      null::text, r.form_type
    from public.cs_reports r
    where r.company_id = v_company and r.job_id = p_job_id
      and coalesce(r.archived, false) = false
    union all
    select t.id, 'talk'::text, 'talk'::text,
      coalesce(nullif(t.talk_title, ''), 'Toolbox Talk'),
      t.recipient_name, coalesce(t.submitted_at, t.opened_at, t.created_at),
      case when t.submitted_at is not null then 'Completed'
           when t.opened_at is not null then 'Link accessed'
           else 'Assigned' end,
      null::boolean, null::integer, null::text, null::text
    from public.cs_tbt_assignments t
    where t.company_id = v_company and t.roster_job_id = p_job_id
      and coalesce(t.is_test, false) = false and t.revoked_at is null
  ), filtered as (
    select * from records where v_kind = 'all' or kind = v_kind
  )
  select count(*)::integer into v_total from filtered;

  with records as (
    select f.id, 'field'::text as source,
      case when f.form_type = 'jha' then 'jha' else 'inspection' end as kind,
      coalesce(nullif(f.form_title, ''), f.form_type, 'Field form') as title,
      f.inspector_name as person, f.submitted_at as occurred_at,
      'Filed'::text as status, f.has_defects, f.defect_count,
      f.pdf_path, f.form_type
    from public.cs_field_submissions f
    where f.company_id = v_company and f.job_id = p_job_id
    union all
    select r.id, 'report'::text,
      case when lower(coalesce(r.form_type, '')) like '%jha%'
                  or lower(coalesce(r.template_code, '')) like '%jha%'
           then 'jha' else 'inspection' end,
      coalesce(nullif(r.template_code, ''), 'Inspection'),
      r.inspector_name, coalesce(r.submitted_at, r.created_at),
      'Filed'::text, r.has_defects, r.defect_count,
      null::text, r.form_type
    from public.cs_reports r
    where r.company_id = v_company and r.job_id = p_job_id
      and coalesce(r.archived, false) = false
    union all
    select t.id, 'talk'::text, 'talk'::text,
      coalesce(nullif(t.talk_title, ''), 'Toolbox Talk'),
      t.recipient_name, coalesce(t.submitted_at, t.opened_at, t.created_at),
      case when t.submitted_at is not null then 'Completed'
           when t.opened_at is not null then 'Link accessed'
           else 'Assigned' end,
      null::boolean, null::integer, null::text, null::text
    from public.cs_tbt_assignments t
    where t.company_id = v_company and t.roster_job_id = p_job_id
      and coalesce(t.is_test, false) = false and t.revoked_at is null
  ), filtered as (
    select * from records where v_kind = 'all' or kind = v_kind
  ), page as (
    select * from filtered order by occurred_at desc nulls last, id desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(page) order by occurred_at desc nulls last, id desc), '[]'::jsonb)
    into v_items from page;

  return jsonb_build_object('job_id', p_job_id, 'kind', v_kind,
    'total', v_total, 'offset', v_offset, 'limit', v_limit,
    'items', coalesce(v_items, '[]'::jsonb));
end $function$;

-- Existing cs_portal_report is company-wide. This separate endpoint opens only
-- an inspection belonging to the signed-in employee's currently assigned job.
create or replace function public.cs_portal_site_report(p_token text, p_report_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_report jsonb;
begin
  select to_jsonb(x) into v_report from (
    select r.id, r.template_code, r.report_date, r.inspector_name,
      r.overall, r.items, r.fields, r.photos, r.has_defects,
      r.defect_count, r.signature_typed, r.job_id, r.created_at
    from public.cs_reports r
    join public.cs_portal_sessions s on s.company_id = r.company_id
    join public.cs_portal_users u on u.id = s.user_id and u.slug = s.slug
    where r.id = p_report_id and s.token = p_token and s.expires_at > now()
      and s.slug = 'greiner' and s.scope = 'field'
      and u.active and u.role = 'field'
      and r.job_id = any(coalesce(s.job_ids, '{}'::uuid[]))
      and r.job_id = any(coalesce(u.job_ids, '{}'::uuid[]))
      and exists (select 1 from public.cs_portal_site_safety_grants g
                  where g.user_id = u.id and g.job_id = r.job_id)
      and coalesce(r.archived, false) = false
  ) x;
  if v_report is null then
    raise exception 'report not found or not permitted' using errcode = 'P0002';
  end if;
  return v_report;
end $function$;

revoke all on function public.cs_portal_site_safety(text,uuid,text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.cs_portal_site_report(text,uuid)
  from public, anon, authenticated;
grant execute on function public.cs_portal_site_safety(text,uuid,text,integer,integer)
  to anon, authenticated;
grant execute on function public.cs_portal_site_report(text,uuid)
  to anon, authenticated;

commit;
