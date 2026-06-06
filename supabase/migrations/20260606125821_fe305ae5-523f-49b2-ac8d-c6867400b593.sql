
ALTER TABLE public.lab_treasury_movements DISABLE TRIGGER trg_lab_treasury_guard;

UPDATE public.lab_treasury_movements
   SET status='pending', approved_by=NULL, approved_at=NULL, updated_at=now()
 WHERE id='ceaf2d71-6d2a-4eb3-81d2-6e72d6bc96f4';

DELETE FROM public.lab_treasury_movements
 WHERE id='24c73f48-5560-48c2-860f-9fc91a3f4962';

ALTER TABLE public.lab_treasury_movements ENABLE TRIGGER trg_lab_treasury_guard;

INSERT INTO public.lab_treasury_audit_log (action, movement_id, actor_id, actor_name, reason, metadata)
VALUES
  ('set_pending', 'ceaf2d71-6d2a-4eb3-81d2-6e72d6bc96f4',
   '23a6a2ad-ecf1-45f6-bb28-f79327976e2d', 'عمرو يوسف',
   'إرجاع حركة بيع كتاكيت (محمد الشربيني 12,800 ج.م نقدي) إلى بانتظار الاعتماد بناءً على طلب المستخدم.',
   jsonb_build_object('amount',12800,'payment_method','cash','expected_balance_after_approval',65790)),
  ('settlement_reversed', NULL,
   '23a6a2ad-ecf1-45f6-bb28-f79327976e2d', 'عمرو يوسف',
   'حذف قيد التسوية النقدي (12,800 ج.م) لأن حركة البيع رجعت pending، فالرصيد النقدي = 52,990 ج.م.',
   jsonb_build_object('reversed_settlement_id','24c73f48-5560-48c2-860f-9fc91a3f4962','amount',12800));
