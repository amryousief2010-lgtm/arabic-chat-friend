\set ON_ERROR_STOP on
-- اختبارات الخطوة 4 (محلي فقط): الإنفاق، CDR، التسجيلات، ربط الطلبات، ومؤشرات الأداء على بيانات وهمية.
-- كل الأرقام وهمية (نمط 0100000000x). اليوم المرجعي 2026-09-01 (في الماضي حتى تُحسب «بلا رد» متأخرة) بتوقيت القاهرة.
CREATE TEMP TABLE ids (k text PRIMARY KEY, v uuid);
GRANT SELECT ON ids TO authenticated;
CREATE OR REPLACE FUNCTION cmt.id(_k text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT v FROM pg_temp.ids WHERE k = _k $$;

-- ── التجهيز (كمستخدم النظام) ──
DO $$ DECLARE a uuid; b uuid; x uuid; y uuid; z uuid; c uuid; o uuid; i int; BEGIN
  INSERT INTO cm_campaigns (name) VALUES ('حملة أ - اختبار') RETURNING id INTO a;
  INSERT INTO cm_campaigns (name, meta_campaign_id) VALUES ('حملة ب - اختبار', 'META-TEST-B') RETURNING id INTO b;
  INSERT INTO ids VALUES ('A', a), ('B', b);
  INSERT INTO customers (id, name, phone) VALUES (gen_random_uuid(), 'عميل س4-1', '01000000007') RETURNING id INTO x;
  INSERT INTO customers (id, name, phone) VALUES (gen_random_uuid(), 'عميل س4-2', '01000000008') RETURNING id INTO y;
  INSERT INTO customers (id, name, phone, phone2) VALUES (gen_random_uuid(), 'عميل س4-3', '01000000009', '+20 100 000 0006') RETURNING id INTO z;
  INSERT INTO ids VALUES ('X', x), ('Y', y), ('Z', z);
  PERFORM cm_sync_customer_phones();
  -- c1 نورا/أ: رد بعد 5 د ← في الوقت | c2 أية/أ: رد بعد 90 د ← متأخر | c3 نورا/ب: تغطية | c4 نورا/ب: بلا رد ← متأخر + متروكة
  FOR i IN 1..4 LOOP
    INSERT INTO cm_conversations (phone_norm, customer_id, assigned_moderator_id, status, first_inbound_at, clock_started_at,
                                  last_inbound_at, first_reply_at, last_outbound_at, first_reply_was_cover)
    VALUES (CASE i WHEN 1 THEN '01000000007' WHEN 2 THEN '01000000008' ELSE '01000000006' END,
            CASE i WHEN 1 THEN x WHEN 2 THEN y ELSE z END,
            cmt.mid(CASE i WHEN 2 THEN 'aya' ELSE 'noura' END), CASE i WHEN 4 THEN 'open' ELSE 'closed' END,
            cmt.ct('2026-09-01 10:00'), cmt.ct('2026-09-01 10:00'), cmt.ct('2026-09-01 10:00'),
            CASE i WHEN 1 THEN cmt.ct('2026-09-01 10:05') WHEN 2 THEN cmt.ct('2026-09-01 11:30') WHEN 3 THEN cmt.ct('2026-09-01 10:20') END,
            CASE i WHEN 1 THEN cmt.ct('2026-09-01 10:05') WHEN 2 THEN cmt.ct('2026-09-01 11:30') WHEN 3 THEN cmt.ct('2026-09-01 10:20') END,
            i = 3) RETURNING id INTO c;
    INSERT INTO ids VALUES ('c'||i, c);
    INSERT INTO cm_ad_attributions (conversation_id, campaign_id, method) VALUES (c, CASE WHEN i <= 2 THEN a ELSE b END, 'manual');
  END LOOP;
  -- o1 مُسلَّم (إجمالي 100، قيمة عند التسليم 90 تُتجاهل) خلال 7 أيام | o2 ملغي | o3 مُسلَّم بعد 8 أيام (خارج نافذة التحويل)
  INSERT INTO orders (customer_id, moderator_id, total, total_at_delivery, status, created_at)
    VALUES (x, cmt.mid('noura'), 100, 90, 'delivered', cmt.ct('2026-09-02 12:00')) RETURNING id INTO o; INSERT INTO ids VALUES ('o1', o);
  INSERT INTO orders (customer_id, moderator_id, total, status, created_at)
    VALUES (y, cmt.mid('aya'), 50, 'cancelled', cmt.ct('2026-09-01 13:00')) RETURNING id INTO o; INSERT INTO ids VALUES ('o2', o);
  INSERT INTO orders (customer_id, moderator_id, total, status, created_at)
    VALUES (z, cmt.mid('noura'), 200, 'collected', cmt.ct('2026-09-09 12:00')) RETURNING id INTO o; INSERT INTO ids VALUES ('o3', o);
  INSERT INTO orders (customer_id, total, status, created_at) VALUES (y, 10, 'delivered', cmt.ct('2026-09-01 15:00')) RETURNING id INTO o;
  INSERT INTO ids VALUES ('o4', o);
END $$;

-- ── 1) ربط المحادثة بالطلب: بالتطابق فقط، لا دمج ──
DO $$ DECLARE n_cust bigint := (SELECT count(*) FROM customers); BEGIN
  PERFORM cm_link_conversation_order(cmt.id('c1'), cmt.id('o1'));
  PERFORM cm_link_conversation_order(cmt.id('c1'), cmt.id('o1'));           -- مكرر: بلا صف جديد
  PERFORM cm_link_conversation_order(cmt.id('c2'), cmt.id('o2'));
  PERFORM cm_link_conversation_order(cmt.id('c3'), cmt.id('o3'));           -- تطابق عبر phone2 المطبَّع
  ASSERT (SELECT count(*) FROM cm_conversation_orders WHERE conversation_id = cmt.id('c1')) = 1, 'link idempotent';
  ASSERT (SELECT method FROM cm_conversation_orders WHERE order_id = cmt.id('o3')) = 'phone_match', 'phone2 match';
  BEGIN PERFORM cm_link_conversation_order(cmt.id('c1'), cmt.id('o2')); ASSERT false, 'mismatch must fail';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (SELECT count(*) FROM customers) = n_cust, 'no customer merge/creation';
  ASSERT (SELECT count(*) FROM cm_suggest_conversation_orders(cmt.id('c2'))) = 2, 'suggest o2 + o4 for same phone';
