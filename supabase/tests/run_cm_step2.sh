#!/usr/bin/env bash
# اختبارات الخطوة 2 على Postgres محلي مؤقت فقط (قاعدة cm_step2_test تُنشأ وتُحذف). لا يتصل بأي قاعدة حقيقية.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=cm_step2_test
export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$PSQL -d $DB -f supabase/tests/cm_step1_stub.sql
$PSQL -d $DB -f supabase/tests/cm_step2_stub.sql
$PSQL -d $DB -f supabase/tests/cm_step4_stub.sql
for run in 1 2; do
  $PSQL -d $DB -f supabase/migrations/20261025120000_cm_step1_roster_settings.sql
  $PSQL -d $DB -f supabase/migrations/20261025120100_cm_step1_seed.sql
  $PSQL -d $DB -f supabase/migrations/20261025130000_cm_step2_contacts_conversations.sql
  $PSQL -d $DB -f supabase/migrations/20261025140000_cm_step3_inbox_webhook.sql
  $PSQL -d $DB -f supabase/migrations/20261025150000_cm_step4_kpis_calls_spend.sql
  $PSQL -d $DB -f supabase/migrations/20261025160000_cm_step4b_recordings_hotline.sql
  $PSQL -d $DB -f supabase/migrations/20261025170000_cm_step5_access_gate.sql
done
# اختبارات الخطوات 1–4 تتحقق من مصفوفة الأدوار ⇒ تعمل في وضع 'roles' (يثبت أن الوضع يعيد المصفوفة القديمة)
$PSQL -d $DB -c "UPDATE public.cm_feature_gate SET access_mode = 'roles'"

$PSQL -d $DB -f supabase/tests/cm_security_test.sql
$PSQL -d $DB -f supabase/tests/cm_step2_test.sql
$PSQL -d $DB -f supabase/tests/cm_step3_test.sql
$PSQL -d $DB -f supabase/tests/cm_step4_test.sql
$PSQL -d $DB -f supabase/tests/cm_step5_test.sql
[ "${KEEP:-0}" = 1 ] || $PSQL -d postgres -c "DROP DATABASE $DB"
