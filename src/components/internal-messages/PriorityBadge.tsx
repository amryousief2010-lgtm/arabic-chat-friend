import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Flame, Circle } from "lucide-react";

export type MessagePriority = "normal" | "important" | "urgent";

export const PRIORITY_LABEL: Record<MessagePriority, string> = {
  normal: "عادي",
  important: "مهم",
  urgent: "عاجل",
};

export const PriorityBadge = ({ priority }: { priority: MessagePriority }) => {
  if (priority === "urgent") {
    return (
      <Badge variant="destructive" className="gap-1">
        <Flame className="w-3 h-3" /> عاجل
      </Badge>
    );
  }
  if (priority === "important") {
    return (
      <Badge className="gap-1 bg-amber-500 hover:bg-amber-600 text-white">
        <AlertTriangle className="w-3 h-3" /> مهم
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Circle className="w-3 h-3" /> عادي
    </Badge>
  );
};
