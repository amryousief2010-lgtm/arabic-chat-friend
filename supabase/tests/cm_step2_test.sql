\set ON_ERROR_STOP on
-- اختبارات الخطوة 2 (محلي فقط). يُشغَّل بعد تطبيع الـ migrations الثلاث مرتين.
CREATE SCHEMA IF NOT EXISTS cmt;
CREATE OR REPLACE FUNCTION cmt.ct(t text) RETURNS timestamptz LANGUAGE sql AS $$ SELECT t::timestamp AT TIME ZONE 'Africa/Cairo' $$;
CREATE OR REPLACE FUNCTION cmt.mid(s text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM public.cm_moderators WHERE slug = s $$;
GRANT USAGE ON SCHEMA cmt TO authenticated;

-- ── التطبيع ──
DO $$ BEGIN
  ASSERT cm_normalize_phone('+20 10 0000 0001') = '01000000001', 'plus20';
  ASSERT cm_normalize_phone('0201000000004') = '01000000004', '02 prefix';
  ASSERT cm_normalize_phone('+20 2 01000000004') = '01000000004', '+20 2 prefix';
  ASSERT cm_normalize_phone('٠١٠٠٠٠٠٠٠٠٥') = '01000000005', 'arabic digits';
  ASSERT cm_normalize_phone('0223456789') = '0223456789' AND NOT cm_phone_is_valid('0223456789'), 'landline stays invalid';
  ASSERT (SELECT count(*) FROM cm_split_phone_field('01000000002 / 01000000003')) = 2, 'split slash';
  ASSERT (SELECT count(*) FROM cm_split_phone_field('0100000000201000000003')) = 2, 'split glued';
  ASSERT (SELECT count(*) FROM cm_split_phone_field('010 0000 0001')) = 1, 'single with spaces';
END $$;

-- ── مزامنة الأرقام (مرتين = نفس النتيجة) ──
SELECT cm_sync_customer_phones();
SELECT cm_sync_customer_phones();
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_contact_phones) = 7, 'phones rows '||(SELECT count(*) FROM cm_contact_phones);
  ASSERT (SELECT count(*) FROM cm_contact_phones WHERE NOT is_valid) = 1, 'one malformed';
  ASSERT (SELECT count(*) FROM cm_phone_review_queue WHERE issue='malformed') = 1, 'queue malformed';
  ASSERT (SELECT count(*) FROM cm_phone_review_queue WHERE issue='two_numbers') = 1, 'queue two numbers';
  ASSERT (SELECT count(*) FROM cm_phone_review_queue WHERE issue='multi_customer' AND phone_norm='01000000001'
          AND cardinality(related_customer_ids)=2) = 1, 'queue multi customer';
  ASSERT (SELECT phone FROM customers WHERE id='00000000-0000-0000-0000-00000000c002') = '+20 10 0000 0001', 'customers.phone untouched';
  ASSERT cm_customer_for_phone('01000000001') = '00000000-0000-0000-0000-00000000c002', 'latest order wins';
  ASSERT cm_customer_for_phone('+20 2 01000000004') = '00000000-0000-0000-0000-00000000c005', 'hotline lookup';
END $$;

-- ── التهيئة: ربط حسابات، خط بمالكة، شيفت إضافي ──
UPDATE cm_moderators SET user_id='00000000-0000-0000-0000-0000000000c1' WHERE slug='noura';
UPDATE cm_lines SET owner_moderator_id = cmt.mid('noura') WHERE label='خط مودريتور 1';
INSERT INTO cm_lines (channel_id, label, mode) SELECT id, 'خط بدون مالكة', 'app_only' FROM cm_channels WHERE kind='whatsapp';
INSERT INTO cm_shift_assignments (work_date, slot_no, label, starts_at, ends_at, moderator_id, source)
  VALUES ('2026-10-27', 4, 'إضافي', '09:00', '14:00', cmt.mid('soha'), 'manual');
UPDATE cm_distribution_settings SET method='campaign', fallback_method='load';

