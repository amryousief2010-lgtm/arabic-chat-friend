-- منتجات وزنها ثابت (قطعة كاملة لا تُجزَّأ ولا تُزاد): أول استخدام «دبوس بالعظم» = 6 كجم.
--  • products.fixed_weight_kg: NULL = منتج عادي، وإلا فكمية أي سطر طلب = عدد صحيح × هذا الوزن.
--  • تريجر على order_items يمنع إدخال/تعديل كمية ليست من مضاعفاته (أياً كان مصدر الإدخال: واجهة، RPC، موقع).
--  • الصفوف القديمة لا تُمَس؛ يُفحص فقط الإدخال الجديد أو تعديل الكمية/المنتج.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fixed_weight_kg numeric(10,3);

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_fixed_weight_kg_positive;
ALTER TABLE public.products
  ADD CONSTRAINT products_fixed_weight_kg_positive CHECK (fixed_weight_kg IS NULL OR fixed_weight_kg > 0);

COMMENT ON COLUMN public.products.fixed_weight_kg IS
  'وزن القطعة الثابت بالكجم (NULL = منتج عادي). كمية سطر الطلب لازم تكون مضاعفاً صحيحاً له.';

-- القراءة على أعمدة products ممنوحة عمودياً: نمنح الجديد للمستخدمين المسجَّلين فقط.
REVOKE ALL (fixed_weight_kg) ON public.products FROM anon;
GRANT SELECT (fixed_weight_kg) ON public.products TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_fixed_weight_qty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fixed  numeric;
  v_name   text;
  v_pieces numeric;
BEGIN
  IF NEW.product_id IS NULL OR coalesce(NEW.quantity, 0) <= 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.product_id IS NOT DISTINCT FROM OLD.product_id
     AND NEW.quantity   IS NOT DISTINCT FROM OLD.quantity
     AND NEW.is_half_kg IS NOT DISTINCT FROM OLD.is_half_kg THEN
    RETURN NEW;
  END IF;

  SELECT fixed_weight_kg, name INTO v_fixed, v_name FROM public.products WHERE id = NEW.product_id;
  IF v_fixed IS NULL THEN
    RETURN NEW;
  END IF;

  v_pieces := NEW.quantity / v_fixed;
  IF NEW.is_half_kg OR abs(v_pieces - round(v_pieces)) > 0.000001 OR round(v_pieces) < 1 THEN
    RAISE EXCEPTION 'FIXED_WEIGHT_QTY: المنتج % قطعة كاملة وزنها ثابت % كجم ولا تُجزَّأ ولا تُزاد (الكمية المطلوبة % كجم)',
      v_name, trim_scale(v_fixed), NEW.quantity
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_fixed_weight_qty() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_fixed_weight_qty ON public.order_items;
CREATE TRIGGER trg_enforce_fixed_weight_qty
  BEFORE INSERT OR UPDATE OF product_id, quantity, is_half_kg ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fixed_weight_qty();

-- أول منتج: دبوس بالعظم = 6 كجم (id ثابت في الإنتاج؛ لا أثر لو غير موجود).
UPDATE public.products
   SET fixed_weight_kg = 6
 WHERE id = '405ece91-0ad3-4b51-afb0-da90dc69cbbe'
   AND fixed_weight_kg IS DISTINCT FROM 6;
