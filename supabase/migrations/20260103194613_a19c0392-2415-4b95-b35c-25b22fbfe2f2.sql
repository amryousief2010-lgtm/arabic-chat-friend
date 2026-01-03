-- Create sales_targets table
CREATE TABLE public.sales_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  target_amount NUMERIC NOT NULL DEFAULT 0,
  achieved_amount NUMERIC NOT NULL DEFAULT 0,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, month, year)
);

-- Enable RLS
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

-- RLS policies with correct type casting
CREATE POLICY "Users can view their own targets" 
ON public.sales_targets FOR SELECT 
USING (auth.uid() = user_id OR has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can create targets" 
ON public.sales_targets FOR INSERT 
WITH CHECK (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can update targets" 
ON public.sales_targets FOR UPDATE 
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

CREATE POLICY "Managers can delete targets" 
ON public.sales_targets FOR DELETE 
USING (has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role]));

-- Create trigger for updated_at
CREATE TRIGGER update_sales_targets_updated_at
BEFORE UPDATE ON public.sales_targets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();