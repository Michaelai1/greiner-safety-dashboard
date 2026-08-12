-- ============================================================================
-- Portal-scoped Incident RPCs for the Greiner dashboard.
--
-- Lets the (unauthenticated) contractor portal read/write its own incidents
-- through the session token, the same way certs/findings work. Operates on the
-- shared cs_incidents table (created by the Creekside migration
-- 2026-08-12-incidents.sql — RUN THAT FIRST so the table exists).
--
-- Depends on the existing helper:
--   cs_portal_cid(p_token text, p_need text) returns uuid  -- token -> company_id, raises on bad token
--
-- SECURITY DEFINER so the portal's anon key can reach past RLS, but every
-- statement is scoped to the token's own company_id — a portal can only ever
-- see or touch its own incidents.
-- ============================================================================

-- ── list this company's incidents ──────────────────────────────────────────
create or replace function public.cs_portal_incidents(p_token text)
returns setof public.cs_incidents
language sql
security definer
set search_path = public
as $$
  select * from public.cs_incidents
   where company_id = public.cs_portal_cid(p_token, 'full')
   order by occurred_on desc nulls last, created_at desc;
$$;
grant execute on function public.cs_portal_incidents(text) to anon, authenticated;

-- ── create / update an incident (payload as jsonb; id present => update) ────
create or replace function public.cs_portal_incident_save(p_token text, p_incident jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cid uuid;
  v_id  uuid := nullif(p_incident->>'id', '')::uuid;
  v_no  text;
begin
  v_cid := public.cs_portal_cid(p_token, 'full');
  if v_id is null then
    select 'INC-' || extract(year from now())::int || '-' ||
           lpad((count(*) + 1)::text, 3, '0')
      into v_no
      from public.cs_incidents
     where company_id = v_cid
       and extract(year from occurred_on) = extract(year from now());
    insert into public.cs_incidents
      (company_id, incident_no, job_id, type, title, occurred_on, occurred_at, severity, status,
       assigned_to, reported_by, description, immediate_action, root_cause, osha_recordable,
       corrective_actions, attachments)
    values
      (v_cid, v_no, p_incident->>'job_id', coalesce(p_incident->>'type', 'other'), p_incident->>'title',
       (nullif(p_incident->>'occurred_on', ''))::date, (nullif(p_incident->>'occurred_at', ''))::time,
       coalesce(p_incident->>'severity', 'medium'), coalesce(p_incident->>'status', 'open'),
       p_incident->>'assigned_to', p_incident->>'reported_by', p_incident->>'description',
       p_incident->>'immediate_action', p_incident->>'root_cause',
       coalesce((p_incident->>'osha_recordable')::boolean, false),
       coalesce(p_incident->'corrective_actions', '[]'::jsonb),
       coalesce(p_incident->'attachments', '[]'::jsonb))
    returning id into v_id;
  else
    update public.cs_incidents set
      job_id           = p_incident->>'job_id',
      type             = coalesce(p_incident->>'type', type),
      title            = p_incident->>'title',
      occurred_on      = (nullif(p_incident->>'occurred_on', ''))::date,
      occurred_at      = (nullif(p_incident->>'occurred_at', ''))::time,
      severity         = coalesce(p_incident->>'severity', severity),
      status           = coalesce(p_incident->>'status', status),
      assigned_to      = p_incident->>'assigned_to',
      reported_by      = p_incident->>'reported_by',
      description      = p_incident->>'description',
      immediate_action = p_incident->>'immediate_action',
      root_cause       = p_incident->>'root_cause',
      osha_recordable  = coalesce((p_incident->>'osha_recordable')::boolean, osha_recordable),
      corrective_actions = coalesce(p_incident->'corrective_actions', corrective_actions),
      attachments      = coalesce(p_incident->'attachments', attachments),
      updated_at       = now()
    where id = v_id and company_id = v_cid;
  end if;
  return (select to_jsonb(i) from public.cs_incidents i where i.id = v_id and i.company_id = v_cid);
end $$;
grant execute on function public.cs_portal_incident_save(text, jsonb) to anon, authenticated;

-- ── delete an incident ──────────────────────────────────────────────────────
create or replace function public.cs_portal_incident_delete(p_token text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_cid uuid;
begin
  v_cid := public.cs_portal_cid(p_token, 'full');
  delete from public.cs_incidents where id = p_id and company_id = v_cid;
end $$;
grant execute on function public.cs_portal_incident_delete(text, uuid) to anon, authenticated;
