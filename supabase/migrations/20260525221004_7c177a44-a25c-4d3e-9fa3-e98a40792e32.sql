
CREATE TABLE public.order_edit_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decided_by UUID,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_order_edit_requests_order ON public.order_edit_requests(order_id);
CREATE INDEX idx_order_edit_requests_requester ON public.order_edit_requests(requested_by);
CREATE INDEX idx_order_edit_requests_status ON public.order_edit_requests(status);

ALTER TABLE public.order_edit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Private rep can create their own edit requests"
ON public.order_edit_requests FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND requested_by = auth.uid()
);

CREATE POLICY "Private rep can view their own edit requests"
ON public.order_edit_requests FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND requested_by = auth.uid()
);

CREATE POLICY "Managers can view all edit requests"
ON public.order_edit_requests FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
);

CREATE POLICY "Managers can update edit requests"
ON public.order_edit_requests FOR UPDATE TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
);

CREATE TRIGGER trg_order_edit_requests_updated_at
BEFORE UPDATE ON public.order_edit_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.order_edit_requests;

-- Allow private delivery rep to send a targeted notification (edit request alert)
CREATE POLICY "Private rep can send edit-request notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND type = 'edit_request'
  AND target_user_id IS NOT NULL
);

-- Let private delivery rep view notifications targeted to them (for completeness)
CREATE POLICY "Private rep can view own targeted notifications"
ON public.notifications FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'private_delivery_rep'::app_role)
  AND target_user_id = auth.uid()
);
