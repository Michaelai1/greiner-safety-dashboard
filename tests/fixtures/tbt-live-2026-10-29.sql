-- Toolbox Talk test schema: the live tables (columns, defaults, checks) and the live function bodies as read
-- from production on Oct 29, 2026 (read only). Fictional data is added by the tests.
create extension if not exists pgcrypto with schema public;
create schema if not exists extensions;
create or replace function extensions.gen_random_bytes(int) returns bytea language sql as $$ select public.gen_random_bytes($1) $$;
create or replace function extensions.digest(text, text) returns bytea language sql as $$ select public.digest($1, $2) $$;
do $$ begin create role anon; exception when others then null; end $$;
do $$ begin create role authenticated; exception when others then null; end $$;

create table cs_companies (id uuid primary key default gen_random_uuid(), name text not null);
create table cs_portals (slug text primary key, company_id uuid not null references cs_companies(id));
create table cs_jobs (id uuid primary key default gen_random_uuid(), company_id uuid not null references cs_companies(id),
  job_number text, name text, status text default 'active');
create table cs_workers (id uuid primary key default gen_random_uuid(), company_id uuid not null, name text not null,
  job_id uuid, classification text, phone text, email text, active boolean default true, source text,
  created_at timestamptz default now());
create table cs_portal_users (id uuid primary key default gen_random_uuid(), slug text, name text, title text,
  pin_hash text, active boolean default true, created_at timestamptz default now(), last_login_at timestamptz,
  role text, job_ids uuid[], mobile text);
create table cs_portal_sessions (token text primary key, company_id uuid, scope text, slug text, expires_at timestamptz);

