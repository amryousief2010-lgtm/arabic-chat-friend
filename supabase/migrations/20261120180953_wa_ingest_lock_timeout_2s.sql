-- wa_ingest_lock_timeout_2s: WhatsApp ingest RPCs fail fast on lock waits (Meta re-delivers; ingest is idempotent). Approved by GM 2026-11-20 21:08 Riyadh.
ALTER FUNCTION public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text) SET lock_timeout = '2s';
ALTER FUNCTION public.cm_ingest_whatsapp_echo(text,text,text,timestamptz,text,text,jsonb,text) SET lock_timeout = '2s';
ALTER FUNCTION public.cm_update_whatsapp_status(text,text,timestamptz,text) SET lock_timeout = '2s';
ALTER FUNCTION public.cm_ingest_whatsapp_history(text,text,jsonb) SET lock_timeout = '2s';
