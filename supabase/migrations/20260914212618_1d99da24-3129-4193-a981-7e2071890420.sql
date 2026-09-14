-- دالة تتحقق أن المستخدم هو حساب هاجر (التي تعمل مكان منال على نفس الحساب)
CREATE OR REPLACE FUNCTION public.is_hagar_account(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND (
        lower(coalesce(p.email, '')) = 'hager@coceg.net'
        OR public.normalize_ar(coalesce(p.full_name, '')) LIKE '%هاجر%'
      )
  );
$$;

-- طلبات «منال» التاريخية تُعرض لهاجر (قراءة فقط)
CREATE POLICY "Hagar can view legacy Manal orders"
ON public.orders
FOR SELECT
USING (
  public.is_hagar_account(auth.uid())
  AND moderator IS NOT NULL
  AND public.normalize_ar(moderator) LIKE '%منال%'
);

-- بنود تلك الطلبات أيضًا
CREATE POLICY "Hagar can view legacy Manal order items"
ON public.order_items
FOR SELECT
USING (
  public.is_hagar_account(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.moderator IS NOT NULL
      AND public.normalize_ar(o.moderator) LIKE '%منال%'
  )
);