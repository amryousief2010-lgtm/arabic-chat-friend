-- wa_ingest: دور مخصّص لويبهوك واتساب (اتصال مباشر عبر Supavisor بدل طابور PostgREST).
-- كلمة المرور لا تُخزَّن هنا: تُضبط منفصلة (ALTER ROLE ... PASSWORD '<SCRAM verifier>') ومخزّنة في أسرار الدالة فقط.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wa_ingest') THEN
    CREATE ROLE wa_ingest LOGIN NOINHERIT CONNECTION LIMIT 8;
  ELSE
    ALTER ROLE wa_ingest LOGIN CONNECTION LIMIT 8;
  END IF;
END $$;
ALTER ROLE wa_ingest SET lock_timeout = '2s';
ALTER ROLE wa_ingest SET statement_timeout = '10s';
GRANT USAGE ON SCHEMA public TO wa_ingest;
GRANT EXECUTE ON FUNCTION
  public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text),
  public.cm_ingest_whatsapp_echo(text,text,text,timestamptz,text,text,jsonb,text),
  public.cm_ingest_whatsapp_history(text,text,jsonb),
  public.cm_update_whatsapp_status(text,text,timestamptz,text),
  public.cm_sync_whatsapp_contacts(text,jsonb),
  public.cm_log_whatsapp_webhook(text,text,integer,integer,integer,integer,jsonb)
TO wa_ingest;