END $$;

-- ── 2) الإنفاق: upsert + الرفض ──
DO $$ DECLARE r jsonb; BEGIN
  r := cm_upsert_ad_spend(jsonb_build_array(
    jsonb_build_object('campaign_id', cmt.id('A'), 'spend_date', '2026-09-01', 'spend', 100, 'impressions', 1000, 'clicks', 40),
    jsonb_build_object('campaign_id', cmt.id('A'), 'spend_date', '2026-09-02', 'spend', '50.004'),
    jsonb_build_object('meta_campaign_id', 'META-TEST-B', 'spend_date', '2026-09-01', 'spend', 60),
    jsonb_build_object('campaign_name', 'غير موجودة', 'spend_date', '2026-09-01', 'spend', 1),
    jsonb_build_object('campaign_id', cmt.id('A'), 'spend_date', 'x', 'spend', 1),
    jsonb_build_object('campaign_id', cmt.id('A'), 'spend_date', '2026-09-03', 'spend', -5)));
  ASSERT (r->>'inserted')::int = 3 AND (r->>'updated')::int = 0 AND jsonb_array_length(r->'rejected') = 3, 'spend first '||r;
  r := cm_upsert_ad_spend(jsonb_build_array(jsonb_build_object('campaign_id', cmt.id('A'), 'spend_date', '2026-09-01', 'spend', 120)));
  ASSERT (r->>'inserted')::int = 0 AND (r->>'updated')::int = 1, 'upsert updates '||r;
  ASSERT (SELECT spend FROM cm_ad_spend_daily WHERE campaign_id = cmt.id('A') AND spend_date = '2026-09-01') = 120, 'new spend';
  ASSERT (SELECT impressions FROM cm_ad_spend_daily WHERE campaign_id = cmt.id('A') AND spend_date = '2026-09-01') = 1000, 'keeps impressions';
  ASSERT (SELECT spend FROM cm_ad_spend_daily WHERE campaign_id = cmt.id('A') AND spend_date = '2026-09-02') = 50.00, 'rounded';
  ASSERT (SELECT count(*) FROM cm_ad_spend_daily WHERE campaign_id IN (cmt.id('A'), cmt.id('B'))) = 3, 'unique per campaign+date';
  BEGIN INSERT INTO cm_ad_spend_daily (campaign_id, spend_date, spend) VALUES (cmt.id('A'), '2026-09-01', 1); ASSERT false, 'dup';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN INSERT INTO cm_ad_spend_daily (campaign_id, spend_date, spend, source) VALUES (cmt.id('A'), '2026-09-05', 1, 'csv'); ASSERT false, 'src';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ── 3) استيراد CDR بصيغة البوابة (CDR.csv + Switched.csv) — أرقام وهمية فقط ──
