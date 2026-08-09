# Greiner Brothers Safety Dashboard

Two static pages. No build step. Deployed on GitHub Pages at
**https://greiner.creeksidesafety.com**

| File | What it is |
|---|---|
| `index.html` | The **phone** dashboard. Reports, Inspections, Jobs, Certifications. |
| `office.html` | The **desk** view. Everything above plus Findings, Documents, OSHA/TRIR/DART/EMR entry, prequal PDF. |
| `inspect.html` | The site safety form. Opens preloaded as the inspector, no login. |
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

**There is no secret in this repo.** `config.js` carries a public `slug` and the
Supabase anon key. The anon key on its own reaches nothing: every `cs_` table is
RLS-locked, verified — a direct anon read of `cs_reports` returns zero rows and
an anon insert is rejected.

### One portal per contractor, one PIN per person

Each contractor gets its own subdomain, its own copy of this repo, and its own
`slug`. A PIN from one portal does nothing on another — different slug,
different company, and the login only ever looks at users on the slug it was
handed.

Inside a portal, **every person has their own PIN**, in `cs_portal_users`. That
is what makes sessions say *Tony Sweet* rather than *someone at Greiner*, lets
you revoke one person without changing anyone else's code, and puts a real name
on submitted work. Greiner currently has one user: Tony Sweet.

`index.html` and `office.html` ship from the same deployment, so signing in on
one signs you in on the other. Same PIN, same session, one origin.

### Add or change a person

```sql
select cs_portal_set_user('greiner', 'Tony Sweet', '4827', 'Safety');
select cs_portal_set_user('greiner', 'Randy Greiner', '9153', 'Owner');
```

Same call creates or updates. Minimum 4 digits. It refuses:

- a PIN already used by someone else on that portal (otherwise the first
  matching hash wins and one person silently signs in as another)
- repeated or sequential digits — 0000, 1111, 1234, 4321 — which are what
  actually gets guessed

> A 4-digit PIN is 10,000 combinations, so the throttle carries the weight that
> PIN length does not. Failures are capped at **5 per IP / 15 min**, and per
> portal at **10 / 15 min, 20 / hour, 50 / day**. Fifty guesses a day is roughly
> 200 days to walk the whole keyspace, ~100 expected. If you want more margin,
> use 6 digits — `cs_portal_set_user` takes any length from 4 up.

```sql
update cs_portal_users set active = false where slug='greiner' and name='Tony Sweet';
delete from cs_portal_sessions where user_name = 'Tony Sweet';   -- kick them now
```

### Signing in

The user enters their PIN. It goes to `cs_portal_login(slug, pin)`, which:

- rate limits **before** checking anything, across four stacked windows: 5
  failures per IP in 15 min, and per portal 10 / 15 min, 20 / hour, 50 / day.
  The client IP comes from `x-forwarded-for`, which PostgREST does expose to
  RPCs.
- walks the portal's active users and compares against each **bcrypt hash**
  (`extensions.crypt`); no PIN is ever stored
- returns a random 32-byte session, good for 30 days, recorded in
  `cs_portal_sessions` with the IP and user agent that created it

The session lives in `localStorage` on that device. Every read and write carries
it, and the database resolves it to exactly one `company_id`.

> `cs_portal_login` **returns** `{ok:false, error}` instead of raising. That is
> deliberate: `RAISE EXCEPTION` aborts the transaction, which rolled back the
> row recording the failed attempt, so the rate limiter counted nothing and
> never fired. Caught by brute-forcing 12 wrong PINs and still getting in. If
> you refactor this, keep it returning a status object.

### Two credentials, and only one of them is static

| | Where it lives | What it can do |
|---|---|---|
| **PIN → session** | typed by the person, session in `localStorage` | Everything, for one company, 30 days, tagged with their name |
| **Inspect key** (`scope=submit`) | **in the URL**, `inspect.html?k=…` | Load the blank form, list job names, file one report. Nothing else. |

`cs_portal_cid` accepts a session token for any scope, but a **static** token
only when it is `submit`-scoped. A full-scope static token no longer resolves
anywhere — tested against the bundle, single reports, add-job, save-stats, and
all three document actions.

Worst case for a leaked inspect link is somebody files a junk inspection, which
you can see and delete.

### Changing the PIN

```sql
update cs_portal_tokens
   set pin_hash = extensions.crypt('NEWPIN', extensions.gen_salt('bf', 10))
 where slug = 'greiner';
```

Everyone stays signed in. To force them out too:

```sql
delete from cs_portal_sessions where slug = 'greiner';
```

### Seeing and revoking sessions

```sql
select right(token,8) as tail, ip, user_agent, created_at, expires_at
from cs_portal_sessions where slug = 'greiner' order by created_at desc;

delete from cs_portal_sessions where slug = 'greiner';          -- sign everyone out
update cs_portal_tokens set active = false where slug = 'greiner';  -- kill the portal
```

### What this is and is not

Sessions record who signed in, from what IP, on what device:

```sql
select user_name, ip, left(user_agent,40), created_at, expires_at
from cs_portal_sessions where slug='greiner' order by created_at desc;
```

What it does not do is prove the person at the keyboard is the person the PIN
belongs to — if Tony reads his code out loud, whoever heard it is Tony as far
as this is concerned. That is true of any PIN. If you ever need identity you can
defend rather than just attribute, that is Supabase Auth with email and password
per person, and the RPCs would take `auth.uid()` instead of a session token.

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
2. **Mint the full-scope row** (its token is never used by the page; the PIN is):
   ```sql
   insert into cs_portal_tokens (token, company_id, label, scope)
   select encode(gen_random_bytes(24),'hex'), id, '<Name> dashboard', 'full'
   from cs_companies where name = '<Exact company name>';
   ```
3. **Mint the submit token too:**
   ```sql
   insert into cs_portal_tokens (token, company_id, label, scope)
   select encode(gen_random_bytes(24),'hex'), id, '<Name> inspect link', 'submit'
   from cs_companies where name = '<Exact company name>'
   returning token;
   ```
4. **Set their PIN:**
   ```sql
   update cs_portal_tokens
      set slug = '<name>',
          pin_hash = extensions.crypt('THEIRPIN', extensions.gen_salt('bf', 10))
    where scope = 'full'
      and company_id = (select id from cs_companies where name = '<Exact company name>');
   ```
5. **Edit `config.js` only** — `contractor`, `pageTitle`, `slug`,
   `inspector`, `inspectKey` (submit), `defaultJobNumber`. If they have
   their own ToolGuard QR project, swap `toolguard.url` / `anonKey`; if they
   have none, set `toolguard.anonKey` to `''` and the Inspections list shows
   empty rather than erroring.
6. **Add the GoDaddy CNAME** with the new subdomain.
7. **Pages → Custom domain**, Enforce HTTPS.

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