-- ── التوزيع ──
-- 1) صاحبة الخط تأخذ محادثة خطها
INSERT INTO cm_conversations (id, line_id, phone_norm) SELECT '00000000-0000-0000-0000-0000000c0a01', id, '01000000001' FROM cm_lines WHERE label='خط مودريتور 1';
INSERT INTO cm_messages (conversation_id, direction, body, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a01','in','سلام','wamid.1', cmt.ct('2026-10-27 11:00'));
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a01');
  ASSERT r.moderator_id = cmt.mid('noura') AND r.via='line_owner', 'line owner wins';
  ASSERT (SELECT assigned_moderator_id FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a01') = cmt.mid('noura'), 'assigned copy';
END $$;
-- إعادة الـ webhook بنفس المعرّف لا تكرر الرسالة
INSERT INTO cm_messages (conversation_id, direction, body, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a01','in','سلام','wamid.1', cmt.ct('2026-10-27 11:00'))
  ON CONFLICT (provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_messages WHERE provider_message_id='wamid.1') = 1, 'webhook idempotent';
  BEGIN
    INSERT INTO cm_messages (conversation_id, direction, provider_message_id) VALUES ('00000000-0000-0000-0000-0000000c0a01','in','wamid.1');
    RAISE EXCEPTION 'dup allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

-- 2) صاحبة الخط في إجازتها الأسبوعية (الأربعاء 28/10): تبقى المالكة + تغطية لمن في الشيفت (آية 14–20)
INSERT INTO cm_weekly_days_off (moderator_id, dow, valid_from) VALUES (cmt.mid('noura'), 3, '2026-10-01');
-- اثنتان في الشيفت (آية sort 2، سها sort 4): التغطية لأول واحدة بالترتيب
INSERT INTO cm_shift_assignments (work_date, slot_no, label, starts_at, ends_at, moderator_id, source)
  VALUES ('2026-10-28', 6, 'اختبار', '14:00', '20:00', cmt.mid('soha'), 'manual');
INSERT INTO cm_conversations (id, line_id) SELECT '00000000-0000-0000-0000-0000000c0a02', id FROM cm_lines WHERE label='خط مودريتور 1';
INSERT INTO cm_messages (conversation_id, direction, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a02','in','wamid.2', cmt.ct('2026-10-28 15:00'));
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a02');
  ASSERT r.moderator_id = cmt.mid('noura') AND r.via='line_owner', 'on-leave owner keeps ownership';
  ASSERT (SELECT moderator_id FROM cm_conversation_assignments WHERE conversation_id='00000000-0000-0000-0000-0000000c0a02'
          AND kind='cover' AND ended_at IS NULL) = cmt.mid('aya'), 'cover to on-shift aya';
END $$;
DELETE FROM cm_shift_assignments WHERE work_date='2026-10-28' AND slot_no=6;

-- 3) مالكة انتهى عملها لا تُعتبر مالكة → توزيع (حملة افتراضية ← خط ← سها)
UPDATE cm_lines SET owner_moderator_id = cmt.mid('mariam') WHERE label='خط بدون مالكة';
UPDATE cm_moderators SET end_date='2026-10-20' WHERE slug='mariam';
INSERT INTO cm_lines (channel_id, label, mode, owner_moderator_id) SELECT id, 'خط حملة', 'app_only', cmt.mid('soha') FROM cm_channels WHERE kind='whatsapp';
INSERT INTO cm_campaigns (name, is_default) VALUES ('الحملة الافتراضية', true);
INSERT INTO cm_campaign_line_map (campaign_id, line_id, valid_from)
  SELECT c.id, l.id, '2026-10-01' FROM cm_campaigns c, cm_lines l WHERE c.is_default AND l.label='خط حملة';
INSERT INTO cm_conversations (id, line_id) SELECT '00000000-0000-0000-0000-0000000c0a03', id FROM cm_lines WHERE label='خط بدون مالكة';
INSERT INTO cm_messages (conversation_id, direction, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a03','in','wamid.3', cmt.ct('2026-10-27 10:00'));
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a03');
  ASSERT r.moderator_id = cmt.mid('soha') AND r.via='campaign', 'default campaign -> soha: '||coalesce(r.via,'?');
END $$;

-- 4) الحملة بلا خريطة → الحمل: في 10:00 يوم 27 نورا (1 مفتوحة) وسها (1) → الأقل ثم الترتيب = نورا
UPDATE cm_campaign_line_map SET valid_to='2026-10-02';
INSERT INTO cm_conversations (id) VALUES ('00000000-0000-0000-0000-0000000c0a04');
INSERT INTO cm_messages (conversation_id, direction, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a04','in','wamid.4', cmt.ct('2026-10-27 10:05'));
UPDATE cm_conversations SET status='closed' WHERE id='00000000-0000-0000-0000-0000000c0a01';
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a04');
  ASSERT r.via='load' AND r.moderator_id = cmt.mid('noura'), 'load fallback picks least loaded (noura 0 open after close)';
END $$;

-- 5) تأجيل 01:00–09:00: رسالة 03:00 يبدأ عدّها 09:00 وتوزَّع على شيفت 09:00 (نورا/سها)
INSERT INTO cm_conversations (id) VALUES ('00000000-0000-0000-0000-0000000c0a05');
INSERT INTO cm_messages (conversation_id, direction, provider_message_id, sent_at)
  VALUES ('00000000-0000-0000-0000-0000000c0a05','in','wamid.5', cmt.ct('2026-10-27 03:00'));
DO $$ DECLARE r record; BEGIN
  ASSERT (SELECT clock_started_at FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a05') = cmt.ct('2026-10-27 09:00'), 'deferred clock';
  ASSERT cm_clock_start(cmt.ct('2026-10-27 00:30')) = cmt.ct('2026-10-27 00:30'), '00:30 in window';
  ASSERT cm_service_minutes(cmt.ct('2026-10-27 00:30'), cmt.ct('2026-10-27 09:30')) = 60, 'service minutes skip night';
  ASSERT (SELECT count(*) FROM cm_on_shift_moderators(cmt.ct('2026-10-27 03:00'))) = 0, 'nobody on shift at 03:00';
  ASSERT (SELECT array_agg(moderator_id ORDER BY moderator_id) FROM cm_on_shift_moderators(cmt.ct('2026-10-28 00:30')))
         = ARRAY[cmt.mid('manal')], 'overnight shift belongs to start day';
  SELECT * INTO r FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a05');
  ASSERT r.via='load' AND r.moderator_id IN (cmt.mid('noura'), cmt.mid('soha')), 'deferred goes to 09:00 shift';
  ASSERT r.moderator_id = cmt.mid('soha'), 'soha lighter (noura has c0a04)';
END $$;
-- تأخر الرد الأول: في 09:20 (20 دقيقة > 15) → late + تغطية لنورا
DO $$ DECLARE r record; BEGIN
  SELECT * INTO r FROM cm_evaluate_first_reply('00000000-0000-0000-0000-0000000c0a05', cmt.ct('2026-10-27 09:20'));
  ASSERT r.status='late' AND r.target_min=15 AND r.elapsed_min=20, 'breach '||r.status||' '||r.elapsed_min;
  ASSERT r.cover_moderator_ids = ARRAY[cmt.mid('noura')], 'cover noura';
  SELECT * INTO r FROM cm_evaluate_first_reply('00000000-0000-0000-0000-0000000c0a05', cmt.ct('2026-10-27 09:10'));
  ASSERT r.status='pending', 'pending inside target';
END $$;

-- 6) round_robin يتناوب
UPDATE cm_distribution_settings SET method='round_robin', last_assigned_moderator_id=NULL;
INSERT INTO cm_conversations (id) VALUES ('00000000-0000-0000-0000-0000000c0a06'),('00000000-0000-0000-0000-0000000c0a07'),('00000000-0000-0000-0000-0000000c0a08');
DO $$ DECLARE a uuid; b uuid; c uuid; BEGIN
  SELECT moderator_id INTO a FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a06', cmt.ct('2026-10-27 10:00'));
  SELECT moderator_id INTO b FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a07', cmt.ct('2026-10-27 10:00'));
  SELECT moderator_id INTO c FROM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a08', cmt.ct('2026-10-27 10:00'));
  ASSERT a = cmt.mid('noura') AND b = cmt.mid('soha') AND c = cmt.mid('noura'), 'round robin';
END $$;

-- ── RLS ──
-- c1 = نورا (مودريتور)
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000c1'; SET request.jwt.claim.role='authenticated';
DO $$ DECLARE n int; BEGIN
  -- ترى: 01 (مالكة) 02 (مالكة) 04 (مسندة) 05 (تغطية) 06 08 (مسندة)؛ لا ترى 03 ولا 07
  ASSERT (SELECT array_agg(right(id::text,2) ORDER BY id) FROM cm_conversations) = ARRAY['01','02','04','05','06','08'],
    'moderator scope '||(SELECT array_agg(right(id::text,2) ORDER BY id) FROM cm_conversations)::text;
  ASSERT (SELECT count(*) FROM cm_messages WHERE conversation_id='00000000-0000-0000-0000-0000000c0a03') = 0, 'no foreign messages';
  ASSERT (SELECT count(*) FROM cm_messages WHERE conversation_id='00000000-0000-0000-0000-0000000c0a05') = 1, 'cover sees messages';
  ASSERT (SELECT count(*) FROM cm_phone_review_queue) = 0, 'moderator no review queue';
  UPDATE cm_conversations SET status='pending' WHERE id='00000000-0000-0000-0000-0000000c0a04';
  GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 1, 'moderator can change status';
  BEGIN UPDATE cm_conversations SET assigned_moderator_id = cmt.mid('aya') WHERE id='00000000-0000-0000-0000-0000000c0a04';
    RAISE EXCEPTION 'reassign allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO cm_conversation_assignments (conversation_id, moderator_id, method) VALUES ('00000000-0000-0000-0000-0000000c0a04', cmt.mid('noura'), 'manual');
    RAISE EXCEPTION 'assign insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_reassign_conversation('00000000-0000-0000-0000-0000000c0a03', cmt.mid('noura'));
    RAISE EXCEPTION 'reassign fn allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_distribute_conversation('00000000-0000-0000-0000-0000000c0a03');
    RAISE EXCEPTION 'distribute allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_merge_customers('00000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-00000000c001');
    RAISE EXCEPTION 'merge allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- رسالة صادرة باسمها في محادثتها: مسموح، وتسجّل أول رد
  INSERT INTO cm_messages (conversation_id, direction, body, sender_moderator_id, sent_via, sent_at, delivery_status)
    VALUES ('00000000-0000-0000-0000-0000000c0a04','out','أهلاً', cmt.mid('noura'),'api', cmt.ct('2026-10-27 10:10'),'sent');
  BEGIN INSERT INTO cm_messages (conversation_id, direction, sender_moderator_id) VALUES ('00000000-0000-0000-0000-0000000c0a03','out', cmt.mid('noura'));
    RAISE EXCEPTION 'foreign insert allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO cm_messages (conversation_id, direction, sender_moderator_id) VALUES ('00000000-0000-0000-0000-0000000c0a04','out', cmt.mid('aya'));
    RAISE EXCEPTION 'impersonation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;
DO $$ DECLARE r record; BEGIN
  ASSERT (SELECT first_reply_at FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a04') = cmt.ct('2026-10-27 10:10'), 'first reply set';
  ASSERT (SELECT NOT first_reply_was_cover FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a04'), 'not cover';
  SELECT * INTO r FROM cm_evaluate_first_reply('00000000-0000-0000-0000-0000000c0a04');
  ASSERT r.status='on_time' AND r.elapsed_min=5, 'on time '||r.status;
END $$;

-- viewer d1 / social f1 / EM b1: يرون الكل، لا يعدّلون
DO $$ DECLARE u text; n int; BEGIN
  FOREACH u IN ARRAY ARRAY['d1','f1','b1','a2'] LOOP
    PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000'||u, false);
    SET LOCAL ROLE authenticated;
    ASSERT (SELECT count(*) FROM cm_conversations) = 8, u||' sees all';
    UPDATE cm_conversations SET status='spam'; GET DIAGNOSTICS n = ROW_COUNT; ASSERT n = 0, u||' cannot update';
    BEGIN INSERT INTO cm_conversation_assignments (conversation_id, moderator_id, method) VALUES ('00000000-0000-0000-0000-0000000c0a03', cmt.mid('aya'), 'manual');
      RAISE EXCEPTION '% assign allowed', u; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RESET ROLE;
  END LOOP;
END $$;
DO $$ BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false); SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM cm_phone_review_queue) = 0, 'viewer no queue';
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false); SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM cm_phone_review_queue) = 3, 'MSM reads queue';
  INSERT INTO cm_campaigns (name, meta_campaign_id) VALUES ('لحوم 2', 'c-123');
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false); SET LOCAL ROLE authenticated;
  ASSERT (SELECT count(*) FROM cm_conversations) = 0 AND (SELECT count(*) FROM cm_messages) = 0, 'accountant sees nothing';
  RESET ROLE;
