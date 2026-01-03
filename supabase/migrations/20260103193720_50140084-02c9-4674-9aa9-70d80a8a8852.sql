-- Create team_assignments table to link sales moderators to sales managers
CREATE TABLE public.team_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  manager_id uuid NOT NULL,
  moderator_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (moderator_id)
);

-- Enable RLS
ALTER TABLE public.team_assignments ENABLE ROW LEVEL SECURITY;

-- Sales managers can view their team assignments
CREATE POLICY "Sales managers can view their team" 
ON public.team_assignments 
FOR SELECT 
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'sales_manager'::app_role])
);

-- General manager can manage all team assignments
CREATE POLICY "General manager can manage team assignments" 
ON public.team_assignments 
FOR ALL 
USING (has_role(auth.uid(), 'general_manager'::app_role));

-- Sales managers can assign moderators to themselves
CREATE POLICY "Sales managers can assign moderators" 
ON public.team_assignments 
FOR INSERT 
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'sales_manager'::app_role]) 
  AND (manager_id = auth.uid() OR has_role(auth.uid(), 'general_manager'::app_role))
);

-- Sales managers can remove moderators from their team
CREATE POLICY "Sales managers can remove from their team" 
ON public.team_assignments 
FOR DELETE 
USING (
  manager_id = auth.uid() OR has_role(auth.uid(), 'general_manager'::app_role)
);