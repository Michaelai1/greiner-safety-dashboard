-- ============================================================================
-- Greiner pilot — NextGen-owned field submission + PDF pipeline (replaces n8n)
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety)
--
-- A field user (Keith @ Purdue) submits a crew form (JHA / Hot Work / Aerial /
-- Forklift) from greiner-QR. The submission is authorized by the server-side
-- field session (NOT by URL params): inspector + job come from the session,
-- cross-job submits are rejected. The row persists here; a professional PDF is
-- stored in Supabase Storage and its path saved on the row, so Tony's dashboard
-- and Keith's phone can both retrieve it. No n8n. No auto-email.
--
-- Additive only. Does not touch cs_reports, the legacy QR `inspections` table,
-- or any historical data.
-- ============================================================================

begin;

-- ── table ──────────────────────────────────────────────────────────────────
create table if not exists public.cs_field_submissions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  job_id        uuid not null,
  user_id       uuid,
  inspector_name text not null,
  form_type     text not null,           -- jha | hotwork | aerial | forklift
  form_title    text not null,
  asset_id      text,                     -- equipment id (aerial/forklift), else null
  fields        jsonb not null default '{}'::jsonb,
  photos        jsonb not null default '[]'::jsonb,
  has_defects   boolean not null default false,
  defect_count  integer not null default 0,
  signature     text,
  pdf_path      text,                     -- storage path in greiner-field-pdfs
  submitted_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists cs_field_submissions_company_idx on public.cs_field_submissions (company_id, submitted_at desc);
create index if not exists cs_field_submissions_job_idx     on public.cs_field_submissions (job_id, submitted_at desc);

alter table public.cs_field_submissions enable row level security;
drop policy if exists cs_field_submissions_authed on public.cs_field_submissions;
create policy cs_field_submissions_authed on public.cs_field_submissions
  for all to authenticated using (auth.role()='authenticated') with check (auth.role()='authenticated');
-- anon reaches this table ONLY through the security-definer RPCs below.

-- ── short-lived field "ticket" for greiner-QR ───────────────────────────────
-- Keith's phone landing (dashboard) mints a 4-hour field-scope ticket and hands
-- it to greiner-QR (separate origin) instead of the 30-day session. The ticket
-- carries the same company + job_ids, so all authorization stays server-side.
create or replace function public.cs_portal_field_ticket(p_token text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare s record; tk text;
begin
  select company_id, scope, slug, job_ids, user_id, user_name into s
    from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode='P0001'; end if;
  if s.scope <> 'field' then raise exception 'not a field user' using errcode='P0001'; end if;
  tk := 'ft_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into cs_portal_sessions (token, company_id, scope, slug, expires_at, user_id, user_name, job_ids)
  values (tk, s.company_id, 'field', s.slug, now() + interval '4 hours', s.user_id, s.user_name, s.job_ids);
  return jsonb_build_object('ticket', tk, 'user', s.user_name, 'expires_at', now() + interval '4 hours');
end $function$;
revoke all on function public.cs_portal_field_ticket(text) from public;
grant execute on function public.cs_portal_field_ticket(text) to anon, authenticated;

-- ── the field submission itself ─────────────────────────────────────────────
-- Authorization is entirely server-side: the session decides who + which job.
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
begin
  select company_id, scope, job_ids, user_id, user_name into s
    from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode='P0001'; end if;
  if s.scope <> 'field' then raise exception 'insufficient scope' using errcode='P0001'; end if;
  if s.job_ids is null or array_length(s.job_ids,1) is null then
    raise exception 'no job assigned to this user' using errcode='P0001';
  end if;

  -- Pilot: a field user has exactly one job. Attribute to it; never trust client.
  v_job := s.job_ids[1];
  select name into v_job_name from cs_jobs where id = v_job and company_id = s.company_id;
  if v_job_name is null then raise exception 'assigned job not in company' using errcode='P0001'; end if;

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

-- ── attach/replace the PDF path after upload (if uploaded post-insert) ───────
create or replace function public.cs_portal_field_attach_pdf(p_token text, p_id uuid, p_pdf_path text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare s record;
begin
  select company_id, scope into s from cs_portal_sessions where token = p_token and expires_at > now();
  if s.company_id is null then raise exception 'invalid token' using errcode='P0001'; end if;
  if s.scope <> 'field' then raise exception 'insufficient scope' using errcode='P0001'; end if;
  update cs_field_submissions set pdf_path = p_pdf_path
    where id = p_id and company_id = s.company_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'pdf_path', p_pdf_path);
end $function$;
revoke all on function public.cs_portal_field_attach_pdf(text,uuid,text) from public;
grant execute on function public.cs_portal_field_attach_pdf(text,uuid,text) to anon, authenticated;

-- ── field home: now returns the user's real recent field submissions + PDFs ──
create or replace function public.cs_portal_field_home(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; v_scope text; v_jobs uuid[]; v_user text;
begin
  select company_id, scope, job_ids, user_name
    into cid, v_scope, v_jobs, v_user
    from cs_portal_sessions where token = p_token and expires_at > now();
  if cid is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if v_scope <> 'field' then raise exception 'not a field user' using errcode = 'P0001'; end if;

  return jsonb_build_object(
    'user', v_user,
    'company', (select name from cs_companies where id = cid),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'job_number', job_number, 'name', name, 'address', address,
        'foreman_name', foreman_name) order by job_number)
        from cs_jobs
        where company_id = cid and id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb),
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
grant execute on function public.cs_portal_field_home(text) to anon, authenticated;

-- ── Tony (full scope): field submissions for the Inspections list ───────────
create or replace function public.cs_portal_field_inspections(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid;
begin
  cid := cs_portal_cid(p_token, 'full');   -- full-scope only; field sessions rejected
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'form_type', s.form_type, 'form_title', s.form_title,
      'inspector_name', s.inspector_name, 'asset_id', s.asset_id,
      'job_id', s.job_id, 'job_name', j.name, 'job_number', j.job_number,
      'submitted_at', s.submitted_at, 'has_defects', s.has_defects,
      'defect_count', s.defect_count, 'pdf_path', s.pdf_path)
      order by s.submitted_at desc)
      from cs_field_submissions s
      left join cs_jobs j on j.id = s.job_id
      where s.company_id = cid), '[]'::jsonb);
end $function$;
revoke all on function public.cs_portal_field_inspections(text) from public;
grant execute on function public.cs_portal_field_inspections(text) to anon, authenticated;

commit;
