-- ============================================================================
-- NextGen AI — Portal Registry (Milestone 1 of the Internal Operating System)
--
-- Turns "copy the repo per client" into "one codebase, one config row per
-- client." A single shared deployment resolves the client from its subdomain
-- slug and boots from cs_portal_config(slug): branding + which feature modules
-- are turned on. Modules double as the revenue model — each enabled module
-- carries a price, so MRR = sum of enabled module prices (the scoreboard reads
-- the same table the portal gates features from).
--
-- ⚠ Targets the SHARED cs_ project (gvfolfzseqwhhimbxgjv) — the same project
--   every Greiner-style portal already uses. Run it there.
--
-- SAFE BY DESIGN: the portal code falls back to its static config.js whenever
-- cs_portal_config(slug) returns null, so Greiner keeps working with or without
-- this migration applied. Applying it (with the seed at the bottom) makes
-- Greiner the first real registry row with all its current modules on.
--
-- Schema assumptions (correct here if the live DB differs):
--   * cs_companies(id text primary key, ...)            — id is TEXT (e.g. 'c1')
--   * cs_portal_tokens(slug text, company_id text, scope text, ...) — the
--     existing per-portal identity row; scope 'full' is the dashboard token.
--   * RLS style on cs_ tables: authenticated-only, USING (auth.role()='authenticated').
-- ============================================================================

-- ─── 1. cs_modules — the catalog of features a portal can have ─────────────
-- key is the stable identifier the portal code gates on. type:
--   core   = always on, not sellable/removable (overview)
--   module = a standard feature, on/off per client
--   addon  = an upsell, typically priced
create table if not exists public.cs_modules (
  key            text primary key,
  name           text not null,
  description    text,
  type           text not null default 'module' check (type in ('core','module','addon')),
  default_price_monthly numeric not null default 0,
  sort           int not null default 100,
  created_at     timestamptz not null default now()
);

insert into public.cs_modules (key, name, description, type, default_price_monthly, sort) values
  ('overview',      'Overview',              'Home dashboard — always on',                         'core',   0,   10),
  ('jobsites',      'Jobsites',              'Active jobsites list',                                'module', 0,   20),
  ('reports',       'Reports',               'Creekside consultant inspection reports',             'module', 0,   30),
  ('inspections',   'Inspections',           'Crew-submitted JHAs / permits / equipment checks',    'module', 0,   40),
  ('findings',      'Findings',              'Corrective-action tracking',                          'module', 0,   50),
  ('certifications','Certifications',        'Worker certification tracking + renewals',            'module', 0,   60),
  ('documents',     'Documents',             'Compliance document vault',                           'module', 0,   70),
  ('send_forms',    'Send forms to crew',    'Text crew a link to field forms',                     'addon',  0,   80),
  ('training_cards','Training cards',        'Generate printable certification cards',              'addon',  0,   90),
  ('safety_stats',  'Safety stats (TRIR/DART)','OSHA 300A recordables + TRIR/DART',                 'addon',  0,  100),
  ('annual_report', 'Annual compliance report','Print-ready insurance-renewal packet',             'addon',  0,  110)
on conflict (key) do nothing;

-- ─── 2. cs_portals — one row per client portal ─────────────────────────────
create table if not exists public.cs_portals (
  id              uuid primary key default gen_random_uuid(),
  company_id      text references public.cs_companies(id),
  slug            text unique not null,       -- resolved from the subdomain
  subdomain       text,                        -- e.g. greiner.creeksidesafety.com
  status          text not null default 'provisioning' check (status in ('provisioning','live','paused')),
  phase           int  not null default 1,     -- §8 onboarding stage 1..10
  contractor_name text,                         -- branding override (else cs_companies.name)
  tagline         text,
  accent          text,                         -- hex, drives --accent
  toolguard_override jsonb,                     -- optional per-client crew-inspection source
  created_at      timestamptz not null default now()
);

-- ─── 3. cs_portal_modules — per-client module enablement + price (MRR) ─────
create table if not exists public.cs_portal_modules (
  portal_id     uuid not null references public.cs_portals(id) on delete cascade,
  module_key    text not null references public.cs_modules(key),
  enabled       boolean not null default true,
  price_monthly numeric not null default 0,
  enabled_at    timestamptz,                    -- set when first enabled; powers expansion/churn
  primary key (portal_id, module_key)
);

-- ─── RLS: console (authenticated) manages all three; portal reads via RPC ──
alter table public.cs_modules        enable row level security;
alter table public.cs_portals        enable row level security;
alter table public.cs_portal_modules enable row level security;

drop policy if exists cs_modules_authed        on public.cs_modules;
drop policy if exists cs_portals_authed         on public.cs_portals;
drop policy if exists cs_portal_modules_authed  on public.cs_portal_modules;
create policy cs_modules_authed        on public.cs_modules        for all to authenticated using (auth.role()='authenticated') with check (auth.role()='authenticated');
create policy cs_portals_authed         on public.cs_portals         for all to authenticated using (auth.role()='authenticated') with check (auth.role()='authenticated');
create policy cs_portal_modules_authed  on public.cs_portal_modules  for all to authenticated using (auth.role()='authenticated') with check (auth.role()='authenticated');

-- ─── 4. cs_portal_config(slug) — PUBLIC boot RPC ───────────────────────────
-- Returns ONLY safe, public data (branding + enabled module keys). Never a PIN,
-- token, key, or price. Security-definer so an anon portal can read past RLS,
-- but the SELECT is scoped to the one slug and the safe columns only.
create or replace function public.cs_portal_config(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when p.id is null then null else jsonb_build_object(
    'slug',            p.slug,
    'status',          p.status,
    'phase',           p.phase,
    'contractor_name', coalesce(p.contractor_name, c.name),
    'tagline',         p.tagline,
    'accent',          p.accent,
    'toolguard_override', p.toolguard_override,
    'modules', coalesce((
        select jsonb_agg(pm.module_key order by m.sort)
        from public.cs_portal_modules pm
        join public.cs_modules m on m.key = pm.module_key
        where pm.portal_id = p.id and pm.enabled
      ), '[]'::jsonb)
  ) end
  from public.cs_portals p
  left join public.cs_companies c on c.id = p.company_id
  where p.slug = lower(p_slug)
  limit 1;
$$;

grant execute on function public.cs_portal_config(text) to anon, authenticated;

-- ─── 5. Seed Greiner as the first portal ───────────────────────────────────
-- Resolve Greiner's company_id from its existing 'full' portal token so we
-- don't hardcode an id. Enable every module Greiner runs today (prices 0 for
-- now — set real prices from the console later).
-- contractor_name/tagline are pinned to EXACTLY the current config.js values so
-- provisioning Greiner changes nothing it displays today. accent left NULL so
-- the portal keeps its default CSS accent.
insert into public.cs_portals (company_id, slug, subdomain, status, phase, contractor_name, tagline)
select t.company_id, 'greiner', 'greiner.creeksidesafety.com', 'live', 10,
       'Greiner Brothers', 'General contractor · Fishers, IN'
from public.cs_portal_tokens t
where t.slug = 'greiner' and t.scope = 'full'
limit 1
on conflict (slug) do nothing;

insert into public.cs_portal_modules (portal_id, module_key, enabled, enabled_at)
select p.id, m.key, true, now()
from public.cs_portals p
cross join public.cs_modules m
where p.slug = 'greiner'
on conflict (portal_id, module_key) do nothing;

-- Verify:
--   select public.cs_portal_config('greiner');
