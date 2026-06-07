import { Badge } from "@/components/ui/badge";
import { COURIER_STATUS_LABEL, COURIER_STATUS_COLOR, type CourierStatus } from "@/lib/privateCourier/constants";

export function CourierStatusBadge({ status }: { status: CourierStatus | null | undefined }) {
  if (!status) return <Badge variant="outline" className="text-xs">غير مُعيَّن</Badge>;
  return (
    <Badge variant="outline" className={`text-xs ${COURIER_STATUS_COLOR[status]}`}>
      {COURIER_STATUS_LABEL[status]}
    </Badge>
  );
}