END $$;

-- SM a1: لا يضيف حملة، يعيد الإسناد، يدمج ويتراجع
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
DO $$ DECLARE m uuid; BEGIN
  BEGIN INSERT INTO cm_campaigns (name) VALUES ('x'); RAISE EXCEPTION 'SM campaign insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM cm_reassign_conversation('00000000-0000-0000-0000-0000000c0a03', cmt.mid('aya'), 'تحويل');
  ASSERT (SELECT assigned_moderator_id FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a03') = cmt.mid('aya'), 'SM reassign';
  ASSERT (SELECT count(*) FROM cm_conversation_assignments WHERE conversation_id='00000000-0000-0000-0000-0000000c0a03') = 2
     AND (SELECT count(*) FROM cm_conversation_assignments WHERE conversation_id='00000000-0000-0000-0000-0000000c0a03' AND ended_at IS NULL) = 1, 'history kept';
  UPDATE cm_conversations SET customer_id='00000000-0000-0000-0000-00000000c001' WHERE id='00000000-0000-0000-0000-0000000c0a01';
  m := cm_merge_customers('00000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-00000000c001', 'نفس الرقم',
        (SELECT id FROM cm_phone_review_queue WHERE issue='multi_customer'));
  ASSERT (SELECT count(*) FROM cm_contact_phones WHERE customer_id='00000000-0000-0000-0000-00000000c001') = 0, 'phones moved';
  ASSERT (SELECT customer_id FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a01') = '00000000-0000-0000-0000-00000000c002', 'conv moved';
  ASSERT (SELECT status FROM cm_phone_review_queue WHERE issue='multi_customer') = 'resolved', 'queue resolved';
  BEGIN PERFORM cm_merge_customers('00000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-00000000c001');
    RAISE EXCEPTION 'double merge'; EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'CM_MERGE_ALREADY_MERGED' THEN RAISE; END IF; END;
  PERFORM cm_undo_merge(m);
  ASSERT (SELECT count(*) FROM cm_contact_phones WHERE customer_id='00000000-0000-0000-0000-00000000c001') = 1, 'undo phones';
  ASSERT (SELECT customer_id FROM cm_conversations WHERE id='00000000-0000-0000-0000-0000000c0a01') = '00000000-0000-0000-0000-00000000c001', 'undo conv';
  ASSERT (SELECT status FROM cm_phone_review_queue WHERE issue='multi_customer') = 'open', 'queue reopened';
  -- دمج عكسي: صاحب أحدث طلب (c002) هو المدموج → البحث بالرقم يجب أن يرجع الباقي c001
  m := cm_merge_customers('00000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000c002');
  PERFORM cm_sync_customer_phones();  -- إعادة المزامنة بعد الدمج لا تعيد ربط الرقم بالعميل المدموج
  ASSERT cm_customer_for_phone('01000000001') = '00000000-0000-0000-0000-00000000c001', 'lookup skips merged customer';
  PERFORM cm_undo_merge(m);
  ASSERT cm_customer_for_phone('01000000001') = '00000000-0000-0000-0000-00000000c002', 'lookup restored after undo';
END $$;
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE entity='cm_customer_merges') >= 2, 'merge audited';
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE entity='cm_conversation_assignments') >= 1, 'assignment audited';
  ASSERT (SELECT count(*) FROM customers) = 5, 'customers untouched';
