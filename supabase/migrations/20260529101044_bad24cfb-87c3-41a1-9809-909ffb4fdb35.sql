
-- Chick orders table
CREATE TYPE public.chick_order_status AS ENUM ('pending', 'delivered', 'returned', 'cancelled');

CREATE TABLE public.chick_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone_primary TEXT NOT NULL,
  phone_secondary TEXT,
  governorate TEXT NOT NULL,
  city TEXT NOT NULL,
  chick_age TEXT NOT NULL,
  chick_price NUMERIC NOT NULL CHECK (chick_price >= 0),
  chick_count INTEGER NOT NULL CHECK (chick_count > 0),
  total_amount NUMERIC GENERATED ALWAYS AS (chick_price * chick_count) STORED,
  status public.chick_order_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chick_orders_created_by ON public.chick_orders(created_by);
CREATE INDEX idx_chick_orders_created_at ON public.chick_orders(created_at DESC);
CREATE INDEX idx_chick_orders_status ON public.chick_orders(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.chick_orders TO authenticated;
GRANT ALL ON public.chick_orders TO service_role;

ALTER TABLE public.chick_orders ENABLE ROW LEVEL SECURITY;

-- Helper: who can manage (managers + general)
CREATE OR REPLACE FUNCTION public.can_manage_chick_orders(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('general_manager','executive_manager','sales_manager','marketing_sales_manager')
  );
$$;

-- SELECT: managers see all, moderators see only their own
CREATE POLICY "view chick orders"
ON public.chick_orders FOR SELECT TO authenticated
USING (
  public.can_manage_chick_orders(auth.uid())
  OR created_by = auth.uid()
);

-- INSERT: managers + sales_moderator
CREATE POLICY "create chick orders"
ON public.chick_orders FOR INSERT TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.can_manage_chick_orders(auth.uid())
    OR public.has_role(auth.uid(), 'sales_moderator')
  )
);

-- UPDATE: managers any; moderators only their own rows
CREATE POLICY "update chick orders"
ON public.chick_orders FOR UPDATE TO authenticated
USING (
  public.can_manage_chick_orders(auth.uid())
  OR created_by = auth.uid()
)
WITH CHECK (
  public.can_manage_chick_orders(auth.uid())
  OR created_by = auth.uid()
);

-- DELETE: managers only
CREATE POLICY "delete chick orders"
ON public.chick_orders FOR DELETE TO authenticated
USING (public.can_manage_chick_orders(auth.uid()));

-- Trigger: prevent moderators from changing status
CREATE OR REPLACE FUNCTION public.chick_orders_guard_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT public.can_manage_chick_orders(auth.uid()) THEN
    RAISE EXCEPTION 'غير مسموح لكِ بتغيير حالة الطلب. تواصلي مع مديرة المبيعات.'
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_chick_orders_guard_status
BEFORE UPDATE ON public.chick_orders
FOR EACH ROW EXECUTE FUNCTION public.chick_orders_guard_status();
