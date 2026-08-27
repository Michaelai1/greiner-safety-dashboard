-- Edit an internal employee from the office dashboard (full-scope sessions only).
-- Null = keep current value; empty string = clear (phone/classification/email).
-- Renames cascade to cs_worker_certs.worker so training history follows the person.
-- Applied to production 2026-08-27 (migration: cs_portal_worker_update).
create or replace function public.cs_portal_worker_update(
  p_token text,
  p_worker_id uuid,
  p_name text default null,
  p_phone text default null,
  p_classification text default null,
  p_job_id uuid default null,
  p_email text default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_cid uuid;
  v_old record;
  v_new_name text;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  select * into v_old from cs_workers where id = p_worker_id and company_id = v_cid;
  if not found then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  v_new_name := coalesce(nullif(btrim(p_name), ''), v_old.name);

  if lower(v_new_name) <> lower(v_old.name) and exists (
      select 1 from cs_workers
      where company_id = v_cid and lower(name) = lower(v_new_name) and id <> p_worker_id) then
    return json_build_object('ok', false, 'error', 'name_taken');
  end if;

  if p_job_id is not null and not exists (
      select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;

  update cs_workers set
    name = v_new_name,
    phone = case when p_phone is null then phone else nullif(btrim(p_phone), '') end,
    classification = case when p_classification is null then classification else nullif(btrim(p_classification), '') end,
    email = case when p_email is null then email else nullif(btrim(p_email), '') end,
    job_id = coalesce(p_job_id, job_id)
  where id = p_worker_id;

  if v_new_name <> v_old.name then
    update cs_worker_certs set worker = v_new_name
    where company_id = v_cid and worker = v_old.name;
  end if;

  return json_build_object('ok', true, 'id', p_worker_id, 'name', v_new_name);
end $$;

revoke all on function public.cs_portal_worker_update(text, uuid, text, text, text, uuid, text) from public;
grant execute on function public.cs_portal_worker_update(text, uuid, text, text, text, uuid, text) to anon, authenticated;
