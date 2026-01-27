import { useState, useEffect, useRef } from 'react';

/**
 * Animated number hook - smoothly transitions between numeric values.
 * Uses requestAnimationFrame for smooth 60fps animations.
 *
 * @param targetValue - The value to animate towards
 * @param duration - Animation duration in milliseconds (default: 400ms)
 * @returns The current animated display value
 *
 * @example
 * const balance = useAnimatedNumber(walletInfo?.balance ?? 0, 400);
 * return <span>{balance.toLocaleString()}</span>;
 */
export function useAnimatedNumber(targetValue: number, duration: number = 400): number {
  const [displayValue, setDisplayValue] = useState(targetValue);
  const animationRef = useRef<number | null>(null);
  const startValueRef = useRef(targetValue);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    // Skip animation if it's the initial render or value hasn't changed
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
  }, [targetValue, duration]);

  return displayValue;
}

export default useAnimatedNumber;
