#!/usr/bin/env bash
# يشغّل اختبارات الخطوة 1 على Postgres محلي مؤقت فقط (قاعدة cm_step1_test تُنشأ وتُحذف). لا يتصل بأي قاعدة حقيقية.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/../.."
DB=cm_step1_test
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$PSQL -d $DB -f supabase/tests/cm_step1_stub.sql
for run in 1 2; do
  $PSQL -d $DB -f supabase/migrations/20261025120000_cm_step1_roster_settings.sql
  $PSQL -d $DB -f supabase/migrations/20261025120100_cm_step1_seed.sql
done
# الـ migrations لا تملأ orders.moderator_id
$PSQL -d $DB -c "DO \$\$ BEGIN ASSERT (SELECT count(*) FROM orders WHERE moderator_id IS NOT NULL)=0, 'migration must not backfill'; END \$\$"
# سكربت ما بعد النشر: وضع replica مرة، ثم الوضع العادي (يجب ألا يجد شيئاً = آمن للتكرار)
$PSQL -d $DB -v skip_user_triggers=on -f scripts/cm/post_deploy_backfill_orders_moderator_id.sql
$PSQL -d $DB -c "DO \$\$ BEGIN
  ASSERT (SELECT count(*) FROM orders WHERE moderator_id IS NOT NULL) >= 607, 'backfilled across batches';
  ASSERT (SELECT count(*) FROM orders WHERE updated_at <> '2020-01-01 00:00+00') = 0, 'replica keeps updated_at';
  ASSERT (SELECT count(*) FROM orders_side_effects) = 0, 'replica skips user triggers';
  ASSERT current_setting('session_replication_role') = 'origin', 'role restored'; END \$\$"
$PSQL -d $DB -f scripts/cm/post_deploy_backfill_orders_moderator_id.sql
$PSQL -d $DB -c "DO \$\$ BEGIN ASSERT (SELECT count(*) FROM orders_side_effects) = 0, 'second run is a no-op'; END \$\$"
$PSQL -d $DB -f supabase/tests/cm_step1_test.sql
$PSQL -d postgres -c "DROP DATABASE $DB"
