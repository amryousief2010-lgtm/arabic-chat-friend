-- P0 — inventory_items.stock changes only from movement code.
-- The column in this database is stock (there is no current_stock on inventory_items).
-- A session flag is set inside the functions that already post stock, then a
-- trigger rejects any other UPDATE of stock, including from a warehouse supervisor.

CREATE OR REPLACE FUNCTION public.reject_direct_inventory_stock_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;
  IF COALESCE(current_setting('app.inventory_stock_write', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'لا يمكن تعديل رصيد الصنف مباشرة. الرصيد يتغير فقط عبر حركات المخزون.';
END;
$$;

-- Name sorts before the other BEFORE triggers. redirect_merged_item_stock
-- also sets the write flag, and it must not run before this guard.
DROP TRIGGER IF EXISTS trg_reject_direct_inventory_stock_write ON public.inventory_items;
DROP TRIGGER IF EXISTS trg_00_reject_direct_inventory_stock_write ON public.inventory_items;
CREATE TRIGGER trg_00_reject_direct_inventory_stock_write
BEFORE UPDATE OF stock ON public.inventory_items
FOR EACH ROW
EXECUTE FUNCTION public.reject_direct_inventory_stock_write();

-- Inject the flag into every existing plpgsql function that updates item stock.
-- Idempotent: skip functions that already set the flag.
DO $inj$
DECLARE
  r record;
  def text;
  newdef text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND l.lanname = 'plpgsql'
       AND p.prosrc ~* 'UPDATE[[:space:]]+(public\.)?inventory_items'
       AND p.prosrc ILIKE '%stock%'
       AND p.prosrc NOT ILIKE '%app.inventory_stock_write%'
       AND p.proname <> 'reject_direct_inventory_stock_write'
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := regexp_replace(
      def,
      '(\mBEGIN\M)',
      E'BEGIN\n  PERFORM set_config(''app.inventory_stock_write'', ''on'', true);',
      1
    );
    IF newdef = def THEN
      RAISE EXCEPTION 'stock flag injection failed for %', r.oid::regprocedure;
    END IF;
    EXECUTE newdef;
  END LOOP;
END
$inj$;

-- The flag is SET LOCAL: it lasts until the transaction ends, which is the
-- PostgREST request boundary. Do not clear it on RETURN. A sibling BEFORE
-- trigger that returns first would turn the flag off and the guard would
-- reject the movement that set it.
