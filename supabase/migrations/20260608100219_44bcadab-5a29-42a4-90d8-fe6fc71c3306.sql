
CREATE OR REPLACE FUNCTION public.lab_treasury_block_duplicate_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_allow boolean := false;
BEGIN
  -- Skip reversal entries created by the duplicates cleanup tool
  IF NEW.description IS NOT NULL AND NEW.description LIKE 'إلغاء أثر%' THEN
    RETURN NEW;
  END IF;

  -- Explicit user override
  IF NEW.description IS NOT NULL AND NEW.description ILIKE '%تكرار مسموح%' THEN
    RETURN NEW;
  END IF;
  IF NEW.extra IS NOT NULL AND (NEW.extra->>'allow_duplicate')::boolean IS TRUE THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_existing_id
  FROM public.lab_treasury_movements
  WHERE status <> 'rejected'
    AND movement_type = NEW.movement_type
    AND payment_method = NEW.payment_method
    AND amount = NEW.amount
    AND movement_date = NEW.movement_date
    AND COALESCE(income_category::text,'') = COALESCE(NEW.income_category::text,'')
    AND COALESCE(expense_category::text,'') = COALESCE(NEW.expense_category::text,'')
    AND created_at >= now() - interval '24 hours'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RAISE EXCEPTION 'حركة مكررة: يوجد بالفعل حركة بنفس النوع والمبلغ (% ج) وطريقة الدفع والفئة بتاريخ % خلال آخر 24 ساعة (المعرف: %). لو الإدخال مقصود أضف عبارة "تكرار مسموح" في الوصف.', NEW.amount, NEW.movement_date, v_existing_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lab_treasury_block_duplicate ON public.lab_treasury_movements;
CREATE TRIGGER trg_lab_treasury_block_duplicate
BEFORE INSERT ON public.lab_treasury_movements
FOR EACH ROW EXECUTE FUNCTION public.lab_treasury_block_duplicate_movement();
