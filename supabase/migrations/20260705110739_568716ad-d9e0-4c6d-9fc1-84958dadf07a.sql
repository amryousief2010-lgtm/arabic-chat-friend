
-- Fix: when an APPROVED feed production invoice is deleted, cascade-deletes on
-- feed_production_invoice_items fire AFTER the parent row is gone, so the existing
-- revert trigger sees status = NULL and skips the stock restore.
-- Add a BEFORE DELETE trigger on the parent that restores stock first.

CREATE OR REPLACE FUNCTION public.revert_feed_production_invoice_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
BEGIN
  IF OLD.status = 'approved' THEN
    FOR r IN
      SELECT raw_material_id, quantity
      FROM feed_production_invoice_items
      WHERE invoice_id = OLD.id
    LOOP
      UPDATE feed_raw_materials
         SET stock = stock + r.quantity,
             updated_at = now()
       WHERE id = r.raw_material_id;
    END LOOP;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_revert_feed_invoice_on_delete ON public.feed_production_invoices;
CREATE TRIGGER trg_revert_feed_invoice_on_delete
BEFORE DELETE ON public.feed_production_invoices
FOR EACH ROW EXECUTE FUNCTION public.revert_feed_production_invoice_on_delete();

-- Neutralize the per-item revert during a cascading parent delete so we don't
-- accidentally restore stock twice. If the parent invoice no longer exists at
-- the time the child row is deleted, skip.
CREATE OR REPLACE FUNCTION public.revert_feed_production_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
  v_exists boolean;
BEGIN
  SELECT status, true INTO v_status, v_exists
    FROM feed_production_invoices WHERE id = OLD.invoice_id;
  IF NOT COALESCE(v_exists, false) THEN
    -- Parent already deleted (cascade). BEFORE DELETE trigger on parent handled the revert.
    RETURN OLD;
  END IF;
  IF v_status = 'approved' THEN
    UPDATE feed_raw_materials
       SET stock = stock + OLD.quantity, updated_at = now()
     WHERE id = OLD.raw_material_id;
  END IF;
  RETURN OLD;
END;
$$;
