-- Create offer boxes table
CREATE TABLE public.offer_boxes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create offer box items table
CREATE TABLE public.offer_box_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_box_id UUID NOT NULL REFERENCES public.offer_boxes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  custom_price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.offer_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_box_items ENABLE ROW LEVEL SECURITY;

-- Offer boxes policies - managers can manage
CREATE POLICY "Authenticated users can view offer boxes"
ON public.offer_boxes FOR SELECT
USING (true);

CREATE POLICY "Managers can create offer boxes"
ON public.offer_boxes FOR INSERT
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can update offer boxes"
ON public.offer_boxes FOR UPDATE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can delete offer boxes"
ON public.offer_boxes FOR DELETE
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

-- Offer box items policies
CREATE POLICY "Authenticated users can view offer box items"
ON public.offer_box_items FOR SELECT
USING (true);

CREATE POLICY "Managers can manage offer box items"
ON public.offer_box_items FOR ALL
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

-- Create function to check if user can edit product prices
CREATE OR REPLACE FUNCTION public.can_edit_product_price(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('general_manager', 'executive_manager', 'accountant')
  )
$$;

-- Create function to check if user can add products
CREATE OR REPLACE FUNCTION public.can_add_products(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('general_manager', 'executive_manager', 'sales_manager', 'warehouse_supervisor')
  )
$$;

-- Add triggers for updated_at
CREATE TRIGGER update_offer_boxes_updated_at
BEFORE UPDATE ON public.offer_boxes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();