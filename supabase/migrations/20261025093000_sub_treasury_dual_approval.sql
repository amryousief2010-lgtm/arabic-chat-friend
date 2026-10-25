-- تحويلات الخزنة الرئيسية للخزن الفرعية (مصنع اللحوم / العلف / المعمل / العهدة):
-- 1) أي تحويل >= 50,000 ج.م يحتاج اعتمادين من شخصين مختلفين.
-- 2) اللي سجّل الحركة ما يقدرش يعتمدها (لا أول ولا تاني).
-- 3) الحركة ما تتسجلش "مُرحّلة" مباشرة لو قيمتها محتاجة اعتماد (يتجاهل status/approver من العميل).
-- 4) اعتماد تاني بأثر رجعي لحركة مرحّلة ناقصها الاعتماد التاني، مع سجل تدقيق.

CREATE OR REPLACE FUNCTION public.mt_is_sub_transfer(_txn_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _txn_type IN ('transfer_to_sub_treasury','transfer_to_custody');
$$;

CREATE OR REPLACE FUNCTION public.mt_txn_before_insert()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_year INT := EXTRACT(YEAR FROM COALESCE(NEW.txn_date, CURRENT_DATE));
  v_seq BIGINT;
  v_rule RECORD;
  v_needs_approval boolean;
BEGIN
  IF NEW.reference_no IS NULL THEN
    v_seq := nextval('public.main_treasury_txn_seq');
    NEW.reference_no := 'MT-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  END IF;

  SELECT * INTO v_rule FROM public.main_treasury_approval_rules
    WHERE is_active
      AND NEW.amount >= min_amount
      AND (max_amount IS NULL OR NEW.amount <= max_amount)
    ORDER BY min_amount DESC LIMIT 1;

  IF v_rule.requires_dual_approval THEN
    NEW.requires_dual_approval := true;
  END IF;

  v_needs_approval := COALESCE(v_rule.requires_approval, true);

  IF public.mt_is_sub_transfer(NEW.txn_type) THEN
    IF NEW.amount >= 50000 THEN
      NEW.requires_dual_approval := true;
      v_needs_approval := true;
    END IF;
    IF v_needs_approval THEN
      -- لا اعتماد ولا ترحيل وقت التسجيل
      NEW.approver_1_id := NULL; NEW.approver_1_at := NULL;
      NEW.approver_2_id := NULL; NEW.approver_2_at := NULL;
      NEW.posted_at := NULL;
      IF COALESCE(NEW.status,'') <> 'draft' THEN
        NEW.status := 'pending_approval';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF NOT v_needs_approval THEN
    NEW.status := COALESCE(NEW.status, 'posted');
    IF NEW.status = 'pending_approval' THEN NEW.status := 'posted'; END IF;
    IF NEW.status = 'posted' THEN NEW.posted_at := now(); END IF;
  ELSE
    NEW.status := COALESCE(NULLIF(NEW.status,''), 'pending_approval');
  END IF;

  RETURN NEW;
END;
$function$;

-- حارس على مستوى الصف: يمنع أي مسار (RPC أو تعديل مباشر) يكسر القاعدة.
CREATE OR REPLACE FUNCTION public.mt_sub_transfer_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.mt_is_sub_transfer(NEW.txn_type) THEN
    RETURN NEW;
  END IF;

  -- نتحقق بس لما المعتمد يتضاف/يتغير (عشان الحركات القديمة تفضل قابلة للإلغاء)
  IF NEW.approver_1_id IS NOT NULL AND NEW.approver_1_id = NEW.created_by
     AND (TG_OP = 'INSERT' OR NEW.approver_1_id IS DISTINCT FROM OLD.approver_1_id) THEN
    RAISE EXCEPTION 'لا يمكن اعتماد تحويل خزنة فرعية سجلته بنفسك (%)', NEW.reference_no;
  END IF;
  IF NEW.approver_2_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.approver_2_id IS DISTINCT FROM OLD.approver_2_id) THEN
    IF NEW.approver_2_id = NEW.created_by THEN
      RAISE EXCEPTION 'لا يمكن اعتماد تحويل خزنة فرعية سجلته بنفسك (%)', NEW.reference_no;
    END IF;
    IF NEW.approver_2_id = NEW.approver_1_id THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف (%)', NEW.reference_no;
    END IF;
  END IF;

  -- الانتقال لحالة مرحّلة لازم يستوفي الاعتمادات
  IF NEW.status IN ('posted','approved')
     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('posted','approved')) THEN
    IF NEW.amount >= 50000 AND (NEW.approver_1_id IS NULL OR NEW.approver_2_id IS NULL) THEN
      RAISE EXCEPTION 'تحويل خزنة فرعية % بقيمة % يحتاج اعتمادين من شخصين مختلفين', NEW.reference_no, NEW.amount;
    END IF;
  END IF;

  -- منع تغيير/مسح المعتمدين بعد الترحيل (مسموح فقط إضافة الاعتماد التاني الناقص)
  IF TG_OP = 'UPDATE' AND OLD.status IN ('posted','approved') THEN
    IF NEW.approver_1_id IS DISTINCT FROM OLD.approver_1_id
       OR (OLD.approver_2_id IS NOT NULL AND NEW.approver_2_id IS DISTINCT FROM OLD.approver_2_id) THEN
      RAISE EXCEPTION 'لا يمكن تغيير معتمدي حركة % بعد ترحيلها', OLD.reference_no;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- يتم بعد before_insert / before_update (الترتيب أبجدي: trg_mt_txn_before_* ثم trg_mt_zz_*)
