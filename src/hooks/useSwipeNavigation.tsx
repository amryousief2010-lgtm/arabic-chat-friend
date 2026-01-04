import { useRef, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useIsMobile } from './use-mobile';

// Define navigation order for swipe gestures
const navigationOrder = [
  '/',
  '/products',
  '/orders',
  '/notifications',
];

interface UseSwipeNavigationOptions {
  threshold?: number;
  isEnabled?: boolean;
}

export const useSwipeNavigation = ({
  threshold = 100,
  isEnabled = true,
}: UseSwipeNavigationOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  
  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);

  const getCurrentIndex = useCallback(() => {
    return navigationOrder.indexOf(location.pathname);
  }, [location.pathname]);

  const navigateTo = useCallback((direction: 'next' | 'prev') => {
    const currentIndex = getCurrentIndex();
    if (currentIndex === -1) return;

    let newIndex: number;
    // RTL: swipe left goes to next, swipe right goes to previous
    if (direction === 'next') {
      newIndex = currentIndex + 1;
      if (newIndex >= navigationOrder.length) return;
    } else {
      newIndex = currentIndex - 1;
      if (newIndex < 0) return;
    }

    navigate(navigationOrder[newIndex]);
  }, [getCurrentIndex, navigate]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isEnabled || !isMobile) return;
    
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
  }, [isEnabled, isMobile]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isEnabled || !isMobile || !isDragging.current) return;
    
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    
    const diffX = endX - startX.current;
    const diffY = endY - startY.current;
    
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > threshold) {
      // RTL layout: directions are reversed
      if (diffX > 0) {
        // Swipe right in RTL = go to previous page
        navigateTo('prev');
      } else {
        // Swipe left in RTL = go to next page
        navigateTo('next');
      }
    }
    
    isDragging.current = false;
  }, [isEnabled, isMobile, threshold, navigateTo]);

  useEffect(() => {
    if (!isEnabled || !isMobile) return;

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isEnabled, isMobile, handleTouchStart, handleTouchEnd]);

  return {
    currentIndex: getCurrentIndex(),
    totalPages: navigationOrder.length,
    canGoNext: getCurrentIndex() < navigationOrder.length - 1 && getCurrentIndex() !== -1,
    canGoPrev: getCurrentIndex() > 0,
  };
};
