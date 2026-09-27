-- Owner-approved close of legacy documents after the 30 Sep 2026 stocktake.
-- Status becomes closed_by_stocktake. No inventory movement and no stock write.
-- Allowed: general_manager and executive_manager, and only when an approved
-- stocktake at or after 2026-09-30 Africa/Cairo exists for the document warehouse
-- and the document is dated before that baseline.

ALTER TABLE public.meat_manufacturing_invoices
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

ALTER TABLE public.warehouse_transfers
  ADD COLUMN IF NOT EXISTS closed_by uuid,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS closed_reason text;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.meat_manufacturing_invoices'::regclass
       AND con.contype = 'c'
       AND a.attname = 'status'
  LOOP
    EXECUTE format('ALTER TABLE public.meat_manufacturing_invoices DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.meat_manufacturing_invoices
  ADD CONSTRAINT meat_manufacturing_invoices_status_check
  CHECK (status IN ('draft', 'approved', 'transferred', 'cancelled', 'closed_by_stocktake'));

CREATE OR REPLACE FUNCTION public.validate_warehouse_transfer_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN (
    'draft','sent','pending_approval','approved','rejected',
    'pending_receipt','partially_received','received',
    'needs_manager_review','cancelled','closed_by_stocktake'
  ) THEN
    RAISE EXCEPTION 'invalid_status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.legacy_doc_close_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type text NOT NULL,
  doc_id uuid NOT NULL,
  previous_status text,
  reason text NOT NULL,
  closed_by uuid,
  closed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.legacy_doc_close_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legacy_doc_close_audit_read ON public.legacy_doc_close_audit;
CREATE POLICY legacy_doc_close_audit_read ON public.legacy_doc_close_audit
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'general_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'executive_manager'::public.app_role)
  );

