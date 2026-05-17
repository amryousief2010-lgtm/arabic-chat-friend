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
  hapticFeedback?: boolean;
}

// Haptic feedback utility
const triggerHaptic = (type: 'light' | 'medium' | 'heavy' = 'light') => {
  if (!('vibrate' in navigator)) return;
  
  const patterns = {
    light: 10,
    medium: 25,
    heavy: 50,
  };
  
  try {
    navigator.vibrate(patterns[type]);
  } catch (e) {
    // Vibration not supported or blocked
  }
};

export const useSwipeNavigation = ({
  threshold = 100,
  isEnabled = true,
  hapticFeedback = true,
}: UseSwipeNavigationOptions = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  
  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const hasTriggeredFeedback = useRef(false);

  // Detect if the touch started inside an element that scrolls horizontally
  // (e.g. tables, carousels). If yes, we must NOT hijack the gesture.
  const startedInsideHScroll = (target: EventTarget | null): boolean => {
    let el = target as HTMLElement | null;
    while (el && el !== document.body) {
      if (el.scrollWidth > el.clientWidth + 1) {
        const style = window.getComputedStyle(el);
        const ox = style.overflowX;
        if (ox === 'auto' || ox === 'scroll') return true;
      }
      // Native scrollable controls
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.getAttribute('data-no-swipe-nav') !== null) return true;
      el = el.parentElement;
    }
    return false;
  };

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

    // Trigger haptic feedback on successful navigation
    if (hapticFeedback) {
      triggerHaptic('medium');
    }

    navigate(navigationOrder[newIndex]);
  }, [getCurrentIndex, navigate, hapticFeedback]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!isEnabled || !isMobile) return;
    // Ignore multi-touch (pinch/zoom)
    if (e.touches.length > 1) {
      isDragging.current = false;
      return;
    }
    // Skip if the gesture starts inside a horizontally scrollable area
    if (startedInsideHScroll(e.target)) {
      isDragging.current = false;
      return;
    }
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isDragging.current = true;
    hasTriggeredFeedback.current = false;
  }, [isEnabled, isMobile]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isEnabled || !isMobile || !isDragging.current) return;
    
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - startX.current;
    const diffY = currentY - startY.current;

    // If vertical movement dominates, this is a scroll — abort swipe nav
    if (Math.abs(diffY) > 10 && Math.abs(diffY) > Math.abs(diffX)) {
      isDragging.current = false;
      return;
    }
    
    // Light haptic when reaching threshold (only once per swipe)
    if (hapticFeedback && !hasTriggeredFeedback.current && 
        Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) >= threshold) {
      triggerHaptic('light');
      hasTriggeredFeedback.current = true;
    }
  }, [isEnabled, isMobile, threshold, hapticFeedback]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!isEnabled || !isMobile || !isDragging.current) return;
    
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    
    const diffX = endX - startX.current;
    const diffY = endY - startY.current;
    
    // Require a clearly dominant horizontal swipe (2x vertical) to navigate
    if (Math.abs(diffX) > threshold && Math.abs(diffX) > Math.abs(diffY) * 2) {
      // RTL layout: directions are reversed
      if (diffX > 0) {
        navigateTo('prev');
      } else {
        navigateTo('next');
      }
    }
    
    isDragging.current = false;
  }, [isEnabled, isMobile, threshold, navigateTo]);

  useEffect(() => {
    if (!isEnabled || !isMobile) return;

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isEnabled, isMobile, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    currentIndex: getCurrentIndex(),
    totalPages: navigationOrder.length,
    canGoNext: getCurrentIndex() < navigationOrder.length - 1 && getCurrentIndex() !== -1,
    canGoPrev: getCurrentIndex() > 0,
  };
};
