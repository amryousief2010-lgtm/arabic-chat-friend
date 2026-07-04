-- Restrict Agouza warehouse keeper from directly modifying stock quantities.
-- He can still VIEW inventory and use the Bostta delivery upload flow
-- (which runs through the edge function with service_role).

DROP POLICY IF EXISTS "Warehouse managers manage inventory items" ON public.inventory_items;

-- Full CRUD only for GM / Exec / warehouse_supervisor
CREATE POLICY "Warehouse admins manage inventory items"
ON public.inventory_items
FOR ALL
TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
)
WITH CHECK (
  has_any_role(auth.uid(), ARRAY['general_manager'::app_role, 'executive_manager'::app_role, 'warehouse_supervisor'::app_role])
);
