
ALTER TABLE public.feed_sales DROP CONSTRAINT IF EXISTS feed_sales_destination_type_check;
ALTER TABLE public.feed_sales ADD CONSTRAINT feed_sales_destination_type_check
  CHECK (destination_type = ANY (ARRAY['external_customer','brooding_feed_store','slaughterhouse_feed_store','mother_farm_feed_store']));

ALTER TABLE public.feed_internal_payments DROP CONSTRAINT IF EXISTS feed_internal_payments_department_type_check;
ALTER TABLE public.feed_internal_payments ADD CONSTRAINT feed_internal_payments_department_type_check
  CHECK (department_type = ANY (ARRAY['brooding','slaughterhouse','mother_farm']));

CREATE OR REPLACE VIEW public.v_feed_factory_distribution AS
SELECT s.id AS sale_id, s.sale_no, s.sale_date, s.destination_type,
   CASE s.destination_type
       WHEN 'external_customer' THEN COALESCE(s.customer, 'عميل خارجي')
       WHEN 'brooding_feed_store' THEN 'حضانات تسمين الكتاكيت'
       WHEN 'slaughterhouse_feed_store' THEN 'مخزن علف المجزر'
       WHEN 'mother_farm_feed_store' THEN 'مزرعة الأمهات'
       ELSE NULL END AS destination_label,
   s.destination_type <> 'external_customer' AS is_internal_transfer,
   i.id AS item_id, i.feed_product_id, fp.name AS feed_name,
   i.quantity, i.unit_price, i.unit_cost,
   i.quantity * i.unit_price AS line_total,
   i.quantity * COALESCE(i.unit_cost, 0::numeric) AS line_cost,
   s.salesperson, s.notes
FROM public.feed_sales s
JOIN public.feed_sale_items i ON i.sale_id = s.id
LEFT JOIN public.feed_products fp ON fp.id = i.feed_product_id
WHERE i.feed_product_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_feed_internal_balances AS
WITH supplied AS (
  SELECT
    CASE fs.destination_type
      WHEN 'brooding_feed_store' THEN 'brooding'
      WHEN 'slaughterhouse_feed_store' THEN 'slaughterhouse'
      WHEN 'mother_farm_feed_store' THEN 'mother_farm'
      ELSE NULL END AS department_type,
    sum(fsi.quantity * COALESCE(fsi.unit_price, 0)) AS total_supplied_value,
    count(DISTINCT fs.id) AS supply_invoices_count,
    max(fs.sale_date) AS last_supply_date
  FROM public.feed_sales fs
  JOIN public.feed_sale_items fsi ON fsi.sale_id = fs.id
  WHERE fs.destination_type IN ('brooding_feed_store','slaughterhouse_feed_store','mother_farm_feed_store')
  GROUP BY 1
),
paid AS (
  SELECT department_type,
    sum(amount) FILTER (WHERE status='approved') AS total_paid,
    max(payment_date) FILTER (WHERE status='approved') AS last_payment_date,
    count(*) FILTER (WHERE status='pending') AS pending_payments_count
  FROM public.feed_internal_payments
  GROUP BY department_type
)
SELECT d.department_type,
  CASE d.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
    WHEN 'mother_farm' THEN 'مزرعة الأمهات'
  END AS department_label,
  COALESCE(s.total_supplied_value, 0) AS total_supplied_value,
  COALESCE(p.total_paid, 0) AS total_paid,
  COALESCE(s.total_supplied_value, 0) - COALESCE(p.total_paid, 0) AS remaining_debt,
  s.last_supply_date, p.last_payment_date,
  COALESCE(s.supply_invoices_count, 0) AS supply_invoices_count,
  COALESCE(p.pending_payments_count, 0) AS pending_payments_count,
  CASE
    WHEN (COALESCE(s.total_supplied_value, 0) - COALESCE(p.total_paid, 0)) <= 0 THEN 'no_debt'
    WHEN COALESCE(p.total_paid, 0) = 0 THEN 'unpaid'
    ELSE 'partially_paid'
  END AS account_status
FROM (VALUES ('brooding'), ('slaughterhouse'), ('mother_farm')) d(department_type)
LEFT JOIN supplied s USING (department_type)
LEFT JOIN paid p USING (department_type);

CREATE OR REPLACE FUNCTION public.feed_internal_payment_sync_treasury()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_txn_id uuid; v_dept_label text; v_main_cash_account uuid;
  v_lab_method text; v_actor uuid; v_uses_lab boolean;
