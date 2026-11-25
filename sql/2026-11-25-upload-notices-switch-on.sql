-- ============================================================================
-- DRAFT, NOT RUN. Switch ON the upload notice email (after 2026-11-25-upload-notices.sql).
-- Michael runs this himself. Change ONE line (marked EDIT) to the inbox that should get the email.
--
-- It turns the email on, and asks pg_cron to run the sender every 10 minutes. Each run sends at most ONE
-- email listing every new upload of the last 10 minutes. No key or address of the email service is in
-- this file: it uses what the install copied from the Pipeline settings and the Vault secret by name.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.cs_upload_notice_settings') is null then
    raise exception 'WRONG PROJECT or not installed: run 2026-11-25-upload-notices.sql first. Nothing was changed.';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'pg_cron is missing here, so this is not the live Greiner project. Nothing was changed.';
  end if;
end $$;

update public.cs_upload_notice_settings
   set email_to = 'PUT-YOUR-EMAIL-HERE',            -- EDIT: the inbox that gets "Greiner office: new uploads"
       email_on = true, updated_at = now()
 where id = 1;

do $$
declare s public.cs_upload_notice_settings;
begin
  select * into s from public.cs_upload_notice_settings where id = 1;
  if coalesce(s.email_to, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' then
    raise exception 'Put your email address in the EDIT line first. Nothing was changed.';
  end if;
  if coalesce(s.provider_url, '') !~ '^https://' then
    raise exception 'No email service address was found in the Pipeline settings. Nothing was changed. Tell Claude.';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = s.secret_name) then
    raise exception 'The Vault secret named in the settings is missing. Nothing was changed. Tell Claude.';
  end if;
end $$;

commit;

-- Outside the transaction on purpose: on Nov 15 pg_cron did not pick up a job made inside an install transaction.
select cron.schedule('cs-upload-notices', '*/10 * * * *', 'select public.cs_upload_notice_send()');

select 'done: upload notice email ON; one email at most every 10 minutes' as result,
       (select count(*) from cron.job where jobname = 'cs-upload-notices') as cron_job,
       (select count(*) from public.cs_upload_notices where email_status = 'waiting') as waiting_now;
