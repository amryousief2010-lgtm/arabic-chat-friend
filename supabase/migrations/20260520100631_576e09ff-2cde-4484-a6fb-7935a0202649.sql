-- 1) Audit log table
CREATE TABLE IF NOT EXISTS public.order_status_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  order_number text,
  field_name text NOT NULL, -- 'payment_status' or 'collection_status'
  old_value text,
  new_value text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_status_audit_order ON public.order_status_audit(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_audit_changed_at ON public.order_status_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_status_audit_field ON public.order_status_audit(field_name);

ALTER TABLE public.order_status_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Managers and accountants view audit"
  ON public.order_status_audit FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,
    'accountant'::app_role,'financial_manager'::app_role,'marketing_sales_manager'::app_role
  ]));

CREATE POLICY "System can insert audit"
  ON public.order_status_audit FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 2) Trigger to log payment/collection status changes
CREATE OR REPLACE FUNCTION public.log_order_status_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  SELECT COALESCE(full_name, email) INTO v_name FROM public.profiles WHERE id = auth.uid();
  
  IF COALESCE(OLD.payment_status,'') <> COALESCE(NEW.payment_status,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'payment_status', OLD.payment_status, NEW.payment_status, auth.uid(), v_name);
  END IF;
  
  IF COALESCE(OLD.collection_status,'') <> COALESCE(NEW.collection_status,'') THEN
    INSERT INTO public.order_status_audit (order_id, order_number, field_name, old_value, new_value, changed_by, changed_by_name)
    VALUES (NEW.id, NEW.order_number, 'collection_status', OLD.collection_status, NEW.collection_status, auth.uid(), v_name);
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_order_status_audit ON public.orders;
CREATE TRIGGER trg_log_order_status_audit
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.log_order_status_audit();

-- 3) Targeted in-app notifications
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS target_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_target_user ON public.notifications(target_user_id) WHERE target_user_id IS NOT NULL;

-- Allow target user to view + mark as read their own messages
CREATE POLICY "Users view their targeted notifications"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (target_user_id = auth.uid());

CREATE POLICY "Users update their targeted notifications"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (target_user_id = auth.uid());

-- Allow managers/accountants to send notifications (extend existing INSERT scope)
CREATE POLICY "Managers can send targeted notifications"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,'executive_manager'::app_role,'sales_manager'::app_role,
    'accountant'::app_role,'financial_manager'::app_role
  ]));