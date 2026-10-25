#!/usr/bin/env bash
# يشغّل اختبارات الخطوة 1 على Postgres محلي مؤقت فقط (قاعدة cm_step1_test تُنشأ وتُحذف). لا يتصل بأي قاعدة حقيقية.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=cm_step1_test
PSQL="psql -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB"
$PSQL -d $DB -f supabase/tests/cm_step1_stub.sql
for run in 1 2; do
  $PSQL -d $DB -f supabase/migrations/20261025120000_cm_step1_roster_settings.sql
  $PSQL -d $DB -f supabase/migrations/20261025120100_cm_step1_seed.sql
done
$PSQL -d $DB -f supabase/tests/cm_step1_test.sql
$PSQL -d postgres -c "DROP DATABASE $DB"
