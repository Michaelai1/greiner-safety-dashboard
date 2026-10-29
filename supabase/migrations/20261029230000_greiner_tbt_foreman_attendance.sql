-- Toolbox Talks: the agreed attendance role belongs to the person and job, not to the delivery channel.
--
-- Oct 29, 2026: the Oct 26 week's email batches were issued through cs_tbt_issue_email, which has no role or
-- crew parameter, so every foreman got an individual ("participant") link with no crew list. The text batches
-- earlier in October were turned into foreman links by a separate step that the email batches never ran.
-- Tony, Oct 29: the foremen account for their crews.
--
-- 1. cs_tbt_attendance_roles: who records crew attendance (leader) or completes alone (participant), per
--    person and job, with the source. documents_only marks people who must never be sent a video
--    (Tony, Oct 29: Westin, Roger Hurst and Matt Logan).
-- 2. cs_tbt_assignment_rules (trigger): a non-test talk record for a person with an agreed role must match it
--    (role, and the crew job for a leader); a documents-only person's record must declare talk_format 'doc'.
--    Any path that would drop the role (an old issue function, a hand-written insert, a channel change) is refused.
-- 3. cs_tbt_issue_foreman: one record per person per talk and week, delivered by text, email or both with the
--    SAME link, so a person reached on two channels has one attendance record.
-- 4. cs_tbt_crew_lists + cs_tbt_link_open: a job can carry a verified crew list; when it has one, a foreman's
--    link shows that list instead of the older roster union. Jobs without a list are unchanged.
begin;

