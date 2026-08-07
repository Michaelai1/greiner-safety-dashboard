# Greiner Brothers Safety Dashboard

Two static pages. No build step. Deployed on GitHub Pages at
**https://greiner.creeksidesafety.com**

| File | What it is |
|---|---|
| `index.html` | The dashboard Tony opens. Reports, Inspections, Jobs, Certifications, Safety Stats, Documents, Written Programs. |
| `inspect.html` | The Safety 101 form. Opens preloaded as the inspector, no login. |
| `config.js` | **The only file you edit per contractor.** |
| `app.css` / `app.js` / `inspect.js` | Shared, contractor-agnostic. Copy verbatim. |

---

## DNS — add this in GoDaddy

**GoDaddy → creeksidesafety.com → DNS → Add record**

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `greiner` |
| Value | `michaelai1.github.io` |
| TTL | 1 Hour |

Just `greiner` in Name — GoDaddy appends the domain. Do **not** put the full
hostname or you get `greiner.creeksidesafety.com.creeksidesafety.com`.

Then in the repo: **Settings → Pages → Custom domain** →
`greiner.creeksidesafety.com`, Save, and tick **Enforce HTTPS** once the
certificate issues (10–60 minutes). The `CNAME` file in this repo already holds
that hostname; GitHub rewrites it when you save the setting, which is expected.

Check propagation with `dig greiner.creeksidesafety.com +short` — you want
`michaelai1.github.io` followed by four GitHub IPs.

---

## Security model — read this before changing anything

**The password is not the security.** `gatePassword` in `config.js` runs in the
browser. Anyone who opens devtools can read it. It exists so a phone left
unlocked on a job site does not show the dashboard. That is all it does.

**The actual control is `portalToken`.** All Creekside `cs_` tables have RLS on
and are unreachable with the anon key — verified: a direct anon read of
`cs_reports` returns zero rows and an anon insert is rejected. The dashboard
never queries a table. It calls security-definer functions that resolve the
token to exactly one `company_id` server side:

```
cs_portal_bundle      reports, jobs, certs, stats, docs  (read)
cs_portal_report      one full report for the PDF        (read)
cs_portal_template    the inspection template            (read)
cs_portal_add_job     add a job                          (write)
cs_portal_save_stats  upsert one year of stats           (write)
cs_portal_submit      submit an inspection               (write)
cs_portal_doc_add / cs_portal_doc_delete                 (write)
```

There is no code path in this repo that can reach another Creekside client's
data, because there is no query that takes a company id from the client. A
leaked token exposes one contractor, and you revoke it by flipping one row:

```sql
update cs_portal_tokens set active = false where token = '...';
```

`cs_portal_tokens` itself is unreadable by anon.

### Documents

Bucket `cs-company-docs`, **private**, 25 MB per file, restricted to PDF /
images / Office / CSV mime types. It has **no anon policies at all** — the anon
key cannot read, write, or list it. Access goes through the `company-docs`
Edge Function, which uses the service role and:

- rejects any token that is missing, unknown, or inactive
- forces every upload key to `<company_id>/<category-slug>/<timestamp>-<name>`
- refuses any supplied path that does not already start with that company's
  folder, so path traversal to another company returns `403`
- returns 120-second signed URLs, never permanent ones

`verify_jwt` is off on that function on purpose: the caller is an
unauthenticated static page, and the portal token is the credential.

> Storage RLS cannot see request headers — I tried the
> `current_setting('request.headers')` approach first and it denies everything,
> which is why the Edge Function exists. Do not try to "simplify" it back.

---

## Copying this for the next contractor

Target is under an hour.

1. **Duplicate the repo.** Change `CNAME` to `<name>.creeksidesafety.com`.
2. **Mint a token:**
   ```sql
   insert into cs_portal_tokens (token, company_id, label)
   select encode(gen_random_bytes(24),'hex'), id, '<Name> dashboard'
   from cs_companies where name = '<Exact company name>'
   returning token;
   ```
3. **Edit `config.js` only** — `contractor`, `pageTitle`, `portalToken`,
   `inspector`, `inspectKey`, `defaultJobNumber`, `gatePassword`. If they have
   their own ToolGuard QR project, swap `toolguard.url` / `anonKey`; if they
   have none, set `toolguard.anonKey` to `''` and the Inspections list shows
   empty rather than erroring.
4. **Add the GoDaddy CNAME** with the new subdomain.
5. **Pages → Custom domain**, Enforce HTTPS.

Nothing else is contractor-specific. `app.js`, `inspect.js`, and `app.css` are
byte-identical between deployments.

---

## Notes on the data

- **Jobs.** Greiner has 76 jobs in `cs_jobs`, 13 currently `active`. The
  dashboard and the inspection job picker show active only.
- **ToolGuard inspections** come from a different Supabase project
  (`tunkyqkgqzkgrbgrtroy`) and are read-only here. That project has RLS off, so
  its anon key is effectively public — it is already in old repos. Treat it as
  compromised and never put Creekside data in it.
- **`jobsite` is free text** in the ToolGuard `inspections` table, not a foreign
  key, so crew inspections cannot be reliably joined to `cs_jobs`. Set
  `toolguard.jobsiteMatch` in config to filter by a substring if that project
  ever holds more than one contractor.
- **TRIR and DART are computed, never stored** — `n × 200,000 ÷ hours`. Only the
  input numbers live in `cs_safety_stats`. EMR comes from the carrier and is
  typed in.
- **Certs** gained an `issued` column for "date completed"; it did not exist.

### Sample rows to delete when real data lands

```sql
delete from cs_worker_certs where notes = 'SAMPLE — replace with real records';
delete from cs_safety_stats where company_id =
  (select id from cs_companies where name='Greiner Brothers') and year in (2024,2025);
```

---

## Local preview

```bash
python3 -m http.server 8790
# dashboard  http://localhost:8790/
# inspection http://localhost:8790/inspect.html?k=<inspectKey>
```
