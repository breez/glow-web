import { useState, useEffect } from 'react';

/**
 * Hook to detect virtual keyboard height using the Visual Viewport API.
 * Returns the keyboard height in pixels when visible, 0 otherwise.
 *
 * Used by bottom sheets to adjust their position when keyboard appears (#71).
 */
export function useKeyboardHeight(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const handleResize = () => {
      // Calculate keyboard height as difference between window and viewport
      const kbHeight = window.innerHeight - viewport.height;
      // Use threshold to filter out minor viewport changes (e.g., address bar)
      setKeyboardHeight(kbHeight > 100 ? kbHeight : 0);
    };

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  return keyboardHeight;
}
