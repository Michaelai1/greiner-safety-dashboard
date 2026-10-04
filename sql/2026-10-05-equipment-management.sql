-- ============================================================================
-- Equipment management + ladder records — PROPOSED, NOT APPLIED.
--
-- Status: reviewed on feature/tony-feedback-2026-10-02 only. It has NOT been
-- run against production. It is executed in tests against an in-memory copy of
-- the relevant production schema (tests/verify-equipment-sql.mjs).
--
-- Why: cs_equipment is the right source of truth (one job_id per unit, one
-- office write path, cs_portal_equipment_set_job), but it cannot yet
--   * describe a unit beyond its type, or be archived instead of deleted,
--   * keep any history of who moved it, archived it, inspected it,
--   * hold ladders' safe-use checks and Do Not Use defects (the JHA ladder flow
--     had no production source at all — ladders lived only in demo fixtures).
--
-- Design: ladders are ordinary cs_equipment rows whose type is a ladder. Every
-- assignment, status change, safe-use check and defect is an append-only row in
-- cs_equipment_events. Removing a unit from a job, or archiving it, never
-- deletes anything; past JHAs keep their own snapshots.
-- ============================================================================

-- 1. Safe metadata + archive state on the existing table.
alter table cs_equipment
  add column if not exists description text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Unit IDs are unique per company ignoring case and surrounding spaces
-- (verified 2026-10-05: no existing rows collide under this rule).
create unique index if not exists cs_equipment_company_unit_norm_ux
  on cs_equipment (company_id, upper(btrim(unit_number)));

-- 2. Append-only history.
create table if not exists cs_equipment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references cs_companies(id),
  equipment_id uuid not null references cs_equipment(id),
  kind text not null check (kind in ('created', 'updated', 'assigned', 'unassigned', 'reassigned',
                                     'archived', 'restored', 'inspection_safe', 'defect_reported')),
  from_job_id uuid references cs_jobs(id),
  to_job_id uuid references cs_jobs(id),
  actor_user_id uuid,
  actor_name text,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  seq bigint generated always as identity   -- tie-break: several events can share one transaction time
);
create index if not exists cs_equipment_events_unit_idx on cs_equipment_events (equipment_id, at desc, seq desc);
alter table cs_equipment_events enable row level security;   -- no policies: definer RPCs only

create or replace function public.cs_equipment_events_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'equipment history is append-only';
end $$;
drop trigger if exists cs_equipment_events_no_change on cs_equipment_events;
create trigger cs_equipment_events_no_change before update or delete on cs_equipment_events
  for each row execute function public.cs_equipment_events_immutable();

-- 3. Helpers.
create or replace function public.cs_equipment_is_ladder(p_type text) returns boolean
language sql immutable as $$ select coalesce(p_type, '') ~* '\mladder' $$;

-- Who is acting, from the session — never from the request body.
create or replace function public.cs_session_actor(p_token text, out user_id uuid, out user_name text)
language sql stable security definer set search_path = public as $$
  select s.user_id, s.user_name from cs_portal_sessions s where s.token = p_token and s.expires_at > now()
$$;

