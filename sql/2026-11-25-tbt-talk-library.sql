-- ============================================================================
-- DRAFT, NOT RUN. Toolbox Talk Library for the office Toolbox Talks tab.
-- Written Nov 25, 2026 after the Tony meeting. Michael runs this himself.
--
-- What it adds (add-only; nothing existing is changed, replaced or dropped):
--   cs_tbt_library                 one row per talk the office uploaded: name, category, which companies
--                                  it is for, and the stored file (a cs_company_docs row, private bucket).
--   cs_portal_tbt_library          office reads its own company's library.
--   cs_portal_tbt_library_add      office files an uploaded document as a talk.
--   cs_portal_tbt_library_set      office renames, re-files, re-targets or removes a talk.
--
-- What it does NOT do:
--   It sends nothing and schedules nothing. cs_tbt_assignments, cs_tbt_sends, the cs-tbt-send cron job and
--   every existing function are untouched, so the weekly talk goes out exactly as before.
--   It does not put a talk on a foreman's phone. A talk is 'received' until ConfirmSafety prepares the phone
--   version and sets talk_key + status 'ready' (owner step, see the bottom of this file).
--
-- Companies: Greiner Brothers and Choice share this database; Peine Engineering has its own. The "for" list
--   is a label on the talk ('greiner', 'choice', 'peine'). The row always belongs to the company of the
--   office session that uploaded it (Greiner). No Choice or Peine row is read or written here.
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
  companies   text[] not null,
  doc_id      uuid not null references public.cs_company_docs(id) on delete restrict,
  status      text not null default 'received',
  talk_key    text,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cs_tbt_library_title_check     check (btrim(title) <> '' and length(title) <= 160),
  constraint cs_tbt_library_category_check  check (btrim(category) <> '' and length(category) <= 60),
  constraint cs_tbt_library_companies_check check (cardinality(companies) >= 1
                                                   and companies <@ array['greiner', 'peine', 'choice']),
  constraint cs_tbt_library_status_check    check (status in ('received', 'ready')),
  constraint cs_tbt_library_ready_check     check (status <> 'ready' or nullif(btrim(talk_key), '') is not null)
);
create unique index if not exists cs_tbt_library_doc on public.cs_tbt_library (doc_id);
create index if not exists cs_tbt_library_company on public.cs_tbt_library (company_id, category);
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
      'companies', to_jsonb(l.companies),
      'status', l.status,
      'doc_id', l.doc_id,
      'filename', d.filename,
      'size_bytes', d.size_bytes,
      'created_at', l.created_at,
      -- How often this talk has really gone out (test sends left out), and the latest week.
      'times_sent', (select count(distinct a.week_start) from cs_tbt_assignments a
                      where a.company_id = v_cid and l.talk_key is not null
                        and a.talk_key = l.talk_key and not a.is_test),
      'last_week', (select max(a.week_start) from cs_tbt_assignments a
                     where a.company_id = v_cid and l.talk_key is not null
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
  p_token text, p_doc_id uuid, p_title text, p_category text, p_companies text[]
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_id uuid; v_cos text[];
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  if nullif(btrim(coalesce(p_category, '')), '') is null then
    return jsonb_build_object('ok', false, 'error', 'category_required');
  end if;
  select coalesce(array_agg(distinct lower(btrim(c)) order by lower(btrim(c))), '{}') into v_cos
    from unnest(coalesce(p_companies, '{}'::text[])) c where btrim(c) <> '';
  if cardinality(v_cos) = 0 or not (v_cos <@ array['greiner', 'peine', 'choice']) then
    return jsonb_build_object('ok', false, 'error', 'company_required');
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
  insert into cs_tbt_library (company_id, title, category, companies, doc_id)
  values (v_cid, left(btrim(p_title), 160), left(btrim(p_category), 60), v_cos, p_doc_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.cs_portal_tbt_library_add(text, uuid, text, text, text[]) from public;
grant execute on function public.cs_portal_tbt_library_add(text, uuid, text, text, text[]) to anon, authenticated;

-- ---- change or remove ------------------------------------------------------
-- A null argument leaves that field as it is. Removing hides the talk from the library; the file and the
-- row stay (nothing is deleted), and talk records already sent are not affected.
create or replace function public.cs_portal_tbt_library_set(
  p_token text, p_id uuid, p_title text default null, p_category text default null,
  p_companies text[] default null, p_archived boolean default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_cid uuid; v_cos text[]; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  if p_title is not null and btrim(p_title) = '' then
    return jsonb_build_object('ok', false, 'error', 'title_required');
  end if;
  if p_category is not null and btrim(p_category) = '' then
    return jsonb_build_object('ok', false, 'error', 'category_required');
  end if;
  if p_companies is not null then
    select coalesce(array_agg(distinct lower(btrim(c)) order by lower(btrim(c))), '{}') into v_cos
      from unnest(p_companies) c where btrim(c) <> '';
    if cardinality(v_cos) = 0 or not (v_cos <@ array['greiner', 'peine', 'choice']) then
      return jsonb_build_object('ok', false, 'error', 'company_required');
    end if;
  end if;
  update cs_tbt_library set
    title = coalesce(left(btrim(p_title), 160), title),
    category = coalesce(left(btrim(p_category), 60), category),
    companies = coalesce(v_cos, companies),
    archived_at = case when p_archived is null then archived_at
                       when p_archived then coalesce(archived_at, now()) else null end,
    updated_at = now()
  where id = p_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cs_portal_tbt_library_set(text, uuid, text, text, text[], boolean) from public;
grant execute on function public.cs_portal_tbt_library_set(text, uuid, text, text, text[], boolean) to anon, authenticated;

commit;

-- Owner step, by hand, once a talk's phone version is live in greiner-QR (talks/library.js + the TALKS map):
--   update public.cs_tbt_library set status = 'ready', talk_key = '<the talk key>', updated_at = now()
--    where id = '<library id>';
-- The office then shows that talk as "Ready for foremen".

select 'done: Toolbox Talk Library installed (3 functions, 1 table); nothing sent, nothing scheduled' as result,
       (select count(*) from public.cs_tbt_library) as talks_in_library;
