-- Local test copy of the production tables and helpers the equipment migration
-- and the IU provisioning script touch. Column lists, keys and function bodies
-- were read (read-only) from project gvfolfzseqwhhimbxgjv on 2026-10-04.
-- Used only by tests that run in an in-memory Postgres (PGlite). Contains no data.

create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table cs_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null
);

create table cs_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  job_number text, name text, address text, start_date date,
  status text default 'active', cadence text,
  foreman_name text, foreman_phone text, foreman_email text,
  inspections text[] default '{}', notes text,
  created_at timestamptz default now(), closed_at timestamptz,
  inspection_configs jsonb,
  pm_name text, pm_phone text, pm_email text,
  gc_name text, gc_contact text, gc_phone text, gc_email text,
  contacts jsonb default '[]'::jsonb,
  default_template_id uuid,
  unique (company_id, job_number)
);

create table cs_portal_tokens (
  token text primary key, company_id uuid references cs_companies(id),
  slug text, scope text, active boolean default true
);

create table cs_portal_users (
  id uuid primary key default gen_random_uuid(),
  slug text not null, name text not null, title text,
  pin_hash text not null, active boolean default true,
  created_at timestamptz default now(), last_login_at timestamptz,
  role text not null default 'full', job_ids uuid[], mobile text
);
create unique index cs_portal_users_slug_name_ux on cs_portal_users (slug, lower(name));

create table cs_portal_sessions (
  token text primary key, company_id uuid, scope text, slug text, ip text, user_agent text,
  created_at timestamptz default now(), expires_at timestamptz,
  user_id uuid, user_name text, job_ids uuid[]
);

create table cs_workers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  name text not null, job_id uuid references cs_jobs(id), classification text,
  phone text, email text, active boolean default true, source text,
  created_at timestamptz default now()
);
create unique index cs_workers_company_name_ux on cs_workers (company_id, lower(name));

create table cs_field_user_forms (
  user_id uuid not null references cs_portal_users(id) on delete cascade,
  job_id uuid not null references cs_jobs(id) on delete cascade,
  form_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create table cs_job_form_config (
  job_id uuid primary key references cs_jobs(id),
  external_hotwork boolean default false, hotwork_locations jsonb,
  enabled_forms text[], enabled_permits text[], updated_at timestamptz default now()
);

create table cs_equipment (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  unit_number text not null, equipment_type text,
  job_id uuid references cs_jobs(id), qr_slug text,
  active boolean default true, created_at timestamptz default now(),
  make text, model text, serial text, year text, source text,
  unique (company_id, unit_number)
);

create or replace function public.cs_portal_cid(p_token text, p_need text default 'full')
 returns uuid language plpgsql stable security definer set search_path to 'public', 'extensions'
as $function$
declare cid uuid; s text;
begin
  select company_id, scope into cid, s
    from cs_portal_sessions where token = p_token and expires_at > now();
  if cid is null then
    select company_id, scope into cid, s
      from cs_portal_tokens
     where token = p_token and active and scope = 'submit';
  end if;
  if cid is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  if p_need = 'full' and s <> 'full' then
    raise exception 'insufficient scope' using errcode = 'P0001';
  end if;
  return cid;
end $function$;

create or replace function public.cs_pin_is_weak(p_pin text)
 returns boolean language plpgsql immutable
as $function$
declare d int[]; i int; asc_ boolean := true; desc_ boolean := true;
begin
  if p_pin !~ '^[0-9]+$' then return false; end if;
  if length(p_pin) < 4 then return true; end if;
  if p_pin ~ ('^(.)\1{' || (length(p_pin) - 1) || '}$') then return true; end if;
  select array_agg(c::int order by ord) into d
    from (select ord, substr(p_pin, ord, 1) c from generate_series(1, length(p_pin)) ord) t;
  for i in 2 .. array_length(d, 1) loop
    if d[i] <> d[i-1] + 1 then asc_  := false; end if;
    if d[i] <> d[i-1] - 1 then desc_ := false; end if;
  end loop;
  if asc_ or desc_ then return true; end if;
  if p_pin in ('1004','2000','2001','1122','6969','1313','2580') then return true; end if;
  return false;
end $function$;

create or replace function public.cs_portal_set_user(p_slug text, p_name text, p_pin text, p_title text, p_role text, p_job_ids uuid[])
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare uid uuid; clash text;
begin
  if p_pin !~ '^[0-9]{4,}$' then raise exception 'PIN must be at least 4 digits'; end if;
  if cs_pin_is_weak(p_pin) then
    raise exception 'that PIN is too easy to guess (repeated or sequential digits)';
  end if;
  if coalesce(p_role,'full') not in ('full','field') then raise exception 'role must be full or field'; end if;
  select u.name into clash from cs_portal_users u
   where u.slug = p_slug and u.active and lower(u.name) <> lower(p_name)
     and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash;
  if clash is not null then raise exception 'that PIN is already used by % on this portal', clash; end if;
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

create or replace function public.cs_portal_equipment_set_job(
  p_token text, p_equipment_id uuid, p_job_id uuid default null
) returns json language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if p_job_id is not null and not exists (
      select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  update cs_equipment set job_id = p_job_id where id = p_equipment_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true, 'id', p_equipment_id, 'job_id', p_job_id);
end $$;

create table cs_field_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id), job_id uuid references cs_jobs(id), user_id uuid,
  inspector_name text, form_type text, form_title text, asset_id text, fields jsonb, photos jsonb,
  has_defects boolean default false, defect_count int default 0, signature text, pdf_path text,
  submitted_at timestamptz default now()
);
