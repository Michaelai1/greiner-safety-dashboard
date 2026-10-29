-- Run after migration in a disposable transaction; no sessions are retained.
begin;
do $test$
declare u record; tok text; payload jsonb; checked integer:=0; other uuid; rejected boolean;
begin
 for u in select x.*,g.job_id from public.cs_portal_users x join public.cs_portal_site_safety_grants g on g.user_id=x.id where x.slug='greiner' loop
  tok:='job-workspace-test-'||extensions.gen_random_uuid()::text;
  insert into public.cs_portal_sessions(token,company_id,scope,slug,expires_at,user_id,user_name,job_ids)
  values(tok,(select company_id from public.cs_portals where slug='greiner'),'field','greiner',now()+interval '5 minutes',u.id,u.name,u.job_ids);
  payload:=public.cs_portal_job_workspace(tok,u.job_id);
  if payload->>'job_id'<>u.job_id::text or jsonb_array_length(payload->'people')<1 then raise exception 'assigned job test failed'; end if;
  select id into other from public.cs_jobs where id<>u.job_id limit 1;
  rejected:=false;
  begin perform public.cs_portal_job_workspace(tok,other); exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'cross job access not rejected'; end if;
  rejected:=false;
  begin perform public.cs_portal_bundle(tok); exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'company-wide access not rejected'; end if;
  update public.cs_portal_sessions set expires_at=now()-interval '1 second' where token=tok;
  rejected:=false;
  begin perform public.cs_portal_job_workspace(tok,u.job_id); exception when sqlstate 'P0001' then rejected:=true; end;
  if not rejected then raise exception 'expired session accepted'; end if;
  delete from public.cs_portal_sessions where token=tok;
  checked:=checked+1;
 end loop;
 if checked<>30 then raise exception 'Expected 30 grants, got %',checked; end if;
end $test$;
select '30 accounts: assigned job allowed; other job, company-wide bundle and expired session denied. Transaction rolled back.' as verification;
rollback;
