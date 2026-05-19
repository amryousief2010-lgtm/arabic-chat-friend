-- جدول طلبات التصحيح
CREATE TABLE public.correction_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_module text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  target_reference text,
  note text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL DEFAULT auth.uid(),
  reviewed_by uuid,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT correction_requests_status_chk CHECK (status IN ('pending','in_review','resolved','rejected')),
  CONSTRAINT correction_requests_priority_chk CHECK (priority IN ('low','normal','high','urgent'))
);

CREATE INDEX idx_correction_requests_requester ON public.correction_requests(requested_by);
CREATE INDEX idx_correction_requests_status ON public.correction_requests(status);
CREATE INDEX idx_correction_requests_created ON public.correction_requests(created_at DESC);

ALTER TABLE public.correction_requests ENABLE ROW LEVEL SECURITY;

-- صلاحية الإنشاء: الأدوار التشغيلية المعنية
CREATE POLICY "operational_can_create_correction"
ON public.correction_requests FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role,
    'slaughterhouse_manager'::app_role,
    'farm_manager'::app_role,
    'hatchery_manager'::app_role,
    'brooding_manager'::app_role,
    'meat_factory_manager'::app_role,
    'feed_factory_manager'::app_role,
    'warehouse_supervisor'::app_role,
    'production_manager'::app_role,
    'quality_manager'::app_role
  ])
);

-- صلاحية القراءة: صاحب الطلب يرى طلباته، والمدير العام/التنفيذي يرى الكل
CREATE POLICY "users_can_view_own_corrections"
ON public.correction_requests FOR SELECT
TO authenticated
USING (
  requested_by = auth.uid()
  OR public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
);

-- صلاحية التحديث: المدير العام/التنفيذي فقط
CREATE POLICY "managers_can_update_corrections"
ON public.correction_requests FOR UPDATE
TO authenticated
USING (
  public.has_any_role(auth.uid(), ARRAY[
    'general_manager'::app_role,
    'executive_manager'::app_role
  ])
);

-- صلاحية الحذف: المدير العام فقط
CREATE POLICY "general_manager_can_delete_corrections"
ON public.correction_requests FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'general_manager'::app_role));

-- تحديث updated_at تلقائيا
CREATE TRIGGER set_correction_requests_updated_at
BEFORE UPDATE ON public.correction_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- تنبيهات تلقائية
CREATE OR REPLACE FUNCTION public.notify_correction_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester text;
  v_reviewer text;
  v_priority_label text;
BEGIN
  v_priority_label := CASE NEW.priority
    WHEN 'urgent' THEN '🔴 عاجل'
    WHEN 'high' THEN '🟠 مرتفعة'
    WHEN 'low' THEN '⚪ منخفضة'
    ELSE '🔵 عادية'
  END;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name, email) INTO v_requester FROM public.profiles WHERE id = NEW.requested_by;
    INSERT INTO public.notifications (title, description, type)
    VALUES (
      '📝 طلب تصحيح جديد — ' || v_priority_label,
      'من: ' || COALESCE(v_requester, 'موظف') ||
      ' • القسم: ' || NEW.target_module ||
      CASE WHEN NEW.target_reference IS NOT NULL THEN ' • السجل: ' || NEW.target_reference ELSE '' END ||
      E'\nالملاحظة: ' || NEW.note,
      'correction_request'
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status,'') <> COALESCE(NEW.status,'') 
     AND NEW.status IN ('resolved','rejected','in_review') THEN
    SELECT COALESCE(full_name, email) INTO v_reviewer FROM public.profiles WHERE id = NEW.reviewed_by;
    INSERT INTO public.notifications (title, description, type)
    VALUES (
      CASE NEW.status
        WHEN 'resolved' THEN '✅ تم تنفيذ طلب التصحيح'
        WHEN 'rejected' THEN '❌ تم رفض طلب التصحيح'
        ELSE '👀 طلب التصحيح قيد المراجعة'
      END,
      'بواسطة: ' || COALESCE(v_reviewer, 'الإدارة') ||
      CASE WHEN NEW.target_reference IS NOT NULL THEN ' • السجل: ' || NEW.target_reference ELSE '' END ||
      CASE WHEN NEW.review_note IS NOT NULL AND NEW.review_note <> '' 
           THEN E'\nرد الإدارة: ' || NEW.review_note ELSE '' END,
      'correction_request'
    );
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_correction_request
AFTER INSERT OR UPDATE ON public.correction_requests
FOR EACH ROW EXECUTE FUNCTION public.notify_correction_request();