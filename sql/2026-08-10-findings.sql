-- ============================================================================
-- Findings corrective actions — lets the Greiner dashboard save what was done
-- about a flagged item (text + photos) and close the finding.
--
-- Run once in the Supabase SQL editor (project gvfolfzseqwhhimbxgjv),
-- same as 2026-08-10-add-cert.sql. Until then the Findings tab still shows
-- the derived findings, but Save says the function is missing.
--
-- Findings themselves are DERIVED (flagged report items + flagged crew
-- forms), so only the response needs storage. `key` identifies the finding:
--   rf|<report_id>|<item_id>   flagged line on a Creekside report
--   cf|<toolguard_id>          flagged crew QR form
--
-- Schema assumptions (correct DB-side if wrong):
--   cs_portal_cid(p_token text, p_need text) returns uuid  — raises on bad token
--   pgcrypto lives in the `extensions` schema
-- ============================================================================

create table if not exists public.cs_finding_actions (
  company_id uuid not null,
  key        text not null,
  action     text not null,
  status     text not null default 'closed',
  photos     jsonb not null default '[]'::jsonb,   -- array of data-URL strings
  closed_by  text,
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

alter table public.cs_finding_actions enable row level security;
-- no policies on purpose: anon reaches this table ONLY through the
-- security-definer functions below.

create or replace function public.cs_portal_save_finding(
  p_token  text,
  p_key    text,
  p_action text,
  p_photos jsonb default '[]'::jsonb,
  p_by     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object('ok', false, 'error', 'finding key required');
  end if;
  if p_action is null or btrim(p_action) = '' then
    return jsonb_build_object('ok', false, 'error', 'corrective action required');
  end if;

  insert into cs_finding_actions (company_id, key, action, status, photos, closed_by, updated_at)
  values (v_cid, p_key, btrim(p_action), 'closed', coalesce(p_photos, '[]'::jsonb), p_by, now())
  on conflict (company_id, key) do update
    set action = excluded.action,
        photos = excluded.photos,
        closed_by = excluded.closed_by,
        status = 'closed',
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cs_portal_findings(
  p_token text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cid uuid;
  v_out jsonb;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select coalesce(jsonb_object_agg(key, jsonb_build_object(
           'action', action, 'status', status, 'photos', photos,
           'closed_by', closed_by, 'updated_at', updated_at)), '{}'::jsonb)
    into v_out
    from cs_finding_actions
   where company_id = v_cid;
  return v_out;
end;
$$;

grant execute on function public.cs_portal_save_finding(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.cs_portal_findings(text) to anon, authenticated;
