
-- Treasury (cash box) for Feed Factory + auto-link to sales/purchases
CREATE TABLE public.feed_factory_treasury_txns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  txn_no TEXT NOT NULL UNIQUE,
  txn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')),
  kind TEXT NOT NULL CHECK (kind IN ('sale','purchase','loan_from_naam','loan_to_naam','manual_in','manual_out','opening_balance','other')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  ref_table TEXT,
  ref_id UUID,
  party TEXT,
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feed_factory_treasury_txns TO authenticated;
GRANT ALL ON public.feed_factory_treasury_txns TO service_role;

ALTER TABLE public.feed_factory_treasury_txns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read treasury" ON public.feed_factory_treasury_txns FOR SELECT TO authenticated USING (true);
CREATE POLICY "managers write treasury" ON public.feed_factory_treasury_txns FOR INSERT TO authenticated WITH CHECK (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
  OR public.has_role(auth.uid(),'feed_factory_manager') OR public.has_role(auth.uid(),'warehouse_supervisor')
);
CREATE POLICY "managers update treasury" ON public.feed_factory_treasury_txns FOR UPDATE TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
);
CREATE POLICY "managers delete treasury" ON public.feed_factory_treasury_txns FOR DELETE TO authenticated USING (
  public.has_role(auth.uid(),'general_manager') OR public.has_role(auth.uid(),'executive_manager')
);

CREATE INDEX idx_feed_treasury_date ON public.feed_factory_treasury_txns(txn_date DESC);
CREATE INDEX idx_feed_treasury_ref ON public.feed_factory_treasury_txns(ref_table, ref_id);

-- Auto-record sale as treasury IN
CREATE OR REPLACE FUNCTION public.feed_treasury_after_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feed_factory_treasury_txns WHERE ref_table='feed_sales' AND ref_id = OLD.id;
    RETURN OLD;
  END IF;
  v_no := 'TRZ-' || to_char(now(),'YYMMDD') || '-' || substr(NEW.id::text,1,6);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
    VALUES (v_no, NEW.sale_date, 'in','sale', COALESCE(NEW.total_amount,0),'feed_sales',NEW.id,NEW.customer,'بيع رقم '||NEW.sale_no, NEW.created_by);
  ELSE
    UPDATE public.feed_factory_treasury_txns SET amount = COALESCE(NEW.total_amount,0), txn_date = NEW.sale_date, party = NEW.customer
      WHERE ref_table='feed_sales' AND ref_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_feed_treasury_sale ON public.feed_sales;
CREATE TRIGGER trg_feed_treasury_sale AFTER INSERT OR UPDATE OR DELETE ON public.feed_sales
FOR EACH ROW EXECUTE FUNCTION public.feed_treasury_after_sale();

-- Auto-record purchase as treasury OUT
CREATE OR REPLACE FUNCTION public.feed_treasury_after_purchase()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_no TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.feed_factory_treasury_txns WHERE ref_table='feed_raw_purchases' AND ref_id = OLD.id;
    RETURN OLD;
  END IF;
  v_no := 'TRZ-' || to_char(now(),'YYMMDD') || '-' || substr(NEW.id::text,1,6);
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
    VALUES (v_no, NEW.purchase_date, 'out','purchase', COALESCE(NEW.total_amount,0),'feed_raw_purchases',NEW.id,NEW.supplier,'شراء رقم '||NEW.purchase_no, NEW.created_by);
  ELSE
    UPDATE public.feed_factory_treasury_txns SET amount = COALESCE(NEW.total_amount,0), txn_date = NEW.purchase_date, party = NEW.supplier
      WHERE ref_table='feed_raw_purchases' AND ref_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_feed_treasury_purchase ON public.feed_raw_purchases;
CREATE TRIGGER trg_feed_treasury_purchase AFTER INSERT OR UPDATE OR DELETE ON public.feed_raw_purchases
FOR EACH ROW EXECUTE FUNCTION public.feed_treasury_after_purchase();

-- Backfill existing sales/purchases into treasury
INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
SELECT 'TRZ-S-'||substr(id::text,1,8), sale_date,'in','sale',COALESCE(total_amount,0),'feed_sales',id,customer,'بيع رقم '||sale_no,created_by
FROM public.feed_sales WHERE NOT EXISTS (SELECT 1 FROM public.feed_factory_treasury_txns t WHERE t.ref_table='feed_sales' AND t.ref_id=feed_sales.id);

INSERT INTO public.feed_factory_treasury_txns(txn_no,txn_date,direction,kind,amount,ref_table,ref_id,party,note,created_by)
SELECT 'TRZ-P-'||substr(id::text,1,8), purchase_date,'out','purchase',COALESCE(total_amount,0),'feed_raw_purchases',id,supplier,'شراء رقم '||purchase_no,created_by
FROM public.feed_raw_purchases WHERE NOT EXISTS (SELECT 1 FROM public.feed_factory_treasury_txns t WHERE t.ref_table='feed_raw_purchases' AND t.ref_id=feed_raw_purchases.id);
