-- ============================================================================
-- Greiner Purdue pilot — minimal field-inspection expectation model.
-- APPLIED TO PROD 2026-08-26 (migration: greiner_field_expectations).
--
-- An expectation row means: "this person is expected to complete this form on
-- this job today (per recurrence)". A missing submission is ONLY reported when
-- such a row exists and no qualifying submission matches it — expectations are
-- never inferred. No rows are seeded by this migration.
--
-- Matching is by IDs (company_id + job_id + user_id + form_type) within the
-- Indiana calendar day, never by display name.
-- ============================================================================

create table if not exists public.cs_field_expectations (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references public.cs_companies(id),
  job_id uuid not null references public.cs_jobs(id),
  user_id uuid not null references public.cs_portal_users(id),
  form_type text not null check (form_type in ('jha','hot_work_permit','aerial_platform','forklift')),
  recurrence text not null default 'daily' check (recurrence in ('daily','weekdays')),
  due_time time,                       -- optional, Indiana local time
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.cs_field_expectations enable row level security;  -- no policies: RPC-only access

-- Full-scope read: today's expectations (Indiana day) each with its qualifying
-- submission. Field sessions are rejected by cs_portal_cid(..., 'full').
create or replace function public.cs_portal_expected_today(p_token text)
returns jsonb language plpgsql stable security definer
set search_path to 'public','extensions'
as $function$
declare cid uuid; d date;
begin
  cid := cs_portal_cid(p_token, 'full');
  d := (now() at time zone 'America/Indiana/Indianapolis')::date;
  return jsonb_build_object(
    'day', d,
    'configured', exists(select 1 from cs_field_expectations e where e.company_id = cid and e.active),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'job_id', e.job_id, 'job_name', j.name, 'job_number', j.job_number,
        'user_id', e.user_id, 'user_name', u.name,
        'form_type', e.form_type, 'due_time', e.due_time, 'recurrence', e.recurrence,
        'submission_id', s.id, 'submitted_at', s.submitted_at,
        'has_defects', s.has_defects, 'defect_count', s.defect_count)
        order by (s.id is null) desc, e.due_time asc nulls last, u.name)
      from cs_field_expectations e
      join cs_jobs j on j.id = e.job_id
      join cs_portal_users u on u.id = e.user_id
      left join lateral (
        select s2.id, s2.submitted_at, s2.has_defects, s2.defect_count
          from cs_field_submissions s2
         where s2.company_id = e.company_id and s2.job_id = e.job_id
           and s2.user_id = e.user_id and s2.form_type = e.form_type
           and (s2.submitted_at at time zone 'America/Indiana/Indianapolis')::date = d
         order by s2.submitted_at desc limit 1) s on true
      where e.company_id = cid and e.active
        and (e.recurrence = 'daily'
             or (e.recurrence = 'weekdays' and extract(isodow from d) < 6))
      ), '[]'::jsonb));
end $function$;

-- Job-explicit field ticket. A FULL session may narrow itself to a single-job
-- field ticket (scope DOWN, never up) so Tony can open the field forms for a
-- chosen job. A FIELD session may only name a job it already owns. The
-- original 1-arg field-only overload is unchanged.
create or replace function public.cs_portal_field_ticket(p_token text, p_job_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','extensions'
as $function$
declare s record; tk text;
begin
  select company_id, scope, slug, job_ids, user_id, user_name into s
    from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if p_job_id is null then raise exception 'job required' using errcode = 'P0001'; end if;
  if s.scope = 'field' then
    if not (p_job_id = any(coalesce(s.job_ids, '{}'::uuid[]))) then
      raise exception 'job not permitted for this user' using errcode = 'P0001';
    end if;
  elsif s.scope <> 'full' then
    raise exception 'insufficient scope' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cs_jobs where id = p_job_id and company_id = s.company_id) then
    raise exception 'unknown job' using errcode = 'P0001';
  end if;
  tk := 'ft_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into cs_portal_sessions (token, company_id, scope, slug, expires_at, user_id, user_name, job_ids)
  values (tk, s.company_id, 'field', s.slug, now() + interval '12 hours', s.user_id, s.user_name, array[p_job_id]);
  return jsonb_build_object('ticket', tk, 'user', s.user_name, 'expires_at', now() + interval '12 hours');
end $function$;

-- Add / retire expectations (examples — run with real values only):
-- insert into cs_field_expectations (company_id, job_id, user_id, form_type, recurrence, due_time)
-- values ('<company>', '<job>', '<user>', 'aerial_platform', 'daily', '07:00');
-- update cs_field_expectations set active = false where id = '<id>';