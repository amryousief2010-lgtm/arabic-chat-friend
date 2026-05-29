INSERT INTO public.target_bonus_settings (category, tier, sales_amount, bonus_amount)
VALUES ('كتاكيت', 1, 0, 50)
ON CONFLICT DO NOTHING;