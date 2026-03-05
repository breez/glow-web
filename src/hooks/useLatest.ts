import { useRef } from 'react';

/**
 * Returns a ref that always holds the latest value.
 * Useful for accessing callback props inside memoized closures
 * without adding them to dependency arrays.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
