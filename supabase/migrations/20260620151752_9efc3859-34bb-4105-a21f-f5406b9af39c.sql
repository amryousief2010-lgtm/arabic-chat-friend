
ALTER TABLE public.farm_to_hatchery_shipments
  ADD COLUMN IF NOT EXISTS farm_transfer_id uuid
  REFERENCES public.farm_transfers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_fth_farm_transfer ON public.farm_to_hatchery_shipments(farm_transfer_id);

-- Block deleting a farm_transfer if its linked shipment is already received/partial/rejected or linked to a hatch batch.
CREATE OR REPLACE FUNCTION public.prevent_delete_used_farm_transfer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_blocking int;
BEGIN
  SELECT COUNT(*) INTO v_blocking
  FROM public.farm_to_hatchery_shipments s
  WHERE s.farm_transfer_id = OLD.id
    AND (s.status <> 'pending' OR s.hatch_batch_id IS NOT NULL);

  IF v_blocking > 0 THEN
    RAISE EXCEPTION 'لا يمكن إلغاء عملية النقل لأنها مرتبطة بشحنة تم استلامها أو ربطها بدفعة تفريخ. استخدم تسوية إدارية بدل الحذف.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_delete_used_farm_transfer ON public.farm_transfers;
CREATE TRIGGER trg_prevent_delete_used_farm_transfer
BEFORE DELETE ON public.farm_transfers
FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_used_farm_transfer();
