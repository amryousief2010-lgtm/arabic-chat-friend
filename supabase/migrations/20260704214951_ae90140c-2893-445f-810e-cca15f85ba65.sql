
CREATE TABLE IF NOT EXISTS public.order_mega_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reported_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  discrepancy_type text NOT NULL CHECK (discrepancy_type IN ('products','amount','both')),
  reporter_note text,
  mega_products_text text,
  mega_amount numeric,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','rejected')),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_omd_status ON public.order_mega_discrepancies(status);
CREATE INDEX IF NOT EXISTS idx_omd_order ON public.order_mega_discrepancies(order_id);
CREATE INDEX IF NOT EXISTS idx_omd_created ON public.order_mega_discrepancies(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_mega_discrepancies TO authenticated;
GRANT ALL ON public.order_mega_discrepancies TO service_role;

ALTER TABLE public.order_mega_discrepancies ENABLE ROW LEVEL SECURITY;

-- Reporter can insert for themselves
CREATE POLICY "auth insert own discrepancy"
ON public.order_mega_discrepancies
FOR INSERT TO authenticated
WITH CHECK (reported_by = auth.uid());

-- Reporter can see own; Alaa + GM/Exec see all
CREATE POLICY "select own or manager discrepancies"
ON public.order_mega_discrepancies
FOR SELECT TO authenticated
USING (
  reported_by = auth.uid()
  OR auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid
  OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role])
);

-- Alaa + GM/Exec can update (resolve/reject)
CREATE POLICY "managers update discrepancies"
ON public.order_mega_discrepancies
FOR UPDATE TO authenticated
USING (
  auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid
  OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role])
)
WITH CHECK (
  auth.uid() = '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid
  OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role])
);

-- GM only can delete
CREATE POLICY "gm delete discrepancies"
ON public.order_mega_discrepancies
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'general_manager'::app_role));

-- updated_at trigger
CREATE TRIGGER trg_omd_touch
BEFORE UPDATE ON public.order_mega_discrepancies
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-notify Alaa on new report
CREATE OR REPLACE FUNCTION public.notify_alaa_mega_discrepancy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_no text;
  v_customer text;
  v_type_ar text;
BEGIN
  SELECT order_number, customer_name INTO v_order_no, v_customer
  FROM orders WHERE id = NEW.order_id;

  v_type_ar := CASE NEW.discrepancy_type
    WHEN 'products' THEN 'اختلاف فى المنتجات'
    WHEN 'amount'   THEN 'اختلاف فى المبلغ'
    ELSE 'اختلاف فى المنتجات والمبلغ'
  END;

  INSERT INTO notifications (title, description, type, target_user_id)
  VALUES (
    'مراجعة أوردر ميجا: ' || v_type_ar,
    'أوردر ' || COALESCE(v_order_no,'—') || ' • العميل: ' || COALESCE(v_customer,'—')
      || COALESCE(E'\n' || NEW.reporter_note, ''),
    'mega_order_discrepancy',
    '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'::uuid
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_alaa_mega_discrepancy
AFTER INSERT ON public.order_mega_discrepancies
FOR EACH ROW EXECUTE FUNCTION public.notify_alaa_mega_discrepancy();
