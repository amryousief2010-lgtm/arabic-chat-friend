-- جدول سجل التدقيق
CREATE TABLE public.correction_request_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.correction_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid,
  old_status text,
  new_status text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_correction_audit_request ON public.correction_request_audit(request_id);
CREATE INDEX idx_correction_audit_created ON public.correction_request_audit(created_at DESC);

ALTER TABLE public.correction_request_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_managers_see_all"
ON public.correction_request_audit FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['general_manager'::app_role,'executive_manager'::app_role]));

CREATE POLICY "audit_requester_sees_own"
ON public.correction_request_audit FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.correction_requests cr
  WHERE cr.id = correction_request_audit.request_id
    AND cr.requested_by = auth.uid()
));

-- منع تكرار طلب مفتوح لنفس السجل من نفس الموظف
CREATE UNIQUE INDEX uniq_open_correction_per_target
ON public.correction_requests (target_id, target_type, requested_by)
WHERE target_id IS NOT NULL AND status IN ('pending','in_review');

-- تحديث الـ trigger ليسجل في سجل التدقيق
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
    WHEN 'high'   THEN '🟠 مرتفعة'
    WHEN 'low'    THEN '⚪ منخفضة'
    ELSE '🔵 عادية'
  END;

  IF TG_OP = 'INSERT' THEN
    SELECT COALESCE(full_name, email) INTO v_requester
      FROM public.profiles WHERE id = NEW.requested_by;

    INSERT INTO public.notifications (title, description, type)
    VALUES (
      '📝 طلب تصحيح جديد — ' || v_priority_label,
      'من: ' || COALESCE(v_requester,'موظف') ||
      ' • القسم: ' || NEW.target_module ||
      CASE WHEN NEW.target_reference IS NOT NULL
           THEN ' • السجل: ' || NEW.target_reference ELSE '' END ||
      E'\nالملاحظة: ' || NEW.note,
      'correction_request'
    );

    INSERT INTO public.correction_request_audit
      (request_id, action, actor_id, new_status, note)
    VALUES (NEW.id, 'created', NEW.requested_by, NEW.status, NEW.note);

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.status,'') <> COALESCE(NEW.status,'') THEN
    SELECT COALESCE(full_name, email) INTO v_reviewer
      FROM public.profiles WHERE id = NEW.reviewed_by;

    IF NEW.status IN ('resolved','rejected','in_review') THEN
      INSERT INTO public.notifications (title, description, type)
      VALUES (
        CASE NEW.status
          WHEN 'resolved' THEN '✅ تم تنفيذ طلب التصحيح'
          WHEN 'rejected' THEN '❌ تم رفض طلب التصحيح'
          ELSE '👀 طلب التصحيح قيد المراجعة'
        END,
        'بواسطة: ' || COALESCE(v_reviewer,'الإدارة') ||
        CASE WHEN NEW.target_reference IS NOT NULL
             THEN ' • السجل: ' || NEW.target_reference ELSE '' END ||
        CASE WHEN NEW.review_note IS NOT NULL AND NEW.review_note <> ''
             THEN E'\nرد الإدارة: ' || NEW.review_note ELSE '' END,
        'correction_request'
      );
    END IF;

    INSERT INTO public.correction_request_audit
      (request_id, action, actor_id, old_status, new_status, note)
    VALUES (NEW.id, 'status_change', NEW.reviewed_by, OLD.status, NEW.status, NEW.review_note);

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;