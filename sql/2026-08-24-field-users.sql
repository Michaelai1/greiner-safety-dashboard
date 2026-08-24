-- ============================================================================
-- Greiner pilot — field-scoped portal users (e.g. Keith @ Purdue)
-- Project: gvfolfzseqwhhimbxgjv (creekside-safety)   Run in Supabase SQL Editor.
--
-- GOAL: a "field" user can sign in on their phone and see ONLY their assigned
-- job(s) — its forms and its submissions — and cannot reach any company-wide
-- data, even by editing a URL or calling the API directly.
--
-- HOW (server-side, not UI hiding):
--   A field user's login mints a session with scope='field'. Every existing
--   company-wide RPC (cs_portal_bundle / _jobs / _reports / _findings /
--   _incidents / _add_job / _save_stats / ...) already gates on
--   cs_portal_cid(token,'full'), which raises 'insufficient scope' for any
--   non-full session. So those functions reject a field session automatically —
--   we do NOT touch them. Only two existing functions change, both additively:
--     * cs_portal_login  — derive session scope + job_ids from the user's role
--     * cs_portal_submit — reject a submit for a job outside the field user's set
--   Plus new: cs_portal_field_home (the scoped phone view) and a 6-arg overload
--   of cs_portal_set_user that also sets role + job_ids.
--
-- BACKWARD COMPATIBLE: existing users have role='full' (column default) ->
-- scope 'full' -> identical behavior. Tony Sweet and every other portal are
-- unaffected. The static submit token (inspect key) has no session row, so it
-- is never treated as a field user.
-- ============================================================================

begin;

-- ── 1. columns (additive, safe defaults) ───────────────────────────────────
alter table public.cs_portal_users
  add column if not exists role    text not null default 'full',
  add column if not exists job_ids uuid[];

alter table public.cs_portal_sessions
  add column if not exists job_ids uuid[];

-- ── 2. login: session scope + job_ids follow the user's role ───────────────
create or replace function public.cs_portal_login(p_slug text, p_pin text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  portal record; u record; hit record;
  v_ip text := cs_req_ip();
  f_ip int; f15 int; f60 int; f24 int;
  sess text; ttl interval := interval '30 days';
  v_scope text;
begin
  select
    count(*) filter (where a.ip = v_ip and a.at > now() - interval '15 minutes'),
    count(*) filter (where a.at > now() - interval '15 minutes'),
    count(*) filter (where a.at > now() - interval '60 minutes'),
    count(*) filter (where a.at > now() - interval '24 hours')
    into f_ip, f15, f60, f24
    from cs_portal_login_attempts a
   where a.slug = p_slug and not a.ok;

  if f_ip >= 5 or f15 >= 10 or f60 >= 20 or f24 >= 50 then
    insert into cs_portal_login_attempts (slug, ip, ok) values (p_slug, v_ip, false);
    return jsonb_build_object('ok', false,
      'error', case when f24 >= 50
                    then 'Too many attempts today. Call Creekside.'
                    else 'Too many attempts. Wait 15 minutes.' end);
  end if;

  select * into portal from cs_portal_tokens t
   where t.slug = p_slug and t.active and t.scope = 'full';
  if portal is null then
    insert into cs_portal_login_attempts (slug, ip, ok) values (p_slug, v_ip, false);
    return jsonb_build_object('ok', false, 'error', 'Wrong code');
  end if;

  for u in select * from cs_portal_users
            where slug = p_slug and active order by created_at loop
    if extensions.crypt(coalesce(p_pin, ''), u.pin_hash) = u.pin_hash then
      hit := u; exit;
    end if;
  end loop;

  if hit is null then
    insert into cs_portal_login_attempts (slug, ip, ok) values (p_slug, v_ip, false);
    return jsonb_build_object('ok', false, 'error', 'Wrong code',
                              'remaining', greatest(0, 5 - (f_ip + 1)));
  end if;

  insert into cs_portal_login_attempts (slug, ip, ok) values (p_slug, v_ip, true);
  update cs_portal_users set last_login_at = now() where id = hit.id;

  -- field users get a restricted session scope; everyone else stays 'full'
  v_scope := case when coalesce(hit.role, 'full') = 'field' then 'field' else 'full' end;

  sess := encode(extensions.gen_random_bytes(32), 'hex');
  insert into cs_portal_sessions (token, company_id, scope, slug, ip, user_agent,
                                  expires_at, user_id, user_name, job_ids)
  values (sess, portal.company_id, v_scope, p_slug, v_ip, cs_req_ua(),
          now() + ttl, hit.id, hit.name, hit.job_ids);

  delete from cs_portal_sessions where expires_at < now() - interval '7 days';
  delete from cs_portal_login_attempts where at < now() - interval '30 days';

  return jsonb_build_object('ok', true, 'session', sess, 'expires_at', now() + ttl,
    'user', hit.name, 'title', hit.title,
    'role', coalesce(hit.role, 'full'),
    'job_ids', coalesce(to_jsonb(hit.job_ids), '[]'::jsonb),
    'company', (select name from cs_companies where id = portal.company_id));
end $function$;

-- ── 3. submit: a field user may only file for their assigned job(s) ────────
create or replace function public.cs_portal_submit(p_token text, p_job_id uuid, p_template_code text, p_inspector_name text, p_signature_typed text, p_fields jsonb, p_photos jsonb default '[]'::jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare cid uuid; rid uuid; n_fail int; ov text; inv text[];
        v_scope text; v_jobs uuid[];
begin
  cid := cs_portal_cid(p_token, 'submit');

  -- field-session guard: the job must be one this user is assigned to
  select scope, job_ids into v_scope, v_jobs
    from cs_portal_sessions where token = p_token and expires_at > now();
  if v_scope = 'field'
     and (p_job_id is null or not (p_job_id = any(coalesce(v_jobs, '{}'::uuid[])))) then
    raise exception 'job not permitted for this user' using errcode = 'P0001';
  end if;

  if p_job_id is not null and not exists (select 1 from cs_jobs where id = p_job_id and company_id = cid) then
    raise exception 'job not in company' using errcode = 'P0001';
  end if;

  -- ids whose "good" answer is No, read from the template rather than trusted
  -- from the client
  select coalesce(array_agg(i->>'id'), '{}')
    into inv
    from cs_report_templates t,
         lateral jsonb_array_elements(t.sections) s,
         lateral jsonb_array_elements(s->'items') i
   where t.code = p_template_code and (i->>'invert')::boolean is true;

  select count(*) filter (
           where (key <> all(inv) and value = 'no')
              or (key =  any(inv) and value = 'yes'))
    into n_fail
    from jsonb_each_text(coalesce(p_fields->'items','{}'::jsonb));

  ov := case when n_fail > 0 then 'fail' else 'pass' end;
  insert into cs_reports (template_code, job_id, company_id, report_date, inspector_name,
                          overall, items, fields, photos, has_defects, defect_count,
                          signature_typed, form_type, status, submitted_at)
  values (p_template_code, p_job_id, cid, current_date, trim(p_inspector_name),
          ov, coalesce(p_fields->'items','{}'::jsonb), p_fields, coalesce(p_photos,'[]'::jsonb),
          n_fail > 0, n_fail, nullif(trim(p_signature_typed),''), 'inspection', 'submitted', now())
  returning id into rid;
  return rid;
end $function$;

-- ── 4. field home: the ONLY read a field session can make ──────────────────
-- Returns the user's assigned job(s) + recent submissions for those jobs.
-- Requires scope='field'; a full session is told to use the normal dashboard.
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
        'id', id, 'template_code', template_code, 'report_date', report_date,
        'inspector_name', inspector_name, 'overall', overall, 'job_id', job_id)
        order by created_at desc)
        from (select * from cs_reports
               where company_id = cid and job_id = any(coalesce(v_jobs, '{}'::uuid[]))
               order by created_at desc limit 25) r), '[]'::jsonb)
  );
