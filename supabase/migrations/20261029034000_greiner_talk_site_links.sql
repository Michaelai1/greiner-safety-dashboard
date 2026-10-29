-- Display-only association. roster_job_id also controls attendance collection,
-- so leave it untouched when linking already-issued individual talk records.
begin;
create table if not exists public.cs_tbt_site_links (
 assignment_id uuid primary key references public.cs_tbt_assignments(id),
 job_id uuid not null references public.cs_jobs(id),
 source_ref text not null,
 created_at timestamptz not null default now()
);
alter table public.cs_tbt_site_links enable row level security;
revoke all on public.cs_tbt_site_links from public,anon,authenticated;
insert into public.cs_tbt_site_links(assignment_id,job_id,source_ref)
select a.id,j.id,'Tony Oct 24 site schedule; Oct 25 approved recipients; week Oct 26 Hot Work only'
from (values
 ('Clark McCardle','C809-2026'),('David Holloway','C800-2025'),
 ('Eric Sichting','C802-2026'),('Jason Gibbs','C799-2025'),
 ('Jaylin Smith','C797-2025'),('Keith Wilcox','C800-2025'),
 ('Matthew Logan','C796-2025'),('Robert Goble','C808-2026'),('Roger Hurst','C796-2025')
) m(person,job_number)
join public.cs_jobs j on j.job_number=m.job_number
join public.cs_tbt_assignments a on a.company_id=j.company_id and a.recipient_name=m.person
where a.company_id=(select company_id from public.cs_portals where slug='greiner')
 and a.week_start='2026-10-26' and a.talk_key='hot-work-general-awareness'
 and not a.is_test and a.revoked_at is null
on conflict(assignment_id) do nothing;
do $$ begin
 if (select count(*) from public.cs_tbt_site_links where source_ref='Tony Oct 24 site schedule; Oct 25 approved recipients; week Oct 26 Hot Work only')<>9 then
  raise exception 'Expected exactly nine verified site associations';
 end if;
end $$;
-- Existing function contains the same clause in its total and paged queries.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.cs_portal_site_safety(text,uuid,text,integer,integer)'::regprocedure);
 if length(definition)-length(replace(definition,'t.roster_job_id = p_job_id',''))<>2*length('t.roster_job_id = p_job_id') then
  raise exception 'Site safety function changed; review before patching';
 end if;
 definition:=replace(definition,'t.roster_job_id = p_job_id','coalesce(t.roster_job_id, (select l.job_id from public.cs_tbt_site_links l where l.assignment_id=t.id)) = p_job_id');
 execute definition;
end $$;
commit;
