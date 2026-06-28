
ALTER TABLE public.feed_production_invoices
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS was_flagged_for_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reasons jsonb;

CREATE OR REPLACE FUNCTION public.approve_feed_production_invoice(
  p_invoice_id uuid,
  p_review_note text DEFAULT NULL,
  p_was_flagged boolean DEFAULT false,
  p_flag_reasons jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- delegate financial/inventory effects to the existing single-arg function
  PERFORM public.approve_feed_production_invoice(p_invoice_id);

  UPDATE public.feed_production_invoices
  SET review_note = COALESCE(p_review_note, review_note),
      was_flagged_for_review = COALESCE(p_was_flagged, was_flagged_for_review),
      flag_reasons = COALESCE(p_flag_reasons, flag_reasons)
  WHERE id = p_invoice_id;
END;
$$;
