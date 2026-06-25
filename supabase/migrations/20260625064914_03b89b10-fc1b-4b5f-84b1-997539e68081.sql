
ALTER TABLE public.courier_goods_custody_lines
  ADD COLUMN IF NOT EXISTS original_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_pct NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS discount_reason TEXT,
  ADD COLUMN IF NOT EXISTS discount_status TEXT CHECK (discount_status IN ('none','auto_approved','pending','approved','rejected')) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS discount_approved_by UUID,
  ADD COLUMN IF NOT EXISTS discount_approved_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.courier_custody_settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  auto_approve_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

INSERT INTO public.courier_custody_settings (id, auto_approve_discount_pct)
VALUES (1, 5) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.courier_custody_settings TO authenticated;
GRANT ALL ON public.courier_custody_settings TO service_role;
ALTER TABLE public.courier_custody_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ccs_select" ON public.courier_custody_settings;
CREATE POLICY "ccs_select" ON public.courier_custody_settings FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "ccs_update" ON public.courier_custody_settings;
CREATE POLICY "ccs_update" ON public.courier_custody_settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'))
  WITH CHECK (public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager'));

CREATE OR REPLACE FUNCTION public.approve_courier_discount(_line_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح: يلزم اعتماد المدير العام أو التنفيذي';
  END IF;
  UPDATE public.courier_goods_custody_lines
    SET discount_status='approved', discount_approved_by=_uid, discount_approved_at=now()
    WHERE id=_line_id AND discount_status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد خصم بانتظار الاعتماد بهذا المعرّف'; END IF;
  RETURN _line_id;
END;$$;

CREATE OR REPLACE FUNCTION public.reject_courier_discount(_line_id UUID, _reason TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
BEGIN
  IF NOT (public.has_role(_uid,'general_manager') OR public.has_role(_uid,'executive_manager')) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.courier_goods_custody_lines
    SET discount_status='rejected', discount_approved_by=_uid, discount_approved_at=now(),
        notes = COALESCE(notes,'') || ' | رفض الخصم: ' || COALESCE(_reason,'')
    WHERE id=_line_id AND discount_status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد خصم بانتظار الاعتماد'; END IF;
  RETURN _line_id;
END;$$;

GRANT EXECUTE ON FUNCTION public.approve_courier_discount(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_courier_discount(UUID, TEXT) TO authenticated;
