import { useState, useEffect, useRef } from 'react';

interface AnimatedNumberOptions {
  duration?: number;
  /** Start from this percentage of target on initial load (0-1). Default: undefined (no initial animation) */
  initialStartPercent?: number;
}

/**
 * Animated number hook - smoothly transitions between numeric values.
 * Uses requestAnimationFrame for smooth 60fps animations.
 *
 * @param targetValue - The value to animate towards
 * @param options - Animation options (duration, initialStartPercent)
 * @returns The current animated display value
 *
 * @example
 * // Basic usage - animates between value changes
 * const balance = useAnimatedNumber(walletInfo?.balance ?? 0);
 * 
 * @example
 * // With initial count-up from 80%
 * const balance = useAnimatedNumber(walletInfo?.balance ?? 0, { initialStartPercent: 0.8 });
 */
export function useAnimatedNumber(
  targetValue: number,
  options: AnimatedNumberOptions | number = {}
): number {
  // Support legacy signature: useAnimatedNumber(value, duration)
  const opts: AnimatedNumberOptions = typeof options === 'number' 
    ? { duration: options } 
    : options;
  
  const { duration = 400, initialStartPercent } = opts;
  
  const isFirstRender = useRef(true);
  const hasAnimatedInitial = useRef(false);
  
  // Calculate initial display value
  const getInitialValue = () => {
    if (initialStartPercent !== undefined && targetValue > 0) {
      return Math.round(targetValue * initialStartPercent);
    }
    return targetValue;
  };
  
  const [displayValue, setDisplayValue] = useState(getInitialValue);
  const animationRef = useRef<number | null>(null);
  const startValueRef = useRef(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Handle initial animation on first non-zero value
    if (isFirstRender.current && initialStartPercent !== undefined && targetValue > 0 && !hasAnimatedInitial.current) {
      isFirstRender.current = false;
      hasAnimatedInitial.current = true;
      
      const startValue = Math.round(targetValue * initialStartPercent);
      startValueRef.current = targetValue;
      startTimeRef.current = null;
      
      const animate = (currentTime: number) => {
        if (startTimeRef.current === null) {
          startTimeRef.current = currentTime;
        }

        const elapsed = currentTime - startTimeRef.current;
        const progress = Math.min(elapsed / duration, 1);

        // Ease-out cubic for smooth deceleration
        const easeOut = 1 - Math.pow(1 - progress, 3);

        const currentValue = Math.round(startValue + (targetValue - startValue) * easeOut);
        setDisplayValue(currentValue);

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(animate);
        }
      };

      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }
    
    isFirstRender.current = false;
    
    // Skip animation if value hasn't changed
    if (startValueRef.current === targetValue) return;

    const startValue = displayValue;
    startValueRef.current = targetValue;
    startTimeRef.current = null;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic for smooth deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);

      const currentValue = Math.round(startValue + (targetValue - startValue) * easeOut);
      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- displayValue intentionally omitted to avoid re-triggering animation
  }, [targetValue, duration, initialStartPercent]);

  return displayValue;
}

export default useAnimatedNumber;
