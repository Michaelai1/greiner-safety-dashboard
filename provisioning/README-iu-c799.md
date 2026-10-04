# IU Health Plaza G Med. Gas (C799-2025): production runbook

Status: **prepared, not run.** Nothing here has touched production. This repository is public, so people's names, phone
numbers and PINs are kept in the git-ignored `provisioning/iu-c799-2025.local.json`, never in tracked files.

## What it sets up

| Record | Change |
|---|---|
| `cs_jobs` C799-2025 | Reopened (`status = 'active'`, `closed_at = null`); exact address `1330 N Senate Ave, Indianapolis, IN 46202`; GC Wilhelm Gilbane; PM and lead foreman from the local file. |
| `cs_portal_users` | One **field** login per person (never office access), assigned to C799-2025 only. Created only when a PIN policy is given. An existing login is reused: its PIN is never changed, C799-2025 is added to its jobs. |
| `cs_field_user_forms` | `jha`, `hotwork`, `aerial`, `forklift` on C799-2025: the fullest set used on the comparable active job (C800-2025, Purdue). The retired Job Site Analysis Checklist is not granted. An existing row is left alone. |
| `cs_workers` (roster) | Matched by normalized phone, then by name, within the company. Missing phones are filled in; people not on the roster are added on C799-2025. Existing records keep their job unless `--move-roster` is given. |
| `cs_job_form_config` | No row, the same as C800-2025, so every default form is enabled. |

Every step matches first and stops the whole transaction on an ambiguous or conflicting match (two logins for one
person, a phone that belongs to someone else, an existing office login). Running it twice changes nothing the second
time; `tests/verify-iu-provisioning.mjs` proves this against an in-memory copy of the schema.

## Decision needed before any login is created: the PIN

The existing convention cannot be proven. Seven hand-provisioned field users have PINs equal to the last four digits of
their mobile, except one; the 22 Purdue users were given generated codes. The generator supports both answers:

- `--pin-policy=last4-of-mobile`: PIN is computed in the SQL from the mobile and never printed. Anyone who knows a
  person's mobile number knows their PIN.
- `--pin-policy=local-file`: Michael puts each person's chosen code in the local file (`"pin": "...."`). The printed
  SQL then contains those PINs; do not save or share it.

Without a policy the generator prepares the job and roster and reports every person as pending.

## Steps

1. Apply `sql/2026-10-05-equipment-management.sql` first if the equipment work ships at the same time (independent of
   this runbook).
2. Copy `iu-c799-2025.local.example.json` to `iu-c799-2025.local.json` and fill in the real names, mobiles and PM.
3. `node tools/provision-iu-c799.mjs --pin-policy=<decision> [--move-roster] > /tmp/iu-c799.sql` (outside the repo).
4. Review the SQL, run it in the Supabase SQL editor, and read the NOTICE lines (one per person).
5. Check: six field logins on C799-2025, each with the four forms; the job shows as active in Jobs and the Planner.
6. Delete `/tmp/iu-c799.sql`. Deliver PINs to each person individually; nothing in this repo sends messages.

## Still pending

- **Six original IU documents from Tony.** The Documents page and the IU job page show six empty slots. A slot is marked
  received only after the original file is uploaded and checked against what Tony sent (`JOB_DOC_ONBOARDING` in
  `office.js`).
- **Tony's RFIs** on which fields are dropdowns, free entry, auto-filled, or editable after submission. No form was
  changed for them.
- **IU crew picker (open follow-up, not complete).** Four of the six are on the roster of C785-2023 (IU Health Plmb
  Core & Shell), and a roster record holds one job. Decision 2026-10-04: do not move them; provision without
  `--move-roster`. Until fixed, the IU JHA crew picker lists only the two people added to C799-2025. Fix: have
  `cs_portal_field_home` build the crew list from field logins with C799-2025 in their job access (plus the roster),
  so every authorized IU user appears without losing their C785 roster job.
- **Hot work on a Wilhelm Gilbane site.** C799-2025 gets the default (Greiner's own hot work permit). If the GC
  requires its own permit, set `external_hotwork` for the job, as on the Taylorsville job (C808).
