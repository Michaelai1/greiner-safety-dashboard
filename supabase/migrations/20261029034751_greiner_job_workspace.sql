begin;
-- A separate read API for job-scoped staff. Never promotes field sessions to
-- full scope and never changes the company-wide office RPCs.
create schema if not exists private;
create or replace function private.greiner_job_workspace(p_token text, p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare cid uuid; people jsonb;
begin
 select s.company_id into cid
 from public.cs_portal_sessions s
 join public.cs_portal_users u on u.id=s.user_id and u.slug=s.slug
 join public.cs_portals p on p.slug=s.slug and p.company_id=s.company_id
 where s.token=p_token and s.expires_at>now() and s.slug='greiner'
 and s.scope='field' and u.active and u.role='field'
 and p_job_id=any(coalesce(s.job_ids,'{}'::uuid[]))
 and p_job_id=any(coalesce(u.job_ids,'{}'::uuid[]))
 and exists(select 1 from public.cs_portal_site_safety_grants g where g.user_id=u.id and g.job_id=p_job_id);
 if cid is null or not exists(select 1 from public.cs_jobs j where j.id=p_job_id and j.company_id=cid) then
  raise exception 'job not permitted' using errcode='P0001';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',x.name,'classification',x.classification) order by x.name),'[]'::jsonb)
 into people from (
 select distinct on(lower(name)) name,classification from (
 select w.name,w.classification,0 as priority from public.cs_workers w where w.company_id=cid and w.job_id=p_job_id and w.active
 union all
 select u.name,u.title,1 from public.cs_portal_users u where u.slug='greiner' and u.active and u.role='field' and p_job_id=any(u.job_ids)
 ) names order by lower(name),priority
 ) x;
 return jsonb_build_object(
 'job_id',p_job_id,'checked_at',now(),
 'job',(select jsonb_build_object('id',j.id,'name',j.name,'job_number',j.job_number,'address',j.address,'status',j.status,'foreman_name',j.foreman_name,'pm_name',j.pm_name,'gc_name',j.gc_name,'start_date',j.start_date) from public.cs_jobs j where j.id=p_job_id and j.company_id=cid),
 'people',people,
 'certs',coalesce((select jsonb_agg(jsonb_build_object('worker',c.worker,'cert_type',c.cert_type,'issued',c.issued,'expires',c.expires) order by c.worker,c.cert_type)
 from public.cs_worker_certs c where c.company_id=cid and exists(select 1 from jsonb_array_elements(people) x where lower(x->>'name')=lower(c.worker))),'[]'::jsonb),
 'equipment',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'unit_number',q.unit_number,'equipment_type',q.equipment_type,'make',q.make,'model',q.model,'serial',q.serial,'active',q.active) order by q.unit_number) from public.cs_equipment q where q.company_id=cid and q.job_id=p_job_id),'[]'::jsonb),
 -- Crew-facing operational status, not medical narratives, witness details
 -- or unrestricted attachment URLs from incident investigations.
 'incidents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'incident_no',i.incident_no,'type',i.type,'occurred_on',i.occurred_on,'status',i.status,'assigned_to',i.assigned_to) order by i.occurred_on desc) from public.cs_incidents i where i.company_id=cid and i.job_id=p_job_id),'[]'::jsonb)
 );
end $$;
revoke all on function private.greiner_job_workspace(text,uuid) from public;
grant usage on schema private to anon,authenticated;
grant execute on function private.greiner_job_workspace(text,uuid) to anon,authenticated;
create or replace function public.cs_portal_job_workspace(p_token text,p_job_id uuid)
returns jsonb language sql stable security invoker set search_path=''
as $$ select private.greiner_job_workspace(p_token,p_job_id); $$;
revoke all on function public.cs_portal_job_workspace(text,uuid) from public;
grant execute on function public.cs_portal_job_workspace(text,uuid) to anon,authenticated;
commit;