create table if not exists public.cs_tbt_attendance_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.cs_companies(id),
  job_id uuid not null references public.cs_jobs(id),
  recipient_name text not null check (btrim(recipient_name) <> ''),
  role text not null check (role in ('leader', 'participant')),
  documents_only boolean not null default false,
  source_ref text not null check (btrim(source_ref) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists cs_tbt_attendance_roles_person_job
  on public.cs_tbt_attendance_roles (company_id, lower(btrim(recipient_name)), job_id);
alter table public.cs_tbt_attendance_roles enable row level security;
revoke all on public.cs_tbt_attendance_roles from public, anon, authenticated;

create table if not exists public.cs_tbt_crew_lists (
  job_id uuid not null references public.cs_jobs(id),
  name text not null check (btrim(name) <> ''),
  source_ref text not null check (btrim(source_ref) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists cs_tbt_crew_lists_job_name on public.cs_tbt_crew_lists (job_id, lower(btrim(name)));
alter table public.cs_tbt_crew_lists enable row level security;
revoke all on public.cs_tbt_crew_lists from public, anon, authenticated;

alter table public.cs_tbt_assignments add column if not exists talk_format text
  check (talk_format is null or talk_format in ('doc', 'video'));

create or replace function public.cs_tbt_assignment_rules()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_has boolean := false; v_ok boolean := false; v_agreed text;
begin
  for r in select ar.role, ar.job_id, ar.documents_only, ar.source_ref, j.job_number
             from cs_tbt_attendance_roles ar join cs_jobs j on j.id = ar.job_id
            where ar.company_id = new.company_id
              and lower(btrim(ar.recipient_name)) = lower(btrim(new.recipient_name)) loop
    v_has := true;
    if r.documents_only and coalesce(new.talk_format, '') <> 'doc' then
      raise exception 'REFUSED: % receives document talks only (%). A video, or a talk without a declared format, cannot be queued for them.',
        new.recipient_name, r.source_ref using errcode = 'P0001';
    end if;
    if new.role = r.role and (r.role <> 'leader' or new.roster_job_id is not distinct from r.job_id) then
      v_ok := true;
    end if;
    v_agreed := coalesce(v_agreed || ', ', '') || r.role || ' on ' || r.job_number;
  end loop;
  if v_has and not v_ok and not coalesce(new.is_test, false) then
    raise exception 'REFUSED: % has an agreed Toolbox Talk role (%); this % record does not match it. Issue it with cs_tbt_issue_foreman.',
      new.recipient_name, v_agreed, new.role using errcode = 'P0001';
  end if;
  return new;
end $function$;
revoke all on function public.cs_tbt_assignment_rules() from public, anon, authenticated;

drop trigger if exists cs_tbt_assignment_rules on public.cs_tbt_assignments;
create trigger cs_tbt_assignment_rules
  before insert or update of role, roster_job_id, talk_key, talk_format, recipient_name, is_test
  on public.cs_tbt_assignments for each row execute function public.cs_tbt_assignment_rules();

create or replace function public.cs_tbt_issue_foreman(
  p_company uuid, p_job uuid, p_name text, p_talk_key text, p_talk_title text, p_talk_format text,
  p_week date, p_send_at timestamptz, p_site text, p_phone text default null, p_email text default null,
  p_batch text default null)
 returns table(assignment_id uuid, role text, sms_send_id uuid, email_link_id uuid, email_masked text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_role text; v_phone text; v_email text; v_token text; v_link text; v_aid uuid; v_sid uuid; v_eid uuid;
begin
  if p_company is distinct from (select company_id from cs_portals where slug = 'greiner') then
    raise exception 'REFUSED: cs_tbt_issue_foreman sends Greiner Brothers messages only';
  end if;
  if p_talk_format is null or p_talk_format not in ('doc', 'video') then raise exception 'talk format must be doc or video'; end if;
  if coalesce(btrim(p_talk_key), '') = '' or coalesce(btrim(p_talk_title), '') = '' then raise exception 'talk key and title required'; end if;
  if p_site is null or p_site !~ '^https://' then raise exception 'site must be https'; end if;
  if p_send_at is null or p_send_at <= now() then raise exception 'send time must be in the future'; end if;
  if p_week is null or extract(isodow from p_week) <> 1 then raise exception 'week must be a Monday'; end if;
  if not exists (select 1 from cs_jobs j where j.id = p_job and j.company_id = p_company and coalesce(j.status, 'active') = 'active') then
    raise exception 'REFUSED: that job is not an active job of this company';
  end if;
  select ar.role into v_role from cs_tbt_attendance_roles ar
   where ar.company_id = p_company and ar.job_id = p_job and lower(btrim(ar.recipient_name)) = lower(btrim(p_name));
  if v_role is null then
    raise exception 'REFUSED: no agreed Toolbox Talk role for % on this job; record it in cs_tbt_attendance_roles first', p_name;
  end if;
  if nullif(btrim(coalesce(p_phone, '')), '') is not null then
    v_phone := '+1' || right(regexp_replace(p_phone, '\D', '', 'g'), 10);
    if v_phone !~ '^\+1[0-9]{10}$' then raise exception 'bad phone'; end if;
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    v_email := lower(btrim(p_email));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'bad email'; end if;
  end if;
  if v_phone is null and v_email is null then raise exception 'a phone or an email is required'; end if;
  if exists (select 1 from cs_tbt_assignments a
              where a.company_id = p_company and lower(btrim(a.recipient_name)) = lower(btrim(p_name))
                and a.talk_key = p_talk_key and a.week_start = p_week and a.revoked_at is null and not a.is_test) then
    raise exception 'REFUSED: % already has % for the week of %', p_name, p_talk_key, p_week;
  end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_link := p_site || '#' || v_token;
  insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, recipient_email,
                                  channel, role, roster_job_id, talk_format, week_start, is_test,
                                  token_hash, token_prefix, expires_at, created_by)
  values (p_company, p_talk_key, p_talk_title, btrim(p_name), v_phone, v_email,
          case when v_phone is not null then 'sms' else 'email' end, v_role,
          case when v_role = 'leader' then p_job end, p_talk_format, p_week, false,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 6),
          greatest(p_send_at + interval '14 days', (p_week::timestamp at time zone 'America/Indiana/Indianapolis') + interval '21 days'),
          'operator foreman' || coalesce(' batch ' || p_batch, ''))
  returning id into v_aid;
  if v_role <> 'leader' then
    insert into cs_tbt_site_links (assignment_id, job_id, source_ref)
    values (v_aid, p_job, 'cs_tbt_issue_foreman' || coalesce(' batch ' || p_batch, ''));
  end if;
  if v_phone is not null then
    insert into cs_tbt_sends (company_id, assignment_id, to_phone, body, send_at, status)
    values (p_company, v_aid, v_phone,
            'Greiner Brothers Toolbox Talk: ' || p_talk_title || '. Please review it and confirm here: ' || v_link,
            p_send_at, 'held')
    returning id into v_sid;
  end if;
  if v_email is not null then
    insert into cs_tbt_email_links (company_id, assignment_id, to_email, link_url, send_at)
    values (p_company, v_aid, v_email, v_link, p_send_at)
    returning id into v_eid;
  end if;
  return query select v_aid, v_role, v_sid, v_eid,
    case when v_email is null then null else left(split_part(v_email, '@', 1), 1) || '***@' || split_part(v_email, '@', 2) end;
end $function$;
revoke all on function public.cs_tbt_issue_foreman(uuid, uuid, text, text, text, text, date, timestamptz, text, text, text, text)
  from public, anon, authenticated;

-- Same as live, except a job with a verified crew list shows that list.
create or replace function public.cs_tbt_link_open(p_token text)
 returns table(company text, talk_key text, talk_title text, recipient_name text, week_start date, already_done boolean, submitted_at timestamp with time zone, role text, group_label text, roster jsonb)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare a cs_tbt_assignments; v_label text; v_roster jsonb := '[]'::jsonb;
begin
  a := cs_tbt_resolve(p_token);
  if a.id is null then return; end if;
  update cs_tbt_assignments set opened_at = coalesce(opened_at, now()), last_active_at = now() where id = a.id;
  if a.role = 'leader' and a.roster_job_id is not null then
    select j.name || ' (' || j.job_number || ')' into v_label from cs_jobs j
     where j.id = a.roster_job_id and j.company_id = a.company_id;
    if exists (select 1 from cs_tbt_crew_lists c join cs_jobs j on j.id = c.job_id
                where c.job_id = a.roster_job_id and j.company_id = a.company_id) then
      select coalesce(jsonb_agg(x.name order by lower(x.name)), '[]'::jsonb) into v_roster
        from (select distinct on (lower(btrim(c.name))) btrim(c.name) as name from cs_tbt_crew_lists c
               where c.job_id = a.roster_job_id order by lower(btrim(c.name))) x;
    else
      select coalesce(jsonb_agg(x.name order by lower(x.name)), '[]'::jsonb) into v_roster
        from (select distinct on (lower(n)) n as name from (
                select w.name as n from cs_workers w
                 where w.company_id = a.company_id and w.active and w.job_id = a.roster_job_id
                union all
                select u.name from cs_portal_users u
                 where u.slug = 'greiner' and u.active and coalesce(u.role, 'full') = 'field'
                   and a.roster_job_id = any(coalesce(u.job_ids, '{}'::uuid[]))
                   and a.company_id = '8ca1fccf-ffc2-49c9-b4ca-a7ba35e124b2') y
              order by lower(n)) x;
    end if;
  end if;
  return query select c.name, a.talk_key, a.talk_title, a.recipient_name, a.week_start,
                      a.submitted_at is not null, a.submitted_at, a.role, v_label, v_roster
                 from cs_companies c where c.id = a.company_id;
end $function$;

commit;
