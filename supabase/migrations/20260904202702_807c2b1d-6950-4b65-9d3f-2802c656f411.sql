CREATE TABLE public.order_offer_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  offer_box_id uuid REFERENCES public.offer_boxes(id) ON DELETE SET NULL,
  offer_name text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, offer_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_offer_instances TO authenticated;
GRANT ALL ON public.order_offer_instances TO service_role;

ALTER TABLE public.order_offer_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "order_offer_instances_select"
ON public.order_offer_instances
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
  )
);

CREATE POLICY "order_offer_instances_insert"
ON public.order_offer_instances
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND (
    created_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY[
      'general_manager'::public.app_role,
      'executive_manager'::public.app_role,
      'sales_manager'::public.app_role
    ])
  )
  AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
      AND (
        o.created_by = auth.uid()
        OR public.has_any_role(auth.uid(), ARRAY[
          'general_manager'::public.app_role,
          'executive_manager'::public.app_role,
          'sales_manager'::public.app_role
        ])
      )
  )
);

CREATE POLICY "order_offer_instances_update"
ON public.order_offer_instances
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
      AND (
        o.created_by = auth.uid()
        OR public.has_any_role(auth.uid(), ARRAY[
          'general_manager'::public.app_role,
          'executive_manager'::public.app_role,
          'sales_manager'::public.app_role
        ])
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.id = order_offer_instances.order_id
      AND (
        o.created_by = auth.uid()
        OR public.has_any_role(auth.uid(), ARRAY[
          'general_manager'::public.app_role,
          'executive_manager'::public.app_role,
          'sales_manager'::public.app_role
        ])
      )
  )
);

CREATE POLICY "order_offer_instances_delete"
ON public.order_offer_instances
FOR DELETE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::public.app_role,
    'executive_manager'::public.app_role,
    'sales_manager'::public.app_role
  ])
);

CREATE OR REPLACE FUNCTION public.set_order_offer_instances_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_offer_instances_updated_at
BEFORE UPDATE ON public.order_offer_instances
FOR EACH ROW
EXECUTE FUNCTION public.set_order_offer_instances_updated_at();

CREATE INDEX idx_order_offer_instances_order_id
ON public.order_offer_instances(order_id);