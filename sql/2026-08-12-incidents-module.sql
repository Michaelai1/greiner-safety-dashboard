-- ============================================================================
-- Register the Incidents feature in the portal module catalog and turn it on
-- for Greiner.
--
-- Why this is needed: the portal hides any nav item whose module is not in the
-- client's enabled-module list (cs_portal_config -> modules). The Incidents tab
-- gates on module key 'incidents', but that key was never in the cs_modules
-- catalog, so Greiner's enabled list (seeded as a cross-join of the catalog)
-- never carried it and the tab stayed hidden. This adds the catalog row and
-- enables it for the greiner portal.
--
-- ⚠ Targets the SHARED cs_ project (gvfolfzseqwhhimbxgjv) — same project as
--   2026-08-11-portal-registry.sql and 2026-08-12-portal-incidents.sql.
--
-- Depends on: 2026-08-11-portal-registry.sql (cs_modules, cs_portals,
-- cs_portal_modules). Idempotent — safe to run more than once.
-- ============================================================================

-- 1. Add Incidents to the module catalog (slots between findings and certs).
insert into public.cs_modules (key, name, description, type, default_price_monthly, sort) values
  ('incidents', 'Incidents', 'Report, investigate and track incidents + regulatory events', 'module', 0, 55)
on conflict (key) do nothing;

-- 2. Enable it for the Greiner portal.
insert into public.cs_portal_modules (portal_id, module_key, enabled, enabled_at)
select p.id, 'incidents', true, now()
from public.cs_portals p
where p.slug = 'greiner'
on conflict (portal_id, module_key) do update set enabled = true;

-- Verify:
--   select public.cs_portal_config('greiner');   -- 'modules' array should now include 'incidents'
