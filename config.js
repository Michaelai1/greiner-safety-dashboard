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

  /* --- the dashboard gate --------------------------------------------
     CONVENIENCE GATE, NOT SECURITY. This runs in the browser and anyone
     who opens devtools can read it. It exists so a phone left unlocked on
     a job site does not show the dashboard, nothing more. The real access
     control is portalToken below, which is checked server side on every
     single read and write.                                              */
  gatePassword: '1234',

  /* --- the actual credential ------------------------------------------
     scope 'full'. Resolves server-side to exactly one company_id. Every RPC
     and every document call is scoped by it, so this portal physically
     cannot read another Creekside client's data. Rotate in cs_portal_tokens.
     Used by index.html ONLY. Never put this in a URL.                    */
  portalToken: 'fea75235d660d45bd176f764c315c055bf29d1a37a5989f3',

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
     scope 'submit'. This one DOES travel in the URL (inspect.html?k=...),
     so it is a different token to portalToken above and is deliberately
     near-useless if it leaks: server side it can fetch the blank template
     and the job names, and write one report. It cannot read a single
     existing report, certification, safety stat, or document. Anyone who
     gets this link can file a bogus inspection and nothing else.
     Revoke:  update cs_portal_tokens set active=false where token='...';  */
  inspector:  'Tony Sweet',
  inspectKey: '376327ee16666d72cf96c26be2babf36dcebbb1bcfe4be9f',

  /* --- Jobs -------------------------------------------------------------
     defaultJobNumber preselects the job picker on inspect.html.          */
  defaultJobNumber: 'C800-2025',

  /* --- Documents ------------------------------------------------------ */
  docCategories: ['OSHA 300 Logs', 'OSHA 300A', 'Insurance', 'Written Programs', 'Other'],
  docsFunction: 'company-docs',

  /* --- Safety stats ---------------------------------------------------
     TRIR and DART are computed, never stored: rate = n * 200000 / hours. */
  statsYears: 3,
};
