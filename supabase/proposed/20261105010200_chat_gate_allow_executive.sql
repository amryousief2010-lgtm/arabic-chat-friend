-- غير مطبق (موافقة م. عمرو 5/11 على فتح قسم المحادثات لـ GM + م. آلاء + أ. أحمد الجمل؛ التطبيق يحتاج تأكيده).
-- م. آلاء حامد (77b71c5f-…) موجودة بالفعل في cm_feature_gate_allowlist منذ 3/11 — لا تغيير لها.
-- يضاف أ. أحمد الجمل (executive_manager). الوضع العام يبقى general_manager_only، فالمودريتورز ومحمد سيد لا يدخلون.
INSERT INTO public.cm_feature_gate_allowlist (user_id, note)
VALUES ('e0565e51-ee39-4adf-8b36-f7255d7ac2a4', 'أ. أحمد الجمل — المدير التنفيذي، قسم المحادثات (موافقة م. عمرو 2026-11-05)')
ON CONFLICT (user_id) DO NOTHING;
-- ROLLBACK:
-- DELETE FROM public.cm_feature_gate_allowlist WHERE user_id = 'e0565e51-ee39-4adf-8b36-f7255d7ac2a4';