INSERT INTO cm_hotline_usernames (username, moderator_id) VALUES ('noura', cmt.mid('noura'));
DO $$ DECLARE r jsonb; rows jsonb;
  att_missed jsonb := '[{"username":"Noura","switch_time":"2026-09-01T12:00:05+03:00","switching_status":"MISSED","call_status":"SWITCHED_REJECTED"}]';
BEGIN
  rows := jsonb_build_array(
    jsonb_build_object('cdr_id','CDR.260901.120000.0000001','a_number','+20 100 000 0007','b_number','0220000000','call_record','',
                       'start_time','01-09-2026 12:00:00','end_time','01-09-2026 12:00:40','call_result','ANSWERED','call_duration','00:00:00',
                       'call_direction','INBOUND','attempts', att_missed),
    jsonb_build_object('cdr_id','CDR.260901.124000.0000002','a_number','0220000000','b_number','01000000007','call_record','CDR.260901.124000.0000002',
                       'start_time','01-09-2026 12:40:00','call_result','ANSWERED','call_duration','00:01:35','call_direction','OUTBOUND',
                       'attempts','[{"username":"noura","switch_time":"2026-09-01T12:40:00+03:00","switching_status":"ACCEPTED","call_status":"SWITCHED_ACCEPTED"}]'::jsonb),
    jsonb_build_object('cdr_id','CDR.260901.120000.0000003','a_number','01000000008','b_number','0220000000',
                       'start_time','01-09-2026 12:00:00','call_result','ABANDONED','call_duration','00:00:00','call_direction','INBOUND',
                       'attempts','[{"username":"aya1","switch_time":"2026-09-01T12:00:03+03:00","switching_status":"MISSED","call_status":"SWITCHED_REJECTED"}]'::jsonb),
    jsonb_build_object('cdr_id','CDR.260901.130000.0000004','a_number','01000000008','b_number','0220000000',
                       'start_time','01-09-2026 13:00:00','call_result','XFER_NEW_VALUE','call_duration','00:02:00','call_direction','INBOUND',
                       'attempts','[{"username":"aya1","switch_time":"2026-09-01T13:00:02+03:00","switching_status":"MISSED"},{"username":"noura","switch_time":"2026-09-01T13:00:20+03:00","switching_status":"ACCEPTED","call_status":"SWITCHED_ACCEPTED"}]'::jsonb),
    jsonb_build_object('cdr_id','CDR.260901.120000.0000005','a_number','12345','start_time','01-09-2026 12:00:00','call_direction','INBOUND'),
    jsonb_build_object('cdr_id','CDR.260901.120000.0000006','a_number','01000000008','start_time','01-09-2026 12:00:00','call_direction','SIDEWAYS'),
    jsonb_build_object('a_number','01000000008','start_time','01-09-2026 12:00:00','call_direction','INBOUND'),
    jsonb_build_object('cdr_id','CDR.260901.120000.0000001','a_number','01000000008','start_time','01-09-2026 12:00:00','call_direction','INBOUND'),
    jsonb_build_object('cdr_id','CDR.260901.120000.0000009','a_number','01000000008','start_time','2026/09/01 12:00','call_direction','INBOUND'));
  r := cm_import_hotline_cdr(rows);
  ASSERT (r->>'inserted')::int = 4 AND (r->>'updated')::int = 0 AND jsonb_array_length(r->'rejected') = 5, 'cdr first '||r;
  ASSERT r->'rejected' @> '[{"row":5,"reason":"bad_phone"},{"row":6,"reason":"bad_direction"},{"row":7,"reason":"missing_id"},{"row":8,"reason":"duplicate_in_file"},{"row":9,"reason":"bad_started_at"}]', 'reasons '||r;
  ASSERT r->'unknown_results' = '["XFER_NEW_VALUE"]' AND r->'unmapped_usernames' = '["aya1"]', 'surfaced '||r;
  r := cm_import_hotline_cdr(rows);
  ASSERT (r->>'inserted')::int = 0 AND (r->>'updated')::int = 0 AND (r->>'unchanged')::int = 4, 'cdr re-import '||r;
  -- مزامنة لاحقة بنفس Cdr Id ببيانات أحدث ⇒ تحديث لا تكرار
  rows := jsonb_set(rows, '{3,call_duration}', '"00:03:00"');
  r := cm_import_hotline_cdr(rows);
  ASSERT (r->>'updated')::int = 1 AND (r->>'unchanged')::int = 3, 'cdr resync '||r;
  ASSERT (SELECT count(*) FROM cm_calls WHERE external_call_id LIKE 'CDR.2609%') = 4, 'no dup calls';
  ASSERT (SELECT duration_sec FROM cm_calls WHERE external_call_id = 'CDR.260901.130000.0000004') = 180, 'resync dur';
  ASSERT (SELECT started_at FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001') = '2026-09-01 12:00:00+03', 'cairo local time';
  ASSERT (SELECT status FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001') = 'missed', 'no ACCEPTED ⇒ missed (even if result ANSWERED)';
  ASSERT (SELECT status||'/'||moderator_id FROM cm_calls WHERE external_call_id = 'CDR.260901.130000.0000004') = 'answered/'||cmt.mid('noura'), 'accepted attempt wins';
  ASSERT (SELECT status FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002') = 'answered', 'outbound answered';
  ASSERT (SELECT duration_sec FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002') = 95, 'HH:MM:SS';
  ASSERT (SELECT has_vendor_recording FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002'), 'call record flag';
  ASSERT (SELECT phone_norm FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001') = '01000000007', 'normalized A number';
  ASSERT (SELECT phone_norm FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002') = '01000000007', 'outbound uses B number';
  ASSERT (SELECT customer_id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001') = cmt.id('X'), 'customer linked by phone';
  ASSERT (SELECT moderator_id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001') = cmt.mid('noura'), 'username case-insensitive';
  ASSERT (SELECT moderator_id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003') IS NULL, 'unmapped ⇒ null';
END $$;
-- ربط aya1 لاحقاً يعيد نسب مكالماتها
INSERT INTO cm_hotline_usernames (username, moderator_id) VALUES ('aya1', cmt.mid('aya'));
DO $$ BEGIN
  ASSERT (SELECT moderator_id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003') = cmt.mid('aya'), 'reattributed';
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE entity = 'cm_hotline_usernames' AND action = 'insert') = 2, 'mapping audited';
  UPDATE cm_calls SET recording_path = 'calls/2026/12/CDR-T-2.mp3' WHERE external_call_id = 'CDR.260901.124000.0000002';
  BEGIN UPDATE cm_calls SET recording_path = 'https://x.example/a' WHERE external_call_id = 'CDR.260901.124000.0000002'; ASSERT false, 'url stored';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- رسالة صادرة لاحقة لعميل c2 بعد ساعتين: لا تُحسب متابعة خلال ساعة
  INSERT INTO cm_messages (conversation_id, direction, sent_at) VALUES (cmt.id('c2'), 'out', cmt.ct('2026-09-01 15:00'));
END $$;

-- ── 4) مؤشرات الأداء (كمستخدم النظام) ──
DO $$ DECLARE r record; BEGIN
  ASSERT (SELECT first_reply_status FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c1')) = 'on_time', 'c1 on_time';
  ASSERT (SELECT first_reply_status FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c2')) = 'late', 'c2 late';
  ASSERT (SELECT first_reply_status FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c3')) = 'cover', 'c3 cover';
  ASSERT (SELECT first_reply_status FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c4')) = 'late', 'c4 late';
  ASSERT (SELECT is_abandoned FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c4')), 'c4 abandoned';
  ASSERT NOT (SELECT is_abandoned FROM cm_kpi_conversations_v WHERE conversation_id = cmt.id('c1')), 'c1 not abandoned';
  ASSERT cm_first_reply_kpi_status(cmt.ct('2026-09-01 10:00'), NULL, false, NULL, cmt.ct('2026-09-01 10:10')) = 'pending', 'pending';
  ASSERT cm_first_reply_kpi_status(cmt.ct('2026-09-01 00:50'), cmt.ct('2026-09-01 09:30'), false, NULL) = 'on_time', 'outside window does not count';
  ASSERT (SELECT array_agg(conversation_id ORDER BY first_inbound_at) FROM cm_kpi_conversations_v WHERE converted_in_window
          AND conversation_id IN (cmt.id('c1'), cmt.id('c2'), cmt.id('c3'), cmt.id('c4'))) = ARRAY[cmt.id('c1')], 'only c1 converted';
  ASSERT (SELECT followed_within_target FROM cm_kpi_missed_calls_v v JOIN cm_calls c ON c.id = v.call_id WHERE external_call_id = 'CDR.260901.120000.0000001'), 'callback 40m';
  ASSERT NOT (SELECT followed_within_target FROM cm_kpi_missed_calls_v v JOIN cm_calls c ON c.id = v.call_id WHERE external_call_id = 'CDR.260901.120000.0000003'), 'msg after 2h';

  SELECT * INTO r FROM cm_kpi_by_campaign('2026-09-01', '2026-09-10') WHERE campaign_id = cmt.id('A');
  ASSERT r.spend = 170 AND r.conversations = 2 AND r.converted = 1 AND r.orders = 2 AND r.delivered = 1 AND r.resolved = 2
         AND r.delivered_value = 100 AND r.cost_per_delivered = 170, 'campaign A '||row_to_json(r);
  SELECT * INTO r FROM cm_kpi_by_campaign('2026-09-01', '2026-09-10') WHERE campaign_id = cmt.id('B');
  ASSERT r.spend = 60 AND r.conversations = 2 AND r.converted = 0 AND r.delivered = 1 AND r.delivered_value = 200
         AND r.cost_per_delivered = 60, 'campaign B '||row_to_json(r);
  SELECT * INTO r FROM cm_kpi_by_campaign('2026-09-02', '2026-09-02') WHERE campaign_id = cmt.id('A');
  ASSERT r.spend = 50 AND r.conversations = 0 AND r.delivered = 1, 'date filter '||row_to_json(r);

  SELECT * INTO r FROM cm_kpi_by_moderator('2026-09-01', '2026-09-10') WHERE moderator_id = cmt.mid('noura');
  ASSERT r.conversations = 3 AND r.on_time = 1 AND r.cover = 1 AND r.late = 1 AND r.abandoned = 1 AND r.converted = 1
         AND r.missed_calls = 1 AND r.missed_followed = 1 AND r.orders = 2 AND r.delivered = 2 AND r.delivered_value = 300
         AND r.allocated_spend = 145 AND r.cost_per_delivered = 72.50, 'noura '||row_to_json(r);
  SELECT * INTO r FROM cm_kpi_by_moderator('2026-09-01', '2026-09-10') WHERE moderator_id = cmt.mid('aya');
  ASSERT r.conversations = 1 AND r.late = 1 AND r.missed_calls = 1 AND r.missed_followed = 0 AND r.orders = 1 AND r.delivered = 0
         AND r.resolved = 1 AND r.allocated_spend = 85 AND r.cost_per_delivered IS NULL, 'aya '||row_to_json(r);

  -- إلغاء بأثر رجعي: يظهر فوراً (لا لقطات مخزنة)
  UPDATE orders SET status = 'cancelled' WHERE id = cmt.id('o1');
  SELECT * INTO r FROM cm_kpi_by_campaign('2026-09-01', '2026-09-10') WHERE campaign_id = cmt.id('A');
  ASSERT r.delivered = 0 AND r.converted = 0 AND r.cost_per_delivered IS NULL AND r.delivered_value = 0, 'retro cancel '||row_to_json(r);
  UPDATE orders SET status = 'delivered' WHERE id = cmt.id('o1');
  ASSERT cm_order_is_delivered(' Delivered ') AND cm_order_is_delivered('completed') AND NOT cm_order_is_delivered('shipped')
     AND cm_order_is_resolved('fully_returned') AND NOT cm_order_is_resolved('processing'), 'status sets';
END $$;

-- ── 5) الصلاحيات حسب الدور ──
-- مسؤولة تسويق ومبيعات (MSM): تكتب الإنفاق، لا تستورد CDR، لا تسمع التسجيلات
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', false);
DO $$ DECLARE r jsonb; BEGIN
  r := cm_upsert_ad_spend(jsonb_build_array(jsonb_build_object('campaign_id', cmt.id('B'), 'spend_date', '2026-09-02', 'spend', 5)));
  ASSERT (r->>'inserted')::int = 1, 'msm writes spend';
  BEGIN PERFORM cm_upsert_ad_spend('[]'::jsonb, 'marketing_api'); ASSERT false, 'api source service only';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_import_hotline_cdr('[]'::jsonb); ASSERT false, 'msm import';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002')); ASSERT false, 'msm listen';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT count(*) FROM cm_calls WHERE external_call_id LIKE 'CDR.2609%') = 4, 'msm reads calls';
  ASSERT (SELECT spend FROM cm_kpi_by_campaign('2026-09-01','2026-09-10') WHERE campaign_id = cmt.id('A')) = 170, 'msm kpi';
END $$;
RESET ROLE;
-- المودريتور (نورا): لا ترى الإنفاق، ترى مكالماتها فقط، لا تكتب الإنفاق ولا تستورد ولا تسمع
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_ad_spend_daily) = 0, 'mod no spend rows';
  ASSERT (SELECT count(*) FROM cm_calls) = 3, 'mod own calls only (noura: 1,2,4)';
  BEGIN PERFORM cm_upsert_ad_spend('[]'::jsonb); ASSERT false, 'mod spend'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN INSERT INTO cm_ad_spend_daily (campaign_id, spend_date, spend) VALUES (cmt.id('A'), '2026-09-09', 1); ASSERT false, 'mod direct';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_import_hotline_cdr('[]'::jsonb); ASSERT false, 'mod import'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002')); ASSERT false, 'mod listen';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_link_conversation_order(cmt.id('c1'), cmt.id('o4'), true); ASSERT false, 'mod manual link';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN INSERT INTO cm_conversation_orders (conversation_id, order_id, method) VALUES (cmt.id('c1'), cmt.id('o4'), 'manual'); ASSERT false, 'mod direct link';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM cm_mark_missed_call_followed_up((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001'));
  BEGIN PERFORM cm_mark_missed_call_followed_up((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003' UNION ALL SELECT NULL LIMIT 1));
    ASSERT false, 'mod marks other call'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT (SELECT spend FROM cm_kpi_by_campaign('2026-09-01','2026-09-10') WHERE campaign_id = cmt.id('A')) = 0, 'mod kpi sees no spend';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT followed_up_at IS NOT NULL FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001'), 'mod marked own';
  ASSERT (SELECT followed_up_at IS NULL FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003'), 'other untouched';
END $$;
-- المشاهِدة (viewer): قراءة فقط
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_ad_spend_daily) >= 4, 'viewer reads spend';
  BEGIN PERFORM cm_upsert_ad_spend('[]'::jsonb); ASSERT false, 'viewer spend'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE cm_ad_spend_daily SET spend = 0; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002')); ASSERT false, 'viewer listen';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN ASSERT (SELECT sum(spend) FROM cm_ad_spend_daily) > 0, 'viewer update had no effect'; END $$;
-- المحاسب: لا شيء في الوحدة
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_ad_spend_daily) = 0 AND (SELECT count(*) FROM cm_calls) = 0, 'accountant sees nothing';
  ASSERT (SELECT count(*) FROM cm_kpi_conversations_v) = 0, 'accountant kpi empty';
  BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls LIMIT 1)); ASSERT false, 'acct listen';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- ── 6) التسجيلات: SM يسمع ← سجل + طلب رابط (بدون رابط مخزن)؛ Storage يقرأ فقط بعد السجل ──
INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', 'calls/2026/12/CDR-T-2.mp3');
DO $$ BEGIN ASSERT (SELECT NOT public FROM storage.buckets WHERE id = 'cm-call-recordings'), 'bucket private'; END $$;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ DECLARE r jsonb; BEGIN
  ASSERT (SELECT count(*) FROM storage.objects) = 0, 'sm no object before log';
  r := cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002'));
  ASSERT r->>'bucket' = 'cm-call-recordings' AND r->>'path' = 'calls/2026/12/CDR-T-2.mp3' AND (r->>'expires_in')::int <= 300, 'req '||r;
  ASSERT r::text !~* 'https?://|token', 'no url/secret';
  ASSERT (SELECT count(*) FROM storage.objects) = 1, 'sm sees object after log';
  BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001')); ASSERT false, 'no rec';
  EXCEPTION WHEN raise_exception THEN NULL; END;
  BEGIN INSERT INTO cm_recording_access_log (call_id, user_id, storage_path) VALUES ((SELECT id FROM cm_calls LIMIT 1), auth.uid(), 'x'); ASSERT false, 'direct log';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM storage.objects) = 0, 'gm without own log sees nothing';
  ASSERT (SELECT count(*) FROM cm_recording_access_log) = 1, 'gm audits log';
  PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002'));
  ASSERT (SELECT count(*) FROM storage.objects) = 1, 'gm after log';
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
DO $$ BEGIN PERFORM cm_request_recording_access((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002')); END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_recording_access_log) = 3, 'every listen logged';
  ASSERT (SELECT array_agg(DISTINCT user_id::text ORDER BY user_id::text) FROM cm_recording_access_log)
       = ARRAY['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000b1'], 'who listened';
  UPDATE cm_recording_access_log SET accessed_at = now() - interval '6 minutes';
END $$;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN ASSERT (SELECT count(*) FROM storage.objects) = 0, 'access expires after 5 min'; END $$;
RESET ROLE;
-- SM ربط يدوي بدون تطابق مسموح (method=manual)
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN PERFORM cm_link_conversation_order(cmt.id('c1'), cmt.id('o4'), true); END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT method FROM cm_conversation_orders WHERE order_id = cmt.id('o4')) = 'manual', 'sm manual link';
  -- anon: لا تنفيذ لأي دالة جديدة ولا قراءة
  ASSERT NOT has_function_privilege('anon', 'public.cm_import_hotline_cdr(jsonb)', 'EXECUTE'), 'anon import';
  ASSERT NOT has_function_privilege('anon', 'public.cm_request_recording_access(uuid)', 'EXECUTE'), 'anon rec';
  ASSERT NOT has_function_privilege('anon', 'public.cm_upsert_ad_spend(jsonb,text)', 'EXECUTE'), 'anon spend';
  ASSERT NOT has_table_privilege('anon', 'public.cm_calls', 'SELECT'), 'anon calls';
  ASSERT NOT has_table_privilege('authenticated', 'public.cm_calls', 'INSERT'), 'no direct call insert';
  ASSERT (SELECT bool_and(c.reloptions @> ARRAY['security_invoker=true']) FROM pg_class c
          WHERE c.relname IN ('cm_kpi_conversations_v','cm_kpi_missed_calls_v','cm_kpi_orders_v')), 'views security_invoker';
END $$;

-- EM يرى صفحة الإنفاق (قراءة). صلاحية الكتابة في القاعدة تُركت كما هي (cm_can_write_spend تشمل EM)؛ الواجهة تعرضها لـ EM للقراءة فقط.
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_ad_spend_daily) >= 4, 'em reads spend';
  ASSERT cm_can_write_spend(), 'db write permission unchanged for EM';
END $$;
RESET ROLE;
-- ── 7) أسماء مستخدمي الهوت لاين: SM/GM فقط يعدّلون ──
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_hotline_usernames) = 2, 'em reads mapping';
  BEGIN INSERT INTO cm_hotline_usernames (username, moderator_id) VALUES ('x1', cmt.mid('aya')); ASSERT false, 'em writes mapping';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_hotline_usernames) = 0, 'mod no mapping'; END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN
  UPDATE cm_hotline_usernames SET moderator_id = cmt.mid('noura') WHERE username = 'aya1';
  ASSERT (SELECT moderator_id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003') = cmt.mid('noura'), 'remap follows';
  UPDATE cm_hotline_usernames SET moderator_id = cmt.mid('aya') WHERE username = 'aya1';
  BEGIN INSERT INTO cm_hotline_usernames (username, moderator_id) VALUES ('Has Caps', cmt.mid('aya')); ASSERT false, 'lowercase only';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

-- ── 8) رفع التسجيلات يدوياً (SM/GM) عبر تذكرة + سياسة Storage + سجل تدقيق ──
CREATE TEMP TABLE up (k text PRIMARY KEY, v jsonb); GRANT ALL ON up TO authenticated;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ DECLARE c uuid := (SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003'); r jsonb; BEGIN
  BEGIN PERFORM cm_begin_recording_upload(c, 'application/pdf', 1000, 'x.pdf'); ASSERT false, 'bad type';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_begin_recording_upload(c, 'audio/mpeg', 60000000, 'big.mp3'); ASSERT false, 'too big';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_begin_recording_upload(c, 'audio/mpeg', 0, 'z.mp3'); ASSERT false, 'empty';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_begin_recording_upload(gen_random_uuid(), 'audio/mpeg', 10, 'z.mp3'); ASSERT false, 'no call';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := cm_begin_recording_upload(c, 'audio/mpeg', 123456, 'CDR.260901.120000.0000003.mp3');
  ASSERT r->>'bucket' = 'cm-call-recordings' AND r->>'path' ~ ('^calls/2026/09/' || c || '/[0-9a-f-]{36}\.mp3$'), 'reserved '||r;
  INSERT INTO pg_temp.up VALUES ('a', r);
  BEGIN INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', 'calls/2026/09/free.mp3'); ASSERT false, 'free upload';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_complete_recording_upload((r->>'upload_id')::uuid); ASSERT false, 'complete before file';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', r->>'path');
END $$;
RESET ROLE;
-- GM لا يكمل تذكرة غيره؛ EM والمودريتور لا يرفعان
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', false);
DO $$ BEGIN
  BEGIN PERFORM cm_complete_recording_upload(((SELECT v FROM pg_temp.up WHERE k='a')->>'upload_id')::uuid); ASSERT false, 'other user ticket';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', (SELECT v FROM pg_temp.up WHERE k='a')->>'path' || 'x'); ASSERT false, 'gm other path';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
DO $$ BEGIN
  BEGIN PERFORM cm_begin_recording_upload((SELECT id FROM cm_calls LIMIT 1), 'audio/mpeg', 10, 'a.mp3'); ASSERT false, 'em upload';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
DO $$ BEGIN
  BEGIN PERFORM cm_begin_recording_upload((SELECT id FROM cm_calls LIMIT 1), 'audio/mpeg', 10, 'a.mp3'); ASSERT false, 'mod upload';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM cm_ingest_call_recording('CDR.260901.120000.0000003', NULL, NULL, 'audio/mpeg', 10); ASSERT false, 'mod ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ DECLARE r jsonb := (SELECT v FROM pg_temp.up WHERE k='a'); x jsonb; BEGIN
  x := cm_complete_recording_upload((r->>'upload_id')::uuid);
  ASSERT (SELECT recording_path FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000003') = r->>'path', 'attached';
  BEGIN PERFORM cm_complete_recording_upload((r->>'upload_id')::uuid); ASSERT false, 'double complete';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_ingest_call_recording('CDR.260901.120000.0000003', NULL, NULL, 'audio/mpeg', 10); ASSERT false, 'sm ingest';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- تذكرة منتهية (أكثر من 10 دقائق) لا تسمح بالرفع
  x := cm_begin_recording_upload((SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001'), 'audio/x-m4a', 2048, 'old.m4a');
  INSERT INTO pg_temp.up VALUES ('old', x);
END $$;
RESET ROLE;
UPDATE cm_recording_uploads SET created_at = now() - interval '11 minutes' WHERE id = ((SELECT v FROM pg_temp.up WHERE k='old')->>'upload_id')::uuid;
SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
DO $$ BEGIN
  BEGIN INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', (SELECT v FROM pg_temp.up WHERE k='old')->>'path'); ASSERT false, 'expired ticket';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE action = 'recording_upload_started') = 2, 'upload start audited';
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE action = 'recording_attached' AND actor_id = '00000000-0000-0000-0000-0000000000a1'
          AND after->>'source' = 'manual') = 1, 'attach audited with actor';
END $$;

-- ── 9) استقبال الخدمة (تطبيق موبايل لاحقاً): حجز ← رفع ← ربط، بالـ Cdr Id أو الرقم+الوقت ──
SELECT set_config('request.jwt.claim.sub', '', false);
DO $$ DECLARE r jsonb; x jsonb; BEGIN
  r := cm_ingest_call_recording('CDR.260901.124000.0000002', NULL, NULL, 'audio/mpeg', 5000);
  ASSERT NOT (r->>'attached')::boolean AND r->>'path' LIKE 'calls/2026/09/%', 'service reserve '||r;
  BEGIN PERFORM cm_ingest_call_recording('CDR.260901.124000.0000002', NULL, NULL, 'audio/mpeg', 5000, r->>'path'); ASSERT false, 'attach missing file';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  INSERT INTO storage.objects (bucket_id, name) VALUES ('cm-call-recordings', r->>'path');
  x := cm_ingest_call_recording('CDR.260901.124000.0000002', NULL, NULL, 'audio/mpeg', 5000, r->>'path');
  ASSERT (x->>'attached')::boolean AND (SELECT recording_path FROM cm_calls WHERE external_call_id = 'CDR.260901.124000.0000002') = r->>'path', 'service attach';
  -- بالرقم + الوقت (±2 د)
  r := cm_ingest_call_recording(NULL, '+20 100 000 0007', '2026-09-01 12:01:00+03', 'audio/ogg', 900);
  ASSERT (r->>'call_id')::uuid = (SELECT id FROM cm_calls WHERE external_call_id = 'CDR.260901.120000.0000001'), 'match by phone+time';
  BEGIN PERFORM cm_ingest_call_recording(NULL, '01000000007', '2026-09-01 18:00:00+03', 'audio/ogg', 900); ASSERT false, 'no match';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_ingest_call_recording('CDR.260901.124000.0000002', NULL, NULL, 'audio/mpeg', 10, 'https://evil.example/x.mp3'); ASSERT false, 'url path';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  BEGIN PERFORM cm_ingest_call_recording('CDR.260901.124000.0000002', NULL, NULL, 'text/html', 10); ASSERT false, 'svc bad type';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE action = 'recording_attached' AND after->>'source' = 'service') = 1, 'service attach audited';
  ASSERT NOT has_function_privilege('anon', 'public.cm_begin_recording_upload(uuid,text,bigint,text)', 'EXECUTE'), 'anon begin';
  ASSERT NOT has_function_privilege('anon', 'public.cm_ingest_call_recording(text,text,timestamptz,text,bigint,text)', 'EXECUTE'), 'anon ingest';
  ASSERT NOT has_function_privilege('authenticated', 'public.cm_attach_recording(uuid)', 'EXECUTE'), 'attach internal';
  ASSERT NOT has_table_privilege('anon', 'public.cm_hotline_usernames', 'SELECT'), 'anon mapping';
  ASSERT NOT has_table_privilege('authenticated', 'public.cm_recording_uploads', 'INSERT'), 'no direct ticket';
END $$;
SELECT 'ALL CM STEP4 SQL TESTS PASSED';
