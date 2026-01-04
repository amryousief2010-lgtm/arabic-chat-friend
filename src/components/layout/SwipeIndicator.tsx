import { ChevronLeft, ChevronRight } from "lucide-react";

interface SwipeIndicatorProps {
  currentIndex: number;
  totalPages: number;
  canGoNext: boolean;
  canGoPrev: boolean;
}

const SwipeIndicator = ({
  currentIndex,
  totalPages,
  canGoNext,
  canGoPrev,
}: SwipeIndicatorProps) => {
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-background/80 backdrop-blur-sm rounded-full px-3 py-1.5 shadow-lg border border-border/50 z-40">
      {/* Left arrow (next in RTL) */}
      <ChevronLeft 
        className={`w-4 h-4 transition-opacity ${canGoNext ? 'text-primary opacity-100' : 'text-muted-foreground opacity-30'}`}
      />
      
      {/* Page dots */}
      <div className="flex gap-1.5">
        {Array.from({ length: totalPages }).map((_, index) => (
          <div
            key={index}
            className={`w-1.5 h-1.5 rounded-full transition-all ${
              index === currentIndex 
                ? 'bg-primary w-3' 
                : 'bg-muted-foreground/40'
            }`}
          />
        ))}
      </div>
      
      {/* Right arrow (prev in RTL) */}
      <ChevronRight 
        className={`w-4 h-4 transition-opacity ${canGoPrev ? 'text-primary opacity-100' : 'text-muted-foreground opacity-30'}`}
      />
    </div>
  );
};

export default SwipeIndicator;
