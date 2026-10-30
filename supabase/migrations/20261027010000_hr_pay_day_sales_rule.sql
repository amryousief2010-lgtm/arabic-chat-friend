-- بعد فصل «المبيعات» عن «التسويق»: المبيعات تبقى يوم 5 كما كانت تحت «التسويق والمبيعات».
-- التغيير الوحيد: إضافة موقع «المبيعات» وقسم «المبيعات» لقاعدة يوم 5. الشحن بلا تغيير.
CREATE OR REPLACE FUNCTION public.hr_compute_pay_day(p_full_name text, p_location_id uuid, p_department text)
 RETURNS smallint
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  shipping_id        uuid := 'ca127187-a5c8-4b64-a245-bea7e19ccbd6';
  marketing_id       uuid := '9eec8d84-a3e8-4c10-883e-f03614a3a39c';
  sales_marketing_id uuid := '9416cb24-c83b-4700-bc07-e4688cfc7bd8';
  sales_id           uuid := '8cb4662c-182f-427f-8292-501e0fd6a720';
  name_n             text := COALESCE(p_full_name, '');
  dept_n             text := COALESCE(p_department, '');
BEGIN
  -- Highest priority: البواب
  IF name_n ILIKE '%البواب%' THEN
    RETURN 1;
  END IF;

  -- Marketing / Sales / ألاء حامد
  IF name_n ILIKE '%ألاء%' OR name_n ILIKE '%الاء%'
     OR p_location_id IN (marketing_id, sales_marketing_id, sales_id)
     OR dept_n ILIKE '%تسويق%' OR dept_n ILIKE '%مبيعات%' THEN
    RETURN 5;
  END IF;

  -- Shipping company
  IF p_location_id = shipping_id OR dept_n ILIKE '%شحن%' THEN
    RETURN 15;
  END IF;

  RETURN 1;
END;
$function$;
