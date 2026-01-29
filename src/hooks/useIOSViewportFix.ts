import { useEffect } from 'react';

/**
 * Hook to fix iOS Safari viewport bug where a gap appears at the bottom
 * after the keyboard dismisses. This happens because iOS doesn't properly
 * recalculate the viewport height after keyboard hide.
 *
 * The fix works by:
 * 1. Listening to visualViewport resize events
 * 2. When viewport height increases (keyboard hiding), forcing a layout recalculation
 * 3. Using a small scroll trick to force Safari to recalculate the viewport
 */
export const useIOSViewportFix = (): void => {
  useEffect(() => {
    // Only apply on iOS
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isIOS) return;

    const visualViewport = window.visualViewport;
    if (!visualViewport) return;

    let previousHeight = visualViewport.height;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleResize = () => {
      const currentHeight = visualViewport.height;

      // Keyboard is hiding (viewport getting larger)
      if (currentHeight > previousHeight) {
        // Clear any pending timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Delay to let iOS finish its animation
        timeoutId = setTimeout(() => {
          // Force layout recalculation by triggering a minimal scroll
          // This tricks Safari into recalculating the viewport
          window.scrollTo(0, window.scrollY);

          // Also force a reflow on the document element
          document.documentElement.style.height = '100%';
          void document.documentElement.offsetHeight; // Force reflow
          document.documentElement.style.height = '';
        }, 100);
      }

      previousHeight = currentHeight;
    };

    visualViewport.addEventListener('resize', handleResize);

    return () => {
      visualViewport.removeEventListener('resize', handleResize);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []);
};
