
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS deposit_receipt_url text,
  ADD COLUMN IF NOT EXISTS deposit_receipt_name text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('order-deposit-receipts', 'order-deposit-receipts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "deposit_receipts_upload_own" ON storage.objects;
CREATE POLICY "deposit_receipts_upload_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'order-deposit-receipts'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "deposit_receipts_view_own_or_mgr" ON storage.objects;
CREATE POLICY "deposit_receipts_view_own_or_mgr"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'order-deposit-receipts'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
    OR public.has_role(auth.uid(), 'sales_manager')
    OR public.has_role(auth.uid(), 'accountant')
    OR public.has_role(auth.uid(), 'warehouse_supervisor')
  )
);

DROP POLICY IF EXISTS "deposit_receipts_delete_mgr" ON storage.objects;
CREATE POLICY "deposit_receipts_delete_mgr"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'order-deposit-receipts'
  AND (
    public.has_role(auth.uid(), 'general_manager')
    OR public.has_role(auth.uid(), 'executive_manager')
  )
);
