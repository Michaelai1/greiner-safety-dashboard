-- ============================================================================
-- Greiner Toolbox Talks by text: read-only office view.
--
-- One row per texted Toolbox Talk: who it went to, whether the text went out,
-- and whether the link was opened and submitted (with the foreman's crew list).
-- Office (full-scope) sessions only, scoped to the caller's company.
--
-- Never returned: the message body (it carries the personal link), the token
-- hash or prefix, the full phone number (last 4 only), or provider ids.
-- Read-only: nothing is sent, changed or scheduled by this function.
-- ============================================================================

create or replace function public.cs_portal_tbt_texts(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');
  return coalesce((select jsonb_agg(r order by r->>'sort_at' desc) from (
    select jsonb_build_object(
      'id', a.id,
      'talk_key', a.talk_key,
      'talk_title', a.talk_title,
      'recipient_name', a.recipient_name,
      'phone_last4', right(regexp_replace(coalesce(a.recipient_phone, ''), '\D', '', 'g'), 4),
      'role', a.role,
      'crew_job_id', a.roster_job_id,
      'is_test', a.is_test,
      'week_start', a.week_start,
      'revoked', a.revoked_at is not null,
      'send_status', s.status,
      'send_at', s.send_at,
      'sent_at', s.sent_at,
      'send_failed', s.status = 'failed',
      'opened_at', a.opened_at,
      'last_active_at', a.last_active_at,
      'active_ms', a.active_ms,
      'sections_viewed', a.sections_viewed,
      'format_used', a.format_used,
      'submitted_at', a.submitted_at,
      'presenter', a.presenter,
      'attendees', coalesce(a.attendees, '[]'::jsonb),
      'manual_attendees', coalesce(a.manual_attendees, '[]'::jsonb),
      'sort_at', coalesce(s.send_at, a.created_at)
    ) as r
    from cs_tbt_assignments a
    left join lateral (
      select x.status, x.send_at, x.sent_at from cs_tbt_sends x
       where x.assignment_id = a.id order by x.created_at desc limit 1) s on true
    where a.company_id = v_cid
  ) q), '[]'::jsonb);
end $$;

revoke all on function public.cs_portal_tbt_texts(text) from public;
grant execute on function public.cs_portal_tbt_texts(text) to anon, authenticated;
