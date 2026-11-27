-- ============================================================================
-- DRAFT, NOT RUN. Toolbox Talk Library for the office Toolbox Talks tab.
-- Written Nov 25, 2026 after the Tony meeting. Michael runs this himself.
--
-- What it adds (add-only; nothing that is live today is changed, replaced or dropped):
--   cs_tbt_library                 one row per talk the office uploaded: name, category and the stored
--                                  file (a cs_company_docs row, private bucket).
--   cs_portal_tbt_library          office reads its own company's library.
--   cs_portal_tbt_library_add      office files an uploaded document as a talk.
--   cs_portal_tbt_library_set      office renames, re-files or removes a talk.
--   (Nov 26 addition, same file, add-only)
--   cs_tbt_library.planned_week    the Monday of the week the office uploaded a talk FOR ("Weeks ahead" view).
--                                  A note to ConfirmSafety only: it schedules nothing.
--   cs_portal_tbt_library_add_week office files an uploaded document as a talk for one week.
--   cs_portal_tbt_library_week     office moves a talk to another week, or clears its week.
--   (Nov 27 addition, same file, add-only)
--   cs_tbt_library.for_company     which company the talk is FOR: 'greiner' (default), 'peine' or 'choice'. A label
--                                  only: the row still belongs to the uploading office's company (company_id), so
--                                  who can read or change it does not change. Tony uploads for all three from one page.
--   The add, add-for-a-week and change functions take an optional p_for (default 'greiner', so the earlier calls
--   without it still work), and the library read returns for_company.
--
-- What it does NOT do:
--   It sends nothing and schedules nothing. cs_tbt_assignments, cs_tbt_sends, the cs-tbt-send cron job and
--   every existing function are untouched, so the weekly talk goes out exactly as before.
--   The "Weeks ahead" view reads the weeks already scheduled through the existing read-only
--   cs_portal_tbt_texts (installed Oct 5); nothing new reads or writes cs_tbt_assignments or cs_tbt_sends.
--   A planned week on a library row creates no talk record, no text and no email. Michael still sets up
--   each week's send himself from what the office uploaded.
--   It does not put a talk on a foreman's phone. A talk is 'received' until ConfirmSafety prepares the phone
--   version and sets talk_key + status 'ready' (owner step, see the bottom of this file).
--
-- Companies (Michael, Nov 27, replacing Nov 25): Tony uploads talks for Greiner, Peine and Choice from Greiner's
--   office page, "just broken up by company". Each row still belongs to the company of the office session that
--   uploaded it (Greiner); for_company only says which company the talk is for. Peine Engineering's own app and
--   database are not touched, and no Choice or Peine row is read or written here: ConfirmSafety sets up their
--   sends from what is uploaded.
--
-- Safe to run twice.
-- ============================================================================

begin;

do $$
begin
  -- Wrong-project guard: this must be the shared Greiner/Creekside database with the talk sender installed.
  if to_regclass('public.cs_tbt_assignments') is null
     or to_regclass('public.cs_company_docs') is null
     or to_regclass('public.cs_portals') is null
     or to_regprocedure('public.cs_portal_cid(text,text)') is null then
    raise exception 'WRONG PROJECT: the Greiner talk tables are not here. Nothing was changed.';
  end if;
  if not exists (select 1 from public.cs_portals where slug = 'greiner') then
    raise exception 'WRONG PROJECT: no "greiner" portal here. Nothing was changed.';
  end if;
end $$;

create table if not exists public.cs_tbt_library (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.cs_companies(id),
  title       text not null,
  category    text not null,
  doc_id      uuid not null references public.cs_company_docs(id) on delete restrict,
  status      text not null default 'received',
  talk_key    text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cs_tbt_library_title_check     check (btrim(title) <> '' and length(title) <= 160),
  constraint cs_tbt_library_category_check  check (btrim(category) <> '' and length(category) <= 60),
  constraint cs_tbt_library_status_check    check (status in ('received', 'ready')),
  constraint cs_tbt_library_ready_check     check (status <> 'ready' or nullif(btrim(talk_key), '') is not null)
);
create unique index if not exists cs_tbt_library_doc on public.cs_tbt_library (doc_id);
create index if not exists cs_tbt_library_company on public.cs_tbt_library (company_id, category);
-- Nov 26: the week the office uploaded the talk for (always a Monday; empty = no particular week).
alter table public.cs_tbt_library add column if not exists planned_week date
  constraint cs_tbt_library_week_monday check (planned_week is null or extract(isodow from planned_week) = 1);
create index if not exists cs_tbt_library_week on public.cs_tbt_library (company_id, planned_week)
  where planned_week is not null;
