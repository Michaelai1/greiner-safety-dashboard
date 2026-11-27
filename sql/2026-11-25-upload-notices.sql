-- ============================================================================
-- DRAFT, NOT RUN. Upload notices: tell Michael when the Greiner office uploads something.
-- Written Nov 25, 2026 after the Tony meeting. Michael runs this himself in the SQL editor.
--
-- Why: today nobody is told when Tony uploads a document (Documents, any folder), a job document
-- (a job's Job documents) or a talk (Toolbox Talks > Talk Library). Tony said in the meeting he will
-- "just drop them" there and expects ConfirmSafety to notice.
--
-- What it adds (add-only; no existing table, function, trigger or job is changed or dropped):
--   cs_upload_notices            one row per uploaded file of the Greiner company: what, where, who, when,
--                                and whether the email about it went out. Filled by two triggers.
--   cs_upload_notice_settings    one row: email on/off, who gets it, and which email service to use.
--   trigger cs_upload_notice     AFTER INSERT on cs_company_docs and on cs_job_docs. It only records a row;
--                                it can never stop or slow an upload (any error is caught and skipped).
--   cs_upload_notice_send()      gathers the recorded rows into ONE email and hands it to the email service.
--                                Run every 10 minutes by pg_cron, but only after the switch-on file
--                                (2026-11-25-upload-notices-switch-on.sql). Until then nothing is sent.
--
-- Talks: a Talk Library upload is a file in the Documents store (folder "Toolbox Talks") plus a
--   cs_tbt_library row. The document trigger records it; the email shows the talk name and category from
--   cs_tbt_library. So install the Talk Library (2026-11-25-tbt-talk-library.sql) FIRST.
--
-- Email path: the one already proven in this database. The Pipeline review email (installed Nov 15) posts
--   to Michael's n8n webhook, which sends through Gmail; n8n sends to the "to" address in the message.
--   This file copies that webhook address and header name from the Pipeline settings (cs_program_settings)
--   and uses the SAME Vault secret by name (cs_pipeline_email_key). No key, no address and no URL is
--   written in this file.
--
-- Only the Greiner company (portal slug 'greiner') is recorded. Creekside's own clients, Choice and the
--   Pipeline test company are not. Peine is a separate database and is not touched.
--
-- Safe to run twice.
-- ============================================================================

begin;

do $$
begin
  -- Wrong-project guard: the shared Greiner/Creekside database, with the Talk Library installed first.
  if to_regclass('public.cs_company_docs') is null
     or to_regclass('public.cs_job_docs') is null
     or to_regclass('public.cs_portals') is null
     or to_regclass('public.cs_jobs') is null then
    raise exception 'WRONG PROJECT: the Greiner document tables are not here. Nothing was changed.';
  end if;
  if not exists (select 1 from public.cs_portals where slug = 'greiner') then
    raise exception 'WRONG PROJECT: no "greiner" portal here. Nothing was changed.';
  end if;
  if to_regclass('public.cs_tbt_library') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'cs_tbt_library' and column_name = 'planned_week')
     or not exists (select 1 from information_schema.columns where table_schema = 'public'
                     and table_name = 'cs_tbt_library' and column_name = 'for_company') then
    raise exception 'Install the Talk Library first (2026-11-25-tbt-talk-library.sql). Nothing was changed.';
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('net._http_response') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise exception 'pg_net or Vault is missing here, so this is not the live Greiner project. Nothing was changed.';
  end if;
end $$;

create table if not exists public.cs_upload_notices (
  id            bigint generated always as identity primary key,
  company_id    uuid not null,
  kind          text not null check (kind in ('document', 'job_document')),
  source_table  text not null check (source_table in ('cs_company_docs', 'cs_job_docs')),
  source_id     uuid not null,
  title         text not null,
  file_name     text,
  folder        text,                 -- Documents folder (category) or the job document section
  job_name      text,
  uploaded_by   text,                 -- the office sign-in's name when the table keeps it
  created_at    timestamptz not null default now(),
  email_status  text not null default 'waiting'
                check (email_status in ('waiting', 'handed_over', 'accepted', 'failed')),
  attempts      int not null default 0,
  request_id    bigint,               -- pg_net request id (net._http_response.id)
  handed_at     timestamptz,
  accepted_at   timestamptz,
  email_note    text,
  unique (source_table, source_id)
);
create index if not exists cs_upload_notices_waiting on public.cs_upload_notices (id) where email_status in ('waiting', 'handed_over');
alter table public.cs_upload_notices enable row level security;
revoke all on public.cs_upload_notices from public, anon, authenticated;

