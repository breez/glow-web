import { useLayoutEffect, useRef } from 'react';

/**
 * Returns a ref that always holds the latest value.
 * Useful for accessing callback props inside memoized closures
 * without adding them to dependency arrays.
 *
 * The assignment runs in useLayoutEffect (not during render) per
 * react-hooks/refs and React Compiler guidance. The ref is updated
 * before paint, so consumers reading it from event handlers / async
 * callbacks see the latest value just like the during-render variant.
 */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
