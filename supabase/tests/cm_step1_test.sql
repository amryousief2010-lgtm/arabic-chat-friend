\set ON_ERROR_STOP on
-- يُشغَّل بعد migrations مرتين (اختبار إعادة التشغيل).
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_moderators) = 6, 'moderators';
  ASSERT (SELECT count(*) FROM cm_shift_templates) = 7, 'templates';
  ASSERT (SELECT count(*) FROM cm_shift_assignments) = 21, 'seed roster 7x3';
  ASSERT (SELECT count(*) FROM cm_peer_review) = 3, 'peer review';
  ASSERT (SELECT count(*) FROM cm_lines WHERE connection_status='not_connected' AND NOT meta_registered) = 1, 'api line flag';
  ASSERT (SELECT count(*) FROM orders o JOIN cm_moderators m ON m.id=o.moderator_id WHERE m.slug='noura') = 2, 'noura backfill';
  ASSERT (SELECT count(*) FROM orders o JOIN cm_moderators m ON m.id=o.moderator_id WHERE m.slug='aya') = 2, 'aya backfill';
  ASSERT (SELECT count(*) FROM orders o JOIN cm_moderators m ON m.id=o.moderator_id WHERE m.slug='manal') = 2, 'manal->hagar';
  ASSERT (SELECT orders_count FROM cm_v_unmatched_order_moderators WHERE moderator_text='مجهولة') = 1, 'unmatched report';
  ASSERT (SELECT moderator_text FROM cm_shift_assignments a JOIN cm_moderators m ON m.id=a.moderator_id,
          LATERAL (SELECT m.display_name AS moderator_text) x WHERE a.work_date='2026-10-27' AND a.slot_no=3) = 'هاجر', 'roster';
END $$;
-- trigger للطلبات الجديدة
INSERT INTO orders (moderator,total) VALUES ('سها',1);
DO $$ BEGIN ASSERT (SELECT m.slug FROM orders o JOIN cm_moderators m ON m.id=o.moderator_id ORDER BY o.ctid DESC LIMIT 1)='soha', 'insert trigger'; END $$;
UPDATE orders SET moderator='نورا' WHERE moderator='مجهولة';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_v_unmatched_order_moderators)=0, 'update trigger'; END $$;

-- ربط حساب المودريتور c1 بنورا
UPDATE cm_moderators SET user_id='00000000-0000-0000-0000-0000000000c1' WHERE slug='noura';
GRANT SELECT ON orders TO authenticated;

-- مديرة المبيعات: تعديل كامل
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
UPDATE cm_kpi_settings SET first_reply_target_on_shift_min=20;
UPDATE cm_shift_assignments SET moderator_id=(SELECT id FROM cm_moderators WHERE slug='aya'), source='manual' WHERE work_date='2026-10-24' AND slot_no=1;
INSERT INTO cm_weekly_days_off (moderator_id,dow) SELECT id,2 FROM cm_moderators WHERE slug='aya';
DO $$ BEGIN ASSERT (SELECT first_reply_target_on_shift_min FROM cm_kpi_settings)=20, 'sm update'; END $$;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_audit_log WHERE actor_id='00000000-0000-0000-0000-0000000000a1')>=3, 'audit'; END $$;
RESET ROLE;

-- المدير التنفيذي: يقرأ الكل، لا يعدّل
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000b1';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_shift_assignments)=21, 'exec read'; END $$;
UPDATE cm_kpi_settings SET abandoned_minutes=99;
DO $$ BEGIN ASSERT (SELECT abandoned_minutes FROM cm_kpi_settings)=30, 'exec cannot write'; END $$;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_audit_log)>0, 'exec audit read'; END $$;
RESET ROLE;

-- المودريتور (نورا): ما يخصها فقط، قراءة فقط
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000c1';
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_moderators)=1, 'mod sees own row';
  ASSERT (SELECT count(*) FROM cm_shift_assignments)=6, 'mod sees own shifts (7 minus 1 reassigned)';
  ASSERT (SELECT count(*) FROM cm_shift_templates)=7, 'mod reads templates';
  ASSERT (SELECT count(*) FROM cm_audit_log)=0, 'mod no audit';
  ASSERT (SELECT count(*) FROM cm_peer_review)=2, 'mod peer rows';
