-- بونص المسوقات المعتمد (أكتوبر 2026).
-- لا يقرأ ولا يكتب أي جدول. صفوف payroll_month_snapshots و processed_kg_bonus_schedules
-- و target_bonus_settings تفضل زي ما هي عشان اللقطات القديمة تبقى محفوظة للإدارة.
-- الواجهة بتحسب من src/lib/moderatorKgBonus.ts، والدالة دي مرآة لنفس المعادلة للتقارير.
-- نقاط المراجعة (جنيه): 399→0، 400→2400، 500→3343.2857…، 750→6076.5،
-- 1000→9829.5، 1000.5→9834.7505625، 1500→15642، 2000→22392، 2100→23817، 2500→29517.

CREATE OR REPLACE FUNCTION public.moderator_kg_bonus(kg numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  qty numeric;
  whole integer;
  frac numeric;
  total numeric;
  k integer;
  rate numeric;
  d numeric;
  raw numeric;
  at_ton numeric;
BEGIN
  qty := COALESCE(kg, 0);
  IF qty < 400 THEN
    RETURN 0;
  END IF;

  IF qty <= 1000 THEN
    whole := floor(qty)::integer;
    frac := qty - whole;
    total := 2400;
    IF whole >= 401 THEN
      FOR k IN 401..whole LOOP
        IF k <= 750 THEN
          rate := 9 + 3 * (k - 400)::numeric / 350;
        ELSE
          rate := 12 + 6 * (k - 750)::numeric / 250;
        END IF;
        total := total + rate;
      END LOOP;
    END IF;
    IF frac > 0 THEN
      k := whole + 1;
      IF k <= 750 THEN
        rate := 9 + 3 * (k - 400)::numeric / 350;
      ELSE
        rate := 12 + 6 * (k - 750)::numeric / 250;
      END IF;
      total := total + frac * rate;
    END IF;
    RETURN total;
  END IF;

  -- بونص الألف كيلو نفسه بالمجموع الحدّي، عشان اللي فوق الطن يكمل من نفس الرقم.
  at_ton := public.moderator_kg_bonus(1000);

  IF qty <= 1500 THEN
    d := qty - 1000;
    raw := 10500 + 10.5 * d + 0.00225 * d * d;
  ELSIF qty <= 2000 THEN
    d := qty - 1500;
    raw := 16312.5 + 12.75 * d + 0.0015 * d * d;
  ELSE
    raw := 23062.5 + 14.25 * (qty - 2000);
  END IF;

  RETURN raw - 10500 + at_ton;
END;
$$;

COMMENT ON FUNCTION public.moderator_kg_bonus(numeric) IS
  'بونص مسوقة عن كيلو مصنّعات معدود. صفر تحت 400، 2400 عند 400، مجموع حدّي لحد الطن، ثم منحنى متصل لحد 2 طن و14.25 بعده. لا تلمس جداول.';

REVOKE ALL ON FUNCTION public.moderator_kg_bonus(numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderator_kg_bonus(numeric) TO authenticated, service_role;

COMMENT ON TABLE public.processed_kg_bonus_schedules IS
  'أرشيف شرائح المصنّعات القديمة. قبض الشهور المفتوحة بقى على moderator_kg_bonus ومش بيقرأ الجدول ده. الصفوف محفوظة وما اتعدّلتش.';
