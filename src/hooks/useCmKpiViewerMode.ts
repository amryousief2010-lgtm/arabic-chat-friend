import { useCmFeatureGate } from "@/hooks/useCmFeatureGate";

/**
 * «عارض المؤشرات»: مستخدم ليس له بوابة «إدارة المحادثات» الكاملة لكنه في cm_kpi_viewer_allowlist
 * (مدير التسويق). يقرأ عبر دوال cm_kpiv_* (تجميعات فقط، بدون محادثات/رسائل/أرقام) ولا يكتب شيئاً.
 */
export function useCmKpiViewerMode(): { ready: boolean; viewerOnly: boolean } {
  const { loading, allowed, kpiViewer } = useCmFeatureGate(true);
  return { ready: !loading, viewerOnly: !loading && allowed !== true && kpiViewer };
}