-- Nov 27: which company the talk is for (a label; the row stays the uploading office's).
alter table public.cs_tbt_library add column if not exists for_company text not null default 'greiner'
  constraint cs_tbt_library_for_check check (for_company in ('greiner', 'peine', 'choice'));

-- Nov 27: the add, add-for-a-week and change functions gained a last argument with a default (p_for). Postgres
-- would keep an older argument list next to the new one and then refuse calls without p_for as ambiguous, so the
-- older argument lists of THESE draft functions are dropped first. They were never installed anywhere (step 1 of
-- RELEASE-TALKS.md checks new_functions=0); this only matters if an earlier draft of this file was run.
drop function if exists public.cs_portal_tbt_library_add(text, uuid, text, text);
drop function if exists public.cs_portal_tbt_library_add_week(text, uuid, text, text, date);
drop function if exists public.cs_portal_tbt_library_set(text, uuid, text, text, boolean);
alter table public.cs_tbt_library enable row level security;
revoke all on public.cs_tbt_library from public, anon, authenticated;

-- ---- read ------------------------------------------------------------------
create or replace function public.cs_portal_tbt_library(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  return coalesce((select jsonb_agg(r order by r->>'category', r->>'title') from (
    select jsonb_build_object(
      'id', l.id,
      'title', l.title,
      'category', l.category,
      'status', l.status,
      'doc_id', l.doc_id,
      'filename', d.filename,
      'size_bytes', d.size_bytes,
      'created_at', l.created_at,
      'planned_week', l.planned_week,
      'for_company', l.for_company,
      -- How often this talk has really gone out (test sends left out), and the latest week. Greiner's sends
      -- only, so it is counted for Greiner's talks only (Peine and Choice sends are not in these rows).
      'times_sent', (select count(distinct a.week_start) from cs_tbt_assignments a
                      where a.company_id = v_cid and l.talk_key is not null and l.for_company = 'greiner'
                        and a.talk_key = l.talk_key and not a.is_test),
      'last_week', (select max(a.week_start) from cs_tbt_assignments a
                     where a.company_id = v_cid and l.talk_key is not null and l.for_company = 'greiner'
                       and a.talk_key = l.talk_key and not a.is_test)
    ) as r
    from cs_tbt_library l
    join cs_company_docs d on d.id = l.doc_id
    where l.company_id = v_cid and l.archived_at is null
  ) q), '[]'::jsonb);
end $$;
revoke all on function public.cs_portal_tbt_library(text) from public;
grant execute on function public.cs_portal_tbt_library(text) to anon, authenticated;

-- ---- add -------------------------------------------------------------------
create or replace function public.cs_portal_tbt_library_add(
  p_token text, p_doc_id uuid, p_title text, p_category text, p_for text default 'greiner'
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_id uuid; v_for text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  -- 'greiner', 'peine' or 'choice' (any case); left out = Greiner; anything else is refused.
  v_for := case when p_for is null then 'greiner'
                when lower(btrim(p_for)) in ('greiner', 'peine', 'choice') then lower(btrim(p_for)) end;
  if v_for is null then
    return jsonb_build_object('ok', false, 'error', 'bad_company');
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  if nullif(btrim(coalesce(p_category, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'category_required');
  end if;
  -- The file must be a document this same company uploaded.
  if p_doc_id is null or not exists (
      select 1 from cs_company_docs where id = p_doc_id and company_id = v_cid) then
    return jsonb_build_object('ok', false, 'error', 'bad_doc');
  end if;
  select id into v_id from cs_tbt_library where doc_id = p_doc_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
  end if;
  insert into cs_tbt_library (company_id, title, category, doc_id, for_company)
  values (v_cid, left(btrim(p_title), 160), left(btrim(p_category), 60), p_doc_id, v_for)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cs_portal_tbt_library_add(text, uuid, text, text, text) from public;
grant execute on function public.cs_portal_tbt_library_add(text, uuid, text, text, text) to anon, authenticated;

-- ---- change or remove ------------------------------------------------------
-- A null argument leaves that field as it is (p_for too: 'greiner', 'peine' or 'choice'). Removing hides the talk from the library; the file and the
-- row stay (nothing is deleted), and talk records already sent are not affected.
create or replace function public.cs_portal_tbt_library_set(
  p_token text, p_id uuid, p_title text default null, p_category text default null,
  p_archived boolean default null, p_for text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_n int; v_for text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  v_for := case when p_for is null then 'greiner'
                when lower(btrim(p_for)) in ('greiner', 'peine', 'choice') then lower(btrim(p_for)) end;
  if p_for is not null and v_for is null then
    return jsonb_build_object('ok', false, 'error', 'bad_company');
  end if;
  if p_title is not null and btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  if p_category is not null and btrim(p_category) = '' then
    return jsonb_build_object('ok', false, 'error', 'category_required');
  end if;
  update cs_tbt_library set
    title = coalesce(left(btrim(p_title), 160), title),
    category = coalesce(left(btrim(p_category), 60), category),
    for_company = case when p_for is null then for_company else v_for end,
    archived_at = case when p_archived is null then archived_at
                       when p_archived then coalesce(archived_at, now()) else null end,
    updated_at = now()
  where id = p_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_tbt_library_set(text, uuid, text, text, boolean, text) from public;
grant execute on function public.cs_portal_tbt_library_set(text, uuid, text, text, boolean, text) to anon, authenticated;


-- ---- add, for one week (Nov 26) ---------------------------------------------
-- Same as cs_portal_tbt_library_add, plus the Monday of the week the office uploaded the talk for. A separate
-- name (not a new argument on the function above) so the two can never be confused when called by name.
-- The week is a note to ConfirmSafety: nothing is scheduled, issued or sent. p_for as in cs_portal_tbt_library_add.
create or replace function public.cs_portal_tbt_library_add_week(
  p_token text, p_doc_id uuid, p_title text, p_category text, p_week date, p_for text default 'greiner'
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_id uuid; v_this_week date; v_for text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  v_this_week := date_trunc('week', (now() at time zone 'America/Indiana/Indianapolis'))::date;
  -- 'greiner', 'peine' or 'choice' (any case); left out = Greiner; anything else is refused.
  v_for := case when p_for is null then 'greiner'
                when lower(btrim(p_for)) in ('greiner', 'peine', 'choice') then lower(btrim(p_for)) end;
  if v_for is null then
    return jsonb_build_object('ok', false, 'error', 'bad_company');
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  if nullif(btrim(coalesce(p_category, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'category_required');
  end if;
  if p_week is null or extract(isodow from p_week) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_week');
  end if;
  if p_week < v_this_week or p_week > v_this_week + 7 * 26 then
    return jsonb_build_object('ok', false, 'error', 'week_out_of_range');
  end if;
  if p_doc_id is null or not exists (
      select 1 from cs_company_docs where id = p_doc_id and company_id = v_cid) then
    return jsonb_build_object('ok', false, 'error', 'bad_doc');
  end if;
  select id into v_id from cs_tbt_library where doc_id = p_doc_id;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'id', v_id, 'existing', true);
  end if;
  insert into cs_tbt_library (company_id, title, category, doc_id, planned_week, for_company)
  values (v_cid, left(btrim(p_title), 160), left(btrim(p_category), 60), p_doc_id, p_week, v_for)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cs_portal_tbt_library_add_week(text, uuid, text, text, date, text) from public;
grant execute on function public.cs_portal_tbt_library_add_week(text, uuid, text, text, date, text) to anon, authenticated;

-- ---- move to another week, or clear the week (Nov 26) -----------------------
create or replace function public.cs_portal_tbt_library_week(p_token text, p_id uuid, p_week date)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_n int; v_this_week date;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  v_this_week := date_trunc('week', (now() at time zone 'America/Indiana/Indianapolis'))::date;
  if p_week is not null and extract(isodow from p_week) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'bad_week');
  end if;
  if p_week is not null and (p_week < v_this_week or p_week > v_this_week + 7 * 26) then
    return jsonb_build_object('ok', false, 'error', 'week_out_of_range');
  end if;
  update cs_tbt_library set planned_week = p_week, updated_at = now()
   where id = p_id and company_id = v_cid and archived_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_tbt_library_week(text, uuid, date) from public;
grant execute on function public.cs_portal_tbt_library_week(text, uuid, date) to anon, authenticated;

commit;

-- Owner step, by hand, once a talk's phone version is live in greiner-QR (talks/library.js + the TALKS map):
--   update public.cs_tbt_library set status = 'ready', talk_key = '<the talk key>', updated_at = now()
--    where id = '<library id>';
-- The office then shows that talk as "Ready for foremen".

select 'done: Toolbox Talk Library installed (5 functions, 1 table with planned_week and for_company); nothing sent, nothing scheduled' as result,
       (select count(*) from pg_proc where proname like 'cs_portal_tbt_library%') as library_functions,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'cs_tbt_library' and column_name = 'planned_week') as planned_week_column,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'cs_tbt_library' and column_name = 'for_company') as for_company_column,
       (select count(*) from public.cs_tbt_library) as talks_in_library;
