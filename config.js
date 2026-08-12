/* ============================================================================
   GREINER BROTHERS — the only file you edit to stand up the next contractor.
   Copy this repo, change the values below, add the DNS record, done.
   Nothing contractor-specific lives anywhere else in index.html or inspect.html.
   ========================================================================== */
window.CONFIG = {

  /* --- who this portal is for ---------------------------------------- */
  contractor:  'Greiner Brothers',
  brand:       'Creekside Safety',
  pageTitle:   'Greiner Brothers Safety Dashboard',
  tagline:     'General contractor · Fishers, IN',   // sidebar subtitle, desk view

  /* --- sign-in ----------------------------------------------------------
     `slug` is PUBLIC. It is not a credential. It only names which portal to
     sign in to; the PIN is verified server side against a bcrypt hash and
     exchanged for a session.

     There is deliberately NO dashboard token in this file. An earlier version
     shipped one and it meant anyone who viewed source on the live subdomain
     had full read access. Do not reintroduce one.                        */
  slug: 'greiner',


  /* --- Creekside project (reports, jobs, certs, stats, documents) ----- */
  creekside: {
    url: 'https://gvfolfzseqwhhimbxgjv.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2Zm9sZnpzZXF3aGhpbWJ4Z2p2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxMzQzOTcsImV4cCI6MjA5OTcxMDM5N30.ZpJWG4a0evolcjxr36IDaA4o0pjRjw1cCGOWV9ofDE0',
    templateCode: 'site_safety_v2',
  },

  /* --- ToolGuard QR project (crew inspections from the field) ---------
     Separate Supabase project. Read-only here. `jobsiteMatch` filters the
     shared table down to this contractor's submissions.                 */
  toolguard: {
    url: 'https://tunkyqkgqzkgrbgrtroy.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1bmt5cWtncXprZ3JiZ3J0cm95Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTk3NDMsImV4cCI6MjA5MDQ3NTc0M30.JE6LtWo9FhAvLpXOQnj2YWPatGMJo8ho3z6ghn7sc2w',
    table: 'inspections',
    jobsiteMatch: null,   // null = show all rows in that project
  },

  /* --- inspect.html identity ------------------------------------------
     scope 'submit'. The ONLY static token left in the system, and it DOES
     travel in the URL (inspect.html?k=...),
     so it is deliberately
     near-useless if it leaks: server side it can fetch the blank template
     and the job names, and write one report. It cannot read a single
     existing report, certification, safety stat, or document. Anyone who
     gets this link can file a bogus inspection and nothing else.
     Revoke:  update cs_portal_tokens set active=false where token='...';  */
  inspector:  'Tony Sweet',
  inspectKey: '720abf2f713292291b23cb0ddf0d3304acc20265e8ed768f',

  /* --- Crew QR app -----------------------------------------------------
     Where the crew field forms live (JHA, hot work, equipment checks).
     "Send forms to a crew" texts this link with the requested forms named. */
  qrUrl: 'https://michaelai1.github.io/greiner-QR/',

  /* --- Jobs -------------------------------------------------------------
     defaultJobNumber preselects the job picker on inspect.html.          */
  defaultJobNumber: 'C800-2025',

  /* --- Documents ------------------------------------------------------ */
  docCategories: ['OSHA Logs', 'Insurance', 'ERM', 'Written Programs', 'Project Safety', 'Other'],
  docsFunction: 'company-docs',

  /* --- Safety stats ---------------------------------------------------
     TRIR and DART are computed, never stored: rate = n * 200000 / hours. */
  statsYears: 3,
};

/* ============================================================================
   MULTI-TENANT BOOT (NextGen OS, Milestone 1)
   One shared deployment serves every client; the client is the SUBDOMAIN:
   greiner.creeksidesafety.com -> slug 'greiner'. The values above are the
   FALLBACK — everything here is additive and never throws, so this file still
   works standalone and Greiner behaves identically whether or not the portal
   registry (cs_portals / cs_portal_config) has been provisioned yet.
   ========================================================================== */
(function () {
  var DEFAULT_SLUG = window.CONFIG.slug;                 // 'greiner' — fallback tenant
  var host = (location.hostname || '').toLowerCase();
  var m = /^([a-z0-9-]+)\.creeksidesafety\.com$/.exec(host);
  window.CONFIG.slug = (m && m[1] !== 'www') ? m[1] : DEFAULT_SLUG;

  window.CONFIG.accent  = window.CONFIG.accent || null;  // per-client accent (else CSS default)
  window.CONFIG.modules = null;                          // null = every module on (fail-safe)

  /* Is a feature module enabled for this client?  Unknown/unloaded -> ON, so a
     portal never loses features because the registry is missing or unreachable. */
  window.CONFIG.moduleOn = function (key) {
    if (key === 'overview') return true;                 // home is always present
    var mods = window.CONFIG.modules;
    return !Array.isArray(mods) || mods.indexOf(key) !== -1;
  };

  /* Fetch this client's registry row and merge branding + enabled modules over
     the static config. Returns a Promise that NEVER rejects; on any failure the
     static config above stands unchanged. Apps call this once at boot before
     building their nav. */
  window.loadPortalConfig = function () {
    var cs = window.CONFIG.creekside;
    return fetch(cs.url + '/rest/v1/rpc/cs_portal_config', {
      method: 'POST',
      headers: { apikey: cs.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: window.CONFIG.slug })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) {
        if (cfg && typeof cfg === 'object') {
          if (cfg.contractor_name) window.CONFIG.contractor = cfg.contractor_name;
          if (cfg.tagline)         window.CONFIG.tagline    = cfg.tagline;
          if (cfg.accent)          window.CONFIG.accent     = cfg.accent;
          if (Array.isArray(cfg.modules)) window.CONFIG.modules = cfg.modules;
          if (cfg.toolguard_override) window.CONFIG.toolguard =
            Object.assign({}, window.CONFIG.toolguard, cfg.toolguard_override);
        }
        return cfg || null;
      })
      .catch(function () { return null; });               // fail-safe: keep static config
  };
})();
