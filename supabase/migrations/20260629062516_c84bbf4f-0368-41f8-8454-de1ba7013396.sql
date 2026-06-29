
-- Tighten warehouse transfer permission functions and resolve abdelmonem role conflict

-- 1) Remove agouza_warehouse_keeper from abdelmonem (he is the Main warehouse supervisor)
DELETE FROM public.user_roles
WHERE user_id = '0ceaed94-a666-4af7-a68c-43288ab8f738'
  AND role = 'agouza_warehouse_keeper'::app_role;

-- 2) Tighten can_receive_warehouse_transfer to use explicit warehouse IDs
CREATE OR REPLACE FUNCTION public.can_receive_warehouse_transfer(_uid uuid, _destination_warehouse_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_uid, 'general_manager'::app_role)
    OR public.has_role(_uid, 'executive_manager'::app_role)
    OR (
      public.has_role(_uid, 'agouza_warehouse_keeper'::app_role)
      AND _destination_warehouse_id = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
    )
    OR (
      public.has_role(_uid, 'warehouse_supervisor'::app_role)
      AND _destination_warehouse_id = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
    );
$function$;

-- 3) Tighten can_request_warehouse_transfer with the same explicit-id model.
--    Requester must own at least one endpoint (src OR dest) of the transfer.
CREATE OR REPLACE FUNCTION public.can_request_warehouse_transfer(_uid uuid, _src uuid, _dest uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    public.has_role(_uid, 'general_manager'::app_role)
    OR public.has_role(_uid, 'executive_manager'::app_role)
    OR (
      public.has_role(_uid, 'agouza_warehouse_keeper'::app_role)
      AND (
        _src  = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
        OR _dest = 'a970d469-37df-40e1-b99f-a49195a3778e'::uuid
      )
    )
    OR (
      public.has_role(_uid, 'warehouse_supervisor'::app_role)
      AND (
        _src  = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
        OR _dest = '5ec781b5-685b-4806-b59a-83a79ea5662c'::uuid
      )
    );
$function$;
