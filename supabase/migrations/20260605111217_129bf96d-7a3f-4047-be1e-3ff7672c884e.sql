
-- 1) movements first (they reference items)
DELETE FROM public.inventory_movements WHERE reference LIKE 'استلام من دفعة ذبح TEST-SLAUGHTER-TRANSFER-%';
-- 2) outputs reference inventory_items via received_inventory_item_id — clear them before deleting items
DELETE FROM public.slaughter_branch_transfers WHERE batch_id IN (SELECT id FROM public.slaughter_batches WHERE batch_number LIKE 'TEST-SLAUGHTER-TRANSFER-%');
DELETE FROM public.slaughter_audit_log WHERE batch_id IN (SELECT id FROM public.slaughter_batches WHERE batch_number LIKE 'TEST-SLAUGHTER-TRANSFER-%');
DELETE FROM public.slaughter_batch_outputs WHERE batch_id IN (SELECT id FROM public.slaughter_batches WHERE batch_number LIKE 'TEST-SLAUGHTER-TRANSFER-%');
DELETE FROM public.slaughter_batches WHERE batch_number LIKE 'TEST-SLAUGHTER-TRANSFER-%';
DELETE FROM public.slaughter_live_receipts WHERE receipt_number LIKE 'TEST-RCPT-%';
-- 3) now items safe
DELETE FROM public.inventory_items WHERE name IN ('TEST-موزة','TEST-فيليه','TEST-استيك');