end $function$;

revoke all     on function public.cs_portal_field_home(text) from public;
grant  execute on function public.cs_portal_field_home(text) to anon, authenticated;

-- ── 5. set_user overload: create/update a user WITH role + assigned jobs ───
create or replace function public.cs_portal_set_user(p_slug text, p_name text, p_pin text, p_title text, p_role text, p_job_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare uid uuid; clash text;
begin
  if p_pin !~ '^[0-9]{4,}$' then
    raise exception 'PIN must be at least 4 digits';
  end if;
  if cs_pin_is_weak(p_pin) then
    raise exception 'that PIN is too easy to guess (repeated or sequential digits)';
  end if;
  if coalesce(p_role,'full') not in ('full','field') then
    raise exception 'role must be full or field';
  end if;

  select u.name into clash from cs_portal_users u
   where u.slug = p_slug and u.active and lower(u.name) <> lower(p_name)
     and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash;
  if clash is not null then
    raise exception 'that PIN is already used by % on this portal', clash;
  end if;

  insert into cs_portal_users (slug, name, title, pin_hash, role, job_ids)
  values (p_slug, p_name, p_title, extensions.crypt(p_pin, extensions.gen_salt('bf', 9)),
          coalesce(p_role,'full'), p_job_ids)
  on conflict (slug, lower(name)) do update
    set pin_hash = excluded.pin_hash,
        title    = coalesce(excluded.title, cs_portal_users.title),
        role     = excluded.role,
        job_ids  = excluded.job_ids,
        active   = true
  returning id into uid;

  return jsonb_build_object('id', uid, 'slug', p_slug, 'name', p_name, 'role', coalesce(p_role,'full'));
end $function$;

revoke all     on function public.cs_portal_set_user(text,text,text,text,text,uuid[]) from public, anon;
grant  execute on function public.cs_portal_set_user(text,text,text,text,text,uuid[]) to authenticated;

commit;

-- ── Keith @ Purdue (RUN ONCE YOU HAVE HIS PHONE — PIN = last 4) ─────────────
-- Purdue = job C800-2025, id 87906cbc-1809-4d56-b4e1-7973562221b2.
-- Replace 4821 with the last 4 of Keith's real phone number.
-- select cs_portal_set_user(
--   'greiner', 'Keith Wilcox', '4821', 'Field — Purdue', 'field',
--   array['87906cbc-1809-4d56-b4e1-7973562221b2']::uuid[]);
