DELETE FROM main_treasury_transactions
 WHERE description LIKE 'TEST_E2E%' OR description LIKE 'E2E_%'
    OR client_uuid IN ('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000222')
    OR account_id IN (SELECT id FROM main_treasury_accounts WHERE name LIKE 'TEST_E2E%' OR name LIKE 'E2E_%');
DELETE FROM main_treasury_accounts WHERE name LIKE 'TEST_E2E%' OR name LIKE 'E2E_%';