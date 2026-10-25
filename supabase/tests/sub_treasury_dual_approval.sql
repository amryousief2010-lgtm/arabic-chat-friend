-- تحويلات الخزن الفرعية: اعتمادين >= 50,000 + منع الاعتماد الذاتي + اعتماد رجعي.
BEGIN;
DO $$
DECLARE
  v_acc uuid; v_rec uuid := gen_random_uuid(); v_a1 uuid := gen_random_uuid(); v_a2 uuid := gen_random_uuid();
  v_t public.main_treasury_transactions; v_small public.main_treasury_transactions;
  v_ok boolean;
BEGIN
  INSERT INTO auth.users (id, email, aud, role) VALUES
    (v_rec, 'rec-'||v_rec||'@test.local','authenticated','authenticated'),
    (v_a1, 'a1-'||v_a1||'@test.local','authenticated','authenticated'),
    (v_a2, 'a2-'||v_a2||'@test.local','authenticated','authenticated');
  INSERT INTO public.user_roles(user_id, role) VALUES
    (v_rec,'executive_manager'),(v_a1,'general_manager'),(v_a2,'financial_manager');
  SELECT id INTO v_acc FROM public.main_treasury_accounts WHERE account_type='cash' LIMIT 1;

  -- 1) تسجيل كـ posted + معتمد = نفس الشخص → يتحول pending بدون معتمدين
  PERFORM set_config('request.jwt.claim.sub', v_rec::text, true);
  INSERT INTO public.main_treasury_transactions(account_id, txn_type, amount, txn_date, status, created_by, approver_1_id, approver_1_at, counterparty)
  VALUES (v_acc,'transfer_to_sub_treasury',82050,current_date,'posted',v_rec,v_rec,now(),'خزنة اختبار')
  RETURNING * INTO v_t;
  ASSERT v_t.status='pending_approval', 'big transfer must start pending, got '||v_t.status;
  ASSERT v_t.approver_1_id IS NULL AND v_t.requires_dual_approval, 'approvers cleared + dual';

  -- 2) المسجّل ما يعتمدش
  v_ok := false;
  BEGIN PERFORM public.mt_approve_txn(v_t.id); EXCEPTION WHEN others THEN v_ok := true; END;
  ASSERT v_ok, 'recorder must not approve';

  -- 3) أول اعتماد → لسه pending ؛ نفس المعتمد تاني → مرفوض ؛ معتمد مختلف → posted
  PERFORM set_config('request.jwt.claim.sub', v_a1::text, true);
  v_t := public.mt_approve_txn(v_t.id);
  ASSERT v_t.status='pending_approval', 'one approval is not enough';
  v_ok := false;
  BEGIN PERFORM public.mt_approve_txn(v_t.id); EXCEPTION WHEN others THEN v_ok := true; END;
  ASSERT v_ok, 'same approver twice must fail';
  PERFORM set_config('request.jwt.claim.sub', v_a2::text, true);
  v_t := public.mt_approve_txn(v_t.id);
  ASSERT v_t.status='posted' AND v_t.approver_2_id=v_a2, 'second approver posts';

  -- 4) ترحيل مباشر بـ UPDATE بدون اعتماد تاني → مرفوض
  PERFORM set_config('request.jwt.claim.sub', v_rec::text, true);
  INSERT INTO public.main_treasury_transactions(account_id, txn_type, amount, txn_date, created_by, counterparty)
  VALUES (v_acc,'transfer_to_sub_treasury',60000,current_date,v_rec,'خزنة اختبار') RETURNING * INTO v_t;
  v_ok := false;
  BEGIN
    UPDATE public.main_treasury_transactions SET status='posted', approver_1_id=v_a1 WHERE id=v_t.id;
  EXCEPTION WHEN others THEN v_ok := true; END;
  ASSERT v_ok, 'direct post with one approver must fail';

  -- 5) تحويل صغير (<= 5,000) يفضل يترحّل تلقائي زي القاعدة الحالية
  INSERT INTO public.main_treasury_transactions(account_id, txn_type, amount, txn_date, created_by, counterparty)
  VALUES (v_acc,'transfer_to_sub_treasury',2300,current_date,v_rec,'خزنة العلف') RETURNING * INTO v_small;
  ASSERT v_small.status='posted', 'small transfer auto-posts';

  -- 6) اعتماد رجعي: المسجّل مرفوض، معتمد مستقل مقبول + سجل تدقيق
  ALTER TABLE public.main_treasury_transactions DISABLE TRIGGER trg_mt_zz_sub_transfer_guard;
  UPDATE public.main_treasury_transactions SET status='posted', approver_1_id=v_rec, approver_1_at=now(), posted_at=now() WHERE id=v_t.id;
  ALTER TABLE public.main_treasury_transactions ENABLE TRIGGER trg_mt_zz_sub_transfer_guard;
  v_ok := false;
  BEGIN PERFORM public.mt_retro_second_approve(v_t.id, 'اختبار'); EXCEPTION WHEN others THEN v_ok := true; END;
  ASSERT v_ok, 'recorder cannot retro-approve';
  PERFORM set_config('request.jwt.claim.sub', v_a1::text, true);
  v_t := public.mt_retro_second_approve(v_t.id, 'اعتماد تاني بأثر رجعي');
  ASSERT v_t.approver_2_id = v_a1, 'retro approver set';
  ASSERT EXISTS (SELECT 1 FROM public.main_treasury_audit_log WHERE txn_id=v_t.id AND action='retro_second_approval'), 'audit row';

  -- 7) الحركة القديمة ذاتية الاعتماد لسه تتلغي
  UPDATE public.main_treasury_transactions SET status='reversed', rejection_reason='اختبار' WHERE id=v_t.id;
  RAISE NOTICE 'sub_treasury_dual_approval: all assertions passed';
END $$;
ROLLBACK;
