// company-docs — service-role broker for company safety documents.
// Private bucket cs-company-docs; every action authorized by the caller's
// portal session through security-definer RPCs.
// Backward compatible with the original contract: action 'sign' with a raw
// path still works (path must belong to the caller's company).
//
// v11 adds job documents (cs_job_docs), stored in the same private bucket under
// <company_id>/jobs/<job_id>/:
//   job_upload — office (full) sessions only; the server recomputes SHA-256 and
//                refuses the upload if it does not match what the caller sent.
//                The original bytes are stored as-is.
//   job_url    — signed URL (10 minutes) after cs_portal_job_doc_path confirms
//                the session may read that job's documents. download:true sets
//                the original filename as an attachment; bytes are unchanged.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = 'cs-company-docs';
const ALLOW = ['https://michaelai1.github.io', 'https://greiner.creeksidesafety.com'];
const MAX_BYTES = 15 * 1024 * 1024;
const MIME_OK = /^(application\/pdf|image\/(png|jpe?g|gif|webp|heic|heif)|text\/csv|application\/(msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|vnd\.ms-powerpoint))$/i;

function corsHeaders(origin: string | null) {
  const o = origin && ALLOW.includes(origin) ? origin : ALLOW[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(fn: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j: any = null;
  try { j = t ? JSON.parse(t) : null; } catch { /* non-json */ }
  if (!r.ok) throw new Error((j && (j.message || j.error)) || `rpc ${fn} failed (${r.status})`);
  return j;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers });

  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers }); }

  const svc = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const token = body.token;

  try {
    if (body.action === 'upload') {
      const filename = body.filename || body.name;
      const data = body.data_base64 || body.data;
      if (!token || !filename || !data) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      const auth = await rpc('cs_portal_doc_authorize', { p_token: token });   // full scope only
      const cid = auth.company_id;
      const mime = body.mime || 'application/octet-stream';
      if (!MIME_OK.test(mime)) return new Response(JSON.stringify({ error: 'file type not allowed (PDF, images, Office, CSV)' }), { status: 400, headers });
      const bytes = b64ToBytes(data);
      if (bytes.length > MAX_BYTES) return new Response(JSON.stringify({ error: 'file too large (15 MB max)' }), { status: 400, headers });
      const safe = String(filename).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
      const path = `${cid}/${crypto.randomUUID()}-${safe}`;
      const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
      const meta = await rpc('cs_portal_doc_add', {
        p_token: token, p_category: body.category || 'General', p_filename: filename, p_path: path, p_size: bytes.length,
      });
      return new Response(JSON.stringify({ ok: true, doc: meta }), { headers });
    }

    if (body.action === 'job_upload') {
      const { job_id, section, title, filename, sha256, source_date } = body;
      const data = body.data_base64;
      if (!token || !job_id || !section || !title || !filename || !sha256 || !data) {
        return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      }
      const auth = await rpc('cs_portal_doc_authorize', { p_token: token });   // full scope only
      const cid = auth.company_id;
      const mime = body.mime || 'application/pdf';
      if (!MIME_OK.test(mime)) return new Response(JSON.stringify({ error: 'file type not allowed (PDF, images, Office, CSV)' }), { status: 400, headers });
      const bytes = b64ToBytes(data);
      if (bytes.length > MAX_BYTES) return new Response(JSON.stringify({ error: 'file too large (15 MB max)' }), { status: 400, headers });
      const actual = await sha256Hex(bytes);
      if (actual !== String(sha256).toLowerCase()) {
        return new Response(JSON.stringify({ error: 'checksum mismatch — file changed in transit', sha256: actual }), { status: 400, headers });
      }
      const safe = String(filename).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
      const path = `${cid}/jobs/${job_id}/${crypto.randomUUID()}-${safe}`;
      const up = await svc.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (up.error) throw new Error(up.error.message);
      let meta: any;
      try {
        meta = await rpc('cs_portal_job_doc_add', {
          p_token: token, p_job_id: job_id, p_section: section, p_title: title, p_filename: filename,
          p_mime: mime, p_size: bytes.length, p_sha256: actual, p_source_date: source_date || null, p_path: path,
        });
      } catch (e) {
        await svc.storage.from(BUCKET).remove([path]);
        throw e;
      }
      if (meta && meta.existing) await svc.storage.from(BUCKET).remove([path]);   // same file already on this job
      return new Response(JSON.stringify({ ok: true, doc: meta, sha256: actual, size_bytes: bytes.length }), { headers });
    }

    if (body.action === 'job_url') {
      if (!token || !body.id) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      const res = await rpc('cs_portal_job_doc_path', { p_token: token, p_id: body.id });   // job + company check
      const opts = body.download ? { download: res.filename } : undefined;
      const signed = await svc.storage.from(BUCKET).createSignedUrl(res.path, 600, opts);
      if (signed.error) throw new Error(signed.error.message);
      return new Response(JSON.stringify({ ok: true, url: signed.data.signedUrl, filename: res.filename,
        mime: res.mime, sha256: res.sha256, size_bytes: res.size_bytes }), { headers });
    }

    if (body.action === 'url' || body.action === 'sign') {
      if (!token) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      let path: string, filename: string | null = null;
      if (body.id) {
        const res = await rpc('cs_portal_doc_path', { p_token: token, p_id: body.id });   // full scope + company check
        path = res.path; filename = res.filename;
      } else if (body.path) {
        // legacy path-based signing: the path must belong to the caller's company
        const auth = await rpc('cs_portal_doc_authorize', { p_token: token });
        if (!String(body.path).startsWith(auth.company_id + '/')) {
          return new Response(JSON.stringify({ error: 'not permitted' }), { status: 403, headers });
        }
        path = body.path;
      } else {
        return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      }
      const signed = await svc.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (signed.error) throw new Error(signed.error.message);
      return new Response(JSON.stringify({ ok: true, url: signed.data.signedUrl, filename }), { headers });
    }

    if (body.action === 'delete') {
      if (!token || !body.id) return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400, headers });
      const res = await rpc('cs_portal_doc_delete', { p_token: token, p_id: body.id });   // full scope + company check
      if (res && res.path) await svc.storage.from(BUCKET).remove([res.path]);
      return new Response(JSON.stringify({ ok: true }), { headers });
    }

    return new Response(JSON.stringify({ error: 'unknown action' }), { status: 400, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), { status: 400, headers });
  }
});
