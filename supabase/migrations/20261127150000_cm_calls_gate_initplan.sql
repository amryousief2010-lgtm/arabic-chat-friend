-- صفحة «المكالمات» (الخط الساخن) تفشل بـ statement timeout (20s) في cm_calls_search / cm_calls_search_summary.
-- السبب: سياسة cm_gate (RESTRICTIVE) على cm_calls و cm_call_analysis تستدعي cm_gate_allows() لكل صف (SECURITY DEFINER فلا تُدمج)،
-- وخطة الدالة العامة تختار Nested Loop فيُعاد مسح cm_call_analysis (53 صفاً) لكل مكالمة (3738) = ~198 ألف استدعاء ≈ 35 ثانية.
-- العلاج: لفّ الاستدعاء في (SELECT ...) ليُقيَّم مرة واحدة لكل استعلام (InitPlan). نفس الدلالة بالضبط، لا تغيير في الصلاحيات.
-- نطاق التغيير: جدولان فقط (cm_calls, cm_call_analysis).
-- التراجع: أعد USING/WITH CHECK إلى cm_gate_allows() بدون SELECT.
ALTER POLICY cm_gate ON public.cm_calls
  USING ((SELECT public.cm_gate_allows()))
  WITH CHECK ((SELECT public.cm_gate_allows()));
ALTER POLICY cm_gate ON public.cm_call_analysis
  USING ((SELECT public.cm_gate_allows()))
  WITH CHECK ((SELECT public.cm_gate_allows()));
