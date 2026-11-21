\set ON_ERROR_STOP on
-- اختبارات الخطوة 3 (محلي فقط): استقبال الـ webhook في قاعدة البيانات + التغطية اليدوية. يُشغَّل بعد cm_step2_test.sql.
-- كل الأرقام هنا وهمية.
UPDATE cm_lines SET external_id = 'PNID-TEST-1' WHERE label = 'خط مودريتور 1';

-- 1) رسالة جديدة داخل النافذة: جهة اتصال + محادثة + توزيع لصاحبة الخط + ربط العميل بالرقم المطبَّع
DO $$ DECLARE r jsonb; v_conv uuid; BEGIN
  r := cm_ingest_whatsapp_message('PNID-TEST-1', '201000000001', 'عميل تجريبي', 'wamid.s3.1', cmt.ct('2026-10-27 11:30'),
                                  'text', 'السلام عليكم', NULL, 'clid-s3', 'ad-9', 'ad', 'عنوان');
  v_conv := (r->>'conversation_id')::uuid;
  ASSERT (r->>'duplicate')::boolean = false AND (r->>'new_conversation')::boolean, 'new conv '||r;
  ASSERT (r->>'assigned_moderator_id')::uuid = cmt.mid('noura') AND r->>'via' = 'line_owner', 'line owner '||r;
  ASSERT (r->>'deferred')::boolean = false, 'not deferred';
  ASSERT (SELECT phone_norm FROM cm_conversations WHERE id = v_conv) = '01000000001', 'normalized phone';
  ASSERT (SELECT customer_id FROM cm_conversations WHERE id = v_conv) = cm_customer_for_phone('01000000001'), 'customer linked';
  ASSERT (SELECT method FROM cm_ad_attributions WHERE conversation_id = v_conv) = 'ctwa_clid', 'ctwa first';
  -- 2) نفس الرسالة مرة ثانية (إعادة إرسال ميتا): لا تكرار ولا توزيع جديد
  r := cm_ingest_whatsapp_message('PNID-TEST-1', '201000000001', 'عميل تجريبي', 'wamid.s3.1', cmt.ct('2026-10-27 11:30'));
  ASSERT (r->>'duplicate')::boolean, 'duplicate flagged';
  ASSERT (SELECT count(*) FROM cm_messages WHERE provider_message_id = 'wamid.s3.1') = 1, 'one message';
  ASSERT (SELECT count(*) FROM cm_conversation_assignments WHERE conversation_id = v_conv AND kind = 'primary') = 1, 'one assignment';
  -- 3) رسالة تالية من نفس العميل: نفس المحادثة، بلا إعادة توزيع
  r := cm_ingest_whatsapp_message('PNID-TEST-1', '201000000001', NULL, 'wamid.s3.2', cmt.ct('2026-10-27 11:35'));
  ASSERT (r->>'conversation_id')::uuid = v_conv AND NOT (r->>'new_conversation')::boolean, 'same thread';
  ASSERT (SELECT count(*) FROM cm_contacts WHERE wa_id = '201000000001') = 1, 'one contact';
END $$;

-- 4) رسالة 03:00 ← العداد يبدأ 09:00؛ referral عند غياب ctwa_clid
DO $$ DECLARE r jsonb; BEGIN
  r := cm_ingest_whatsapp_message('PNID-TEST-1', '201000000002', NULL, 'wamid.s3.3', cmt.ct('2026-10-28 03:00'),
                                  'text', 'متاح؟', NULL, NULL, 'ad-unknown', 'ad', NULL);
  ASSERT (r->>'deferred')::boolean, 'deferred '||r;
  ASSERT (r->>'clock_started_at')::timestamptz = cmt.ct('2026-10-28 09:00'), 'clock 09:00';
  ASSERT (SELECT method FROM cm_ad_attributions WHERE conversation_id = (r->>'conversation_id')::uuid) = 'referral', 'referral';
END $$;

-- 5) خط غير معروف: تُحفظ الرسالة ولا تضيع (توزيع حسب الإعدادات)
DO $$ DECLARE r jsonb; BEGIN
  r := cm_ingest_whatsapp_message('PNID-UNKNOWN', '201000000003', NULL, 'wamid.s3.4', cmt.ct('2026-10-27 12:00'));
  ASSERT (SELECT line_id FROM cm_conversations WHERE id = (r->>'conversation_id')::uuid) IS NULL, 'no line';
  ASSERT (SELECT count(*) FROM cm_messages WHERE provider_message_id = 'wamid.s3.4') = 1, 'stored';
END $$;

-- 6) مستخدم مسجّل (حتى المدير العام) لا يستدعي دالة الـ webhook؛ والمودريتور لا تضيف تغطية
SET ROLE authenticated; SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3'; SET request.jwt.claim.role = 'authenticated';
DO $$ BEGIN
  BEGIN
    PERFORM cm_ingest_whatsapp_message('PNID-TEST-1', '201000000001', NULL, 'wamid.s3.x', now());
    ASSERT false, 'authenticated must not ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
DO $$ BEGIN
  BEGIN
    PERFORM cm_set_cover((SELECT id FROM cm_conversations WHERE external_thread_id LIKE 'wa:PNID-TEST-1:201000000001'), cmt.mid('aya'));
    ASSERT false, 'moderator must not cover';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- مديرة المبيعات: تغطية ثم إلغاؤها
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
DO $$ DECLARE v uuid := (SELECT id FROM cm_conversations WHERE external_thread_id = 'wa:PNID-TEST-1:201000000001'); BEGIN
  PERFORM cm_set_cover(v, cmt.mid('aya'));
  PERFORM cm_set_cover(v, cmt.mid('aya'));
  ASSERT (SELECT count(*) FROM cm_conversation_assignments WHERE conversation_id = v AND kind='cover' AND ended_at IS NULL
          AND moderator_id = cmt.mid('aya')) = 1, 'cover once';
  PERFORM cm_set_cover(v, cmt.mid('aya'), false);
  ASSERT NOT EXISTS (SELECT 1 FROM cm_conversation_assignments WHERE conversation_id = v AND kind='cover' AND ended_at IS NULL
          AND moderator_id = cmt.mid('aya')), 'cover ended';
END $$;
RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;
-- anon لا ينفّذ
DO $$ BEGIN
  ASSERT NOT has_function_privilege('anon', 'public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text)', 'EXECUTE'), 'anon ingest';
  ASSERT NOT has_function_privilege('authenticated', 'public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text)', 'EXECUTE'), 'auth ingest';
  ASSERT has_function_privilege('service_role', 'public.cm_ingest_whatsapp_message(text,text,text,text,timestamptz,text,text,jsonb,text,text,text,text)', 'EXECUTE'), 'service ingest';
END $$;
SELECT 'ALL CM STEP3 SQL TESTS PASSED';