END $$;
UPDATE cm_shift_assignments SET moderator_id=NULL;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_shift_assignments WHERE moderator_id IS NOT NULL)=6, 'mod cannot write'; END $$;
DO $$ BEGIN
  BEGIN INSERT INTO cm_audit_log(action,entity) VALUES ('x','y'); RAISE EXCEPTION 'audit insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- القارئ: يقرأ، لا يعدّل
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000d1';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_moderators)=6, 'viewer read'; ASSERT (SELECT count(*) FROM cm_audit_log)=0, 'viewer no audit'; END $$;
DELETE FROM cm_moderators;
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_moderators)=6, 'viewer cannot delete'; END $$;
RESET ROLE;

-- دور غير متعلق (محاسب): لا يرى شيئاً
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000e1';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_moderators)=0 AND (SELECT count(*) FROM cm_kpi_settings)=0, 'unrelated sees nothing'; END $$;
RESET ROLE;

-- المراجعة المتبادلة: مديرة المبيعات تضيف وتُنهي أزواجاً من التطبيق، مع تدقيق
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a1';
INSERT INTO cm_peer_review (reviewer_moderator_id, reviewee_moderator_id)
  SELECT r.id, e.id FROM cm_moderators r, cm_moderators e WHERE r.slug='soha' AND e.slug='aya';
UPDATE cm_peer_review SET valid_to=current_date
  WHERE valid_to IS NULL AND reviewer_moderator_id=(SELECT id FROM cm_moderators WHERE slug='manal')
    AND reviewee_moderator_id=(SELECT id FROM cm_moderators WHERE slug='aya');
DO $$ BEGIN
  ASSERT (SELECT count(*) FROM cm_peer_review WHERE valid_to IS NULL)=3, 'sm peer add+end';
  ASSERT (SELECT count(*) FROM cm_audit_log WHERE entity='cm_peer_review' AND actor_id='00000000-0000-0000-0000-0000000000a1')>=2, 'peer audit';
END $$;
DO $$ BEGIN
  BEGIN INSERT INTO cm_peer_review (reviewer_moderator_id, reviewee_moderator_id)
    SELECT id,id FROM cm_moderators WHERE slug='aya'; RAISE EXCEPTION 'self review allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
RESET ROLE;

-- المدير العام: يعدّل مثل مديرة المبيعات
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a3';
UPDATE cm_distribution_settings SET rotation_offset=1;
DELETE FROM cm_peer_review WHERE reviewer_moderator_id=(SELECT id FROM cm_moderators WHERE slug='soha');
DO $$ BEGIN
  ASSERT (SELECT rotation_offset FROM cm_distribution_settings)=1, 'gm edit';
  ASSERT (SELECT count(*) FROM cm_peer_review WHERE valid_to IS NULL)=2, 'gm peer delete';
END $$;
RESET ROLE;

-- مشرف السوشيال ومدير التسويق والمبيعات: قراءة فقط
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000f1';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_shift_assignments)=21 AND (SELECT count(*) FROM cm_peer_review)>0 AND (SELECT count(*) FROM cm_kpi_settings)=1, 'social read'; END $$;
UPDATE cm_distribution_settings SET rotation_offset=5; DELETE FROM cm_peer_review;
DO $$ BEGIN
  BEGIN INSERT INTO cm_peer_review (reviewer_moderator_id, reviewee_moderator_id)
    SELECT r.id, e.id FROM cm_moderators r, cm_moderators e WHERE r.slug='soha' AND e.slug='noura'; RAISE EXCEPTION 'social insert allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET ROLE authenticated; SET request.jwt.claim.sub='00000000-0000-0000-0000-0000000000a2';
DO $$ BEGIN ASSERT (SELECT count(*) FROM cm_shift_assignments)=21, 'msm read'; END $$;
UPDATE cm_distribution_settings SET rotation_offset=7; DELETE FROM cm_peer_review;
RESET ROLE;
DO $$ BEGIN
  ASSERT (SELECT rotation_offset FROM cm_distribution_settings)=1, 'readers cannot write';
  ASSERT (SELECT count(*) FROM cm_peer_review)>=3, 'readers cannot delete peers';
END $$;
SELECT 'ALL CM STEP1 SQL TESTS PASSED' AS result;