create table cs_tbt_assignments (id uuid default gen_random_uuid() not null primary key, company_id uuid not null,
  talk_key text not null, talk_title text not null, recipient_name text not null, recipient_phone text,
  week_start date not null, is_test boolean default false not null, token_hash text not null, token_prefix text not null,
  expires_at timestamptz not null, revoked_at timestamptz, opened_at timestamptz, last_active_at timestamptz,
  active_ms integer default 0 not null, sections_viewed integer default 0 not null, format_used text,
  submitted_at timestamptz, created_by text, created_at timestamptz default now() not null,
  role text default 'participant' not null, roster_job_id uuid, presenter text, attendees jsonb, manual_attendees jsonb,
  channel text default 'sms' not null, recipient_email text,
  constraint cs_tbt_assignments_active_ms_check check (active_ms >= 0),
  constraint cs_tbt_assignments_channel_check check (channel = any (array['sms', 'email'])),
  constraint cs_tbt_assignments_destination_check check (((channel = 'sms') and (recipient_phone is not null)) or ((channel = 'email') and (recipient_email is not null))),
  constraint cs_tbt_assignments_format_used_check check (format_used = any (array['doc', 'guided', 'video'])),
  constraint cs_tbt_assignments_recipient_email_check check ((recipient_email is null) or (recipient_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  constraint cs_tbt_assignments_recipient_phone_check check (recipient_phone ~ '^\+1[0-9]{10}$'),
  constraint cs_tbt_assignments_role_check check (role = any (array['participant', 'leader', 'observer'])),
  constraint cs_tbt_assignments_sections_viewed_check check (sections_viewed >= 0),
  constraint cs_tbt_assignments_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'));
create table cs_tbt_sends (id uuid default gen_random_uuid() not null primary key, company_id uuid not null,
  assignment_id uuid not null, to_phone text not null, body text not null, send_at timestamptz not null,
  status text default 'held' not null, request_id bigint, provider_sid text, error text, sent_at timestamptz,
  created_at timestamptz default now() not null);
create table cs_tbt_email_links (id uuid default gen_random_uuid() not null primary key, company_id uuid not null,
  assignment_id uuid not null, to_email text not null, link_url text not null, send_at timestamptz,
  created_at timestamptz default now() not null);
create table cs_tbt_site_links (assignment_id uuid primary key references cs_tbt_assignments(id),
  job_id uuid not null references cs_jobs(id), source_ref text not null, created_at timestamptz not null default now());
create table cs_tbt_choice_messages (send_id uuid, assignment_id uuid, company_id uuid, kind text, recipient_kind text,
  week_start date, talk_key text, created_at timestamptz default now());

CREATE OR REPLACE FUNCTION public.cs_tbt_resolve(p_token text)
 RETURNS cs_tbt_assignments
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select * from cs_tbt_assignments
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and revoked_at is null and expires_at > now()
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.cs_tbt_link_progress(p_token text, p_active_ms integer, p_sections_viewed integer, p_format text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a cs_tbt_assignments;
begin
  a := cs_tbt_resolve(p_token);
  if a.id is null or a.submitted_at is not null then return; end if;
  update cs_tbt_assignments
     set active_ms = greatest(active_ms, least(coalesce(p_active_ms, 0), 86400000)),
         sections_viewed = greatest(sections_viewed, least(coalesce(p_sections_viewed, 0), 1000)),
         format_used = case when p_format in ('doc', 'guided', 'video') then p_format else format_used end,
         last_active_at = now()
   where id = a.id;
end $function$;

CREATE OR REPLACE FUNCTION public.cs_tbt_link_submit(p_token text, p_active_ms integer, p_format text, p_group jsonb DEFAULT NULL::jsonb)
 RETURNS TABLE(submitted_at timestamp with time zone, active_ms integer, attendees_stored boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a cs_tbt_assignments; v_pres text; v_att jsonb; v_man jsonb;
begin
  a := cs_tbt_resolve(p_token);
  if a.id is null then return; end if;
  if a.submitted_at is null then
    if a.role = 'leader' then
      v_pres := nullif(btrim(coalesce(p_group->>'presenter', '')), '');
      v_att := coalesce((select jsonb_agg(left(btrim(x), 120)) from jsonb_array_elements_text(
                 case when jsonb_typeof(p_group->'attendees') = 'array' then p_group->'attendees' else '[]' end) x
                 where btrim(x) <> ''), '[]'::jsonb);
      v_man := coalesce((select jsonb_agg(left(btrim(x), 120)) from jsonb_array_elements_text(
                 case when jsonb_typeof(p_group->'manual') = 'array' then p_group->'manual' else '[]' end) x
                 where btrim(x) <> ''), '[]'::jsonb);
      if v_pres is null or jsonb_array_length(v_att) + jsonb_array_length(v_man) = 0
         or jsonb_array_length(v_att) + jsonb_array_length(v_man) > 300 then
        return;
      end if;
    end if;
    update cs_tbt_assignments x
       set submitted_at = now(),
           active_ms = greatest(x.active_ms, least(coalesce(p_active_ms, 0), 86400000)),
           format_used = case when p_format in ('doc', 'guided', 'video') then p_format else x.format_used end,
           presenter = v_pres, attendees = v_att, manual_attendees = v_man,
           last_active_at = now()
     where x.id = a.id;
  end if;
  return query select x.submitted_at, x.active_ms, x.attendees is not null from cs_tbt_assignments x where x.id = a.id;
end $function$;

CREATE OR REPLACE FUNCTION public.cs_tbt_issue(p_company uuid, p_talk_key text, p_talk_title text, p_name text, p_phone text, p_week date, p_send_at timestamp with time zone, p_is_test boolean, p_site text)
 RETURNS TABLE(assignment_id uuid, send_id uuid, to_last4 text, send_at_local text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_token text; v_aid uuid; v_sid uuid; v_phone text;
begin
  v_phone := '+1' || right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  if v_phone !~ '^\+1[0-9]{10}$' then raise exception 'bad phone'; end if;
  if p_site !~ '^https://' then raise exception 'site must be https'; end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, week_start,
                                  is_test, token_hash, token_prefix, expires_at, created_by)
  values (p_company, p_talk_key, p_talk_title, p_name, v_phone, p_week, coalesce(p_is_test, false),
          encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 6), p_send_at + interval '14 days',
          'operator')
  returning id into v_aid;
  insert into cs_tbt_sends (company_id, assignment_id, to_phone, body, send_at, status)
  values (p_company, v_aid, v_phone,
          'Greiner Brothers Toolbox Talk: ' || p_talk_title || '. Please review it and confirm here: ' ||
            p_site || '#' || v_token,
          p_send_at, 'held')
  returning id into v_sid;
  return query select v_aid, v_sid, right(v_phone, 4),
    to_char(p_send_at at time zone 'America/Indiana/Indianapolis', 'Dy Mon DD YYYY HH12:MI AM') || ' Indianapolis';
end $function$;

CREATE OR REPLACE FUNCTION public.cs_tbt_issue_email(p_company uuid, p_talk_key text, p_talk_title text, p_name text, p_email text, p_week date, p_is_test boolean, p_site text, p_send_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(assignment_id uuid, link_url text, email_masked text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_token text; v_aid uuid; v_email text; v_link text; v_local text; v_domain text;
begin
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'bad email'; end if;
  if p_site !~ '^https://' then raise exception 'site must be https'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name required'; end if;
  v_token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
  v_link := p_site || '#' || v_token;
  insert into cs_tbt_assignments (company_id, talk_key, talk_title, recipient_name, recipient_phone, recipient_email, channel,
                                  week_start, is_test, token_hash, token_prefix, expires_at, created_by)
  values (p_company, p_talk_key, p_talk_title, p_name, null, v_email, 'email',
          p_week, coalesce(p_is_test, false),
          encode(extensions.digest(v_token, 'sha256'), 'hex'), left(v_token, 6),
          (p_week::timestamp at time zone 'America/Indiana/Indianapolis') + interval '21 days',
          'operator')
  returning id into v_aid;
  insert into cs_tbt_email_links (company_id, assignment_id, to_email, link_url, send_at)
  values (p_company, v_aid, v_email, v_link, p_send_at);
  v_local := split_part(v_email, '@', 1); v_domain := split_part(v_email, '@', 2);
  return query select v_aid, v_link, left(v_local, 1) || repeat('*', greatest(2, length(v_local) - 1)) || '@' || v_domain;
end $function$;

-- Live link-open (before this change), replaced by the migration.
CREATE OR REPLACE FUNCTION public.cs_tbt_link_open(p_token text)
 RETURNS TABLE(company text, talk_key text, talk_title text, recipient_name text, week_start date, already_done boolean, submitted_at timestamp with time zone, role text, group_label text, roster jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a cs_tbt_assignments; v_label text; v_roster jsonb := '[]'::jsonb;
begin
  a := cs_tbt_resolve(p_token);
  if a.id is null then return; end if;
  update cs_tbt_assignments set opened_at = coalesce(opened_at, now()), last_active_at = now() where id = a.id;
  if a.role = 'leader' and a.roster_job_id is not null then
    select j.name || ' (' || j.job_number || ')' into v_label from cs_jobs j
     where j.id = a.roster_job_id and j.company_id = a.company_id;
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
  return query select c.name, a.talk_key, a.talk_title, a.recipient_name, a.week_start,
                      a.submitted_at is not null, a.submitted_at, a.role, v_label, v_roster
                 from cs_companies c where c.id = a.company_id;
end $function$;

CREATE OR REPLACE FUNCTION public.cs_tbt_choice_link_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.role = 'observer' and old.submitted_at is null and new.submitted_at is not null then
    raise exception 'This is a view-only copy of the talk. A supervisor records attendance.' using errcode = 'P0001';
  end if;
  if new.role = 'leader' and old.submitted_at is null and new.submitted_at is not null then
    begin
      update cs_tbt_sends s set status = 'cancelled', error = 'not needed: attendance was recorded'
        from cs_tbt_choice_messages m
       where m.send_id = s.id and m.kind = 'reminder' and m.week_start = new.week_start and m.talk_key = new.talk_key
         and s.company_id = '3da7dc46-30d3-4870-bbd9-a85bd2227a3c'::uuid and s.status in ('held', 'scheduled');
    exception when others then
      raise warning 'Choice reminder cancel failed; attendance is still recorded: %', sqlerrm;
    end;
  end if;
  return new;
end $function$;
create trigger cs_tbt_choice_link_guard before update on cs_tbt_assignments
  for each row execute function cs_tbt_choice_link_guard();
