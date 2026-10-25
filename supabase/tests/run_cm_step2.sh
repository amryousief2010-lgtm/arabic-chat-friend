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
for run in 1 2; do
  $PSQL -d $DB -f supabase/migrations/20261025120000_cm_step1_roster_settings.sql
  $PSQL -d $DB -f supabase/migrations/20261025120100_cm_step1_seed.sql
  $PSQL -d $DB -f supabase/migrations/20261025130000_cm_step2_contacts_conversations.sql
  $PSQL -d $DB -f supabase/migrations/20261025140000_cm_step3_inbox_webhook.sql
done
$PSQL -d $DB -f supabase/tests/cm_security_test.sql
$PSQL -d $DB -f supabase/tests/cm_step2_test.sql
$PSQL -d $DB -f supabase/tests/cm_step3_test.sql
$PSQL -d postgres -c "DROP DATABASE $DB"