DROP TRIGGER IF EXISTS trg_mt_zz_sub_transfer_guard ON public.main_treasury_transactions;
CREATE TRIGGER trg_mt_zz_sub_transfer_guard
  BEFORE INSERT OR UPDATE ON public.main_treasury_transactions
  FOR EACH ROW EXECUTE FUNCTION public.mt_sub_transfer_guard();

-- اعتماد مجموعة تحويل: كان بيرحّل مباشرة بدون اعتماد تاني. دلوقتي يمشي بنفس قواعد mt_approve_txn.
CREATE OR REPLACE FUNCTION public.mt_approve_transfer_group(p_group_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  FOR r IN SELECT id, created_by, status, requires_dual_approval, approver_1_id
             FROM main_treasury_transactions
            WHERE transfer_group_id = p_group_id FOR UPDATE LOOP
    IF r.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك'; END IF;
    IF r.status <> 'pending_approval' THEN CONTINUE; END IF;
    IF r.requires_dual_approval THEN
      IF r.approver_1_id IS NULL THEN
        UPDATE main_treasury_transactions SET approver_1_id = auth.uid(), approver_1_at = now() WHERE id = r.id;
      ELSIF r.approver_1_id = auth.uid() THEN
        RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
      ELSE
        UPDATE main_treasury_transactions
           SET approver_2_id = auth.uid(), approver_2_at = now(), status='posted', posted_at=now()
         WHERE id = r.id;
      END IF;
    ELSE
      UPDATE main_treasury_transactions
         SET status='posted', posted_at=now(), approver_1_id=auth.uid(), approver_1_at=now()
       WHERE id = r.id;
    END IF;
    n := n + 1;
  END LOOP;
  IF n = 0 THEN RAISE EXCEPTION 'لا توجد حركات معلقة بهذا التحويل'; END IF;
  RETURN n;
END $function$;

-- اعتماد تاني بأثر رجعي لتحويل مرحّل ناقصه اعتماد مستقل.
CREATE OR REPLACE FUNCTION public.mt_retro_second_approve(p_txn_id uuid, p_note text)
 RETURNS public.main_treasury_transactions
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t public.main_treasury_transactions;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  IF COALESCE(trim(p_note),'') = '' THEN RAISE EXCEPTION 'سبب الاعتماد بأثر رجعي مطلوب'; END IF;
  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status NOT IN ('posted','approved') THEN RAISE EXCEPTION 'الاعتماد بأثر رجعي للحركات المرحّلة فقط'; END IF;
  IF t.approver_2_id IS NOT NULL THEN RAISE EXCEPTION 'الحركة عليها اعتماد تاني بالفعل'; END IF;
  IF auth.uid() = t.created_by OR auth.uid() = t.approver_1_id THEN
    RAISE EXCEPTION 'الاعتماد بأثر رجعي لازم يكون من شخص غير اللي سجّل أو اعتمد أول مرة';
  END IF;
  UPDATE public.main_treasury_transactions
     SET approver_2_id = auth.uid(), approver_2_at = now()
   WHERE id = p_txn_id RETURNING * INTO t;
  INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
  VALUES (t.id, 'retro_second_approval', auth.uid(),
          jsonb_build_object('note', p_note, 'created_by', t.created_by, 'approver_1_id', t.approver_1_id,
                             'amount', t.amount, 'reference_no', t.reference_no));
  RETURN t;
END $function$;

REVOKE ALL ON FUNCTION public.mt_retro_second_approve(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mt_retro_second_approve(uuid, text) TO authenticated;

-- mt_approve_txn: نفس المنطق الحالي، مع نسخ المعتمدين للأرجل التانية في نفس مجموعة التحويل
CREATE OR REPLACE FUNCTION public.mt_approve_txn(p_txn_id uuid)
 RETURNS main_treasury_transactions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  t public.main_treasury_transactions;
  sib record;
BEGIN
  IF NOT public.is_main_treasury_approver(auth.uid()) THEN
    RAISE EXCEPTION 'صلاحية اعتماد الخزنة الرئيسية فقط';
  END IF;
  SELECT * INTO t FROM public.main_treasury_transactions WHERE id = p_txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'المعاملة غير موجودة'; END IF;
  IF t.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'المعاملة ليست في حالة انتظار اعتماد (الحالة: %)', t.status;
  END IF;
  IF t.created_by = auth.uid() THEN RAISE EXCEPTION 'لا يمكن اعتماد حركة سجلتها بنفسك'; END IF;

  IF t.incoming_source IN ('hyper_healthy','carrefour') AND COALESCE(t.attachment_url,'') = '' THEN
    INSERT INTO public.main_treasury_audit_log(txn_id, action, performed_by, details)
    VALUES (t.id, 'approved_without_attachment', auth.uid(), jsonb_build_object('source', t.incoming_source));
  END IF;

  IF t.requires_dual_approval THEN
    IF t.approver_1_id IS NULL THEN
      UPDATE public.main_treasury_transactions
        SET approver_1_id = auth.uid(), approver_1_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
      RETURN t;
    ELSIF t.approver_1_id = auth.uid() THEN
      RAISE EXCEPTION 'يلزم اعتماد ثاني من معتمد مختلف';
    ELSE
      UPDATE public.main_treasury_transactions
        SET approver_2_id = auth.uid(), approver_2_at = now(), status = 'posted', posted_at = now()
        WHERE id = p_txn_id RETURNING * INTO t;
    END IF;
  ELSE
    UPDATE public.main_treasury_transactions
      SET approver_1_id = auth.uid(), approver_1_at = now(), status = 'posted', posted_at = now()
      WHERE id = p_txn_id RETURNING * INTO t;
  END IF;

  IF t.transfer_group_id IS NOT NULL THEN
    FOR sib IN SELECT id FROM public.main_treasury_transactions
               WHERE transfer_group_id = t.transfer_group_id AND id <> t.id AND status='pending_approval' FOR UPDATE LOOP
      UPDATE public.main_treasury_transactions
        SET status='posted', posted_at=now(),
            approver_1_id = COALESCE(approver_1_id, t.approver_1_id),
            approver_1_at = COALESCE(approver_1_at, t.approver_1_at),
            approver_2_id = COALESCE(approver_2_id, t.approver_2_id),
            approver_2_at = COALESCE(approver_2_at, t.approver_2_at)
        WHERE id = sib.id;
    END LOOP;
  END IF;

  RETURN t;
END $function$;
