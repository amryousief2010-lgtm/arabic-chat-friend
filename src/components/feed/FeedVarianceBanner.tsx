import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";

export const FeedVarianceBanner = ({ reason }: { reason?: string | null }) => (
  <Alert variant="default" className="border-yellow-400 bg-yellow-50 dark:bg-yellow-950/30">
    <AlertTriangle className="w-4 h-4 text-yellow-600" />
    <AlertTitle className="text-yellow-800 dark:text-yellow-200">دفعة تحتاج مراجعة</AlertTitle>
    <AlertDescription className="text-yellow-700 dark:text-yellow-300 text-xs">
      {reason || "تم رصد انحراف في كمية الإنتاج عن المدخلات. يجب مراجعة الدفعة قبل الاعتماد."}
    </AlertDescription>
  </Alert>
);

export default FeedVarianceBanner;
