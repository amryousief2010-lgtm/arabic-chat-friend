-- Phase 5(B1): revoke anonymous/PUBLIC access from inventory components only.
-- No changes to authenticated / service_role / owner. No RLS, data, or function-body changes.

REVOKE ALL PRIVILEGES ON TABLE public.inventory_items            FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.inventory_movements        FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.warehouses                 FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.warehouse_sublocations     FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.inventory_sublocation_items FROM anon, PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE public.product_cost_history       FROM anon, PUBLIC;

REVOKE ALL PRIVILEGES ON TABLE public.v_inventory_balances       FROM anon, PUBLIC;

REVOKE ALL PRIVILEGES ON SEQUENCE public.inv_movement_seq        FROM anon, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.can_post_inventory(uuid)                FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_approve_inventory_override(uuid)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_can_consume(uuid, numeric)          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_post_movement(uuid, uuid, text, numeric, numeric, text, text, text, text, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.inv_transfer(uuid, uuid, numeric, text) FROM anon, PUBLIC;