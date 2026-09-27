-- ============================================================================
-- READ-ONLY AUDIT: which jobs require which inspection forms
--
-- Project: gvfolfzseqwhhimbxgjv  (Creekside = PRODUCTION)
--   Sanity check before running: the Table Editor should show cs_jobs.
--   If it does not, you are in the wrong project — tunkyqkgqzkgrbgrtroy is the
--   old ToolGuard QR project and is NOT production.
--
-- SELECT only. No INSERT, UPDATE, DELETE or DDL anywhere in this file.
-- Purpose: confirm the denominator behind Daily Safety Compliance before the
-- Analytics interface is merged into the live dashboard.
-- ============================================================================

-- 1. Effective per-job form assignment, as the dashboard computes it.
--    A form is expected on a job when at least one field-login user on that
--    job may open it. form_keys NULL means "all default forms".
select
  j.id                                         as job_id,
  j.name                                       as job,
  j.status,
  count(distinct fu.user_id)                   as field_users,
  array_agg(distinct k order by k)
    filter (where k is not null)                as forms_assigned
from cs_jobs j
left join cs_field_user_forms fu on fu.job_id = j.id
left join lateral unnest(
  coalesce(fu.form_keys, array['hotwork','aerial','forklift','jha','jobsiteanalysis'])
) as k on true
where coalesce(j.archived, false) = false
group by j.id, j.name, j.status
order by j.name;

-- 2. Job-level rules, which intersect with the per-user rules above.
select job_id, enabled_forms, external_hotwork
from cs_job_form_config
order by job_id;

-- 3. What each field user may actually open, per job.
select
  fu.job_id, j.name as job, fu.user_id, u.name as field_user,
  case when fu.form_keys is null then 'ALL DEFAULTS' else array_to_string(fu.form_keys, ', ') end
    as may_open
from cs_field_user_forms fu
left join cs_jobs j on j.id = fu.job_id
left join cs_field_users u on u.id = fu.user_id
order by j.name, u.name;

-- 4. What was ACTUALLY submitted in the last 4 weeks, per job per form.
--    Compare against 1 to see whether the assignment matches reality.
select
  s.job_id, j.name as job, s.form_type,
  count(*)                                     as submissions,
  count(distinct date(s.submitted_at))         as days_with_a_submission,
  min(date(s.submitted_at))                    as first_seen,
  max(date(s.submitted_at))                    as last_seen
from cs_field_submissions s
left join cs_jobs j on j.id = s.job_id
where s.submitted_at >= now() - interval '28 days'
group by s.job_id, j.name, s.form_type
order by j.name, s.form_type;

-- 5. Jobs with an assignment but NO submissions in 28 days.
--    These are the rows that would drive "missed" in compliance.
select j.name as job, 'assigned but nothing submitted in 28 days' as note
from cs_jobs j
where coalesce(j.archived, false) = false
  and exists (select 1 from cs_field_user_forms fu where fu.job_id = j.id)
  and not exists (
    select 1 from cs_field_submissions s
    where s.job_id = j.id and s.submitted_at >= now() - interval '28 days')
order by j.name;

-- 6. Any form_key in the data that the field app does not support.
--    Anything returned here cannot be scheduled or counted.
select distinct k as unsupported_form_key
from cs_field_user_forms fu, unnest(fu.form_keys) k
where k not in ('hotwork','aerial','forklift','jha','jobsiteanalysis');
