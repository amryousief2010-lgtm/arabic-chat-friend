-- Notify GM/Executive on new pending transfer_to_custody
CREATE OR REPLACE FUNCTION public.mt_notify_pending_transfer_to_custody()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec record;
BEGIN
  IF NEW.txn_type = 'transfer_to_custody' AND NEW.status = 'pending_approval' THEN
    FOR rec IN
      SELECT DISTINCT user_id FROM public.user_roles
      WHERE role IN ('general_manager','executive_manager')
    LOOP
      INSERT INTO public.notifications(title, description, type, target_user_id)
      VALUES (
        'طلب توريد جديد بانتظار الاعتماد',
        'يوجد طلب توريد جديد من الخزنة الرئيسية إلى خزنة العهدة بمبلغ '
          || to_char(NEW.amount, 'FM999,999,990.00') || ' ج.م بانتظار الاعتماد',
        'treasury_transfer_pending',
        rec.user_id
      );
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mt_notify_pending_transfer_to_custody ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_notify_pending_transfer_to_custody
AFTER INSERT ON public.main_treasury_transactions
FOR EACH ROW EXECUTE FUNCTION public.mt_notify_pending_transfer_to_custody();