-- 4. Office RPCs (full scope only).
create or replace function public.cs_portal_equipment_add(
  p_token text, p_unit_number text, p_equipment_type text,
  p_description text default null, p_make text default null, p_model text default null,
  p_serial text default null, p_year text default null, p_source text default null,
  p_job_id uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_unit text; v_id uuid; a record;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  v_unit := upper(btrim(coalesce(p_unit_number, '')));
  if v_unit = '' then return json_build_object('ok', false, 'error', 'unit_required'); end if;
  if nullif(btrim(coalesce(p_equipment_type, '')), '') is null then
    return json_build_object('ok', false, 'error', 'type_required');
  end if;
  if exists (select 1 from cs_equipment where company_id = v_cid and upper(btrim(unit_number)) = v_unit) then
    return json_build_object('ok', false, 'error', 'duplicate_unit');
  end if;
  if p_job_id is not null and not exists (select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  select * into a from cs_session_actor(p_token);
  insert into cs_equipment (company_id, unit_number, equipment_type, description, make, model, serial, year, source, job_id, active)
  values (v_cid, v_unit, btrim(p_equipment_type), nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_make, '')), ''), nullif(btrim(coalesce(p_model, '')), ''),
          nullif(btrim(coalesce(p_serial, '')), ''), nullif(btrim(coalesce(p_year, '')), ''),
          nullif(btrim(coalesce(p_source, '')), ''), p_job_id, true)
  returning id into v_id;
  insert into cs_equipment_events (company_id, equipment_id, kind, to_job_id, actor_user_id, actor_name, data)
  values (v_cid, v_id, 'created', p_job_id, a.user_id, a.user_name,
          jsonb_build_object('unit_number', v_unit, 'equipment_type', btrim(p_equipment_type)));
  if p_job_id is not null then
    insert into cs_equipment_events (company_id, equipment_id, kind, to_job_id, actor_user_id, actor_name)
    values (v_cid, v_id, 'assigned', p_job_id, a.user_id, a.user_name);
  end if;
  return json_build_object('ok', true, 'id', v_id, 'unit_number', v_unit);
end $$;