GRANT SELECT ON public.legacy_doc_close_audit TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_legacy_doc_by_stocktake(
  p_doc_type text,
  p_doc_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type text := btrim(COALESCE(p_doc_type, ''));
  v_reason text := btrim(COALESCE(p_reason, ''));
  v_status text;
  v_when timestamptz;
  v_wh uuid;
  v_transfer uuid;
  v_baseline timestamptz;
  v_no text;
BEGIN
  IF v_uid IS NULL
     OR NOT (
       public.has_role(v_uid, 'general_manager'::public.app_role)
       OR public.has_role(v_uid, 'executive_manager'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: إغلاق المستندات القديمة بالجرد للمدير العام أو المدير التنفيذي فقط';
  END IF;
  IF p_doc_id IS NULL THEN
    RAISE EXCEPTION 'DOC_REQUIRED';
  END IF;
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'REASON_REQUIRED: سبب الإغلاق مطلوب (٣ حروف على الأقل)';
  END IF;
  IF v_type NOT IN ('meat_manufacturing_invoice', 'warehouse_transfer') THEN
    RAISE EXCEPTION 'UNKNOWN_DOC_TYPE: %', v_type;
  END IF;

  IF v_type = 'meat_manufacturing_invoice' THEN
    SELECT status, COALESCE(approved_at, created_at), factory_warehouse_id, transfer_id, invoice_no
      INTO v_status, v_when, v_wh, v_transfer, v_no
      FROM public.meat_manufacturing_invoices
     WHERE id = p_doc_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND';
    END IF;
    IF v_status = 'closed_by_stocktake' THEN
      RETURN jsonb_build_object('status', 'already_closed', 'doc_type', v_type, 'doc_id', p_doc_id);
    END IF;
    IF v_status IS DISTINCT FROM 'approved' OR v_transfer IS NOT NULL THEN
      RAISE EXCEPTION 'NOT_ELIGIBLE: تُغلق فاتورة تصنيع معتمدة لم تُحوَّل فقط';
    END IF;
  ELSE
    SELECT status, COALESCE(sent_at, created_at), source_warehouse_id, transfer_no
      INTO v_status, v_when, v_wh, v_no
      FROM public.warehouse_transfers
     WHERE id = p_doc_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DOC_NOT_FOUND';
    END IF;
    IF v_status = 'closed_by_stocktake' THEN
      RETURN jsonb_build_object('status', 'already_closed', 'doc_type', v_type, 'doc_id', p_doc_id);
    END IF;
    IF v_status IS DISTINCT FROM 'pending_receipt' THEN
      RAISE EXCEPTION 'NOT_ELIGIBLE: يُغلق تحويل بحالة بانتظار الاستلام فقط';
    END IF;
  END IF;

  SELECT min(s.approved_at) INTO v_baseline
    FROM public.stocktaking_sessions s
   WHERE s.warehouse_id = v_wh
     AND s.status = 'approved'
     AND s.approved_at >= timestamptz '2026-09-30 00:00:00 Africa/Cairo';
  IF v_baseline IS NULL THEN
    RAISE EXCEPTION 'NO_STOCKTAKE_BASELINE: لا يوجد جرد معتمد في أو بعد 30 سبتمبر 2026 لهذا المخزن';
  END IF;
  IF v_when IS NULL OR v_when >= v_baseline THEN
    RAISE EXCEPTION 'AFTER_BASELINE: تاريخ المستند ليس قبل أساس جرد 30 سبتمبر 2026';
  END IF;

  IF v_type = 'meat_manufacturing_invoice' THEN
    UPDATE public.meat_manufacturing_invoices
       SET status = 'closed_by_stocktake',
           closed_by = v_uid,
           closed_at = now(),
           closed_reason = v_reason
     WHERE id = p_doc_id;
    INSERT INTO public.meat_factory_audit_log(table_name, row_id, action, old_value, new_value, performed_by)
    VALUES (
      'meat_manufacturing_invoices', p_doc_id, 'closed_by_stocktake',
      jsonb_build_object('status', v_status, 'invoice_no', v_no),
      jsonb_build_object('status', 'closed_by_stocktake', 'reason', v_reason),
      v_uid
    );
  ELSE
    UPDATE public.warehouse_transfers
       SET status = 'closed_by_stocktake',
           closed_by = v_uid,
           closed_at = now(),
           closed_reason = v_reason,
           audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'event', 'closed_by_stocktake', 'by', v_uid, 'at', now(), 'reason', v_reason
           ))
     WHERE id = p_doc_id;
  END IF;

  INSERT INTO public.legacy_doc_close_audit(doc_type, doc_id, previous_status, reason, closed_by)
  VALUES (v_type, p_doc_id, v_status, v_reason, v_uid);

  RETURN jsonb_build_object('status', 'closed', 'doc_type', v_type, 'doc_id', p_doc_id, 'doc_no', v_no);
END;
$$;

REVOKE ALL ON FUNCTION public.close_legacy_doc_by_stocktake(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_legacy_doc_by_stocktake(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_legacy_docs_by_stocktake(
  p_doc_type text,
  p_doc_ids uuid[],
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_doc_ids IS NULL OR cardinality(p_doc_ids) = 0 THEN
    RAISE EXCEPTION 'DOC_REQUIRED';
  END IF;
  IF cardinality(p_doc_ids) > 100 THEN
    RAISE EXCEPTION 'BULK_CAP: الحد 100 مستنداً في المرة الواحدة';
  END IF;
  FOREACH v_id IN ARRAY p_doc_ids LOOP
    v_out := v_out || jsonb_build_array(
      public.close_legacy_doc_by_stocktake(p_doc_type, v_id, p_reason)
    );
  END LOOP;
  RETURN jsonb_build_object('count', cardinality(p_doc_ids), 'results', v_out);
END;
$$;

REVOKE ALL ON FUNCTION public.close_legacy_docs_by_stocktake(text, uuid[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_legacy_docs_by_stocktake(text, uuid[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_untransferred_production()
RETURNS TABLE(
  bucket text,
  doc_id uuid,
  doc_no text,
  product_name text,
  qty numeric,
  status text,
  approved_at timestamptz,
  age_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT 'not_sent'::text, i.id, i.invoice_no, i.product_name, i.finished_qty, i.status, i.approved_at,
         EXTRACT(day FROM now() - COALESCE(i.approved_at, i.created_at))::integer
    FROM public.meat_manufacturing_invoices i
   WHERE i.status = 'approved'
     AND i.status IS DISTINCT FROM 'closed_by_stocktake'
     AND i.transfer_id IS NULL
  UNION ALL
  SELECT 'sent_not_received'::text, t.id, t.transfer_no, p.name_ar, t.quantity, t.status, t.created_at,
         EXTRACT(day FROM now() - t.created_at)::integer
    FROM public.meat_production_transfers t
    LEFT JOIN public.meat_factory_products p ON p.id = t.product_id
   WHERE t.status = 'pending'
     AND t.status IS DISTINCT FROM 'closed_by_stocktake'
  UNION ALL
  SELECT 'sent_not_received'::text, f.id, f.transfer_no, 'تحويل تام قديم', NULL, f.status, f.created_at,
         EXTRACT(day FROM now() - f.created_at)::integer
    FROM public.mf_transfers f
   WHERE f.status = 'awaiting_receipt'
     AND f.status IS DISTINCT FROM 'closed_by_stocktake'
  ORDER BY 7 NULLS LAST
$$;

DO $patch_transit$
DECLARE
  def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'inventory_reconciliation_check_core'
   ORDER BY p.oid DESC
   LIMIT 1;
  IF def IS NULL OR def NOT LIKE '%transfer_in_transit%' THEN
    RAISE EXCEPTION 'in-transit reconciliation core missing';
  END IF;
  IF def NOT LIKE '%closed_by_stocktake%' THEN
    def := replace(
      def,
      'WHERE t.status NOT IN (''received'', ''cancelled'')',
      'WHERE t.status NOT IN (''received'', ''cancelled'', ''closed_by_stocktake'')'
    );
  END IF;
  IF def NOT LIKE '%closed_by_stocktake%' THEN
    RAISE EXCEPTION 'failed to exclude closed_by_stocktake from transfer_in_transit';
  END IF;
  IF right(btrim(def), 1) <> ';' THEN
    def := def || ';';
  END IF;
  EXECUTE def;
END
$patch_transit$;
