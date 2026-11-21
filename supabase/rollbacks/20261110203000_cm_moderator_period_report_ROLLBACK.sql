-- رجوع تقرير أداء الموديراتور. يحذف دوال القراءة فقط، ولا يمس المحادثات أو الطلبات.
DROP FUNCTION IF EXISTS public.cm_moderator_period_report(date, date);
DROP FUNCTION IF EXISTS public.cm_report_kg_bucket(text, boolean, text);
