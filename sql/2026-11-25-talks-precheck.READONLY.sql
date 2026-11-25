-- READ ONLY. Changes nothing. Paste into the SQL editor of the creekside-safety project before installing
-- the Talk Library and upload notices. Each select answers one question; send Claude the results.
-- Prints no phone numbers, PINs, hashes, tokens, keys or email addresses.

-- 1. Right project? Expect greiner_portal = 1 and every *_here = true.
select (select count(*) from public.cs_portals where slug = 'greiner') as greiner_portal,
       to_regclass('public.cs_company_docs') is not null as company_docs_here,
       to_regclass('public.cs_job_docs') is not null as job_docs_here,
       to_regclass('public.cs_tbt_assignments') is not null as talk_sender_here,
       to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null as pg_net_here,
       to_regprocedure('cron.schedule(text,text,text)') is not null as pg_cron_here,
       to_regclass('vault.decrypted_secrets') is not null as vault_here;

-- 2. The new names are still free. Expect all false (or true only for what you already installed).
select to_regclass('public.cs_tbt_library') is not null as library_table_exists,
       to_regclass('public.cs_upload_notices') is not null as notices_table_exists,
       to_regclass('public.cs_upload_notice_settings') is not null as notice_settings_exists,
       (select count(*) from pg_proc where proname like 'cs_portal_tbt_library%' or proname like 'cs_upload_notice%') as new_functions_already_there,
       (select count(*) from pg_trigger where tgname = 'cs_upload_notice') as notice_triggers_already_there;

-- 3. The shape of the company document table (not in the repo). The notice reads company_id, id, category,
--    filename and, if present, created_by / uploaded_by.
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'cs_company_docs'
 order by ordinal_position;

-- 4. The functions the document store calls (cs_portal_doc_add is not in the repo): their arguments.
select p.oid::regprocedure as function_and_arguments
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('cs_portal_doc_add', 'cs_portal_doc_authorize', 'cs_portal_doc_delete', 'cs_portal_doc_path',
                     'cs_portal_job_doc_add', 'cs_portal_cid')
 order by 1;

-- 5. What cs_portal_doc_add writes (one function body; no data).
select pg_get_functiondef('public.cs_portal_doc_add'::regproc) as doc_add_body;

-- 6. Triggers already on the two document tables (the notice adds one named cs_upload_notice to each).
select tgrelid::regclass as on_table, tgname as trigger_name
  from pg_trigger
 where not tgisinternal and tgrelid in ('public.cs_company_docs'::regclass, 'public.cs_job_docs'::regclass)
 order by 1, 2;

-- 7. Greiner's documents per folder (counts only), so the "Documents > folder" wording matches.
select coalesce(d.category, '(none)') as folder, count(*) as files
  from public.cs_company_docs d
 where d.company_id::text = (select company_id::text from public.cs_portals where slug = 'greiner')
 group by 1 order by 1;

-- 8. The proven email path: the Pipeline email settings the notice will copy (no email address, no key).
select key, value #>> '{}' as value
  from public.cs_program_settings
 where key in ('notify_provider_url', 'notify_auth_header', 'notify_secret_name', 'notify_sender')
 order by key;

-- 9. The Vault secret exists by name (its value is NOT shown).
select name, created_at from vault.secrets where name = 'cs_pipeline_email_key';

-- 10. Did the email service answer recently? (all pg_net answers, any sender; status codes only)
select status_code, count(*) as answers, max(created) as latest
  from net._http_response group by 1 order by 1;

-- 11. Scheduled jobs (the notice adds cs-upload-notices only after the switch-on file).
select jobname, schedule, active from cron.job order by jobname;
