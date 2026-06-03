
-- 1) brooding_chick_sales: add age snapshot fields
ALTER TABLE public.brooding_chick_sales
  ADD COLUMN IF NOT EXISTS age_at_sale_days INTEGER,
  ADD COLUMN IF NOT EXISTS age_label_snapshot TEXT;

-- 2) brooding_mortality: reason becomes mandatory
UPDATE public.brooding_mortality SET reason = COALESCE(NULLIF(TRIM(reason), ''), 'غير محدد (سجل قديم)')
WHERE reason IS NULL OR TRIM(reason) = '';

ALTER TABLE public.brooding_mortality
  ALTER COLUMN reason SET NOT NULL;

-- Validation trigger (length >= 3 chars after trim)
CREATE OR REPLACE FUNCTION public.validate_mortality_reason()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reason IS NULL OR LENGTH(TRIM(NEW.reason)) < 3 THEN
    RAISE EXCEPTION 'يجب كتابة سبب النافق (3 أحرف على الأقل)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_validate_mortality_reason ON public.brooding_mortality;
CREATE TRIGGER trg_validate_mortality_reason
  BEFORE INSERT OR UPDATE ON public.brooding_mortality
  FOR EACH ROW EXECUTE FUNCTION public.validate_mortality_reason();

-- 3) brooding_to_slaughter_transfers: live weight pricing
ALTER TABLE public.brooding_to_slaughter_transfers
  ADD COLUMN IF NOT EXISTS live_price_per_kg NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valuation_amount NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_profit_loss NUMERIC NOT NULL DEFAULT 0;

-- 4) Feed issuance → notify feed_factory_manager(s)
CREATE OR REPLACE FUNCTION public.notify_feed_factory_on_brooding_issue()
RETURNS TRIGGER AS $$
DECLARE
  v_batch_number TEXT;
  v_user_id UUID;
BEGIN
  SELECT batch_number INTO v_batch_number FROM public.brooding_batches WHERE id = NEW.batch_id;

  FOR v_user_id IN
    SELECT user_id FROM public.user_roles
    WHERE role IN ('feed_factory_manager','general_manager','executive_manager','production_manager')
  LOOP
    INSERT INTO public.notifications (title, description, type, target_user_id)
    VALUES (
      'صرف علف من مخزون الكتاكيت',
      'تم صرف ' || NEW.quantity_kg || ' كجم من ' || NEW.feed_name ||
      ' لدفعة ' || COALESCE(v_batch_number, '?') ||
      ' بسعر تكلفة ' || NEW.unit_cost || ' ج/كجم. الإجمالي: ' || NEW.total_cost || ' ج. برجاء المراجعة.',
      'feed_issuance',
      v_user_id
    );
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_notify_feed_factory_on_brooding_issue ON public.brooding_feed_issuance;
CREATE TRIGGER trg_notify_feed_factory_on_brooding_issue
  AFTER INSERT ON public.brooding_feed_issuance
  FOR EACH ROW EXECUTE FUNCTION public.notify_feed_factory_on_brooding_issue();