create table if not exists public.cs_upload_notice_settings (
  id            int primary key default 1 check (id = 1),
  email_on      boolean not null default false,
  email_to      text,
  provider_url  text,
  auth_header   text not null default 'Authorization',
  secret_name   text not null default 'cs_pipeline_email_key',
  office_url    text not null default 'https://greiner.creeksidesafety.com/office.html',
  updated_at    timestamptz not null default now()
);
alter table public.cs_upload_notice_settings enable row level security;
revoke all on public.cs_upload_notice_settings from public, anon, authenticated;

-- One settings row. Email stays OFF here. The webhook address and header name are copied from the Pipeline
-- review email settings when they exist; nothing is overwritten on a second run.
insert into public.cs_upload_notice_settings (id) values (1) on conflict (id) do nothing;
do $$
declare v_url text; v_hdr text; v_sec text;
begin
  if to_regclass('public.cs_program_settings') is not null then
    execute $q$select value #>> '{}' from public.cs_program_settings
                where key = 'notify_provider_url' and value #>> '{}' ~ '^https://' limit 1$q$ into v_url;
    execute $q$select value #>> '{}' from public.cs_program_settings
                where key = 'notify_auth_header' and value #>> '{}' ~ '^[A-Za-z0-9-]{1,64}$' limit 1$q$ into v_hdr;
    execute $q$select value #>> '{}' from public.cs_program_settings
                where key = 'notify_secret_name' and coalesce(value #>> '{}', '') <> '' limit 1$q$ into v_sec;
  end if;
  update public.cs_upload_notice_settings set
    provider_url = coalesce(provider_url, v_url),
    auth_header  = case when auth_header = 'Authorization' and v_hdr is not null then v_hdr else auth_header end,
    secret_name  = case when secret_name = 'cs_pipeline_email_key' and v_sec is not null then v_sec else secret_name end
  where id = 1;
end $$;

-- ---- record (trigger) -------------------------------------------------------
-- Reads the new row as json, so it does not depend on columns the repo does not show for cs_company_docs.
create or replace function public.cs_upload_notice_record()
returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v_greiner text;
begin
  begin
    select company_id::text into v_greiner from cs_portals where slug = 'greiner';
    if v_greiner is null or (j ->> 'company_id') is distinct from v_greiner then
      return new;
    end if;
    insert into cs_upload_notices (company_id, kind, source_table, source_id, title, file_name, folder, job_name, uploaded_by)
    values (
      (j ->> 'company_id')::uuid,
      case when tg_table_name = 'cs_job_docs' then 'job_document' else 'document' end,
      tg_table_name,
      (j ->> 'id')::uuid,
      left(coalesce(nullif(btrim(j ->> 'title'), ''), nullif(btrim(j ->> 'filename'), ''), nullif(btrim(j ->> 'name'), ''), 'A file'), 200),
      left(coalesce(j ->> 'filename', j ->> 'name'), 200),
      left(case when tg_table_name = 'cs_job_docs' then j ->> 'section'
                else coalesce(nullif(btrim(j ->> 'category'), ''), 'Other') end, 80),
      case when tg_table_name = 'cs_job_docs'
           then (select left(coalesce(nullif(btrim(name), ''), 'a job'), 120) from cs_jobs where id::text = j ->> 'job_id') end,
      left(coalesce(j ->> 'created_by', j ->> 'uploaded_by', j ->> 'user_name'), 120)
    )
    on conflict (source_table, source_id) do nothing;
  exception when others then
    -- Never block an upload because the notice could not be written.
    raise warning 'upload notice not recorded (%): %', tg_table_name, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.cs_upload_notice_record() from public, anon, authenticated;

drop trigger if exists cs_upload_notice on public.cs_company_docs;
create trigger cs_upload_notice after insert on public.cs_company_docs
  for each row execute function public.cs_upload_notice_record();
drop trigger if exists cs_upload_notice on public.cs_job_docs;
create trigger cs_upload_notice after insert on public.cs_job_docs
  for each row execute function public.cs_upload_notice_record();

-- ---- send (pg_cron, every 10 minutes after switch-on) ----------------------
create or replace function public.cs_upload_notice_esc(t text)
returns text language sql immutable set search_path = public as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;
revoke all on function public.cs_upload_notice_esc(text) from public, anon, authenticated;

create or replace function public.cs_upload_notice_send()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s cs_upload_notice_settings; v_key text; v_req bigint; v_ids bigint[]; n int := 0;
  n_ok int := 0; n_retry int := 0; n_fail int := 0;
  v_items text := ''; v_lines text := ''; v_subject text; v_html text; v_text text; r record; v_where text; v_name text;
begin
  -- 1. What the email service said about earlier emails.
  update cs_upload_notices u set email_status = 'accepted', accepted_at = x.created, email_note = 'The email service took it.'
    from net._http_response x
   where u.email_status = 'handed_over' and x.id = u.request_id and x.status_code between 200 and 299;
  get diagnostics n_ok = row_count;
  for r in select u.id, u.attempts, x.status_code, x.error_msg, x.timed_out
             from cs_upload_notices u left join net._http_response x on x.id = u.request_id
            where u.email_status = 'handed_over'
              and (x.id is not null or u.handed_at < now() - interval '15 minutes') loop
    if r.attempts < 3 then
      update cs_upload_notices set email_status = 'waiting', request_id = null,
             email_note = 'Trying again: ' || coalesce('answer ' || r.status_code::text, r.error_msg, 'no answer') where id = r.id;
      n_retry := n_retry + 1;
    else
      update cs_upload_notices set email_status = 'failed',
             email_note = 'Not sent after 3 tries: ' || coalesce('answer ' || r.status_code::text, r.error_msg, 'no answer') where id = r.id;
      n_fail := n_fail + 1;
    end if;
  end loop;

  -- 2. Off or not set up: keep everything waiting, send nothing.
  select * into s from cs_upload_notice_settings where id = 1;
  if s.id is null or not s.email_on then
    return jsonb_build_object('sent', 0, 'why', 'email is off', 'accepted', n_ok, 'retrying', n_retry, 'failed', n_fail);
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = s.secret_name;
  if coalesce(s.email_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
     or coalesce(s.provider_url, '') !~ '^https://[^[:space:]"<>]+$'
     or coalesce(v_key, '') = '' or s.auth_header !~ '^[A-Za-z0-9-]{1,64}$' then
    return jsonb_build_object('sent', 0, 'why', 'not set up: ' || concat_ws(', ',
      case when coalesce(s.email_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then 'who gets it' end,
      case when coalesce(s.provider_url, '') !~ '^https://[^[:space:]"<>]+$' then 'the email service address' end,
      case when coalesce(v_key, '') = '' then 'the email service key in Vault' end,
      case when s.auth_header !~ '^[A-Za-z0-9-]{1,64}$' then 'the header name' end),
      'accepted', n_ok, 'retrying', n_retry, 'failed', n_fail);
  end if;

  -- 3. Everything waiting for at least 2 minutes (so a talk's name and category are filed), oldest first,
  --    in ONE email. 50 files make one email, not 50.
  for r in select u.*, l.title as talk_title, l.category as talk_category, l.planned_week as talk_week,
                    l.for_company as talk_for
             from cs_upload_notices u
             left join cs_tbt_library l on u.source_table = 'cs_company_docs' and l.doc_id = u.source_id
            where u.email_status = 'waiting' and u.created_at < now() - interval '2 minutes'
            order by u.id limit 100 for update of u skip locked loop
    n := n + 1; v_ids := array_append(v_ids, r.id);
    if r.talk_title is not null then
      -- Nov 27: a talk Tony uploaded for Peine or Choice says so ("Talk Library > for Peine > Cold Weather").
      v_where := 'Toolbox Talks > Talk Library > '
        || case r.talk_for when 'peine' then 'for Peine > ' when 'choice' then 'for Choice > ' else '' end
        || r.talk_category
        || case when r.talk_week is not null then ' > for the week of ' || to_char(r.talk_week, 'Mon FMDD') else '' end;
      v_name := r.talk_title;
    elsif r.kind = 'job_document' then
      v_where := 'Jobs > ' || coalesce(r.job_name, 'a job') || ' > Job documents > ' || coalesce(r.folder, ''); v_name := r.title;
    else
      v_where := 'Documents > ' || coalesce(r.folder, 'Other'); v_name := r.title;
    end if;
    v_lines := v_lines || '- ' || to_char(r.created_at at time zone 'America/Indiana/Indianapolis', 'Dy Mon FMDD, FMHH12:MI AM')
      || ' | ' || coalesce(r.uploaded_by, 'Greiner office') || ' | ' || v_where || ' | ' || v_name
      || case when r.file_name is not null and r.file_name <> v_name then ' (' || r.file_name || ')' else '' end || E'\n';
    v_items := v_items || '<tr>'
      || '<td style="padding:8px 10px;border-top:1px solid #e2e8f0;white-space:nowrap;color:#64748b">'
      || cs_upload_notice_esc(to_char(r.created_at at time zone 'America/Indiana/Indianapolis', 'Dy Mon FMDD, FMHH12:MI AM')) || '</td>'
      || '<td style="padding:8px 10px;border-top:1px solid #e2e8f0">' || cs_upload_notice_esc(coalesce(r.uploaded_by, 'Greiner office')) || '</td>'
      || '<td style="padding:8px 10px;border-top:1px solid #e2e8f0">' || cs_upload_notice_esc(v_where) || '</td>'
      || '<td style="padding:8px 10px;border-top:1px solid #e2e8f0;font-weight:600">' || cs_upload_notice_esc(v_name)
      || case when r.file_name is not null and r.file_name <> v_name
              then '<div style="font-weight:400;color:#64748b;font-size:12px">' || cs_upload_notice_esc(r.file_name) || '</div>' else '' end
      || '</td></tr>';
  end loop;
  if n = 0 then
    return jsonb_build_object('sent', 0, 'why', 'nothing new', 'accepted', n_ok, 'retrying', n_retry, 'failed', n_fail);
  end if;

  v_subject := 'Greiner office: ' || n || case when n = 1 then ' new upload' else ' new uploads' end;
  v_text := 'New on the Greiner office page (' || s.office_url || '):' || E'\n\n' || v_lines || E'\n'
    || 'Nothing was sent to anyone else. Open the office page to look at the files.';
  v_html := '<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">'
    || '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px 24px">'
    || '<h1 style="margin:0 0 6px;font-size:20px">' || cs_upload_notice_esc(v_subject) || '</h1>'
    || '<p style="margin:0 0 14px;font-size:14px;color:#334155">Uploaded on the Greiner office page. Nothing was sent to anyone else.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;border-collapse:collapse">'
    || '<tr><th align="left" style="padding:6px 10px;color:#64748b;font-size:12px">When</th><th align="left" style="padding:6px 10px;color:#64748b;font-size:12px">Who</th>'
    || '<th align="left" style="padding:6px 10px;color:#64748b;font-size:12px">Where</th><th align="left" style="padding:6px 10px;color:#64748b;font-size:12px">What</th></tr>'
    || v_items || '</table>'
    || '<p style="margin:18px 0 0"><a href="' || cs_upload_notice_esc(s.office_url) || '" style="display:inline-block;background:#1e3a8a;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Open the office page</a></p>'
    || '</div></body></html>';

  v_req := net.http_post(
    url := s.provider_url,
    body := jsonb_build_object('to', jsonb_build_array(s.email_to), 'subject', v_subject, 'text', v_text, 'html', v_html),
    headers := jsonb_build_object('Content-Type', 'application/json',
      s.auth_header, case when lower(s.auth_header) = 'authorization' and v_key !~ '[[:space:]]' then 'Bearer ' || v_key else v_key end,
      'Idempotency-Key', 'cs-upload-notice-' || v_ids[1]::text || '-' || v_ids[n]::text),
    timeout_milliseconds := 15000);
  update cs_upload_notices set email_status = 'handed_over', request_id = v_req, attempts = attempts + 1,
         handed_at = now(), email_note = 'Handed to the email service.'
   where id = any(v_ids);
  return jsonb_build_object('sent', n, 'request_id', v_req, 'accepted', n_ok, 'retrying', n_retry, 'failed', n_fail);
end $$;
revoke all on function public.cs_upload_notice_send() from public, anon, authenticated;

commit;

select 'done: upload notices installed (2 tables, 2 triggers, 3 functions); recording only, email is OFF until the switch-on file' as result,
       (select count(*) from public.cs_upload_notices) as notices,
       (select email_on from public.cs_upload_notice_settings where id = 1) as email_on,
       (select provider_url is not null from public.cs_upload_notice_settings where id = 1) as email_service_found;
