import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  isRefreshing: boolean;
  threshold?: number;
}

const PullToRefreshIndicator = ({
  pullDistance,
  isRefreshing,
  threshold = 80,
}: PullToRefreshIndicatorProps) => {
  const progress = Math.min(pullDistance / threshold, 1);
  const shouldShow = pullDistance > 10 || isRefreshing;

  if (!shouldShow) return null;

  return (
    <div 
      className="absolute left-0 right-0 flex justify-center z-50 pointer-events-none"
      style={{ 
        top: Math.min(pullDistance, threshold * 1.2),
        transform: 'translateY(-100%)',
      }}
    >
      <div 
        className={cn(
          "bg-primary/10 backdrop-blur-sm rounded-full p-2 shadow-lg border border-primary/20",
          isRefreshing && "bg-primary/20"
        )}
      >
        <RefreshCw 
          className={cn(
            "w-5 h-5 text-primary transition-transform duration-200",
            isRefreshing && "animate-spin"
          )}
          style={{
            transform: isRefreshing ? undefined : `rotate(${progress * 360}deg)`,
            opacity: Math.max(0.3, progress),
          }}
        />
      </div>
    </div>
  );
};

export default PullToRefreshIndicator;