END $$;

-- GM a3: إعادة إسناد؛ والإسناد الإعلاني
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a3';
DO $$ BEGIN
  PERFORM cm_reassign_conversation('00000000-0000-0000-0000-0000000c0a07', cmt.mid('noura'));
  INSERT INTO cm_campaign_ads (campaign_id, meta_ad_id) SELECT id, 'ad-9' FROM cm_campaigns WHERE meta_campaign_id='c-123';
  ASSERT cm_attribute_conversation('00000000-0000-0000-0000-0000000c0a06', _ctwa_clid => 'clid-x', _referral_source_id => 'ad-9') = 'ctwa_clid', 'ctwa first';
  ASSERT (SELECT c.meta_campaign_id FROM cm_conversations v JOIN cm_campaigns c ON c.id=v.campaign_id WHERE v.id='00000000-0000-0000-0000-0000000c0a06') = 'c-123', 'campaign via ad';
  ASSERT cm_attribute_conversation('00000000-0000-0000-0000-0000000c0a07', _referral_source_id => 'ad-unknown') = 'referral', 'referral';
  ASSERT cm_attribute_conversation('00000000-0000-0000-0000-0000000c0a08', _manual_value => 'فيسبوك') = 'manual', 'manual';
  ASSERT cm_attribute_conversation('00000000-0000-0000-0000-0000000c0a05') = 'unknown', 'unknown';
END $$;
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;
SELECT 'ALL CM STEP2 SQL TESTS PASSED';
