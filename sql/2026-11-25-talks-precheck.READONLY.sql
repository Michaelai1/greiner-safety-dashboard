-- READ ONLY. Changes nothing. Paste into the SQL editor of the creekside-safety project before installing
-- the Talk Library and upload notices. ONE result table (the SQL editor shows only the last result), one row
-- per question. Prints no phone numbers, PINs, hashes, tokens, keys or email addresses.

with greiner as (select company_id::text as cid from public.cs_portals where slug = 'greiner')
select * from (
  -- 1. Right project? Expect 1 and true everywhere.
  select '01 right project' as check_name,
         'greiner_portal=' || (select count(*) from public.cs_portals where slug = 'greiner')
      || ' company_docs=' || (to_regclass('public.cs_company_docs') is not null)
      || ' job_docs=' || (to_regclass('public.cs_job_docs') is not null)
      || ' talk_sender=' || (to_regclass('public.cs_tbt_assignments') is not null)
      || ' pg_net=' || (to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null)
      || ' pg_cron=' || (to_regprocedure('cron.schedule(text,text,text)') is not null)
      || ' vault=' || (to_regclass('vault.decrypted_secrets') is not null) as answer
  union all
  -- 2. New names still free? Expect false/0 (or true only for what you already installed).
  select '02 new names free',
         'library_table=' || (to_regclass('public.cs_tbt_library') is not null)
      || ' notices_table=' || (to_regclass('public.cs_upload_notices') is not null)
      || ' notice_settings=' || (to_regclass('public.cs_upload_notice_settings') is not null)
      || ' new_functions=' || (select count(*) from pg_proc where proname like 'cs_portal_tbt_library%' or proname like 'cs_upload_notice%')
      || ' notice_triggers=' || (select count(*) from pg_trigger where tgname = 'cs_upload_notice')
  union all
  -- 3. Shape of the company document table (not in the repo).
  select '03 cs_company_docs columns',
         coalesce((select string_agg(column_name || ' ' || data_type || case when is_nullable = 'NO' then ' not null' else '' end, ', ' order by ordinal_position)
                     from information_schema.columns where table_schema = 'public' and table_name = 'cs_company_docs'), 'missing')
  union all
  -- 4. The functions the document store calls, with their arguments (cs_portal_doc_add is not in the repo).
  select '04 document functions',
         coalesce((select string_agg(p.oid::regprocedure::text, ' | ' order by 1)
                     from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('cs_portal_doc_add', 'cs_portal_doc_authorize', 'cs_portal_doc_delete', 'cs_portal_doc_path',
                                        'cs_portal_job_doc_add', 'cs_portal_cid')), 'missing')
  union all
  -- 5. What cs_portal_doc_add writes (function body only; no data).
  select '05 cs_portal_doc_add body',
         coalesce((select string_agg(pg_get_functiondef(p.oid), E'\n----\n')
                     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'cs_portal_doc_add'), 'missing')
  union all
  -- 6. Triggers already on the two document tables (the notice adds cs_upload_notice to each).
  select '06 triggers on document tables',
         coalesce((select string_agg(tgrelid::regclass::text || ':' || tgname, ', ' order by 1)
                     from pg_trigger where not tgisinternal
                      and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace
                                        and relname in ('cs_company_docs', 'cs_job_docs'))), 'none')
  union all
  -- 7. Greiner's documents per folder (counts only).
  select '07 greiner documents per folder',
         coalesce((select string_agg(folder || '=' || files, ', ' order by folder) from (
                     select coalesce(d.category, '(none)') as folder, count(*) as files
                       from public.cs_company_docs d where d.company_id::text = (select cid from greiner) group by 1) f), 'none')
  union all
  -- 8. The proven email path: the Pipeline email settings the notice copies (no email address, no key).
  select '08 pipeline email settings',
         coalesce((select string_agg(key || '=' || (value #>> '{}'), ' | ' order by key)
                     from public.cs_program_settings
                    where key in ('notify_provider_url', 'notify_auth_header', 'notify_secret_name', 'notify_sender')), 'none')
  union all
  -- 9. The Vault secret exists by name (its value is NOT read).
  select '09 vault secret by name',
         (select count(*) from vault.secrets where name = 'cs_pipeline_email_key')::text || ' named cs_pipeline_email_key'
  union all
  -- 10. Did the email service answer recently? (all pg_net answers, any sender; status codes only)
  select '10 pg_net answers by status',
         coalesce((select string_agg(coalesce(status_code::text, 'none') || '=' || n || ' latest ' || latest, ', ' order by status_code)
                     from (select status_code, count(*) as n, max(created)::text as latest from net._http_response group by 1) r), 'none kept')
  union all
  -- 11. Scheduled jobs (the notice adds cs-upload-notices only with the switch-on file).
  select '11 cron jobs',
         coalesce((select string_agg(jobname || ' ' || schedule || case when active then '' else ' (off)' end, ', ' order by jobname) from cron.job), 'none')
) q
order by check_name;
