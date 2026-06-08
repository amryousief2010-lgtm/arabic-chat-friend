
CREATE OR REPLACE FUNCTION public.feed_treasury_after_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feed_factory_treasury_txns WHERE ref_table='feed_sales' AND ref_id = OLD.id;
    RETURN OLD;
  END IF;

  -- التوريد الداخلي لا يُسجَّل كإيراد مبيعات خارجي
  IF COALESCE(NEW.destination_type,'external_customer') <> 'external_customer' THEN
    -- لو تم تغيير الفاتورة من خارجية إلى داخلية: احذف القيد الخارجي السابق
    DELETE FROM public.feed_factory_treasury_txns WHERE ref_table='feed_sales' AND ref_id = NEW.id;
    RETURN NEW;
  END IF;

  v_no := 'TRZ-' || to_char(now(),'YYMMDD') || '-' || substr(NEW.id::text,1,6);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
    VALUES (v_no, NEW.sale_date, 'in','sale', COALESCE(NEW.total_amount,0),'feed_sales',NEW.id,NEW.customer,'بيع رقم '||NEW.sale_no, NEW.created_by);
  ELSE
    -- لو الفاتورة موجودة سابقًا كقيد خارجي: حدّث، وإلا أنشئ (في حالة التحول من داخلي إلى خارجي)
    IF EXISTS (SELECT 1 FROM public.feed_factory_treasury_txns WHERE ref_table='feed_sales' AND ref_id = NEW.id) THEN
      UPDATE public.feed_factory_treasury_txns SET amount = COALESCE(NEW.total_amount,0), txn_date = NEW.sale_date, party = NEW.customer
        WHERE ref_table='feed_sales' AND ref_id = NEW.id;
    ELSE
      INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
      VALUES (v_no, NEW.sale_date, 'in','sale', COALESCE(NEW.total_amount,0),'feed_sales',NEW.id,NEW.customer,'بيع رقم '||NEW.sale_no, NEW.created_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
