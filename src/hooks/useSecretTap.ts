import { useState, useCallback, useRef, useEffect } from 'react';

export function useSecretTap(threshold = 5, timeoutMs = 2000, initialActivated: boolean | (() => boolean) = false, onToggle?: () => void) {
  const [tapCount, setTapCount] = useState(0);
  const [activated, setActivated] = useState(initialActivated);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleTap = useCallback(() => {
    setTapCount(prev => {
      const next = prev + 1;
      if (next >= threshold) {
        if (onToggleRef.current) {
          onToggleRef.current();
        } else {
          setActivated(a => !a);
        }
        return 0;
      }
      return next;
    });

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTapCount(0), timeoutMs);
  }, [threshold, timeoutMs]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const reset = useCallback(() => {
    setTapCount(0);
    setActivated(false);
  }, []);

  return { handleTap, activated, tapCount, threshold, reset };
}
