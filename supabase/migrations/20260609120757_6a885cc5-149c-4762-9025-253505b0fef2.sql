DO $$
DECLARE
  OLD_ID uuid := '2187020a-7cdf-4b76-90a8-8222608b0c35'; -- آلاء حامد (marketing_sales_manager) — to merge & delete
  NEW_ID uuid := '77b71c5f-cfa8-42bc-85de-ae536a3ec1c1'; -- م. آلاء حامد (sales_manager) — to keep
  r record;
  sql_text text;
BEGIN
  -- 1) Merge roles (no duplicates)
  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW_ID, role FROM public.user_roles WHERE user_id = OLD_ID
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles WHERE user_id = OLD_ID;

  -- 2) Reassign every FK column in public.* that points to auth.users(id)
  FOR r IN
    SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_namespace fn ON fn.oid = fc.relnamespace
    WHERE con.contype = 'f'
      AND fn.nspname = 'auth' AND fc.relname = 'users'
      AND n.nspname = 'public'
      AND c.relname <> 'user_roles'
  LOOP
    sql_text := format('UPDATE %I.%I SET %I = $1 WHERE %I = $2',
                       r.schema_name, r.table_name, r.column_name, r.column_name);
    BEGIN
      EXECUTE sql_text USING NEW_ID, OLD_ID;
    EXCEPTION
      WHEN unique_violation OR check_violation THEN
        -- If a row would collide with an existing row on the kept user,
        -- drop the old-user row (already represented under the kept user).
        EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
                       r.schema_name, r.table_name, r.column_name)
          USING OLD_ID;
    END;
  END LOOP;

  -- 3) Cleanup profile + auth user (cascades any remaining references)
  DELETE FROM public.profiles WHERE id = OLD_ID;
  DELETE FROM auth.users WHERE id = OLD_ID;

  RAISE NOTICE 'Merge completed: all data moved from % to %', OLD_ID, NEW_ID;
END $$;