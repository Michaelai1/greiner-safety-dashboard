-- ============================================================================
-- DRAFT, NOT RUN. Rollback for the Nov 25 Talk Library and upload notices.
-- Part A stops the notice email and recording. Part B hides the Talk Library from the office page.
-- Nothing here deletes an uploaded file, a document row, a job document or any Toolbox Talk record.
-- Run Part A alone to stop only the emails. Each part is safe to run twice.
-- ============================================================================

-- ---- Part A: upload notices -----------------------------------------------
begin;
do $$
begin
  if to_regclass('public.cs_company_docs') is null or to_regclass('public.cs_job_docs') is null then
    raise exception 'WRONG PROJECT: the Greiner document tables are not here. Nothing was changed.';
  end if;
end $$;
drop trigger if exists cs_upload_notice on public.cs_company_docs;
drop trigger if exists cs_upload_notice on public.cs_job_docs;
drop function if exists public.cs_upload_notice_send();
drop function if exists public.cs_upload_notice_record();
drop function if exists public.cs_upload_notice_esc(text);
-- The two notice tables are kept (a record of what was uploaded). To remove them too:
--   drop table if exists public.cs_upload_notices; drop table if exists public.cs_upload_notice_settings;
commit;
select cron.unschedule(jobid) from cron.job where jobname = 'cs-upload-notices';

-- ---- Part B: Talk Library ---------------------------------------------------
-- The office page then says "The talk library could not be opened" on that tab; the Log is unaffected.
-- Redeploying the previous office page (see RELEASE-TALKS.md) removes the tab itself.
begin;
drop function if exists public.cs_portal_tbt_library(text);
drop function if exists public.cs_portal_tbt_library_add(text, uuid, text, text, text);
drop function if exists public.cs_portal_tbt_library_set(text, uuid, text, text, boolean, text);
drop function if exists public.cs_portal_tbt_library_add_week(text, uuid, text, text, date, text);
-- The argument lists before Nov 27 (no p_for), in case an earlier draft was ever installed.
drop function if exists public.cs_portal_tbt_library_add(text, uuid, text, text);
drop function if exists public.cs_portal_tbt_library_set(text, uuid, text, text, boolean);
drop function if exists public.cs_portal_tbt_library_add_week(text, uuid, text, text, date);
drop function if exists public.cs_portal_tbt_library_week(text, uuid, date);
-- The cs_tbt_library table is kept, with its planned_week and for_company columns (it only names files already in
-- Documents > Toolbox Talks, the week each was uploaded for and which company it is for).
commit;

select 'done: rollback ran; no file, document or talk record was deleted' as result,
       (select count(*) from pg_trigger where tgname = 'cs_upload_notice') as notice_triggers_left,
       (select count(*) from cron.job where jobname = 'cs-upload-notices') as notice_jobs_left,
       (select count(*) from pg_proc where proname like 'cs_portal_tbt_library%') as library_functions_left;