-- Safe metadata only. null = keep, '' = clear. Assignment and archive have
-- their own RPCs so every move is recorded.
create or replace function public.cs_portal_equipment_update(
  p_token text, p_equipment_id uuid,
  p_unit_number text default null, p_equipment_type text default null, p_description text default null,
  p_make text default null, p_model text default null, p_serial text default null,
  p_year text default null, p_source text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; e cs_equipment; v_unit text; a record; changed jsonb := '{}'::jsonb;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select * into e from cs_equipment where id = p_equipment_id and company_id = v_cid;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  v_unit := case when p_unit_number is null then e.unit_number else upper(btrim(p_unit_number)) end;
  if v_unit = '' then return json_build_object('ok', false, 'error', 'unit_required'); end if;
  if upper(btrim(v_unit)) <> upper(btrim(e.unit_number)) and exists (
      select 1 from cs_equipment where company_id = v_cid and id <> e.id and upper(btrim(unit_number)) = upper(btrim(v_unit))) then
    return json_build_object('ok', false, 'error', 'duplicate_unit');
  end if;
  if p_equipment_type is not null and btrim(p_equipment_type) = '' then
    return json_build_object('ok', false, 'error', 'type_required');
  end if;
  update cs_equipment set
    unit_number = v_unit,
    equipment_type = coalesce(nullif(btrim(coalesce(p_equipment_type, '')), ''), equipment_type),
    description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    make   = case when p_make   is null then make   else nullif(btrim(p_make), '')   end,
    model  = case when p_model  is null then model  else nullif(btrim(p_model), '')  end,
    serial = case when p_serial is null then serial else nullif(btrim(p_serial), '') end,
    year   = case when p_year   is null then year   else nullif(btrim(p_year), '')   end,
    source = case when p_source is null then source else nullif(btrim(p_source), '') end,
    updated_at = now()
  where id = e.id;
  select * into a from cs_session_actor(p_token);
  insert into cs_equipment_events (company_id, equipment_id, kind, actor_user_id, actor_name, data)
  values (v_cid, e.id, 'updated', a.user_id, a.user_name,
          jsonb_strip_nulls(jsonb_build_object('unit_number', p_unit_number, 'equipment_type', p_equipment_type,
            'description', p_description, 'make', p_make, 'model', p_model, 'serial', p_serial,
            'year', p_year, 'source', p_source)));
  return json_build_object('ok', true, 'id', e.id, 'unit_number', v_unit);
end $$;

-- The ONE assignment write path (Equipment tab and the Assign board both call
-- it). Replaces the 2026-09-12 version: same arguments and result, plus
-- archive protection and history.
create or replace function public.cs_portal_equipment_set_job(
  p_token text, p_equipment_id uuid, p_job_id uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; e cs_equipment; a record;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if p_job_id is not null and not exists (
      select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  select * into e from cs_equipment where id = p_equipment_id and company_id = v_cid;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if e.archived_at is not null then return json_build_object('ok', false, 'error', 'archived'); end if;
  if e.job_id is not distinct from p_job_id then
    return json_build_object('ok', true, 'id', e.id, 'job_id', p_job_id, 'unchanged', true);
  end if;
  update cs_equipment set job_id = p_job_id, updated_at = now() where id = e.id;
  select * into a from cs_session_actor(p_token);
  insert into cs_equipment_events (company_id, equipment_id, kind, from_job_id, to_job_id, actor_user_id, actor_name)
  values (v_cid, e.id,
          case when p_job_id is null then 'unassigned' when e.job_id is null then 'assigned' else 'reassigned' end,
          e.job_id, p_job_id, a.user_id, a.user_name);
  return json_build_object('ok', true, 'id', e.id, 'job_id', p_job_id);
end $$;

-- Archive takes a unit out of service and off its job; restore brings it back
-- unassigned. Nothing is deleted.
create or replace function public.cs_portal_equipment_archive(
  p_token text, p_equipment_id uuid, p_archived boolean default true
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; e cs_equipment; a record;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select * into e from cs_equipment where id = p_equipment_id and company_id = v_cid;
  if not found then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select * into a from cs_session_actor(p_token);
  if coalesce(p_archived, true) then
    if e.archived_at is not null then return json_build_object('ok', true, 'unchanged', true); end if;
    update cs_equipment set archived_at = now(), active = false, job_id = null, updated_at = now() where id = e.id;
    insert into cs_equipment_events (company_id, equipment_id, kind, from_job_id, actor_user_id, actor_name)
    values (v_cid, e.id, 'archived', e.job_id, a.user_id, a.user_name);
  else
    if e.archived_at is null then return json_build_object('ok', true, 'unchanged', true); end if;
    update cs_equipment set archived_at = null, active = true, updated_at = now() where id = e.id;
    insert into cs_equipment_events (company_id, equipment_id, kind, actor_user_id, actor_name)
    values (v_cid, e.id, 'restored', a.user_id, a.user_name);
  end if;
  return json_build_object('ok', true, 'id', e.id, 'archived', coalesce(p_archived, true));
end $$;

-- Inventory for the office: every unit (active and archived) with its latest
-- inspection and any open Do Not Use defect.
create or replace function public.cs_portal_equipment_inventory(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'unit_number', e.unit_number, 'equipment_type', e.equipment_type,
      'description', e.description, 'make', e.make, 'model', e.model, 'serial', e.serial,
      'year', e.year, 'source', e.source, 'job_id', e.job_id, 'active', e.active,
      'archived_at', e.archived_at, 'is_ladder', cs_equipment_is_ladder(e.equipment_type),
      'last_inspection', (select jsonb_build_object('at', ev.at, 'by', ev.actor_name, 'kind', ev.kind)
                            from cs_equipment_events ev
                           where ev.equipment_id = e.id and ev.kind in ('inspection_safe', 'defect_reported')
                           order by ev.at desc, ev.seq desc limit 1),
      'open_defect', (select jsonb_build_object('at', ev.at, 'by', ev.actor_name,
                               'description', ev.data->>'description')
                        from cs_equipment_events ev
                       where ev.equipment_id = e.id and ev.kind = 'defect_reported'
                         and (ev.data->>'resolved_at') is null
                       order by ev.at desc, ev.seq desc limit 1))
      order by e.unit_number)
    from cs_equipment e where e.company_id = v_cid), '[]'::jsonb);
end $$;

create or replace function public.cs_portal_equipment_history(p_token text, p_equipment_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  return coalesce((select jsonb_agg(jsonb_build_object('kind', ev.kind, 'at', ev.at, 'by', ev.actor_name,
      'from_job_id', ev.from_job_id, 'to_job_id', ev.to_job_id, 'data', ev.data) order by ev.at desc, ev.seq desc)
    from cs_equipment_events ev
   where ev.equipment_id = p_equipment_id and ev.company_id = v_cid), '[]'::jsonb);
end $$;

-- 5. Field RPCs (field scope, limited to the session's jobs).
-- The phone's equipment: who is signed in, and the active units assigned to the
-- session's jobs, each with its recent inspection/defect history. Photos stay
-- on the server (the office history shows them); the phone only learns that
-- one exists.
create or replace function public.cs_portal_field_equipment(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid; v_jobs uuid[]; v_uid uuid; v_name text;
begin
  select company_id, job_ids, user_id, user_name into v_cid, v_jobs, v_uid, v_name from cs_portal_sessions
   where token = p_token and expires_at > now() and scope = 'field';
  if v_cid is null then raise exception 'invalid token' using errcode = 'P0001'; end if;
  return jsonb_build_object(
    'user', case when v_uid is null then null else jsonb_build_object('id', v_uid, 'name', v_name) end,
    'equipment', coalesce((select jsonb_agg(jsonb_build_object(
      'id', e.id, 'unit_number', e.unit_number, 'equipment_type', e.equipment_type,
      'description', e.description, 'job_id', e.job_id, 'is_ladder', cs_equipment_is_ladder(e.equipment_type),
      'events', coalesce((select jsonb_agg(jsonb_build_object('id', ev.id, 'kind', ev.kind, 'at', ev.at,
                    'by', ev.actor_name, 'by_user_id', ev.actor_user_id,
                    'data', (ev.data - 'photo') || jsonb_build_object('has_photo',
                              coalesce(jsonb_typeof(ev.data->'photo'), 'null') <> 'null')) order by ev.at desc, ev.seq desc)
                  from (select * from cs_equipment_events x where x.equipment_id = e.id
                          and x.kind in ('inspection_safe', 'defect_reported') order by x.at desc, x.seq desc limit 20) ev), '[]'::jsonb))
      order by e.unit_number)
    from cs_equipment e
   where e.company_id = v_cid and e.active and e.archived_at is null
     and e.job_id = any(coalesce(v_jobs, '{}'::uuid[]))), '[]'::jsonb));
end $$;

-- Common checks for a field ladder event: field session, ladder assigned to one
-- of the session's jobs, active.
create or replace function public.cs_field_ladder_guard(p_token text, p_equipment_id uuid,
  out ok boolean, out err text, out cid uuid, out uid uuid, out uname text, out eq cs_equipment)
language plpgsql stable security definer set search_path = public as $$
declare v_jobs uuid[]; v_scope text;
begin
  ok := false;
  select company_id, job_ids, user_id, user_name, scope into cid, v_jobs, uid, uname, v_scope
    from cs_portal_sessions where token = p_token and expires_at > now();
  if cid is null then err := 'invalid_token'; return; end if;
  if v_scope <> 'field' or uid is null or nullif(btrim(coalesce(uname, '')), '') is null then err := 'sign_in_required'; return; end if;
  select * into eq from cs_equipment where id = p_equipment_id and company_id = cid;
  if not found or not eq.active or eq.archived_at is not null then err := 'not_found'; return; end if;
  if not cs_equipment_is_ladder(eq.equipment_type) then err := 'not_a_ladder'; return; end if;
  if not (eq.job_id = any(coalesce(v_jobs, '{}'::uuid[]))) then err := 'not_assigned_to_your_job'; return; end if;
  ok := true;
end $$;

-- "Inspect for today's use". Identity and time are the server's.
create or replace function public.cs_portal_field_ladder_safe(
  p_token text, p_equipment_id uuid, p_attested boolean, p_attestation_version text,
  p_jha_root_id text default null, p_jha_revision_number int default null
) returns json
language plpgsql security definer set search_path = public as $$
declare g record; v_id uuid; v_at timestamptz := now();
begin
  select * into g from cs_field_ladder_guard(p_token, p_equipment_id);
  if not g.ok then return json_build_object('ok', false, 'error', g.err); end if;
  if exists (select 1 from cs_equipment_events where equipment_id = p_equipment_id
              and kind = 'defect_reported' and (data->>'resolved_at') is null) then
    return json_build_object('ok', false, 'error', 'do_not_use');
  end if;
  if p_attested is not true or p_attestation_version is distinct from 'ladder-safe-use-v1' then
    return json_build_object('ok', false, 'error', 'attestation_required');
  end if;
  insert into cs_equipment_events (company_id, equipment_id, kind, to_job_id, actor_user_id, actor_name, data, at)
  values (g.cid, p_equipment_id, 'inspection_safe', (g.eq).job_id, g.uid, g.uname, jsonb_build_object(
    'result', 'safe', 'attestation_version', 'ladder-safe-use-v1',
    'attestation_text', 'I inspected this ladder before use today and found it safe to use.',
    'jha_root_id', p_jha_root_id, 'jha_revision_number', p_jha_revision_number), v_at)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'at', v_at, 'by', g.uname, 'by_user_id', g.uid);
end $$;

-- "Report a defect or unsafe condition". No field resolve exists.
create or replace function public.cs_portal_field_ladder_defect(
  p_token text, p_equipment_id uuid, p_description text, p_acknowledged boolean,
  p_photo jsonb default null, p_jha_root_id text default null, p_jha_revision_number int default null
) returns json
language plpgsql security definer set search_path = public as $$
declare g record; v_id uuid; v_at timestamptz := now();
begin
  select * into g from cs_field_ladder_guard(p_token, p_equipment_id);
  if not g.ok then return json_build_object('ok', false, 'error', g.err); end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then
    return json_build_object('ok', false, 'error', 'description_required');
  end if;
  if p_acknowledged is not true then return json_build_object('ok', false, 'error', 'acknowledgment_required'); end if;
  if p_photo is not null and length(p_photo::text) > 4000000 then
    return json_build_object('ok', false, 'error', 'photo_too_large');
  end if;
  insert into cs_equipment_events (company_id, equipment_id, kind, to_job_id, actor_user_id, actor_name, data, at)
  values (g.cid, p_equipment_id, 'defect_reported', (g.eq).job_id, g.uid, g.uname, jsonb_build_object(
    'description', btrim(p_description), 'photo', p_photo, 'tagged_do_not_use', true,
    'acknowledgment_version', 'ladder-do-not-use-v1',
    'acknowledgment_text', 'I marked or tagged this ladder ‘Do Not Use’ and removed it from service.',
    'reported_at', v_at, 'resolved_at', null,
    'jha_root_id', p_jha_root_id, 'jha_revision_number', p_jha_revision_number), v_at)
  returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'at', v_at, 'by', g.uname, 'by_user_id', g.uid);
end $$;

-- 6. Grants: callable through PostgREST; every function checks its own scope.
revoke all on function public.cs_portal_equipment_add(text, text, text, text, text, text, text, text, text, uuid) from public;
revoke all on function public.cs_portal_equipment_update(text, uuid, text, text, text, text, text, text, text, text) from public;
revoke all on function public.cs_portal_equipment_set_job(text, uuid, uuid) from public;
revoke all on function public.cs_portal_equipment_archive(text, uuid, boolean) from public;
revoke all on function public.cs_portal_equipment_inventory(text) from public;
revoke all on function public.cs_portal_equipment_history(text, uuid) from public;
revoke all on function public.cs_portal_field_equipment(text) from public;
revoke all on function public.cs_portal_field_ladder_safe(text, uuid, boolean, text, text, int) from public;
revoke all on function public.cs_portal_field_ladder_defect(text, uuid, text, boolean, jsonb, text, int) from public;
revoke all on function public.cs_field_ladder_guard(text, uuid) from public;
revoke all on function public.cs_session_actor(text) from public;
grant execute on function public.cs_portal_equipment_add(text, text, text, text, text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.cs_portal_equipment_update(text, uuid, text, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.cs_portal_equipment_set_job(text, uuid, uuid) to anon, authenticated;
grant execute on function public.cs_portal_equipment_archive(text, uuid, boolean) to anon, authenticated;
grant execute on function public.cs_portal_equipment_inventory(text) to anon, authenticated;
grant execute on function public.cs_portal_equipment_history(text, uuid) to anon, authenticated;
grant execute on function public.cs_portal_field_equipment(text) to anon, authenticated;
grant execute on function public.cs_portal_field_ladder_safe(text, uuid, boolean, text, text, int) to anon, authenticated;
grant execute on function public.cs_portal_field_ladder_defect(text, uuid, text, boolean, jsonb, text, int) to anon, authenticated;