BEGIN
  v_dept_label := CASE NEW.department_type
    WHEN 'brooding' THEN 'حضانات التسمين'
    WHEN 'slaughterhouse' THEN 'مخزن علف المجزر'
    WHEN 'mother_farm' THEN 'مزرعة الأمهات'
    ELSE NEW.department_type END;
  v_actor := COALESCE(NEW.approved_by, NEW.created_by);
  v_uses_lab := NEW.department_type IN ('brooding','mother_farm');

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.status = 'approved' AND OLD.status = 'pending' THEN

    IF NOT EXISTS (SELECT 1 FROM feed_factory_treasury_txns
      WHERE ref_table='feed_internal_payments' AND ref_id=NEW.id AND kind='internal_collection') THEN
      INSERT INTO feed_factory_treasury_txns
        (txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by)
      VALUES (
        'TRZ-IP-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(NEW.id::text,1,6),
        COALESCE(NEW.payment_date, CURRENT_DATE), 'in', 'internal_collection', NEW.amount,
        'feed_internal_payments', NEW.id, v_dept_label,
        'سداد مديونية علف من ' || v_dept_label
          || COALESCE(' — طريقة: ' || NEW.payment_method, '')
          || COALESCE(' — مرجع: ' || NEW.reference_no, ''),
        v_actor
      ) RETURNING id INTO v_txn_id;
      NEW.treasury_txn_id := v_txn_id;
    END IF;

    IF NEW.payment_method = 'internal_settlement' THEN RETURN NEW; END IF;

    IF v_uses_lab THEN
      IF NOT EXISTS (SELECT 1 FROM lab_treasury_movements
        WHERE source_table='feed_internal_payments' AND source_id=NEW.id) THEN
        v_lab_method := CASE NEW.payment_method
          WHEN 'cash' THEN 'cash' WHEN 'vodafone_cash' THEN 'vodafone_cash'
          WHEN 'instapay' THEN 'instapay' WHEN 'bank_transfer' THEN 'bank_transfer'
          ELSE 'cash' END;
        INSERT INTO lab_treasury_movements
          (movement_type, movement_date, expense_category, amount, payment_method,
           description, beneficiary, notes, status, source_table, source_id, source_ref,
           created_by, approved_by, approved_at)
        VALUES (
          'expense'::lab_treasury_movement_type, COALESCE(NEW.payment_date, CURRENT_DATE),
          'feed_supplies'::lab_treasury_expense_category, NEW.amount,
          v_lab_method::lab_treasury_payment_method,
          'سداد علف لمصنع العلف — ' || v_dept_label, 'مصنع العلف',
          COALESCE('مرجع: ' || NEW.reference_no, '') || COALESCE(' — ' || NEW.notes, ''),
          'approved'::lab_treasury_status,
          'feed_internal_payments', NEW.id, NEW.payment_no,
          v_actor, v_actor, now()
        );
      END IF;
    ELSIF NEW.department_type = 'slaughterhouse' THEN
      IF NOT EXISTS (SELECT 1 FROM main_treasury_transactions
        WHERE reference_no = 'FEEDPAY-MAIN-OUT-' || NEW.id::text) THEN
        SELECT id INTO v_main_cash_account FROM main_treasury_accounts
          WHERE account_type='cash' ORDER BY created_at LIMIT 1;
        IF v_main_cash_account IS NOT NULL THEN
          INSERT INTO main_treasury_transactions
            (reference_no, account_id, txn_type, amount, txn_date, counterparty,
             description, status, payment_method, posted_at, created_by)
          VALUES (
            'FEEDPAY-MAIN-OUT-' || NEW.id::text, v_main_cash_account, 'withdrawal',
            NEW.amount, COALESCE(NEW.payment_date, CURRENT_DATE), 'مصنع العلف',
            'سداد علف المجزر لمصنع العلف — رقم ' || NEW.payment_no,
            'posted', NEW.payment_method, now(), v_actor
          );
        END IF;
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'approved' AND NEW.status = 'cancelled' THEN
    IF NOT EXISTS (SELECT 1 FROM feed_factory_treasury_txns
      WHERE ref_table='feed_internal_payments_reversal' AND ref_id=NEW.id) THEN
      INSERT INTO feed_factory_treasury_txns
        (txn_no, txn_date, direction, kind, amount, ref_table, ref_id, party, note, created_by)
      VALUES (
        'TRZ-REV-' || to_char(now(),'YYMMDDHH24MISS') || '-' || substr(NEW.id::text,1,6),
        CURRENT_DATE, 'out', 'internal_collection_reversal', NEW.amount,
        'feed_internal_payments_reversal', NEW.id, v_dept_label,
        'عكس سداد ملغى رقم ' || NEW.payment_no, v_actor
      );
    END IF;

    IF NEW.payment_method = 'internal_settlement' THEN RETURN NEW; END IF;

    IF v_uses_lab THEN
      IF NOT EXISTS (SELECT 1 FROM lab_treasury_movements
        WHERE source_table='feed_internal_payments_reversal' AND source_id=NEW.id) THEN
        v_lab_method := CASE NEW.payment_method
          WHEN 'cash' THEN 'cash' WHEN 'vodafone_cash' THEN 'vodafone_cash'
          WHEN 'instapay' THEN 'instapay' WHEN 'bank_transfer' THEN 'bank_transfer'
          ELSE 'cash' END;
        INSERT INTO lab_treasury_movements
          (movement_type, movement_date, income_category, amount, payment_method,
           description, customer_name, notes, status, source_table, source_id, source_ref,
           created_by, approved_by, approved_at)
        VALUES (
          'income'::lab_treasury_movement_type, CURRENT_DATE,
          'other'::lab_treasury_income_category, NEW.amount,
          v_lab_method::lab_treasury_payment_method,
          'عكس سداد علف ملغى — ' || v_dept_label, 'مصنع العلف',
          'إلغاء سداد رقم ' || NEW.payment_no, 'approved'::lab_treasury_status,
          'feed_internal_payments_reversal', NEW.id, NEW.payment_no,
          v_actor, v_actor, now()
        );
      END IF;
    ELSIF NEW.department_type = 'slaughterhouse' THEN
      IF NOT EXISTS (SELECT 1 FROM main_treasury_transactions
        WHERE reference_no = 'FEEDPAY-MAIN-REV-' || NEW.id::text) THEN
        SELECT id INTO v_main_cash_account FROM main_treasury_accounts
          WHERE account_type='cash' ORDER BY created_at LIMIT 1;
        IF v_main_cash_account IS NOT NULL THEN
          INSERT INTO main_treasury_transactions
            (reference_no, account_id, txn_type, amount, txn_date, counterparty,
             description, status, payment_method, posted_at, created_by)
          VALUES (
            'FEEDPAY-MAIN-REV-' || NEW.id::text, v_main_cash_account, 'deposit',
            NEW.amount, CURRENT_DATE, 'مصنع العلف',
            'عكس سداد علف المجزر ملغى — رقم ' || NEW.payment_no,
            'posted', NEW.payment_method, now(), v_actor
          );
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS fip_insert_authorized ON public.feed_internal_payments;
CREATE POLICY fip_insert_authorized ON public.feed_internal_payments
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'feed_factory_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
    OR (department_type = 'brooding' AND (has_role(auth.uid(), 'brooding_manager'::app_role) OR has_role(auth.uid(), 'production_manager'::app_role)))
    OR (department_type = 'slaughterhouse' AND (has_role(auth.uid(), 'slaughterhouse_manager'::app_role) OR has_role(auth.uid(), 'warehouse_supervisor'::app_role)))
    OR (department_type = 'mother_farm' AND (has_role(auth.uid(), 'farm_manager'::app_role) OR has_role(auth.uid(), 'lab_treasury_keeper'::app_role) OR has_role(auth.uid(), 'production_manager'::app_role)))
  );

DROP POLICY IF EXISTS fip_select_authorized ON public.feed_internal_payments;
CREATE POLICY fip_select_authorized ON public.feed_internal_payments
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'general_manager'::app_role)
    OR has_role(auth.uid(), 'executive_manager'::app_role)
    OR has_role(auth.uid(), 'feed_factory_manager'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
    OR has_role(auth.uid(), 'financial_manager'::app_role)
    OR (department_type = 'brooding' AND (has_role(auth.uid(), 'brooding_manager'::app_role) OR has_role(auth.uid(), 'production_manager'::app_role)))
    OR (department_type = 'slaughterhouse' AND (has_role(auth.uid(), 'slaughterhouse_manager'::app_role) OR has_role(auth.uid(), 'warehouse_supervisor'::app_role)))
    OR (department_type = 'mother_farm' AND (has_role(auth.uid(), 'farm_manager'::app_role) OR has_role(auth.uid(), 'lab_treasury_keeper'::app_role) OR has_role(auth.uid(), 'production_manager'::app_role)))
  );
