-- ============================================================================
-- cs_portal_add_cert — lets the Greiner dashboard add worker certifications.
--
-- Run this once in the Supabase SQL editor (project gvfolfzseqwhhimbxgjv).
-- Until it exists, the Add Certification button on the phone build shows
-- "Server function missing" instead of saving.
--
-- Schema assumptions (correct DB-side if wrong):
--   cs_worker_certs(company_id uuid, worker text, cert_type text,
--                   issued date, expires date)   -- `issued` added 2026-08
--   cs_portal_cid(p_token text, p_need text) returns uuid
--     — resolves a session token to one company_id, raises on invalid token.
-- ============================================================================

create or replace function public.cs_portal_add_cert(
  p_token     text,
  p_worker    text,
  p_cert_type text,
  p_issued    date,
  p_expires   date
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cid uuid;
begin
  v_cid := cs_portal_cid(p_token, 'full');

  if p_worker is null or btrim(p_worker) = '' then
    return jsonb_build_object('ok', false, 'error', 'worker name required');
  end if;
  if p_cert_type is null or btrim(p_cert_type) = '' then
    return jsonb_build_object('ok', false, 'error', 'certification type required');
  end if;
  if p_expires is null then
    return jsonb_build_object('ok', false, 'error', 'expiration date required');
  end if;

  insert into cs_worker_certs (company_id, worker, cert_type, issued, expires)
  values (v_cid, btrim(p_worker), btrim(p_cert_type), p_issued, p_expires);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.cs_portal_add_cert(text, text, text, date, date)
  to anon, authenticated;
