ALTER TABLE public.feed_recipes
  ADD COLUMN IF NOT EXISTS labor_total_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_expenses_total numeric NOT NULL DEFAULT 0;

-- Seed labor totals for the three Excel-imported recipes (based on Excel sheets)
UPDATE public.feed_recipes SET labor_total_cost = 600  WHERE source_invoice = 'EXCEL:FEED-TASMEEN' AND labor_total_cost = 0;
UPDATE public.feed_recipes SET labor_total_cost = 8940 WHERE source_invoice = 'EXCEL:FEED-BAYAD'   AND labor_total_cost = 0;
UPDATE public.feed_recipes SET labor_total_cost = 500  WHERE source_invoice = 'EXCEL:FEED-KATAKEET' AND labor_total_cost = 0;