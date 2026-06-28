DELETE FROM public.courier_goods_custody_lines
WHERE order_id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae'
   OR inventory_movement_id IN (SELECT id FROM public.inventory_movements WHERE reference='DIST-qa-test-20260628-003');

DELETE FROM public.courier_order_assignments
WHERE order_id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae';

DELETE FROM public.pc_order_tracking
WHERE order_id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae';

DELETE FROM public.pc_collections
WHERE order_id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae';

DELETE FROM public.pc_failed_attempts
WHERE order_id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae';

DELETE FROM public.inventory_movements
WHERE reference = 'DIST-qa-test-20260628-003';

UPDATE public.orders
   SET status = 'pending',
       stock_status = 'not_dispatched',
       delivered_at = NULL,
       delivered_by = NULL,
       collected_at = NULL,
       collected_by = NULL,
       total_at_delivery = NULL,
       updated_at = now()
 WHERE id = 'dce993f1-aa8e-40e8-a7e3-67c70b298aae';