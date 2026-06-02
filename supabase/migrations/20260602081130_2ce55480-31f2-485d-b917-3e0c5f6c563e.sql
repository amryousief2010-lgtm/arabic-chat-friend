ALTER TABLE public.slaughter_yield_standards
  ADD COLUMN IF NOT EXISTS standard_kg_per_bird numeric;

UPDATE public.slaughter_yield_standards SET standard_yield_pct = 1.3 WHERE cut_name_ar = 'قوانص';
UPDATE public.slaughter_yield_standards SET standard_yield_pct = 1.8 WHERE cut_name_ar = 'كبده';

UPDATE public.slaughter_yield_standards SET standard_kg_per_bird = 3 WHERE cut_name_ar = 'رقاب';
UPDATE public.slaughter_yield_standards SET standard_kg_per_bird = 1.5 WHERE cut_name_ar = 'ريش';

UPDATE public.slaughter_settings
SET yield_cut_names = ARRAY[
  'لحمه','استيك','موزه','فراشه','قطعيه دبوس','دبوس بالعظم','فخده','صندوق','نعامه صندوق',
  'تربيانكو','اسكالوب','رول النعام','فرم نعام'
];