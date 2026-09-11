-- ============================================================================
-- Planner: assign a piece of equipment to a job (or clear it).
-- Project: gvfolfzseqwhhimbxgjv. Run once in the Supabase SQL Editor.
--
-- Mirrors cs_portal_worker_unassign / cs_portal_worker_update: full-scope only,
-- SECURITY DEFINER, company-scoped. Pass p_job_id = a job to assign, or null to
-- take the unit off its job. The job (when given) must belong to the caller's
-- company, so no cross-company assignment is possible. Additive; nothing else
-- changes. This is the ONE write path the Planner uses for equipment.
-- ============================================================================

create or replace function public.cs_portal_equipment_set_job(
  p_token text, p_equipment_id uuid, p_job_id uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_n int;
begin
  v_cid := cs_portal_cid(p_token, 'full');   -- full scope only; field sessions rejected
  if p_job_id is not null and not exists (
      select 1 from cs_jobs where id = p_job_id and company_id = v_cid) then
    return json_build_object('ok', false, 'error', 'bad_job');
  end if;
  update cs_equipment set job_id = p_job_id
   where id = p_equipment_id and company_id = v_cid;
  get diagnostics v_n = row_count;
  if v_n = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true, 'id', p_equipment_id, 'job_id', p_job_id);
end $$;
revoke all on function public.cs_portal_equipment_set_job(text, uuid, uuid) from public;
grant  execute on function public.cs_portal_equipment_set_job(text, uuid, uuid) to anon, authenticated;
